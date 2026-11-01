// BGT command stream v1: validation, decoding into a backend-neutral frame,
// and a TypeScript encoder (used by tests and the conformance page).
//
// Decoding is two-pass: pass 1 validates framing (header, prefixes,
// alignment, bounds) without side effects; a framing error rejects the whole
// submission. Pass 2 executes commands in order; a semantic error (unknown
// opcode, bad handle, limit) skips just that command and is reported.

import { executeGpu, type GpuState } from './commands-gpu';
import { GPU_OP } from './abi';
import type { GpuItem } from '../renderers/types';

import {
  BLEND_MODES,
  BGT_OK,
  CMD_HEADER_SIZE,
  CMD_MAGIC,
  CMD_PREFIX_SIZE,
  CMD_VERSION,
  E_BOUNDS,
  E_INVALID,
  E_LIMIT,
  E_NOT_FOUND,
  E_STATE,
  E_UNSUPPORTED,
  FILTER_LINEAR,
  FORMAT_RGBA8,
  LIMITS,
  OP,
  SPRITE_SIZE,
  VERTEX_SIZE,
  BLEND_OPAQUE,
  FILTER_NEAREST,
  TEX_RENDER_TARGET,
} from './abi';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ReadbackItem {
  kind: 'readback'; target: number; x: number; y: number; w: number; h: number;
  complete(data?: Uint8Array<ArrayBuffer>, error?: number): void;
}
export type FrameItem =
  | GpuItem
  | ReadbackItem
  /** `target` 0 = screen (logical surface), else a render-target texture handle. */
  | { kind: 'draw'; first: number; count: number; texture: number; filter: number; blend: number; clip: Rect; target: number }
  | { kind: 'texCreate'; handle: number; width: number; height: number; renderTarget: boolean }
  | { kind: 'texUpdate'; handle: number; x: number; y: number; w: number; h: number; data: Uint8Array<ArrayBuffer> }
  | { kind: 'texDelete'; handle: number };

/** Floats per vertex: x, y, u, v, rgba(as raw u32 bits). */
export const VERTEX_FLOATS = 5;

export class Frame {
  logicalW = 1;
  logicalH = 1;
  vertexCount = 0;
  items: FrameItem[] = [];
  submits = 0;
  commandBytes = 0;
  gpuUploadBytes = 0;
  gpuVertices = 0;
  private buf = new ArrayBuffer(65536 * VERTEX_FLOATS * 4);
  f32 = new Float32Array(this.buf);
  u32 = new Uint32Array(this.buf);

  reset(logicalW: number, logicalH: number): void {
    this.logicalW = logicalW;
    this.logicalH = logicalH;
    this.vertexCount = 0;
    this.items = [];
    this.submits = 0;
    this.commandBytes = 0;
    this.gpuUploadBytes = 0;
    this.gpuVertices = 0;
  }

  /** Bytes of vertex data, suitable for one GPU upload. */
  vertexBytes(): Uint8Array<ArrayBuffer> {
    return new Uint8Array(this.buf, 0, this.vertexCount * VERTEX_FLOATS * 4);
  }

  reserve(n: number): boolean {
    const need = this.vertexCount + n;
    if (need + this.gpuVertices > LIMITS.verticesPerFrame) return false;
    if (need * VERTEX_FLOATS > this.f32.length) {
      let cap = this.f32.length / VERTEX_FLOATS;
      while (cap < need) cap *= 2;
      const next = new ArrayBuffer(Math.min(cap, LIMITS.verticesPerFrame) * VERTEX_FLOATS * 4);
      new Uint8Array(next).set(new Uint8Array(this.buf, 0, this.vertexCount * VERTEX_FLOATS * 4));
      this.buf = next;
      this.f32 = new Float32Array(next);
      this.u32 = new Uint32Array(next);
    }
    return true;
  }

  vertex(x: number, y: number, u: number, v: number, rgba: number): void {
    const o = this.vertexCount * VERTEX_FLOATS;
    this.f32[o] = x;
    this.f32[o + 1] = y;
    this.f32[o + 2] = u;
    this.f32[o + 3] = v;
    this.u32[o + 4] = rgba >>> 0;
    this.vertexCount++;
  }

  /** Record that the last `count` vertices are drawn with `st`; merges with the previous draw when state matches. */
  draw(st: DrawState, clip: Rect, count: number, texture = st.texture, blend = st.blend, filter = st.filter): void {
    const first = this.vertexCount - count;
    const prev = this.items[this.items.length - 1];
    if (
      prev &&
      prev.kind === 'draw' &&
      prev.texture === texture &&
      prev.filter === filter &&
      prev.blend === blend &&
      prev.first + prev.count === first &&
      prev.target === st.target &&
      rectEq(prev.clip, clip)
    ) {
      prev.count += count;
      return;
    }
    this.items.push({ kind: 'draw', first, count, texture, filter, blend, clip: { ...clip }, target: st.target });
  }

  drawCalls(): number {
    let n = 0;
    for (const it of this.items) if (it.kind === 'draw') n++;
    return n;
  }
}

function rectEq(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

export interface TextureEntry {
  width: number;
  height: number;
  /** v0.2 render target: GPU-side contents are not shadowed (lost on device reset). */
  renderTarget: boolean;
  /** CPU shadow copy; used to restore after GPU device/context loss. */
  shadow: Uint8Array<ArrayBuffer>;
}

export class TextureTable {
  readonly entries = new Map<number, TextureEntry>();
  totalBytes = 0;

  get count(): number {
    return this.entries.size;
  }

  has(handle: number): boolean {
    return handle === 0 || this.entries.has(handle);
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }
}

export interface DrawState {
  vx: number;
  vy: number;
  vw: number;
  vh: number;
  scissor: boolean;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
  blend: number;
  texture: number;
  filter: number;
  /** current draw target (0 = screen) */
  target: number;
}

export function defaultState(logicalW: number, logicalH: number): DrawState {
  return {
    vx: 0,
    vy: 0,
    vw: logicalW,
    vh: logicalH,
    scissor: false,
    sx: 0,
    sy: 0,
    sw: logicalW,
    sh: logicalH,
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    tx: 0,
    ty: 0,
    blend: 1,
    texture: 0,
    filter: FILTER_NEAREST,
    target: 0,
  };
}

export interface CommandError {
  code: number;
  message: string;
  offset: number;
  op: number;
}

export interface DecodeResult {
  status: number;
  executed: number;
  errors: CommandError[];
}

export interface DecodeContext {
  state: DrawState;
  /** Only supplied for a backend implementing §13; omitted means E_UNSUPPORTED. */
  gpu?: GpuState;
  gpuRequest?: (id: number) => ((data?: Uint8Array<ArrayBuffer>, error?: number) => void) | number;
  frame: Frame;
  textures: TextureTable;
  linearFilter: boolean;
  triangles: boolean;
  /** v0.2 render targets enabled (BGT_CAP_RENDER_TARGETS) */
  renderTargets?: boolean;
  readback?: (id: number) => ((data?: Uint8Array<ArrayBuffer>, error?: number) => void) | number;
  maxTextureDimension?: number;
  /** kit coverage: executed commands per opcode (incremented by the decoder) */
  opCounts?: Record<number, number>;
}

/** Size of the current target's coordinate space (logical surface or render-target texture). */
export function targetSize(ctx: DecodeContext): { w: number; h: number } {
  if (ctx.state.target === 0) return { w: ctx.frame.logicalW, h: ctx.frame.logicalH };
  const t = ctx.textures.entries.get(ctx.state.target);
  return t ? { w: t.width, h: t.height } : { w: 0, h: 0 };
}

/** Effective clip = viewport ∩ scissor ∩ logical surface, integer logical px. */
export function effectiveClip(st: DrawState, lw: number, lh: number): Rect {
  let x0 = Math.max(0, st.vx);
  let y0 = Math.max(0, st.vy);
  let x1 = Math.min(lw, st.vx + st.vw);
  let y1 = Math.min(lh, st.vy + st.vh);
  if (st.scissor) {
    x0 = Math.max(x0, st.sx);
    y0 = Math.max(y0, st.sy);
    x1 = Math.min(x1, st.sx + st.sw);
    y1 = Math.min(y1, st.sy + st.sh);
  }
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** Emit one transformed sprite (6 vertices). Returns an error code. */
export function emitSprite(
  ctx: DecodeContext,
  x: number,
  y: number,
  w: number,
  h: number,
  u0: number,
  v0: number,
  u1: number,
  v1: number,
  rgba: number,
): number {
  const st = ctx.state;
  const fr = ctx.frame;
  if (!fr.reserve(6)) return E_LIMIT;
  const ox = st.vx + st.tx;
  const oy = st.vy + st.ty;
  const ax = st.a * x + st.c * y + ox;
  const ay = st.b * x + st.d * y + oy;
  const bx = st.a * (x + w) + st.c * y + ox;
  const by = st.b * (x + w) + st.d * y + oy;
  const cx = st.a * (x + w) + st.c * (y + h) + ox;
  const cy = st.b * (x + w) + st.d * (y + h) + oy;
  const dx = st.a * x + st.c * (y + h) + ox;
  const dy = st.b * x + st.d * (y + h) + oy;
  fr.vertex(ax, ay, u0, v0, rgba);
  fr.vertex(bx, by, u1, v0, rgba);
  fr.vertex(cx, cy, u1, v1, rgba);
  fr.vertex(ax, ay, u0, v0, rgba);
  fr.vertex(cx, cy, u1, v1, rgba);
  fr.vertex(dx, dy, u0, v1, rgba);
  return BGT_OK;
}

/**
 * Validate and execute one submission from linear memory `mem` at [ptr, ptr+len).
 */
export function decodeCommands(mem: Uint8Array, ptr: number, len: number, ctx: DecodeContext): DecodeResult {
  const errors: CommandError[] = [];
  const fail = (code: number, message: string, offset = 0, op = 0): DecodeResult => {
    errors.push({ code, message, offset, op });
    return { status: code, executed: 0, errors };
  };

  ptr >>>= 0;
  len >>>= 0;
  if (ctx.frame.submits >= LIMITS.submitsPerFrame) return fail(E_LIMIT, 'too many submissions in one frame');
  if (len < CMD_HEADER_SIZE) return fail(E_INVALID, `command buffer shorter than header (${len} bytes)`);
  if (len > LIMITS.submitBytes) return fail(E_LIMIT, `command buffer of ${len} bytes exceeds ${LIMITS.submitBytes}`);
  if (ptr + len > mem.byteLength) return fail(E_BOUNDS, `command buffer [${ptr}, +${len}) outside linear memory`);
  if (ptr & 3) return fail(E_INVALID, 'command buffer must be 4-byte aligned');

  const dv = new DataView(mem.buffer, mem.byteOffset + ptr, len);
  if (dv.getUint32(0, true) !== CMD_MAGIC) return fail(E_INVALID, 'bad command buffer magic');
  const version = dv.getUint16(4, true);
  if (version !== CMD_VERSION) return fail(E_UNSUPPORTED, `unsupported command stream version ${version}`);
  if (dv.getUint16(6, true) !== 0) return fail(E_UNSUPPORTED, 'non-zero header flags');
  const byteLen = dv.getUint32(8, true);
  const count = dv.getUint32(12, true);
  if (byteLen !== len) return fail(E_INVALID, `header byte_len ${byteLen} != submitted length ${len}`);
  if (count > LIMITS.commands) return fail(E_LIMIT, `cmd_count ${count} exceeds ${LIMITS.commands}`);

  // Pass 1: framing.
  let off = CMD_HEADER_SIZE;
  for (let i = 0; i < count; i++) {
    if (off + CMD_PREFIX_SIZE > len) return fail(E_BOUNDS, `command ${i} prefix past end`, off);
    const payload = dv.getUint32(off + 4, true);
    if (payload & 3) return fail(E_INVALID, `command ${i} payload_len ${payload} not 4-aligned`, off, dv.getUint16(off, true));
    if (payload > len - off - CMD_PREFIX_SIZE) return fail(E_BOUNDS, `command ${i} payload past end`, off, dv.getUint16(off, true));
    off += CMD_PREFIX_SIZE + payload;
  }
  if (off !== len) return fail(E_INVALID, `${len - off} trailing bytes after ${count} commands`, off);

  // Pass 2: execute.
  ctx.frame.submits++;
  ctx.frame.commandBytes += len;
  off = CMD_HEADER_SIZE;
  let executed = 0;
  for (let i = 0; i < count; i++) {
    const op = dv.getUint16(off, true);
    const flags = dv.getUint16(off + 2, true);
    const payload = dv.getUint32(off + 4, true);
    const p = off + CMD_PREFIX_SIZE;
    const code = flags !== 0 ? E_UNSUPPORTED : execute(op, dv, p, payload, mem, ctx);
    if (code !== BGT_OK) {
      errors.push({ code, message: describe(op, code, flags), offset: off, op });
    } else {
      executed++;
      if (ctx.opCounts) ctx.opCounts[op] = (ctx.opCounts[op] ?? 0) + 1;
    }
    off = p + payload;
  }
  if (ctx.gpu?.pass) {
    ctx.gpu.pass = undefined;
    ctx.frame.items.push({ kind: 'gpu', op: GPU_OP.PASS_END, words: [] });
    errors.push({ code: E_STATE, message: 'GPU pass not ended in submission; closed implicitly', offset: len, op: 0 });
  }
  return { status: errors.length ? errors[0].code : BGT_OK, executed, errors };
}

function describe(op: number, code: number, flags: number): string {
  if (flags) return `op 0x${op.toString(16)}: non-zero command flags`;
  const name = Object.entries(OP).find(([, v]) => v === op)?.[0]
    ?? Object.entries(GPU_OP).find(([, v]) => v === op)?.[0] ?? `0x${op.toString(16)}`;
  const why: Record<number, string> = {
    [E_INVALID]: 'invalid payload',
    [E_BOUNDS]: 'pointer/length outside linear memory',
    [E_LIMIT]: 'resource limit exceeded',
    [E_UNSUPPORTED]: 'unsupported opcode or capability',
    [E_NOT_FOUND]: 'unknown texture handle',
    [E_STATE]: 'invalid in current state',
  };
  return `${name}: ${why[code] ?? `error ${code}`}`;
}

function execute(op: number, dv: DataView, p: number, n: number, mem: Uint8Array, ctx: DecodeContext): number {
  const st = ctx.state;
  const fr = ctx.frame;
  const u = (o: number) => dv.getUint32(p + o, true);
  const i = (o: number) => dv.getInt32(p + o, true);
  const f = (o: number) => dv.getFloat32(p + o, true);

  if (op >= GPU_OP.BUFFER_CREATE && op <= GPU_OP.TEXTURE_ALLOCATE_MIPS) {
    return executeGpu(op, dv, p, n, mem, ctx);
  }
  if (ctx.gpu?.pass) return E_STATE; // No legacy operation may interrupt an explicit GPU pass.

  switch (op) {
    case OP.READBACK: {
      if (n !== 24) return E_INVALID;
      if (!ctx.readback) return E_UNSUPPORTED;
      const id = u(0), target = u(4), x = u(8), y = u(12), w = u(16), h = u(20);
      if (!w || !h) return E_INVALID;
      if (w * h * 4 > 8 * 1024 * 1024) return E_LIMIT;
      const t = target ? ctx.textures.entries.get(target) : null;
      if (target && !t) return E_NOT_FOUND;
      if (t && !t.renderTarget) return E_INVALID;
      if (x + w > (t?.width ?? fr.logicalW) || y + h > (t?.height ?? fr.logicalH)) return E_BOUNDS;
      const complete = ctx.readback(id);
      if (typeof complete === 'number') return complete;
      fr.items.push({kind:'readback',target,x,y,w,h,complete});
      return BGT_OK;
    }
    case OP.CLEAR: {
      if (n !== 4) return E_INVALID;
      const ts = targetSize(ctx);
      const clip = effectiveClip(st, ts.w, ts.h);
      if (clip.w === 0 || clip.h === 0) return BGT_OK;
      if (!fr.reserve(6)) return E_LIMIT;
      const c = u(0);
      const x0 = clip.x, y0 = clip.y, x1 = clip.x + clip.w, y1 = clip.y + clip.h;
      fr.vertex(x0, y0, 0, 0, c);
      fr.vertex(x1, y0, 1, 0, c);
      fr.vertex(x1, y1, 1, 1, c);
      fr.vertex(x0, y0, 0, 0, c);
      fr.vertex(x1, y1, 1, 1, c);
      fr.vertex(x0, y1, 0, 1, c);
      fr.draw(st, clip, 6, 0, BLEND_OPAQUE, FILTER_NEAREST);
      return BGT_OK;
    }
    case OP.VIEWPORT: {
      if (n !== 16) return E_INVALID;
      const w = i(8), h = i(12);
      if (w < 0 || h < 0) return E_INVALID;
      st.vx = i(0);
      st.vy = i(4);
      st.vw = w;
      st.vh = h;
      return BGT_OK;
    }
    case OP.SCISSOR: {
      if (n !== 20) return E_INVALID;
      const en = u(0);
      const w = i(12), h = i(16);
      if (en > 1 || w < 0 || h < 0) return E_INVALID;
      st.scissor = en === 1;
      st.sx = i(4);
      st.sy = i(8);
      st.sw = w;
      st.sh = h;
      return BGT_OK;
    }
    case OP.TRANSFORM: {
      if (n !== 24) return E_INVALID;
      const m = [f(0), f(4), f(8), f(12), f(16), f(20)];
      if (!m.every(Number.isFinite)) return E_INVALID;
      [st.a, st.b, st.c, st.d, st.tx, st.ty] = m;
      return BGT_OK;
    }
    case OP.BLEND: {
      if (n !== 4) return E_INVALID;
      const mode = u(0);
      if (mode >= BLEND_MODES) return E_UNSUPPORTED;
      st.blend = mode;
      return BGT_OK;
    }
    case OP.TEXTURE: {
      if (n !== 8) return E_INVALID;
      const handle = u(0), filter = u(4);
      if (filter > FILTER_LINEAR) return E_UNSUPPORTED;
      if (filter === FILTER_LINEAR && !ctx.linearFilter) return E_UNSUPPORTED;
      if (!ctx.textures.has(handle)) return E_NOT_FOUND;
      st.texture = handle;
      st.filter = filter;
      return BGT_OK;
    }
    case OP.TARGET: {
      if (n !== 4) return E_INVALID;
      const handle = u(0);
      if (handle !== 0) {
        if (!ctx.renderTargets) return E_UNSUPPORTED;
        const t = ctx.textures.entries.get(handle);
        if (!t) return E_NOT_FOUND;
        if (!t.renderTarget) return E_INVALID;
      }
      st.target = handle;
      const ts = targetSize(ctx);
      st.vx = 0; st.vy = 0; st.vw = ts.w; st.vh = ts.h;
      st.scissor = false;
      return BGT_OK;
    }
    case OP.TEX_CREATE: {
      if (n !== 16) return E_INVALID;
      const handle = u(0), w = u(4), h = u(8), fmtWord = u(12);
      const rt = (fmtWord & TEX_RENDER_TARGET) !== 0;
      const fmt = fmtWord & ~TEX_RENDER_TARGET;
      if (fmt !== FORMAT_RGBA8) return E_UNSUPPORTED;
      if (rt && !ctx.renderTargets) return E_UNSUPPORTED;
      if (handle === 0 || handle >= LIMITS.textures) return E_INVALID;
      if (ctx.textures.entries.has(handle)) return E_STATE;
      if (w === 0 || h === 0 || w > (ctx.maxTextureDimension ?? LIMITS.textureDim) || h > (ctx.maxTextureDimension ?? LIMITS.textureDim)) return E_LIMIT;
      const bytes = w * h * 4;
      if (ctx.textures.totalBytes + bytes > LIMITS.textureBytes) return E_LIMIT;
      ctx.textures.entries.set(handle, { width: w, height: h, renderTarget: rt, shadow: new Uint8Array(bytes) });
      ctx.textures.totalBytes += bytes;
      fr.items.push({ kind: 'texCreate', handle, width: w, height: h, renderTarget: rt });
      return BGT_OK;
    }
    case OP.TEX_UPDATE: {
      if (n !== 28) return E_INVALID;
      const handle = u(0), x = u(4), y = u(8), w = u(12), h = u(16), dp = u(20), dl = u(24);
      const tex = ctx.textures.entries.get(handle);
      if (!tex) return E_NOT_FOUND;
      if (w === 0 || h === 0 || x + w > tex.width || y + h > tex.height) return E_INVALID;
      if (dl !== w * h * 4) return E_INVALID;
      if (dp + dl > mem.byteLength) return E_BOUNDS;
      const data = new Uint8Array(mem.subarray(dp, dp + dl));
      for (let row = 0; row < h; row++) {
        tex.shadow.set(data.subarray(row * w * 4, (row + 1) * w * 4), ((y + row) * tex.width + x) * 4);
      }
      fr.items.push({ kind: 'texUpdate', handle, x, y, w, h, data });
      return BGT_OK;
    }
    case OP.TEX_DELETE: {
      if (n !== 4) return E_INVALID;
      const handle = u(0);
      const tex = ctx.textures.entries.get(handle);
      if (!tex) return E_NOT_FOUND;
      if (st.target === handle) return E_STATE; // cannot delete the texture being drawn into
      ctx.textures.entries.delete(handle);
      ctx.textures.totalBytes -= tex.shadow.byteLength;
      if (st.texture === handle) st.texture = 0;
      fr.items.push({ kind: 'texDelete', handle });
      return BGT_OK;
    }
    case OP.SPRITES: {
      if (n < 4) return E_INVALID;
      const cnt = u(0);
      if (n !== 4 + cnt * SPRITE_SIZE) return E_INVALID;
      if (!ctx.textures.has(st.texture)) return E_NOT_FOUND;
      if (st.target !== 0 && st.texture === st.target) return E_STATE; // feedback loop
      const ts = targetSize(ctx);
      const clip = effectiveClip(st, ts.w, ts.h);
      if (cnt === 0 || clip.w === 0 || clip.h === 0) return BGT_OK;
      if (!fr.reserve(cnt * 6)) return E_LIMIT;
      for (let k = 0, o = 4; k < cnt; k++, o += SPRITE_SIZE) {
        emitSprite(ctx, f(o), f(o + 4), f(o + 8), f(o + 12), f(o + 16), f(o + 20), f(o + 24), f(o + 28), u(o + 32));
      }
      fr.draw(st, clip, cnt * 6);
      return BGT_OK;
    }
    case OP.TRIANGLES: {
      if (!ctx.triangles) return E_UNSUPPORTED;
      if (n < 4) return E_INVALID;
      const cnt = u(0);
      if (cnt % 3 !== 0 || n !== 4 + cnt * VERTEX_SIZE) return E_INVALID;
      if (!ctx.textures.has(st.texture)) return E_NOT_FOUND;
      if (st.target !== 0 && st.texture === st.target) return E_STATE;
      const ts = targetSize(ctx);
      const clip = effectiveClip(st, ts.w, ts.h);
      if (cnt === 0 || clip.w === 0 || clip.h === 0) return BGT_OK;
      if (!fr.reserve(cnt)) return E_LIMIT;
      const ox = st.vx + st.tx, oy = st.vy + st.ty;
      for (let k = 0, o = 4; k < cnt; k++, o += VERTEX_SIZE) {
        const x = f(o), y = f(o + 4);
        fr.vertex(st.a * x + st.c * y + ox, st.b * x + st.d * y + oy, f(o + 8), f(o + 12), u(o + 16));
      }
      fr.draw(st, clip, cnt);
      return BGT_OK;
    }
    default:
      return E_UNSUPPORTED;
  }
}

// ---------------------------------------------------------------- encoder

/** TypeScript mirror of bgt_cmd.h, for tests, conformance scenes and tools. */
export class CommandEncoder {
  private bytes: number[] = [];
  private view = new DataView(new ArrayBuffer(4));
  private count = 0;

  private u32(v: number): this {
    this.view.setUint32(0, v >>> 0, true);
    for (let k = 0; k < 4; k++) this.bytes.push(this.view.getUint8(k));
    return this;
  }
  private i32(v: number): this {
    this.view.setInt32(0, v | 0, true);
    for (let k = 0; k < 4; k++) this.bytes.push(this.view.getUint8(k));
    return this;
  }
  private f32(v: number): this {
    this.view.setFloat32(0, v, true);
    for (let k = 0; k < 4; k++) this.bytes.push(this.view.getUint8(k));
    return this;
  }
  private cmd(op: number, payloadLen: number): this {
    this.count++;
    this.bytes.push(op & 0xff, (op >> 8) & 0xff, 0, 0);
    return this.u32(payloadLen);
  }

  clear(rgba: number) { return this.cmd(OP.CLEAR, 4).u32(rgba); }
  viewport(x: number, y: number, w: number, h: number) { return this.cmd(OP.VIEWPORT, 16).i32(x).i32(y).i32(w).i32(h); }
  scissor(enable: boolean, x = 0, y = 0, w = 0, h = 0) { return this.cmd(OP.SCISSOR, 20).u32(enable ? 1 : 0).i32(x).i32(y).i32(w).i32(h); }
  transform(a: number, b: number, c: number, d: number, tx: number, ty: number) {
    return this.cmd(OP.TRANSFORM, 24).f32(a).f32(b).f32(c).f32(d).f32(tx).f32(ty);
  }
  blend(mode: number) { return this.cmd(OP.BLEND, 4).u32(mode); }
  texture(handle: number, filter = 0) { return this.cmd(OP.TEXTURE, 8).u32(handle).u32(filter); }
  readback(request: number, target: number, x: number, y: number, w: number, h: number) {
    return this.cmd(OP.READBACK,24).u32(request).u32(target).u32(x).u32(y).u32(w).u32(h);
  }
  texCreate(handle: number, w: number, h: number, renderTarget = false) {
    return this.cmd(OP.TEX_CREATE, 16).u32(handle).u32(w).u32(h).u32(FORMAT_RGBA8 | (renderTarget ? TEX_RENDER_TARGET : 0));
  }
  target(handle: number) { return this.cmd(OP.TARGET, 4).u32(handle); }
  texUpdate(handle: number, x: number, y: number, w: number, h: number, dataPtr: number, dataLen: number) {
    return this.cmd(OP.TEX_UPDATE, 28).u32(handle).u32(x).u32(y).u32(w).u32(h).u32(dataPtr).u32(dataLen);
  }
  texDelete(handle: number) { return this.cmd(OP.TEX_DELETE, 4).u32(handle); }
  sprites(list: Array<[number, number, number, number, number, number, number, number, number]>) {
    this.cmd(OP.SPRITES, 4 + list.length * SPRITE_SIZE).u32(list.length);
    for (const s of list) {
      for (let k = 0; k < 8; k++) this.f32(s[k]);
      this.u32(s[8]);
    }
    return this;
  }
  rect(x: number, y: number, w: number, h: number, rgba: number) { return this.sprites([[x, y, w, h, 0, 0, 1, 1, rgba]]); }
  triangles(verts: Array<[number, number, number, number, number]>) {
    this.cmd(OP.TRIANGLES, 4 + verts.length * VERTEX_SIZE).u32(verts.length);
    for (const v of verts) this.f32(v[0]).f32(v[1]).f32(v[2]).f32(v[3]).u32(v[4]);
    return this;
  }
  /** §13 wire-word encoder: float fields must be passed as IEEE-754 u32 bits. */
  gpu(op: number, words: readonly number[]) {
    this.cmd(op, words.length * 4);
    for (const word of words) this.u32(word);
    return this;
  }
  /** Raw command for malformed-input tests. */
  raw(op: number, payload: number[]) {
    this.cmd(op, payload.length);
    this.bytes.push(...payload);
    return this;
  }

  finish(): Uint8Array {
    const out = new Uint8Array(CMD_HEADER_SIZE + this.bytes.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, CMD_MAGIC, true);
    dv.setUint16(4, CMD_VERSION, true);
    dv.setUint16(6, 0, true);
    dv.setUint32(8, out.length, true);
    dv.setUint32(12, this.count, true);
    out.set(this.bytes, CMD_HEADER_SIZE);
    return out;
  }
}

export function rgba(r: number, g: number, b: number, a = 255): number {
  return ((r & 255) | ((g & 255) << 8) | ((b & 255) << 16) | ((a & 255) << 24)) >>> 0;
}
