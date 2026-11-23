// @bgt-examples: none
// Original CC0 K70 regression (Q127): the JSPI artifact gets the same bounded wasm-opt as the Asyncify artifact,
// without instrumentation. Catches: a JSPI artifact shipped as raw link output, a plain run that still requires
// Asyncify arguments (partitioned modules refused), Asyncify helpers or the Asyncify artifact marker leaking into
// the JSPI artifact (x86_rt.c's native-step guard must keep counting there, not fault), a lost name section, a
// changed guest result, and a cache key shared with (or changing) the Asyncify payload key.
import { it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import binaryen from 'binaryen';
import { jspiApi } from '../../bgt/runtime/jspi';
// @ts-expect-error ESM build orchestration
import { transform } from '../../tools/build/asyncify.mjs';
// @ts-expect-error ESM build orchestration
import { asyncifyCacheKey, WASM_OPT_FEATURES } from '../../tools/build/build.mjs';
// @ts-expect-error ESM metadata
import { functionNames } from '../../tools/build/wasm-names.mjs';

// A suspending chain with redundant arithmetic -O2/local passes remove, and the K65 artifact marker in data.
const PAD = '(local $pad i32)' + '(local.set $pad (i32.add (local.get $pad) (i32.const 100000)))'.repeat(60);
const WAT = `(module
 (import "bgt" "yield" (func $yield))
 (memory (export "memory") 1)
 (data (i32.const 4096) "BGT-K65-SUSPJSPI")
 (func $d0 (param i32) (result i32) ${PAD} (call $yield) (i32.add (i32.add (local.get 0) (i32.const 0)) (i32.const 1)))
 (func $d1 (param i32) (result i32) (local i32) ${PAD}
  (local.set 1 (i32.mul (local.get 0) (i32.const 3))) (i32.add (call $d0 (local.get 0)) (i32.mul (local.get 1) (i32.const 1))))
 (func $marker (export "marker") (result i32) ${PAD} (i32.load (i32.const 4108)))
 (func $run (export "run") (param i32) (result i32) ${PAD} (i32.xor (call $d1 (local.get 0)) (call $d0 (local.get 0)))))`;
const expected = (f: number) => (((f + 1 + Math.imul(f, 3)) | 0) ^ (f + 1)) >>> 0;
let dir: string, input: string, raw: Buffer;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'bgt-jspi-opt-')); input = join(dir, 'input.wasm');
  binaryen.setDebugInfo(true);
  const m = binaryen.parseText(WAT);
  try { raw = Buffer.from(m.emitBinary()); } finally { m.dispose(); binaryen.setDebugInfo(false); }
  writeFileSync(input, raw);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function results(bytes: Buffer) {
  const plain = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(bytes)), { bgt: { yield() {} } }).exports as Record<string, (...a: number[]) => number>;
  const out = { plain: [] as number[], jspi: null as number[] | null, marker: plain.marker() >>> 0 };
  for (let f = 0; f < 16; f++) out.plain.push(plain.run(f) >>> 0);
  const api = jspiApi() as unknown as { Suspending: new (f: () => Promise<void>) => unknown; promising: (f: unknown) => (f: number) => Promise<number> } | null;
  if (api) {
    let yields = 0;
    const h = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(bytes)), { bgt: { yield: new api.Suspending(async () => { yields++; }) as never } });
    const run = api.promising(h.exports.run); out.jspi = [];
    for (let f = 0; f < 16; f++) out.jspi.push((await run(f)) >>> 0);
    expect(yields).toBe(32);
  }
  return out;
}

it.each([['whole', {}], ['partitioned', { wholeLimit: 0, partitionBytes: 1024 }]] as const)('%s plain bounded -O2 optimizes the JSPI artifact without Asyncify', async (shape, options) => {
  const out = join(dir, shape + '.wasm');
  const stats = transform(input, out, [...WASM_OPT_FEATURES, '-O2'], options);
  const bytes = readFileSync(out);
  expect(stats).toMatchObject({ marked: false, instrumented: 0, suspending: 0 });
  if (shape === 'partitioned') { expect(stats.mode).toBe('partitioned-local'); expect(stats.partitions).toBeGreaterThan(1); }
  else expect(stats.mode).toBe('whole-O2');
  // Whole -O2 removes the dead padding chains; function-local partition passes shrink less (K65 limits them).
  expect(bytes.length).toBeLessThan(raw.length * (shape === 'whole' ? 0.5 : 0.9));
  const exports = WebAssembly.Module.exports(new WebAssembly.Module(new Uint8Array(bytes))).map((e) => e.name);
  expect(exports.filter((n) => n.startsWith('asyncify_'))).toEqual([]);
  expect(exports.sort()).toEqual(['marker', 'memory', 'run']);
  expect(functionNames(bytes).map((n: { name: string }) => n.name)).toEqual(expect.arrayContaining(['run', 'marker']));
  expect(bytes.includes(Buffer.from('BGT-K65-SUSPJSPI'))).toBe(true);
  expect(bytes.includes(Buffer.from('BGT-K65-ASYNJSPI'))).toBe(false);
  const got = await results(bytes), ref = await results(raw);
  expect(got).toEqual(ref);
  expect(got.plain).toEqual(Array.from({ length: 16 }, (_, f) => expected(f)));
});

it('the JSPI cache key is its own and leaves the Asyncify key unchanged', () => {
  const base = asyncifyCacheKey(raw), same = asyncifyCacheKey(raw, { variant: null }), jspi = asyncifyCacheKey(raw, { variant: 'jspi-O2' });
  expect(same).toBe(base);
  expect(jspi).not.toBe(base);
  expect(asyncifyCacheKey(raw, { variant: 'jspi-O2', asyncifyPartitionBytes: 4096 })).not.toBe(jspi);
});
