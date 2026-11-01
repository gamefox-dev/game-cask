// @bgt-examples: none
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
// @ts-expect-error plain ESM build tool
import { objectKey, parseDependencies, prepareObjects } from '../../tools/build/objects.mjs';
// @ts-expect-error plain ESM build tool
import { leaseCache, pruneCache, touchCache } from '../../tools/build/cache.mjs';
// @ts-expect-error plain ESM build tool
import { declaredExamples, selectExampleDirs, testExamples } from '../../tools/build/test-examples.mjs';
import { ROOT } from '../support/headless';

function compile(input: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = execFile('python3', ['-I', join(ROOT, 'tools/build/compile.py')], { cwd: ROOT }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || String(error))); else resolve(JSON.parse(stdout));
    });
    child.stdin!.end(JSON.stringify(input));
  });
}

it('make dependencies preserve escaped spaces, dollars and continuation lines', () => {
  expect(parseDependencies('bgt: /a/main.c /b/with\\ space.h \\\n /c/dollar$$.h\n')).toEqual(['/a/main.c', '/b/with space.h', '/c/dollar$.h']);
});

it('real compiler dependencies invalidate exactly affected objects, including transitive and shadow headers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bgt-dependencies-'));
  try {
    const inc = join(dir, 'include'), fallback = join(dir, 'fallback'), src = join(dir, 'src');
    for (const d of [inc, fallback, src]) mkdirSync(d);
    writeFileSync(join(inc, 'lift.h'), '#include "value.h"\n');
    writeFileSync(join(fallback, 'value.h'), '#define VALUE 1\n');
    writeFileSync(join(inc, 'profile.h'), '#define PROFILE 2\n');
    writeFileSync(join(src, 'lifted.c'), '#include "lift.h"\nint lifted(void){return VALUE;}\n');
    writeFileSync(join(src, 'profile.c'), '#include "profile.h"\nint profile(void){return PROFILE;}\n');
    const cfg = { sources: ['lifted.c', 'profile.c'].map((s) => join(src, s)),
      flags: ['--target=wasm32-freestanding', '-O2', '-g0', '-I', inc, '-I', fallback],
      includes: [inc, fallback], compiler: { path: 'zig', version: '0.13.0' }, cache: join(dir, 'objects'), root: dir };
    const first = prepareObjects(cfg);
    const a = await compile({ objects: first }); expect(a.objects_compiled).toBe(2);
    expect((await compile({ objects: prepareObjects(cfg) })).objects_cached).toBe(2);
    writeFileSync(join(inc, 'profile.h'), '#define PROFILE 3\n');
    const header = prepareObjects(cfg);
    expect(header[0].out).toBe(first[0].out); expect(header[1].out).not.toBe(first[1].out);
    expect((await compile({ objects: header })).objects_compiled).toBe(1);
    writeFileSync(join(src, 'profile.c'), '#include "profile.h"\nint profile(void){return PROFILE+1;}\n');
    const source = prepareObjects(cfg);
    expect(source[0].out).toBe(first[0].out); expect(source[1].out).not.toBe(header[1].out);
    // A new higher-priority include must be discovered, not hidden by a positive-only depfile cache.
    writeFileSync(join(inc, 'value.h'), '#define VALUE 4\n');
    const shadow = prepareObjects(cfg);
    expect(shadow[0].out).not.toBe(first[0].out); expect(shadow[1].out).toBe(source[1].out);
    writeFileSync(join(inc, 'value.h'), '#define VALUE 5\n');
    expect(prepareObjects(cfg)[0].out).not.toBe(shadow[0].out);
    rmSync(join(inc, 'value.h'));
    expect(prepareObjects(cfg)[0].out).toBe(first[0].out);
    writeFileSync(join(src, 'lifted.c'), '#include "lift.h"\nint lifted(void){return VALUE+1;}\n');
    const lifted = prepareObjects(cfg); expect(lifted[0].out).not.toBe(first[0].out); expect(lifted[1].out).toBe(source[1].out);
    const flags = prepareObjects({ ...cfg, flags: [...cfg.flags, '-DNEW_FLAG=1'] });
    expect(flags.every((o: any, i: number) => o.out !== lifted[i].out)).toBe(true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30_000);

it('native host reference objects use the same dependency cache without a zig-only cc prefix', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bgt-native-cache-'));
  try {
    const file = join(dir, 'reference.c'); writeFileSync(file, 'int reference(void){return 42;}\n');
    const cfg = { sources: [file], flags: ['-O2'], includes: [], compiler: { path: 'cc', prefix: [], version: 'native-test' }, cache: join(dir, 'objects'), root: dir };
    const first = prepareObjects(cfg);
    expect((await compile({ objects: first })).objects_compiled).toBe(1);
    expect((await compile({ objects: prepareObjects(cfg) })).objects_cached).toBe(1);
    writeFileSync(file, 'int reference(void){return 43;}\n');
    const changed = prepareObjects(cfg); expect(changed[0].out).not.toBe(first[0].out);
    expect((await compile({ objects: changed })).objects_compiled).toBe(1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('clone-neutral keys and compiler prefix maps share objects without changing __FILE__ bytes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bgt-clones-'));
  try {
    const objects = ['a', 'b'].map((clone) => {
      const root = join(dir, clone); mkdirSync(root);
      const file = join(root, 'main.c'); writeFileSync(file, 'const char *file(void){return __FILE__;}\n');
      return prepareObjects({ sources: [file], flags: ['--target=wasm32-freestanding', '-O2', '-g0'], includes: [],
        compiler: { path: 'zig', version: '0.13.0' }, cache: join(dir, 'shared'), root })[0];
    });
    expect(objects[0].out).toBe(objects[1].out);
    expect((await compile({ objects: [objects[0]] })).objects_compiled).toBe(1);
    expect((await compile({ objects: [objects[1]] })).objects_cached).toBe(1);
    const bytes = readFileSync(objects[0].out);
    rmSync(objects[0].out);
    await compile({ objects: [objects[1]] });
    expect(readFileSync(objects[1].out)).toEqual(bytes);
    const base = { compiler: ['zig', 'a'], file: '/a/main.c', flags: ['-O2'], dependencies: [['/a/main.c', 'source']], root: '/a' };
    expect(objectKey(base)).not.toBe(objectKey({ ...base, compiler: ['zig', 'b'] }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('concurrent writers compile once, publish complete objects atomically, and retry failures', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bgt-object-writers-'));
  try {
    const out = join(dir, 'same.o');
    const code = "import sys,time; time.sleep(.1); open(sys.argv[-1],'wb').write(b'complete-object')";
    const input = { objects: [{ out, args: ['python3', '-I', '-c', code] }], jobs: 1 };
    const results = await Promise.all(Array.from({ length: 8 }, () => compile(input)));
    expect(results.reduce((n, r) => n + r.objects_compiled, 0)).toBe(1);
    expect(results.reduce((n, r) => n + r.objects_cached, 0)).toBe(7);
    expect(readFileSync(out, 'utf8')).toBe('complete-object');
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    rmSync(out);
    await expect(compile({ objects: [{ out, args: ['python3', '-I', '-c', 'import sys;open(sys.argv[-1],"w").write("partial");sys.exit(1)'] }] })).rejects.toThrow();
    expect(existsSync(out)).toBe(false); expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect((await compile(input)).objects_compiled).toBe(1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('a killed cache supervisor cannot publish partial output or release its child writer lock early', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bgt-killed-cache-'));
  const out = join(dir, 'same.wasm'), ready = join(dir, 'ready'), go = join(dir, 'go');
  const child = spawn('python3', ['-I', join(ROOT, 'tools/build/compile.py')], { stdio: ['pipe', 'ignore', 'pipe'] });
  try {
    const code = `import os,sys,time\nopen(${JSON.stringify(ready)},'w').write('ready')\nwhile not os.path.exists(${JSON.stringify(go)}):time.sleep(.01)\nopen(sys.argv[-1],'w').write('abandoned')`;
    child.stdin.end(JSON.stringify({ objects: [{ out, args: ['python3', '-I', '-c', code] }] }));
    for (let n = 0; !existsSync(ready); n++) { if (n > 200) throw new Error('writer did not start'); await new Promise((r) => setTimeout(r, 10)); }
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    const retry = compile({ objects: [{ out, args: ['python3', '-I', '-c', 'import sys;open(sys.argv[-1],"w").write("complete")'] }] });
    await new Promise((r) => setTimeout(r, 100)); expect(existsSync(out)).toBe(false);
    writeFileSync(go, 'go'); expect((await retry).objects_compiled).toBe(1);
    expect(readFileSync(out, 'utf8')).toBe('complete');
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  } finally { writeFileSync(go, 'go'); child.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); }
});

it('LRU collection respects live leases and hits, for both object and Asyncify payloads', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bgt-lru-'));
  try {
    const files = ['old.o', 'hit.o', 'pinned.wasm'].map((f) => join(dir, f));
    for (const f of files) { writeFileSync(f, '1234'); utimesSync(f, 1, 1); }
    touchCache([files[1]]);
    const release = leaseCache(dir, [files[2]]);
    try {
      expect(pruneCache(dir, 8)).toEqual({ bytes: 8, removed: 4, pinnedBytes: 4 });
      expect(existsSync(files[0])).toBe(false); expect(existsSync(files[1])).toBe(true);
      expect(pruneCache(dir, 0)).toEqual({ bytes: 4, removed: 4, pinnedBytes: 4 });
    } finally { release(); }
    expect(pruneCache(dir, 0).bytes).toBe(0);
    writeFileSync(files[0] + '.abandoned.tmp', '1234');
    writeFileSync(files[2] + '.active.tmp', '1234');
    const active = leaseCache(dir, [files[2]]);
    try { expect(pruneCache(dir, 0)).toEqual({ bytes: 4, removed: 4, pinnedBytes: 4 }); }
    finally { active(); }
    expect(pruneCache(dir, 0).bytes).toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('scale check/CI selection partitions work without changing the full default example inventory', () => {
  const dirs = ['examples/sample2d', 'examples/x64-scale', 'examples/x64-smoke'];
  expect(selectExampleDirs(dirs, { check: false, light: false, includeScale: false })).toEqual(dirs);
  expect(selectExampleDirs(dirs, { check: true, light: false, includeScale: false })).toEqual(['examples/sample2d', 'examples/x64-smoke']);
  expect(selectExampleDirs(dirs, { check: true, light: false, includeScale: true })).toEqual(dirs);
  expect(selectExampleDirs(dirs, { check: false, light: true, includeScale: true })).toEqual(['examples/sample2d', 'examples/x64-smoke']);
});

it('test declarations build only the selected examples, deduplicated, and reject non-kit paths', () => {
  expect(testExamples([join(ROOT, 'tests/unit/commands.test.ts')])).toEqual([]);
  const files = readdirSync(join(ROOT, 'tests/unit')).filter((f) => f.endsWith('.test.ts')).map((f) => join(ROOT, 'tests/unit', f));
  const all = readdirSync(join(ROOT, 'examples')).filter((id) => existsSync(join(ROOT, 'examples', id, 'game.json'))).map((id) => `examples/${id}`).sort();
  expect(testExamples(files)).toEqual(all); // The full suite builds every example exactly once, with no implicit fallback.
  expect(testExamples([join(ROOT, 'tests/unit/x86.test.ts'), join(ROOT, 'tests/unit/kit-tools.test.ts')])).toEqual(['examples/win32-hello']);
  const dir = mkdtempSync(join(tmpdir(), 'bgt-test-declaration-'));
  try {
    const file = join(dir, 'test.ts');
    writeFileSync(file, '// @bgt-examples: ../port\n'); expect(() => declaredExamples(file)).toThrow('unknown kit example');
    writeFileSync(file, '// @bgt-examples: missing-example\n'); expect(() => declaredExamples(file)).toThrow('unknown kit example');
    writeFileSync(file, '// @bgt-examples: none\n// @bgt-examples: sample2d\n'); expect(() => declaredExamples(file)).toThrow('exactly one');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
