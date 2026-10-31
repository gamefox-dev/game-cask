// Known answers, not shared-core agreement: real decoded bytes and generated PE lifts.
import { beforeAll, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT } from '../support/headless';
import { compileC } from '../support/compile';
// @ts-expect-error plain ESM
import { x86tool } from '../../tools/build/pipeline.mjs';
const base = 0x1001000, DF = 0x400, arithmetic = 0x8d5;
const ops = { movs: 0xa4, stos: 0xaa, lods: 0xac, cmps: 0xa6, scas: 0xae };
type Op = keyof typeof ops;
type Case = { op: Op; sz: number; rep: number; override: boolean; seg: number; pc: number };
type Harness = { wide: boolean; ex: any; cases: Case[]; view: () => DataView };
const harnesses: Harness[] = [];
function pe(code: Buffer, wide: boolean) {
  const b = Buffer.alloc(0x400 + Math.ceil(code.length / 512) * 512), opt = 0x98, sh = opt + (wide ? 240 : 224);
  b.write('MZ'); b.writeUInt32LE(0x80, 0x3c); b.write('PE\0\0', 0x80);
  b.writeUInt16LE(wide ? 0x8664 : 0x14c, 0x84); b.writeUInt16LE(1, 0x86);
  b.writeUInt16LE(wide ? 240 : 224, 0x94); b.writeUInt16LE(wide ? 0x20b : 0x10b, opt);
  b.writeUInt32LE(0x1000, opt + 16);
  if (wide) b.writeBigUInt64LE(0x1000000n, opt + 24); else b.writeUInt32LE(0x1000000, opt + 28);
  b.writeUInt32LE(0x10000, opt + 56); b.writeUInt32LE(0x400, opt + 60);
  b.write('.text', sh); b.writeUInt32LE(code.length, sh + 8); b.writeUInt32LE(0x1000, sh + 12);
  b.writeUInt32LE(code.length, sh + 16); b.writeUInt32LE(0x400, sh + 20); b.writeUInt32LE(0x60000020, sh + 36);
  code.copy(b, 0x400); return b;
}
beforeAll(async () => {
  const root = join(ROOT, 'node_modules/.cache/bgt/strings-tests'); mkdirSync(root, { recursive: true });
  for (const wide of [false, true]) {
    const cases: Case[] = [], chunks: Buffer[] = []; let size = 0;
    for (const op of Object.keys(ops) as Op[]) for (const sz of wide ? [1, 2, 4, 8] : [1, 2, 4])
      for (const rep of [0, 0xf3, 0xf2]) for (const override of [false, true]) for (const seg of [0, 0x64, ...(wide ? [0x65] : [])]) {
        const bytes = Buffer.from([...(rep ? [rep] : []), ...(override ? [0x67] : []), ...(seg ? [seg] : []),
          ...(sz === 2 ? [0x66] : sz === 8 ? [0x48] : []), ops[op] + (sz === 1 ? 0 : 1), 0xc3]);
        cases.push({ op, sz, rep, override, seg, pc: base + size }); chunks.push(bytes); size += bytes.length;
      }
    // Strong direct-call seeds retain every snippet in both analyzers.
    const entry = Buffer.concat(cases.map(c => { const b = Buffer.alloc(5); b[0] = 0xe8;
      b.writeInt32LE(c.pc - (base + size + 5), 1); size += 5; return b; }));
    const code = Buffer.concat([...chunks, entry, Buffer.from([0xc3])]), input = pe(code, wide);
    input.writeUInt32LE(0x1000 + code.length - entry.length - 1, 0x98 + 16);
    const dir = mkdtempSync(join(root, 'case-'));
    try {
      writeFileSync(join(dir, 'input.exe'), input);
      execFileSync(x86tool(), ['lift', join(dir, 'input.exe'), '--name', 'probe', '--out', join(dir, 'lifted.c')]);
      const lift = readFileSync(join(dir, 'lifted.c'), 'utf8').replace(/#include "(x86_lift(?:64)?\.h)"/g, `#include "${ROOT}/platforms/x86/$1"`);
      writeFileSync(join(dir, 'probe.c'), `#define TEST_WIDE ${wide ? 1 : 0}
static const unsigned char test_code[]={${[...code].join(',')}};
#include "${ROOT}/tests/fixtures/c/strings_harness.h"
${lift}
BGT_EXPORT(run) void run(unsigned interpreted) {
 for(unsigned k=0;X.eip && !X.transfer;k++) {
  if(k>10)__builtin_trap();
  if(interpreted)reference();else {
   x86_lifted_fn fn=0;
   for(unsigned i=0;i<x86_lifted_probe_count;i++)if(x86_lifted_probe[i].addr==X.eip${wide ? '||(X.eip>x86_lifted_probe[i].addr&&X.eip<x86_lifted_probe[i].end)' : ''})fn=x86_lifted_probe[i].fn;
   if(!fn)__builtin_trap();fn();
   if(x86_lift_pending){const x86_insn_t *p=x86_lift_pending;x86_lift_pending=0;x86_exec_one(p);}
   else if(x86_lift_count){unsigned n=x86_lift_count;x86_lift_count=0;x86_lift_block(n);}
  }
 }
}`);
      const { instance } = await WebAssembly.instantiate(await compileC(relative(ROOT, join(dir, 'probe.c'))), { bgt: { coverage_entry: () => {} } });
      const raw = instance.exports as any;
      const ex = { ...raw, get: (r: number) => BigInt.asUintN(64, raw.get(r)) };
      harnesses.push({ wide, ex, cases, view: () => new DataView(ex.memory.buffer) });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
}, 120_000);
const source = (op: Op) => ['movs', 'lods', 'cmps'].includes(op);
const dest = (op: Op) => op !== 'lods';
const compare = (op: Op) => op === 'cmps' || op === 'scas';
const mask = (sz: number) => (1n << BigInt(sz * 8)) - 1n;
function put(h: Harness, p: number, sz: number, v: bigint) {
  const dv = h.view(), start = h.ex.ram() + p;
  for (let i = 0; i < sz; i++) dv.setUint8(start + i, Number(v >> BigInt(8 * i) & 255n));
}
function get(h: Harness, p: number, sz: number) {
  const dv = h.view(), start = h.ex.ram() + p; let v = 0n;
  for (let i = 0; i < sz; i++) v |= BigInt(dv.getUint8(start + i)) << BigInt(8 * i);
  return v;
}
function cmpFlags(a: bigint, b: bigint, sz: number) {
  const r = (a - b) & mask(sz), sign = 1n << BigInt(sz * 8 - 1);
  let parity = 0; for (let i = 0; i < 8; i++) parity ^= Number(r >> BigInt(i) & 1n);
  return (a < b ? 1 : 0) | (!parity ? 4 : 0) | ((a ^ b ^ r) & 16n ? 16 : 0) |
    (!r ? 64 : 0) | (r & sign ? 128 : 0) | ((a ^ b) & (a ^ r) & sign ? 2048 : 0);
}
function setup(h: Harness, c: Case, df: number, count = 3) {
  const { ex } = h; ex.reset(c.pc);
  const high = h.wide ? 0xaabbccdd00000000n : 0xaabb0000n;
  const aliasHigh = c.override ? high : 0n;
  const unused = h.wide ? 0x5912abcdef123456n : 0xdeadbeefn;
  const si = source(c.op) ? aliasHigh | 0x2040n : unused;
  const di = dest(c.op) ? aliasHigh | 0x4040n : unused;
  const cx = c.rep ? aliasHigh | BigInt(count) : unused;
  const ax = h.wide ? 0x8877665544332221n : 0x44332221n;
  for (let r = 0; r < 16; r++) if (r !== 4) ex.set(r, BigInt(0x1010 + r));
  ex.set(0, ax); ex.set(1, cx); ex.set(6, si); ex.set(7, di);
  const flags = 0x8d5 | df; ex.set_flags(flags);
  const initial = Array.from({ length: 16 }, (_, r) => ex.get(r) as bigint);
  return { initial, flags, si, di, cx, ax };
}
function advanced(h: Harness, c: Case, value: bigint, delta: number) {
  const asz = c.override ? h.wide ? 4 : 2 : h.wide ? 8 : 4;
  const v = (value + BigInt(delta)) & mask(asz);
  return asz === 2 ? (value & ~mask(asz)) | v : v;
}
for (const op of Object.keys(ops) as Op[]) it(`${op}: every width, repeat prefix, DF and address alias has independent known results`, () => {
  for (const h of harnesses) for (const mode of [0, 1]) for (const c of h.cases.filter(c => c.op === op && !c.seg)) for (const df of [0, DF]) {
    const { ex } = h, s = setup(h, c, df), delta = df ? -c.sz : c.sz;
    const equal = c.rep !== 0xf2, ax = s.ax & mask(c.sz);
    for (let i = 0; i < 3; i++) {
      put(h, 0x2040 + delta * i, c.sz, compare(op) ? ax : BigInt(0x31 + i));
      put(h, 0x4040 + delta * i, c.sz, compare(op) ? (i === 1 ? equal ? ax - 1n : ax : equal ? ax : ax - 1n) : 0x99n);
    }
    ex.run(mode);
    const iterations = c.rep ? compare(op) ? 2 : 3 : 1;
    const expected = [...s.initial]; expected[4] += h.wide ? 8n : 4n;
    if (source(op)) expected[6] = advanced(h, c, s.si, iterations * delta);
    if (dest(op)) expected[7] = advanced(h, c, s.di, iterations * delta);
    if (c.rep) expected[1] = advanced(h, c, s.cx, -iterations);
    if (op === 'lods') expected[0] = c.sz >= 4 ? BigInt(0x30 + iterations) : (s.ax & ~mask(c.sz)) | BigInt(0x30 + iterations);
    expect(Array.from({ length: 16 }, (_, r) => ex.get(r)), JSON.stringify(c) + ` df=${df} mode=${mode}`).toEqual(expected);
    if (op === 'movs' || op === 'stos') for (let i = 0; i < 3; i++) expect(get(h, 0x4040 + delta * i, c.sz)).toBe(i < iterations ? op === 'stos' ? ax : BigInt(0x31 + i) : 0x99n);
    const rhs = iterations === 2 ? equal ? ax - 1n : ax : equal ? ax : ax - 1n;
    expect(ex.flags()).toBe(compare(op) ? (s.flags & ~arithmetic) | cmpFlags(ax, rhs, c.sz) : s.flags);
    expect(ex.pc()).toBe(0);
  }
});
it('REPE/REPNE test the new comparison, not incoming ZF, including first-iteration stop and count exhaustion', () => {
  for (const h of harnesses) for (const mode of [0, 1]) for (const c of h.cases.filter(c => compare(c.op) && c.rep && !c.seg))
    for (const df of [0, DF]) for (const incomingZF of [0, 64]) for (const stop of [false, true]) {
      const s = setup(h, c, df), ax = s.ax & mask(c.sz), delta = df ? -c.sz : c.sz;
      const flags = (s.flags & ~64) | incomingZF; h.ex.set_flags(flags);
      const equal = c.rep === 0xf3 ? !stop : stop, rhs = equal ? ax : ax - 1n, n = stop ? 1 : 3;
      for (let i = 0; i < 3; i++) { put(h, 0x2040 + delta * i, c.sz, ax); put(h, 0x4040 + delta * i, c.sz, rhs); }
      h.ex.run(mode); expect(h.ex.get(1)).toBe(advanced(h, c, s.cx, -n));
      expect(h.ex.flags()).toBe((flags & ~arithmetic) | cmpFlags(ax, rhs, c.sz));
      if (source(c.op)) expect(h.ex.get(6)).toBe(advanced(h, c, s.si, delta * n));
      expect(h.ex.get(7)).toBe(advanced(h, c, s.di, delta * n));
    }
});
it('REP STOSQ clears eleven qwords while a high unrelated RSI is neither checked nor modified', () => {
  const h = harnesses.find(h => h.wide)!;
  const c = h.cases.find(c => c.op === 'stos' && c.sz === 8 && c.rep === 0xf3 && !c.override && !c.seg)!;
  for (const mode of [0, 1]) {
    setup(h, c, 0, 11); h.ex.set(0, 0n);
    for (let i = -1; i <= 11; i++) put(h, 0x4040 + i * 8, 8, 0x1122334455667788n);
    const unused = h.ex.get(6); h.ex.run(mode);
    expect(h.ex.get(6)).toBe(unused); expect(h.ex.get(7)).toBe(0x4098n); expect(h.ex.get(1)).toBe(0n);
    for (let i = -1; i <= 11; i++) expect(get(h, 0x4040 + i * 8, 8)).toBe(i < 0 || i === 11 ? 0x1122334455667788n : 0n);
  }
});
it('zero REP count leaves every operand, upper alias bit and flag untouched even with invalid pointers', () => {
  for (const h of harnesses) for (const mode of [0, 1]) for (const c of h.cases.filter(c => c.rep && !c.seg)) for (const df of [0, DF]) {
    const { ex } = h; const s = setup(h, c, df, 0);
    ex.set(6, h.wide ? 0xffffabcddeadbeefn : 0xdeadbeefn); ex.set(7, ex.get(6));
    const before = [ex.get(0), ex.get(1), ex.get(6), ex.get(7)]; ex.run(mode);
    expect([ex.get(0), ex.get(1), ex.get(6), ex.get(7)]).toEqual(before); expect(ex.flags()).toBe(s.flags);
  }
});
it('16-bit index wrap preserves upper halves and DF selects both wrap directions', () => {
  const h = harnesses.find(h => !h.wide)!;
  for (const mode of [0, 1]) for (const c of h.cases.filter(c => c.override && c.rep && !c.seg)) for (const df of [0, DF]) {
    const s = setup(h, c, df, 2), { ex } = h;
    const start = df ? 0 : 65536 - c.sz, end = df ? 65536 - c.sz : 0;
    if (source(c.op)) ex.set(6, 0xabcd0000n | BigInt(start));
    if (dest(c.op)) ex.set(7, 0xdcba0000n | BigInt(start));
    const value = s.ax & mask(c.sz), mem = c.rep === 0xf2 && compare(c.op) ? value - 1n : value;
    put(h, start, c.sz, mem); put(h, end, c.sz, mem);
    // CMPS uses the same address twice, so REPNE stops on its first equal comparison.
    const n = c.op === 'cmps' && c.rep === 0xf2 ? 1 : 2;
    ex.run(mode);
    const offset = BigInt((start + (df ? -1 : 1) * n * c.sz) & 65535);
    if (source(c.op)) expect(ex.get(6)).toBe(0xabcd0000n | offset);
    if (dest(c.op)) expect(ex.get(7)).toBe(0xdcba0000n | offset);
    expect(ex.get(1)).toBe(0xaabb0000n | BigInt(2 - n));
  }
});
it('source FS/GS overrides never affect destination-only strings or ES destinations', () => {
  for (const h of harnesses) for (const mode of [0, 1]) for (const c of h.cases.filter(c => c.seg && !c.rep)) {
    const s = setup(h, c, 0); h.ex.segment(0x1000, 0x1000);
    put(h, 0x2040, c.sz, 0x11n); put(h, 0x3040, c.sz, 0x22n); put(h, 0x4040, c.sz, s.ax & mask(c.sz));
    h.ex.run(mode);
    if (c.op === 'movs') expect(get(h, 0x4040, c.sz)).toBe(0x22n);
    if (c.op === 'lods') expect(h.ex.get(0) & mask(c.sz)).toBe(0x22n);
    if (c.op === 'stos') expect(get(h, 0x4040, c.sz)).toBe(s.ax & mask(c.sz));
    if (compare(c.op)) expect(h.ex.flags() & arithmetic).toBe(c.op === 'cmps' ? cmpFlags(0x22n, s.ax & mask(c.sz), c.sz) : 0x44);
  }
});
it('mid-REP faults preserve faulting iteration registers/IP and restart without repeating completed work', () => {
  for (const h of harnesses) for (const mode of [0, 1]) for (const c of h.cases.filter(c => c.rep && !c.seg)) for (const df of [0, DF]) {
    const s = setup(h, c, df), { ex } = h, delta = df ? -c.sz : c.sz;
    const start = df ? 0x3000 : 0x3000 - c.sz, badPage = df ? 2 : 3;
    const faultReg = c.op === 'lods' ? 6 : 7;
    const addressHigh = c.override ? h.wide ? 0xaabbccdd00000000n : 0xaabb0000n : 0n;
    ex.set(faultReg, addressHigh | BigInt(start));
    if (faultReg === 7 && source(c.op)) ex.set(6, addressHigh | 0x6040n);
    const si = ex.get(6) as bigint, di = ex.get(7) as bigint, ax = s.ax & mask(c.sz);
    for (let i = 0; i < 3; i++) {
      if (source(c.op)) put(h, Number(si & 65535n) + delta * i, c.sz, ax);
      if (dest(c.op)) put(h, Number(di & 65535n) + delta * i, c.sz, compare(c.op) && c.rep === 0xf2 ? ax - 1n : ax);
    }
    ex.protect(badPage, 1); expect(() => ex.run(mode)).toThrow(WebAssembly.RuntimeError);
    expect(ex.pc()).toBe(c.pc); expect(ex.get(1)).toBe(advanced(h, c, s.cx, -1));
    expect(ex.get(6)).toBe(source(c.op) ? advanced(h, c, si, delta) : si);
    expect(ex.get(7)).toBe(dest(c.op) ? advanced(h, c, di, delta) : di);
    expect(ex.flags()).toBe(s.flags);
    // Change already-completed source/destination to prove it is not replayed.
    if (c.op === 'movs') put(h, Number(si & 65535n), c.sz, 0x77n);
    ex.protect(badPage, 0); ex.run(mode);
    expect(ex.get(1)).toBe(advanced(h, c, s.cx, -3)); expect(ex.pc()).toBe(0);
    if (c.op === 'movs') expect(get(h, start, c.sz)).toBe(ax);
  }
});
it('MOVS/CMPS source faults leave the destination and faulting-iteration registers unchanged', () => {
  for (const h of harnesses) for (const mode of [0, 1]) for (const c of h.cases.filter(c => ['movs', 'cmps'].includes(c.op) && c.rep && !c.seg)) for (const df of [0, DF]) {
    const s = setup(h, c, df), { ex } = h, delta = df ? -c.sz : c.sz, start = df ? 0x3000 : 0x3000 - c.sz;
    const high = c.override ? h.wide ? 0xaabbccdd00000000n : 0xaabb0000n : 0n;
    ex.set(6, high | BigInt(start));
    const ax = s.ax & mask(c.sz), rhs = c.op === 'cmps' && c.rep === 0xf2 ? ax - 1n : ax;
    for (let i = 0; i < 3; i++) { put(h, start + delta * i, c.sz, ax); put(h, 0x4040 + delta * i, c.sz, rhs); }
    ex.protect(df ? 2 : 3, 0x10); // execute-only is not a readable source.
    expect(() => ex.run(mode)).toThrow(); expect(ex.pc()).toBe(c.pc);
    expect(ex.get(6)).toBe(advanced(h, c, high | BigInt(start), delta));
    expect(ex.get(7)).toBe(advanced(h, c, s.di, delta)); expect(ex.get(1)).toBe(advanced(h, c, s.cx, -1));
    expect(get(h, 0x4040 + delta, c.sz)).toBe(rhs); expect(ex.flags()).toBe(s.flags);
    ex.protect(df ? 2 : 3, 2); ex.run(mode); expect(ex.pc()).toBe(0);
  }
});
it('read-only sources and comparison destinations are legal but MOVS/STOS writes fault', () => {
  for (const h of harnesses) for (const mode of [0, 1]) for (const c of h.cases.filter(c => !c.rep && !c.seg)) {
    const s = setup(h, c, 0), { ex } = h;
    put(h, 0x2040, c.sz, s.ax & mask(c.sz)); put(h, 0x4040, c.sz, s.ax & mask(c.sz));
    ex.protect(2, 2); ex.protect(4, 2);
    if (c.op === 'movs' || c.op === 'stos') { expect(() => ex.run(mode)).toThrow(); expect(ex.pc()).toBe(c.pc); }
    else { ex.run(mode); expect(ex.pc()).toBe(0); }
  }
});
it('overlapping REP MOVS proceeds element-by-element, not as host memcpy or memmove', () => {
  for (const h of harnesses) for (const mode of [0, 1]) for (const c of h.cases.filter(c => c.op === 'movs' && c.rep && !c.seg)) for (const df of [0, DF]) {
    setup(h, c, df, 3); const delta = df ? -c.sz : c.sz, high = c.override ? h.wide ? 0xaabbccdd00000000n : 0xaabb0000n : 0n;
    h.ex.set(6, high | 0x2040n); h.ex.set(7, high | BigInt(0x2040 + delta));
    for (let i = 0; i < 4; i++) put(h, 0x2040 + i * delta, c.sz, BigInt(0x11 + i));
    h.ex.run(mode);
    for (let i = 0; i < 4; i++) expect(get(h, 0x2040 + i * delta, c.sz)).toBe(0x11n);
  }
});
it('first-iteration faults never decrement count or update indices/accumulator, including non-REP', () => {
  for (const h of harnesses) for (const mode of [0, 1]) for (const c of h.cases.filter(c => !c.seg)) for (const df of [0, DF]) {
    setup(h, c, df); const { ex } = h;
    ex.protect(c.op === 'lods' ? 2 : 4, 1);
    const before = Array.from({ length: 16 }, (_, r) => ex.get(r)), flags = ex.flags();
    expect(() => ex.run(mode)).toThrow(); expect(ex.pc()).toBe(c.pc);
    expect(Array.from({ length: 16 }, (_, r) => ex.get(r))).toEqual(before); expect(ex.flags()).toBe(flags);
  }
});
it('cross-page qword stores fault before any bytes of the faulting iteration are committed', () => {
  const h = harnesses.find(h => h.wide)!;
  for (const mode of [0, 1]) for (const c of h.cases.filter(c => c.sz === 8 && c.op === 'stos' && c.rep === 0xf3 && !c.seg)) {
    setup(h, c, 0, 1); h.ex.set(7, 0x2ffcn); put(h, 0x2ffc, 8, 0x9999999999999999n);
    h.ex.protect(3, 1); expect(() => h.ex.run(mode)).toThrow();
    expect(get(h, 0x2ffc, 8)).toBe(0x9999999999999999n); expect(h.ex.get(1)).toBe(c.override ? 0xaabbccdd00000001n : 1n);
    expect(h.ex.get(7)).toBe(0x2ffcn); expect(h.ex.pc()).toBe(c.pc);
  }
});
it('REP quantum transfers suspend at the remaining iteration and resume in both execution modes', () => {
  for (const h of harnesses) for (const mode of [0, 1]) for (const c of h.cases.filter(c => c.rep && !c.seg)) for (const df of [0, DF]) {
    const s = setup(h, c, df), { ex } = h, delta = df ? -c.sz : c.sz, ax = s.ax & mask(c.sz);
    const rhs = compare(c.op) && c.rep === 0xf2 ? ax - 1n : ax;
    for (let i = 0; i < 3; i++) { put(h, 0x2040 + delta * i, c.sz, ax); put(h, 0x4040 + delta * i, c.sz, rhs); }
    ex.quantum(1999998, 1); ex.run(mode);
    expect(ex.yields()).toBe(1); expect(ex.pc()).toBe(c.pc); expect(ex.get(1)).toBe(advanced(h, c, s.cx, -1));
    if (source(c.op)) expect(ex.get(6)).toBe(advanced(h, c, s.si, delta));
    if (dest(c.op)) expect(ex.get(7)).toBe(advanced(h, c, s.di, delta));
    if (compare(c.op)) {
      const lastFlags = (s.flags & ~arithmetic) | cmpFlags(ax, rhs, c.sz);
      expect(ex.flags()).toBe(lastFlags);
      // A fault after interrupt/resume restores the new invocation's baseline,
      // NOT the flags from before the already-interrupted prefix.
      ex.protect(4, 1); ex.quantum(0, 0); expect(() => ex.run(mode)).toThrow();
      expect(ex.flags()).toBe(lastFlags); expect(ex.pc()).toBe(c.pc);
      expect(ex.get(1)).toBe(advanced(h, c, s.cx, -1)); ex.protect(4, 0);
    }
    ex.quantum(0, 0); ex.run(mode); expect(ex.get(1)).toBe(advanced(h, c, s.cx, -3)); expect(ex.pc()).toBe(0);
  }
});
it('CMPS/SCAS subtraction order and all defined arithmetic flags include borrow and signed overflow', () => {
  for (const h of harnesses) for (const mode of [0, 1]) for (const c of h.cases.filter(c => compare(c.op) && !c.rep && !c.seg)) {
    const sign = 1n << BigInt(c.sz * 8 - 1);
    for (const [a, b] of [[0n, 1n], [sign, 1n], [sign - 1n, mask(c.sz)], [16n, 1n], [0n, mask(c.sz)], [sign, sign]]) {
      const s = setup(h, c, 0); if (c.op === 'scas') h.ex.set(0, a);
      put(h, 0x2040, c.sz, a); put(h, 0x4040, c.sz, b);
      h.ex.run(mode); expect(h.ex.flags()).toBe((s.flags & ~arithmetic) | cmpFlags(a, b, c.sz));
    }
  }
});
it('32-bit override indices wrap and zero-extend only actual operands before a subsequent fault', () => {
  const h = harnesses.find(h => h.wide)!;
  for (const mode of [0, 1]) for (const c of h.cases.filter(c => c.override && c.rep === 0xf3 && !c.seg && !compare(c.op))) {
    const s = setup(h, c, DF, 2), reg = c.op === 'lods' ? 6 : 7;
    h.ex.set(reg, 0xabcddcba00000000n); put(h, 0, c.sz, 0x11n); put(h, 0x2040, c.sz, 0x11n);
    expect(() => h.ex.run(mode)).toThrow(); expect(h.ex.get(reg)).toBe(0x100000000n - BigInt(c.sz));
    expect(h.ex.get(1)).toBe(1n); expect(h.ex.pc()).toBe(c.pc);
    if (c.op === 'stos') expect(h.ex.get(6)).toBe(s.si);
    if (c.op === 'lods') expect(h.ex.get(7)).toBe(s.di);
  }
});
it('INS/OUTS remain explicit unsupported instructions (no fabricated port I/O)', () => {
  for (const opcode of [0x6c, 0x6d, 0x6e, 0x6f]) {
    const lines = execFileSync(x86tool(), ['decode', opcode.toString(16)], { encoding: 'utf8' });
    expect(lines).toContain('unsupported');
  }
});
