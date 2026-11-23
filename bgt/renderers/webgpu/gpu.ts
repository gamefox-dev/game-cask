// §13 executor. The decoder owns validation; this class owns native resources and recovery shadows.
import { E_IO, GPU_LIMITS, GPU_OP as OP } from '../../runtime/abi';
import { textureLevelBytes, type GpuNativeMemory } from '../../runtime/memory';
import { softwareRenderer, type GpuBackend, type GpuDeviceInfo, type GpuItem } from '../types';
import { glslVaryingDecls, glslVaryings, linkedVaryings, packVaryings, shaderBindings, translateGLSL, validateWGSL, type ShaderBinding } from './shaders';
import { clampViewport, ViewTransforms } from './view';
import { RotatedIndexRing, RotatedSequences, rotateList } from './provoking';
import { lowerDepthSampling, type DepthSampling } from './depth';
import { fragmentOutputs } from './outputs';
import { WebGPUBufferCopy } from './buffer-copy';
import { WebGPUOpaqueScreen } from './screen';
import { WebGPUBlit, type BlitImage } from './blit';
import { lowerFeedback, type FeedbackInput } from './feedback';
import { feedbackLayout, feedbackVertexCount, type FeedbackLayout } from '../../runtime/feedback';
import { WebGPUTiming } from './timing';
import { RECOVERY_SHADOWS_OFF, TEXEL_BYTES, canonicalize, downsampleBox, generatedMipShadows, isDepthFormat, isIntegerFormat, mipExtent, toCanonicalTexture, type CanonicalTexture }
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
/** `serial` (K62, vK62): unique per store for this executor's life, so a reused handle never matches an old store. */
interface BufferResource { native: GPUBuffer; words: readonly number[]; shadow: Uint8Array<ArrayBuffer>; generated?: boolean; version?: number; serial: number }
/** K71 (Q128): a §13 texture whose GPUTexture is created on first use (`native`), as drivers commit memory on first
 * use. Until then every level holds its creation value (color 0, depth 1, stencil 0); `live` is undefined. */
class TextureResource {
  live?: GPUTexture; uploads: GpuItem[] = [];
  /** `source` absent (K64): 2D/array levels generated from a never-uploaded (zero) base restore as zeros. */
  generated?: { base: number; source?: GpuItem; overridden: Set<number> };
  /** K71 (Q129): uploaded contents not kept in `uploads` because recovery shadows are disabled; restore refuses. */
  unshadowed?: boolean;
  /** K71: per-level values set by a clear-only pass before the texture existed (applied by materialize()). */
  constants?: ({ color?: number[]; depth?: number; stencil?: number } | undefined)[];
  constructor(readonly words: readonly number[], readonly desc: CanonicalTexture, public allocatedMips: number,
    private readonly create: (t: TextureResource) => GPUTexture) {}
  /** The native texture; reading it materializes storage (upload, attachment, sampling, copy, readback). */
  get native(): GPUTexture { return this.live ??= this.create(this); }
  set native(texture: GPUTexture) { this.live = texture; }
}
interface ShaderResource { native: GPUShaderModule; item: GpuItem; done: boolean; bindings: ShaderBinding[]; outputs: ReadonlySet<number> }
/** K67 recycle pool: 32 MiB cap; entries unused for 600 flushes (~10 s at 60 Hz) are released. */
const POOL_CAP = 32 << 20, POOL_AGE = 600;
/** Pool size classes: 256 B minimum, then four steps per power of two (at most 25 % slack), 256-byte multiples. */
export function sizeClass(n: number): number {
  if (n <= 256) return 256;
  const p = 2 ** Math.floor(Math.log2(n - 1)), step = Math.max(256, p / 4);
  return Math.ceil(n / step) * step;
}
interface Repack { slot: number; stride: number; attributes: { offset: number; size: number }[] }
/** K60 (Q117): a translated transform-feedback capture. `code` is the vertex stage translated for one sampler
 * specialization; `pipelines` holds the compute pipelines lowered from it per draw shape (inputs, counts). */
interface CaptureProgram {
  shader: ShaderResource; code: string; bindings: ShaderBinding[]; pipelines: Map<string, GPUComputePipeline>;
}
interface PipelineResource {
  native: GPURenderPipeline; words: readonly number[]; bindings: ShaderBinding[]; repack: Repack[];
  variants: Map<string, PipelineResource>; validation: Promise<GPUError | null>; failure?: string;
  /** K60: capture translations of this pipeline (dropped with it: PIPELINE_DELETE/re-create, FEEDBACK_VARYINGS). */
  captures?: Map<string, CaptureProgram>;
  /** K62: GLSL vertex stage with the group-2 view transform (empty groups 0/1 are then bound explicitly). */
  view?: boolean; empty?: GPUBindGroup[];
  /** K62: GLSL fragment stage with flat inputs: lines/triangles are drawn last-vertex-first (GL convention). */
  flat?: boolean;
}

export class WebGPUCommands implements GpuBackend {
  readonly languages = 7;
  readonly bufferHandles = true;
  private bufferCopy?: WebGPUBufferCopy;
  readonly buffers = new Map<number, BufferResource>();
  readonly textures = new Map<number, TextureResource>();
  private samplers = new Map<number, { native: GPUSampler; nonfilter?: GPUSampler; words: readonly number[] }>();
  private shaders = new Map<number, ShaderResource>();
  private pipelines = new Map<number, PipelineResource>();
  private failedPipelines = new Map<number, string>();
  private encoder?: GPUCommandEncoder;
  private pass?: GPURenderPassEncoder;
  private passFormats: number[] = [];
  private passDepth = 0xffffffff;
  private passSize = [1, 1];
  private viewport = [0, 0, 1, 1, 0, 1];
  private stencilRef = 0;
  private clearPipelines = new Map<string, GPURenderPipeline>();
  private screen?: GPUTexture;
  private screenPass = false;
  private opaqueScreen?: WebGPUOpaqueScreen;
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
  private framebufferBlit?: WebGPUBlit;
  private feedback = new Map<number, FeedbackLayout>();
  private feedbackPipelines = new Map<string,GPUComputePipeline>();
  private capture?: readonly number[];
  private passDescriptor?: GPURenderPassDescriptor;
  private scissor = [0,0,1,1];
  /** K62: clamped native viewport state (see view.ts). */
  private views?: ViewTransforms;
  private viewOffset = 0;
  private viewEmpty = false;
  private viewIdentity = true;
  private rotations?: RotatedSequences;
  /** K62: rotated index copies (indexed flat draws); exposed for tests. */
  rotatedIndices?: RotatedIndexRing;
  private bufferSerial = 0;
  private blendConstant = [0,0,0,0];
  /** K53 frame batching: one command encoder spans the frame's passes and is submitted at a sync point
   * (frame end, readback/blit/copy/mip generation, or a queue write to a resource the encoder uses).
   * A non-screen native pass outlives its logical PASS_END; the next PASS_BEGIN on identical
   * attachments with LOAD ops continues it, so stored pixels are those of the split pass sequence. */
  private lingering = false;
  private passKey = '';
  private used = new Set<GPUBuffer | GPUTexture>();
  /** K60: byte ranges of each buffer that commands of the pending encoder read or write. A queue write to a
   * range no earlier command of the frame touches goes straight to the native buffer (no copy-on-write). */
  private usedRanges = new Map<GPUBuffer, number[]>();
  private retiredDestroy: Array<GPUBuffer | GPUTexture> = [];
  private retiredPool: GPUBuffer[] = [];
  /** Recycled buffers by `usage:size class` (rename targets, K67: transform-feedback capture temporaries), each with
   * the flush count at which it was recycled; LIFO reuse, oldest-first eviction above POOL_CAP or after POOL_AGE flushes. */
  private pool = new Map<string, { b: GPUBuffer; at: number }[]>();
  private poolBytes = 0;
  private flushes = 0;
  /** K67: bytes held by the recycle pool (reported as lastFrame.poolBytes; not guest-visible memory). */
  get pooledBytes(): number { return this.poolBytes; }
  private ids = new WeakMap<GPUTexture, number>();
  private nextId = 1;
  /** Per-frame native work census (reset by the renderer at frame start). */
  readonly batch = { nativePasses: 0, mergedPasses: 0, bufferRenames: 0, splits: 0, encoderSubmits: 0, renameBytes: 0,
    captureTranslations: 0, captureLowerings: 0, commandBuffers: 0 };
  timing?: WebGPUTiming;
  /** True (set by WebGPURenderer): frame encoder + pass merging; the frame loop must call flush() at its sync
   * points. False (standalone executors, gpubatch=0): every native pass is submitted at its PASS_END. */
  merge = false;

  /** K51: min(65536, device maxUniformBufferBindingSize). WebGPU's default (and minimum) limit is 65536. */
  readonly maxUniformRange: number;
  /** K62: user varying components every GLSL program of that size links with (§13.6 offset 76). */
  readonly maxVaryingComponents: number;
  readonly glRaster = true;
  readonly constAttrib = true;
  readonly device: GpuDeviceInfo;
  /** K71 (Q129): keep CPU copies of uploaded texture levels for device-loss recovery (default). When false, no
   * texture shadow is kept and a loss after any texture upload is unrecoverable (restore() throws). */
  recoveryShadows = true;
  /** K71 (Q128): textures materialized lazily since creation (diagnostics; cumulative for this executor). */
  readonly lazyTextures = { materialized: 0, deferredPasses: 0 };
  /** K71: PASS_BEGIN words of an open pass whose attachments all lack storage; realized by any in-pass op. */
  private virtualPass?: number[];
  constructor(private gpuDevice: GPUDevice, private error: (message: string) => void, adapter: string | null = null,
    private readonly opts: { lazyTextures?: boolean } = {}) {
    // Every GPUDevice has limits; 65536 is WebGPU's guaranteed default (test doubles may omit limits).
    const native = gpuDevice.limits?.maxUniformBufferBindingSize ?? GPU_LIMITS.uniformRange;
    this.maxUniformRange = Math.min(GPU_LIMITS.uniformRange, native - native % 16);
    // K62: packed varyings (shaders.ts packVaryings) need at most ceil(N/4) + 2 locations for N components; vK62:
    // every translated fragment stage reads @builtin(front_facing), which (like a point-list topology, not both)
    // costs one inter-stage location (measured: 28 -> 27 on M4), so 4 x (L - 1) - 6.
    this.maxVaryingComponents = 4 * ((gpuDevice.limits?.maxInterStageShaderVariables ?? 16) - 1) - 6;
    this.device = { renderer: adapter, software: softwareRenderer(adapter), nativeMaxUniformRange: native };
  }

  get hasResources(): boolean {
    return !!(this.buffers.size || this.textures.size || this.samplers.size || this.shaders.size ||
      this.failedShaders.size || this.pipelines.size || this.failedPipelines.size);
  }

  frame(screen: GPUTexture): void {
    this.screen = screen;
    this.batch.nativePasses = this.batch.mergedPasses = this.batch.bufferRenames = this.batch.splits = this.batch.encoderSubmits = 0;
    this.batch.renameBytes = this.batch.captureTranslations = this.batch.captureLowerings = 0;
    this.batch.commandBuffers = 0;
  }

  /** End the native pass (screen passes store opaque alpha) and submit the pending frame encoder.
   * `tail` records the renderer's frame-end work (presentation, snapshot copy) into a second, short command
   * buffer of the same GPUQueue.submit, so a batched frame still costs one submit.
   * K67 (Q116): in a §13 screen frame only that tail uses the canvas texture. WebKit paces a WebGPU canvas from the GPU execution
   * window (GPUEndTime - GPUStartTime) of the command buffers that use the canvas texture (WebGPUFramePacer).
   * With the presentation inside the merged frame's command buffer, a long window plus a few backed-up presents
   * stepped requestAnimationFrame down the display's divisor ladder (85 Hz display: 85 -> 17 -> 5 Hz) and, as
   * every later frame reported the same long window, held it there. */
  flush(tail?: (encoder: GPUCommandEncoder) => void): void {
    this.endNative();
    const buffers: GPUCommandBuffer[] = [];
    if (this.encoder) { buffers.push(this.encoder.finish()); this.encoder = undefined; }
    if (tail) { const encoder = this.gpuDevice.createCommandEncoder(); tail(encoder); buffers.push(encoder.finish()); }
    if (buffers.length) {
      this.gpuDevice.queue.submit(buffers); this.batch.encoderSubmits++; this.batch.commandBuffers += buffers.length;
    }
    // Submitted work keeps its resources alive; later queue writes are ordered after it.
    for (const r of this.retiredDestroy.splice(0)) r.destroy();
    for (const b of this.retiredPool.splice(0)) this.recycle(b);
    this.scratch.splice(0).forEach(b => b.destroy());
    this.used.clear(); this.usedRanges.clear();
    if (++this.flushes % 64 === 0) this.evictPool(this.flushes - POOL_AGE);
  }

  /** K60: mark bytes [offset, offset + size) of `b` as used by the pending encoder (ranges merged; more than 16
   * disjoint ranges collapse to their hull, which only makes later overlap tests conservative). */
  private useBuffer(b: GPUBuffer, offset = 0, size = b.size): void {
    const lo = Math.max(0, offset), hi = Math.min(b.size, offset + size);
    const r = this.usedRanges.get(b);
    if (!r) { this.usedRanges.set(b, [lo, hi]); return; }
    for (let i = 0; i < r.length; i += 2) if (lo <= r[i + 1] && hi >= r[i]) {
      r[i] = Math.min(r[i], lo); r[i + 1] = Math.max(r[i + 1], hi); return;
    }
    if (r.length >= 32) { let a = lo, z = hi; for (let i = 0; i < r.length; i += 2) { a = Math.min(a, r[i]); z = Math.max(z, r[i + 1]); } r.length = 0; r.push(a, z); return; }
    r.push(lo, hi);
  }

  private bufferUsed(b: GPUBuffer, lo = 0, hi = b.size): boolean {
    const r = this.usedRanges.get(b); if (!r) return false;
    for (let i = 0; i < r.length; i += 2) if (lo < r[i + 1] && hi > r[i]) return true;
    return false;
  }

  private endNative(): void {
    if (!this.pass) return;
    this.pass.end(); this.pass = undefined; this.lingering = false; this.passKey = '';
    // Match WebGL's logical staging -> alpha:false default framebuffer boundary.
    if (this.screenPass) this.makeScreenOpaque(this.encoder!);
  }

  private beginNative(desc: GPURenderPassDescriptor): void {
    this.encoder ??= this.gpuDevice.createCommandEncoder();
    const writes = this.timing?.writes();
    this.pass = this.encoder.beginRenderPass(writes ? { ...desc, timestampWrites: writes } : desc);
    this.batch.nativePasses++;
    for (const c of desc.colorAttachments) if (c) this.used.add((c.view as GPUTextureView & { bgtTexture?: GPUTexture }).bgtTexture!);
    const depth = desc.depthStencilAttachment?.view as (GPUTextureView & { bgtTexture?: GPUTexture }) | undefined;
    if (depth) this.used.add(depth.bgtTexture!);
  }

  private view(texture: GPUTexture, mip: number): GPUTextureView {
    const view = texture.createView({ baseMipLevel: mip, mipLevelCount: 1 }) as GPUTextureView & { bgtTexture?: GPUTexture };
    view.bgtTexture = texture; return view;
  }

  private textureId(t: GPUTexture): number {
    let id = this.ids.get(t); if (id === undefined) { id = this.nextId++; this.ids.set(t, id); } return id;
  }

  private retire(r: GPUBuffer | GPUTexture): void {
    if (this.used.has(r) || this.usedRanges.has(r as GPUBuffer)) this.retiredDestroy.push(r); else r.destroy();
  }

  /** Only buffers of a pool size class are kept (an exact-size guest store dies on its first rename). */
  private recycle(b: GPUBuffer): void {
    if (b.size > POOL_CAP || sizeClass(b.size) !== b.size) { b.destroy(); return; }
    const key = `${b.usage}:${b.size}`, list = this.pool.get(key) ?? [];
    list.push({ b, at: this.flushes }); this.pool.set(key, list); this.poolBytes += b.size;
    if (this.poolBytes > POOL_CAP) this.evictPool(Infinity, POOL_CAP);
  }

  /** Destroy pooled buffers recycled before flush `before`, then oldest-first until at most `budget` bytes remain. */
  private evictPool(before: number, budget = POOL_CAP): void {
    for (const [key, list] of this.pool) {
      let n = 0; while (n < list.length && list[n].at < before && Number.isFinite(before)) { list[n].b.destroy(); this.poolBytes -= list[n].b.size; n++; }
      if (n) list.splice(0, n);
      if (!list.length) this.pool.delete(key);
    }
    while (this.poolBytes > budget) {
      let oldest: { b: GPUBuffer; at: number }[] | undefined, key = '';
      for (const [k, list] of this.pool) if (!oldest || list[0].at < oldest[0].at) { oldest = list; key = k; }
      if (!oldest) break;
      const e = oldest.shift()!; e.b.destroy(); this.poolBytes -= e.b.size;
      if (!oldest.length) this.pool.delete(key);
    }
  }

  /** A recycled buffer of this usage and size class (submitted work that used it is ordered before any later queue
   * write or submit), else a new one of the class size. Every binding of these buffers names an explicit range or is
   * sized by its contents, so the class tail is never read. */
  private pooled(size: number, usage: number): GPUBuffer {
    const cls = sizeClass(size), e = this.pool.get(`${usage}:${cls}`)?.pop();
    if (e) { this.poolBytes -= cls; return e.b; }
    return this.gpuDevice.createBuffer({ size: cls, usage });
  }

  /** Copy-on-write for a CPU-authoritative buffer referenced by the pending encoder: earlier encoded
   * work keeps the old native buffer, later work sees a fresh one holding the complete new contents. */
  private rename(b: BufferResource): void {
    const native = this.pooled(b.native.size, b.native.usage);
    this.writeBuffer(native, 0, b.shadow);
    this.retiredPool.push(b.native); b.native = native; this.batch.bufferRenames++; this.batch.renameBytes += Math.ceil(b.shadow.length / 4) * 4;
  }

  lost(): void {
    this.inactive = true; this.virtualPass = undefined;
    this.pass = undefined;
    this.encoder = undefined;
    this.lingering = false; this.passKey = ''; this.used.clear(); this.usedRanges.clear();
    this.views = undefined; this.rotations = undefined; this.rotatedIndices = undefined;
    this.retiredDestroy = []; this.retiredPool = []; this.pool.clear(); this.poolBytes = 0; this.flushes = 0;
    this.timing = undefined;
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
    if([...this.buffers.values()].some(b=>b.generated))throw new Error('Cannot restore live transform-feedback buffer contents; full reupload or deletion required before loss');
    const unshadowed = [...this.textures.values()].filter(t => t.unshadowed).length;
    if (unshadowed) throw new Error(`${RECOVERY_SHADOWS_OFF}: ${unshadowed} uploaded texture(s) cannot be restored`);
    if ((device.limits?.maxUniformBufferBindingSize ?? GPU_LIMITS.uniformRange) < this.maxUniformRange) throw new Error('GPU uniform binding limit decreased');
    this.gpuDevice = device;
    this.opaqueScreen = undefined; this.views = undefined; this.rotations = undefined; this.rotatedIndices = undefined;
    this.framebufferBlit = undefined; this.bufferCopy = undefined; this.feedbackPipelines.clear();
    this.inactive = false;
    const buffers = [...this.buffers], textures = [...this.textures], samplers = [...this.samplers];
    const shaders = [...this.shaders], pipelines = [...this.pipelines].filter(([, p]) => p.failure === undefined);
    this.buffers.clear(); this.textures.clear(); this.samplers.clear(); this.shaders.clear(); this.pipelines.clear();
    this.blits.clear(); this.blitSampler = undefined; this.depthUploadPipelines.clear(); this.clearPipelines.clear();
    for (const [, b] of buffers) this.execute({ kind: 'gpu', op: OP.BUFFER_CREATE, words: b.words, data: b.shadow });
    for (const [, t] of textures) {
      this.execute({ kind: 'gpu', op: OP.TEXTURE_CREATE_EX, words: t.words });
      if (t.allocatedMips > 1) this.execute({ kind: 'gpu', op: OP.TEXTURE_ALLOCATE_MIPS,
        words: [t.words[0], t.allocatedMips] });
      if (t.generated && t.desc.dimension !== 1) {
        if (t.generated.source) this.execute(t.generated.source);
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
      if (item.op === OP.PIPELINE_CREATE) {
        this.pipelines.delete(item.words[0]); this.failedPipelines.set(item.words[0], message);
      }
      if (item.op === OP.PIPELINE) this.current = undefined;
      if (item.op === OP.SHADER_CREATE) this.failedShaders.set(item.words[0], item);
      item.complete?.(E_IO, message); item.readback?.(undefined, E_IO);
      if (item.op !== OP.SHADER_CREATE) this.error(message);
      return E_IO;
    }
  }

  /** Ops that encode their own submissions (or read results) observe all earlier encoded work. */
  private prepare(op: number, w: readonly number[]): void {
    switch (op) {
      case OP.PASS_BEGIN: case OP.PASS_END: case OP.PIPELINE: case OP.VIEWPORT: case OP.SCISSOR: case OP.STENCIL_REF:
      case OP.BLEND_CONSTANT: case OP.VERTEX_BUFFER: case OP.INDEX_BUFFER: case OP.UNIFORM_BUFFER: case OP.TEXTURE:
      case OP.DRAW: case OP.DRAW_INDEXED: case OP.CLEAR_BUFFER: case OP.FEEDBACK_CAPTURE: case OP.FEEDBACK_VARYINGS:
      case OP.BUFFER_CREATE: case OP.BUFFER_UPDATE: case OP.BUFFER_DELETE: case OP.TEXTURE_CREATE_EX: case OP.TEXTURE_DELETE:
      case OP.SAMPLER_CREATE_EX: case OP.SAMPLER_DELETE: case OP.SHADER_CREATE: case OP.SHADER_DELETE:
      case OP.PIPELINE_CREATE: case OP.PIPELINE_DELETE:
        return;
      case OP.TEXTURE_UPDATE_EX: case OP.TEXTURE_ALLOCATE_MIPS: {
        const t = this.textures.get(w[0]);
        if (t?.live && this.used.has(t.live)) { this.batch.splits++; this.flush(); }
        return;
      }
      // K57: a merged frame encodes blits into its own command encoder (no split, no extra submit).
      case OP.BLIT: if (this.merge) return; if (this.encoder) this.batch.splits++; this.flush(); return;
      default: if (this.encoder) this.batch.splits++; this.flush();
    }
  }

  private run(item: GpuItem): void {
    const { op, words: w } = canonicalize(item.op, item.words), h = w[0], d = this.gpuDevice;
    if (this.virtualPass && op !== OP.PASS_END) this.realizePass();
    this.prepare(op, w);
    switch (op) {
      case OP.FEEDBACK_VARYINGS:
        this.requirePipeline(h).captures = undefined; this.feedback.set(h,feedbackLayout(item.source!,!!w[1],w[2])); break;
      case OP.FEEDBACK_CAPTURE:
        this.requireCurrentPipeline(); this.capture=w; break;
      case OP.BUFFER_COPY: {
        const src = this.buffers.get(h)!, dst = this.buffers.get(w[2])!;
        this.bufferCopy ??= new WebGPUBufferCopy(d);
        this.bufferCopy.copy(src.native, w[1], dst.native, w[3], w[4]);
        dst.shadow.set(src.shadow.slice(w[1], w[1] + w[4]), w[3]); dst.version = (dst.version ?? 0) + 1;
        if (src.generated) dst.generated = true; else if (!w[3] && w[4] === dst.shadow.length) dst.generated = false;
        break;
      }
      case OP.BUFFER_READBACK: this.bufferReadback(item); break;
      case OP.BLIT: {
        const image = (h: number, mip: number): BlitImage => h ? {
          texture: this.textures.get(h)!.native, mip, format: formats[this.textures.get(h)!.desc.format],
          kind: this.textures.get(h)!.desc.format,
        } : {texture: this.screen!, mip: 0, format: 'rgba8unorm', kind: 0};
        this.framebufferBlit ??= new WebGPUBlit(d);
        const source = image(h, w[1]), dest = image(w[2], w[3]);
        if (this.merge) {
          // K57: encoded in order into the frame encoder after the open native pass; the transfer's
          // textures count as used (a later queue write to them splits), temporaries die after the submit.
          this.endNative();
          const encoder = this.encoder ??= d.createCommandEncoder();
          this.retiredDestroy.push(...this.framebufferBlit.execute(w, source, dest, encoder));
          this.used.add(source.texture); this.used.add(dest.texture);
          if (!w[2]) this.makeScreenOpaque(encoder);
          break;
        }
        this.framebufferBlit.execute(w, source, dest);
        if (!w[2]) {
          const encoder = d.createCommandEncoder();
          this.makeScreenOpaque(encoder); d.queue.submit([encoder.finish()]);
        }
        break;
      }
      case OP.BUFFER_CREATE: {
        const native = d.createBuffer({ size: Math.ceil(w[2] / 4) * 4,
          usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | GPUBufferUsage.VERTEX | GPUBufferUsage.INDEX | GPUBufferUsage.UNIFORM });
        const shadow = new Uint8Array(w[2]);
        if (item.data) shadow.set(item.data);
        this.buffers.set(h, { native, words: w, shadow, serial: ++this.bufferSerial });
        this.writeBuffer(native, 0, shadow);
        break;
      }
      case OP.BUFFER_UPDATE: {
        const b = this.buffers.get(h)!;
        if(b.generated && (w[1]%4 || item.data!.length%4) && !(w[1]===0&&item.data!.length===b.shadow.length)) throw new Error('Unaligned updates of GPU-generated buffers are unsupported');
        // K60: only a write overlapping bytes that earlier commands of the pending encoder use needs a new store.
        const start = w[1] & ~3, end = Math.min(b.shadow.length, Math.ceil((w[1] + item.data!.length) / 4) * 4);
        const referenced = this.bufferUsed(b.native, start, Math.max(end, start + 1));
        // Copy-on-write costs a full-buffer queue write: bounded per buffer (256 KiB) and per frame (4 MiB);
        // beyond that (or for GPU-generated contents) split the encoder, which costs one LOAD pass instead.
        if (referenced && (b.generated || b.shadow.length > 256 << 10 || this.batch.renameBytes + b.shadow.length > 4 << 20)) {
          this.batch.splits++; this.flush();
        }
        b.shadow.set(item.data!, w[1]);if(w[1]===0&&item.data!.length===b.shadow.length)b.generated=false;
        b.version = (b.version ?? 0) + 1;
        if (referenced && this.encoder) { this.rename(b); break; }
        // ABI allows byte updates. WebGPU writeBuffer needs 4-aligned regions.
        this.writeBuffer(b.native, start, b.shadow.slice(start, end));
        break;
      }
      case OP.BUFFER_DELETE: this.retire(this.buffers.get(h)!.native); this.buffers.delete(h); break;
      case OP.TEXTURE_CREATE_EX: {
        const desc = toCanonicalTexture(w);
        if (desc.format >= 10 && desc.format <= 12 && !d.features.has('float32-filterable')) {
          throw new Error('32-bit float textures need the float32-filterable WebGPU feature');
        }
        const t = new TextureResource(w, desc, 1, r => this.materialize(r));
        this.textures.set(h, t);
        if (item.op === OP.TEXTURE_CREATE && desc.mips > 1) this.growTexture(h, desc.mips);
        // K71: storage is committed on first use; `?lazytextures=0` (A/B) restores eager allocation at creation.
        if (this.opts.lazyTextures === false) void t.native;
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
        if (!this.recoveryShadows) { t.unshadowed = true; break; }
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
      case OP.TEXTURE_DELETE: { const t = this.textures.get(h)!; if (t.live) this.retire(t.live); this.textures.delete(h); break; }
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
        // K62: compiled with the stage's own packed interface (the module a pipeline uses is relinked by name).
        const code = w[2] ? translateGLSL(item.source!, w[1], w[2], undefined, undefined, undefined,
          w[1] === 1 || w[1] === 2 ? { packing: packVaryings(glslVaryingDecls(item.source!, w[1])) } : undefined) : validateWGSL(item.source!, w[1]);
        // Shader syntax errors belong to the request log, not the uncaptured renderer error channel.
        d.pushErrorScope('validation');
        const native = d.createShaderModule({ code });
        const validation = d.popErrorScope();
        const shader: ShaderResource = { native, item, done: false, bindings: shaderBindings(code, true),
          outputs: w[1] & 2 ? fragmentOutputs(code) : new Set() };
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
      case OP.PIPELINE_CREATE:
        this.pipelines.set(h, this.pipeline(w)); this.failedPipelines.delete(h); break;
      case OP.PIPELINE_DELETE:
        this.pipelines.delete(h); this.failedPipelines.delete(h); this.feedback.delete(h); break;
      case OP.PASS_BEGIN: if (!this.deferPass(w)) this.beginPass(w); break;
      case OP.CLEAR_BUFFER: this.clearBuffer(w); break;
      case OP.PASS_END:
        if (this.virtualPass) { this.endVirtualPass(); break; }
        // Screen passes end natively: the opaque-alpha store is observable by a following LOAD/BLIT.
        // Other native passes linger until a target change or sync point (see flush/prepare).
        if (!this.merge) this.flush(); else if (this.screenPass) this.endNative(); else this.lingering = true;
        break;
      case OP.PIPELINE:
        this.current = undefined;
        this.current = this.requirePipeline(h); this.pass!.setPipeline(this.current.native); break;
      case OP.VIEWPORT: this.viewport = w.map(f); this.applyViewport(); break;
      case OP.SCISSOR: this.scissor=[...w]; this.pass!.setScissorRect(h, w[1], w[2], w[3]); break;
      case OP.STENCIL_REF: this.stencilRef = h; this.pass!.setStencilReference(h); break;
      case OP.BLEND_CONSTANT: this.blendConstant=w.map(f); this.pass!.setBlendConstant(this.blendConstant); break;
      case OP.VERTEX_BUFFER: this.vertices.set(h, w); break;
      case OP.INDEX_BUFFER:
        this.index = [...w]; this.useBuffer(this.buffers.get(h)!.native, w[2], w[3]);
        this.pass!.setIndexBuffer(this.buffers.get(h)!.native, w[1] ? 'uint32' : 'uint16', w[2], w[3]); break;
      case OP.UNIFORM_BUFFER:
        // The host validator enforces the reported limit; never bind a native range above the device's.
        if (w[3] > this.maxUniformRange) throw new Error(`Uniform range ${w[3]} exceeds device limit ${this.maxUniformRange}`);
        this.uniforms.set(h, { buffer: this.buffers.get(w[1])!.native, offset: w[2], size: w[3] }); break;
      case OP.TEXTURE: this.sampled.set(h, [...w]); break;
      case OP.DRAW: case OP.DRAW_INDEXED: {
        this.requireCurrentPipeline();
        const discard = this.capture?.[0];
        if(this.capture) { this.captureDraw(item); this.capture=undefined; }
        if(discard) break;
        // K62: a viewport that misses the attachment rasterizes nothing (capture above still ran).
        if (this.viewEmpty) break;
        const p = this.bind(), topology = this.current!.words[3];
        if (topology === 2 || topology === 4) this.strip(item, !!p.flat);
        else if (p.flat && (topology === 1 || topology === 3)) this.rotated(item, topology === 1 ? 2 : 3);
        else if (item.op === OP.DRAW) this.pass!.draw(h, w[1], w[2], w[3]);
        else this.pass!.drawIndexed(h, w[1], w[2], w[3] | 0, w[4]);
        break;
      }
      default: throw new Error('Unknown §13 opcode');
    }
  }

  /** K62: PASS_BEGIN state: the whole attachment, identity transform. */
  private resetView(): void { this.viewOffset = 0; this.viewEmpty = false; this.viewIdentity = true; }
  /** K62: clamp the §13 viewport to the attachment natively and select the compensating view transform. */
  private applyViewport(): void {
    const v = this.viewport, c = clampViewport(v[0], v[1], v[2], v[3], this.passSize[0], this.passSize[1]);
    this.pass!.setViewport(c.native[0], c.native[1], c.native[2], c.native[3], v[4], v[5]);
    this.viewEmpty = c.empty;
    const t = c.transform; this.viewIdentity = t[0] === 1 && t[1] === 1 && t[2] === 0 && t[3] === 0;
    this.viewOffset = this.viewIdentity ? 0 : this.viewTransforms().offset(t);
  }
  private viewTransforms(): ViewTransforms {
    return this.views ??= new ViewTransforms(this.gpuDevice, b => this.retiredDestroy.push(b));
  }

  /** K62: lists drawn last-vertex-first (see provoking.ts). Non-indexed draws use a static rotated sequence with
   * base_vertex = first; indexed draws a rotated copy of the index range in an index ring, cached per store and
   * contents version. */
  private rotated(item: GpuItem, n: 2 | 3): void {
    const w = item.words, count = w[0] - w[0] % n;
    if (!count) return;
    if (item.op === OP.DRAW && w[2] <= 0x7fffffff) {
      this.rotations ??= new RotatedSequences(this.gpuDevice, b => this.retiredDestroy.push(b));
      this.pass!.setIndexBuffer(this.rotations.get(n, count / n), 'uint32');
      this.pass!.drawIndexed(count, w[1], 0, w[2], w[3]);
    } else {
      if (item.op === OP.DRAW) {
        this.pass!.setIndexBuffer(this.scratchIndex(rotateList(Uint32Array.from({ length: count }, (_, i) => w[2] + i), n)), 'uint32');
        this.pass!.drawIndexed(count, w[1], 0, 0, w[3]);
      } else {
        // vK62: keyed by the store's serial (a deleted and re-created handle is a different store) and contents version.
        const ib = this.index!, b = this.buffers.get(ib[0])!, size = ib[1] ? 4 : 2, start = ib[2] + w[2] * size;
        this.rotatedIndices ??= new RotatedIndexRing(this.gpuDevice, r => this.retiredDestroy.push(r));
        const r = this.rotatedIndices.get(`${b.serial}:${b.version ?? 0}:${size}:${start}:${count}:${n}`, () => {
          const at = b.shadow.byteOffset + start;
          return rotateList(size === 4 ? new Uint32Array(b.shadow.buffer.slice(at, at + count * 4)) :
            new Uint16Array(b.shadow.buffer.slice(at, at + count * 2)), n);
        });
        this.pass!.setIndexBuffer(r.buffer, 'uint32', r.offset, r.bytes);
        this.pass!.drawIndexed(count, w[1], 0, w[3] | 0, w[4]);
      }
    }
    if (this.index) this.pass!.setIndexBuffer(this.buffers.get(this.index[0])!.native,
      this.index[1] ? 'uint32' : 'uint16', this.index[2], this.index[3]);
  }
  private scratchIndex(data: Uint32Array<ArrayBuffer>): GPUBuffer {
    const native = this.gpuDevice.createBuffer({ size: Math.max(4, data.byteLength), usage: GPUBufferUsage.INDEX, mappedAtCreation: true });
    new Uint32Array(native.getMappedRange()).set(data); native.unmap(); this.scratch.push(native);
    return native;
  }

  private makeScreenOpaque(encoder: GPUCommandEncoder): void {
    this.opaqueScreen ??= new WebGPUOpaqueScreen(this.gpuDevice);
    this.opaqueScreen.encode(encoder, this.screen!);
  }

  private bufferReadback(item:GpuItem):void {
    const w=item.words, d=this.gpuDevice, buffer=d.createBuffer({size:Math.ceil((w[1]%4+w[2])/4)*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    const encoder=d.createCommandEncoder();encoder.copyBufferToBuffer(this.buffers.get(w[0])!.native,w[1]&~3,buffer,0,buffer.size);
    d.queue.submit([encoder.finish()]);this.readbacks.add(item);
    void buffer.mapAsync(GPUMapMode.READ).then(()=>{
      const bytes=new Uint8Array(buffer.getMappedRange()).slice(w[1]%4,w[1]%4+w[2]);buffer.destroy();
      if(this.readbacks.delete(item))item.readback?.(bytes);
    }).catch(()=>{buffer.destroy();if(this.readbacks.delete(item))item.readback?.(undefined,E_IO);});
  }

  private captureDraw(item:GpuItem):void {
    const p=this.current!, pw=p.words, w=item.words, capture=this.capture!, layout=this.feedback.get(pw[0]);
    if(!layout)throw new Error('Missing transform feedback interface');
    const s=this.shaders.get(pw[1])!;
    if(!s.item.words[2])throw new Error('Feedback currently requires canonical GLSL vertex IO');
    const count=feedbackVertexCount(pw[3],w[0]), total=count*w[1];if(!total)return;
    const d=this.gpuDevice, offsets:number[]=[], inputs:FeedbackInput[]=[], copies:{source:GPUBuffer;offset:number;size:number;target:number}[]=[];
    let bytes=0;
    for(let slot=0;slot<pw[23];slot++) {
      const b=this.vertices.get(slot)!;offsets[slot]=bytes;
      copies.push({source:this.buffers.get(b[1])!.native,offset:b[2],size:Math.ceil(b[3]/4)*4,target:bytes});bytes+=Math.ceil(b[3]/4)*4;
    }
    const indexed=item.op===OP.DRAW_INDEXED;let indexWord:number|undefined;
    // Indices are validated from an authoritative upload shadow; generated index buffers are rejected by the decoder.
    let ids:Uint32Array<ArrayBuffer>|undefined;
    if(indexed){const ib=this.index!,shadow=this.buffers.get(ib[0])!.shadow,view=new DataView(shadow.buffer),size=ib[1]?4:2;
      ids=Uint32Array.from({length:w[0]},(_,i)=>size===4?view.getUint32(ib[2]+(w[2]+i)*size,true):view.getUint16(ib[2]+(w[2]+i)*size,true));
      indexWord=bytes/4;bytes+=ids.byteLength;
    }
    for(let i=0;i<pw[24];i++){const a=26+pw[23]*2+i*4,slot=pw[a+1];inputs.push({location:pw[a],format:pw[a+3],offset:offsets[slot]+pw[a+2],stride:pw[26+slot*2],step:pw[27+slot*2]});}
    if(bytes>d.limits.maxStorageBufferBindingSize)throw new Error('Feedback input exceeds storage binding limit');
    // K60 (Q117): the GLSL translation depends only on the vertex shader and its sampler specialization, the
    // lowered compute pipeline additionally on the draw shape: both are cached on the pipeline resource, so a
    // steady capture draw costs no GLSL parsing, shader module or pipeline creation.
    const program=this.captureProgram(p,s), {code,bindings}=program;
    const shapeKey=`${inputs.map(a=>`${a.location},${a.format},${a.offset},${a.stride},${a.step}`).join(';')}|${pw[3]}|${w[0]}|${w[1]}|${w[2]}|${w[indexed?4:3]}|${indexWord}|${indexed?w[3]|0:0}`;
    let pipeline=program.pipelines.get(shapeKey);
    if(!pipeline){
      const lowered=lowerFeedback(code,layout,inputs,pw[3],w[0],w[1],w[2],w[indexed?4:3],indexWord,indexed?w[3]|0:0);
      pipeline=this.feedbackPipelines.get(lowered);
      if(!pipeline){
        const module=d.createShaderModule({code:lowered});
        const layouts=[0,1].map(group=>d.createBindGroupLayout({entries:bindings.filter(b=>b.group===group).map(b=>({binding:b.binding,visibility:GPUShaderStage.COMPUTE,
          ...(b.type==='uniform'?{buffer:{type:'uniform' as const}}:
            b.type.startsWith('texture')||b.type==='depth'?{texture:{sampleType:b.type==='depth'?'depth' as const:b.type.startsWith('textureI')?'sint' as const:b.type.startsWith('textureU')?'uint' as const:'float' as const,viewDimension:b.type.endsWith('3d')?'3d' as const:b.type.endsWith('2darray')?'2d-array' as const:'2d' as const}}:
            {sampler:{type:b.type==='comparison'?'comparison' as const:b.type==='nonfiltering'?'non-filtering' as const:'filtering' as const}})}))}));
        layouts.push(d.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:'read-only-storage'}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}}]}));
        pipeline=d.createComputePipeline({layout:d.createPipelineLayout({bindGroupLayouts:layouts}),compute:{module,entryPoint:'bgt_internal_capture'}});
        if(this.feedbackPipelines.size>=64)this.feedbackPipelines.delete(this.feedbackPipelines.keys().next().value!);
        this.feedbackPipelines.set(lowered,pipeline);
      }
      if(program.pipelines.size>=64)program.pipelines.delete(program.pipelines.keys().next().value!);
      program.pipelines.set(shapeKey,pipeline); this.batch.captureLowerings++;
    }
    const outputBytes=total*layout.strides.reduce((a,b)=>a+b,0);
    if(outputBytes>d.limits.maxStorageBufferBindingSize)throw new Error('Feedback output exceeds storage binding limit');
    // K67: the gather and output temporaries come from the recycle pool (steady captures create no GPUBuffer).
    const source=this.pooled(Math.max(4,bytes),GPUBufferUsage.COPY_DST|GPUBufferUsage.STORAGE);
    const output=this.pooled(outputBytes,GPUBufferUsage.COPY_SRC|GPUBufferUsage.STORAGE);
    this.pass!.end();this.pass=undefined;this.lingering=false;
    // K57: a merged frame keeps one encoder across the capture (gathers, compute, scatter, resumed pass). Every
    // buffer/texture the capture reads or writes is marked used, so a later same-frame queue write to it renames
    // or splits instead of reaching the earlier capture; the capture's temporaries die after the frame submit.
    const merged=this.merge;
    if(!merged){const pending=this.encoder!;this.encoder=undefined;d.queue.submit([pending.finish()]);this.batch.encoderSubmits++;this.batch.splits++;
      for(const r of this.retiredDestroy.splice(0))r.destroy();for(const b of this.retiredPool.splice(0))this.recycle(b);}
    const encoder=merged?this.encoder!:d.createCommandEncoder();for(const c of copies)if(c.size){encoder.copyBufferToBuffer(c.source,c.offset,source,c.target,c.size);this.useBuffer(c.source,c.offset,c.size);}
    if(ids)d.queue.writeBuffer(source,indexWord!*4,ids);
    const pass=encoder.beginComputePass();pass.setPipeline(pipeline);
    for(const group of [0,1]) {const entries:GPUBindGroupEntry[]=bindings.filter(b=>b.group===group).map(b=>{
      if(group===0){const u=this.uniforms.get(b.binding)!;this.useBuffer(u.buffer,u.offset,u.size);return {binding:b.binding,resource:u};}
      const t=this.sampled.get(b.binding>>1)!,texture=this.textures.get(t[1])!;this.used.add(texture.native);
      const sampler=this.samplers.get(t[2])!;if(b.type==='nonfiltering')sampler.nonfilter??=d.createSampler();
      return {binding:b.binding,resource:b.binding%2?(b.type==='nonfiltering'?sampler.nonfilter!:sampler.native):texture.native.createView({aspect:isDepthFormat(texture.desc.format)?'depth-only':'all',dimension:texture.desc.dimension===1?'3d':texture.desc.dimension===2?'2d-array':'2d'})};
    });pass.setBindGroup(group,d.createBindGroup({layout:pipeline!.getBindGroupLayout(group),entries}));}
    pass.setBindGroup(2,d.createBindGroup({layout:pipeline.getBindGroupLayout(2),entries:[{binding:0,resource:{buffer:source}},{binding:1,resource:{buffer:output}}]}));
    pass.dispatchWorkgroups(Math.min(65535,Math.ceil(total/64)),Math.ceil(total/(65535*64)));pass.end();
    let off=0;layout.strides.forEach((stride,i)=>{const b=this.buffers.get(capture[1+i*3])!,n=total*stride;
      encoder.copyBufferToBuffer(output,off,b.native,capture[2+i*3],n);this.useBuffer(b.native,capture[2+i*3],n);b.generated=true;b.version=(b.version??0)+1;b.shadow.fill(0,capture[2+i*3],capture[2+i*3]+n);off+=n;});
    if(merged)this.retiredPool.push(source,output);
    else {d.queue.submit([encoder.finish()]);this.recycle(source);this.recycle(output);}
    const desc=this.passDescriptor!;
    for(const c of desc.colorAttachments)if(c)c.loadOp='load';
    if(desc.depthStencilAttachment){desc.depthStencilAttachment.depthLoadOp='load';if(this.passDepth===5)desc.depthStencilAttachment.stencilLoadOp='load';}
    if(!merged){this.used.clear();this.usedRanges.clear();}
    this.beginNative(desc);
    this.applyViewport();
    const sc=this.scissor;this.pass!.setScissorRect(sc[0],sc[1],sc[2],sc[3]);this.pass!.setStencilReference(this.stencilRef);this.pass!.setBlendConstant(this.blendConstant);
    // The resumed pass belongs to a fresh encoder: every rebound resource must be marked used again, or a
    // later same-frame BUFFER_UPDATE skips the copy-on-write rename and the pending draw reads new bytes.
    // (Vertex/uniform/texture bindings are re-marked by the next draw's bind(); attachments by beginNative.)
    if(this.index){const native=this.buffers.get(this.index[0])!.native;this.useBuffer(native,this.index[2],this.index[3]);
      this.pass!.setIndexBuffer(native,this.index[1]?'uint32':'uint16',this.index[2],this.index[3]);}
  }

  /** K60 (Q117): the capture translation of pipeline `p`'s vertex shader `s` for the currently bound samplers
   * (depth textures, sampler words). Cached on the pipeline resource; a different shader object under the
   * same handle (deleted and re-created) misses. */
  private captureProgram(p:PipelineResource, s:ShaderResource):CaptureProgram {
    const depthSlots=new Set(s.bindings.filter(b=>b.group===1 && b.binding%2===0 && isDepthFormat(this.textures.get(this.sampled.get(b.binding>>1)![1])!.desc.format)).map(b=>b.binding>>1));
    const sampling=[...depthSlots].filter(slot=>s.bindings.some(b=>b.group===1&&b.binding===slot*2+1&&b.type!=='comparison')).map(slot=>({binding:slot*2,sampler:this.samplers.get(this.sampled.get(slot)![2])!.words}));
    const integerSamplers=new Map(s.bindings.filter(b=>b.group===1&&(b.type.startsWith('texture')||b.type==='depth')).map(b=>[b.binding>>1,this.samplers.get(this.sampled.get(b.binding>>1)![2])!.words] as const));
    const key=`${[...depthSlots].join(',')}|${sampling.map(x=>`${x.binding}:${x.sampler.join(',')}`).join(';')}|${[...integerSamplers].map(([k,v])=>`${k}:${v.join(',')}`).join(';')}`;
    const cache=p.captures??=new Map();
    const hit=cache.get(key);
    if(hit && hit.shader===s)return hit;
    const code=lowerDepthSampling(translateGLSL(s.item.source!,1,s.item.words[2],undefined,depthSlots,integerSamplers),sampling);
    const bindings=shaderBindings(code,true).map(b=>b.type==='sampler'&&depthSlots.has(b.binding>>1)?{...b,type:'nonfiltering' as const}:b);
    const program:CaptureProgram={shader:s,code,bindings,pipelines:new Map()};
    if(cache.size>=16)cache.delete(cache.keys().next().value!);
    cache.set(key,program); this.batch.captureTranslations++;
    return program;
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
      const module = this.gpuDevice.createShaderModule({ code: `struct V {value:vec4u}; @group(0) @binding(0) var<uniform> v:V;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f { var p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3)); return vec4f(p[i],0,1); }
${fields.length ? `struct O {${fields.join(',')}}; @fragment fn fs()->O {var o:O;${assignments.join('')}return o;}` : '@fragment fn fs() {}'}` });
      const stencilFace: GPUStencilFaceState = { compare: 'always', passOp: kind >= 2 ? 'replace' : 'keep' };
      pipeline = this.gpuDevice.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' },
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
      const uniform = this.gpuDevice.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM, mappedAtCreation: true });
      new Uint32Array(uniform.getMappedRange()).set(w.slice(2)); uniform.unmap(); this.scratch.push(uniform);
      this.pass!.setBindGroup(0, this.gpuDevice.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniform } }] }));
    }
    this.pass!.setViewport(0, 0, this.passSize[0], this.passSize[1], 0, 1);
    if (kind >= 2) this.pass!.setStencilReference(w[kind === 2 ? 2 : 3]);
    this.pass!.draw(3);
    this.applyViewport();
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
    const d = this.gpuDevice, source = d.createTexture({ size: [width, height, 1], format: 'rgba32float',
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
    const d = this.gpuDevice, check = stencilValue >= 0 ? `if (abs(q.y - ${stencilValue}.0) > 0.1) { discard; }` : '';
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

  /** K71: a pass whose attachments all lack storage stays virtual until an in-pass op needs it. If it ends first (the
   * profile's whole-attachment glClear is PASS_BEGIN + PASS_END), its clears become per-level constants and nothing
   * is allocated; LOAD keeps the current value. The decoder already validated the pass. */
  private deferPass(w: number[]): boolean {
    if (this.opts.lazyTextures === false) return false;
    for (let i = 0; i < w[0]; i++) { const t = this.textures.get(w[7 + i * 7]); if (!t || t.live) return false; }
    if (w[1]) { const t = this.textures.get(w[1]); if (!t || t.live) return false; }
    if (!w[0] && !w[1]) return false;
    this.virtualPass = w; return true;
  }
  private realizePass(): void { const w = this.virtualPass!; this.virtualPass = undefined; this.beginPass(w); }
  private endVirtualPass(): void {
    const w = this.virtualPass!; this.virtualPass = undefined; this.lazyTextures.deferredPasses++;
    const level = (t: TextureResource, mip: number) => ((t.constants ??= [])[mip] ??= {});
    for (let i = 0; i < w[0]; i++) {
      const j = 7 + i * 7; if (w[j + 2]) level(this.textures.get(w[j])!, w[j + 1]).color = w.slice(j + 3, j + 7);
    }
    if (w[1]) {
      const t = this.textures.get(w[1])!, c = level(t, w[2]);
      if (w[3]) c.depth = w[5];
      if (w[4] && t.desc.format === 5) c.stencil = w[6];
    }
  }

  private beginPass(w: number[]): void {
    const h = w[0];
    this.uniforms.clear(); this.sampled.clear(); this.vertices.clear();
    this.index = undefined; this.current = undefined; this.capture=undefined;
    const screenPass = h === 1 && w[7] === 0;
    let key = `${h}`, loads = w[1] ? w[3] | w[4] : 0;
    for (let i = 0; i < h; i++) {
      const j = 7 + i * 7; loads |= w[j + 2];
      key += `,${w[j] ? this.textureId(this.textures.get(w[j])!.native) : 0}/${w[j + 1]}`;
    }
    if (w[1]) key += `;${this.textureId(this.textures.get(w[1])!.native)}/${w[2]}`;
    if (this.lingering && !screenPass && !loads && key === this.passKey) {
      // Same attachments, LOAD everywhere: continue the native pass with §13.1 begin-state reset.
      this.lingering = false; this.batch.mergedPasses++;
      const [width, height] = this.passSize;
      this.viewport = [0, 0, width, height, 0, 1]; this.stencilRef = 0;
      this.scissor = [0, 0, width, height]; this.blendConstant = [0, 0, 0, 0];
      this.pass!.setViewport(0, 0, width, height, 0, 1); this.resetView();
      this.pass!.setScissorRect(0, 0, width, height);
      this.pass!.setStencilReference(0);
      this.pass!.setBlendConstant([0, 0, 0, 0]);
      return;
    }
    this.endNative();
    this.screenPass = screenPass;
    const colors: GPURenderPassColorAttachment[] = [];
    this.passFormats = []; this.passDepth = w[1] ? this.textures.get(w[1])!.desc.format : 0xffffffff;
    let width = 0, height = 0;
    for (let i = 0; i < h; i++) {
      const j = 7 + i * 7, t = w[j] ? this.textures.get(w[j])!.native : this.screen!;
      width = Math.max(1, t.width >> w[j + 1]); height = Math.max(1, t.height >> w[j + 1]);
      this.passFormats.push(w[j] ? this.textures.get(w[j])!.desc.format : 0);
      colors.push({ view: this.view(t, w[j + 1]),
        loadOp: w[j + 2] ? 'clear' : 'load', storeOp: 'store', clearValue: w.slice(j + 3, j + 7).map(f) });
    }
    let depth: GPURenderPassDepthStencilAttachment | undefined;
    if (w[1]) {
      const t = this.textures.get(w[1])!;
      width = Math.max(1, t.native.width >> w[2]); height = Math.max(1, t.native.height >> w[2]);
      depth = { view: this.view(t.native, w[2]),
        depthLoadOp: w[3] ? 'clear' : 'load', depthStoreOp: 'store', depthClearValue: f(w[5]) };
      if (t.desc.format === 5) Object.assign(depth, { stencilLoadOp: w[4] ? 'clear' : 'load',
        stencilStoreOp: 'store', stencilClearValue: w[6] });
    }
    this.passSize = [width, height]; this.viewport = [0, 0, width, height, 0, 1]; this.stencilRef = 0;
    this.passDescriptor={ colorAttachments: colors, depthStencilAttachment: depth };
    this.scissor=[0,0,width,height]; this.blendConstant=[0,0,0,0];
    this.beginNative(this.passDescriptor); this.passKey = screenPass ? '' : key;
    this.pass!.setViewport(0, 0, width, height, 0, 1); this.resetView();
    this.pass!.setScissorRect(0, 0, width, height);
    this.pass!.setStencilReference(0);
    this.pass!.setBlendConstant([0, 0, 0, 0]);
  }

  /** K71 (Q128): create the GPUTexture with every reserved level on first use. WebGPU zero-initializes color/stencil;
   * BGT initializes depth to one, cleared by its own submission now (it precedes every later use: queue order, and
   * no earlier command can reference a texture that did not exist). Pixels and readbacks are unchanged. */
  private materialize(t: TextureResource): GPUTexture {
    const d = this.gpuDevice, desc = t.desc;
    const native = d.createTexture({ size: [desc.width, desc.height, desc.depth], mipLevelCount: t.allocatedMips,
      dimension: desc.dimension === 1 ? '3d' : '2d', format: formats[desc.format],
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC });
    this.lazyTextures.materialized++;
    const constants = t.constants; t.constants = undefined;
    if (isDepthFormat(desc.format)) {
      const encoder = d.createCommandEncoder();
      for (let mip = 0; mip < t.allocatedMips; mip++) {
        const c = constants?.[mip];
        const a: GPURenderPassDepthStencilAttachment = {
          view: native.createView({ baseMipLevel: mip, mipLevelCount: 1 }),
          depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: c?.depth === undefined ? 1 : f(c.depth),
        };
        if (desc.format === 5) Object.assign(a, { stencilLoadOp: 'clear', stencilStoreOp: 'store', stencilClearValue: c?.stencil ?? 0 });
        encoder.beginRenderPass({ colorAttachments: [], depthStencilAttachment: a }).end();
      }
      d.queue.submit([encoder.finish()]);
    } else if (constants?.some(c => c?.color)) {
      // Same clear as the deferred PASS_BEGIN would have issued (2D attachments only).
      const encoder = d.createCommandEncoder();
      for (let mip = 0; mip < t.allocatedMips; mip++) {
        const color = constants[mip]?.color;
        if (color) encoder.beginRenderPass({ colorAttachments: [{ view: native.createView({ baseMipLevel: mip, mipLevelCount: 1 }),
          loadOp: 'clear', storeOp: 'store', clearValue: color.map(f) }] }).end();
      }
      d.queue.submit([encoder.finish()]);
    }
    return native;
  }

  /** Grow an immutable WebGPU texture without losing already rendered/uploaded levels. */
  private growTexture(handle: number, allocatedMips: number): void {
    const d = this.gpuDevice, t = this.textures.get(handle)!;
    if (allocatedMips <= t.allocatedMips) return;
    if (allocatedMips > t.desc.mips) throw new Error('Texture mip allocation exceeds descriptor');
    if (!t.live) { t.allocatedMips = allocatedMips; return; } // K71: materialize() allocates every reserved level
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

  /** K64 diagnostics from the executor's own tables (no GPU queries). `bytes` equal the decoder's reservations. */
  memory(): GpuNativeMemory {
    let bytes = 0, nativeBytes = 0, bufferShadows = 0, textureBytes = 0, depthBytes = 0, textureShadows = 0;
    const lazy = { count: 0, bytes: 0, depthStencilBytes: 0 };
    for (const b of this.buffers.values()) { bytes += b.shadow.length; nativeBytes += b.native.size; bufferShadows += b.shadow.length; }
    for (const t of this.textures.values()) {
      const n = textureLevelBytes(t.desc, t.allocatedMips, TEXEL_BYTES[t.desc.format]);
      if (!t.live) { lazy.count++; lazy.bytes += n; if (isDepthFormat(t.desc.format)) lazy.depthStencilBytes += n; }
      else { textureBytes += n; if (isDepthFormat(t.desc.format)) depthBytes += n; }
      for (const u of t.uploads) textureShadows += u.data?.length ?? 0;
      textureShadows += t.generated?.source?.data?.length ?? 0;
    }
    const screenBytes = this.screen ? this.screen.width * this.screen.height * 4 : 0;
    let poolBytes = this.poolBytes, scratchBytes = 0;
    for (const b of this.retiredPool) poolBytes += b.size;
    for (const b of this.scratch) scratchBytes += b.size;
    for (const r of this.retiredDestroy) if ('size' in r && typeof r.size === 'number') scratchBytes += r.size;
    return { backend: 'webgpu', buffers: { count: this.buffers.size, bytes, nativeBytes },
      textures: { count: this.textures.size, bytes: textureBytes, depthStencilBytes: depthBytes, lazy },
      renderbuffers: { count: 0, bytes: 0 },
      internal: { bytes: screenBytes + poolBytes + scratchBytes, screenBytes, poolBytes, scratchBytes },
      shadows: { bufferBytes: bufferShadows, textureBytes: textureShadows } };
  }

  /** §13.7 TEXTURE_GENERATE_MIPS. 2D and array levels are box-filtered by render passes; 3D on the CPU
   * from the upload shadow (volumes can never be render targets, so the shadow is exact). */
  private generateMips(handle: number, base: number): void {
    const d = this.gpuDevice, t = this.textures.get(handle)!, desc = t.desc;
    this.growTexture(handle, desc.mips);
    if (!t.live && !isDepthFormat(desc.format) && !t.constants?.[base]) {
      // K71: a never-materialized base holds its creation value (0), so every generated level is 0 too: the levels
      // stay unallocated (constants above the base are overwritten), exactly as a zero chain reads back (and restores).
      if (t.constants) for (let mip = base + 1; mip < t.constants.length; mip++) t.constants[mip] = undefined;
      t.generated = { base, overridden: new Set() };
      t.uploads = t.uploads.filter(u => u.words[1] <= base);
      return;
    }
    const extent = mipExtent(desc, base), old = t.uploads.find(u => u.words[1] === base);
    // K64: a 2D/array base that was never uploaded is zero for recovery purposes, so its generated levels are too:
    // keep no zero source/chain shadows (render targets regenerating mips every frame allocated both per call).
    if (!old && desc.dimension !== 1) {
      t.generated = { base, overridden: new Set() };
      t.uploads = t.uploads.filter(u => u.words[1] <= base);
    }
    const data = old?.data!.slice() ?? new Uint8Array(desc.dimension === 1 ? extent.width * extent.height * extent.depth * TEXEL_BYTES[desc.format] : 0);
    const source: GpuItem = { kind: 'gpu', op: OP.TEXTURE_UPDATE_EX, words: [handle, base, 0, 0, 0,
      extent.width, extent.height, extent.depth, 0, data.length], data };
    if (old || desc.dimension === 1) t.generated = { base, source, overridden: new Set() };
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
    if (old) for (const level of generatedMipShadows(desc, base, data)) {
      const e = mipExtent(desc, level.mip), previous = t.uploads.findIndex(u => u.words[1] === level.mip);
      const shadow: GpuItem = { kind: 'gpu', op: OP.TEXTURE_UPDATE_EX, words: [handle, level.mip, 0, 0, 0,
        e.width, e.height, e.depth, 0, level.data.length], data: level.data };
      if (previous < 0) t.uploads.push(shadow); else t.uploads[previous] = shadow;
    }
  }

  /** Depth readback is an ordered depth-sampling conversion; stencil is not a sampleable WebGPU aspect. */
  private readDepthback(item: GpuItem, w: number[]): void {
    const d = this.gpuDevice, t = this.textures.get(w[0])!, [, mip, x, y, z, width, height, depth] = w;
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
    const d = this.gpuDevice, t = this.textures.get(w[0])!, [, mip, x, y, z, width, height, depth] = w;
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
    this.gpuDevice.queue.writeBuffer(buffer, offset, aligned);
  }

  private requirePipeline(handle: number): PipelineResource {
    const pipeline = this.pipelines.get(handle), failure = this.failedPipelines.get(handle) ?? pipeline?.failure;
    if (failure !== undefined) throw new Error(`Pipeline ${handle} creation failed: ${failure}`);
    if (!pipeline) throw new Error(`Pipeline ${handle} has no native executable`);
    return pipeline;
  }

  private requireCurrentPipeline(): PipelineResource {
    if (!this.current) throw new Error('No usable current pipeline for draw or feedback capture');
    return this.requirePipeline(this.current.words[0]);
  }

  private pipeline(w: readonly number[], depthSlots: ReadonlySet<number> = new Set(),
    sampling: readonly DepthSampling[] = [], integerSamplers: ReadonlyMap<number, readonly number[]> = new Map()): PipelineResource {
    const d = this.gpuDevice, buffers: GPUVertexBufferLayout[] = [], targets: GPUColorTargetState[] = [];
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
      buffer.arrayStride = buffer.arrayStride ? offset : 0; // K67: a stride-0 slot stays one shared element
    });
    const component = (src: number, dst: number, op: number): GPUBlendComponent => ({
      operation: blendOps[op], srcFactor: op >= 3 ? 'one' : factors[src], dstFactor: op >= 3 ? 'one' : factors[dst],
    });
    for (let i = 0; i < w[25]; i++, j += 9) {
      if (isIntegerFormat(w[j]) && w[j + 1]) throw new Error('Integer render targets cannot be blended');
      if (w[j] >= 10 && w[j] <= 12 && w[j + 1] && !d.features.has('float32-blendable')) {
        throw new Error('Blending 32-bit float targets needs the float32-blendable WebGPU feature');
      }
      // GL leaves attachments without a corresponding fragment output unchanged. WebGPU
      // instead rejects a nonzero write mask; intersect the immutable GL mask with the interface.
      targets.push({ format: formats[w[j]], writeMask: this.shaders.get(w[2])!.outputs.has(i) ? w[j + 8] : 0,
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
          b.type.startsWith('texture') || b.type === 'depth' ?
            { texture: { sampleType: b.type === 'depth' ? 'depth' as const : b.type.startsWith('textureI') ? 'sint' as const : b.type.startsWith('textureU') ? 'uint' as const : 'float' as const,
              viewDimension: b.type.endsWith('3d') ? '3d' as const :
                b.type.endsWith('2darray') ? '2d-array' as const : '2d' as const } } :
            { sampler: { type: b.type === 'comparison' ? 'comparison' as const :
              b.type === 'nonfiltering' ? 'non-filtering' as const : 'filtering' as const } }),
      })) }));
    const vs = this.shaders.get(w[1])!, fs = this.shaders.get(w[2])!;
    const varyingNames = [...new Set([
      ...glslVaryings(vs.item.source!, 1), ...glslVaryings(fs.item.source!, 2),
    ])].sort();
    // K62: GLSL pipelines pack their varyings into vec4 locations and apply the per-draw view transform.
    const glsl = !!vs.item.words[2], packing = glsl && fs.item.words[2] ? packVaryings(linkedVaryings(vs.item.source!, fs.item.source!)) : undefined;
    let fragmentCode = '';
    const linked = (s: ShaderResource) => {
      if (!s.item.words[2] && !sampling.length) return s.native;
      const source = s.item.words[2] ?
        translateGLSL(s.item.source!, s.item.words[1], s.item.words[2], varyingNames, depthSlots, integerSamplers,
          { packing, viewTransform: s === vs && glsl }) : s.item.source!;
      if (s === fs) fragmentCode = source;
      return d.createShaderModule({ code: lowerDepthSampling(source, sampling) });
    };
    if (glsl) layouts.push(this.viewTransforms().layout);
    let native: GPURenderPipeline, validation: Promise<GPUError | null>;
    d.pushErrorScope('validation');
    try {
      native = d.createRenderPipeline({ layout: d.createPipelineLayout({ bindGroupLayouts: layouts }),
        vertex: { module: linked(vs), entryPoint: 'vs_main', buffers },
        fragment: { module: linked(fs), entryPoint: 'fs_main', targets }, depthStencil,
        primitive: { topology: w[3] === 0 ? 'point-list' : w[3] <= 2 ? 'line-list' : 'triangle-list',
          cullMode: (['none', 'front', 'back'] as const)[w[4]], frontFace: w[5] ? 'cw' : 'ccw' } });
    } finally {
      // Even a synchronous translation/native exception must balance the owned scope.
      validation = d.popErrorScope().catch(e => new GPUValidationError(String(e)));
    }
    const pipeline: PipelineResource = { native, words: w, bindings: [...bindings.values()], repack, variants: new Map(), validation,
      view: glsl, flat: !!fs.item.words[2] && /@interpolate\(flat\)/.test(fragmentCode) };
    void validation.then(e => {
      if (!e) return;
      pipeline.failure = e.message;
      // A late result must not poison a deleted/reused handle (or an unrelated specialization).
      if (this.pipelines.get(w[0]) === pipeline) this.failedPipelines.set(w[0], e.message);
      this.error(`GPU pipeline ${w[0]}: ${e.message}`);
    });
    return pipeline;
  }

  private bind(): PipelineResource {
    let p = this.requireCurrentPipeline();
    const d = this.gpuDevice;
    // GLSL sampler2D may sample color or non-comparison depth. Specialize depth sampling by immutable sampler.
    const depthSlots = new Set(p.bindings.filter(b => (b.type === 'texture' || b.type === 'depth') && b.group === 1)
      .map(b => b.binding >> 1).filter(slot => isDepthFormat(this.textures.get(this.sampled.get(slot)![1])!.desc.format)));
    const glsl = !!this.shaders.get(p.words[1])!.item.words[2];
    const sampling = glsl ? [...depthSlots].filter(slot => p.bindings.some(b => b.binding === slot * 2 + 1 &&
      b.group === 1 && b.type !== 'comparison')).map(slot => ({ binding: slot * 2,
      sampler: this.samplers.get(this.sampled.get(slot)![2])!.words })) : [];
    const integerSamplers = new Map(p.bindings.filter(b => b.group === 1 && (b.type.startsWith('texture') || b.type === 'depth'))
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
    if (p.failure !== undefined) throw new Error(`Pipeline ${p.words[0]} specialization failed: ${p.failure}`);
    this.pass!.setPipeline(p.native);
    for (let slot = 0; slot < p.words[23]; slot++) {
      const w = this.vertices.get(slot)!, b = this.buffers.get(w[1])!;
      const r = p.repack.find(r => r.slot === slot);
      if (!r) { this.useBuffer(b.native, w[2], w[3]); this.pass!.setVertexBuffer(slot, b.native, w[2], w[3]); continue; }
      const stride = r.attributes.reduce((n, a) => n + a.size, 0), count = r.stride ? Math.ceil(w[3] / r.stride) : 1;
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
      if (b.group === 0) {
        const u = this.uniforms.get(b.binding)!; this.useBuffer(u.buffer, u.offset, u.size); uniforms.push({ binding: b.binding, resource: u });
      } else {
        const w = this.sampled.get(b.binding >> 1)!, t = this.textures.get(w[1])!; this.used.add(t.native);
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
    else if (p.view) this.pass!.setBindGroup(group, (p.empty ??= [])[group] ??= d.createBindGroup({ layout: p.native.getBindGroupLayout(group), entries: [] }));
    if (p.view) {
      this.pass!.setBindGroup(2, this.viewTransforms().group, [this.viewOffset]);
    } else if (!this.viewIdentity) throw new Error('A viewport extending past the attachment needs a GLSL vertex stage on WebGPU');
    return p;
  }

  private strip(item: GpuItem, flat = false): void {
    // Expand strips to lists: native indexed strips reserve all-ones as restart; BGT explicitly does not.
    // vK62: the list lives in the rotated-index ring, cached per store serial + contents version (or per first/count
    // for non-indexed strips), so a steady strip draw costs no buffer creation and no re-expansion.
    const w = item.words, triangle = this.current!.words[3] === 4;
    const indexed = item.op === OP.DRAW_INDEXED, b = indexed ? this.buffers.get(this.index![0])! : undefined;
    const size = this.index?.[1] ? 4 : 2, n = Math.max(0, w[0] - (triangle ? 2 : 1)) * (triangle ? 3 : 2);
    if (!n) return;
    const key = `strip:${indexed ? `${b!.serial}:${b!.version ?? 0}:${size}:${this.index![2] + w[2] * size}` : `-:${w[2]}`}:${w[0]}:${+triangle}:${+flat}`;
    this.rotatedIndices ??= new RotatedIndexRing(this.gpuDevice, r => this.retiredDestroy.push(r));
    const ring = this.rotatedIndices.get(key, () => {
      const view = b ? new DataView(b.shadow.buffer, b.shadow.byteOffset) : undefined, result = new Uint32Array(n);
      const at = (i: number) => !view ? w[2] + i : size === 4 ?
        view.getUint32(this.index![2] + (w[2] + i) * size, true) :
        view.getUint16(this.index![2] + (w[2] + i) * size, true);
      let k = 0;
      for (let i = 0; i < w[0] - (triangle ? 2 : 1); i++) {
        // K62: with flat inputs the GL provoking vertex (the last, i + 2 / i + 1) is drawn first.
        if (triangle) {
          const t = flat ? [at(i + 2), at(i + (i % 2)), at(i + 1 - (i % 2))] : [at(i + (i % 2)), at(i + 1 - (i % 2)), at(i + 2)];
          result[k++] = t[0]; result[k++] = t[1]; result[k++] = t[2];
        } else if (flat) { result[k++] = at(i + 1); result[k++] = at(i); }
        else { result[k++] = at(i); result[k++] = at(i + 1); }
      }
      return result;
    });
    this.pass!.setIndexBuffer(ring.buffer, 'uint32', ring.offset, ring.bytes);
    this.pass!.drawIndexed(n, w[1], 0, indexed ? w[3] | 0 : 0, indexed ? w[4] : w[3]);
    if (this.index) this.pass!.setIndexBuffer(this.buffers.get(this.index[0])!.native,
      this.index[1] ? 'uint32' : 'uint16', this.index[2], this.index[3]);
  }
}
