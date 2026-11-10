// DOM-free host for a BGT wasm game: instantiation, import table, memory
// validation, lifecycle calls and per-frame command decoding. Used by the
// browser runtime and directly by Node unit tests (headless backend).

import {readInterpreterCoverage,readInterpreterSummary,readGuestPresentations} from './execution-metrics';
import {instructionSummary} from './instruction-accounting';
import {
  ABI_VERSION,
  BGT_OK,
  CAP_DIRECT_DRAW,
  CAP_LINEAR_FILTER,
  CAP_RENDER_TARGETS,
  CAP_YIELD,
  CAP_READBACK,
  CAP_TRIANGLES,
  DT_US,
  E_BOUNDS,
  E_INVALID,
  E_LIMIT,
  E_NOT_FOUND,
  E_IO,
  E_STATE,
  GPU_BUDGET_MAX,
  GPU_BUDGET_MIN,
  GPU_LIMITS,
  IO,
  LIMITS,
  SLICE_POLICY,
  SLICE_FIRST_ENTRY,
  MAX_TOUCHES,
  errorName,
} from './abi';
import {
  CommandError,
  DecodeContext,
  DecodeResult,
  DrawState,
  Frame,
  TextureTable,
  decodeCommands,
  defaultState,
  effectiveClip,
  emitSprite,
} from './commands';
import { Vfs } from './vfs';
import { Requests } from './requests';
/* LANE-S1: additive GPU host wiring and extended limits; no backend enabled by default. */
import { GpuState } from './commands-gpu';
import { CAP_ENTROPY, CAP_GPU, CAP_GPU_BUFFER_HANDLES, GPU_LIMITS_SIZE, E_UNSUPPORTED } from './abi';
import type { GpuBackend } from '../renderers/types';
import { jspiApi } from './jspi';
import type { captureHost } from './savestate-host';

export interface AudioSink {
  readonly sampleRate: number;
  push(samples: Int16Array): number;
  /** v0.3 additive: interleaved stereo, return accepted frames (not samples). */
  pushStereo?(samples: Int16Array): number;
  queued(): number;
}

export interface StorageSink {
  readonly persistent: boolean;
  read(key: string): Uint8Array | null;
  write(key: string, data: Uint8Array): number;
}

export interface HostServices {
  log(level: number, message: string): void;
  vfs: Vfs;
  audio?: AudioSink;
  gamepadRumble?(index: number, left: number, right: number): void;
  storage?: StorageSink;
  now(): number;
  /** LANE-K1: explicit test replay hook. Omit for real Web Crypto entropy. Throw on failure. */
  entropy?(bytes: Uint8Array): void;
  /** Explicit deterministic test clock; profiling still uses now(). */
  guestNow?(): number;
  rangeRead?(path: string, offset: number, length: number, ahead?: boolean): Promise<Uint8Array<ArrayBuffer>>;
}

export interface HostConfig {
  suspensionMode?: 'asyncify' | 'jspi';
  backend: number;
  caps: number;
  seed: number;
  displayWidth: number;
  displayHeight: number;
  arg0: number;
  arg1: number;
  maxTextureDimension?: number;
  /* LANE-S1 */ gpuBackend?: GpuBackend;
  /** Reservation/accounting limit; not measured physical VRAM. */
  gpuBudgetBytes?: number;
  sliceCode?: number[];
  sliceCodeRanges?: {addr:number;end:number}[];
}

export interface GamepadSnapshot {
  connected: boolean;
  /** Standard Gamepad API button-index bits; axes retain browser Y-down convention. */
  buttons: number;
  axes: [number, number, number, number];
  triggers: [number, number];
}

export interface InputSnapshot {
  gamepads?: GamepadSnapshot[];
  buttons: number;
  pressed: number;
  released: number;
  keys: Uint32Array;
  keysPressed: Uint32Array;
  pointerX: number;
  pointerY: number;
  pointerButtons: number;
  pointerInside: boolean;
  axes: [number, number, number, number];
  touches: Array<{ id: number; x: number; y: number }>;
  events: number;
}

export function emptyInput(): InputSnapshot {
  return {
    buttons: 0,
    pressed: 0,
    released: 0,
    keys: new Uint32Array(8),
    keysPressed: new Uint32Array(8),
    pointerX: -1,
    pointerY: -1,
    pointerButtons: 0,
    pointerInside: false,
    axes: [0, 0, 0, 0],
    touches: [],
    events: 0,
  };
}

export class GameAbort extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(`game aborted (${errorName(code)}): ${message}`);
    this.name = 'GameAbort';
  }
}

export class OutsideSlice extends Error {
  constructor(readonly kind: number,readonly address: number) { super(`outside this slice: ${kind===1?'code':'data'} at 0x${address.toString(16)}`);this.name='OutsideSlice'; }
}

export class HostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HostError';
  }
}

interface GameExports {
  memory: WebAssembly.Memory;
  bgt_abi_version(): number;
  bgt_io(): number;
  bgt_init(io: number): number;
  bgt_update(dt: number): void;
  bgt_render(): void;
  bgt_shutdown(): void;
  bgt_state_hash?(): number;
  bgt_debug_state?(): number;
  bgt_debug_peek?(addr: number, len: number): number;
  bgt_metrics?(): number;
  bgt_interpreter_coverage?(): number;
  bgt_guest_presentations?(): number;
  bgt_profile_reset?():void;
  bgt_profile_abort?(nowUs:number):void;
  bgt_slice_policy?(entries:number,ranges:number):number;
  bgt_slice_first_entry?():number;
  bgt_async_buffer?(): number;
  bgt_async_buffer_size?(): number;
  // added by binaryen's asyncify pass (game.json "asyncify": true)
  asyncify_start_unwind?(data: number): void;
  asyncify_stop_unwind?(): void;
  asyncify_start_rewind?(data: number): void;
  asyncify_stop_rewind?(): void;
}

const enum AsyncState {
  Normal,
  Unwinding,
  Suspended,
  Rewinding,
}

const REQUIRED_EXPORTS = ['memory', 'bgt_abi_version', 'bgt_io', 'bgt_init', 'bgt_update', 'bgt_render', 'bgt_shutdown'];

export interface HostTimings {
  updateMs: number;
  renderMs: number;
  decodeMs: number;
}

// Safety net, not normal discovery granularity: 16x the former 65,536-entry cap.
// At most 1,048,576 distinct function/block/continuation addresses per loaded runtime.
export const CODE_COVERAGE_LIMIT = 1_048_576;
const utf8 = new TextDecoder('utf-8', { fatal: false });

export class GameHost {
  declare private rawExports: WebAssembly.Exports;
  declare assertCheckpointBoundary: () => void;
  declare checkpoint: () => ReturnType<typeof captureHost>;
  declare restoreCheckpoint: (state: ReturnType<typeof captureHost>) => void;
  readonly frame = new Frame();
  readonly textures = new TextureTable();
  readonly requests = new Requests();
  /* LANE-S1 */ private gpu?: GpuState;
  private abiVersion = 0;
  readonly codeCoverage = new Map<number, number>();
  codeCoverageDropped = 0;
  private allowedCode: Set<number> | null = null;
  private ioWork = new Set<Promise<void>>();
  get fileIo() { const v=this.services.vfs;return { consumedBytes:v.consumedBytes,observedBytes:v.observedBytes,readAheadBytes:v.readAheadBytes,readAheadRequests:v.readAheadRequests,files:v.coverage(),readAhead:v.readAheadCoverage() }; }
  get ioPending(): boolean { return this.ioWork.size > 0; }
  async settleRequests(): Promise<void> {
    if (!this.ioWork.size) return;
    const start=this.services.now();
    try { await Promise.all([...this.ioWork]); } finally { this.profile.ioWaitMs+=this.services.now()-start; }
  }
  state: DrawState = defaultState(1, 1);
  logicalWidth = 0;
  logicalHeight = 0;
  flags = 0;
  frameIndex = 0;
  private observationStarted: number | null = null;
  commandErrors: CommandError[] = [];
  /** kit coverage: BGT commands executed per opcode, and runtime imports called */
  readonly opCounts: Record<number, number> = {};
  readonly importCounts: Record<string, number> = {};
  readonly profile = { updateMs: 0, renderMs: 0, ioWaitMs: 0,
    imports: {} as Record<string, { samples: number; sampleMs: number; estimatedMs: number }> };
  commandErrorCount = 0;
  readonly timings: HostTimings = { updateMs: 0, renderMs: 0, decodeMs: 0 };
  instantiateMs = 0;
  private exports!: GameExports;
  private ioPtr = 0;
  private initialized = false;
  private decodeTime = 0;
  private asyncState = AsyncState.Normal;
  private asyncBuf = 0;
  private inUpdate = false;
  private jspiUpdate: ((dt: number) => Promise<void>) | null = null;
  private jspiTask: Promise<void> | null = null;
  private jspiResume: (() => void) | null = null;
  private jspiBoundary: {resolve: () => void; reject: (error: unknown) => void} | null = null;
  private jspiBusy = false;
  /** updates that ended suspended in bgt_yield (vs. returning normally) */
  yields = 0;
  /** set when the game changed its logical size during an update (v0.2) */
  sizeChanged = false;

  private constructor(
    private readonly services: HostServices,
    readonly config: HostConfig,
  ) {
    /* LANE-K1: advertise only an available entropy provider. */
    if (typeof services.entropy === 'function' || typeof globalThis.crypto?.getRandomValues === 'function') config.caps |= CAP_ENTROPY;
    else config.caps &= ~CAP_ENTROPY;
    if (config.sliceCode) this.allowedCode = new Set(config.sliceCode);
    /* LANE-S1: a caller cannot advertise an absent/unsupported GPU implementation. */
    if (config.gpuBudgetBytes !== undefined) {
      if (!Number.isSafeInteger(config.gpuBudgetBytes) || config.gpuBudgetBytes < GPU_BUDGET_MIN || config.gpuBudgetBytes > GPU_BUDGET_MAX) {
        throw new HostError(`invalid gpuBudgetBytes; expected integer in [${GPU_BUDGET_MIN}, ${GPU_BUDGET_MAX}]`);
      }
    } else config.gpuBudgetBytes = GPU_LIMITS.budget;
    if (config.gpuBackend?.languages && (config.caps & CAP_GPU)) {
      this.gpu = new GpuState(config.gpuBackend, config.gpuBudgetBytes);
    }
    else config.caps &= ~CAP_GPU;
    if (this.gpu?.backend.bufferHandles) config.caps |= CAP_GPU_BUFFER_HANDLES;
    else config.caps &= ~CAP_GPU_BUFFER_HANDLES;
  }

  static async create(wasm: BufferSource | WebAssembly.Module, services: HostServices, config: HostConfig): Promise<GameHost> {
    const host = new GameHost(services, config);
    const module = wasm instanceof WebAssembly.Module ? wasm : await WebAssembly.compile(wasm);
    const imports = host.imports();
    if (config.suspensionMode === 'jspi') {
      const api = jspiApi();
      if (!api) throw new HostError('JSPI requested but WebAssembly.Suspending/promising are unavailable');
      imports.bgt.yield = new api.Suspending(imports.bgt.yield as () => Promise<void>) as typeof imports.bgt.yield;
    }
    const missing = WebAssembly.Module.imports(module).filter(
      (imp) => imp.module !== 'bgt' || !(imp.name in imports.bgt),
    );
    if (missing.length) {
      throw new HostError(
        `game imports not provided by BGT v0.1: ${missing.map((m) => `${m.module}.${m.name}`).join(', ')}`,
      );
    }
    const names = WebAssembly.Module.exports(module).map((e) => e.name);
    const absent = REQUIRED_EXPORTS.filter((n) => !names.includes(n));
    if (absent.length) throw new HostError(`game is missing required exports: ${absent.join(', ')}`);
    const instantiateStart = performance.now();
    const instance = await WebAssembly.instantiate(module, imports);
    host.instantiateMs = performance.now()-instantiateStart;
    if (typeof import.meta.env !== 'undefined' && (import.meta.env.DEV || import.meta.env.VITE_BGT_TEST === '1')) host.rawExports = instance.exports;
    // Every synchronous export boundary can abandon a C span (including init,
    // render and diagnostics). Normal returns/Asyncify unwinds do not clean up.
    host.exports = Object.fromEntries(Object.entries(instance.exports).map(([name, value]) => [name,
      typeof value === 'function' && name !== 'bgt_profile_abort' && name !== 'bgt_update' ? (...args: unknown[]) => {
        try { return value(...args); } catch (error) { host.abortProfile(); throw error; }
      } : value])) as unknown as GameExports;
    // promising requires the actual wasm function, not the synchronous guard.
    if (config.suspensionMode === 'jspi') host.jspiUpdate = jspiApi()!.promising(instance.exports.bgt_update as GameExports['bgt_update']);
    const v = host.exports.bgt_abi_version() >>> 0;
    host.abiVersion = v;
    if (v < 0x000300) host.config.caps &= ~CAP_GPU_BUFFER_HANDLES;
    if (v < 0x000300) host.config.maxTextureDimension = LIMITS.textureDim; // frozen v0.2 limits
    if (v >> 16 !== ABI_VERSION >> 16 || ((v >> 8) & 0xff) > ((ABI_VERSION >> 8) & 0xff)) {
      throw new HostError(`game built for BGT ABI 0x${v.toString(16)}, runtime provides 0x${ABI_VERSION.toString(16)}`);
    }
    host.ioPtr = host.exports.bgt_io() >>> 0;
    if (host.ioPtr === 0 || host.ioPtr % 4 !== 0 || host.ioPtr + IO.SIZE > host.memory.buffer.byteLength) {
      throw new HostError(`bgt_io() returned invalid address ${host.ioPtr}`);
    }
    return host;
  }

  get memory(): WebAssembly.Memory {
    return this.exports.memory;
  }

  get memoryBytes(): number {
    return this.exports.memory.buffer.byteLength;
  }

  get hasStateHash(): boolean {
    return typeof this.exports.bgt_state_hash === 'function';
  }

  get asyncCapable(): boolean {
    return !!this.jspiUpdate || typeof this.exports.asyncify_start_unwind === 'function';
  }

  /** True while the game is parked inside bgt_yield between frames. */
  get suspended(): boolean {
    return this.asyncState === AsyncState.Suspended;
  }

  get hasDebugState(): boolean {
    return typeof this.exports.bgt_debug_state === 'function';
  }

  private mem(): Uint8Array {
    return new Uint8Array(this.exports.memory.buffer);
  }

  private dv(): DataView {
    return new DataView(this.exports.memory.buffer);
  }

  private inRange(ptr: number, len: number): boolean {
    ptr >>>= 0;
    len >>>= 0;
    return ptr + len <= this.exports.memory.buffer.byteLength;
  }

  private str(ptr: number, len: number, max: number): string | null {
    if (len > max || !this.inRange(ptr, len)) return null;
    return utf8.decode(this.mem().subarray(ptr >>> 0, (ptr >>> 0) + (len >>> 0)));
  }

  private decodeContext(): DecodeContext {
    return {
      state: this.state,
      /* LANE-S1 */ gpu: this.gpu,
      gpuRequest: this.gpu ? (id) => {
        const token = this.requests.reserve(id);
        return typeof token === 'number' ? token : (data, error) => this.requests.complete(token, data, error);
      } : undefined,
      frame: this.frame,
      textures: this.textures,
      linearFilter: (this.config.caps & CAP_LINEAR_FILTER) !== 0,
      triangles: (this.config.caps & CAP_TRIANGLES) !== 0,
      renderTargets: (this.config.caps & CAP_RENDER_TARGETS) !== 0,
      opCounts: this.opCounts,
      maxTextureDimension: this.config.maxTextureDimension,
      readback: (this.config.caps & CAP_READBACK) ? (id) => {
        const token = this.requests.reserve(id);
        return typeof token === 'number' ? token : (data, error) => this.requests.complete(token, data, error);
      } : undefined,
    };
  }

  private recordDecode(res: DecodeResult): void {
    for (const e of res.errors) {
      this.commandErrorCount++;
      if (this.commandErrors.length < 64) this.commandErrors.push(e);
      if (this.commandErrorCount <= 20) this.services.log(2, `[bgt] command error ${errorName(e.code)}: ${e.message}`);
    }
  }

  private imports(): { bgt: Record<string, (...args: never[]) => unknown> } {
    const raw = this.rawImports();
    const counted: Record<string, (...args: never[]) => unknown> = {};
    for (const [name, fn] of Object.entries(raw.bgt)) {
      counted[name] = (...args: never[]) => {
        const count=this.importCounts[name] = (this.importCounts[name] ?? 0) + 1;
        // Never time the timer itself or hot coverage crossings. Sample other imports 1/1024.
        const sample=name !== 'time_us' && name !== 'coverage_entry' && (count-1)%1024===0;
        const start=sample?this.services.now():0;
        try { return (fn as (...a: never[]) => unknown)(...args); }
        finally { if(sample) {
          const t=this.profile.imports[name] ??= {samples:0,sampleMs:0,estimatedMs:0};
          t.samples++;t.sampleMs+=this.services.now()-start;
          t.estimatedMs=t.sampleMs*count/t.samples;
        } }
        // Estimates are refreshed at observation for the final unsampled tail.
      };
    }
    return { bgt: counted };
  }

  private rawImports(): { bgt: Record<string, (...args: never[]) => unknown> } {
    const s = this.services;
    const keyOf = (ptr: number, len: number): string | null => {
      const k = this.str(ptr, len, LIMITS.storageKeyBytes);
      return k && /^[A-Za-z0-9_.-]{1,64}$/.test(k) ? k : null;
    };
    const rangeRequest = (h: number,lo: number,hi: number,len: number,ahead = false) => {
          const path=s.vfs.pathFor(h);if(!path)return E_NOT_FOUND;
          const off=(lo >>> 0)+(hi >>> 0)*0x100000000, length=ahead ? Math.min(len >>> 0,65536-(off%65536)) : len >>> 0;
          if(!Number.isSafeInteger(off))return E_INVALID;
          if((len >>> 0)>8*1024*1024)return E_LIMIT;
          const immediate=s.vfs.range(h,off,length,ahead);
          if(!immediate && !s.rangeRead)return E_STATE;
          const token=this.requests.reserve();if(typeof token==='number')return token;
          if(ahead)s.vfs.readAheadRequests++;
          if(immediate){if(ahead)s.vfs.readAhead(h,off,immediate.length);this.requests.complete(token,immediate);}
          else {
            const work=Promise.resolve().then(()=>s.rangeRead!(path,off,length,ahead)).then((data)=>{if(ahead)s.vfs.readAhead(h,off,data.length);this.requests.complete(token,data);},(error)=>{s.log(2,`asset range failed: ${path} at ${off}+${length}: ${String(error)}`);this.requests.complete(token,undefined,E_IO);});
            this.ioWork.add(work);void work.finally(()=>this.ioWork.delete(work));
          }
          return token.id;
    };
    return {
      bgt: {
        /* LANE-K1: Web Crypto's 65536-byte quota is handled without truncating the request. */
        random_bytes: (ptr: number, len: number) => {
          if (!this.inRange(ptr, len)) return E_BOUNDS;
          if (!(this.config.caps & CAP_ENTROPY)) return E_UNSUPPORTED;
          try {
            const bytes = new Uint8Array(len >>> 0);
            for (let i = 0; i < bytes.length; i += 65536) {
              const chunk = bytes.subarray(i, i + 65536);
              if (s.entropy) s.entropy(chunk);
              else globalThis.crypto.getRandomValues(chunk);
            }
            this.mem().set(bytes, ptr >>> 0);
            return BGT_OK;
          } catch { return E_IO; }
        },
        log: (level: number, ptr: number, len: number) => {
          const msg = this.str(ptr, Math.min(len >>> 0, LIMITS.logBytes), LIMITS.logBytes);
          s.log(level >>> 0, msg ?? '<invalid log range>');
        },
        abort: (code: number, ptr: number, len: number) => {
          throw new GameAbort(code, this.str(ptr, len, LIMITS.logBytes) ?? '<invalid message range>');
        },
        submit_commands: (ptr: number, len: number) => {
          const t0 = s.now();
          const res = decodeCommands(this.mem(), ptr, len, this.decodeContext());
          this.decodeTime += s.now() - t0;
          this.recordDecode(res);
          return res.status;
        },
        slice_missing: (kind: number,addr: number) => {
          kind >>>= 0;addr >>>= 0;
          if(kind===1) {
            if(this.codeCoverage.has(addr) || this.codeCoverage.size<CODE_COVERAGE_LIMIT)this.codeCoverage.set(addr,(this.codeCoverage.get(addr) ?? 0)|2);
            else this.codeCoverageDropped++;
          }
          throw new OutsideSlice(kind,addr);
        },
        coverage_entry: (addr: number, kind: number) => {
          addr >>>= 0; kind >>>= 0;
          if (kind === 1 || kind === 2) {
            if(this.codeCoverage.has(addr) || this.codeCoverage.size < CODE_COVERAGE_LIMIT)this.codeCoverage.set(addr,(this.codeCoverage.get(addr) ?? 0) | kind);
            else this.codeCoverageDropped++;
          }
          if(this.allowedCode && !this.allowedCode.has(addr)) {
            const ranges=this.config.sliceCodeRanges ?? [];
            let lo=0,hi=ranges.length;
            while(lo<hi){const m=(lo+hi)>>>1;if(ranges[m].addr<=addr)lo=m+1;else hi=m;}
            if(!lo||addr>=ranges[lo-1].end)throw new OutsideSlice(1,addr);
          }
        },
        gpu_buffer_handles: () => {
          if (this.abiVersion < 0x000300 || !(this.config.caps & CAP_GPU_BUFFER_HANDLES) || !this.gpu) return E_UNSUPPORTED;
          if (this.gpu.pass) return E_STATE;
          this.gpu.bufferHandles = true; return BGT_OK;
        },
        gpu_limits: (dst: number, cap: number) => {
          if ((cap >>> 0) < 16) return E_LIMIT;
          /* LANE-S1: cap 16..79 retains the frozen prefix; cap >=80 opts into GPU limits. */
          const size = (cap >>> 0) >= GPU_LIMITS_SIZE ? GPU_LIMITS_SIZE : 16;
          if ((dst & 3) || !this.inRange(dst, size)) return E_BOUNDS;
          const dv = this.dv();
          const values = [size, this.config.maxTextureDimension ?? LIMITS.textureDim,
            LIMITS.textures - 1, LIMITS.textureBytes];
          if (size === GPU_LIMITS_SIZE) values.push(
            this.gpu ? 1 : 0, GPU_LIMITS.handles, this.config.gpuBudgetBytes ?? GPU_LIMITS.budget, GPU_LIMITS.bufferSize,
            GPU_LIMITS.vertexBuffers, GPU_LIMITS.attributes, GPU_LIMITS.slots, GPU_LIMITS.colorAttachments,
            GPU_LIMITS.uniformAlignment, GPU_LIMITS.uniformRange, GPU_LIMITS.stride, GPU_LIMITS.shaderBytes,
            this.gpu?.backend.languages ?? 0, 13, 65535, 0,
          );
          values.forEach((v, i) => dv.setUint32((dst >>> 0) + i * 4, v, true));
          return 0;
        },
        request_status: (id: number) => this.requests.status(id >>> 0),
        request_read: (id: number, dst: number, cap: number) => {
          if (!this.inRange(dst,cap)) return E_BOUNDS;
          return this.requests.read(id >>> 0,this.mem().subarray(dst >>> 0,(dst >>> 0)+(cap >>> 0)));
        },
        request_close: (id: number) => this.requests.close(id >>> 0),
        asset_open: (ptr: number, len: number) => {
          const p = this.str(ptr, len, 512);
          return p === null ? E_INVALID : s.vfs.openFile(p);
        },
        asset_size: (h: number) => s.vfs.size(h),
        asset_size64: (h: number,dst: number) => {
          if (!this.inRange(dst,8)) return E_BOUNDS;
          const size=s.vfs.size(h);if(size<0)return size;
          this.dv().setBigUint64(dst >>> 0,BigInt(size),true);return 0;
        },
        asset_range_request: (h: number,lo: number,hi: number,len: number) => rangeRequest(h,lo,hi,len),
        asset_read_ahead: (h: number,lo: number,hi: number,len: number) => rangeRequest(h,lo,hi,len,true),
        asset_consumed: (h: number,lo: number,hi: number,len: number) => {
          const off=(lo >>> 0)+(hi >>> 0)*0x100000000;
          return Number.isSafeInteger(off) ? s.vfs.consume(h,off,len >>> 0) : E_INVALID;
        },
        asset_observed: (h: number,lo: number,hi: number,len: number) => {
          const off=(lo >>> 0)+(hi >>> 0)*0x100000000;
          return Number.isSafeInteger(off) ? s.vfs.consume(h,off,len >>> 0,true) : E_INVALID;
        },
        asset_read: (h: number, dst: number, size: number) => {
          if (!this.inRange(dst, size)) return E_BOUNDS;
          return s.vfs.read(h, this.mem().subarray(dst >>> 0, (dst >>> 0) + (size >>> 0)));
        },
        asset_seek: (h: number, off: number) => s.vfs.seek(h, off >>> 0),
        asset_close: (h: number) => s.vfs.close(h),
        audio_push: (ptr: number, frames: number) => {
          if ((ptr & 1) !== 0) return E_INVALID;
          if (!this.inRange(ptr, (frames >>> 0) * 2)) return E_BOUNDS;
          if (!s.audio) return 0;
          return s.audio.push(new Int16Array(this.exports.memory.buffer.slice(ptr >>> 0, (ptr >>> 0) + (frames >>> 0) * 2)));
        },
        audio_push_stereo: (ptr: number, frames: number) => {
          const n = frames >>> 0;
          if (n > 48000 || !this.inRange(ptr, n * 4)) return E_BOUNDS;
          if (!s.audio?.pushStereo) return 0;
          return s.audio.pushStereo(new Int16Array(this.exports.memory.buffer.slice(ptr >>> 0, (ptr >>> 0) + n * 4)));
        },
        input_gamepad_rumble: (index: number, left: number, right: number) => {
          if ((index >>> 0) >= 4) return E_INVALID;
          if (!this.gamepads[index]?.connected) return E_NOT_FOUND;
          s.gamepadRumble?.(index, Math.min(65535, left >>> 0), Math.min(65535, right >>> 0));
          return BGT_OK;
        },
        input_gamepad: (index: number, ptr: number, bytes: number) => {
          if ((index >>> 0) >= 4 || (bytes >>> 0) < 20) return E_INVALID;
          if (!this.inRange(ptr, 20)) return E_BOUNDS;
          const dv = this.dv();
          const p = ptr >>> 0, pad = this.gamepads[index]?.connected ? this.gamepads[index] : undefined;
          dv.setUint32(p, pad?.connected ? 1 : 0, true);
          dv.setUint32(p + 4, pad?.buttons ?? 0, true);
          for (let a = 0; a < 4; a++) dv.setInt16(p + 8 + 2 * a, pad?.axes[a] ?? 0, true);
          for (let t = 0; t < 2; t++) dv.setUint16(p + 16 + 2 * t, pad?.triggers[t] ?? 0, true);
          return BGT_OK;
        },
        audio_queued: () => (s.audio ? s.audio.queued() : 0),
        storage_read: (kp: number, kl: number, dst: number, cap: number) => {
          const key = keyOf(kp, kl);
          if (!key) return E_INVALID;
          if (!this.inRange(dst, cap)) return E_BOUNDS;
          if (!s.storage) return -5;
          const v = s.storage.read(key);
          if (!v) return -5;
          this.mem().set(v.subarray(0, Math.min(v.byteLength, cap >>> 0)), dst >>> 0);
          return v.byteLength;
        },
        storage_write: (kp: number, kl: number, src: number, len: number) => {
          const key = keyOf(kp, kl);
          if (!key) return E_INVALID;
          if ((len >>> 0) > LIMITS.storageValueBytes) return E_LIMIT;
          if (!this.inRange(src, len)) return E_BOUNDS;
          if (!s.storage) return -6;
          return s.storage.write(key, this.mem().slice(src >>> 0, (src >>> 0) + (len >>> 0)));
        },
        time_us: () => ((typeof import.meta.env !== 'undefined' && (import.meta.env.DEV || import.meta.env.VITE_BGT_TEST === '1')) && s.guestNow ? s.guestNow() : s.now()) * 1000,
        yield: () => {
          if (this.config.suspensionMode === 'jspi') return this.suspendJspi();
          const ex = this.exports;
          if (this.asyncState === AsyncState.Rewinding) {
            ex.asyncify_stop_rewind!();
            this.asyncState = AsyncState.Normal;
            return;
          }
          if (!this.asyncCapable || !this.asyncBuf) throw new GameAbort(-7, 'bgt_yield used, but the game was not built with "asyncify": true');
          if (!this.inUpdate) throw new GameAbort(-7, 'bgt_yield is only valid inside bgt_update');
          const dv = this.dv();
          const size = this.exports.bgt_async_buffer_size!() >>> 0;
          dv.setUint32(this.asyncBuf, this.asyncBuf + 8, true);
          dv.setUint32(this.asyncBuf + 4, this.asyncBuf + size, true);
          ex.asyncify_start_unwind!(this.asyncBuf);
          this.asyncState = AsyncState.Unwinding;
        },
        debug_draw_sprite: (
          tex: number,
          x: number,
          y: number,
          w: number,
          h: number,
          u0: number,
          v0: number,
          u1: number,
          v1: number,
          c: number,
        ) => {
          if (!(this.config.caps & CAP_DIRECT_DRAW)) return;
          // Deliberately untimed: per-call timers would dominate the cost being measured.
          const ctx = this.decodeContext();
          tex >>>= 0;
          if (!this.textures.has(tex)) return;
          const clip = effectiveClip(this.state, this.frame.logicalW, this.frame.logicalH);
          if (emitSprite(ctx, x, y, w, h, u0, v0, u1, v1, c) === BGT_OK) {
            this.frame.draw(this.state, clip, 6, tex);
          }
        },
      },
    };
  }

  /** Calls bgt_init; logical size must be set by the game. */
  init(): number {
    const dv = this.dv();
    const p = this.ioPtr;
    const c = this.config;
    dv.setUint32(p + IO.abi_version, ABI_VERSION, true);
    dv.setUint32(p + IO.backend, c.backend, true);
    dv.setUint32(p + IO.caps, (c.caps | (this.asyncCapable ? CAP_YIELD : 0)) >>> 0, true);
    dv.setUint32(p + IO.audio_sample_rate, this.services.audio?.sampleRate ?? 0, true);
    dv.setUint32(p + IO.seed, c.seed >>> 0, true);
    dv.setUint32(p + IO.display_width, c.displayWidth, true);
    dv.setUint32(p + IO.display_height, c.displayHeight, true);
    dv.setUint32(p + IO.arg0, c.arg0 >>> 0, true);
    dv.setUint32(p + IO.arg1, c.arg1 >>> 0, true);
    this.frame.reset(1, 1);
    this.state = defaultState(1, 1);
    const rc = this.exports.bgt_init(p) | 0;
    if (rc !== BGT_OK) throw new HostError(`bgt_init failed with ${errorName(rc)}`);
    const d2 = this.dv();
    this.logicalWidth = d2.getUint32(p + IO.logical_width, true);
    this.logicalHeight = d2.getUint32(p + IO.logical_height, true);
    this.flags = d2.getUint32(p + IO.flags, true);
    if (
      this.logicalWidth === 0 ||
      this.logicalHeight === 0 ||
      this.logicalWidth > LIMITS.logicalDim ||
      this.logicalHeight > LIMITS.logicalDim
    ) {
      throw new HostError(`game set invalid logical size ${this.logicalWidth}x${this.logicalHeight}`);
    }
    if (this.asyncCapable && !this.jspiUpdate) {
      const fb = this.exports.bgt_async_buffer, fs = this.exports.bgt_async_buffer_size;
      if (!fb || !fs) throw new HostError('asyncify build must export bgt_async_buffer and bgt_async_buffer_size');
      this.asyncBuf = fb() >>> 0;
      const size = fs() >>> 0;
      if (this.asyncBuf % 8 || size < 4096 || !this.inRange(this.asyncBuf, size)) throw new HostError('invalid bgt_async_buffer');
    }
    // Commands submitted during init (e.g. texture creation) are kept and
    // flushed with the first rendered frame.
    this.frame.logicalW = this.logicalWidth;
    this.frame.logicalH = this.logicalHeight;
    if(this.allowedCode && this.exports.bgt_slice_policy) {
      const entries=[...this.allowedCode].sort((a,b)=>a-b),ranges=[...(this.config.sliceCodeRanges ?? [])].sort((a,b)=>a.addr-b.addr);
      if(entries.length>1048576 || ranges.length>1048576 || entries.some(a=>!Number.isInteger(a)||a<0||a>0xffffffff) ||
        ranges.some((r,i)=>!Number.isInteger(r.addr)||!Number.isInteger(r.end)||r.addr<0||r.end<=r.addr||r.end>0xffffffff||(i>0 && ranges[i-1].end>r.addr)))
        throw new HostError('invalid slice-policy input');
      const p=this.exports.bgt_slice_policy(entries.length,ranges.length) >>> 0;
      if(!p || p%4 || !this.inRange(p,SLICE_POLICY.SIZE))throw new HostError('invalid slice-policy descriptor');
      const v=this.dv();
      if(v.getUint32(p,true)!==SLICE_POLICY.SIZE || v.getUint32(p+SLICE_POLICY.version,true)!==1 ||
        v.getUint32(p+SLICE_POLICY.entry_count,true)!==entries.length || v.getUint32(p+SLICE_POLICY.range_count,true)!==ranges.length)
        throw new HostError('invalid slice-policy shape');
      const ep=v.getUint32(p+SLICE_POLICY.entries_ptr,true),rp=v.getUint32(p+SLICE_POLICY.ranges_ptr,true);
      if(ep%4 || rp%4 || !this.inRange(ep,entries.length*4) || !this.inRange(rp,ranges.length*8))throw new HostError('invalid slice-policy buffers');
      const overlap=(a:number,n:number,b:number,m:number)=>n>0 && m>0 && a<b+m && b<a+n;
      if(overlap(p,SLICE_POLICY.SIZE,ep,entries.length*4) || overlap(p,SLICE_POLICY.SIZE,rp,ranges.length*8) ||
        overlap(ep,entries.length*4,rp,ranges.length*8))throw new HostError('overlapping slice-policy buffers');
      entries.forEach((a,i)=>v.setUint32(ep+4*i,a,true));
      ranges.forEach((r,i)=>{v.setUint32(rp+8*i,r.addr,true);v.setUint32(rp+8*i+4,r.end,true);});
    }
    this.initialized = true;
    return rc;
  }

  /** Decoded resources and unconsumed GPU work count even before the renderer sees their creation. */
  get hasGpuWork(): boolean {
    const gpu = this.gpu;
    return !!(gpu && (gpu.buffers.size || gpu.textures.size || gpu.samplers.size ||
      gpu.shaders.size || gpu.pipelines.size || gpu.pass)) || this.frame.items.some((it) => it.kind === 'gpu');
  }

  get gpuMetrics(): { budgetBytes: number; reservedBytes: number; peakReservedBytes: number; largestAllocationBytes: number } | null {
    const gpu = this.gpu;
    return gpu ? { budgetBytes: gpu.budget, reservedBytes: gpu.bytes,
      peakReservedBytes: gpu.peakBytes, largestAllocationBytes: gpu.largestAllocation } : null;
  }

  /** Backend switched at runtime (WebGPU loss -> WebGL 2); signalled to the game with BGT_EVENT_DEVICE_RESET. */
  setBackend(backend: number, gpuBackend?: GpuBackend): void {
    if (this.hasGpuWork) throw new Error('Cannot migrate live GPU resources or pending GPU work');
    this.config.backend = backend;
    this.dv().setUint32(this.ioPtr + IO.backend, backend, true);
    /* LANE-WG: fallback without live GPU handles must renegotiate instead of queuing to a lost device. */
    this.config.gpuBackend = gpuBackend;
    if (gpuBackend?.languages) { this.config.caps |= CAP_GPU; this.gpu = new GpuState(gpuBackend, this.config.gpuBudgetBytes); }
    else { this.config.caps &= ~CAP_GPU; this.gpu = undefined; }
    if (this.abiVersion >= 0x000300 && this.gpu?.backend.bufferHandles) this.config.caps |= CAP_GPU_BUFFER_HANDLES;
    else this.config.caps &= ~CAP_GPU_BUFFER_HANDLES;
    this.dv().setUint32(this.ioPtr + IO.caps,
      (this.config.caps | (this.asyncCapable ? CAP_YIELD : 0)) >>> 0, true);
  }

  setDisplaySize(w: number, h: number): void {
    const dv = this.dv();
    dv.setUint32(this.ioPtr + IO.display_width, w, true);
    dv.setUint32(this.ioPtr + IO.display_height, h, true);
  }

  private gamepads: GamepadSnapshot[] = [];

  writeInput(inp: InputSnapshot): void {
    this.gamepads = (inp.gamepads ?? []).slice(0, 4).map((pad) => ({
      connected: !!pad.connected, buttons: pad.buttons >>> 0,
      axes: pad.axes.map((a) => Math.max(-32767, Math.min(32767, a | 0))) as GamepadSnapshot['axes'],
      triggers: pad.triggers.map((t) => Math.max(0, Math.min(65535, t | 0))) as GamepadSnapshot['triggers'],
    }));
    const dv = this.dv();
    const p = this.ioPtr;
    dv.setUint32(p + IO.frame, this.frameIndex >>> 0, true);
    dv.setUint32(p + IO.buttons, inp.buttons >>> 0, true);
    dv.setUint32(p + IO.buttons_pressed, inp.pressed >>> 0, true);
    dv.setUint32(p + IO.buttons_released, inp.released >>> 0, true);
    for (let k = 0; k < 8; k++) {
      dv.setUint32(p + IO.keys + k * 4, inp.keys[k] >>> 0, true);
      dv.setUint32(p + IO.keys_pressed + k * 4, inp.keysPressed[k] >>> 0, true);
    }
    dv.setInt32(p + IO.pointer_x, inp.pointerX | 0, true);
    dv.setInt32(p + IO.pointer_y, inp.pointerY | 0, true);
    dv.setUint32(p + IO.pointer_buttons, inp.pointerButtons >>> 0, true);
    dv.setUint32(p + IO.pointer_inside, inp.pointerInside ? 1 : 0, true);
    for (let k = 0; k < 4; k++) dv.setInt16(p + IO.axes + k * 2, Math.max(-32767, Math.min(32767, inp.axes[k] | 0)), true);
    const n = Math.min(MAX_TOUCHES, inp.touches.length);
    dv.setUint32(p + IO.touch_count, n, true);
    dv.setUint32(p + IO.events, inp.events >>> 0, true);
    for (let k = 0; k < MAX_TOUCHES; k++) {
      const o = p + IO.touches + k * IO.TOUCH_SIZE;
      const t = inp.touches[k];
      dv.setInt32(o, t ? t.id | 0 : 0, true);
      dv.setInt32(o + 4, t ? t.x | 0 : 0, true);
      dv.setInt32(o + 8, t ? t.y | 0 : 0, true);
      dv.setUint32(o + 12, t && k < n ? 1 : 0, true);
    }
  }

  /** Close abandoned interpreter state without replacing the original exception. */
  private abortProfile(): void {
    const abort = this.exports.bgt_profile_abort;
    if (!abort) return; // Older/native modules have no interpreter spans.
    let nowUs = NaN;
    try { nowUs = this.services.now() * 1000; } catch { /* discard open interval */ }
    try { abort(nowUs); } catch { /* cleanup must not mask the original error */ }
  }

  private failedUpdate(t0: number): void {
    // Partial guest execution still consumed wall time, but completed no frame.
    // Keep it in the physical budget; failed/throwing clocks cannot mask a fault.
    try {
      this.observationStarted ??= t0;
      this.timings.updateMs = this.services.now() - t0;
      this.profile.updateMs += this.timings.updateMs;
    } catch { /* original guest error wins */ }
  }

  /** One fixed simulation step. */
  update(): void | Promise<void> {
    if (this.jspiUpdate) return this.updateJspi();
    if (!this.initialized) throw new HostError('update before init');
    const t0 = this.services.now();
    this.requests.advance();
    const ex = this.exports;
    this.inUpdate = true;
    try {
      if (this.asyncState === AsyncState.Suspended) {
        // resume inside bgt_yield where the previous update stopped
        ex.asyncify_start_rewind!(this.asyncBuf);
        this.asyncState = AsyncState.Rewinding;
      }
      ex.bgt_update(DT_US);
      if (this.asyncState === AsyncState.Unwinding) {
        ex.asyncify_stop_unwind!();
        this.asyncState = AsyncState.Suspended;
        this.yields++;
      } else if (this.asyncState === AsyncState.Rewinding) {
        throw new HostError('asyncify rewind did not reach bgt_yield (game state diverged)');
      }
    } catch (error) {
      this.abortProfile();
      this.failedUpdate(t0); throw error;
    } finally {
      this.inUpdate = false;
    }
    this.finishUpdate(t0);
  }

  private finishUpdate(t0: number): void {
    this.observationStarted ??= t0;
    this.timings.updateMs = this.services.now() - t0;
    this.profile.updateMs += this.timings.updateMs;
    this.frameIndex++;
    // v0.2: the game may change its logical size at runtime
    const dv = this.dv();
    const lw = dv.getUint32(this.ioPtr + IO.logical_width, true), lh = dv.getUint32(this.ioPtr + IO.logical_height, true);
    if ((lw !== this.logicalWidth || lh !== this.logicalHeight) && lw > 0 && lh > 0 && lw <= LIMITS.logicalDim && lh <= LIMITS.logicalDim) {
      this.logicalWidth = lw;
      this.logicalHeight = lh;
      this.sizeChanged = true;
    }
  }

  private suspendJspi(): Promise<void> {
    if (!this.inUpdate) throw new GameAbort(-7, 'bgt_yield is only valid inside bgt_update');
    return new Promise<void>((resolve) => {
      this.jspiResume = resolve;
      this.asyncState = AsyncState.Suspended;
      this.yields++;
      this.jspiBoundary?.resolve();
    });
  }

  private async updateJspi(): Promise<void> {
    if (!this.initialized) throw new HostError('update before init');
    if (this.jspiBusy) throw new HostError('overlapping JSPI updates');
    this.jspiBusy = true;
    const t0 = this.services.now();
    this.requests.advance();
    this.inUpdate = true;
    this.asyncState = AsyncState.Normal;
    try {
      const boundary = new Promise<void>((resolve, reject) => { this.jspiBoundary = {resolve, reject}; });
      const pending = this.jspiTask;
      if (pending) {
        const resume = this.jspiResume; this.jspiResume = null;
        if (!resume) throw new HostError('JSPI update has no resume handle');
        resume();
      } else {
        this.jspiTask = this.jspiUpdate!(DT_US).then(() => {
          this.jspiTask = null; this.jspiBoundary?.resolve();
        }, (error: unknown) => {
          this.jspiTask = null; this.jspiBoundary?.reject(error);
        });
      }
      await boundary;
    } catch (error) {
      this.abortProfile();
      this.failedUpdate(t0); throw error;
    } finally {
      this.inUpdate = false; this.jspiBoundary = null; this.jspiBusy = false;
    }
    this.finishUpdate(t0);
  }

  profileReset():boolean {
    const reset=this.exports.bgt_profile_reset;
    if(!reset || this.inUpdate)return false;
    reset();return true;
  }

  interpreterCoverage() {
    const ptr=this.exports.bgt_interpreter_coverage?.() ?? 0;
    return ptr?readInterpreterCoverage(this.exports.memory.buffer,ptr):null;
  }

  /** Optional kit metrics JSON exported by the game (bgt_metrics). */
  metrics(): unknown {
    const fn = this.exports.bgt_metrics;
    if (!fn) return null;
    const ptr = fn() >>> 0;
    const first=this.exports.bgt_slice_first_entry?.() ?? 0;
    if(first && first%4===0 && this.inRange(first,SLICE_FIRST_ENTRY.SIZE)) {
      const v=this.dv(),a=v.getUint32(first+SLICE_FIRST_ENTRY.address,true),kind=v.getUint32(first+SLICE_FIRST_ENTRY.kind,true);
      if((kind===1 || kind===2) && !this.codeCoverage.has(a)) {
        if(this.codeCoverage.size<CODE_COVERAGE_LIMIT)this.codeCoverage.set(a,kind);
        else this.codeCoverageDropped++;
      }
    }
    const mem = this.mem();
    if (!ptr || ptr >= mem.byteLength) return null;
    const end = mem.subarray(ptr, Math.min(mem.byteLength, ptr + LIMITS.metricsBytes)).indexOf(0);
    if (end < 0) return null;
    try {
      const metrics=JSON.parse(utf8.decode(mem.subarray(ptr, ptr + end)));
      for(const [name,t] of Object.entries(this.profile.imports))t.estimatedMs=t.sampleMs*(this.importCounts[name] ?? 0)/t.samples;
      const elapsed=this.observationStarted===null?0:this.services.now()-this.observationStarted;
      const presentPtr=this.exports.bgt_guest_presentations?.() ?? 0;
      return { ...metrics, host_profile: this.profile,
        execution_summary:{suspension:this.config.suspensionMode ?? 'asyncify',updates:this.frameIndex,elapsed_ms:elapsed,updates_per_second:elapsed>0?this.frameIndex*1000/elapsed:null,
          instructions:instructionSummary(metrics),
          interpreter:readInterpreterSummary(metrics,this.exports.memory.buffer,this.exports.bgt_interpreter_coverage?.() ?? 0,this.frameIndex,this.profile.updateMs),
          guest_frames:presentPtr?readGuestPresentations(this.exports.memory.buffer,presentPtr,elapsed):null} };
    } catch {
      return null;
    }
  }

  /**
   * Calls bgt_render and returns the decoded frame. Texture operations the
   * game submitted since the last consume() (during init/update) are kept in
   * order ahead of this frame's draws. The frame stays valid until consume().
   */
  render(): Frame {
    if (!this.initialized) throw new HostError('render before init');
    const pending = this.frame.items.filter((it) => it.kind !== 'draw');
    /* LANE-S1: retained update/init GPU work still counts toward the consumed frame's budgets. */
    const gpuUploads = this.frame.gpuUploadBytes, gpuVertices = this.frame.gpuVertices;
    const {submits, commandBytes, commandCount, continuationSubmits} = this.frame;
    this.frame.reset(this.logicalWidth, this.logicalHeight);
    this.frame.submits = submits; this.frame.commandBytes = commandBytes;
    this.frame.commandCount = commandCount; this.frame.continuationSubmits = continuationSubmits;
    this.frame.gpuUploadBytes = gpuUploads;
    this.frame.gpuVertices = gpuVertices;
    this.frame.items = pending; // bounded continuation may exceed the JS varargs-call ceiling
    this.state = defaultState(this.logicalWidth, this.logicalHeight);
    this.decodeTime = 0;
    const t0 = this.services.now();
    this.exports.bgt_render();
    this.timings.renderMs = this.services.now() - t0;
    this.profile.renderMs += this.timings.renderMs;
    this.timings.decodeMs = this.decodeTime;
    return this.frame;
  }

  /** Mark the current frame as executed by a backend (or intentionally dropped). */
  consume(): void {
    this.frame.reset(this.logicalWidth || 1, this.logicalHeight || 1);
    this.state = defaultState(this.frame.logicalW, this.frame.logicalH);
  }

  /** Decode commands that do not come from the game (tests, conformance). */
  submitExternal(bytes: Uint8Array): DecodeResult {
    const res = decodeCommands(bytes, 0, bytes.byteLength, this.decodeContext());
    this.recordDecode(res);
    return res;
  }

  stateHash(): string | null {
    if (!this.exports.bgt_state_hash) return null;
    return (this.exports.bgt_state_hash() >>> 0).toString(16).padStart(8, '0');
  }

  debugState(): unknown {
    const fn = this.exports.bgt_debug_state;
    if (!fn) return null;
    // The game owns the buffer: it returns the address of a NUL-terminated
    // UTF-8 JSON string, valid until its next bgt_* call.
    const ptr = fn() >>> 0;
    const mem = this.mem();
    if (ptr === 0 || ptr >= mem.byteLength) return null;
    const end = mem.subarray(ptr, Math.min(mem.byteLength, ptr + LIMITS.debugStateBytes)).indexOf(0);
    if (end < 0) return null;
    const text = utf8.decode(mem.subarray(ptr, ptr + end));
    try {
      return JSON.parse(text);
    } catch {
      return { unparsed: text };
    }
  }

  /**
   * Test/debug only, read-only: `len` bytes (1..65536) of the game's guest memory at `addr` through the optional
   * `bgt_debug_peek` export (pipeline games: the emulated address space), or null if the game has no such export or
   * any byte is unmapped. Never writes game state.
   */
  peek(addr: number, len: number): Uint8Array | null {
    const fn = this.exports.bgt_debug_peek;
    addr >>>= 0;
    len >>>= 0;
    if (!fn || len === 0 || len > LIMITS.peekBytes) return null;
    const ptr = fn(addr, len) >>> 0;
    if (!ptr || !this.inRange(ptr, len)) return null;
    return this.mem().slice(ptr, ptr + len);
  }

  get hasPeek(): boolean {
    return typeof this.exports.bgt_debug_peek === 'function';
  }

  shutdown(): void {
    if (this.initialized) this.exports.bgt_shutdown();
    this.initialized = false;
  }
}
