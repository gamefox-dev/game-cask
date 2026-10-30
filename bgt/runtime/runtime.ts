// Browser runtime: manifest + asset preload, backend selection (WebGPU ->
// WebGL 2), game loop with fixed timestep, resize/DPR, input, audio,
// storage, device-loss recovery, diagnostics and error UI.

import {
  ABI_VERSION,
  BACKEND_WEBGL2,
  BACKEND_WEBGPU,
  CAP_AUDIO,
  CAP_DIRECT_DRAW,
  CAP_GAMEPAD,
  CAP_GPU, /* LANE-W2: advertise only a complete renderer GPU implementation. */
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
  OP,
} from './abi';
import type { CommandError, DecodeResult } from './commands';
import { GameHost, InputSnapshot, emptyInput, OutsideSlice } from './host';
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
  seed?: number;
  arg0?: number;
  arg1?: number;
  touch?: 'auto' | 'on' | 'off';
  ephemeralStorage?: boolean;
  directDraw?: boolean;
  autostart?: boolean;
  /** Start with the simulation paused (deterministic tests step from frame 0). */
  startPaused?: boolean;
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
  slice?: {code?:number[];data?:boolean};
  touch?: TouchConfig;
  input?: InputConfig;
}

export interface RuntimeErrorRecord {
  kind: 'trap' | 'abort' | 'gpu' | 'asset' | 'init' | 'js' | 'device-lost';
  message: string;
  time: number;
  frame: number;
}

export interface BGTDiagnostics {
  abi: string;
  game: { id: string; name: string } | null;
  backend: 'webgpu' | 'webgl2' | 'unavailable';
  backendNotes: string[];
  ready: boolean;
  paused: boolean;
  failed: boolean;
  frame: number;
  logical: { width: number; height: number };
  canvas: { cssWidth: number; cssHeight: number; width: number; height: number; dpr: number };
  letterbox: Letterbox;
  wasmMemoryBytes: number;
  textures: { count: number; bytes: number };
  assets: { count: number; bytes: number; missing: string[] };
  timing: {
    frameIntervalMs: { last: number; avg: number; p95: number };
    updateMs: number;
    renderMs: number;
    decodeMs: number;
    gpuSubmitMs: number;
  };
  lastFrame: { drawCalls: number; passes: number; vertices: number; commandBytes: number; submits: number };
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
  manifest: Manifest | null = null;
  host: GameHost | null = null;
  renderer: Renderer | null = null;
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
  private firstFrameMs: number | null = null;
  private frameTimes: number[] = [];
  private sliceEvents = 0;
  private renderTail: Promise<void> = Promise.resolve();
  private renderBusy = false;
  private noteOutside(kind:number,address:number,message:string):void {
    this.outsideSlice={kind,address,message};this.sliceEvents++;this.pause();this.status(message);
  }
  private rangeFiles: RangeFiles | null = null;
  private snap: InputSnapshot = emptyInput();
  private raf = 0;
  private last = 0;
  private acc = 0;
  private intervals: number[] = [];
  private errors: RuntimeErrorRecord[] = [];
  private logs: Array<{ level: number; message: string; frame: number }> = [];
  private backendNotes: string[] = [];
  private letterbox: Letterbox = { x: 0, y: 0, w: 1, h: 1, scale: 1 };
  private dpr = 1;
  private cssW = 0;
  private cssH = 0;
  private deviceResets = 0;
  private resizeObs: ResizeObserver | null = null;
  private lastFrameStats = { drawCalls: 0, passes: 0, vertices: 0, commandBytes: 0, submits: 0 };
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

  private async fetchBytes(url: string, label: string, onBytes: (n: number) => void): Promise<ArrayBuffer> {
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
    this.rangeFiles = new RangeFiles(base);
    for (const file of manifest.streams ?? []) { this.rangeFiles.add(file); this.vfs.addStream(file.path,file.size); }
    document.title = `${manifest.name} — Game Cask`;

    const total = manifest.wasm.size + manifest.assets.reduce((n, a) => n + a.size, 0);
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
    const wasmP = this.fetchBytes(base + manifest.wasm.url, 'game.wasm', tick).then(async (b) => {
      await verify(b, manifest.wasm.sha256, 'game.wasm');
      return b;
    });
    // Chunked preload with bounded concurrency.
    const queue = [...manifest.assets];
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (let a = queue.shift(); a; a = queue.shift()) {
        const b = await this.fetchBytes(base + a.url, a.path, tick);
        await verify(b, a.sha256, a.path);
        this.vfs.add(a.path, new Uint8Array(b));
      }
    });
    const [wasm] = await Promise.all([wasmP, ...workers]);

    this.status('Starting graphics…');
    this.renderer = await this.pickRenderer(this.opts.backend ?? 'auto');
    this.input = new InputManager(this.canvas, manifest.input);
    this.input.attach();
    this.wireRenderer(this.renderer);

    this.storage = new BrowserStorage(manifest.id, { ephemeral: this.opts.ephemeralStorage });
    this.audio.armUnlock();
    this.audio.onUnlock(() => this.input.markEvent('audioUnlocked'));

    const touch = this.opts.touch ?? 'auto';
    const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (touch === 'on' || (touch === 'auto' && coarse)) this.input.createOverlay(this.opts.container, manifest.touch ?? {});

    let caps = CAP_AUDIO | CAP_SCISSOR | CAP_TRIANGLES | CAP_LINEAR_FILTER | CAP_GAMEPAD | CAP_RENDER_TARGETS | CAP_READBACK | CAP_STREAM_FILES;
    /* LANE-W2 */ if (this.renderer.gpu?.languages) caps |= CAP_GPU;
    if (this.storage.persistent) caps |= CAP_STORAGE;
    if (hasTouch) caps |= CAP_TOUCH;
    if (this.opts.directDraw) caps |= CAP_DIRECT_DRAW;

    this.measure();
    try {
      this.host = await GameHost.create(
        wasm,
        {
          log: (level, message) => this.gameLog(level, message),
          vfs: this.vfs,
          audio: this.audio,
          gamepadRumble: (index, left, right) => this.input.rumble(index, left, right),
          storage: this.storage,
          now: () => performance.now(),
          rangeRead: async (path,offset,length) => {
            try{return await this.rangeFiles!.read(path,offset,length);}catch(e){
              if(e instanceof OutsideDataRange){this.noteOutside(2,e.offset,e.message);}
              throw e;
            }
          },
        },
        {
          backend: this.renderer.kind === 'webgpu' ? BACKEND_WEBGPU : BACKEND_WEBGL2,
          caps,
          seed: this.opts.seed ?? 1,
          displayWidth: this.canvas.width,
          displayHeight: this.canvas.height,
          arg0: this.opts.arg0 ?? 0,
          arg1: this.opts.arg1 ?? 0,
          /* LANE-W2 */ gpuBackend: this.renderer.gpu,
          maxTextureDimension: this.renderer.maxTextureSize,
          sliceCode: manifest.slice?.code,
        },
      );
      this.host.init();
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
      /* LANE-W2: §13 attachment contents are lost on restoration. */
      if (r.gpu?.languages || [...this.host.textures.entries.values()].some((e) => e.renderTarget)) {
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
    /* LANE-W2: no cross-backend §13 descriptor/language migration; never drop live GPU handles. */
    if (!old || old.kind === 'webgl2' || old.gpu?.languages) {
      this.fail('device-lost', `graphics device lost and could not be recovered (${reason})`);
      return;
    }
    console.warn(`[bgt] ${reason}; switching to WebGL 2`);
    this.canvas = this.newCanvas();
    const gl = WebGL2Renderer.create(this.canvas, { debug: !!this.opts.debug });
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
    this.host.setBackend(BACKEND_WEBGL2);
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
          const r = await WebGPURenderer.create(this.canvas, { debug });
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
    const gl = WebGL2Renderer.create(this.canvas, { debug });
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

  private stepOnce(): void {
    const host = this.host!;
    this.input.snapshot(this.snap);
    host.writeInput(this.snap);
    host.update();
    if (host.sizeChanged) {
      host.sizeChanged = false;
      this.applySize();
    }
  }

  /** Render serially: async readbacks must not race the next frame's command buffers. */
  renderFrame(readback:boolean):Promise<Pixels|null> {
    const work=this.renderTail.then(async()=>{this.renderBusy=true;try{return await this.renderNow(readback);}finally{this.renderBusy=false;}});
    this.renderTail=work.then(()=>{},()=>{});return work;
  }

  /** Render the current state; optionally read back pixels. */
  private async renderNow(readback: boolean): Promise<Pixels | null> {
    const started=performance.now();
    const host = this.host;
    const r = this.renderer;
    if (!host || !r || this.failed) return null;
    if(this.outsideSlice)return null;
    const frame = this.guard(() => host.render());
    if (!frame) return null;
    let out: Pixels | null | Promise<Pixels | null> = null;
    try {
      out = await r.drawFrame(frame, this.letterbox, readback);
    } catch (e) {
      for(const it of frame.items)if(it.kind==='readback')it.complete();
      this.record('gpu', (e as Error).message);
    }
    this.lastFrameStats = {
      drawCalls: r.stats.drawCalls,
      passes: r.stats.passes,
      vertices: frame.vertexCount,
      commandBytes: frame.commandBytes,
      submits: frame.submits,
    };
    host.consume();
    if(this.firstFrameMs===null)this.firstFrameMs=performance.now()-this.loadStarted;
    this.frameTimes.push(performance.now()-started);if(this.frameTimes.length>10000)this.frameTimes.shift();
    return out;
  }

  private loop(): void {
    const tick = (t: number) => {
      this.raf = requestAnimationFrame(tick);
      if (this.last) {
        const d = t - this.last;
        this.intervals.push(d);
        if (this.intervals.length > 240) this.intervals.shift();
        if (!this.paused && this.ready && !this.failed) this.acc += Math.min(d, 250);
      }
      this.last = t;
      this.checkLossWatchdog();
      if (this.paused || !this.ready || this.failed || this.outsideSlice || this.renderer?.lost || this.host?.ioPending || this.renderBusy) return;
      let n = 0;
      while (this.acc >= STEP_MS && n < LIMITS.maxCatchUpUpdates && !this.host?.ioPending) {
        if (this.guard(() => this.stepOnce()) === undefined && this.failed) return;
        this.acc -= STEP_MS;
        n++;
      }
      if (n === LIMITS.maxCatchUpUpdates) this.acc = 0; // drop backlog rather than spiral
      if (n > 0) void this.renderFrame(false);
    };
    this.raf = requestAnimationFrame(tick);
  }

  // ------------------------------------------------------------ test hooks

  pause(): void {
    this.paused = true;
    this.acc = 0;
  }

  resume(): void {
    if(this.outsideSlice)return; // select a broader package and reload; never resume an aborted guest stack
    this.paused = false;
    this.acc = 0;
  }

  async step(frames: number): Promise<void> {
    if (!this.ready || this.failed) throw new Error('runtime not ready');
    this.pause();
    for (let i = 0; i < frames; i++) {
      if (this.failed || this.outsideSlice) break;
      await this.renderTail;
      await this.host?.settleRequests();
      if(this.outsideSlice)break;
      this.guard(() => this.stepOnce());
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
  }

  injectInput(events: TestInputEvent[]): void {
    this.input.injectTest(events);
  }

  async readPixels(): Promise<Pixels | null> {
    const px = await this.renderFrame(true);
    await this.renderer?.finish();
    return px;
  }

  injectCommands(bytes: Uint8Array): DecodeResult | null {
    if (!this.host) return null;
    return this.host.submitExternal(bytes);
  }

  async simulateDeviceLoss(opts: { unrecoverable?: boolean } = {}): Promise<void> {
    await this.renderer?.simulateLoss(opts);
  }

  coverageSnapshot() {
    return {schema:'game-cask/coverage/1',game:this.manifest?.id,modules:this.manifest?.pipeline?.modules ?? [],
      code:[...(this.host?.codeCoverage ?? new Map<number,number>())].sort((a,b)=>a[0]-b[0]).map(([address,kind])=>({address,kind})),
      files:[...this.vfs.coverage(),...(this.rangeFiles?.coverage() ?? [])],
      metrics:{code_entries_dropped:this.host?.codeCoverageDropped ?? 0,frame:this.host?.frameIndex ?? 0,errors:this.errors.length,outsideSlice:this.sliceEvents,rangeFetchedBytes:this.rangeFiles?.fetchedBytes ?? 0,
        load_to_first_frame_ms:this.firstFrameMs,frame_ms_avg:this.frameTimes.length?this.frameTimes.reduce((a,b)=>a+b,0)/this.frameTimes.length:0,
        frame_ms_p95:this.frameTimes.length?[...this.frameTimes].sort((a,b)=>a-b)[Math.min(this.frameTimes.length-1,Math.floor(this.frameTimes.length*0.95))]:0,frames_measured:this.frameTimes.length},
      timing:this.diagnostics().timing};
  }

  diagnostics(): BGTDiagnostics {
    const iv = [...this.intervals].sort((a, b) => a - b);
    const host = this.host;
    const r = this.renderer;
    return {
      abi: `${ABI_VERSION >> 16}.${(ABI_VERSION >> 8) & 0xff}`,
      game: this.manifest ? { id: this.manifest.id, name: this.manifest.name } : null,
      backend: r ? r.kind : 'unavailable',
      backendNotes: [...this.backendNotes],
      ready: this.ready,
      paused: this.paused,
      failed: this.failed,
      frame: host?.frameIndex ?? 0,
      logical: { width: host?.logicalWidth ?? 0, height: host?.logicalHeight ?? 0 },
      canvas: { cssWidth: this.cssW, cssHeight: this.cssH, width: this.canvas.width, height: this.canvas.height, dpr: this.dpr },
      letterbox: { ...this.letterbox },
      wasmMemoryBytes: host?.memoryBytes ?? 0,
      textures: { count: host?.textures.count ?? 0, bytes: host?.textures.totalBytes ?? 0 },
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
      },
      lastFrame: { ...this.lastFrameStats },
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
      metrics: host?.metrics() ?? null,
      coverage: {
        ops: Object.fromEntries(Object.entries(host?.opCounts ?? {}).map(([k, v]) => [OP_NAMES[Number(k)] ?? k, v])),
        imports: { ...(host?.importCounts ?? {}) },
      },
    };
  }

  recordExternalError(kind: RuntimeErrorRecord['kind'], message: string): void {
    this.record(kind, message);
  }
}
