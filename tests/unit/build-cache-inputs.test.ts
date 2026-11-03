// @bgt-examples: none
// Each test catches a silent stale hit by comparing cached wasm with a fresh compiler invocation.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
// @ts-expect-error plain ESM build tool
import { hermeticTimeFlags, prepareObjects } from '../../tools/build/objects.mjs';
import { ROOT } from '../support/headless';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'bgt-cache-inputs-'));
  for (const d of ['src', 'first/sub', 'fallback/sub']) mkdirSync(join(root, d), { recursive: true });
  const source = join(root, 'src/main.c');
  writeFileSync(source, 'int value(void){return VALUE;}\n');
  writeFileSync(join(root, 'src/other.c'), 'int other(void){return 42;}\n');
  const cfg = { root, sources: [source, join(root, 'src/other.c')], flags: ['--target=wasm32-freestanding', '-O2', '-g0'],
    includes: [] as string[], compiler: { path: 'zig', version: '0.13.0' }, cache: join(root, 'objects') };
  const compile = (objects: any[], cwd = root) => JSON.parse(execFileSync('python3', ['-I', join(ROOT, 'tools/build/compile.py')], {
    cwd, input: JSON.stringify({ objects, jobs: 1 }), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  }));
  const value = async (object?: any, effectiveFlags = cfg.flags, file = source) => {
    const out = join(root, 'value.wasm');
    const args = object ? [object.out] : [...effectiveFlags, ...hermeticTimeFlags(), file];
    execFileSync('zig', ['cc', '--target=wasm32-freestanding', ...args, '-nostdlib', '-Wl,--no-entry', '-Wl,--export=value', '-o', out], { cwd: root, stdio: 'pipe' });
    const { instance } = await WebAssembly.instantiate(readFileSync(out));
    return (instance.exports.value as () => number)();
  };
  return { root, source, cfg, compile, value, clean: () => rmSync(root, { recursive: true, force: true }) };
}

it('forced-include cwd shadow rebuilds all and only TUs receiving that flag', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, 'fallback/forced.h'), '#define VALUE 1\n');
    f.cfg.flags.push('-I', join(f.root, 'fallback'), '-include', 'forced.h');
    const first = prepareObjects(f.cfg); f.compile(first);
    expect(f.compile(prepareObjects(f.cfg)).objects_cached).toBe(2);
    expect(await f.value(first[0])).toBe(1);
    writeFileSync(join(f.root, 'forced.h'), '#define VALUE 2\n');
    const next = prepareObjects(f.cfg);
    expect(f.compile(next)).toMatchObject({ objects_compiled: 2, objects_cached: 0 }); // Both TUs force-include it.
    expect(await f.value(next[0])).toBe(await f.value());
    expect(await f.value(next[0])).toBe(2);
    rmSync(join(f.root, 'forced.h'));
    expect(prepareObjects(f.cfg)[0].out).toBe(first[0].out);
  } finally { f.clean(); }
}, 30_000);

it.each([false, true])('response-file contents and expanded include paths invalidate keys (nested=%s)', async (nested) => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, 'fallback/value.h'), '#define VALUE 1\n');
    writeFileSync(join(f.root, 'first/value.h'), '#define VALUE 2\n');
    writeFileSync(f.source, '#include <value.h>\nint value(void){return VALUE;}\n');
    const rsp = join(f.root, nested ? 'nested.rsp' : 'flags.rsp');
    // Nested response filenames, like compiler argv filenames, are relative to cwd, not the containing rsp.
    if (nested) writeFileSync(join(f.root, 'flags.rsp'), '@nested.rsp\n');
    f.cfg.flags.push('@flags.rsp');
    writeFileSync(rsp, '-I fallback\n');
    const first = prepareObjects(f.cfg); f.compile(first);
    expect(f.compile(prepareObjects(f.cfg)).objects_cached).toBe(2);
    writeFileSync(rsp, '-I first\n');
    const next = prepareObjects(f.cfg);
    expect(f.compile(next).objects_compiled).toBe(2);
    expect(await f.value(next[0])).toBe(await f.value(undefined, ['--target=wasm32-freestanding', '-O2', '-g0', '-I', 'first']));
    expect(await f.value(next[0])).toBe(2);
    writeFileSync(join(f.root, 'first/value.h'), '#define VALUE 3\n');
    const header = prepareObjects(f.cfg);
    expect(f.compile(header).objects_compiled).toBe(1);
    expect(header[1].out).toBe(next[1].out);
    expect(await f.value(header[0])).toBe(3);
  } finally { f.clean(); }
}, 30_000);

it.each(['#import HDR', '#import <../value.h>'])('rediscovers import parent shadows: %s', async (directive) => {
  const f = fixture();
  try {
    writeFileSync(f.source, directive + '\nint value(void){return VALUE;}\n');
    writeFileSync(join(f.root, 'fallback/value.h'), '#define VALUE 1\n');
    f.cfg.flags.push('-DHDR=<../value.h>', '-I', join(f.root, 'first/sub'), '-I', join(f.root, 'fallback/sub'));
    const first = prepareObjects(f.cfg); f.compile(first);
    expect(f.compile(prepareObjects(f.cfg)).objects_cached).toBe(2);
    writeFileSync(join(f.root, 'first/value.h'), '#define VALUE 2\n');
    const next = prepareObjects(f.cfg);
    expect(f.compile(next)).toMatchObject({ objects_compiled: 1, objects_cached: 1 });
    expect(next[1].out).toBe(first[1].out);
    expect(await f.value(next[0])).toBe(await f.value());
    expect(await f.value(next[0])).toBe(2);
  } finally { f.clean(); }
}, 30_000);

it.each(['source', 'header', 'pasted'])('__TIMESTAMP__ mtime-only change cannot affect results or keys (%s)', async (location) => {
  const f = fixture();
  try {
    const body = 'int value(void){return STAMP[8]*100+STAMP[9];}\n';
    const text = location === 'pasted' ? '#define CAT(a,b) a##b\n#define STAMP CAT(__TI,MESTAMP__)\n' : '#define STAMP __TIMESTAMP__\n';
    const timed = location === 'header' ? join(f.root, 'src/stamp.h') : f.source;
    writeFileSync(f.source, location === 'header' ? '#include "stamp.h"\n' : text + body);
    if (location === 'header') writeFileSync(timed, text + body);
    utimesSync(timed, new Date('2020-01-01T12:00:00Z'), new Date('2020-01-01T12:00:00Z'));
    const first = prepareObjects(f.cfg); f.compile(first);
    const initial = await f.value(first[0]);
    utimesSync(timed, new Date('2020-01-22T12:00:00Z'), new Date('2020-01-22T12:00:00Z'));
    const next = prepareObjects(f.cfg), summary = f.compile(next);
    const detected = location !== 'pasted';
    expect(summary).toMatchObject({ objects_compiled: detected ? 1 : 0, objects_cached: detected ? 1 : 2, objects_uncacheable: detected ? 1 : 0 });
    expect(next[0].volatile_inputs_detected).toBe(detected);
    expect(next[0].out).toBe(first[0].out);
    expect(await f.value(next[0])).toBe(await f.value());
    expect(await f.value(next[0])).toBe(initial);
    expect(initial).toBe(3249); // Day 1, regardless of the source's actual mtime.
  } finally { f.clean(); }
}, 30_000);

it('reviewer exact spliced-pragma timestamp reproduction stays 3249 on a stable cached key', async () => {
  const f = fixture();
  try {
    writeFileSync(f.source, ['#pragma clang diagnostic ignored "-Wdate-' + String.fromCharCode(92),
      'time"', '#define CAT(a,b) a##b', '#define STAMP CAT(__TI,MESTAMP__)',
      'int value(void){return STAMP[8]*100+STAMP[9];}'].join(String.fromCharCode(10)));
    utimesSync(f.source, new Date('2020-01-01T12:00:00Z'), new Date('2020-01-01T12:00:00Z'));
    const first = prepareObjects(f.cfg); f.compile(first);
    const bytes = readFileSync(first[0].out);
    expect(await f.value(first[0])).toBe(3249);
    expect(f.compile(prepareObjects(f.cfg)).objects_cached).toBe(2);
    utimesSync(f.source, new Date('2020-01-22T12:00:00Z'), new Date('2020-01-22T12:00:00Z'));
    const next = prepareObjects(f.cfg);
    expect(next[0].cacheable).toBe(true);
    expect(next[0].volatile_inputs_detected).toBe(false);
    expect(next[0].out).toBe(first[0].out);
    expect(f.compile(next)).toMatchObject({ objects_compiled: 0, objects_cached: 2, objects_uncacheable: 0 });
    expect(await f.value(next[0])).toBe(3249);
    expect(await f.value()).toBe(3249); // Used to return 5050 on an independent clean compile.
    rmSync(next[0].out);
    expect(f.compile(next).objects_compiled).toBe(1);
    expect(readFileSync(next[0].out)).toEqual(bytes);
  } finally { f.clean(); }
}, 30_000);

it.each(['__DATE__', '__TIME__'])('volatile builtin %s always rebuilds and is counted', (builtin) => {
  const f = fixture();
  try {
    writeFileSync(f.source, 'const char *value(void){return ' + builtin + ';}\n');
    const first = prepareObjects(f.cfg); f.compile(first);
    const next = prepareObjects(f.cfg);
    expect(f.compile(next)).toMatchObject({ objects_compiled: 1, objects_cached: 1, objects_uncacheable: 1 });
    expect(next[0].out).toBe(first[0].out); // Bypass is retained, but the hermetic key is stable.
  } finally { f.clean(); }
}, 30_000);

// Prefix maps normalize clone roots, but must not erase lexical path components.
it.each(['__FILE__', '__BASE_FILE__'])('keys actual compiler path spelling for %s', async (builtin) => {
  const f = fixture();
  try {
    writeFileSync(f.source, 'int value(void){return sizeof(' + builtin + ');}' + String.fromCharCode(10));
    const first = prepareObjects(f.cfg); f.compile(first);
    expect(f.compile(prepareObjects(f.cfg)).objects_cached).toBe(2);
    const before = await f.value(first[0]);
    f.cfg.sources[0] = f.root + '/src/../src/main.c';
    const next = prepareObjects(f.cfg);
    expect(f.compile(next)).toMatchObject({ objects_compiled: 1, objects_cached: 1, objects_uncacheable: 0 });
    expect(await f.value(next[0])).toBe(await f.value(undefined, next[0].args.slice(2, -2), f.cfg.sources[0]));
    expect(await f.value(next[0])).not.toBe(before);
  } finally { f.clean(); }
}, 30_000);

it('keys response macro bytes, not just the response filename', async () => {
  const f = fixture();
  try {
    const rsp = join(f.root, 'flags.rsp'); f.cfg.flags.push('@flags.rsp');
    writeFileSync(rsp, '-DVALUE=1');
    const first = prepareObjects(f.cfg); f.compile(first);
    expect(f.compile(prepareObjects(f.cfg)).objects_cached).toBe(2);
    writeFileSync(rsp, '-DVALUE=2');
    const next = prepareObjects(f.cfg);
    expect(f.compile(next)).toMatchObject({ objects_compiled: 2, objects_cached: 0, objects_uncacheable: 0 });
    expect(await f.value(next[0])).toBe(await f.value());
    expect(await f.value(next[0])).toBe(2);
  } finally { f.clean(); }
}, 30_000);

it('unsupported response quoting fails safe, still compiles, and counts bypassed objects', async () => {
  const f = fixture();
  try {
    const rsp = join(f.root, 'flags.rsp'); f.cfg.flags.push('@flags.rsp');
    writeFileSync(rsp, '"-DVALUE=1"');
    const first = prepareObjects(f.cfg); f.compile(first);
    writeFileSync(rsp, '"-DVALUE=2"');
    const next = prepareObjects(f.cfg);
    expect(f.compile(next)).toMatchObject({ objects_compiled: 2, objects_cached: 0, objects_uncacheable: 2 });
    expect(await f.value(next[0])).toBe(await f.value());
    expect(await f.value(next[0])).toBe(2);
    expect(f.compile(next).objects_compiled).toBe(2);
  } finally { f.clean(); }
}, 30_000);

it('object descriptors preserve compiler cwd when the worker starts elsewhere', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, 'forced.h'), '#define VALUE 7' + String.fromCharCode(10));
    f.cfg.flags.push('-include', 'forced.h');
    const objects = prepareObjects(f.cfg);
    expect(f.compile(objects, ROOT).objects_compiled).toBe(2);
    expect(await f.value(objects[0])).toBe(7);
  } finally { f.clean(); }
}, 30_000);

it('keys lexical -I spelling used by __FILE__ inside an included header', async () => {
  const f = fixture();
  try {
    writeFileSync(f.source, '#include <path.h>' + String.fromCharCode(10));
    writeFileSync(join(f.root, 'first/path.h'), 'int value(void){return sizeof(__FILE__);}' + String.fromCharCode(10));
    f.cfg.flags.push('-I', f.root + '/first');
    const first = prepareObjects(f.cfg); f.compile(first);
    const before = await f.value(first[0]);
    f.cfg.flags[f.cfg.flags.length - 1] = f.root + '/first/../first';
    const next = prepareObjects(f.cfg);
    expect(f.compile(next)).toMatchObject({ objects_compiled: 2, objects_cached: 0, objects_uncacheable: 0 });
    expect(await f.value(next[0])).toBe(await f.value(undefined, next[0].args.slice(2, -2)));
    expect(await f.value(next[0])).not.toBe(before);
  } finally { f.clean(); }
}, 30_000);

it.each(['-w', '-Wno-date-time'])('warning suppression cannot permit stale pasted volatile builtins (%s)', (warning) => {
  const f = fixture();
  try {
    writeFileSync(f.source, '#define CAT(a,b) a##b' + String.fromCharCode(10) + 'const char *value(void){return CAT(__TI,ME__);}' + String.fromCharCode(10));
    f.cfg.flags.push('-DVALUE=1', warning);
    const objects = prepareObjects(f.cfg); f.compile(objects);
    expect(f.compile(prepareObjects(f.cfg))).toMatchObject({ objects_compiled: 2, objects_cached: 0, objects_uncacheable: 2 });
  } finally { f.clean(); }
}, 30_000);
