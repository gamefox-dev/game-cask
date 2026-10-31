// Exact raw ext80 known answers and independent BigInt rational references, run through
// actual generated C and decoded execution, in both AMD64 and i386 guest modes.
import { beforeAll, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT } from '../support/headless';
import { compileC } from '../support/compile';
// @ts-expect-error plain ESM
import { x86tool } from '../../tools/build/pipeline.mjs';
type Ext = [bigint, number];
const int = (v: number | bigint): Ext => rational(BigInt(v));
function rational(n: bigint, d = 1n, p = 64, rc = 0): Ext {
  const sign = (n < 0n) !== (d < 0n); n = n < 0n ? -n : n; d = d < 0n ? -d : d;
  if (!n) return [0n, sign ? 0x8000 : 0];
  let e = n.toString(2).length - d.toString(2).length;
  if (e >= 0 ? n < (d << BigInt(e)) : (n << BigInt(-e)) < d) e--;
  const shift = p - 1 - e, num = shift >= 0 ? n << BigInt(shift) : n, den = shift < 0 ? d << BigInt(-shift) : d;
  let q = num / den; const rem = num % den;
  if (rem && (rc === 0 ? rem * 2n > den || (rem * 2n === den && !!(q & 1n)) : rc === 1 ? sign : rc === 2 ? !sign : false)) q++;
  if (q >> BigInt(p)) { q >>= 1n; e++; }
  return [q << BigInt(64 - p), (sign ? 0x8000 : 0) | (e + 16383)];
}
const inf: Ext = [1n << 63n, 0x7fff], nan: Ext = [0xc000000000000000n, 0x7fff];
const snippets: Record<string, string> = {};
const add = (key: string, hex: string, loads = 'db2bdb28') => { snippets[key] = 'dbe3' + loads + 'd92a' + hex + 'c3'; };
for (const [key, hex] of Object.entries({ add: 'd8c1', mul: 'd8c9', sub: 'd8e1', subr: 'd8e9', div: 'd8f1', divr: 'd8f9',
  add_i: 'dcc1', addp: 'dec1', mul_i: 'dcc9', mulp: 'dec9',
  add32: 'd803', mul32: 'd80b', add64: 'dc03', mul64: 'dc0b',
  addint: 'da03', mulint: 'da0b', addint16: 'de03', mulint16: 'de0b',
  sub_i: 'dce9', subr_i: 'dce1', div_i: 'dcf9', divr_i: 'dcf1', subp: 'dee9', subrp: 'dee1', divp: 'def9', divrp: 'def1',
  sqrt: 'd9fa', fxam: 'd9e5', ftst: 'd9e4', fcom: 'd8d1', fcomp: 'd8d9', fcompp: 'ded9', fucom: 'dde1', fucomp: 'dde9', fucompp: 'dae9',
  fcomi: 'dbf1', fucomi: 'dbe9', fcomip: 'dff1', fucomip: 'dfe9',
  yl2x: 'd9f1', yl2xp1: 'd9f9', xm1: 'd9f0', scale: 'd9fd', prem: 'd9f8', prem1: 'd9f5', atan: 'd9f3', sin: 'd9fe', cos: 'd9ff', sincos: 'd9fb', tan: 'd9f2', rnd: 'd9fc', extract: 'd9f4',
  abs: 'd9e1', neg: 'd9e0', swax: 'dfe0', swmem: 'dd39', cwmem: 'd939', clear: 'd8f1dbe2',
  store80: 'db39', store64: 'dd19', store32: 'd919', ffree: 'ddc0d9e5', fxch: 'd9c9', dup: 'd9c0',
  cmovb: 'dac1', cmovnb: 'dbc1', sahf: 'd8d1dfe09e',
  sub32: 'd823', subr32: 'd82b', div32: 'd833', divr32: 'd83b',
  sub64: 'dc23', subr64: 'dc2b', div64: 'dc33', divr64: 'dc3b',
  subint: 'da23', subrint: 'da2b', divint: 'da33', divrint: 'da3b',
  subint16: 'de23', subrint16: 'de2b', divint16: 'de33', divrint16: 'de3b',
  fcom32: 'd813', fcomp64: 'dc1b', ftstsw: 'd9e4', wait: '9bdfe0',
  overflow: 'd9e8d9e8d9e8d9e8d9e8d9e8d9e8d9e8d9e8', underflow: 'ddd8ddd8ddd8',
  fist64: 'df39', fist32: 'db19', fist16: 'df19', fisttp32: 'db09',
  pi: 'd9eb', log2e: 'd9ea', log2ten: 'd9e9', ln2: 'd9ed', log10two: 'd9ec',
  cancellation_c1: 'd8f1d8e0', prem_fist: 'd9f8df11', prem_rnd: 'd9f8d9fc',
  sticky_fist16: 'df11c7015a5a5a5ad96a02df19',
  sticky_fist32: 'db11c7015a5a5a5ad96a02db19',
  sticky_fist64: 'd9c0df39c7015a5a5a5ac741045a5a5a5ad96a02df39',
  sub_doublepop: 'ded9',
})) add(key, hex);
add('empty', 'd9e5', ''); add('load80', '', 'db28'); add('load64', '', 'dd00'); add('load32', '', 'd900');
add('finit', 'dbe3');
function pe(code: Buffer, wide: boolean) {
  const b = Buffer.alloc(0x400 + code.length), o = 0x98, s = wide ? 0x188 : 0x178;
  b.write('MZ'); b.writeUInt32LE(0x80, 60); b.write('PE\0\0', 0x80);
  b.writeUInt16LE(wide ? 0x8664 : 0x14c, 0x84); b.writeUInt16LE(1, 0x86); b.writeUInt16LE(wide ? 240 : 224, 0x94);
  b.writeUInt16LE(wide ? 0x20b : 0x10b, o); b.writeUInt32LE(0x1000, o + 16);
  if (wide) b.writeBigUInt64LE(0x1000000n, o + 24); else b.writeUInt32LE(0x1000000, o + 28);
  b.writeUInt32LE(0x10000, o + 56); b.writeUInt32LE(0x200, o + 60);
  b.write('.text', s); b.writeUInt32LE(code.length, s + 8); b.writeUInt32LE(0x1000, s + 12);
  b.writeUInt32LE(code.length, s + 16); b.writeUInt32LE(0x400, s + 20); b.writeUInt32LE(0x60000020, s + 36);
  code.copy(b, 0x400); return b;
}
type Harness = { ex: any; dv: () => DataView; offsets: Record<string, number>; wide: boolean };
const harnesses: Harness[] = [];
beforeAll(async () => {
  const root = join(ROOT, 'node_modules/.cache/bgt/x87-tests'); mkdirSync(root, { recursive: true });
  for (const wide of [true, false]) {
    const offsets: Record<string, number> = {}, chunks: Buffer[] = []; let size = 0;
    for (const [key, hex] of Object.entries(snippets)) { offsets[key] = 0x1001000 + size; const c = Buffer.from(hex, 'hex'); chunks.push(c); size += c.length; }
    // Calls make all snippets strong seeds, including i386 (no .pdata required).
    const entry = Buffer.concat(Object.values(offsets).map(addr => { const c = Buffer.alloc(5); c[0] = 0xe8; c.writeInt32LE(addr - (0x1001000 + size + 5), 1); size += 5; return c; }));
    const code = Buffer.concat([...chunks, entry, Buffer.from([0xc3])]), input = pe(code, wide);
    input.writeUInt32LE(0x1000 + code.length - entry.length - 1, 0x98 + 16);
    const dir = mkdtempSync(join(root, 'case-'));
    try {
      writeFileSync(join(dir, 'input.exe'), input);
      execFileSync(x86tool(), ['lift', join(dir, 'input.exe'), '--name', 'probe', '--out', join(dir, 'lifted.c')], { stdio: 'pipe' });
      const text = readFileSync(join(dir, 'lifted.c'), 'utf8').replace(/#include "(x86_lift(?:64)?\.h)"/g, `#include "${ROOT}/platforms/x86/$1"`);
      writeFileSync(join(dir, 'probe.c'), `static const unsigned char test_code[]={${[...code].join(',')}};\n#include "${ROOT}/tests/fixtures/c/x87_harness.h"\n${text}
BGT_EXPORT(run) void run(unsigned pc,unsigned interpreted,unsigned flags){
 X.eip=pc;X.r[EAX]=0x2000;X.r[EBX]=0x2020;X.r[ECX]=0x2040;X.r[EDX]=0x2060;X.flags=flags;X.mxcsr=0x7f80;x86_push(0);
 for(unsigned k=0;X.eip;k++){if(k>200)__builtin_trap();if(interpreted)reference();else{
 x86_lifted_fn fn=0;for(unsigned i=0;i<x86_lifted_probe_count;i++)if(x86_lifted_probe[i].addr==X.eip${wide ? '||(X.eip>x86_lifted_probe[i].addr&&X.eip<x86_lifted_probe[i].end)' : ''})fn=x86_lifted_probe[i].fn;
 if(!fn)__builtin_trap();fn();if(x86_lift_pending){const x86_insn_t *p=x86_lift_pending;x86_lift_pending=0;x86_exec_one(p);}else if(x86_lift_count){unsigned n=x86_lift_count;x86_lift_count=0;x86_lift_block(n);}
 }}
}
BGT_EXPORT(sig) uint64_t sig(unsigned i){return FPU.st[(fp_top()+i)&7].sig;}
BGT_EXPORT(se) unsigned se(unsigned i){return FPU.st[(fp_top()+i)&7].se;}
BGT_EXPORT(status) unsigned status(void){return FPU.status;}
BGT_EXPORT(tags) unsigned tags(void){return FPU.tags;}
BGT_EXPORT(flags) unsigned flags(void){return X.flags;}
BGT_EXPORT(ax) unsigned ax(void){return X.r[EAX]&65535;}
BGT_EXPORT(mxcsr) unsigned mxcsr(void){return X.mxcsr;}
`);
      const bytes = await compileC(relative(ROOT, join(dir, 'probe.c')), [], true);
      const module = await WebAssembly.compile(bytes);
      expect(WebAssembly.Module.imports(module).filter(i => i.module.startsWith('wasi'))).toEqual([]);
      const instance = await WebAssembly.instantiate(module, { bgt: { coverage_entry: () => {} } });
      const ex = instance.exports as any; harnesses.push({ ex, dv: () => new DataView(ex.memory.buffer), offsets, wide });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
}, 120_000);
it('all real/integer memory arithmetic forms and compare formats use their encoded widths', () => check((h, m) => {
  for (const suffix of ['32', '64', 'int', 'int16']) {
    expect(run(h, m, 'add' + suffix).value()).toEqual(int(8));
    expect(run(h, m, 'mul' + suffix).value()).toEqual(int(12));
    expect(run(h, m, 'sub' + suffix).value()).toEqual(int(4));
    expect(run(h, m, 'subr' + suffix).value()).toEqual(int(-4));
    expect(run(h, m, 'div' + suffix).value()).toEqual(int(3));
    expect(run(h, m, 'divr' + suffix).value()).toEqual(rational(1n, 3n));
  }
  for (const key of ['add_i', 'addp', 'mul_i', 'mulp']) expect(run(h, m, key).value(key.endsWith('_i') ? 1 : 0)).toEqual(int(key.startsWith('add') ? 8 : 12));
  expect(run(h, m, 'fcom32', int(1), int(2)).sw & 0x4500).toBe(0x100);
  expect(run(h, m, 'fcomp64', int(2), int(2)).sw & 0x4500).toBe(0x4000);
}));
it('stack/tag faults, integer stores and constants obey status/control without touching MXCSR', () => check((h, m) => {
  expect(run(h, m, 'overflow').sw & 0x241).toBe(0x241);
  expect(run(h, m, 'underflow').sw & 0x241).toBe(0x41);
  expect(run(h, m, 'ffree').sw & 0x4500).toBe(0x4100);
  for (const key of ['fist64', 'fist32', 'fist16']) {
    const r = run(h, m, key, rational(7n, 2n));
    if (key === 'fist64') expect(r.dv.getBigInt64(r.mem + 0x2040, true)).toBe(4n);
    else if (key === 'fist32') expect(r.dv.getInt32(r.mem + 0x2040, true)).toBe(4);
    else expect(r.dv.getInt16(r.mem + 0x2040, true)).toBe(4);
  }
  let r = run(h, m, 'fisttp32', rational(-7n, 2n)); expect(r.dv.getInt32(r.mem + 0x2040, true)).toBe(-3);
  r = run(h, m, 'fist16', int(32768)); expect(r.dv.getUint16(r.mem + 0x2040, true)).toBe(0x8000); expect(r.sw & 1).toBe(1);
  for (const [key, sig, exp] of [['pi', 0xc90fdaa22168c235n, 0x4000], ['log2e', 0xb8aa3b295c17f0bcn, 0x3fff], ['ln2', 0xb17217f7d1cf79acn, 0x3ffe], ['log10two', 0x9a209a84fbcff799n, 0x3ffd], ['log2ten', 0xd49a784bcd1b8afen, 0x4000]] as const) {
    expect(run(h, m, key).value()).toEqual([sig, exp]);
    expect(run(h, m, key, int(1), int(2), 0x77f).value()).toEqual([sig - (key === 'log2ten' ? 0n : 1n), exp]);
  }
  expect(run(h, m, 'wait').sw).toBe(h.ex.ax());
  expect(run(h, m, 'cancellation_c1', int(1), int(3), 0xb7f).sw & 0x200).toBe(0);
  r = run(h, m, 'fist16', rational(65537n, 2n), int(1), 0x35f);
  expect(r.sw & 33).toBe(1); // masked invalid outranks unmasked precision, must not trap.
  for (const key of ['sin', 'cos', 'sincos', 'tan']) for (const sign of [0, 0x8000]) {
    const below = run(h, m, key, [0xffffffffffffffffn, sign | 0x403d]);
    expect(below.sw & 0x400).toBe(0); expect((below.sw >> 11) & 7).toBe(key === 'sincos' || key === 'tan' ? 5 : 6);
    for (const sig of [0x8000000000000000n, 0x8000000000000001n]) {
      const outside = run(h, m, key, [sig, sign | 0x403e]);
      expect(outside.sw & 0x400).toBe(0x400); expect(outside.value()).toEqual([sig, sign | 0x403e]);
      expect((outside.sw >> 11) & 7).toBe(6);
    }
  }
}));
it('integer rounding clears stale C1 and recurring precision still faults before write/pop', () => check((h, m) => {
  for (const key of ['prem_fist', 'prem_rnd']) {
    const r = run(h, m, key, int(6), int(2)); expect(r.sw & 0x200).toBe(0); expect(r.value()).toEqual([0n, 0]);
  }
  for (const key of ['sticky_fist16', 'sticky_fist32', 'sticky_fist64']) {
    expect(() => run(h, m, key, rational(7n, 2n))).toThrow();
    const dv = h.dv(), mem = h.ex.ram();
    expect(dv.getUint32(mem + 0x2040, true)).toBe(0x5a5a5a5a);
    expect((h.ex.status() >> 11) & 7).toBe(6); expect(h.ex.status() & 0x80a0).toBe(0x80a0);
  }
}));
it('random integer operands cross-check ext80 add/sub/mul/div and sqrt against exact BigInt references', () => check((h, m) => {
  let seed = 0x12345678;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return BigInt(seed) + 1n; };
  for (let k = 0; k < 96; k++) {
    const a = random() * (k & 1 ? -1n : 1n), b = random() * (k & 2 ? -1n : 1n);
    expect(run(h, m, 'add', int(a), int(b)).value()).toEqual(int(a + b));
    expect(run(h, m, 'sub', int(a), int(b)).value()).toEqual(int(a - b));
    expect(run(h, m, 'mul', int(a), int(b)).value()).toEqual(int(a * b));
    expect(run(h, m, 'div', int(a), int(b)).value()).toEqual(rational(a, b));
    const n = a < 0 ? -a : a, e = Math.floor((n.toString(2).length - 1) / 2), num = n << BigInt(126 - 2 * e);
    let q = 1n << 64n;
    for (;;) { const next = (q + num / q) >> 1n; if (next >= q) break; q = next; }
    const midpoint = (2n * q + 1n) ** 2n;
    if (4n * num > midpoint || (4n * num === midpoint && (q & 1n))) q++;
    expect(run(h, m, 'sqrt', int(n)).value()).toEqual([q, e + 16383]);
  }
}));
function check(fn: (h: Harness, interpreted: number) => void) { for (const h of harnesses) for (const interpreted of [0, 1]) fn(h, interpreted); }
function run(h: Harness, mode: number, key: string, a = int(6), b = int(2), cw = 0x37f, flags = 0) {
  h.ex.reset(h.wide ? 1 : 0); const dv = h.dv(), mem = h.ex.ram();
  const put = (p: number, v: Ext) => { dv.setBigUint64(mem + p, v[0], true); dv.setUint16(mem + p + 8, v[1], true); };
  put(0x2000, a); put(0x2020, b); dv.setUint16(mem + 0x2060, cw, true); dv.setUint16(mem + 0x2062, 0x35f, true);
  const num = (v: Ext) => Number(v[0]) * 2 ** ((v[1] & 0x7fff) - 16383 - 63) * (v[1] & 0x8000 ? -1 : 1);
  if (/^(add|mul|sub|subr|div|divr|fcom|fcomp)32$/.test(key)) dv.setFloat32(mem + 0x2020, num(b), true);
  if (/^(add|mul|sub|subr|div|divr|fcom|fcomp)64$/.test(key)) dv.setFloat64(mem + 0x2020, num(b), true);
  if (/^(add|mul|sub|subr|div|divr)int$/.test(key)) dv.setInt32(mem + 0x2020, num(b), true);
  if (/^(add|mul|sub|subr|div|divr)int16$/.test(key)) dv.setInt16(mem + 0x2020, num(b), true);
  h.ex.run(h.offsets[key], mode, flags);
  return { value: (i = 0): Ext => [BigInt.asUintN(64, h.ex.sig(i)), h.ex.se(i)], sw: h.ex.status(), dv, mem };
}
it('all register subtract/divide destination/reverse/pop forms and 80-bit cancellation have independent exact answers', () => check((h, m) => {
  for (const [key, want, slot] of [['sub', 4, 0], ['subr', -4, 0], ['div', 3, 0], ['divr', 0, 0], ['sub_i', -4, 1], ['subr_i', 4, 1], ['div_i', 0, 1], ['divr_i', 3, 1], ['subp', -4, 0], ['subrp', 4, 0], ['divp', 0, 0], ['divrp', 3, 0]] as const) {
    const r = run(h, m, key); expect(r.value(slot), `${h.wide}/${m}/${key}`).toEqual(want === 0 ? rational(1n, 3n) : int(want));
    expect((r.sw >> 11) & 7).toBe(key.endsWith('p') ? 7 : 6);
  }
  expect(run(h, m, 'sub', [0x8000000000000001n, 0x3fff], int(1)).value()).toEqual([0x8000000000000000n, 0x3fc0]);
}));
it('add/mul/div honor 24/53/64 precision and all four rounding modes against BigInt rational rounding', () => check((h, m) => {
  for (const [pc, p] of [[0, 24], [2, 53], [3, 64]]) for (let rc = 0; rc < 4; rc++) {
    const cw = 0x7f | (pc << 8) | (rc << 10);
    for (const sign of [1n, -1n]) {
      const r = run(h, m, 'div', int(sign), int(3), cw);
      expect(r.value()).toEqual(rational(sign, 3n, p, rc)); expect(r.sw & 32).toBe(32);
      expect(run(h, m, 'mul', [0x8000000000000001n, 0x3fff], int(sign * 3n), cw).value()).toEqual(rational(sign * 3n * ((1n << 63n) + 1n), 1n << 63n, p, rc));
      expect(run(h, m, 'add', int(sign), [0x8000000000000000n, (sign < 0 ? 0x8000 : 0) | 0x3fc0], cw).value()).toEqual(rational(sign * ((1n << 63n) + 1n), 1n << 63n, p, rc));
    }
  }
}));
it('sqrt, scale, round and extract preserve ext80 answers, signed zeros and stack order', () => check((h, m) => {
  expect(run(h, m, 'sqrt', int(2)).value()).toEqual([0xb504f333f9de6484n, 0x3fff]);
  expect(run(h, m, 'sqrt', int(4)).value()).toEqual(int(2));
  expect(run(h, m, 'scale', int(3), rational(-7n, 2n)).value()).toEqual(rational(3n, 8n));
  for (const [rc, v] of [[0, 2], [1, 2], [2, 3], [3, 2]]) expect(run(h, m, 'rnd', rational(5n, 2n), int(0), 0x37f | (rc << 10)).value()).toEqual(int(v));
  expect(run(h, m, 'rnd', rational(-1n, 4n)).value()).toEqual([0n, 0x8000]);
  const e = run(h, m, 'extract', int(12)); expect(e.value()).toEqual(rational(3n, 2n)); expect(e.value(1)).toEqual(int(3));
}));
it('FPREM/FPREM1 reduce exactly, encode quotient bits and converge through C2 partial reduction', () => check((h, m) => {
  let r = run(h, m, 'prem', int(7), int(2)); expect(r.value()).toEqual(int(1)); expect(r.sw & 0x4700).toBe(0x4200);
  r = run(h, m, 'prem1', int(7), int(2)); expect(r.value()).toEqual(int(-1)); expect(r.sw & 0x4700).toBe(0x100);
  r = run(h, m, 'prem', [0x8000000000000001n, 0x4063], int(3)); expect(r.sw & 0x400).toBe(0x400);
  for (let n = 0; (r.sw & 0x400) && n < 5; n++) r = run(h, m, 'prem', r.value(), int(3));
  expect(r.sw & 0x400).toBe(0); expect(r.value()).toEqual(int(((1n << 100n) + (1n << 37n)) % 3n));
}));
it('classification, comparisons/pop/I-family and SAHF expose architectural flags for finite/zero/Inf/NaN/empty', () => check((h, m) => {
  for (const [a, cc] of [[int(1), 0x400], [[0n, 0], 0x4000], [[0n, 0x8000], 0x4200], [inf, 0x500], [nan, 0x100], [[1n, 0], 0x4400]] as [Ext, number][]) expect(run(h, m, 'fxam', a).sw & 0x4700).toBe(cc);
  expect(run(h, m, 'empty').sw & 0x4500).toBe(0x4100);
  for (const key of ['fcom', 'fcomp', 'fcompp', 'fucom', 'fucomp', 'fucompp']) {
    expect(run(h, m, key, int(1), int(2)).sw & 0x4500).toBe(0x100);
    const r = run(h, m, key, nan, int(1)); expect(r.sw & 0x4500).toBe(0x4500); expect(r.sw & 1).toBe(key.startsWith('fu') ? 0 : 1);
  }
  for (const key of ['fcomi', 'fucomi', 'fcomip', 'fucomip']) {
    run(h, m, key, int(1), int(2), 0x37f, 0x8d5); expect(h.ex.flags() & 0x8d5).toBe(1);
    run(h, m, key, nan, int(2)); expect(h.ex.flags() & 0x45).toBe(0x45);
  }
  run(h, m, 'sahf', int(1), int(2)); expect(h.ex.flags() & 0x45).toBe(1);
  expect(run(h, m, 'cmovb', int(6), int(2), 0x37f, 1).value()).toEqual(int(2));
  expect(run(h, m, 'cmovnb', int(6), int(2), 0x37f, 0).value()).toEqual(int(2));
}));
it('status/control memory, FNSTSW AX, clear/init, exact 80-bit load/store and rounded binary32/64 stores', () => check((h, m) => {
  let r = run(h, m, 'swax'); expect(h.ex.ax()).toBe(r.sw); expect(h.ex.mxcsr()).toBe(0x7f80);
  r = run(h, m, 'swmem'); expect(r.dv.getUint16(r.mem + 0x2040, true)).toBe(r.sw);
  r = run(h, m, 'cwmem', int(1), int(2), 0xb7f); expect(r.dv.getUint16(r.mem + 0x2040, true)).toBe(0xb7f);
  expect(run(h, m, 'clear', int(1), [0n, 0]).sw & 0xff).toBe(0);
  run(h, m, 'finit'); expect(h.ex.status()).toBe(0); expect(h.ex.tags()).toBe(0xffff);
  const raw: Ext = [0xdeadbeef12345678n, 0x4123]; r = run(h, m, 'store80', raw); expect(r.dv.getBigUint64(r.mem + 0x2040, true)).toBe(raw[0]); expect(r.dv.getUint16(r.mem + 0x2048, true)).toBe(raw[1]);
  r = run(h, m, 'store64', [0x8000000000000001n, 0x3fff], int(2), 0xb7f); expect(r.dv.getBigUint64(r.mem + 0x2040, true)).toBe(0x3ff0000000000001n);
  r = run(h, m, 'store32', [0x8000000000000001n, 0x3fff], int(2), 0xb7f); expect(r.dv.getUint32(r.mem + 0x2040, true)).toBe(0x3f800001);
  expect(h.ex.threads()).toBe(0);
}));
it('masked invalid/divide-by-zero/overflow/underflow set real exception bits and signed special results', () => check((h, m) => {
  expect(run(h, m, 'div', int(1), [0n, 0]).value()).toEqual(inf);
  expect(run(h, m, 'div', int(1), [0n, 0]).sw & 4).toBe(4);
  expect(run(h, m, 'div', [0n, 0], [0n, 0]).sw & 1).toBe(1);
  expect(run(h, m, 'sub', inf, inf).sw & 1).toBe(1);
  expect(run(h, m, 'sqrt', int(-1)).sw & 1).toBe(1);
  expect(run(h, m, 'mul', [0xffffffffffffffffn, 0x7ffe], int(2)).sw & 0x28).toBe(0x28);
  const r = run(h, m, 'div', [1n, 0], int(2)); expect(r.value()).toEqual([0n, 0]); expect(r.sw & 0x32).toBe(0x32);
  expect(() => run(h, m, 'div', int(1), [0n, 0], 0x37b)).toThrow();
}));
it('binary64 transcendental known answers, cancellation-safe FYL2XP1 and trig range/stack contracts', () => check((h, m) => {
  const number = (v: Ext) => Number(v[0]) * 2 ** ((v[1] & 0x7fff) - 16383 - 63) * (v[1] & 0x8000 ? -1 : 1);
  for (const [key, a, b, want] of [['yl2x', 8, 2, 6], ['yl2xp1', 3, 2, 4], ['xm1', 1, 2, 1], ['atan', 1, 1, Math.PI / 4], ['sin', 1, 2, Math.sin(1)], ['cos', 1, 2, Math.cos(1)]] as const) {
    const r = run(h, m, key, int(a), int(b)); expect(Math.abs(number(r.value()) - want)).toBeLessThanOrEqual(4 * Number.EPSILON * Math.abs(want));
  }
  const r = run(h, m, 'sincos', int(1)); expect(number(r.value())).toBe(Math.cos(1)); expect(number(r.value(1))).toBe(Math.sin(1));
  const t = run(h, m, 'tan', int(1)); expect(t.value()).toEqual(int(1)); expect(number(t.value(1))).toBeCloseTo(Math.tan(1), 14);
  expect(run(h, m, 'sin', [0x8000000000000001n, 0x403e]).sw & 0x400).toBe(0x400);
  expect(run(h, m, 'sin', inf).sw & 1).toBe(1);
  const small: Ext = [0x8000000000000000n, 0x3fc3]; expect(number(run(h, m, 'yl2xp1', small, int(1)).value())).toBeCloseTo(Math.log1p(2 ** -60) / Math.LN2, 30);
}));
