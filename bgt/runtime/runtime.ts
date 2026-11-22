// Browser runtime: manifest + asset preload, backend selection (WebGPU ->
// WebGL 2), game loop with fixed timestep, resize/DPR, input, audio,
// storage, device-loss recovery, diagnostics and error UI.

import {
  ABI_VERSION,
  BACKEND_WEBGL2,
  BACKEND_WEBGPU,
  CAP_AUDIO,
  CAP_GPU, /* LANE-WG/W2: negotiate only an executable GPU backend. */
  CAP_DIRECT_DRAW,
  CAP_GAMEPAD,
  CAP_LINEAR_FILTER,
  CAP_RENDER_TARGETS,
  CAP_READBACK,
  CAP_STREAM_FILES,
  CAP_SCISSOR,
  CAP_STORAGE,
  CAP_TOUCH,
  CAP_TRIANGLES,
  DT_US,
  FLAG_INTEGER_SCALE,
  LIMITS,
  GPU_CONTINUATION_LIMITS,
  OP,
} from './abi';
import type { CommandError, DecodeResult, Frame } from './commands';
import { GameHost, InputSnapshot, emptyInput, OutsideSlice, type HostServices } from './host';
import { Vfs } from './vfs';
import { RangeFiles, OutsideDataRange, type StreamedFile } from './range-files';
import { WebAudioSink } from '../audio/audio';
import { InputManager, TestInputEvent, TouchConfig, InputConfig } from '../input/input';
import { BrowserStorage } from '../storage/storage';
import { WebGPURenderer } from '../renderers/webgpu/webgpu';
import { WebGL2Renderer } from '../renderers/webgl2/webgl2';
import { Letterbox, Pixels, Renderer, computeLetterbox } from '../renderers/types';

export type BackendPreference = 'auto' | 'webgpu' | 'webgl2' | 'webgpu-fail' | 'none';

export interface RuntimeOptions {
  container: HTMLElement;
  gameUrl: string; // directory containing manifest.json, trailing slash
  backend?: BackendPreference;
  debug?: boolean;
  /** K53: opt-in GPU timing (WebGPU timestamp-query / WebGL disjoint timer query). */
  gpuTiming?: boolean;
  /** K53: false restores per-pass native submission (WebGPU) / framebuffer release (WebGL) for A/B checks. */
  gpuBatch?: boolean;
  seed?: number;
  arg0?: number;
  arg1?: number;
  touch?: 'auto' | 'on' | 'off';
  ephemeralStorage?: boolean;
  directDraw?: boolean;
  autostart?: boolean;
  /** K64: estimated-total memory budget (bytes) for the iPhone-class warning; overrides ?memorybudget= and the manifest. */
  memoryBudgetBytes?: number;
  /** Start with the simulation paused (deterministic tests step from frame 0). */
  startPaused?: boolean;
  /** Opt-in JSPI; both manifest and runtime request must opt in. */
  suspension?: 'asyncify' | 'jspi';
  /** K66: wall budget (ms) per display tick for updates that continue after a time-neutral transport yield;
   * 0 restores one update per tick (A/B). Default TRANSPORT_BURST_MS. */
  ioBurstMs?: number;
  onProgress?: (loaded: number, total: number, label: string) => void;
}

export interface Manifest {
  schema: string;
  id: string;
  name: string;
  abi: string;
  private?: boolean;
  wasm: { url: string; size: number; sha256: string };
  assets: Array<{ path: string; url: string; size: number; sha256: string }>;
  streams?: StreamedFile[];
  pipeline?: { modules: {name:string;base:number;sha256:string}[] };
  variants?: { jspi?: {url:string;size:number;sha256:string} };
  preferredSuspension?: 'jspi'; // Per-game opt-in, still requiring API + variant.
  suspension?: 'jspi'; // Explicit JSPI-only package: fail clearly without the API, never treat raw wasm as Asyncify.
  gpu?: { budgetBytes?: number };
  /** K64: estimated-total memory budget for this game (game.json "memoryBudget"); default 1.5 GiB. */
  memoryBudget?: { bytes?: number };
  slice?: {code?:number[];codeRanges?:{addr:number;end:number}[];data?:boolean};
  touch?: TouchConfig;
  input?: InputConfig;
}

export interface RuntimeErrorRecord {
  kind: 'trap' | 'abort' | 'gpu' | 'asset' | 'init' | 'js' | 'device-lost';
  message: string;
  time: number;
  frame: number;
}

import { compileVerifiedWasm } from './wasm-loader';
import { selectWasmVariant, suspensionCapabilities, type SuspensionCapabilities } from './jspi';
import { retainedAccumulator, continueTransport, TRANSPORT_BURST_MS } from './page-pacing';
import { newPageLog, pageLogPush, summarizePageWindow, type PageLoopLog, type PageWindowSummary } from './page-fps';
import { guestMemoryFromMetrics, memoryBreakdown, resolveMemoryBudget, type MemoryBudgetSource, type MemoryDiagnostics, type MemoryInputs } from './memory';
import { loadSummary, type LoadDiagnostics, type LoadMarks, type ResourceTransfer } from './load-metrics';

export interface BGTDiagnostics {
  abi: string;
  suspension: 'asyncify' | 'jspi' | null;
  suspensionSelection: SuspensionCapabilities | null;
  game: { id: string; name: string } | null;
  backend: 'webgpu' | 'webgl2' | 'unavailable';
  backendNotes: string[];
  nativeQueryPolicy: 'production' | 'strict' | null;
  /** K51: native device identity and the uniform range reported to the guest (§13.6 offset 52); null without CAP_GPU. */
  gpuDevice: { renderer: string | null; software: boolean; nativeMaxUniformRange: number; maxUniformRange: number; languages: number } | null;
  ready: boolean;
  paused: boolean;
  failed: boolean;
  frame: number;
  logical: { width: number; height: number };
  canvas: { cssWidth: number; cssHeight: number; width: number; height: number; dpr: number };
  letterbox: Letterbox;
  wasmMemoryBytes: number;
  textures: { count: number; bytes: number };
  gpu: { budgetBytes: number; reservedBytes: number; peakReservedBytes: number; largestAllocationBytes: number } | null;
  assets: { count: number; bytes: number; missing: string[] };
  timing: {
    frameIntervalMs: { last: number; avg: number; p95: number };
    updateMs: number;
    renderMs: number;
    decodeMs: number;
    gpuSubmitMs: number;
    wasmDownloadCompileVerifyMs: number;
    wasmInstantiateMs: number;
    wasmStreaming: boolean;
  };
  lastFrame: { drawCalls: number; passes: number; vertices: number; commandBytes: number; submits: number;
    commandCount: number; continuationSubmits: number; continuationByteLimit: number; continuationCommandLimit: number;
    /** K53 native census (see GpuStats): encoded render passes, GPUQueue submits, merged §13 passes,
     * WebGPU buffer renames, opt-in GPU ms (null when off/unavailable/pending) and its source. */
    nativePasses: number; nativeSubmits: number; mergedPasses: number; bufferRenames: number; skippedBinds: number;
    gpuMs: number | null; gpuTiming: string;
    /** K60 WebGPU only (0 elsewhere): rename bytes, transform-feedback translation/lowering cache misses. */
    renameBytes: number; captureTranslations: number; captureLowerings: number;
    nativeSyncQueries?: { getError: number; checkFramebufferStatus: number; generatedBufferReadbacks: number } | null;
    nativeSyncQueryOps?: Record<string, { getError: number; checkFramebufferStatus: number }> | null };
  commandErrors: { count: number; recent: CommandError[] };
  audio: { state: string; unlocked: boolean; sampleRate: number; droppedFrames: number; playedFrames: number; queued: number };
  storage: { persistent: boolean };
  deviceResets: number;
  errors: RuntimeErrorRecord[];
  logs: Array<{ level: number; message: string; frame: number }>;
  stateHashAvailable: boolean;
  debugStateAvailable: boolean;
  /** v0.2: updates that ended suspended in bgt_yield, and whether the game is parked there now */
  yields: number;
  suspended: boolean;
  outsideSlice: {kind:number;address:number;message:string} | null;
  /** v0.2: the game's own kit metrics (bgt_metrics export), if any */
  metrics: unknown;
  /** kit coverage: BGT commands executed (by name) and runtime imports called */
  coverage: { ops: Record<string, number>; imports: Record<string, number> };
  /** K64: memory attribution by component, an estimated total and the iPhone-class budget check. */
  memory: MemoryDiagnostics;
  /** K64: load phases (manifest, wasm download/compile/instantiate, init, first frame/update) and transfer evidence. */
  load: LoadDiagnostics;
}

export class RuntimeFailure extends Error {
  constructor(
    readonly kind: RuntimeErrorRecord['kind'],
    message: string,
  ) {
    super(message);
    this.name = 'RuntimeFailure';
  }
}

const STEP_MS = DT_US / 1000;
const OP_NAMES: Record<number, string> = Object.fromEntries(Object.entries(OP).map(([k, v]) => [v, k]));
const LOST_TIMEOUT_MS = 5000;

async function sha256Hex(data: ArrayBuffer): Promise<string | null> {
  if (!crypto?.subtle) return null; // insecure context (e.g. LAN http on a phone)
  const d = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class BGTRuntime {
  private suspensionSelection: SuspensionCapabilities | null = null;
  /** Installed only by the opt-in test API, before start(). */
  declare testHarness?: {
    services(s: HostServices): HostServices;
    updated(): void;
    afterFrame?(): Promise<void>;
    frame(frame: Frame, letterbox: Letterbox, update: number, width: number, height: number): void;
  };
  declare testHostFactory?: (renderer: Renderer) => Promise<GameHost>;
  declare testQuiescent: () => boolean;
  private stepping = false;
  declare testCheckpointBusy: boolean;
  manifest: Manifest | null = null;
  host: GameHost | null = null;
  renderer: Renderer | null = null;
  /** Debug recorder only; awaited before rendering so uploads cannot race frame consumption. */
  frameObserver?: (frame: Frame, letterbox: Letterbox, update: number, width: number, height: number) => Promise<void>;
  canvas: HTMLCanvasElement;
  readonly vfs = new Vfs();
  readonly audio = new WebAudioSink();
  storage: BrowserStorage | null = null;
  input: InputManager;
  ready = false;
  paused = false;
  failed = false;
  outsideSlice: {kind:number;address:number;message:string} | null = null;
  private loadStarted = 0;
  private wasmLoadMs = 0;
  private wasmStreaming = false;
  private firstFrameMs: number | null = null;
  /** K64 load/memory bookkeeping. */
  private loadMarks: LoadMarks = { manifestMs: null, wasmMs: null, assetsMs: null, instantiateMs: null, initMs: null, readyMs: null,
    firstFrameMs: null, firstUpdateMs: null };
  private wasmEvidence: { url: string; bytes: number; streamingReason: string; contentType: string | null; contentEncoding: string | null;
    memoryLimits: { initialBytes: number; maximumBytes: number | null } | null } | null = null;
  private wasmTransfer: ResourceTransfer | null = null;
  private linearAtInstantiate = 0;
  private memoryBudget: { bytes: number; source: MemoryBudgetSource } = resolveMemoryBudget();
  private memoryPeaks = { linear: 0, total: 0 };
  /** Load-time buffers the runtime still holds, for the milestone peak samples (vK64). */
  private loadBuffers = 0;
  private frameTimes: number[] = [];
  private gpuWallMs = 0;
  private gpuSubmitTotalMs = 0;
  private executionMetrics() {
    const m=this.host?.metrics();
    return m && typeof m==='object' ? {...m,runtime_profile:{
      suspension:this.host?.config.suspensionMode ?? 'asyncify',
      gpuDrawWallMs:this.gpuWallMs,gpuSubmitMs:this.gpuSubmitTotalMs,
      vfs:this.rangeFiles?.timing ?? null}} : m ?? null;
  }
  private sliceEvents = 0;
  private renderTail: Promise<void> = Promise.resolve();
  private renderBusy = false;
  private renderQueued = 0;
  // A recorder sink can yield to ResizeObserver. Keep the backing store and
  // scale fixed until that recorded frame has actually finished drawing.
  private recordingFrame = false;
  private recordingResizePending = false;
  private noteOutside(kind:number,address:number,message:string):void {
    this.outsideSlice={kind,address,message};this.sliceEvents++;this.pause();this.status(message);
  }
  private rangeFiles: RangeFiles | null = null;
  private snap: InputSnapshot = emptyInput();
  private raf = 0;
  private last = 0;
  private acc = 0;
  private intervals: number[] = [];
  /** K51: real-page loop log (rAF ticks and completed canvas presents), allocated only while measurePage runs. */
  private pageLog: PageLoopLog | null = null;
  private presentsCompleted = 0;
  private errors: RuntimeErrorRecord[] = [];
  private logs: Array<{ level: number; message: string; frame: number }> = [];
  private backendNotes: string[] = [];
  private letterbox: Letterbox = { x: 0, y: 0, w: 1, h: 1, scale: 1 };
  private dpr = 1;
  private cssW = 0;
  private cssH = 0;
  private deviceResets = 0;
  private resizeObs: ResizeObserver | null = null;
  private lastFrameStats = { nativePasses: 0, nativeSubmits: 0, mergedPasses: 0, bufferRenames: 0, skippedBinds: 0,
    renameBytes: 0, captureTranslations: 0, captureLowerings: 0,
    gpuMs: null as number | null, gpuTiming: 'off', drawCalls: 0, passes: 0, vertices: 0, commandBytes: 0, submits: 0,
    commandCount: 0, continuationSubmits: 0, continuationByteLimit: GPU_CONTINUATION_LIMITS.bytes as number,
    continuationCommandLimit: GPU_CONTINUATION_LIMITS.commands as number };
  private stage: HTMLElement;
  private statusEl: HTMLElement;

  constructor(private readonly opts: RuntimeOptions) {
    const c = opts.container;
    c.classList.add('bgt-root');
    this.stage = document.createElement('div');
    this.stage.className = 'bgt-stage';
    this.statusEl = document.createElement('div');
    this.statusEl.className = 'bgt-status';
    this.statusEl.setAttribute('role', 'status');
    this.statusEl.setAttribute('aria-live', 'polite');
    c.append(this.stage, this.statusEl);
    this.canvas = this.newCanvas();
    this.input = new InputManager(this.canvas);
  }

  private newCanvas(): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.className = 'bgt-canvas';
    cv.tabIndex = 0;
    cv.setAttribute('aria-label', 'Game display');
    this.stage.replaceChildren(cv);
    return cv;
  }

  private status(text: string, progress?: number): void {
    this.statusEl.replaceChildren();
    if (!text) {
      this.statusEl.hidden = true;
      return;
    }
    this.statusEl.hidden = false;
    const p = document.createElement('p');
    p.textContent = text;
    this.statusEl.append(p);
    if (progress !== undefined) {
      const bar = document.createElement('progress');
      bar.max = 1;
      bar.value = progress;
      bar.setAttribute('aria-label', 'Loading progress');
      this.statusEl.append(bar);
    }
  }

  private record(kind: RuntimeErrorRecord['kind'], message: string): void {
    this.errors.push({ kind, message, time: performance.now(), frame: this.host?.frameIndex ?? 0 });
    if (this.errors.length > 100) this.errors.shift();
  }

  /** Stop the game and show an accessible error panel. */
  fail(kind: RuntimeErrorRecord['kind'], err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.record(kind, message);
    console.error(`[bgt] ${kind}: ${message}`);
    if (this.failed) return;
    this.failed = true;
    cancelAnimationFrame(this.raf);
    const panel = document.createElement('div');
    panel.className = 'bgt-error';
    panel.setAttribute('role', 'alert');
    const h = document.createElement('h2');
    h.textContent = kind === 'init' && /WebGPU|WebGL/.test(message) ? 'Graphics not available' : 'The game stopped';
    const p = document.createElement('p');
    p.textContent = message;
    panel.append(h, p);
    if (this.renderer?.kind !== 'webgl2' && kind !== 'asset') {
      const a = document.createElement('a');
      const u = new URL(location.href);
      u.searchParams.set('backend', 'webgl2');
      a.href = u.toString();
      a.textContent = 'Try again with WebGL 2';
      panel.append(a);
    }
    this.opts.container.append(panel);
    this.status('');
  }

  async start(): Promise<void> {
    try {
      await this.load();
    } catch (e) {
      this.fail(e instanceof RuntimeFailure ? e.kind : 'init', e);
      return;
    }
    if (this.opts.autostart !== false) this.loop();
  }

  private async fetchBytes(url: string, label: string, onBytes: (n: number) => void, expectedSize?: number): Promise<ArrayBuffer> {
    let res: Response;
    try {
      res = await fetch(url);
    } catch (e) {
      throw new RuntimeFailure('asset', `network error loading ${label}: ${(e as Error).message}`);
    }
    if (!res.ok) throw new RuntimeFailure('asset', `failed to load ${label} (HTTP ${res.status})`);
    if (!res.body) {
      const b = await res.arrayBuffer();
      onBytes(b.byteLength);
      return b;
    }
    const reader = res.body.getReader();
    // K64: with a manifest size, read straight into one buffer instead of chunks + a concatenated copy.
    if (expectedSize !== undefined && Number.isSafeInteger(expectedSize) && expectedSize >= 0) {
      const out = new Uint8Array(expectedSize);
      let n = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (n + value.byteLength > expectedSize) throw new RuntimeFailure('asset', `integrity check failed for ${label} (larger than manifest size)`);
          out.set(value, n); n += value.byteLength; onBytes(value.byteLength);
        }
      } catch (e) { void reader.cancel().catch(() => {}); throw e; }
      if (n !== expectedSize) throw new RuntimeFailure('asset', `integrity check failed for ${label} (size ${n}, manifest ${expectedSize})`);
      return out.buffer;
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
      onBytes(value.byteLength);
    }
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.byteLength;
    }
    return out.buffer;
  }

  private async load(): Promise<void> {
    this.loadStarted=performance.now();
    const base = this.opts.gameUrl;
    this.status('Loading game…', 0);
    let res: Response;
    try {
      res = await fetch(`${base}manifest.json`, { cache: 'no-cache' });
    } catch (e) {
      throw new RuntimeFailure('asset', `could not fetch game manifest: ${(e as Error).message}`);
    }
    // Dev servers may answer unknown paths with index.html (200), so check the type too.
    const isJson = (res.headers.get('content-type') ?? '').includes('json');
    if (!res.ok || !isJson) {
      throw new RuntimeFailure('asset', `game not found: ${base}manifest.json (HTTP ${res.status}). Did you run the build?`);
    }
    const manifest = (await res.json()) as Manifest;
    if (manifest.schema !== 'bgt-manifest/1') throw new RuntimeFailure('asset', `unsupported manifest schema ${manifest.schema}`);
    this.manifest = manifest;
    this.loadMarks.manifestMs = performance.now() - this.loadStarted;
    this.memoryBudget = this.resolveBudget(manifest);
    this.rangeFiles = new RangeFiles(base);
    for (const file of manifest.streams ?? []) { this.rangeFiles.add(file); this.vfs.addStream(file.path,file.size,file.chunks); }
    document.title = `${manifest.name} — Game Cask`;

    const requested = this.opts.suspension ?? new URLSearchParams(location.search).get('suspension');
    this.suspensionSelection = suspensionCapabilities(manifest, requested);
    const variant = selectWasmVariant(manifest, requested, this.suspensionSelection.supported);
    const total = variant.artifact.size + manifest.assets.reduce((n, a) => n + a.size, 0);
    let loaded = 0;
    const tick = (n: number) => {
      loaded += n;
      this.status('Loading game…', total ? loaded / total : 1);
      this.opts.onProgress?.(loaded, total, manifest.name);
    };
    const verify = async (buf: ArrayBuffer, expect: string, label: string) => {
      const got = await sha256Hex(buf);
      if (got && got !== expect) throw new RuntimeFailure('asset', `integrity check failed for ${label}`);
    };
    const wasmUrl = base + variant.artifact.url;
    const wasmP = fetch(wasmUrl).then((res) => ((import.meta.env.DEV || import.meta.env.VITE_BGT_TEST === '1') ? compileVerifiedWasm(res,variant.artifact,tick,!!this.testHarness) : compileVerifiedWasm(res,variant.artifact,tick))).then((result) => {
      this.wasmLoadMs = result.downloadCompileVerifyMs;
      this.wasmStreaming = result.streaming;
      this.loadMarks.wasmMs = performance.now() - this.loadStarted;
      this.wasmEvidence = { url: wasmUrl, bytes: variant.artifact.size, streamingReason: result.streamingReason,
        contentType: result.contentType, contentEncoding: result.contentEncoding, memoryLimits: result.memoryLimits };
      // Load-peak sample: the verified download buffer was live until compilation finished.
      this.loadBuffers = variant.artifact.size; this.samplePeak(); this.loadBuffers = 0;
      return result.module;
    }).catch((e: unknown) => { throw new RuntimeFailure('asset', `game.wasm: ${(e as Error).message}`); });
    // Chunked preload with bounded concurrency.
    const queue = [...manifest.assets];
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (let a = queue.shift(); a; a = queue.shift()) {
        const b = await this.fetchBytes(base + a.url, a.path, tick, a.size);
        await verify(b, a.sha256, a.path);
        this.vfs.add(a.path, new Uint8Array(b));
      }
    });
    const assetsP = Promise.all(workers).then(() => { this.loadMarks.assetsMs = performance.now() - this.loadStarted; });
    const [wasm] = await Promise.all([wasmP, assetsP]);

    this.status('Starting graphics…');
    this.renderer = await this.pickRenderer(this.opts.backend ?? 'auto');
    this.input = new InputManager(this.canvas, manifest.input);
    if (!((import.meta.env.DEV || import.meta.env.VITE_BGT_TEST === '1') && this.testHarness)) this.input.attach();
    if ((import.meta.env.DEV || import.meta.env.VITE_BGT_TEST === '1')) this.input.scriptedOnly = !!this.testHarness;
    this.wireRenderer(this.renderer);

    this.storage = new BrowserStorage(manifest.id, { ephemeral: ((import.meta.env.DEV || import.meta.env.VITE_BGT_TEST === '1') && !!this.testHarness) || this.opts.ephemeralStorage });
    if (!((import.meta.env.DEV || import.meta.env.VITE_BGT_TEST === '1') && this.testHarness)) this.audio.armUnlock();
    this.audio.onUnlock(() => this.input.markEvent('audioUnlocked'));

    const touch = this.opts.touch ?? 'auto';
    const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (!((import.meta.env.DEV || import.meta.env.VITE_BGT_TEST === '1') && this.testHarness) && (touch === 'on' || (touch === 'auto' && coarse))) this.input.createOverlay(this.opts.container, manifest.touch ?? {});

    let caps = CAP_AUDIO | CAP_SCISSOR | CAP_TRIANGLES | CAP_LINEAR_FILTER | CAP_GAMEPAD | CAP_RENDER_TARGETS | CAP_READBACK | CAP_STREAM_FILES;
    /* LANE-WG/W2 */ if (this.renderer.gpu?.languages) caps |= CAP_GPU;
    if (this.storage.persistent) caps |= CAP_STORAGE;
    if (hasTouch) caps |= CAP_TOUCH;
    if (this.opts.directDraw) caps |= CAP_DIRECT_DRAW;

    this.measure();
    try {
      const services: HostServices = {
          log: (level, message) => this.gameLog(level, message),
          vfs: this.vfs,
          audio: this.audio,
          gamepadRumble: (index, left, right) => this.input.rumble(index, left, right),
          storage: this.storage,
          now: () => performance.now(),
          rangeRead: async (path,offset,length,ahead) => {
            try{return await this.rangeFiles!.read(path,offset,length,ahead);}catch(e){
              if(e instanceof OutsideDataRange){this.noteOutside(2,e.offset,e.message);}
              throw e;
            }
          },
        };
      const actualServices = (import.meta.env.DEV || import.meta.env.VITE_BGT_TEST === '1') ? this.testHarness?.services(services) ?? services : services;
      const config = {
          backend: this.renderer.kind === 'webgpu' ? BACKEND_WEBGPU : BACKEND_WEBGL2,
          caps,
          /* LANE-WG/W2 */ gpuBackend: this.renderer.gpu,
          seed: this.opts.seed ?? 1,
          displayWidth: this.canvas.width,
          displayHeight: this.canvas.height,
          arg0: this.opts.arg0 ?? 0,
          arg1: this.opts.arg1 ?? 0,
          maxTextureDimension: this.renderer.maxTextureSize,
          gpuBudgetBytes: manifest.gpu?.budgetBytes,
          sliceCode: manifest.slice?.code,
          sliceCodeRanges: manifest.slice?.codeRanges,
          suspensionMode: variant.mode,
        };
      if ((import.meta.env.DEV || import.meta.env.VITE_BGT_TEST === '1')) this.testHostFactory = this.testHarness ? (renderer) => GameHost.create(wasm,actualServices,
        {...config,gpuBackend:renderer.gpu}) : undefined;
      this.host = await GameHost.create(wasm,actualServices,config);
      this.linearAtInstantiate = this.host.memoryBytes;
      this.loadMarks.instantiateMs = this.host.instantiateMs;
      this.samplePeak();
      const initStart = performance.now();
      this.host.init();
      this.loadMarks.initMs = performance.now() - initStart;
      this.samplePeak();
    } catch (e) {
      throw new RuntimeFailure(e instanceof Error && e.name === 'GameAbort' ? 'abort' : 'init', e instanceof Error ? e.message : String(e));
    }
    if (this.host.textures.totalBytes > LIMITS.textureBytes) throw new RuntimeFailure('init', 'texture budget exceeded');

    this.resizeObs = new ResizeObserver(() => this.applySize());
    this.resizeObs.observe(this.stage);
    window.addEventListener('resize', () => this.applySize());
    this.applySize();
    this.status('');
    if (this.opts.startPaused) this.paused = true;
    this.ready = true;
    this.loadMarks.readyMs = performance.now() - this.loadStarted;
    this.samplePeak();
    this.canvas.focus({ preventScroll: true });
  }

  private lostSince = 0;

  private wireRenderer(r: Renderer): void {
    r.onError((m) => {
      if (r !== this.renderer) return;
      this.record('gpu', m);
      console.error(`[bgt] gpu: ${m}`);
    });
    r.onLost((reason) => {
      if (r !== this.renderer) return;
      this.lostSince = performance.now();
      this.record('device-lost', reason);
      console.warn(`[bgt] ${reason}`);
    });
    r.onRestored(() => {
      if (r !== this.renderer || !this.host) return;
      this.lostSince = 0;
      r.restoreTextures(this.host.textures);
      this.deviceResets++;
      this.input.markEvent('deviceReset');
      /* LANE-WG/W2: advertised §13 attachment contents are lost on restoration too. */
      if ((this.host.config.caps & CAP_GPU) || [...this.host.textures.entries.values()].some((e) => e.renderTarget)) {
        this.input.markEvent('targetsLost');
      }
      this.applySize();
    });
    r.onUnrecoverable((reason) => {
      if (r !== this.renderer) return;
      this.switchToWebGL2(reason);
    });
  }

  /**
   * Unrecoverable GPU loss: continue on WebGL 2 with a fresh canvas (a canvas that
   * produced a WebGPU context cannot produce WebGL). Textures come back from the
   * runtime's CPU shadow copies; the simulation is untouched. If WebGL 2 is
   * already the backend, or cannot be created, stop with an accessible error.
   */
  private switchToWebGL2(reason: string): void {
    const old = this.renderer;
    if (!this.host || this.failed) return;
    /* LANE-WG/W2: no live §13 descriptor/language migration. Legacy 2D can renegotiate below. */
    if (!old || old.kind === 'webgl2') {
      this.fail('device-lost', `graphics device lost and could not be recovered (${reason})`);
      return;
    }
    if (this.host.hasGpuWork || (old instanceof WebGPURenderer && old.gpu.hasResources)) {
      this.fail('device-lost', `Cannot restore live GPU resources on WebGL 2 fallback: ${reason}`);
      return;
    }
    console.warn(`[bgt] ${reason}; switching to WebGL 2`);
    this.canvas = this.newCanvas();
    const gl = WebGL2Renderer.create(this.canvas, { debug: !!this.opts.debug, gpuTiming: !!this.opts.gpuTiming, batch: this.opts.gpuBatch });
    if (!gl) {
      this.fail('device-lost', `WebGPU device lost (${reason}) and WebGL 2 is unavailable`);
      return;
    }
    old.destroy();
    this.renderer = gl;
    this.wireRenderer(gl);
    this.input.retarget(this.canvas);
    this.lostSince = 0;
    this.measure();
    gl.restoreTextures(this.host.textures);
    if ([...this.host.textures.entries.values()].some((e) => e.renderTarget)) this.input.markEvent('targetsLost');
    this.host.setBackend(BACKEND_WEBGL2, gl.gpu);
    this.backendNotes.push(`webgpu: device lost and not recoverable (${reason}); switched to webgl2`);
    this.deviceResets++;
    this.input.markEvent('deviceReset');
    this.applySize();
  }

  /** Loss that neither recovers nor reports failure within the timeout is treated as unrecoverable. */
  private checkLossWatchdog(): void {
    if (this.renderer?.lost && this.lostSince && performance.now() - this.lostSince > LOST_TIMEOUT_MS) {
      this.switchToWebGL2(`no recovery within ${LOST_TIMEOUT_MS} ms`);
    }
  }

  private async pickRenderer(pref: BackendPreference): Promise<Renderer> {
    const debug = !!this.opts.debug;
    if (pref === 'none') throw new RuntimeFailure('init', 'No supported graphics backend (forced by ?backend=none). This game needs WebGPU or WebGL 2.');
    if (pref === 'auto' || pref === 'webgpu' || pref === 'webgpu-fail') {
      if (pref === 'webgpu-fail') {
        this.backendNotes.push('webgpu: initialization deliberately failed (?backend=webgpu-fail)');
      } else {
        try {
          const r = await WebGPURenderer.create(this.canvas, { debug, gpuTiming: !!this.opts.gpuTiming, batch: this.opts.gpuBatch });
          if (r) return r;
          this.backendNotes.push(navigator.gpu ? 'webgpu: no adapter available' : 'webgpu: navigator.gpu not present');
        } catch (e) {
          this.backendNotes.push(`webgpu: init failed: ${(e as Error).message}`);
        }
        if (pref === 'webgpu') throw new RuntimeFailure('init', `WebGPU was required (?backend=webgpu) but is unavailable: ${this.backendNotes.join('; ')}`);
      }
      // A canvas that handed out a 'webgpu' context cannot give WebGL; use a fresh one.
      this.canvas = this.newCanvas();
    }
    const gl = WebGL2Renderer.create(this.canvas, { debug, gpuTiming: !!this.opts.gpuTiming, batch: this.opts.gpuBatch });
    if (gl) return gl;
    this.backendNotes.push('webgl2: context creation failed');
    throw new RuntimeFailure('init', `Neither WebGPU nor WebGL 2 is available in this browser. (${this.backendNotes.join('; ')})`);
  }

  private measure(): void {
    const r = this.stage.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.cssW = Math.max(1, Math.round(r.width));
    this.cssH = Math.max(1, Math.round(r.height));
    const max = Math.min(this.renderer?.maxTextureSize ?? 4096, 4096);
    const w = Math.min(max, Math.max(1, Math.round(this.cssW * this.dpr)));
    const h = Math.min(max, Math.max(1, Math.round(this.cssH * this.dpr)));
    if (this.canvas.width !== w || this.canvas.height !== h) this.renderer?.resize(w, h);
  }

  private applySize(): void {
    if ((import.meta.env.DEV || import.meta.env.VITE_BGT_TEST === '1') && this.testCheckpointBusy) return;
    if (this.recordingFrame) {
      this.recordingResizePending = true;
      return;
    }
    const prevW = this.canvas.width, prevH = this.canvas.height;
    this.measure();
    if (!this.host) return;
    this.letterbox = computeLetterbox(
      this.canvas.width,
      this.canvas.height,
      this.host.logicalWidth,
      this.host.logicalHeight,
      (this.host.flags & FLAG_INTEGER_SCALE) !== 0,
    );
    this.input.letterbox = this.letterbox;
    this.input.logicalW = this.host.logicalWidth;
    this.input.logicalH = this.host.logicalHeight;
    this.input.dpr = this.dpr;
    if (prevW !== this.canvas.width || prevH !== this.canvas.height) {
      this.host.setDisplaySize(this.canvas.width, this.canvas.height);
      this.input.markEvent('resized');
    }
    // Repaint immediately when paused so the canvas never shows a cleared buffer.
    if (this.ready && this.paused && !this.failed) void this.renderFrame(false);
  }

  private gameLog(level: number, message: string): void {
    const frame = this.host?.frameIndex ?? 0;
    this.logs.push({ level, message, frame });
    if (this.logs.length > 500) this.logs.shift();
    const line = `[game] ${message}`;
    if (level >= 3) console.error(line);
    else if (level === 2) console.warn(line);
    else if (this.opts.debug) console.debug(line);
  }

  private guard<T>(fn: () => T): T | undefined {
    try {
      return fn();
    } catch (e) {
      if(e instanceof OutsideSlice) {
        this.noteOutside(e.kind,e.address,e.message);return undefined;
      }
      const isTrap = e instanceof WebAssembly.RuntimeError;
      const isAbort = e instanceof Error && e.name === 'GameAbort';
      this.fail(isTrap ? 'trap' : isAbort ? 'abort' : 'js', isTrap ? `wasm trap: ${(e as Error).message}` : e);
      return undefined;
    }
  }

  private async stepGuarded(): Promise<void> {
    try { await this.stepOnce(); } catch (e) { this.guard(() => {throw e;}); }
  }

  private async stepOnce(): Promise<void> {
    const host = this.host!;
    this.input.snapshot(this.snap);
    host.writeInput(this.snap);
    await host.update();
    if (this.loadMarks && this.loadMarks.firstUpdateMs === null && this.ready) this.loadMarks.firstUpdateMs = performance.now() - this.loadStarted;
    if ((import.meta.env.DEV || import.meta.env.VITE_BGT_TEST === '1')) this.testHarness?.updated();
    if (host.sizeChanged) {
      host.sizeChanged = false;
      this.applySize();
    }
  }

  /** Render serially: async readbacks must not race the next frame's command buffers. */
  renderFrame(readback:boolean):Promise<Pixels|null> {
    if ((import.meta.env.DEV || import.meta.env.VITE_BGT_TEST === '1') && this.testCheckpointBusy) return Promise.reject(new Error('Savestate operation in progress'));
    this.renderQueued++;
    const work=this.renderTail.then(async()=>{this.renderBusy=true;try{return await this.renderNow(readback);}finally{this.renderBusy=false;this.renderQueued--;}});
    this.renderTail=work.then(()=>{},()=>{});return work;
  }

  /** Render the current state; optionally read back pixels. */
  private async renderNow(readback: boolean): Promise<Pixels | null> {
    const started=performance.now();
    const host = this.host;
    const r = this.renderer;
    if (!host || !r || this.failed || r.lost) return null;
    if(this.outsideSlice)return null;
    const frame = this.guard(() => host.render());
    if (!frame) return null;
    let out: Pixels | null | Promise<Pixels | null> = null;
    const gpuStart=performance.now();
    try {
      let letterbox = this.letterbox;
      if (this.frameObserver) {
        this.recordingFrame = true;
        letterbox = { ...letterbox };
        await this.frameObserver(frame, letterbox, host.frameIndex, this.canvas.width, this.canvas.height);
      }
      if ((import.meta.env.DEV || import.meta.env.VITE_BGT_TEST === '1')) this.testHarness?.frame(frame,letterbox,host.frameIndex,this.canvas.width,this.canvas.height);
      out = await r.drawFrame(frame, letterbox, readback);
    } catch (e) {
      for(const it of frame.items)if(it.kind==='readback')it.complete();
      this.record('gpu', (e as Error).message);
    } finally {
      if (this.recordingFrame) {
        this.recordingFrame = false;
        if (this.recordingResizePending) {
          this.recordingResizePending = false;
          this.applySize();
        }
      }
    }
    this.gpuWallMs+=performance.now()-gpuStart;
    this.gpuSubmitTotalMs+=r.stats.submitMs;
    // A loss callback can run during an asynchronous draw/readback. Keep queued GPU work as fallback evidence.
    if (r.lost || this.failed || r !== this.renderer) return null;
    this.lastFrameStats = {
      drawCalls: r.stats.drawCalls,
      passes: r.stats.passes,
      vertices: frame.vertexCount,
      commandBytes: frame.commandBytes,
      submits: frame.submits,
      commandCount: frame.commandCount,
      continuationSubmits: frame.continuationSubmits,
      continuationByteLimit: GPU_CONTINUATION_LIMITS.bytes,
      continuationCommandLimit: GPU_CONTINUATION_LIMITS.commands,
      nativePasses: r.stats.nativePasses ?? 0, nativeSubmits: r.stats.nativeSubmits ?? 0,
      mergedPasses: r.stats.mergedPasses ?? 0, bufferRenames: r.stats.bufferRenames ?? 0, skippedBinds: r.stats.skippedBinds ?? 0,
      renameBytes: r.stats.renameBytes ?? 0, captureTranslations: r.stats.captureTranslations ?? 0, captureLowerings: r.stats.captureLowerings ?? 0,
      gpuMs: r.stats.gpuMs ?? null, gpuTiming: r.stats.gpuTiming ?? 'off',
    };
    host.consume();
    this.presentsCompleted++;
    if ((import.meta.env.DEV || import.meta.env.VITE_BGT_TEST === '1')) await this.testHarness?.afterFrame?.();
    if(this.firstFrameMs===null){this.firstFrameMs=performance.now()-this.loadStarted;if(this.loadMarks)this.loadMarks.firstFrameMs=this.firstFrameMs;this.samplePeak();}
    else if(this.presentsCompleted%30===0)this.samplePeak();
    this.frameTimes.push(performance.now()-started);if(this.frameTimes.length>10000)this.frameTimes.shift();
    return out;
  }

  private updateBusy = false;
  /** K66: settles when the running page-loop tick (including a transport burst) has finished its updates. */
  private tickTail: Promise<void> = Promise.resolve();
  private loop(): void {
    const tick = async (t: number) => {
      this.raf = requestAnimationFrame(tick);
      if (this.last) {
        const d = t - this.last;
        this.intervals.push(d);
        if (this.intervals.length > 240) this.intervals.shift();
        if (!this.paused && this.ready && !this.failed) this.acc += Math.min(d, 250);
      }
      this.last = t;
      this.checkLossWatchdog();
      if ((import.meta.env.DEV || import.meta.env.VITE_BGT_TEST === '1') && this.testCheckpointBusy || this.paused || !this.ready || this.failed || this.outsideSlice || this.renderer?.lost || this.host?.ioPending || this.renderBusy || this.updateBusy) {
        if (this.pageLog && !this.paused && this.ready && !this.failed) pageLogPush(this.pageLog, 1, t);
        return;
      }
      if (this.pageLog) pageLogPush(this.pageLog, 0, t);
      const tickStart = performance.now();
      this.updateBusy = true;
      let tickDone!: () => void; this.tickTail = new Promise<void>((resolve) => { tickDone = resolve; });
      try {
      let n = 0;
      // A pipeline update is already a bounded guest frame; never multiply its
      // work with fixed-step catch-up. Native BGT games keep their old policy.
      const limit = this.manifest?.pipeline ? 1 : LIMITS.maxCatchUpUpdates;
      while (this.acc >= STEP_MS && n < limit && !this.host?.ioPending) {
        await this.stepGuarded();
        if (this.failed || this.outsideSlice) return;
        this.acc -= STEP_MS;
        n++;
      }
      this.acc = retainedAccumulator(this.acc, n, limit, STEP_MS); // drop backlog, keep the sub-step remainder
      // vK66: `updates` = every update of this tick, carried by the tick's one counted canvas present.
      let updates = n;
      if (n > 0 && this.manifest?.pipeline) ({ pending: n, updates } = await this.transportBurst(n, tickStart));
      if (n > 0) {
        const before = this.presentsCompleted, log = this.pageLog;
        if (log) void this.renderFrame(false).then(() => {
          if (this.presentsCompleted > before) pageLogPush(log, 2, performance.now(), updates);
        }, () => {});
        else void this.renderFrame(false);
      }
      } finally { this.updateBusy = false; tickDone(); }
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** K66: page-loop counters (test API pageLoop()). */
  readonly pageLoopStats = { ticks: 0, updates: 0, transportUpdates: 0, maxUpdatesPerTick: 0 };

  /**
   * K66: a guest blocked in a synchronous transport wait (ReadFile, a request result, a full host-frame budget)
   * neither presents nor advances guest time, so capping it at one update per display tick only stretches
   * loading (60 reads/s). After such a yield, render that update and run the next one in the same tick, until
   * an update presents or crosses a guest-time boundary, the tick's wall budget is spent, or the continuation
   * carried one frame period of instruction time. Each update keeps its own render and request boundary, exactly
   * as back-to-back step(): the guest timeline and every guest-visible result are unchanged.
   * Page-fps honesty (vK66): renders inside a burst are logged as burst renders (kind 4), never as presents; the
   * tick's last render is its one counted present (kind 2) and carries all of the tick's updates.
   * Returns whether the last update's render is still to be issued (pending 0/1) and the tick's update count.
   */
  private async transportBurst(n: number, tickStart: number): Promise<{ pending: number; updates: number }> {
    const host = this.host!, stats = this.pageLoopStats, budget = this.opts.ioBurstMs ?? TRANSPORT_BURST_MS;
    stats.ticks++; stats.updates += n;
    const guest0 = host.guestTimeUs();
    let tick = n;
    for (;;) {
      if (!continueTransport(host.transportYield(), performance.now() - tickStart, budget, guest0, host.guestTimeUs())) break;
      const before = this.presentsCompleted;
      await this.renderFrame(false).catch(() => null); n = 0;
      const rendered = this.presentsCompleted > before, renderedAt = performance.now();
      if (host.ioPending) await host.settleRequests();
      if (performance.now() - tickStart >= budget || this.paused || this.failed || this.outsideSlice || this.renderer?.lost ||
        ((import.meta.env.DEV || import.meta.env.VITE_BGT_TEST === '1') && this.testCheckpointBusy)) {
        // The burst ends on an update already rendered: that render is the tick's present.
        if (rendered && this.pageLog) pageLogPush(this.pageLog, 2, renderedAt, tick);
        break;
      }
      if (rendered && this.pageLog) pageLogPush(this.pageLog, 4, renderedAt); // an intermediate burst render
      await this.stepGuarded();
      if (this.failed || this.outsideSlice) { n = 0; break; }
      n = 1; tick++; stats.updates++; stats.transportUpdates++;
      if (this.pageLog) pageLogPush(this.pageLog, 3, performance.now());
    }
    if (tick > stats.maxUpdatesPerTick) stats.maxUpdatesPerTick = tick;
    return { pending: n, updates: tick };
  }

  // ------------------------------------------------------------ test hooks

  pause(): void {
    this.paused = true;
    this.acc = 0;
  }

  resume(): void {
    if ((import.meta.env.DEV || import.meta.env.VITE_BGT_TEST === '1') && this.testCheckpointBusy) throw new Error('Savestate operation in progress');
    if(this.outsideSlice)return; // select a broader package and reload; never resume an aborted guest stack
    this.paused = false;
    this.acc = 0;
  }

  /**
   * K51 real-page measurement: let the page's own rAF loop run for warmupMs, then measure a fixed
   * windowMs of wall time (no step()). Guest presents come from the native present counter. Pauses again.
   */
  async measurePage(windowMs: number, warmupMs = 1000): Promise<PageWindowSummary> {
    if (!this.ready || this.failed) throw new Error('runtime not ready');
    if (!(windowMs > 0 && windowMs <= 600_000) || !(warmupMs >= 0 && warmupMs <= 600_000)) throw new Error('invalid measurement window');
    if (this.stepping) throw new Error('Overlapping test operations');
    const guest = () => {
      const g = (this.host?.metrics() as { execution_summary?: { guest_frames?: { count?: unknown } | null } } | null)?.execution_summary?.guest_frames?.count;
      return typeof g === 'number' || typeof g === 'bigint' || typeof g === 'string' ? Number(g) : null;
    };
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
    if (this.pageLog) throw new Error('Overlapping page measurements');
    const log = this.pageLog = newPageLog();
    this.resume();
    try {
      await sleep(warmupMs);
      const g0 = guest(), start = performance.now();
      await sleep(windowMs);
      const end = performance.now(), g1 = guest();
      // Presents complete asynchronously; let a submitted frame finish before reducing the window.
      await this.renderTail;
      return summarizePageWindow(log, start, end, g0 !== null && g1 !== null ? g1 - g0 : null);
    } finally { this.pause(); await this.tickTail; await this.renderTail; this.pageLog = null; }
  }

  async step(frames: number): Promise<void> {
    if (!this.ready || this.failed) throw new Error('runtime not ready');
    if ((import.meta.env.DEV || import.meta.env.VITE_BGT_TEST === '1') && this.testCheckpointBusy || this.stepping) throw new Error('Overlapping test operations');
    this.stepping = true;
    this.pause();
    try {
    await this.tickTail; // K66: a page-loop transport burst never overlaps a test step
    for (let i = 0; i < frames; i++) {
      if (this.failed || this.outsideSlice) break;
      await this.renderTail;
      await this.host?.settleRequests();
      if(this.outsideSlice)break;
      await this.stepGuarded();
      if (this.failed || this.outsideSlice) break;
      // Wait out device-loss recovery (or the switch to WebGL 2) instead of drawing into a dead context.
      while (this.renderer?.lost && !this.failed) {
        this.checkLossWatchdog();
        await new Promise((r) => setTimeout(r, 10));
      }
      if (this.failed) break;
      await this.renderFrame(false);
    }
    await this.renderer?.finish();
    } finally { this.stepping = false; }
  }

  declare testReplace: (host: GameHost,renderer: Renderer,letterbox: Letterbox) => void;

  injectInput(events: TestInputEvent[]): void {
    if ((import.meta.env.DEV || import.meta.env.VITE_BGT_TEST === '1') && this.testCheckpointBusy) throw new Error('Savestate operation in progress');
    this.input.injectTest(events);
  }

  async readPixels(): Promise<Pixels | null> {
    if ((import.meta.env.DEV || import.meta.env.VITE_BGT_TEST === '1') && this.testCheckpointBusy) throw new Error('Savestate operation in progress');
    const px = await this.renderFrame(true);
    await this.renderer?.finish();
    return px;
  }

  injectCommands(bytes: Uint8Array): DecodeResult | null {
    if ((import.meta.env.DEV || import.meta.env.VITE_BGT_TEST === '1') && this.testCheckpointBusy) throw new Error('Savestate operation in progress');
    if (!this.host) return null;
    return this.host.submitExternal(bytes);
  }

  async simulateDeviceLoss(opts: { unrecoverable?: boolean } = {}): Promise<void> {
    if ((import.meta.env.DEV || import.meta.env.VITE_BGT_TEST === '1') && this.testCheckpointBusy) throw new Error('Savestate operation in progress');
    await this.renderer?.simulateLoss(opts);
  }

  profileReset():boolean {return this.host?.profileReset() ?? false;}

  coverageSnapshot() {
    // Metrics flush wasm-buffered coverage. Observe entries/drops only after that flush.
    const execution=this.host?.metrics() ?? null;
    // K51: a coverage-off performance build records nothing; say so rather than publishing empty evidence.
    const recording=(this.manifest?.pipeline as {instrumentation?:{coverage?:string}}|undefined)?.instrumentation?.coverage ?? 'buffered';
    return {schema:'game-cask/coverage/1',game:this.manifest?.id,recording,modules:this.manifest?.pipeline?.modules ?? [],
      interpreter:this.host?.interpreterCoverage() ?? undefined,
      code:[...(this.host?.codeCoverage ?? new Map<number,number>())].sort((a,b)=>a[0]-b[0]).map(([address,kind])=>({address,kind})),
      files:[...this.vfs.coverage(),...(this.rangeFiles?.coverage() ?? [])],
      readAhead:this.vfs.readAheadCoverage(),
      metrics:{code_entries_dropped:this.host?.codeCoverageDropped ?? 0,
        execution,runtime_profile:{suspension:this.host?.config.suspensionMode ?? 'asyncify',gpuDrawWallMs:this.gpuWallMs,gpuSubmitMs:this.gpuSubmitTotalMs,vfs:this.rangeFiles?.timing ?? null},frame:this.host?.frameIndex ?? 0,errors:this.errors.length,outsideSlice:this.sliceEvents,rangeFetchedBytes:this.rangeFiles?.fetchedBytes ?? 0,
        crtConsumedBytes:this.vfs.consumedBytes,crtObservedBytes:this.vfs.observedBytes,crtReadAheadBytes:this.vfs.readAheadBytes,crtReadAheadRequests:this.vfs.readAheadRequests,
        load_to_first_frame_ms:this.firstFrameMs,frame_ms_avg:this.frameTimes.length?this.frameTimes.reduce((a,b)=>a+b,0)/this.frameTimes.length:0,
        frame_ms_p95:this.frameTimes.length?[...this.frameTimes].sort((a,b)=>a-b)[Math.min(this.frameTimes.length-1,Math.floor(this.frameTimes.length*0.95))]:0,frames_measured:this.frameTimes.length},
      timing:this.diagnostics().timing};
  }

  private resolveBudget(manifest: Manifest | null): { bytes: number; source: MemoryBudgetSource } {
    const url = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('memorybudget') : null;
    try { return resolveMemoryBudget(this.opts.memoryBudgetBytes, url, manifest?.memoryBudget?.bytes); }
    catch (e) {
      if (url === null || this.opts.memoryBudgetBytes !== undefined) throw new RuntimeFailure('init', (e as Error).message);
      // A mistyped URL override must not stop the game: report it and use the configured budget.
      this.backendNotes.push(`memory: ${(e as Error).message}; ignored`);
      try { return resolveMemoryBudget(undefined, null, manifest?.memoryBudget?.bytes); }
      catch (m) { throw new RuntimeFailure('init', (m as Error).message); }
    }
  }

  private memoryInputs(metrics: unknown): MemoryInputs {
    const host = this.host, r = this.renderer, reserved = host?.gpuReservedByKind ?? null, gpu = host?.gpuMetrics ?? null;
    const heap = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize;
    return {
      wasm: { linearBytes: host?.memoryBytes ?? 0, initialBytes: this.wasmEvidence?.memoryLimits?.initialBytes ?? this.linearAtInstantiate,
        moduleBytes: this.wasmEvidence?.bytes ?? 0 },
      guest: guestMemoryFromMetrics(metrics),
      gpu: gpu ? { budgetBytes: gpu.budgetBytes, reservedBytes: gpu.reservedBytes, peakReservedBytes: gpu.peakReservedBytes,
        reserved: reserved ?? { buffers: 0, textures: 0, shaders: 0 } } : null,
      native: r?.gpu?.memory?.() ?? null,
      legacyTextureBytes: host?.textures.totalBytes ?? 0,
      canvas: { width: this.canvas.width, height: this.canvas.height },
      js: { assetBytes: this.vfs.totalBytes, streamCacheBytes: this.rangeFiles?.cacheBytes ?? 0,
        gpuDecoderShadowBytes: reserved?.buffers ?? 0,
        // Scheduled AudioBuffers hold float32 per channel; stereo is the upper bound.
        audioQueuedBytes: this.audio.queued() * 2 * 4,
        loadBuffersBytes: this.loadBuffers,
        heapUsedBytes: typeof heap === 'number' ? heap : null },
      budget: this.memoryBudget,
    };
  }

  /** Frame-path peak sample: diagnostics never fail a frame, and a runtime built without its K64 bookkeeping
   * (tests use Object.create(BGTRuntime.prototype)) simply has no peak to track. */
  private samplePeak(): void {
    if (!this.loadMarks || !this.memoryPeaks) return;
    try { this.sampleMemory(); } catch (e) { this.record('js', `memory sample failed: ${(e as Error).message}`); }
  }

  /** Peak tracking without the profile's metrics serialization (guest bytes live inside linear memory anyway). */
  private sampleMemory(): MemoryDiagnostics {
    const m = memoryBreakdown(this.memoryInputs(null), this.memoryPeaks);
    this.memoryPeaks = { linear: m.wasm.peakLinearBytes, total: m.estimate.peakTotalBytes };
    return m;
  }

  /** K64: memory attribution (also inside diagnostics()). */
  memory(metrics: unknown = this.executionMetrics()): MemoryDiagnostics {
    const m = memoryBreakdown(this.memoryInputs(metrics), this.memoryPeaks);
    this.memoryPeaks = { linear: m.wasm.peakLinearBytes, total: m.estimate.peakTotalBytes };
    return m;
  }

  /** K64: load phases and the wasm response evidence (resource timing read once it exists). */
  loadMetrics(): LoadDiagnostics {
    if (!this.wasmTransfer && this.wasmEvidence && typeof performance.getEntriesByName === 'function') {
      const url = new URL(this.wasmEvidence.url, location.href).href;
      const e = performance.getEntriesByName(url).find((x): x is PerformanceResourceTiming => 'transferSize' in x);
      if (e) this.wasmTransfer = { transferSize: e.transferSize, encodedBodySize: e.encodedBodySize, decodedBodySize: e.decodedBodySize,
        durationMs: e.duration };
    }
    return loadSummary(this.loadMarks, this.wasmEvidence, this.wasmTransfer, {
      downloadCompileVerifyMs: this.wasmLoadMs, instantiateMs: this.host?.instantiateMs ?? 0, streaming: this.wasmStreaming,
      assetBytes: this.manifest?.assets.reduce((n, a) => n + a.size, 0) ?? 0 });
  }

  diagnostics(): BGTDiagnostics {
    const iv = [...this.intervals].sort((a, b) => a - b);
    const host = this.host;
    const r = this.renderer;
    const metrics = this.executionMetrics();
    return {
      abi: `${ABI_VERSION >> 16}.${(ABI_VERSION >> 8) & 0xff}`,
      suspension: host ? (host.config.suspensionMode ?? 'asyncify') : null,
      suspensionSelection: this.suspensionSelection ? { ...this.suspensionSelection } : null,
      game: this.manifest ? { id: this.manifest.id, name: this.manifest.name } : null,
      backend: r ? r.kind : 'unavailable',
      backendNotes: [...this.backendNotes],
      nativeQueryPolicy: r?.gpu?.nativeQueryPolicy ?? null,
      gpuDevice: r?.gpu?.device && r.gpu.languages ? { ...r.gpu.device, languages: r.gpu.languages,
        maxUniformRange: host?.gpuUniformRange ?? r.gpu.maxUniformRange ?? 65536 } : null,
      ready: this.ready,
      paused: this.paused,
      failed: this.failed,
      frame: host?.frameIndex ?? 0,
      logical: { width: host?.logicalWidth ?? 0, height: host?.logicalHeight ?? 0 },
      canvas: { cssWidth: this.cssW, cssHeight: this.cssH, width: this.canvas.width, height: this.canvas.height, dpr: this.dpr },
      letterbox: { ...this.letterbox },
      wasmMemoryBytes: host?.memoryBytes ?? 0,
      textures: { count: host?.textures.count ?? 0, bytes: host?.textures.totalBytes ?? 0 },
      gpu: host?.gpuMetrics ?? null,
      assets: { count: this.vfs.fileCount, bytes: this.vfs.totalBytes, missing: [...this.vfs.missing] },
      timing: {
        frameIntervalMs: {
          last: this.intervals[this.intervals.length - 1] ?? 0,
          avg: iv.length ? iv.reduce((a, b) => a + b, 0) / iv.length : 0,
          p95: iv.length ? iv[Math.min(iv.length - 1, Math.floor(iv.length * 0.95))] : 0,
        },
        updateMs: host?.timings.updateMs ?? 0,
        renderMs: host?.timings.renderMs ?? 0,
        decodeMs: host?.timings.decodeMs ?? 0,
        gpuSubmitMs: r?.stats.submitMs ?? 0,
        wasmDownloadCompileVerifyMs: this.wasmLoadMs,
        wasmInstantiateMs: host?.instantiateMs ?? 0,
        wasmStreaming: this.wasmStreaming,
      },
      lastFrame: { ...this.lastFrameStats,
        nativeSyncQueries: this.renderer?.gpu?.nativeSyncQueries ? { ...this.renderer.gpu.nativeSyncQueries } : null,
        nativeSyncQueryOps: r?.gpu?.nativeSyncQueryOps ? Object.fromEntries(Object.entries(r.gpu.nativeSyncQueryOps).map(([k,v])=>[k,{...v}])) : null },
      commandErrors: { count: host?.commandErrorCount ?? 0, recent: [...(host?.commandErrors ?? [])] },
      audio: {
        state: this.audio.state,
        unlocked: this.audio.unlocked,
        sampleRate: this.audio.sampleRate,
        droppedFrames: this.audio.droppedFrames,
        playedFrames: this.audio.playedFrames,
        queued: this.audio.queued(),
      },
      storage: { persistent: this.storage?.persistent ?? false },
      deviceResets: this.deviceResets,
      errors: [...this.errors],
      logs: this.logs.slice(-200),
      stateHashAvailable: host?.hasStateHash ?? false,
      debugStateAvailable: host?.hasDebugState ?? false,
      yields: host?.yields ?? 0,
      suspended: host?.suspended ?? false,
      outsideSlice: this.outsideSlice,
      metrics,
      coverage: {
        ops: Object.fromEntries(Object.entries(host?.opCounts ?? {}).map(([k, v]) => [OP_NAMES[Number(k)] ?? k, v])),
        imports: { ...(host?.importCounts ?? {}) },
      },
      memory: this.memory(metrics),
      load: this.loadMetrics(),
    };
  }

  recordExternalError(kind: RuntimeErrorRecord['kind'], message: string): void {
    this.record(kind, message);
  }
}
