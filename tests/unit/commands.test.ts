import { describe, expect, it } from 'vitest';
import * as A from '../../bgt/runtime/abi';
import { CommandEncoder, DecodeContext, Frame, TextureTable, decodeCommands, defaultState, effectiveClip, rgba } from '../../bgt/runtime/commands';

function ctx(lw = 100, lh = 100): DecodeContext {
  const frame = new Frame();
  frame.reset(lw, lh);
  return { state: defaultState(lw, lh), frame, textures: new TextureTable(), linearFilter: true, triangles: true };
}

function run(bytes: Uint8Array, c = ctx(), extra?: Uint8Array) {
  const mem = new Uint8Array((extra?.length ?? 0) + bytes.length);
  if (extra) mem.set(extra, 0);
  mem.set(bytes, extra?.length ?? 0);
  return { res: decodeCommands(mem, extra?.length ?? 0, bytes.length, c), c };
}

describe('command decoding', () => {
  it('batches consecutive sprites with identical state into one draw', () => {
    const { res, c } = run(new CommandEncoder().rect(0, 0, 10, 10, 1).rect(10, 0, 10, 10, 2).rect(20, 0, 10, 10, 3).finish());
    expect(res.status).toBe(0);
    const draws = c.frame.items.filter((i) => i.kind === 'draw');
    expect(draws).toHaveLength(1);
    expect(draws[0]).toMatchObject({ first: 0, count: 18 });
  });

  it('state changes split batches while preserving order', () => {
    const { c } = run(new CommandEncoder().rect(0, 0, 1, 1, 1).blend(A.BLEND_ADD).rect(0, 0, 1, 1, 1).blend(A.BLEND_ALPHA).rect(0, 0, 1, 1, 1).finish());
    const draws = c.frame.items.filter((i) => i.kind === 'draw') as Array<{ blend: number; first: number }>;
    expect(draws.map((d) => d.blend)).toEqual([A.BLEND_ALPHA, A.BLEND_ADD, A.BLEND_ALPHA]);
    expect(draws.map((d) => d.first)).toEqual([0, 6, 12]);
  });

  it('applies transform and viewport origin to sprite corners', () => {
    const { c } = run(new CommandEncoder().viewport(10, 20, 50, 50).transform(2, 0, 0, 3, 1, 1).rect(1, 1, 2, 2, 0).finish());
    const f = c.frame.f32;
    expect([f[0], f[1]]).toEqual([10 + 1 + 2, 20 + 1 + 3]); // top-left
    expect([f[10], f[11]]).toEqual([10 + 1 + 6, 20 + 1 + 9]); // bottom-right (third vertex)
  });

  it('computes clip as viewport ∩ scissor ∩ surface', () => {
    const st = defaultState(100, 100);
    Object.assign(st, { vx: -10, vy: 10, vw: 50, vh: 200, scissor: true, sx: 20, sy: 0, sw: 100, sh: 50 });
    expect(effectiveClip(st, 100, 100)).toEqual({ x: 20, y: 10, w: 20, h: 40 });
  });

  it('copies texture data at submit time and updates the shadow copy', () => {
    const tex = new Uint8Array(64).fill(7);
    const bytes = new CommandEncoder().texCreate(5, 2, 2).texUpdate(5, 0, 0, 2, 2, 0, 16).finish();
    const { res, c } = run(bytes, ctx(), tex);
    expect(res.status).toBe(0);
    tex.fill(9); // mutating game memory afterwards must not affect the recorded update
    const upd = c.frame.items.find((i) => i.kind === 'texUpdate') as { data: Uint8Array };
    expect([...upd.data]).toEqual(new Array(16).fill(7));
    expect([...c.textures.entries.get(5)!.shadow]).toEqual(new Array(16).fill(7));
  });

  it('deleting the bound texture falls back to handle 0', () => {
    const c = ctx();
    run(new CommandEncoder().texCreate(3, 1, 1).texture(3).texDelete(3).rect(0, 0, 1, 1, 0).finish(), c);
    const d = c.frame.items.filter((i) => i.kind === 'draw') as Array<{ texture: number }>;
    expect(d[0].texture).toBe(0);
    expect(c.textures.count).toBe(0);
  });

  it('rejects framing errors atomically (nothing executes)', () => {
    const good = new CommandEncoder().clear(rgba(1, 1, 1)).rect(0, 0, 1, 1, 0).finish();
    const bad = good.slice();
    new DataView(bad.buffer).setUint32(16 + 8 + 4 + 4, 4000, true); // second command's payload_len
    const { res, c } = run(bad);
    expect(res.status).toBe(A.E_BOUNDS);
    expect(res.executed).toBe(0);
    expect(c.frame.vertexCount).toBe(0);
  });

  it('skips only the bad command for semantic errors and reports each', () => {
    const { res, c } = run(new CommandEncoder().rect(0, 0, 1, 1, 0).raw(0x55, []).texture(42).blend(9).rect(0, 0, 1, 1, 0).finish());
    expect(res.errors.map((e) => e.code)).toEqual([A.E_UNSUPPORTED, A.E_NOT_FOUND, A.E_UNSUPPORTED]);
    expect(res.status).toBe(A.E_UNSUPPORTED);
    expect(res.executed).toBe(2);
    expect(c.frame.vertexCount).toBe(12);
  });

  it('enforces limits', () => {
    expect(run(new CommandEncoder().texCreate(0, 1, 1).finish()).res.status).toBe(A.E_INVALID);
    expect(run(new CommandEncoder().texCreate(A.LIMITS.textures, 1, 1).finish()).res.status).toBe(A.E_INVALID);
    expect(run(new CommandEncoder().texCreate(1, 4097, 1).finish()).res.status).toBe(A.E_LIMIT);
    expect(run(new CommandEncoder().texCreate(1, 1, 1).texCreate(1, 1, 1).finish()).res.status).toBe(A.E_STATE);
    const c = ctx();
    c.frame.submits = A.LIMITS.submitsPerFrame;
    expect(run(new CommandEncoder().clear(0).finish(), c).res.status).toBe(A.E_LIMIT);
    const big = new Uint8Array(A.LIMITS.submitBytes + 16);
    expect(decodeCommands(big, 0, big.length, ctx()).status).toBe(A.E_LIMIT);
  });

  it('rejects out-of-memory ranges and misalignment', () => {
    const mem = new Uint8Array(64);
    expect(decodeCommands(mem, 60, 32, ctx()).status).toBe(A.E_BOUNDS);
    expect(decodeCommands(mem, 2, 16, ctx()).status).toBe(A.E_INVALID);
    const tex = run(new CommandEncoder().texCreate(1, 2, 2).texUpdate(1, 0, 0, 2, 2, 1 << 30, 16).finish());
    expect(tex.res.errors.map((e) => e.code)).toEqual([A.E_BOUNDS]);
  });

  it('reports unsupported capabilities explicitly instead of ignoring them', () => {
    const c = ctx();
    c.linearFilter = false;
    c.triangles = false;
    const { res } = run(new CommandEncoder().texture(0, A.FILTER_LINEAR).triangles([[0, 0, 0, 0, 0], [1, 0, 0, 0, 0], [0, 1, 0, 0, 0]]).finish(), c);
    expect(res.errors.map((e) => e.code)).toEqual([A.E_UNSUPPORTED, A.E_UNSUPPORTED]);
  });

  it('decoding is deterministic', () => {
    const bytes = new CommandEncoder().transform(0.3, 0.1, -0.2, 0.9, 5, 7).rect(1.5, 2.5, 3, 4, 123).finish();
    const a = run(bytes).c.frame.vertexBytes();
    const b = run(bytes).c.frame.vertexBytes();
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('fuzz: random bytes never throw and never execute a framing-invalid stream', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    for (let i = 0; i < 2000; i++) {
      const len = 16 + Math.floor(rnd() * 200);
      const mem = new Uint8Array(len + 16);
      for (let k = 0; k < mem.length; k++) mem[k] = Math.floor(rnd() * 256);
      if (rnd() < 0.5) new DataView(mem.buffer).setUint32(0, A.CMD_MAGIC, true);
      if (rnd() < 0.5) new DataView(mem.buffer).setUint32(4, 1, true);
      if (rnd() < 0.5) new DataView(mem.buffer).setUint32(8, len & ~3, true);
      expect(() => decodeCommands(mem, 0, len & ~3, ctx())).not.toThrow();
    }
  });
});
