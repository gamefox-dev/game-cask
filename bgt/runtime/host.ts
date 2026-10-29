// DOM-free host for a BGT wasm game: instantiation, import table, memory
// validation, lifecycle calls and per-frame command decoding. Used by the
// browser runtime and directly by Node unit tests (headless backend).

import {
  ABI_VERSION,
  BGT_OK,
  CAP_DIRECT_DRAW,
  CAP_LINEAR_FILTER,
  CAP_TRIANGLES,
  DT_US,
  E_BOUNDS,
  E_INVALID,
  E_LIMIT,
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
}

export interface HostConfig {
  backend: number;
  caps: number;
  seed: number;
  displayWidth: number;
  displayHeight: number;
  arg0: number;
  arg1: number;
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
  state: DrawState = defaultState(1, 1);
  logicalWidth = 0;
  logicalHeight = 0;
  flags = 0;
  frameIndex = 0;
  commandErrors: CommandError[] = [];
  commandErrorCount = 0;
  readonly timings: HostTimings = { updateMs: 0, renderMs: 0, decodeMs: 0 };
  private exports!: GameExports;
  private ioPtr = 0;
  private initialized = false;
  private decodeTime = 0;

  private constructor(
    private readonly services: HostServices,
    readonly config: HostConfig,
  ) {}

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
      frame: this.frame,
      textures: this.textures,
      linearFilter: (this.config.caps & CAP_LINEAR_FILTER) !== 0,
      triangles: (this.config.caps & CAP_TRIANGLES) !== 0,
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
        asset_open: (ptr: number, len: number) => {
          const p = this.str(ptr, len, 512);
          return p === null ? E_INVALID : s.vfs.openFile(p);
        },
        asset_size: (h: number) => s.vfs.size(h),
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
    dv.setUint32(p + IO.caps, c.caps, true);
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
    // Commands submitted during init (e.g. texture creation) are kept and
    // flushed with the first rendered frame.
    this.frame.logicalW = this.logicalWidth;
    this.frame.logicalH = this.logicalHeight;
    this.initialized = true;
    return rc;
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
    this.exports.bgt_update(DT_US);
    this.timings.updateMs = this.services.now() - t0;
    this.frameIndex++;
  }

  /**
   * Calls bgt_render and returns the decoded frame. Texture operations the
   * game submitted since the last consume() (during init/update) are kept in
   * order ahead of this frame's draws. The frame stays valid until consume().
   */
  render(): Frame {
    if (!this.initialized) throw new HostError('render before init');
    const pending = this.frame.items.filter((it) => it.kind !== 'draw');
    this.frame.reset(this.logicalWidth, this.logicalHeight);
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

  shutdown(): void {
    if (this.initialized) this.exports.bgt_shutdown();
    this.initialized = false;
  }
}
