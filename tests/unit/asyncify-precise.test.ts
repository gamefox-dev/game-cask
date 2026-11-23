// @bgt-examples: none
// Original CC0 K65 regression: the exact Asyncify onlylist computed from the linked wasm.
// Catches: a suspending function wrongly excluded (deep direct chain, or reached only through a
// call_indirect via the function table), lost live locals on resume, a too-broad list (Binaryen's
// "every call_indirect suspends"), placeholder over-approximation in partitions, a missing
// build-time verification, lost name sections and silently accepted unsupported opcodes.
import { it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import binaryen from 'binaryen';
import { jspiApi } from '../../bgt/runtime/jspi';
// @ts-expect-error ESM build orchestration
import { transform } from '../../tools/build/asyncify.mjs';
// @ts-expect-error ESM analysis
import { analyzeModule, suspendingSet, verifyAsyncify, checkLocalClosure } from '../../tools/build/wasm-callgraph.mjs';
// @ts-expect-error ESM metadata
import { functionNames } from '../../tools/build/wasm-names.mjs';

// $deep_ind is in the table with the same type as the pure $pure_ii; $ind_iii only calls a
// signature no suspending table entry has. Every suspending frame keeps live locals across the yield.
const WAT = `(module
 (type $ii (func (param i32) (result i32)))
 (type $iii (func (param i32 i32) (result i32)))
 (import "bgt" "yield" (func $yield))
 (memory (export "memory") 4)
 (table 4 funcref)
 (elem (i32.const 0) $deep_ind $pure_ii $leaf_iii $pure_ii2)
 (func $d0 (param i32) (result i32) (call $yield) (i32.add (local.get 0) (i32.const 1)))
 (func $d1 (param i32) (result i32) (local i32)
  (local.set 1 (i32.mul (local.get 0) (i32.const 3))) (i32.add (call $d0 (local.get 0)) (local.get 1)))
 (func $d2 (param i32) (result i32) (local i32)
  (local.set 1 (i32.xor (local.get 0) (i32.const 0x55))) (i32.xor (call $d1 (local.get 1)) (local.get 1)))
 (func $deep_ind (param i32) (result i32) (local i32)
  (local.set 1 (i32.add (local.get 0) (i32.const 7))) (i32.add (call $d2 (local.get 1)) (local.get 1)))
 (func $helper (param i32) (result i32) (i32.mul (local.get 0) (i32.const 0x9e3779b1)))
 (func $pure_ii (param i32) (result i32) (i32.add (call $helper (local.get 0)) (i32.const 11)))
 (func $pure_ii2 (param i32) (result i32) (i32.xor (call $helper (local.get 0)) (i32.const 0x1234)))
 (func $leaf_iii (param i32 i32) (result i32) (i32.add (call $helper (local.get 0)) (local.get 1)))
 (func $ind_iii (param i32) (result i32) (call_indirect (type $iii) (local.get 0) (i32.const 5) (i32.const 2)))
 (func $ind_ii (param i32 i32) (result i32) (local i32)
  (local.set 2 (i32.mul (local.get 0) (i32.const 31)))
  (i32.add (call_indirect (type $ii) (local.get 0) (local.get 1)) (local.get 2)))
 (func $run (export "run") (param $f i32) (result i32) (local $a i32) (local $b i32) (local $c i32)
  (local.set $a (call $ind_iii (local.get $f)))
  (local.set $b (call $ind_ii (local.get $f) (i32.and (local.get $f) (i32.const 1))))
  (local.set $c (call $d2 (local.get $f)))
  (i32.xor (i32.xor (local.get $a) (local.get $b)) (i32.add (local.get $c) (call $ind_ii (local.get $f) (i32.const 3)))))
 (func $bgt_async_buffer (export "bgt_async_buffer") (result i32) (i32.const 1024)))`;
// Pad every body (dead scratch local) so 1 KiB partitions really separate callers from callees.
const PAD = '(local $pad i32)' + '(local.set $pad (i32.add (local.get $pad) (i32.const 100000)))'.repeat(90);
const SOURCE = WAT.replace(/\(func \$(\w+) ([\s\S]*?)(\(i32\.|\(call|\(local\.set)/g, (_m, name, sig, body) => '(func $' + name + ' ' + sig + PAD + body);
const SUSPENDING = ['d0', 'd1', 'd2', 'deep_ind', 'ind_ii', 'run'];
const ARGS = ['-O2', '--asyncify', '--pass-arg=asyncify-imports@bgt.yield'];
let dir: string, input: string, raw: Buffer;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'bgt-asyncify-precise-')); input = join(dir, 'input.wasm');
  binaryen.setDebugInfo(true);
  const m = binaryen.parseText(SOURCE);
  try { raw = Buffer.from(m.emitBinary()); } finally { m.dispose(); binaryen.setDebugInfo(false); }
  writeFileSync(input, raw);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const expected = (f: number) => {
  const helper = (x: number) => Math.imul(x, 0x9e3779b1) | 0;
  const d0 = (x: number) => (x + 1) | 0, d1 = (x: number) => (d0(x) + Math.imul(x, 3)) | 0;
  const d2 = (x: number) => { const l = x ^ 0x55; return d1(l) ^ l; };
  const table = [(x: number) => (d2((x + 7) | 0) + ((x + 7) | 0)) | 0, (x: number) => (helper(x) + 11) | 0, null, (x: number) => helper(x) ^ 0x1234];
  const indII = (x: number, s: number) => (table[s]!(x) + Math.imul(x, 31)) | 0;
  const a = (helper(f) + 5) | 0, b = indII(f, f & 1), c = d2(f);
  return ((a ^ b) ^ ((c + indII(f, 3)) | 0)) >>> 0;
};
async function differential(asyncified: Buffer, frames = 64) {
  let parked = 0;
  const instance: WebAssembly.Instance = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(asyncified)), { bgt: { yield() {
    const e = instance.exports as Record<string, (...a: number[]) => number>;
    if (e.asyncify_get_state() === 2) e.asyncify_stop_rewind(); else { parked++; e.asyncify_start_unwind(1024); }
  } } });
  const e = instance.exports as Record<string, (...a: number[]) => number> & { memory: WebAssembly.Memory };
  const view = new DataView(e.memory.buffer); view.setUint32(1024, 1032, true); view.setUint32(1028, 65536, true);
  for (let f = 0; f < frames; f++) {
    let got = e.run(f), n = 0;
    while (e.asyncify_get_state() === 1) { n++; e.asyncify_stop_unwind(); e.asyncify_start_rewind(1024); got = e.run(f); }
    expect(n, 'yields at frame ' + f).toBe(f & 1 ? 1 : 2);
    expect(got >>> 0, 'Asyncify frame ' + f).toBe(expected(f));
  }
  const api = jspiApi() as unknown as { Suspending: new (f: () => Promise<void>) => unknown; promising: (f: unknown) => (f: number) => Promise<number> } | null;
  if (api) {
    let yields = 0;
    const h = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(raw)), { bgt: { yield: new api.Suspending(async () => { yields++; }) as never } });
    const run = api.promising(h.exports.run);
    for (let f = 0; f < frames; f++) expect((await run(f)) >>> 0, 'JSPI frame ' + f).toBe(expected(f));
    expect(yields).toBe(frames * 3 / 2);
  }
  return parked;
}
const named = (bytes: Buffer, indices: Iterable<number>) => { const m = new Map(functionNames(bytes).map((n: { index: number; name: string }) => [n.index, n.name])); return [...indices].map((i) => m.get(i)).sort(); };

it('computes exactly the functions that can reach the yield, through direct and signature-matched table calls', () => {
  const info = analyzeModule(raw);
  const { set } = suspendingSet(info);
  expect(named(raw, [...set].filter((i) => i >= info.importedFunctions))).toEqual([...SUSPENDING].sort());
  // A kit cut point (removelist semantics) neither suspends nor propagates.
  const deep = functionNames(raw).find((n: { name: string }) => n.name === 'deep_ind').index;
  const cut = suspendingSet(info, { cut: new Set([deep]) }).set;
  expect(named(raw, [...cut].filter((i) => i >= info.importedFunctions))).toEqual(['d0', 'd1', 'd2', 'run']);
});

it.each([['whole', {}], ['partitioned', { wholeLimit: 0, partitionBytes: 1024 }]] as const)('%s precise Asyncify instruments only the suspension set, resumes exact live state and keeps names', async (_shape, options) => {
  const out = join(dir, _shape + '-precise.wasm'), old = join(dir, _shape + '-binaryen.wasm');
  const stats = transform(input, out, ARGS, options);
  const before = transform(input, old, ARGS, { ...options, analysis: 'binaryen' });
  expect(stats.analysis).toBe('precise'); expect(stats.instrumented).toBe(stats.suspending);
  // Whole-module mode lists the post-O2 module (some of the chain is inlined into its callers).
  if (_shape === 'whole') expect(stats.onlylist).toBeLessThanOrEqual(SUSPENDING.length); else expect(stats.onlylist).toBe(SUSPENDING.length);
  if (_shape === 'partitioned') {
    expect(stats.partitions).toBeGreaterThan(1);
    // Placeholders made every cross-partition caller and every call_indirect "suspending" before K65.
    expect(stats.instrumented).toBe(SUSPENDING.length);
    expect(before.instrumented).toBeGreaterThan(stats.instrumented);
  } else expect(stats.instrumented).toBeLessThanOrEqual(before.instrumented);
  const bytes = readFileSync(out);
  expect(functionNames(bytes).map((n: { name: string }) => n.name)).toEqual(expect.arrayContaining(['run', 'asyncify_start_unwind']));
  expect(await differential(bytes)).toBe(96);
  expect(await differential(readFileSync(old))).toBe(96);
});

it('refuses to publish when Binaryen leaves a suspending function uninstrumented (build-time check)', () => {
  // Tamper with the exact list just before Binaryen reads it: drop the exported root ($run), which
  // -O2 cannot inline away and which reaches the yield both directly and through the table.
  const id = 'p' + functionNames(raw).find((n: { name: string }) => n.name === 'run').index.toString(36);
  for (const options of [{}, { wholeLimit: 0, partitionBytes: 1024 }]) {
    const out = join(dir, 'tampered.wasm');
    const run = (exe: string, args: string[], o: object) => {
      const arg = args.find((a) => a.startsWith('--pass-arg=asyncify-onlylist@@'));
      if (arg) { const file = arg.slice('--pass-arg=asyncify-onlylist@@'.length); writeFileSync(file, readFileSync(file, 'utf8').split('\n').filter((l) => l !== id).join('\n')); }
      return execFileSync(exe, args, o);
    };
    expect(() => transform(input, out, ARGS, { ...options, run })).toThrow(/not Asyncify-instrumented, e\.g\. run -/);
    expect(existsSync(out)).toBe(false);
  }
  // The verifier is independent of the transform: an onlylist missing $d1 is caught on the output.
  const out = join(dir, 'manual.wasm');
  execFileSync(process.execPath, [fileURLToPath(new URL('../../node_modules/binaryen/bin/wasm-opt', import.meta.url)), input, '--asyncify', '--pass-arg=asyncify-imports@bgt.yield',
    '--pass-arg=asyncify-onlylist@d0,d2,deep_ind,ind_ii,run', '-g', '-o', out]);
  expect(() => verifyAsyncify(readFileSync(out))).toThrow(/d1 -> d0 -> yield/);
});

it('fails closed on opcodes outside the analysed feature set', () => {
  const m = binaryen.parseText('(module (func (export "f") (drop (v128.const i32x4 1 2 3 4))))');
  m.setFeatures(binaryen.Features.SIMD128);
  try { expect(() => analyzeModule(Buffer.from(m.emitBinary()))).toThrow(/unsupported wasm opcode 0xfd/); } finally { m.dispose(); }
});

// K65 review 1: a host-supplied funcref (imported global) reaching the table through table.set, or an
// element expression reading it, makes the table opaque: every call_indirect site must be instrumented.
it.each([
  ['table.set', '(func $caller (export "caller") (table.set (i32.const 0) (global.get $g)) (call_indirect (type $v) (i32.const 0)))'],
  ['element global.get', '(elem (table $t) (i32.const 0) funcref (global.get $g)) (func $caller (export "caller") (call_indirect (type $v) (i32.const 0)))'],
])('%s from an imported funcref global is opaque and instrumented', (_kind, body) => {
  const wat = `(module (type $v (func)) (import "bgt" "yield" (func $yield)) (import "env" "f" (global $g funcref))
    (memory (export "memory") 2) (table $t 2 funcref) (func $s (export "s") (call $yield)) ${body}
    (func $bgt_async_buffer (export "bgt_async_buffer") (result i32) (i32.const 1024)))`;
  binaryen.setDebugInfo(true);
  const m = binaryen.parseText(wat);
  let bytes: Buffer;
  try { m.setFeatures(binaryen.Features.MVP | binaryen.Features.ReferenceTypes | binaryen.Features.BulkMemory); bytes = Buffer.from(m.emitBinary()); } finally { m.dispose(); binaryen.setDebugInfo(false); }
  const info = analyzeModule(bytes);
  expect(info.opaqueTable).toBe(true);
  expect(named(bytes, [...suspendingSet(info).set].filter((i) => i >= info.importedFunctions))).toEqual(['caller', 's']);
  const file = join(dir, 'opaque.wasm'), out = join(dir, 'opaque-out.wasm'); writeFileSync(file, bytes);
  // Partitioned (no interprocedural passes): both functions instrumented. Whole -O2 may rewrite the
  // module first (Binaryen 132 turns the element-global call into a trap); the artifact still verifies.
  const part = transform(file, out, ['--enable-reference-types', '--enable-bulk-memory', ...ARGS], { wholeLimit: 0, partitionBytes: 1024 });
  expect(part.instrumented).toBe(2); expect(part.suspending).toBe(2);
  const whole = transform(file, out, ['--enable-reference-types', '--enable-bulk-memory', ...ARGS], {});
  expect(whole.instrumented).toBe(whole.suspending);
});

// K65 review 2: the local closure check is independent of the propagation model.
it('local closure check rejects an uninstrumented caller of instrumented code on its own', () => {
  const out = join(dir, 'manual-local.wasm');
  execFileSync(process.execPath, [fileURLToPath(new URL('../../node_modules/binaryen/bin/wasm-opt', import.meta.url)), input, '--asyncify', '--pass-arg=asyncify-imports@bgt.yield',
    '--pass-arg=asyncify-onlylist@d0,d2,deep_ind,ind_ii,run', '-g', '-o', out]);
  expect(() => checkLocalClosure(readFileSync(out))).toThrow(/local closure check\), e\.g\. d1 -> d0/);
  // A correct artifact passes it.
  const good = join(dir, 'good.wasm'); transform(input, good, ARGS, {});
  expect(() => checkLocalClosure(readFileSync(good))).not.toThrow();
});

// K65 review 4: name lists > Linux MAX_ARG_STRLEN (128 KiB) never travel as one argv string.
it('passes >128 KiB cut lists through response files in every Binaryen and CLI hop', () => {
  const n = 13000, names = Array.from({ length: n }, (_, i) => 'N_' + i.toString(16).padStart(8, '0'));
  const wat = `(module (import "bgt" "yield" (func $yield)) (memory (export "memory") 2)
    (func $s (call $yield)) ${names.map((x, i) => `(func $${x} (export "${x}") (i32.store (i32.const 2048) (i32.const ${i})) (call $s))`).join('')}
    (func $bgt_async_buffer (export "bgt_async_buffer") (result i32) (i32.const 1024)))`;
  binaryen.setDebugInfo(true);
  const m = binaryen.parseText(wat);
  let bytes: Buffer;
  try { bytes = Buffer.from(m.emitBinary()); } finally { m.dispose(); binaryen.setDebugInfo(false); }
  const file = join(dir, 'many.wasm'), list = join(dir, 'many.txt'), out = join(dir, 'many-out.wasm');
  writeFileSync(file, bytes); writeFileSync(list, names.join('\n'));
  expect(Buffer.byteLength(names.join(','))).toBeGreaterThan(131072);
  const run = (exe: string, args: string[], o: object) => {
    for (const a of args) expect(Buffer.byteLength(a), 'argv string').toBeLessThan(131072);
    return execFileSync(exe, args, o);
  };
  for (const analysis of ['precise', 'binaryen']) for (const options of [{}, { wholeLimit: 0, partitionBytes: 65536 }]) {
    for (const arg of ['--pass-arg=asyncify-removelist@@' + list, '--pass-arg=asyncify-removelist@' + names.join(',')]) {
      const stats = transform(file, out, [...ARGS, arg], { ...options, analysis, run });
      // Every step name arrived (distinct bodies: -O2 cannot merge them); no step is instrumented.
      expect(stats.cut, analysis + ' ' + JSON.stringify(options)).toBe(n);
      expect(stats.instrumented).toBe(stats.suspending); expect(stats.instrumented).toBeLessThanOrEqual(1);
    }
  }
  // The CLI takes the response-file form too (what build.mjs passes).
  execFileSync(process.execPath, [fileURLToPath(new URL('../../tools/build/asyncify.mjs', import.meta.url)), file, ...ARGS, '--pass-arg=asyncify-removelist@@' + list, '-o', out], { stdio: 'pipe' });
  expect(verifyAsyncify(readFileSync(out), { cutNames: new Set(names) }).instrumented).toBeLessThanOrEqual(1);
});
