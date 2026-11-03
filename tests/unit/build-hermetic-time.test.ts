// @bgt-examples: none
// Regression: spliced diagnostic suppression + token pasting used to silently hit
// a stale object after an mtime-only change. Pinning, not detection, must fix it.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
// @ts-expect-error plain ESM build tool
import { hermeticTimeFlags, objectKey, PINNED_TIME, prepareObjects } from '../../tools/build/objects.mjs';
// @ts-expect-error plain ESM build tool
import { findGcc } from '../../tools/build/check-host-gcc.mjs';
import { ROOT } from '../support/headless';

const gcc = findGcc();
const compilers = [
  { path: 'zig', prefix: ['cc'], flags: ['--target=wasm32-freestanding'], wasm: true },
  { path: 'cc', prefix: [], flags: [], wasm: false },
  ...(gcc ? [{ path: gcc, prefix: [], flags: [], wasm: false }] : []),
];
const forms = [
  { builtin: '__TIMESTAMP__', pasted: 'CAT(__TI,MESTAMP__)', indices: [8, 9], expected: 3249 },
  { builtin: '__DATE__', pasted: 'CAT(__DA,TE__)', indices: [4, 5], expected: 3249 },
  { builtin: '__TIME__', pasted: 'CAT(__TI,ME__)', indices: [6, 7], expected: 4848 },
];
for (const compiler of compilers) it.each(forms)('hermetic $builtin despite spliced pragma/pasting (' + compiler.path + ')', async ({ builtin, pasted, indices, expected }) => {
  const root = mkdtempSync(join(tmpdir(), 'bgt-hermetic-time-'));
  const oldEpoch = process.env.SOURCE_DATE_EPOCH, oldTZ = process.env.TZ;
  try {
    const source = join(root, 'main.c');
    const compilerVersion = execFileSync(compiler.path, [...compiler.prefix, '--version'], { encoding: 'utf8' });
    // Exact reviewer source for TIMESTAMP, plus a string accessor to verify every byte.
    // GCC has a corresponding pragma; neither probe nor the text scanner may decide safety.
    const pragma = compiler.wasm || /clang/i.test(compilerVersion) ? '#pragma clang diagnostic ignored "-Wdate-' : '#pragma GCC diagnostic ignored "-Wdate-';
    writeFileSync(source, pragma + String.fromCharCode(92, 10) + 'time"\n' +
      '#define CAT(a,b) a##b\n#define STAMP ' + pasted + '\n' +
      'int value(void){return STAMP[' + indices[0] + ']*100+STAMP[' + indices[1] + '];}\n' +
      'const char *stamp(void){return STAMP;}\n' +
      (compiler.wasm ? '' : 'extern int puts(const char *);\nint main(void){puts(stamp());return value()!=' + expected + ';}\n'));
    const cfg = { root, sources: [source], includes: [], cache: join(root, 'objects'),
      // Strict warnings prove the deliberate builtin redefinition is handled.
      flags: [...compiler.flags, '-O2', '-g0', '-Wall', '-Wextra', '-Werror'],
      compiler: { path: compiler.path, prefix: compiler.prefix, version: compilerVersion } };
    const compile = (objects: any[]) => JSON.parse(execFileSync('python3', ['-I', join(ROOT, 'tools/build/compile.py')], {
      cwd: root, input: JSON.stringify({ objects, jobs: 1 }), encoding: 'utf8', stdio: 'pipe',
    }));
    const run = async (object?: any) => {
      const out = join(root, compiler.wasm ? 'result.wasm' : 'result');
      execFileSync(compiler.path, [...compiler.prefix, ...compiler.flags,
        ...(object ? [object.out] : [...cfg.flags, ...hermeticTimeFlags(), source]),
        ...(compiler.wasm ? ['-nostdlib', '-Wl,--no-entry', '-Wl,--export=value', '-Wl,--export=stamp', '-Wl,--export-memory'] : []), '-o', out], { cwd: root, stdio: 'pipe' });
      if (!compiler.wasm) return execFileSync(out, [], { encoding: 'utf8' }).trimEnd(); // Original local C, never a PE.
      const { instance } = await WebAssembly.instantiate(readFileSync(out));
      const exports = instance.exports as { value: () => number; stamp: () => number; memory: WebAssembly.Memory };
      expect(exports.value()).toBe(expected);
      const bytes = new Uint8Array(exports.memory.buffer), start = exports.stamp();
      return new TextDecoder().decode(bytes.subarray(start, bytes.indexOf(0, start)));
    };
    process.env.SOURCE_DATE_EPOCH = '1577880000'; process.env.TZ = 'Pacific/Honolulu';
    utimesSync(source, new Date('2020-01-01T12:00:00Z'), new Date('2020-01-01T12:00:00Z'));
    const first = prepareObjects(cfg);
    expect(first[0].volatile_inputs_detected).toBe(false); // Deliberately defeats both old detectors.
    expect(first[0].cacheable).toBe(true);
    expect(compile(first)).toMatchObject({ objects_compiled: 1, objects_cached: 0, objects_uncacheable: 0 });
    const firstBytes = readFileSync(first[0].out);
    expect(await run(first[0])).toBe(PINNED_TIME[builtin]);
    expect(compile(prepareObjects(cfg)).objects_cached).toBe(1);
    // Change both the actual clock second and the compiler's reproducible clock input.
    await new Promise(resolve => setTimeout(resolve, 1100));
    process.env.SOURCE_DATE_EPOCH = '2053036800'; process.env.TZ = 'Asia/Tokyo';
    utimesSync(source, new Date('2020-01-22T12:00:00Z'), new Date('2020-01-22T12:00:00Z'));
    const next = prepareObjects(cfg);
    expect(next[0].out).toBe(first[0].out);
    expect(compile(next)).toMatchObject({ objects_compiled: 0, objects_cached: 1, objects_uncacheable: 0 });
    expect(await run(next[0])).toBe(PINNED_TIME[builtin]);
    expect(await run()).toBe(PINNED_TIME[builtin]); // Independent fresh compile, no object-cache path.
    rmSync(next[0].out);
    expect(compile(next).objects_compiled).toBe(1);
    expect(readFileSync(next[0].out)).toEqual(firstBytes);
    expect(await run(next[0])).toBe(PINNED_TIME[builtin]);
  } finally {
    if (oldEpoch === undefined) delete process.env.SOURCE_DATE_EPOCH; else process.env.SOURCE_DATE_EPOCH = oldEpoch;
    if (oldTZ === undefined) delete process.env.TZ; else process.env.TZ = oldTZ;
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);

it('keys the time mechanism version and fixed values, including callers with no explicit flags', () => {
  const base = { compiler: ['zig', 'test'], file: '/a/main.c', flags: [], dependencies: [], root: '/a' };
  // Independently reconstruct the key to guard policy version AND values even
  // for callers that use objectKey without prepareObjects.
  expect(PINNED_TIME).toEqual({ version: 'builtin-time-predefinitions-v1', __DATE__: 'Jan  1 1970', __TIME__: '00:00:00', __TIMESTAMP__: 'Thu Jan  1 00:00:00 1970' });
  expect(hermeticTimeFlags()).toContain('-D__TIMESTAMP__="Thu Jan  1 00:00:00 1970"');
  const key = (policy: object) => createHash('sha256').update(JSON.stringify([
    'objects-v2', policy, base.compiler, [], '@/main.c', [],
  ])).digest('hex');
  expect(objectKey(base)).toBe(key(PINNED_TIME));
  expect(objectKey(base)).not.toBe(key({ ...PINNED_TIME, version: 'old-mechanism' }));
  expect(objectKey(base)).not.toBe(key({ ...PINNED_TIME, __TIME__: '12:00:00' }));
});
