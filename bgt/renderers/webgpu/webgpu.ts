// WebGPU backend (preferred). Consumes the shared decoded Frame.

import { BLEND_ADD, BLEND_ALPHA, BLEND_OPAQUE, BLEND_PREMULTIPLIED, FILTER_LINEAR } from '../../runtime/abi';
import type { Frame, TextureTable } from '../../runtime/commands';
import { GpuStats, Letterbox, Pixels, Renderer, WHITE_PIXEL, clipToDevice } from '../types';

const SHADER = /* wgsl */ `
struct U { size: vec2f, pad: vec2f };
@group(0) @binding(0) var<uniform> u: U;
@group(1) @binding(0) var tex: texture_2d<f32>;
@group(1) @binding(1) var samp: sampler;
struct VO {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) col: vec4f,
};
@vertex fn vs(@location(0) p: vec2f, @location(1) uv: vec2f, @location(2) c: vec4f) -> VO {
  var o: VO;
  o.pos = vec4f(p.x / u.size.x * 2.0 - 1.0, 1.0 - p.y / u.size.y * 2.0, 0.0, 1.0);
  o.uv = uv;
  o.col = c;
  return o;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  return textureSample(tex, samp, i.uv) * i.col;
}`;

function blendState(mode: number): GPUBlendState | undefined {
  switch (mode) {
    case BLEND_OPAQUE:
      return undefined;
    case BLEND_ALPHA:
      return {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      };
    case BLEND_ADD:
      return {
        color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
        alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
      };
    case BLEND_PREMULTIPLIED:
      return {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      };
  }
  return undefined;
}

export interface WebGPUOptions {
  debug?: boolean;
}

interface DeviceObjects {
  device: GPUDevice;
  pipelines: GPURenderPipeline[];
  texLayout: GPUBindGroupLayout;
  uniform: GPUBuffer;
  uniformGroup: GPUBindGroup;
  samplers: GPUSampler[];
  white: GPUTexture;
  vbuf: GPUBuffer | null;
  vbufSize: number;
}

export class WebGPURenderer implements Renderer {
  readonly kind = 'webgpu' as const;
  readonly stats: GpuStats = { drawCalls: 0, passes: 0, vertexBytes: 0, submitMs: 0 };
  lost = false;
  maxTextureSize = 4096;
  private o!: DeviceObjects;
  private textures = new Map<number, GPUTexture>();
  private bindGroups = new Map<string, GPUBindGroup>();
  private lostCbs: Array<(r: string) => void> = [];
  private restoredCbs: Array<() => void> = [];
  private errorCbs: Array<(m: string) => void> = [];
  private destroyed = false;

  private constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly ctx: GPUCanvasContext,
    private readonly adapter: GPUAdapter,
    private readonly format: GPUTextureFormat,
    readonly opts: WebGPUOptions,
  ) {}

  /** Returns null when WebGPU is unavailable; throws on unexpected init failures. */
  static async create(canvas: HTMLCanvasElement, opts: WebGPUOptions = {}): Promise<WebGPURenderer | null> {
    if (typeof navigator === 'undefined' || !navigator.gpu) return null;
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return null;
    const ctx = canvas.getContext('webgpu');
    if (!ctx) return null;
    const r = new WebGPURenderer(canvas, ctx, adapter, navigator.gpu.getPreferredCanvasFormat(), opts);
    await r.initDevice(adapter);
    return r;
  }

  private async initDevice(adapter: GPUAdapter): Promise<void> {
    const device = await adapter.requestDevice();
    this.maxTextureSize = device.limits.maxTextureDimension2D;
    this.ctx.configure({
      device,
      format: this.format,
      alphaMode: 'opaque',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    device.addEventListener('uncapturederror', (ev) => {
      const msg = (ev as GPUUncapturedErrorEvent).error.message;
      for (const cb of this.errorCbs) cb(`WebGPU: ${msg}`);
    });
    void device.lost.then((info) => this.handleLost(info));

    const module = device.createShaderModule({ code: SHADER });
    const uLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
    });
    const texLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [uLayout, texLayout] });
    const pipelines = [0, 1, 2, 3].map((mode) =>
      device.createRenderPipeline({
        layout,
        vertex: {
          module,
          entryPoint: 'vs',
          buffers: [
            {
              arrayStride: 20,
              attributes: [
                { shaderLocation: 0, offset: 0, format: 'float32x2' },
                { shaderLocation: 1, offset: 8, format: 'float32x2' },
                { shaderLocation: 2, offset: 16, format: 'unorm8x4' },
              ],
            },
          ],
        },
        fragment: { module, entryPoint: 'fs', targets: [{ format: this.format, blend: blendState(mode) }] },
        primitive: { topology: 'triangle-list' },
      }),
    );
    const uniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const uniformGroup = device.createBindGroup({ layout: uLayout, entries: [{ binding: 0, resource: { buffer: uniform } }] });
    const samplers = (['nearest', 'linear'] as const).map((f) =>
      device.createSampler({ magFilter: f, minFilter: f, addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' }),
    );
    const white = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: white }, WHITE_PIXEL, { bytesPerRow: 4 }, [1, 1]);
    this.o = { device, pipelines, texLayout, uniform, uniformGroup, samplers, white, vbuf: null, vbufSize: 0 };
    this.textures.clear();
    this.bindGroups.clear();
  }

  private async handleLost(info: GPUDeviceLostInfo): Promise<void> {
    if (this.destroyed) return;
    this.lost = true;
    for (const cb of this.lostCbs) cb(`webgpu device lost (${info.reason}): ${info.message}`);
    try {
      // A lost adapter cannot hand out new devices; request a fresh one.
      const adapter = (await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })) ?? this.adapter;
      await this.initDevice(adapter);
      this.lost = false;
      for (const cb of this.restoredCbs) cb();
    } catch (e) {
      for (const cb of this.errorCbs) cb(`WebGPU device recovery failed: ${(e as Error).message}`);
    }
  }

  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
  }

  private bindGroup(handle: number, filter: number): GPUBindGroup {
    const key = `${handle}:${filter}`;
    let bg = this.bindGroups.get(key);
    if (!bg) {
      const tex = handle === 0 ? this.o.white : (this.textures.get(handle) ?? this.o.white);
      bg = this.o.device.createBindGroup({
        layout: this.o.texLayout,
        entries: [
          { binding: 0, resource: tex.createView() },
          { binding: 1, resource: this.o.samplers[filter === FILTER_LINEAR ? 1 : 0] },
        ],
      });
      this.bindGroups.set(key, bg);
    }
    return bg;
  }

  private dropBindGroups(handle: number): void {
    this.bindGroups.delete(`${handle}:0`);
    this.bindGroups.delete(`${handle}:1`);
  }

  private createTex(handle: number, w: number, h: number): GPUTexture {
    this.textures.get(handle)?.destroy();
    const t = this.o.device.createTexture({
      size: [w, h],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    this.textures.set(handle, t);
    this.dropBindGroups(handle);
    return t;
  }

  drawFrame(frame: Frame, lb: Letterbox, readback: boolean): Promise<Pixels | null> | null {
    if (this.lost) return null;
    const t0 = performance.now();
    const { device } = this.o;
    const q = device.queue;
    this.stats.drawCalls = 0;
    this.stats.passes = 0;

    q.writeBuffer(this.o.uniform, 0, new Float32Array([frame.logicalW, frame.logicalH, 0, 0]));
    const bytes = frame.vertexBytes();
    this.stats.vertexBytes = bytes.byteLength;
    if (bytes.byteLength > this.o.vbufSize) {
      this.o.vbuf?.destroy();
      let size = Math.max(1 << 20, this.o.vbufSize);
      while (size < bytes.byteLength) size *= 2;
      this.o.vbuf = device.createBuffer({ size, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      this.o.vbufSize = size;
    }
    if (bytes.byteLength) q.writeBuffer(this.o.vbuf!, 0, bytes);

    const target = this.ctx.getCurrentTexture();
    const view = target.createView();
    let encoder: GPUCommandEncoder | null = null;
    let pass: GPURenderPassEncoder | null = null;
    let first = true;
    const W = this.canvas.width;
    const H = this.canvas.height;

    const open = () => {
      encoder = device.createCommandEncoder();
      pass = encoder.beginRenderPass({
        colorAttachments: [
          { view, loadOp: first ? 'clear' : 'load', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } },
        ],
      });
      first = false;
      this.stats.passes++;
      pass.setViewport(lb.x, lb.y, lb.w, lb.h, 0, 1);
      if (this.o.vbuf) pass.setVertexBuffer(0, this.o.vbuf);
      pass.setBindGroup(0, this.o.uniformGroup);
    };
    const close = () => {
      if (!pass || !encoder) return;
      (pass as GPURenderPassEncoder).end();
      q.submit([(encoder as GPUCommandEncoder).finish()]);
      pass = null;
      encoder = null;
    };

    for (const it of frame.items) {
      switch (it.kind) {
        case 'texCreate':
          close();
          this.createTex(it.handle, it.width, it.height);
          break;
        case 'texUpdate': {
          close();
          const t = this.textures.get(it.handle);
          if (t) q.writeTexture({ texture: t, origin: { x: it.x, y: it.y } }, it.data, { bytesPerRow: it.w * 4, rowsPerImage: it.h }, [it.w, it.h]);
          break;
        }
        case 'texDelete':
          close();
          this.textures.get(it.handle)?.destroy();
          this.textures.delete(it.handle);
          this.dropBindGroups(it.handle);
          break;
        case 'draw': {
          const r = clipToDevice(it.clip, lb, frame.logicalW, frame.logicalH);
          const x = Math.max(0, r.x), y = Math.max(0, r.y);
          const w = Math.min(W, r.x + r.w) - x, h = Math.min(H, r.y + r.h) - y;
          if (w <= 0 || h <= 0) break;
          if (!pass) open();
          const p = pass as unknown as GPURenderPassEncoder;
          p.setScissorRect(x, y, w, h);
          p.setPipeline(this.o.pipelines[it.blend] ?? this.o.pipelines[BLEND_ALPHA]);
          p.setBindGroup(1, this.bindGroup(it.texture, it.filter));
          p.draw(it.count, 1, it.first, 0);
          this.stats.drawCalls++;
          break;
        }
      }
    }
    if (first) open(); // no draws: still clear the canvas
    close();

    let pending: Promise<Pixels> | null = null;
    if (readback) pending = this.readback(target);
    this.stats.submitMs = performance.now() - t0;
    return pending;
  }

  private async readback(tex: GPUTexture): Promise<Pixels> {
    const { device } = this.o;
    const w = tex.width, h = tex.height;
    const bpr = Math.ceil((w * 4) / 256) * 256;
    const buf = device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: bpr }, [w, h]);
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange());
    const data = new Uint8Array(w * h * 4);
    const bgra = this.format === 'bgra8unorm';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = y * bpr + x * 4, d = (y * w + x) * 4;
        data[d] = src[s + (bgra ? 2 : 0)];
        data[d + 1] = src[s + 1];
        data[d + 2] = src[s + (bgra ? 0 : 2)];
        data[d + 3] = 255;
      }
    }
    buf.unmap();
    buf.destroy();
    return { width: w, height: h, data };
  }

  async finish(): Promise<void> {
    if (!this.lost) await this.o.device.queue.onSubmittedWorkDone();
  }

  restoreTextures(textures: TextureTable): void {
    for (const [handle, e] of textures.entries) {
      const t = this.createTex(handle, e.width, e.height);
      this.o.device.queue.writeTexture({ texture: t }, e.shadow, { bytesPerRow: e.width * 4, rowsPerImage: e.height }, [e.width, e.height]);
    }
  }

  async simulateLoss(): Promise<void> {
    const restored = new Promise<void>((resolve) => this.restoredCbs.push(() => resolve()));
    this.o.device.destroy();
    await restored;
  }

  onLost(cb: (reason: string) => void): void {
    this.lostCbs.push(cb);
  }
  onRestored(cb: () => void): void {
    this.restoredCbs.push(cb);
  }
  onError(cb: (message: string) => void): void {
    this.errorCbs.push(cb);
  }

  destroy(): void {
    this.destroyed = true;
    this.o?.device.destroy();
  }
}
