import { resolve } from 'node:path';
import { test, expect, openGame, assertBackend } from './fixtures';

// Regression: restoring generated textures used to regenerate AFTER explicit mip uploads, clobbering them.
// A partial upload also needs the generated upload-shadow bytes around it, not stale zeros.
test('§13.7 recovery preserves explicit mip levels and post-generation partial/base uploads',
  async ({ page, backendParam, collector }, info) => {
    void collector;
    await openGame(page, backendParam);
    await assertBackend(page, backendParam, info);
    const result = await page.evaluate(async ({ backend, root }) => {
      const { GPU_OP: O } = await import(/* @vite-ignore */ `${root}/runtime/abi.ts`);
      const errors: string[] = [];
      const canvas = document.createElement('canvas');
      const gl = backend === 'webgpu' ? undefined : canvas.getContext('webgl2')!;
      const adapter = backend === 'webgpu' ? await navigator.gpu.requestAdapter() : undefined;
      const device = adapter ? await adapter.requestDevice({ requiredFeatures:
        ['float32-filterable', 'float32-blendable'].filter(f => adapter.features.has(f as GPUFeatureName)) as GPUFeatureName[] }) : undefined;
      device?.addEventListener('uncapturederror', e => errors.push(e.error.message));
      const module = `${root}/renderers/${backend === 'webgpu' ? 'webgpu' : 'webgl2'}/gpu.ts`;
      const constructors = await import(/* @vite-ignore */ module);
      const gpu = device ? new constructors.WebGPUCommands(device, (s: string) => errors.push(s)) :
        new constructors.WebGL2Gpu(gl, (s: string) => errors.push(s));
      const run = (op: number, words: number[], data?: Uint8Array) => {
        const code = gpu.execute({ kind: 'gpu', op, words, data });
        if (code) throw new Error(errors.join('\n') || `opcode ${op}: ${code}`);
      };
      const red = [255, 0, 0, 255], green = [0, 255, 0, 255], blue = [0, 0, 255, 255], white = [255, 255, 255, 255];
      const fill = (pixel: number[], count: number) => new Uint8Array(Array.from({ length: count }, () => pixel).flat());
      const upload = (handle: number, mip: number, size: number, data: Uint8Array) =>
        run(O.TEXTURE_UPDATE_EX, [handle, mip, 0, 0, 0, size, size, 1, 0, data.length], data);
      for (const h of [1, 2]) {
        run(O.TEXTURE_CREATE_EX, [h, 0, 4, 4, 1, 3, 0, 1]);
        upload(h, 0, 4, fill(red, 16)); run(O.TEXTURE_GENERATE_MIPS, [h, 0]);
      }
      upload(1, 1, 2, fill(green, 4)); upload(1, 0, 4, fill(blue, 16));
      upload(2, 1, 1, fill(white, 1)); // the other three texels must stay red
      const read = (h: number, mip: number, size: number) => new Promise<number[]>((resolve, reject) => {
        const code = gpu.execute({ kind: 'gpu', op: O.TEXTURE_READBACK,
          words: [h, mip, 0, 0, 0, size, size, 1, 1],
          readback: (bytes: Uint8Array | undefined, status = 0) => status || !bytes ?
            reject(new Error(`readback ${status}`)) : resolve([...bytes]) });
        if (code) reject(new Error(`readback opcode ${code}`));
      });
      const capture = async () => [await read(1, 0, 4), await read(1, 1, 2), await read(1, 2, 1),
        await read(2, 1, 2), await read(2, 2, 1)];
      // Every additive storage format, all three dimensions: exact uploaded bytes survive readback and restore.
      // Float32 is capability-gated in the ABI; exercise it when this real adapter can advertise it.
      const bpp = [4, 2, 4, 4, 8, 16], formats: Array<{ h: number; words: number[]; bytes: number[] }> = [];
      for (let format = 7; format <= 12; format++) {
        if (device && format >= 10 && !device.features.has('float32-filterable')) continue;
        for (let dim = 0; dim < 3; dim++) {
          const h = 10 + (format - 7) * 3 + dim, depth = dim ? 2 : 1, bytes = bpp[format - 7];
          run(O.TEXTURE_CREATE_EX, [h, dim, 2, 1, depth, 1, format, 1]);
          const count = 2 * depth;
          const texel = format === 7 ? new Uint8Array(new Uint32Array([0xc00803ff]).buffer) :
            format <= 9 ? new Uint8Array(new Uint16Array(Array.from({ length: bytes / 2 }, () => 0x3e00)).buffer) :
              new Uint8Array(new Float32Array(Array.from({ length: bytes / 4 }, () => 1.5)).buffer);
          const data = new Uint8Array(count * bytes); for (let i = 0; i < count; i++) data.set(texel, i * bytes);
          run(O.TEXTURE_UPDATE_EX, [h, 0, 0, 0, 0, 2, 1, depth, 0, data.length], data);
          const words = [h, 0, 0, 0, 0, 2, 1, depth, 1];
          formats.push({ h, words, bytes: [...data] });
        }
      }
      const readFormats = async () => {
        for (const f of formats) {
          const bytes = await new Promise<number[]>((resolve, reject) => {
            const rc = gpu.execute({ kind: 'gpu', op: O.TEXTURE_READBACK, words: f.words,
              readback: (data: Uint8Array | undefined, code = 0) => data && !code ? resolve([...data]) :
                reject(new Error(`format readback ${code}`)) });
            if (rc) reject(new Error(`format opcode ${rc}`));
          });
          if (JSON.stringify(bytes) !== JSON.stringify(f.bytes)) errors.push(`format round trip handle ${f.h}`);
        }
      };
      await readFormats();
      const before = await capture();
      if (device) { gpu.lost(); await gpu.restore(device); }
      else gpu.restore();
      const after = await capture(); await readFormats();
      // Loss/error paths must finish readback requests too, never leave them pending forever.
      let failed: number | undefined;
      if (device) gpu.lost();
      else {
        const lost = new Promise<void>(resolve => canvas.addEventListener('webglcontextlost', e => {
          e.preventDefault(); resolve();
        }, { once: true }));
        gl!.getExtension('WEBGL_lose_context')!.loseContext(); await lost;
      }
      const lostCode = gpu.execute({ kind: 'gpu', op: O.TEXTURE_READBACK,
        words: [1, 0, 0, 0, 0, 1, 1, 1, 1], readback: (_bytes: unknown, status: number) => { failed = status; } });
      device?.destroy();
      return { before, after, errors, lostCode, failed, formatCases: formats.length };
    }, { backend: backendParam, root: `/@fs${resolve('bgt')}` });
    const repeat = (p: number[], n: number) => Array.from({ length: n }, () => p).flat();
    const red = [255, 0, 0, 255];
    const expected = [repeat([0, 0, 255, 255], 16), repeat([0, 255, 0, 255], 4), red,
      [255, 255, 255, 255, ...repeat(red, 3)], red];
    expect(result.errors).toEqual([]);
    expect(result.before).toEqual(expected); expect(result.after).toEqual(expected);
    expect(result.lostCode).toBe(-6); expect(result.failed).toBe(-6);
    expect(result.formatCases).toBeGreaterThanOrEqual(9);
    console.log('GPU texture extension round trips', backendParam, result.formatCases);
  });
