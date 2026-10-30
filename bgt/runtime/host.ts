// DOM-free host for a BGT wasm game: instantiation, import table, memory
// validation, lifecycle calls and per-frame command decoding. Used by the
// browser runtime and directly by Node unit tests (headless backend).

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
  IO,
  LIMITS,
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
import { CAP_GPU, GPU_LIMITS, GPU_LIMITS_SIZE } from './abi';
import type { GpuBackend } from '../renderers/types';

export interface AudioSink {
  readonly sampleRate: number;
  push(samples: Int16Array): number;
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
  storage?: StorageSink;
  now(): number;
  rangeRead?(path: string, offset: number, length: number): Promise<Uint8Array<ArrayBuffer>>;
}

export interface HostConfig {
  backend: number;
  caps: number;
  seed: number;
  displayWidth: number;
  displayHeight: number;
  arg0: number;
  arg1: number;
  maxTextureDimension?: number;
  /* LANE-S1 */ gpuBackend?: GpuBackend;
  sliceCode?: number[];
}

export interface InputSnapshot {
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

const utf8 = new TextDecoder('utf-8', { fatal: false });

export class GameHost {
  readonly frame = new Frame();
  readonly textures = new TextureTable();
  readonly requests = new Requests();
  /* LANE-S1 */ private gpu?: GpuState;
  readonly codeCoverage = new Map<number, number>();
  codeCoverageDropped = 0;
  private allowedCode: Set<number> | null = null;
  private ioWork = new Set<Promise<void>>();
  get ioPending(): boolean { return this.ioWork.size > 0; }
  async settleRequests(): Promise<void> { await Promise.all([...this.ioWork]); }
  state: DrawState = defaultState(1, 1);
  logicalWidth = 0;
  logicalHeight = 0;
  flags = 0;
  frameIndex = 0;
  commandErrors: CommandError[] = [];
  /** kit coverage: BGT commands executed per opcode, and runtime imports called */
  readonly opCounts: Record<number, number> = {};
  readonly importCounts: Record<string, number> = {};
  commandErrorCount = 0;
  readonly timings: HostTimings = { updateMs: 0, renderMs: 0, decodeMs: 0 };
  private exports!: GameExports;
  private ioPtr = 0;
  private initialized = false;
  private decodeTime = 0;
  private asyncState = AsyncState.Normal;
  private asyncBuf = 0;
  private inUpdate = false;
  /** updates that ended suspended in bgt_yield (vs. returning normally) */
  yields = 0;
  /** set when the game changed its logical size during an update (v0.2) */
  sizeChanged = false;

  private constructor(
    private readonly services: HostServices,
    readonly config: HostConfig,
  ) {
    if (config.sliceCode) this.allowedCode = new Set(config.sliceCode);
    /* LANE-S1: a caller cannot advertise an absent/unsupported GPU implementation. */
    if (config.gpuBackend?.languages && (config.caps & CAP_GPU)) this.gpu = new GpuState(config.gpuBackend);
    else config.caps &= ~CAP_GPU;
  }

  static async create(wasm: BufferSource | WebAssembly.Module, services: HostServices, config: HostConfig): Promise<GameHost> {
    const host = new GameHost(services, config);
    const module = wasm instanceof WebAssembly.Module ? wasm : await WebAssembly.compile(wasm);
    const imports = host.imports();
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
    const instance = await WebAssembly.instantiate(module, imports);
    host.exports = instance.exports as unknown as GameExports;
    const v = host.exports.bgt_abi_version() >>> 0;
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
    return typeof this.exports.asyncify_start_unwind === 'function';
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
        this.importCounts[name] = (this.importCounts[name] ?? 0) + 1;
        return (fn as (...a: never[]) => unknown)(...args);
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
    return {
      bgt: {
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
        slice_missing: (kind: number,addr: number) => { throw new OutsideSlice(kind >>> 0,addr >>> 0); },
        coverage_entry: (addr: number, kind: number) => {
          addr >>>= 0; kind >>>= 0;
          if (kind === 1 || kind === 2) {
            if(this.codeCoverage.has(addr) || this.codeCoverage.size < 65536)this.codeCoverage.set(addr,(this.codeCoverage.get(addr) ?? 0) | kind);
            else this.codeCoverageDropped++;
          }
          if(this.allowedCode && !this.allowedCode.has(addr))throw new OutsideSlice(1,addr);
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
            this.gpu ? 1 : 0, GPU_LIMITS.handles, GPU_LIMITS.budget, GPU_LIMITS.bufferSize,
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
        asset_range_request: (h: number,lo: number,hi: number,len: number) => {
          const path=s.vfs.pathFor(h);if(!path)return E_NOT_FOUND;
          const off=(lo >>> 0)+(hi >>> 0)*0x100000000, length=len >>> 0;
          if(!Number.isSafeInteger(off))return E_INVALID;
          if(length>8*1024*1024)return E_LIMIT;
          const immediate=s.vfs.range(h,off,length);
          if(!immediate && !s.rangeRead)return E_STATE;
          const token=this.requests.reserve();if(typeof token==='number')return token;
          if(immediate)this.requests.complete(token,immediate);
          else {
            const work=Promise.resolve().then(()=>s.rangeRead!(path,off,length)).then((data)=>{this.requests.complete(token,data);},(error)=>{s.log(2,`asset range failed: ${path} at ${off}+${length}: ${String(error)}`);this.requests.complete(token,undefined,E_IO);});
            this.ioWork.add(work);void work.finally(()=>this.ioWork.delete(work));
          }
          return token.id;
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
        time_us: () => s.now() * 1000,
        yield: () => {
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
    if (this.asyncCapable) {
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
    this.initialized = true;
    return rc;
  }

  /** Backend switched at runtime (WebGPU loss -> WebGL 2); signalled to the game with BGT_EVENT_DEVICE_RESET. */
  setBackend(backend: number): void {
    this.dv().setUint32(this.ioPtr + IO.backend, backend, true);
  }

  setDisplaySize(w: number, h: number): void {
    const dv = this.dv();
    dv.setUint32(this.ioPtr + IO.display_width, w, true);
    dv.setUint32(this.ioPtr + IO.display_height, h, true);
  }

  writeInput(inp: InputSnapshot): void {
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

  /** One fixed simulation step. */
  update(): void {
    if (!this.initialized) throw new HostError('update before init');
    const t0 = this.services.now();
    this.requests.advance();
    const ex = this.exports;
    if (this.asyncState === AsyncState.Suspended) {
      // resume inside bgt_yield where the previous update stopped
      ex.asyncify_start_rewind!(this.asyncBuf);
      this.asyncState = AsyncState.Rewinding;
    }
    this.inUpdate = true;
    try {
      ex.bgt_update(DT_US);
    } finally {
      this.inUpdate = false;
    }
    if (this.asyncState === AsyncState.Unwinding) {
      ex.asyncify_stop_unwind!();
      this.asyncState = AsyncState.Suspended;
      this.yields++;
    } else if (this.asyncState === AsyncState.Rewinding) {
      throw new HostError('asyncify rewind did not reach bgt_yield (game state diverged)');
    }
    this.timings.updateMs = this.services.now() - t0;
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

  /** Optional kit metrics JSON exported by the game (bgt_metrics). */
  metrics(): unknown {
    const fn = this.exports.bgt_metrics;
    if (!fn) return null;
    const ptr = fn() >>> 0;
    const mem = this.mem();
    if (!ptr || ptr >= mem.byteLength) return null;
    const end = mem.subarray(ptr, Math.min(mem.byteLength, ptr + LIMITS.debugStateBytes)).indexOf(0);
    if (end < 0) return null;
    try {
      return JSON.parse(utf8.decode(mem.subarray(ptr, ptr + end)));
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
    this.frame.reset(this.logicalWidth, this.logicalHeight);
    this.frame.gpuUploadBytes = gpuUploads;
    this.frame.gpuVertices = gpuVertices;
    this.frame.items.push(...pending);
    this.state = defaultState(this.logicalWidth, this.logicalHeight);
    this.decodeTime = 0;
    const t0 = this.services.now();
    this.exports.bgt_render();
    this.timings.renderMs = this.services.now() - t0;
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
