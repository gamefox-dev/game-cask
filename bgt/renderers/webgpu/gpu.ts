// §13 executor. The decoder owns validation; this class owns native resources and recovery shadows.
import { E_IO, GPU_OP as OP } from '../../runtime/abi';
import type { GpuBackend, GpuItem } from '../types';
import { glslVaryings, shaderBindings, translateGLSL, validateWGSL, type ShaderBinding } from './shaders';
import { lowerDepthSampling, type DepthSampling } from './depth';
import { TEXEL_BYTES, canonicalize, downsampleBox, generatedMipShadows, isDepthFormat, isIntegerFormat, mipExtent, toCanonicalTexture, type CanonicalTexture }
  from '../gpu-texture';

const formats: GPUTextureFormat[] = [
  'rgba8unorm', 'rgba8unorm-srgb', 'r8unorm', 'rg8unorm', 'rgba16float', 'depth24plus-stencil8', 'depth32float',
  'rgb10a2unorm', 'r16float', 'rg16float', 'r32float', 'rg32float', 'rgba32float',
  'r8uint', 'r8sint', 'r16uint', 'r16sint', 'r32uint', 'r32sint',
  'rg8uint', 'rg8sint', 'rg16uint', 'rg16sint', 'rg32uint', 'rg32sint',
  'rgba8uint', 'rgba8sint', 'rgba16uint', 'rgba16sint', 'rgba32uint', 'rgba32sint',
];
const compare: GPUCompareFunction[] = [
  'never', 'less', 'equal', 'less-equal', 'greater', 'not-equal', 'greater-equal', 'always',
];
const stencil: GPUStencilOperation[] = [
  'keep', 'zero', 'replace', 'increment-clamp', 'decrement-clamp', 'invert', 'increment-wrap', 'decrement-wrap',
];
const factors: GPUBlendFactor[] = [
  'zero', 'one', 'src', 'one-minus-src', 'dst', 'one-minus-dst', 'src-alpha', 'one-minus-src-alpha',
  'dst-alpha', 'one-minus-dst-alpha', 'constant', 'one-minus-constant',
];
const blendOps: GPUBlendOperation[] = ['add', 'subtract', 'reverse-subtract', 'min', 'max'];
const vertexFormats: GPUVertexFormat[] = [
  'float32', 'float32x2', 'float32x3', 'float32x4', 'unorm8x4', 'sint32', 'sint32x2', 'sint32x3',
  'sint32x4', 'uint32', 'uint32x2', 'uint32x3', 'uint32x4',
];
const f = (n: number) => new Float32Array(new Uint32Array([n]).buffer)[0];
interface BufferResource { native: GPUBuffer; words: readonly number[]; shadow: Uint8Array<ArrayBuffer> }
interface TextureResource {
  native: GPUTexture; words: readonly number[]; desc: CanonicalTexture; uploads: GpuItem[]; allocatedMips: number;
  generated?: { base: number; source: GpuItem; overridden: Set<number> };
}
interface ShaderResource { native: GPUShaderModule; item: GpuItem; done: boolean; bindings: ShaderBinding[] }
interface Repack { slot: number; stride: number; attributes: { offset: number; size: number }[] }
interface PipelineResource {
  native: GPURenderPipeline; words: readonly number[]; bindings: ShaderBinding[]; repack: Repack[];
  variants: Map<string, PipelineResource>; validation: Promise<GPUError | null>;
}

export class WebGPUCommands implements GpuBackend {
  readonly languages = 7;
  readonly buffers = new Map<number, BufferResource>();
  readonly textures = new Map<number, TextureResource>();
  private samplers = new Map<number, { native: GPUSampler; nonfilter?: GPUSampler; words: readonly number[] }>();
  private shaders = new Map<number, ShaderResource>();
  private pipelines = new Map<number, PipelineResource>();
  private encoder?: GPUCommandEncoder;
  private pass?: GPURenderPassEncoder;
  private passFormats: number[] = [];
  private passDepth = 0xffffffff;
  private passSize = [1, 1];
  private viewport = [0, 0, 1, 1, 0, 1];
  private stencilRef = 0;
  private clearPipelines = new Map<string, GPURenderPipeline>();
  private screen?: GPUTexture;
  private current?: PipelineResource;
  private uniforms = new Map<number, GPUBufferBinding>();
  private sampled = new Map<number, number[]>();
  private index?: number[];
  private vertices = new Map<number, readonly number[]>();
  private scratch: GPUBuffer[] = [];
  private inactive = false;
  private pending = new Set<ShaderResource>();
  private failedShaders = new Map<number, GpuItem>();
  private readbacks = new Set<GpuItem>();

  constructor(private device: GPUDevice, private error: (message: string) => void) {}

  get hasResources(): boolean {
    return !!(this.buffers.size || this.textures.size || this.samplers.size || this.shaders.size ||
      this.failedShaders.size || this.pipelines.size);
  }

  frame(screen: GPUTexture): void { this.screen = screen; }

  lost(): void {
    this.inactive = true;
    this.pass = undefined;
    this.encoder = undefined;
    this.screen = undefined;
    this.vertices.clear(); this.uniforms.clear(); this.sampled.clear(); this.index = undefined;
    this.scratch.splice(0).forEach(b => b.destroy());
    for (const s of this.pending) if (!s.done) {
      s.done = true;
      s.item.complete?.(E_IO, 'WebGPU device lost while compiling shader');
    }
    this.pending.clear();
    for (const r of this.readbacks) r.readback?.(undefined, E_IO);
    this.readbacks.clear();
  }

  async restore(device: GPUDevice): Promise<void> {
    this.device = device;
    this.inactive = false;
    const buffers = [...this.buffers], textures = [...this.textures], samplers = [...this.samplers];
    const shaders = [...this.shaders], pipelines = [...this.pipelines];
    this.buffers.clear(); this.textures.clear(); this.samplers.clear(); this.shaders.clear(); this.pipelines.clear();
    this.blits.clear(); this.blitSampler = undefined; this.depthUploadPipelines.clear(); this.clearPipelines.clear();
    for (const [, b] of buffers) this.execute({ kind: 'gpu', op: OP.BUFFER_CREATE, words: b.words, data: b.shadow });
    for (const [, t] of textures) {
      this.execute({ kind: 'gpu', op: OP.TEXTURE_CREATE_EX, words: t.words });
      if (t.allocatedMips > 1) this.execute({ kind: 'gpu', op: OP.TEXTURE_ALLOCATE_MIPS,
        words: [t.words[0], t.allocatedMips] });
      if (t.generated && t.desc.dimension !== 1) {
        this.execute(t.generated.source);
        this.execute({ kind: 'gpu', op: OP.TEXTURE_GENERATE_MIPS, words: [t.words[0], t.generated.base] });
      }
      for (const item of t.uploads) if (!t.generated || t.desc.dimension === 1 ||
        item.words[1] < t.generated.base || t.generated.overridden.has(item.words[1])) this.execute(item);
    }
    for (const [, s] of samplers) this.execute({ kind: 'gpu', op: OP.SAMPLER_CREATE_EX, words: s.words });
    for (const [, s] of shaders) this.execute({ ...s.item, complete: undefined });
    const info = await Promise.all([...this.shaders.values()].map(s => s.native.getCompilationInfo()));
    const used = new Set(pipelines.flatMap(([, p]) => [p.words[1], p.words[2]]));
    const restored = [...this.shaders];
    if ([...used].some(h => !this.shaders.has(h))) throw new Error('GPU shader could not be restored');
    for (let i = 0; i < info.length; i++) if (used.has(restored[i][0]) &&
      info[i].messages.some(m => m.type === 'error')) throw new Error('GPU shader could not be restored');
    for (const [, p] of pipelines) if (this.execute({ kind: 'gpu', op: OP.PIPELINE_CREATE, words: p.words }))
      throw new Error('GPU pipeline could not be restored');
    const errors = await Promise.all([...this.pipelines.values()].map(p => p.validation));
    if (errors.some(Boolean)) throw new Error(errors.find(Boolean)!.message);
  }

  execute(item: GpuItem): number {
    if (this.inactive) {
      item.complete?.(E_IO, 'WebGPU device is lost'); item.readback?.(undefined, E_IO); return E_IO;
    }
    try { this.run(item); return 0; }
    catch (e) {
      const message = `GPU opcode 0x${item.op.toString(16)}: ${(e as Error).message}`;
      if (item.op === OP.SHADER_CREATE) this.failedShaders.set(item.words[0], item);
      item.complete?.(E_IO, message); item.readback?.(undefined, E_IO);
      if (item.op !== OP.SHADER_CREATE) this.error(message);
      return E_IO;
    }
  }

  private run(item: GpuItem): void {
    const { op, words: w } = canonicalize(item.op, item.words), h = w[0], d = this.device;
    switch (op) {
      case OP.BUFFER_CREATE: {
        const native = d.createBuffer({ size: Math.ceil(w[2] / 4) * 4,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.VERTEX | GPUBufferUsage.INDEX | GPUBufferUsage.UNIFORM });
        const shadow = new Uint8Array(w[2]);
        if (item.data) shadow.set(item.data);
        this.buffers.set(h, { native, words: w, shadow });
        this.writeBuffer(native, 0, shadow);
        break;
      }
      case OP.BUFFER_UPDATE: {
        const b = this.buffers.get(h)!;
        b.shadow.set(item.data!, w[1]);
        // ABI allows byte updates. WebGPU writeBuffer needs 4-aligned regions.
        const start = w[1] & ~3, end = Math.min(b.shadow.length, Math.ceil((w[1] + item.data!.length) / 4) * 4);
        this.writeBuffer(b.native, start, b.shadow.slice(start, end));
        break;
      }
      case OP.BUFFER_DELETE: this.buffers.get(h)!.native.destroy(); this.buffers.delete(h); break;
      case OP.TEXTURE_CREATE_EX: {
        const desc = toCanonicalTexture(w), depthFormat = isDepthFormat(desc.format);
        if (desc.format >= 10 && desc.format <= 12 && !d.features.has('float32-filterable')) {
          throw new Error('32-bit float textures need the float32-filterable WebGPU feature');
        }
        const native = d.createTexture({ size: [desc.width, desc.height, desc.depth], mipLevelCount: 1,
          dimension: desc.dimension === 1 ? '3d' : '2d', format: formats[desc.format],
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT |
            GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC });
        this.textures.set(h, { native, words: w, desc, uploads: [], allocatedMips: 1 });
        // WebGPU zero-initializes color/stencil, but BGT initializes depth to one.
        if (depthFormat) {
          const encoder = d.createCommandEncoder();
          for (let mip = 0; mip < 1; mip++) {
            const a: GPURenderPassDepthStencilAttachment = {
              view: native.createView({ baseMipLevel: mip, mipLevelCount: 1 }),
              depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1,
            };
            if (desc.format === 5) Object.assign(a, { stencilLoadOp: 'clear', stencilStoreOp: 'store', stencilClearValue: 0 });
            encoder.beginRenderPass({ colorAttachments: [], depthStencilAttachment: a }).end();
          }
          d.queue.submit([encoder.finish()]);
        }
        if (item.op === OP.TEXTURE_CREATE && desc.mips > 1) this.growTexture(h, desc.mips);
        break;
      }
      case OP.TEXTURE_ALLOCATE_MIPS: {
        this.growTexture(w[0], w[1]);
        break;
      }
      case OP.TEXTURE_UPDATE_EX: {
        const t = this.textures.get(h)!, bpp = TEXEL_BYTES[t.desc.format];
        const [, mip, x, y, z, width, height, depth] = w;
        t.generated?.overridden.add(mip);
        if (isDepthFormat(t.desc.format)) this.uploadDepth(t, mip, x, y, z, width, height, depth, item.data!);
        else d.queue.writeTexture({ texture: t.native, mipLevel: mip, origin: [x, y, z] }, item.data!,
          { bytesPerRow: width * bpp, rowsPerImage: height }, [width, height, depth]);
        // Keep a compact full mip shadow, rather than an unbounded history of updates.
        const level = mipExtent(t.desc, mip);
        let full = t.uploads.find(i => i.words[1] === mip);
        if (!full) {
          full = { kind: 'gpu', op: OP.TEXTURE_UPDATE_EX, words: [h, mip, 0, 0, 0, level.width, level.height,
            level.depth, 0, level.width * level.height * level.depth * bpp],
            data: new Uint8Array(level.width * level.height * level.depth * bpp) };
          t.uploads.push(full);
        }
        for (let slice = 0; slice < depth; slice++) for (let row = 0; row < height; row++) {
          const source = (slice * height + row) * width * bpp;
          full.data!.set(item.data!.subarray(source, source + width * bpp),
            (((z + slice) * level.height + y + row) * level.width + x) * bpp);
        }
        break;
      }
      case OP.TEXTURE_READBACK: {
        if (isDepthFormat(this.textures.get(h)!.desc.format)) this.readDepthback(item, w);
        else this.readback(item, w);
        break;
      }
      case OP.TEXTURE_GENERATE_MIPS: this.generateMips(w[0], w[1]); break;
      case OP.TEXTURE_DELETE: this.textures.get(h)!.native.destroy(); this.textures.delete(h); break;
      case OP.SAMPLER_CREATE_EX: {
        const filter = ['nearest', 'linear'] as const, wrap = ['clamp-to-edge', 'repeat', 'mirror-repeat'] as const;
        // mip_filter NONE reads exactly level floor(min_lod).
        const none = w[3] === 0, lo = f(w[9]), hi = f(w[10]);
        const native = d.createSampler({ minFilter: filter[w[1]], magFilter: filter[w[2]],
          mipmapFilter: w[3] === 2 ? 'linear' : 'nearest', lodMinClamp: none ? Math.floor(lo) : lo,
          lodMaxClamp: none ? Math.floor(lo) : hi,
          addressModeU: wrap[w[4]], addressModeV: wrap[w[5]], addressModeW: wrap[w[6]],
          compare: w[7] ? compare[w[8]] : undefined });
        this.samplers.set(h, { native, words: w }); break;
      }
      case OP.SAMPLER_DELETE: this.samplers.delete(h); break;
      case OP.SHADER_CREATE: {
        const code = w[2] ? translateGLSL(item.source!, w[1], w[2]) : validateWGSL(item.source!, w[1]);
        // Shader syntax errors belong to the request log, not the uncaptured renderer error channel.
        d.pushErrorScope('validation');
        const native = d.createShaderModule({ code });
        const validation = d.popErrorScope();
        const shader: ShaderResource = { native, item, done: false, bindings: shaderBindings(code, true) };
        this.shaders.set(h, shader);
        this.pending.add(shader);
        void Promise.all([native.getCompilationInfo(), validation]).then(([info, error]) => {
          if (shader.done) return;
          shader.done = true; this.pending.delete(shader);
          const log = info.messages.map(m => `${m.type} ${m.lineNum}:${m.linePos}: ${m.message}`).join('\n');
          item.complete?.(error || info.messages.some(m => m.type === 'error') ? E_IO : 0,
            log || error?.message || '');
        }).catch(e => {
          if (!shader.done) { shader.done = true; this.pending.delete(shader); item.complete?.(E_IO, String(e)); }
        });
        break;
      }
      case OP.SHADER_DELETE: this.shaders.delete(h); this.failedShaders.delete(h); break;
      case OP.PIPELINE_CREATE: this.pipelines.set(h, this.pipeline(w)); break;
      case OP.PIPELINE_DELETE: this.pipelines.delete(h); break;
      case OP.PASS_BEGIN: {
        this.uniforms.clear(); this.sampled.clear(); this.vertices.clear();
        this.index = undefined; this.current = undefined;
        this.encoder = d.createCommandEncoder();
        const colors: GPURenderPassColorAttachment[] = [];
        this.passFormats = []; this.passDepth = w[1] ? this.textures.get(w[1])!.desc.format : 0xffffffff;
        let width = 0, height = 0;
        for (let i = 0; i < h; i++) {
          const j = 7 + i * 7, t = w[j] ? this.textures.get(w[j])!.native : this.screen!;
          width = Math.max(1, t.width >> w[j + 1]); height = Math.max(1, t.height >> w[j + 1]);
          this.passFormats.push(w[j] ? this.textures.get(w[j])!.desc.format : 0);
          colors.push({ view: t.createView({ baseMipLevel: w[j + 1], mipLevelCount: 1 }),
            loadOp: w[j + 2] ? 'clear' : 'load', storeOp: 'store', clearValue: w.slice(j + 3, j + 7).map(f) });
        }
        let depth: GPURenderPassDepthStencilAttachment | undefined;
        if (w[1]) {
          const t = this.textures.get(w[1])!;
          width = Math.max(1, t.native.width >> w[2]); height = Math.max(1, t.native.height >> w[2]);
          depth = { view: t.native.createView({ baseMipLevel: w[2], mipLevelCount: 1 }),
            depthLoadOp: w[3] ? 'clear' : 'load', depthStoreOp: 'store', depthClearValue: f(w[5]) };
          if (t.desc.format === 5) Object.assign(depth, { stencilLoadOp: w[4] ? 'clear' : 'load',
            stencilStoreOp: 'store', stencilClearValue: w[6] });
        }
        this.passSize = [width, height]; this.viewport = [0, 0, width, height, 0, 1]; this.stencilRef = 0;
        this.pass = this.encoder.beginRenderPass({ colorAttachments: colors, depthStencilAttachment: depth });
        this.pass.setViewport(0, 0, width, height, 0, 1);
        this.pass.setScissorRect(0, 0, width, height);
        this.pass.setStencilReference(0);
        this.pass.setBlendConstant([0, 0, 0, 0]);
        break;
      }
      case OP.CLEAR_BUFFER: this.clearBuffer(w); break;
      case OP.PASS_END:
        this.pass!.end(); d.queue.submit([this.encoder!.finish()]); this.pass = undefined; this.encoder = undefined;
        // Destruction is deferred until submissions using these buffers finish.
        if (this.scratch.length) {
          const scratch = this.scratch.splice(0), release = () => scratch.forEach(b => b.destroy());
          void d.queue.onSubmittedWorkDone().then(release, release);
        }
        break;
      case OP.PIPELINE: this.current = this.pipelines.get(h)!; this.pass!.setPipeline(this.current.native); break;
      case OP.VIEWPORT:
        this.viewport = w.map(f); this.pass!.setViewport(f(h), f(w[1]), f(w[2]), f(w[3]), f(w[4]), f(w[5])); break;
      case OP.SCISSOR: this.pass!.setScissorRect(h, w[1], w[2], w[3]); break;
      case OP.STENCIL_REF: this.stencilRef = h; this.pass!.setStencilReference(h); break;
      case OP.BLEND_CONSTANT: this.pass!.setBlendConstant(w.map(f)); break;
      case OP.VERTEX_BUFFER: this.vertices.set(h, w); break;
      case OP.INDEX_BUFFER:
        this.index = [...w];
        this.pass!.setIndexBuffer(this.buffers.get(h)!.native, w[1] ? 'uint32' : 'uint16', w[2], w[3]); break;
      case OP.UNIFORM_BUFFER:
        this.uniforms.set(h, { buffer: this.buffers.get(w[1])!.native, offset: w[2], size: w[3] }); break;
      case OP.TEXTURE: this.sampled.set(h, [...w]); break;
      case OP.DRAW: case OP.DRAW_INDEXED: {
        this.bind();
        if (this.current!.words[3] === 2 || this.current!.words[3] === 4) this.strip(item);
        else if (item.op === OP.DRAW) this.pass!.draw(h, w[1], w[2], w[3]);
        else this.pass!.drawIndexed(h, w[1], w[2], w[3] | 0, w[4]);
        break;
      }
      default: throw new Error('Unknown §13 opcode');
    }
  }

  /** GL clear ignores viewport, blending and depth/stencil comparisons, but honors scissor/write masks. */
  private clearBuffer(w: number[]): void {
    const kind = w[0] & 3, cls = (w[0] >>> 2) & 3, mask = (w[0] >>> 4) & 15, smask = (w[0] >>> 8) & 255;
    const key = JSON.stringify([this.passFormats, this.passDepth, kind, cls, mask, smask, w[1]]);
    let pipeline = this.clearPipelines.get(key);
    if (!pipeline) {
      const colorType = (fmt: number) => !isIntegerFormat(fmt) ? 'vec4f' : fmt & 1 ? 'vec4u' : 'vec4i';
      const fields = this.passFormats.map((fmt, i) => `@location(${i}) c${i}:${colorType(fmt)}`);
      if (kind === 1 || kind === 3) fields.push('@builtin(frag_depth) depth:f32');
      const assignments = this.passFormats.map((fmt, i) => `o.c${i}=${kind === 0 && w[1] === i ?
        cls === 0 ? 'bitcast<vec4f>(v.value)' : cls === 1 ? 'bitcast<vec4i>(v.value)' : 'v.value' : `${colorType(fmt)}(0)`};`);
      if (kind === 1 || kind === 3) assignments.push('o.depth=bitcast<f32>(v.value.x);');
      const module = this.device.createShaderModule({ code: `struct V {value:vec4u}; @group(0) @binding(0) var<uniform> v:V;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f { var p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3)); return vec4f(p[i],0,1); }
${fields.length ? `struct O {${fields.join(',')}}; @fragment fn fs()->O {var o:O;${assignments.join('')}return o;}` : '@fragment fn fs() {}'}` });
      const stencilFace: GPUStencilFaceState = { compare: 'always', passOp: kind >= 2 ? 'replace' : 'keep' };
      pipeline = this.device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: this.passFormats.map((fmt, i) => ({ format: formats[fmt],
          writeMask: kind === 0 && i === w[1] ? mask : 0 })) },
        depthStencil: this.passDepth === 0xffffffff ? undefined : { format: formats[this.passDepth],
          depthWriteEnabled: (kind === 1 || kind === 3) && !!(w[0] & 16), depthCompare: 'always',
          stencilFront: stencilFace, stencilBack: stencilFace, stencilWriteMask: kind >= 2 ? smask : 0 },
        primitive: { topology: 'triangle-list' } });
      if (this.clearPipelines.size >= 64) this.clearPipelines.delete(this.clearPipelines.keys().next().value!);
      this.clearPipelines.set(key, pipeline);
    }
    this.pass!.setPipeline(pipeline);
    // Stencil-only clears use no uniform binding. All other forms consume exact u32/f32 bit patterns.
    if (kind !== 2) {
      const uniform = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true });
      new Uint32Array(uniform.getMappedRange()).set(w.slice(2)); uniform.unmap(); this.scratch.push(uniform);
      this.pass!.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniform } }] }));
    }
    this.pass!.setViewport(0, 0, this.passSize[0], this.passSize[1], 0, 1);
    if (kind >= 2) this.pass!.setStencilReference(w[kind === 2 ? 2 : 3]);
    this.pass!.draw(3);
    const v = this.viewport; this.pass!.setViewport(v[0], v[1], v[2], v[3], v[4], v[5]);
    this.pass!.setStencilReference(this.stencilRef);
    if (this.current) this.pass!.setPipeline(this.current.native);
  }

  private blits = new Map<number, GPURenderPipeline>();
  private blitSampler?: GPUSampler;
  private depthUploadPipelines = new Map<string, GPURenderPipeline>();

  /** Upload a depth texture through an ordered render pass; WebGPU queue writes to depth aspects are invalid.
   * DEPTH24_STENCIL8 uses one pass per distinct stencil value so stencil replace remains exact. */
  private uploadDepth(t: TextureResource, mip: number, x: number, y: number, z: number,
    width: number, height: number, depth: number, data: Uint8Array<ArrayBuffer>): void {
    if (t.desc.dimension !== 0 || z !== 0 || depth !== 1) throw new Error('Depth uploads are 2D only');
    const values = new Float32Array(width * height * 4), view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const stencilValues = new Set<number>();
    for (let i = 0; i < width * height; i++) {
      if (t.desc.format === 5) {
        const packed = view.getUint32(i * 4, true);
        values[i * 4] = ((packed >>> 8) & 0xffffff) / 0xffffff;
        values[i * 4 + 1] = packed & 255; stencilValues.add(packed & 255);
      } else values[i * 4] = view.getFloat32(i * 4, true);
    }
    const d = this.device, source = d.createTexture({ size: [width, height, 1], format: 'rgba32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    d.queue.writeTexture({ texture: source }, values, { bytesPerRow: width * 16, rowsPerImage: height }, [width, height, 1]);
    const encoder = d.createCommandEncoder(), target = t.native.createView({ baseMipLevel: mip, mipLevelCount: 1 });
    const refs = t.desc.format === 5 ? [...stencilValues] : [-1];
    for (const ref of refs) {
      const pipeline = this.depthUploadPipeline(t.desc.format, ref, x, y);
      const pass = encoder.beginRenderPass({ colorAttachments: [], depthStencilAttachment: {
        view: target, depthLoadOp: 'load', depthStoreOp: 'store', depthClearValue: 1,
        ...(t.desc.format === 5 ? { stencilLoadOp: 'load' as const, stencilStoreOp: 'store' as const } : {}),
      } });
      pass.setPipeline(pipeline); pass.setViewport(x, y, width, height, 0, 1); pass.setScissorRect(x, y, width, height);
      if (ref >= 0) pass.setStencilReference(ref);
      pass.setBindGroup(0, d.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: source.createView() }] }));
      pass.draw(3); pass.end();
    }
    d.queue.submit([encoder.finish()]); source.destroy();
  }

  private depthUploadPipeline(format: number, stencilValue: number, x: number, y: number): GPURenderPipeline {
    const key = `${format}:${stencilValue}:${x}:${y}`, existing = this.depthUploadPipelines.get(key); if (existing) return existing;
    const d = this.device, check = stencilValue >= 0 ? `if (abs(q.y - ${stencilValue}.0) > 0.1) { discard; }` : '';
    const module = d.createShaderModule({ code: `
@group(0) @binding(0) var src: texture_2d<f32>;
struct VO { @builtin(position) pos: vec4f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO { var p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3)); var o:VO; o.pos=vec4f(p[i],0,1); return o; }
@fragment fn fs(@builtin(position) p: vec4f) -> @builtin(frag_depth) f32 { let q=textureLoad(src, vec2<i32>(i32(p.x)-${x},i32(p.y)-${y}),0); ${check} return q.x; }` });
    const depthStencil: GPUDepthStencilState = { format: formats[format], depthWriteEnabled: true, depthCompare: 'always' };
    if (format === 5) Object.assign(depthStencil, { stencilFront: { compare: 'always', passOp: 'replace', failOp: 'keep', depthFailOp: 'keep' },
      stencilBack: { compare: 'always', passOp: 'replace', failOp: 'keep', depthFailOp: 'keep' }, stencilWriteMask: 255 });
    const pipeline = d.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [] }, depthStencil, primitive: { topology: 'triangle-list' } });
    this.depthUploadPipelines.set(key, pipeline); return pipeline;
  }

  /** Grow an immutable WebGPU texture without losing already rendered/uploaded levels. */
  private growTexture(handle: number, allocatedMips: number): void {
    const d = this.device, t = this.textures.get(handle)!;
    if (allocatedMips <= t.allocatedMips) return;
    if (allocatedMips > t.desc.mips) throw new Error('Texture mip allocation exceeds descriptor');
    const next = d.createTexture({ size: [t.desc.width, t.desc.height, t.desc.depth], mipLevelCount: allocatedMips,
      dimension: t.desc.dimension === 1 ? '3d' : '2d', format: formats[t.desc.format],
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC });
    const encoder = d.createCommandEncoder();
    for (let mip = 0; mip < t.allocatedMips; mip++) {
      const e = mipExtent(t.desc, mip);
      encoder.copyTextureToTexture({ texture: t.native, mipLevel: mip }, { texture: next, mipLevel: mip },
        [e.width, e.height, e.depth]);
    }
    if (isDepthFormat(t.desc.format)) for (let mip = t.allocatedMips; mip < allocatedMips; mip++) {
      encoder.beginRenderPass({ colorAttachments: [], depthStencilAttachment: {
        view: next.createView({ baseMipLevel: mip, mipLevelCount: 1 }), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1,
        ...(t.desc.format === 5 ? { stencilLoadOp: 'clear' as const, stencilStoreOp: 'store' as const, stencilClearValue: 0 } : {}),
      } }).end();
    }
    d.queue.submit([encoder.finish()]);
    const old = t.native; t.native = next; t.allocatedMips = allocatedMips;
    old.destroy();
  }

  /** §13.7 TEXTURE_GENERATE_MIPS. 2D and array levels are box-filtered by render passes; 3D on the CPU
   * from the upload shadow (volumes can never be render targets, so the shadow is exact). */
  private generateMips(handle: number, base: number): void {
    const d = this.device, t = this.textures.get(handle)!, desc = t.desc;
    this.growTexture(handle, desc.mips);
    const extent = mipExtent(desc, base), old = t.uploads.find(u => u.words[1] === base);
    const data = old?.data!.slice() ?? new Uint8Array(extent.width * extent.height * extent.depth * TEXEL_BYTES[desc.format]);
    const source: GpuItem = { kind: 'gpu', op: OP.TEXTURE_UPDATE_EX, words: [handle, base, 0, 0, 0,
      extent.width, extent.height, extent.depth, 0, data.length], data };
    t.generated = { base, source, overridden: new Set() };
    if (desc.dimension === 1) {
      let prev = data, e = extent;
      for (let k = base + 1; k < desc.mips; k++) {
        const n = mipExtent(desc, k), data = downsampleBox(desc.format, prev, e.width, e.height, e.depth,
          n.width, n.height, n.depth);
        this.run({ kind: 'gpu', op: OP.TEXTURE_UPDATE_EX,
          words: [handle, k, 0, 0, 0, n.width, n.height, n.depth, 0, data.length], data });
        prev = data; e = n;
      }
      return;
    }
    let pipeline = this.blits.get(desc.format);
    if (!pipeline) {
      const module = d.createShaderModule({ code: `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
struct VO { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  var p = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  var o: VO; o.pos = vec4f(p[i], 0, 1); o.uv = vec2f((p[i].x + 1) / 2, (1 - p[i].y) / 2); return o;
}
@fragment fn fs(v: VO) -> @location(0) vec4f { return textureSampleLevel(src, smp, v.uv, 0.0); }` });
      pipeline = d.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format: formats[desc.format] }] },
        primitive: { topology: 'triangle-list' } });
      this.blits.set(desc.format, pipeline);
    }
    this.blitSampler ??= d.createSampler({ minFilter: 'linear', magFilter: 'linear' });
    const encoder = d.createCommandEncoder();
    for (let layer = 0; layer < desc.depth; layer++) for (let k = base + 1; k < desc.mips; k++) {
      const view = (mip: number) => t.native.createView({ dimension: '2d', baseMipLevel: mip, mipLevelCount: 1,
        baseArrayLayer: layer, arrayLayerCount: 1 });
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: view(k), loadOp: 'clear', storeOp: 'store',
        clearValue: [0, 0, 0, 0] }] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, d.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: view(k - 1) }, { binding: 1, resource: this.blitSampler }] }));
      pass.draw(3); pass.end();
    }
    d.queue.submit([encoder.finish()]);
    for (const level of generatedMipShadows(desc, base, data)) {
      const e = mipExtent(desc, level.mip), previous = t.uploads.findIndex(u => u.words[1] === level.mip);
      const shadow: GpuItem = { kind: 'gpu', op: OP.TEXTURE_UPDATE_EX, words: [handle, level.mip, 0, 0, 0,
        e.width, e.height, e.depth, 0, level.data.length], data: level.data };
      if (previous < 0) t.uploads.push(shadow); else t.uploads[previous] = shadow;
    }
  }

  /** Depth readback is an ordered depth-sampling conversion; stencil is not a sampleable WebGPU aspect. */
  private readDepthback(item: GpuItem, w: number[]): void {
    const d = this.device, t = this.textures.get(w[0])!, [, mip, x, y, z, width, height, depth] = w;
    if (t.desc.format === 5) { item.readback?.(undefined, -4); return; }
    if (t.desc.dimension !== 0 || z !== 0 || depth !== 1) throw new Error('Depth readback is 2D only');
    const source = t.native.createView({ aspect: 'depth-only', baseMipLevel: mip, mipLevelCount: 1 });
    const target = d.createTexture({ size: [width, height, 1], format: 'rgba32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const module = d.createShaderModule({ code: `
@group(0) @binding(0) var src: texture_depth_2d;
struct VO { @builtin(position) pos: vec4f };
@vertex fn vs(@builtin(vertex_index) i:u32)->VO { var p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3)); var o:VO; o.pos=vec4f(p[i],0,1); return o; }
@fragment fn fs(@builtin(position) p:vec4f)->@location(0) vec4f { let q=textureLoad(src,vec2<i32>(i32(p.x)+${x},i32(p.y)+${y}),0); return vec4f(q,q,q,1); }` });
    const pipeline = d.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba32float' }] }, primitive: { topology: 'triangle-list' } });
    const encoder = d.createCommandEncoder(), pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(),
      loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
    pass.setPipeline(pipeline); pass.setBindGroup(0, d.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: source }] })); pass.draw(3); pass.end();
    const row = width * 16, aligned = Math.ceil(row / 256) * 256, buffer = d.createBuffer({ size: aligned * height,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    encoder.copyTextureToBuffer({ texture: target }, { buffer, bytesPerRow: aligned, rowsPerImage: height }, [width, height, 1]);
    d.queue.submit([encoder.finish()]); target.destroy(); this.readbacks.add(item);
    void buffer.mapAsync(GPUMapMode.READ).then(() => {
      const mapped = new Float32Array(buffer.getMappedRange()), out = new Uint8Array(width * height * 4);
      const dv = new DataView(out.buffer);
      for (let i = 0; i < width * height; i++) dv.setFloat32(i * 4,
        mapped[Math.floor(i / width) * (aligned >> 2) + (i % width) * 4], true);
      buffer.destroy(); if (this.readbacks.delete(item)) item.readback?.(out);
    }).catch(() => { buffer.destroy(); if (this.readbacks.delete(item)) item.readback?.(undefined, E_IO); });
  }

  /** §13.7 TEXTURE_READBACK: copy in stream order, map later; exact stored texels, rows top-first. */
  private readback(item: GpuItem, w: number[]): void {
    const d = this.device, t = this.textures.get(w[0])!, [, mip, x, y, z, width, height, depth] = w;
    const bpp = TEXEL_BYTES[t.desc.format], row = width * bpp, aligned = Math.ceil(row / 256) * 256;
    const buffer = d.createBuffer({ size: aligned * height * depth,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const encoder = d.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: t.native, mipLevel: mip, origin: [x, y, z] },
      { buffer, bytesPerRow: aligned, rowsPerImage: height }, [width, height, depth]);
    d.queue.submit([encoder.finish()]);
    this.readbacks.add(item);
    const finish = (data?: Uint8Array<ArrayBuffer>, error?: number) => {
      const deliver = this.readbacks.delete(item);
      buffer.destroy(); // loss may already have completed the request, but the staging buffer still needs release
      if (deliver) item.readback?.(data, error);
    };
    void buffer.mapAsync(GPUMapMode.READ).then(() => {
      const mapped = new Uint8Array(buffer.getMappedRange()), out = new Uint8Array(row * height * depth);
      for (let i = 0; i < height * depth; i++) out.set(mapped.subarray(i * aligned, i * aligned + row), i * row);
      finish(out);
    }).catch(() => finish(undefined, E_IO));
  }

  private writeBuffer(buffer: GPUBuffer, offset: number, data: Uint8Array<ArrayBuffer>): void {
    const aligned = new Uint8Array(Math.ceil(data.length / 4) * 4); aligned.set(data);
    this.device.queue.writeBuffer(buffer, offset, aligned);
  }

  private pipeline(w: readonly number[], depthSlots: ReadonlySet<number> = new Set(),
    sampling: readonly DepthSampling[] = [], integerSamplers: ReadonlyMap<number, readonly number[]> = new Map()): PipelineResource {
    const d = this.device, buffers: GPUVertexBufferLayout[] = [], targets: GPUColorTargetState[] = [];
    const repack: Repack[] = [];
    let j = 26;
    for (let i = 0; i < w[23]; i++, j += 2)
      buffers.push({ arrayStride: w[j], stepMode: w[j + 1] ? 'instance' : 'vertex', attributes: [] });
    for (let i = 0; i < w[24]; i++, j += 4)
      (buffers[w[j + 1]].attributes as GPUVertexAttribute[]).push({ shaderLocation: w[j], offset: w[j + 2],
        format: vertexFormats[w[j + 3]] });
    // BGT permits byte-aligned UNORM8X4; WebGPU requires 4-byte alignment. Repack that slot at draw time.
    buffers.forEach((buffer, slot) => {
      const attrs = buffer.attributes as GPUVertexAttribute[];
      if (!attrs.some(a => a.offset % 4)) return;
      const sizes = [4, 8, 12, 16, 4, 4, 8, 12, 16, 4, 8, 12, 16];
      const attributes = attrs.map(a => ({ offset: a.offset, size: sizes[vertexFormats.indexOf(a.format)] }));
      repack.push({ slot, stride: buffer.arrayStride, attributes });
      let offset = 0;
      buffer.attributes = attrs.map((a, i) => {
        const result = { ...a, offset }; offset += attributes[i].size; return result;
      });
      buffer.arrayStride = offset;
    });
    const component = (src: number, dst: number, op: number): GPUBlendComponent => ({
      operation: blendOps[op], srcFactor: op >= 3 ? 'one' : factors[src], dstFactor: op >= 3 ? 'one' : factors[dst],
    });
    for (let i = 0; i < w[25]; i++, j += 9) {
      if (isIntegerFormat(w[j]) && w[j + 1]) throw new Error('Integer render targets cannot be blended');
      if (w[j] >= 10 && w[j] <= 12 && w[j + 1] && !d.features.has('float32-blendable')) {
        throw new Error('Blending 32-bit float targets needs the float32-blendable WebGPU feature');
      }
      targets.push({ format: formats[w[j]], writeMask: w[j + 8],
        blend: w[j + 1] ? { color: component(w[j + 2], w[j + 3], w[j + 4]),
          alpha: component(w[j + 5], w[j + 6], w[j + 7]) } : undefined });
    }
    const face = (i: number): GPUStencilFaceState => ({ compare: compare[w[i]], failOp: stencil[w[i + 1]],
      depthFailOp: stencil[w[i + 2]], passOp: stencil[w[i + 3]] });
    const depthStencil: GPUDepthStencilState | undefined = w[6] === 0xffffffff ? undefined : {
      format: formats[w[6]], depthWriteEnabled: !!w[8], depthCompare: w[7] ? compare[w[9]] : 'always',
      stencilFront: w[10] ? face(13) : {}, stencilBack: w[10] ? face(17) : {},
      stencilReadMask: w[10] ? w[11] : 255, stencilWriteMask: w[10] ? w[12] : 0,
    };
    const bindings = new Map<string, ShaderBinding>();
    for (const s of [w[1], w[2]]) for (const b of this.shaders.get(s)!.bindings) {
      const mask = b.group === 0 ? w[21] : w[22], slot = b.group === 0 ? b.binding : b.binding >> 1;
      if (!(mask & (1 << slot))) throw new Error(`Shader binding slot ${slot} absent from pipeline mask`);
      const key = `${b.group}:${b.binding}`, prev = bindings.get(key);
      const binding: ShaderBinding = b.type === 'texture' && depthSlots.has(slot) ? { ...b, type: 'depth' } : b;
      if (prev && prev.type !== binding.type) throw new Error(`Shader binding type conflict at ${key}`);
      bindings.set(key, binding);
    }
    for (const [key, b] of bindings) if (b.type === 'sampler' &&
      bindings.get(`1:${b.binding - 1}`)?.type === 'depth') bindings.set(key, { ...b, type: 'nonfiltering' });
    const layouts = [0, 1].map(group => d.createBindGroupLayout({ entries: [...bindings.values()]
      .filter(b => b.group === group).map(b => ({ binding: b.binding,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        ...(b.type === 'uniform' ? { buffer: { type: 'uniform' as const } } :
          b.type === 'texture' || b.type === 'textureI' || b.type === 'textureU' || b.type === 'depth' || b.type === 'texture3d' || b.type === 'texture2darray' ?
            { texture: { sampleType: b.type === 'depth' ? 'depth' as const : b.type === 'textureI' ? 'sint' as const : b.type === 'textureU' ? 'uint' as const : 'float' as const,
              viewDimension: b.type === 'texture3d' ? '3d' as const :
                b.type === 'texture2darray' ? '2d-array' as const : '2d' as const } } :
            { sampler: { type: b.type === 'comparison' ? 'comparison' as const :
              b.type === 'nonfiltering' ? 'non-filtering' as const : 'filtering' as const } }),
      })) }));
    d.pushErrorScope('validation');
    const vs = this.shaders.get(w[1])!, fs = this.shaders.get(w[2])!;
    const varyingNames = [...new Set([
      ...glslVaryings(vs.item.source!, 1), ...glslVaryings(fs.item.source!, 2),
    ])].sort();
    const linked = (s: ShaderResource) => {
      if (!s.item.words[2] && !sampling.length) return s.native;
      const source = s.item.words[2] ?
        translateGLSL(s.item.source!, s.item.words[1], s.item.words[2], varyingNames, depthSlots, integerSamplers) : s.item.source!;
      return d.createShaderModule({ code: lowerDepthSampling(source, sampling) });
    };
    const native = d.createRenderPipeline({ layout: d.createPipelineLayout({ bindGroupLayouts: layouts }),
      vertex: { module: linked(vs), entryPoint: 'vs_main', buffers },
      fragment: { module: linked(fs), entryPoint: 'fs_main', targets }, depthStencil,
      primitive: { topology: w[3] === 0 ? 'point-list' : w[3] <= 2 ? 'line-list' : 'triangle-list',
        cullMode: (['none', 'front', 'back'] as const)[w[4]], frontFace: w[5] ? 'cw' : 'ccw' } });
    const validation = d.popErrorScope().catch(e => new GPUValidationError(String(e)));
    void validation.then(e => { if (e) this.error(`GPU pipeline ${w[0]}: ${e.message}`); });
    return { native, words: w, bindings: [...bindings.values()], repack, variants: new Map(), validation };
  }

  private bind(): void {
    let p = this.current!;
    const d = this.device;
    // GLSL sampler2D may sample color or non-comparison depth. Specialize depth sampling by immutable sampler.
    const depthSlots = new Set(p.bindings.filter(b => (b.type === 'texture' || b.type === 'depth') && b.group === 1)
      .map(b => b.binding >> 1).filter(slot => isDepthFormat(this.textures.get(this.sampled.get(slot)![1])!.desc.format)));
    const glsl = !!this.shaders.get(p.words[1])!.item.words[2];
    const sampling = glsl ? [...depthSlots].filter(slot => p.bindings.some(b => b.binding === slot * 2 + 1 &&
      b.group === 1 && b.type !== 'comparison')).map(slot => ({ binding: slot * 2,
      sampler: this.samplers.get(this.sampled.get(slot)![2])!.words })) : [];
    const integerSamplers = new Map(p.bindings.filter(b => b.type === 'textureI' || b.type === 'textureU')
      .map(b => [b.binding >> 1, this.samplers.get(this.sampled.get(b.binding >> 1)![2])!.words] as const));
    if (sampling.length || (glsl && (depthSlots.size || integerSamplers.size))) {
      const key = JSON.stringify([[...depthSlots], sampling, [...integerSamplers]]);
      let variant = p.variants.get(key);
      if (!variant) {
        variant = this.pipeline(p.words, depthSlots, sampling, integerSamplers);
        if (p.variants.size >= 64) p.variants.delete(p.variants.keys().next().value!);
        p.variants.set(key, variant);
      }
      p = variant;
    }
    this.pass!.setPipeline(p.native);
    for (let slot = 0; slot < p.words[23]; slot++) {
      const w = this.vertices.get(slot)!, b = this.buffers.get(w[1])!;
      const r = p.repack.find(r => r.slot === slot);
      if (!r) { this.pass!.setVertexBuffer(slot, b.native, w[2], w[3]); continue; }
      const stride = r.attributes.reduce((n, a) => n + a.size, 0), count = Math.ceil(w[3] / r.stride);
      const bytes = new Uint8Array(count * stride);
      for (let i = 0; i < count; i++) {
        let offset = i * stride;
        for (const a of r.attributes) {
          const source = w[2] + i * r.stride + a.offset;
          bytes.set(b.shadow.subarray(source, Math.min(source + a.size, w[2] + w[3])), offset);
          offset += a.size;
        }
      }
      const native = d.createBuffer({ size: bytes.length, usage: GPUBufferUsage.VERTEX, mappedAtCreation: true });
      new Uint8Array(native.getMappedRange()).set(bytes); native.unmap(); this.scratch.push(native);
      this.pass!.setVertexBuffer(slot, native);
    }
    const uniforms: GPUBindGroupEntry[] = [], textures: GPUBindGroupEntry[] = [];
    for (const b of p.bindings) {
      if (b.group === 0) uniforms.push({ binding: b.binding, resource: this.uniforms.get(b.binding)! });
      else {
        const w = this.sampled.get(b.binding >> 1)!, t = this.textures.get(w[1])!;
        const sampler = this.samplers.get(w[2])!;
        if (b.type === 'nonfiltering') sampler.nonfilter ??= d.createSampler();
        textures.push({ binding: b.binding, resource: b.binding % 2 ?
          (b.type === 'nonfiltering' ? sampler.nonfilter! : sampler.native) :
          t.native.createView({ aspect: isDepthFormat(t.desc.format) ? 'depth-only' : 'all',
            dimension: t.desc.dimension === 1 ? '3d' : t.desc.dimension === 2 ? '2d-array' : '2d' }) });
      }
    }
    // Explicit layouts include only declared bindings, not extra bound guest slots.
    for (const [group, entries] of [[0, uniforms], [1, textures]] as const) if (entries.length)
      this.pass!.setBindGroup(group, d.createBindGroup({ layout: p.native.getBindGroupLayout(group), entries }));
  }

  private strip(item: GpuItem): void {
    // Expand strips to lists: native indexed strips reserve all-ones as restart; BGT explicitly does not.
    const w = item.words, triangle = this.current!.words[3] === 4, result: number[] = [];
    const indexed = item.op === OP.DRAW_INDEXED, b = indexed ? this.buffers.get(this.index![0])! : undefined;
    const view = b ? new DataView(b.shadow.buffer) : undefined, size = this.index?.[1] ? 4 : 2;
    const at = (i: number) => !view ? w[2] + i : size === 4 ?
      view.getUint32(this.index![2] + (w[2] + i) * size, true) :
      view.getUint16(this.index![2] + (w[2] + i) * size, true);
    for (let i = 0; i < w[0] - (triangle ? 2 : 1); i++) {
      if (triangle) result.push(at(i + (i % 2)), at(i + 1 - (i % 2)), at(i + 2));
      else result.push(at(i), at(i + 1));
    }
    if (!result.length) return;
    const native = this.device.createBuffer({ size: result.length * 4, usage: GPUBufferUsage.INDEX,
      mappedAtCreation: true });
    new Uint32Array(native.getMappedRange()).set(result); native.unmap(); this.scratch.push(native);
    this.pass!.setIndexBuffer(native, 'uint32');
    this.pass!.drawIndexed(result.length, w[1], 0, indexed ? w[3] | 0 : 0, indexed ? w[4] : w[3]);
    if (this.index) this.pass!.setIndexBuffer(this.buffers.get(this.index[0])!.native,
      this.index[1] ? 'uint32' : 'uint16', this.index[2], this.index[3]);
  }
}
