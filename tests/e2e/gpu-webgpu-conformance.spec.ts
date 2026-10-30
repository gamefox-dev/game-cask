import { test, expect, openGame, assertBackend, diagnostics, step, stateHash } from './fixtures';
import { GPU_OP } from '../../bgt/runtime/abi';
import { resolve } from 'node:path';
const browserModule = (file: string) => `/@fs${resolve('bgt', file)}`;

test('WebGPU §13 all 25 opcodes execute, including deletion and handle reuse',
  async ({ page, backendParam, collector }, info) => {
    void collector;
    test.skip(backendParam !== 'webgpu');
    const seen = new Set<number>();
    for (const scene of [0, 1, 3, 5, 7]) {
      await openGame(page, backendParam, { game: 'gpu-scenes-wgpu', arg0: String(scene) });
      await assertBackend(page, backendParam, info);
      for (let i = 0; i < 40 && await stateHash(page) !== '00000003'; i++) {
        await step(page, 1); await page.waitForTimeout(10);
      }
      expect(await stateHash(page)).toBe('00000003');
      const d = await diagnostics(page);
      expect(d.errors).toEqual([]); expect(d.commandErrors.count).toBe(0);
      for (const [op, count] of Object.entries(d.coverage.ops)) if (count > 0) seen.add(Number(op));
    }
    expect([...seen].filter(op => op >= 0x40 && op <= 0x58).sort()).toEqual(Object.values(GPU_OP).sort());
  });

test('WebGPU §13 GLSL ES300 has the same native scene and readback as GLSL330',
  async ({ page, backendParam, collector }, info) => {
    void collector;
    test.skip(backendParam !== 'webgpu');
    await openGame(page, backendParam, { game: 'gpu-scenes-wgpu', arg0: '6', arg1: '1' });
    await assertBackend(page, backendParam, info);
    for (let i = 0; i < 40 && await stateHash(page) !== '00000003'; i++) {
      await step(page, 1); await page.waitForTimeout(10);
    }
    expect(await stateHash(page), JSON.stringify(await diagnostics(page))).toBe('00000003');
    expect((await diagnostics(page)).errors).toEqual([]);
  });

test('WebGPU §13 stops rather than silently dropping live resources on unrecoverable loss',
  async ({ page, backendParam, collector }, info) => {
    collector.allow(/device lost|Cannot restore live GPU resources|recovery disabled/i);
    test.skip(backendParam !== 'webgpu');
    await openGame(page, backendParam, { game: 'gpu-scenes-wgpu', arg0: '1' });
    await assertBackend(page, backendParam, info);
    await step(page, 3);
    await page.evaluate(() => (window as any).__BGT_TEST__.simulateDeviceLoss({ unrecoverable: true }));
    await expect(page.getByRole('alert')).toContainText('Cannot restore live GPU resources');
  });

test('WebGPU §13 native GLSL compiler: matrices, blocks, helpers, loops, gradients and shadow samplers',
  async ({ page, backendParam, collector }, info) => {
    void collector;
    test.skip(backendParam !== 'webgpu');
    await openGame(page, backendParam);
    await assertBackend(page, backendParam, info);
    const errors = await page.evaluate(async (path) => {
      const { translateGLSL } = await import(/* @vite-ignore */ path);
      const adapter = await navigator.gpu.requestAdapter();
      const d = await adapter!.requestDevice();
      const sources = [
        [1, `#version 330 core
layout(location=0) in vec3 position;
layout(std140) uniform bgt_u2 { mat4 projection; mat3 normal; mat2 uvMatrix; vec4 tint; } camera;
out vec4 color;
void main() { mat4 identity=mat4(1.0); mat4 m=mat4(camera.normal);
vec2 uv=camera.uvMatrix*vec2(1.0);
gl_Position = identity * camera.projection * vec4(position, 1.0); color = camera.tint + vec4(uv,0.0,0.0); }`],
        [2, `#version 330 core
uniform sampler2D bgt_t0; layout(location=0) out vec4 c;
float helper(float x) { return sin(x); }
void main() {
  float x = 0.0;
  for (int i=0; i<3; i++) { x += helper(float(i)); }
  c = textureLod(bgt_t0, vec2(x), 1.0); c.xy = c.yx; c.zw += vec2(0.0);
}`],
        [2, `#version 330 core
uniform sampler2DShadow bgt_t1; layout(location=0) out vec4 c;
void main() { c = vec4(texture(bgt_t1, vec3(0.5))); }`],
        [2, `#version 330 core
uniform sampler2D bgt_t0; layout(location=0) out vec4 c;
void main() { vec2 uv = gl_FragCoord.xy / vec2(64.0);
c = textureGrad(bgt_t0, uv, dFdx(uv), dFdy(uv)); }`],
      ] as const;
      const errors: string[] = [];
      for (const [stage, source] of sources) {
        d.pushErrorScope('validation');
        const module = d.createShaderModule({ code: translateGLSL(source, stage, 1) });
        const result = await module.getCompilationInfo(), error = await d.popErrorScope();
        errors.push(...result.messages.filter(m => m.type === 'error').map(m => m.message));
        if (error) errors.push(error.message);
      }
      d.destroy(); return errors;
    }, browserModule('renderers/webgpu/shaders.ts'));
    expect(errors).toEqual([]);
  });

test('WebGPU §13 native edge cases: formats, unaligned UNORM, strips, byte updates and pending loss',
  async ({ page, backendParam, collector }, info) => {
    void collector;
    test.skip(backendParam !== 'webgpu');
    await openGame(page, backendParam);
    await assertBackend(page, backendParam, info);
    const result = await page.evaluate(async ({ path, abi }) => {
      const { WebGPUCommands } = await import(/* @vite-ignore */ path);
      const { GPU_OP: O } = await import(/* @vite-ignore */ abi);
      const adapter = await navigator.gpu.requestAdapter(), d = await adapter!.requestDevice();
      const errors: string[] = [];
      d.addEventListener('uncapturederror', e => errors.push((e as GPUUncapturedErrorEvent).error.message));
      const gpu = new WebGPUCommands(d, (message: string) => errors.push(message));
      const f = (n: number) => new Uint32Array(new Float32Array([n]).buffer)[0];
      const run = (op: number, words: number[], data?: Uint8Array) => {
        const rc = gpu.execute({ kind: 'gpu', op, words, data });
        if (rc) errors.push(`opcode ${op}: ${rc}`);
      };
      const shader = (handle: number, source: string, stage = 3, language = 0) =>
        new Promise<{ code: number; log: string }>(resolve => {
          gpu.execute({ kind: 'gpu', op: O.SHADER_CREATE, words: [handle, stage, language], source,
            complete: (code: number, log: string) => resolve({ code, log }) });
        });
      const code = `struct V { @builtin(position) p: vec4f, @location(0) c: vec4f };
@vertex fn vs_main(@location(0) c: vec4f, @builtin(vertex_index) id: u32,
 @builtin(instance_index) instance: u32) -> V {
 let p = array<vec2f,4>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(1,1));
 return V(vec4f(p[id],0.5,1),c * f32(instance));
}
@fragment fn fs_main(v: V) -> @location(0) vec4f { return v.c; }`;
      const compiled = await shader(1, code);
      if (compiled.code) errors.push(compiled.log);
      // Attribute byte offset 1 is valid BGT but not a native WebGPU vertex layout.
      run(O.BUFFER_CREATE, [1, 1, 32], new Uint8Array(32));
      for (let i = 0; i < 4; i++) run(O.BUFFER_UPDATE, [1, i * 8 + 1], new Uint8Array([255, 0, 255, 255]));
      run(O.BUFFER_CREATE, [2, 2, 10], new Uint8Array(new Uint16Array([9, 1, 2, 3, 4]).buffer));
      const header = (handle: number, topology: number, format: number) => [
        handle, 1, 1, topology, 0, 0, 0xffffffff, 0, 0, 7, 0, 255, 0,
        7, 0, 0, 0, 7, 0, 0, 0, 0, 0, 1, 1, 1,
        8, 0, 0, 0, 1, 4, format, 0, 1, 0, 0, 1, 0, 0, 15,
      ];
      let pixel: number[] = [];
      for (let format = 0; format < 7; format++) {
        run(O.TEXTURE_CREATE, [format + 1, 8, 8, 1, format, 3]);
        if (format >= 5) continue;
        run(O.PIPELINE_CREATE, header(format + 1, 4, format));
        run(O.PASS_BEGIN, [1, 0, 0, 0, 0, f(1), 0, format + 1, 0, 1, 0, 0, 0, f(1)]);
        run(O.PIPELINE, [format + 1]); run(O.VERTEX_BUFFER, [0, 1, 0, 32]);
        run(O.INDEX_BUFFER, [2, 0, 2, 8]);
        run(O.DRAW_INDEXED, [4, 1, 0, -1 >>> 0, 1]); run(O.PASS_END, []);
      }
      // Use a screen attachment to exercise nonindexed strip expansion and line-strip topology.
      const screen = d.createTexture({ size: [8, 8], format: 'rgba8unorm',
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      gpu.frame(screen);
      for (const topology of [2, 4]) {
        run(O.PIPELINE_CREATE, header(10 + topology, topology, 0));
        run(O.PASS_BEGIN, [1, 0, 0, 0, 0, f(1), 0, 0, 0, 1, 0, 0, 0, f(1)]);
        run(O.PIPELINE, [10 + topology]); run(O.VERTEX_BUFFER, [0, 1, 0, 32]);
        run(O.DRAW, [4, 1, 0, 1]); run(O.PASS_END, []);
      }
      const staging = d.createBuffer({ size: 2048, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const enc = d.createCommandEncoder();
      enc.copyTextureToBuffer({ texture: screen }, { buffer: staging, bytesPerRow: 256 }, [8, 8]);
      d.queue.submit([enc.finish()]); await staging.mapAsync(GPUMapMode.READ);
      pixel = [...new Uint8Array(staging.getMappedRange()).slice(3 * 256 + 3 * 4, 3 * 256 + 3 * 4 + 4)];
      staging.unmap(); staging.destroy();
      const depthWriter = code.replace(
        '@fragment fn fs_main(v: V) -> @location(0) vec4f { return v.c; }',
        '@fragment fn fs_main(v: V) -> @builtin(frag_depth) f32 { return select(0.0,1.0,v.p.x>4.0); }');
      const written = await shader(4, depthWriter);
      if (written.code) errors.push(written.log);
      const writer = header(30, 4, 0).slice(0, -9);
      writer[1] = 4; writer[2] = 4; writer[6] = 6; writer[8] = 1; writer[25] = 0;
      run(O.PIPELINE_CREATE, writer);
      run(O.PASS_BEGIN, [0, 7, 0, 1, 0, f(1), 0]);
      run(O.PIPELINE, [30]); run(O.VERTEX_BUFFER, [0, 1, 0, 32]);
      run(O.DRAW, [4, 1, 0, 1]); run(O.PASS_END, []);
      const vs = await shader(2, `#version 330 core
layout(location=0) in vec4 c;
void main() { vec2 p=vec2(float(bgt_vertex_index & 1u)*2.0-1.0,
float(bgt_vertex_index >> 1u)*2.0-1.0); gl_Position=vec4(p,0.5,1.0); }`, 1, 1);
      const fs = await shader(3, `#version 330 core
uniform sampler2D bgt_t0; layout(location=0) out vec4 c;
void main() { c=texture(bgt_t0, vec2(0.5)); }`, 2, 1);
      if (vs.code || fs.code) errors.push(vs.log, fs.log);
      const depthPipeline = header(20, 4, 0);
      depthPipeline[1] = 2; depthPipeline[2] = 3; depthPipeline[22] = 1;
      run(O.PIPELINE_CREATE, depthPipeline); run(O.SAMPLER_CREATE, [1, 1, 1, 2, 1, 2, 0, 7]);
      run(O.PASS_BEGIN, [1, 0, 0, 0, 0, f(1), 0, 0, 0, 1, 0, 0, 0, f(1)]);
      run(O.PIPELINE, [20]); run(O.VERTEX_BUFFER, [0, 1, 0, 32]); run(O.TEXTURE, [0, 7, 1]);
      run(O.DRAW, [4, 1, 0, 0]); run(O.PASS_END, []);
      const depthStaging = d.createBuffer({ size: 2048, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const depthEnc = d.createCommandEncoder();
      depthEnc.copyTextureToBuffer({ texture: screen }, { buffer: depthStaging, bytesPerRow: 256 }, [8, 8]);
      d.queue.submit([depthEnc.finish()]); await depthStaging.mapAsync(GPUMapMode.READ);
      const depthPixel = [...new Uint8Array(depthStaging.getMappedRange()).slice(0, 4)];
      depthStaging.unmap(); depthStaging.destroy();
      const semantics = await shader(5, `#version 330 core
layout(location=0) out vec4 c; float counter=0.0;
float bump() { counter += 1.0; return counter; }
void main() { float a=0.25; float x=bgt_frag_coord.x>0.0 ? a : bump();
mat4 m=mat4(bump()); float r=mod(bump(),2.0);
c=vec4(float(1/2),counter/4.0,x,1.0); }`, 2, 1);
      if (semantics.code) errors.push(semantics.log);
      const semanticsPipeline = header(40, 4, 0); semanticsPipeline[1] = 2; semanticsPipeline[2] = 5;
      run(O.PIPELINE_CREATE, semanticsPipeline);
      run(O.PASS_BEGIN, [1, 0, 0, 0, 0, f(1), 0, 0, 0, 1, 0, 0, 0, f(1)]);
      run(O.PIPELINE, [40]); run(O.VERTEX_BUFFER, [0, 1, 0, 32]);
      run(O.DRAW, [4, 1, 0, 0]); run(O.PASS_END, []);
      const semanticsStaging = d.createBuffer({ size: 2048,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      const semanticsEnc = d.createCommandEncoder();
      semanticsEnc.copyTextureToBuffer({ texture: screen },
        { buffer: semanticsStaging, bytesPerRow: 256 }, [8, 8]);
      d.queue.submit([semanticsEnc.finish()]); await semanticsStaging.mapAsync(GPUMapMode.READ);
      const semanticsPixel = [...new Uint8Array(semanticsStaging.getMappedRange()).slice(0, 4)];
      semanticsStaging.unmap(); semanticsStaging.destroy();
      const pending = shader(9, code); gpu.lost();
      const lost = await pending;
      await gpu.restore(d); await d.queue.onSubmittedWorkDone();
      const resources = gpu.hasResources;
      d.destroy();
      return { errors, pixel, depthPixel, semanticsPixel, lost, resources };
    }, { path: browserModule('renderers/webgpu/gpu.ts'), abi: browserModule('runtime/abi.ts') });
    expect(result.errors).toEqual([]);
    expect(result.pixel).toEqual([255, 0, 255, 255]);
    expect(result.depthPixel).toEqual([128, 0, 0, 255]);
    expect(result.semanticsPixel).toEqual([0, 128, 64, 255]);
    expect(result.lost.code).toBe(-6); expect(result.lost.log).toMatch(/lost while compiling/);
    expect(result.resources).toBe(true);
  });
