// Original CC0-1.0. K52 fast-lifting benchmark fixtures: the K34/K35 VM, flags and memory
// controls with enough work per Sleep that host-update overhead is negligible, plus a
// calls fixture (dense small direct calls). Each guest logs its first-iteration checksum and
// RDTSC instruction count, so every lift mode must print the same line. Native references are
// the same C (VM, calls) or scalar C equivalents of the assembly kernels (flags, memory).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, requireZig } from '../build/toolchain.mjs';
import { CFLAGS, LDFLAGS } from '../build/build.mjs';
import { execFileSync } from '../build/exec.mjs';

export const K52_KINDS = ['vm', 'flags', 'memory', 'calls'];
const NL = '\n';
// Kernel invocations per outer guest iteration (one Sleep(5) each), ~5M guest instructions.
const REPEAT = { vm: 320, flags: 4096 * 128, memory: 4096 * 100, calls: 2000 };

function vmSource() {
  const s = readFileSync(join(ROOT, 'tools/bench/k34-sustained-workload.c'), 'utf8');
  const start = s.indexOf('int main(void) {');
  if (start < 0) throw new Error('k52: k34 workload main changed');
  return s.slice(0, start).replace('  value_t v;', '  value_t v = {0};');
}
function callsSource() {
  // Small direct calls with stack arguments, a callee-saved register and a short loop.
  return ['#include <stdint.h>',
    '__attribute__((noinline)) static uint32_t step(uint32_t x, uint32_t y) { return (x ^ (y << 3)) + 0x9e37u; }',
    '__attribute__((noinline)) static uint32_t pair(uint32_t x, uint32_t i) { uint32_t a = step(x, i); return step(a, i ^ 5u) ^ (a >> 7); }',
    '__attribute__((noinline)) static uint32_t calls_kernel(uint32_t seed) {',
    '  uint32_t acc = seed;',
    '  for (uint32_t i = 0; i < 256; i++) { acc = pair(acc, i); if (acc & 1u) acc += step(i, acc); }',
    '  return acc;',
    '}', ''].join(NL);
}
function guestMain(kind) {
  const n = REPEAT[kind];
  const call = {
    vm: 'checksum = 1; for (uint32_t r = 0; r < ' + n + 'u; r++) checksum = dispatch(program, 256, checksum + r);',
    calls: 'checksum = 7; for (uint32_t r = 0; r < ' + n + 'u; r++) checksum = calls_kernel(checksum + r);',
    flags: 'checksum = k35_flags(' + n + 'u);',
    memory: 'checksum = k35_memory(data, ' + n + 'u);',
  }[kind];
  return [
    kind === 'vm' ? '' : 'static void *volatile relocation_anchor = (void *)&relocation_anchor;',
    'int main(void) {',
    '  (void)relocation_anchor;',
    kind === 'vm' ? '  static uint8_t program[256];\n  for (uint32_t i = 0; i < 256; i++) program[i] = (uint8_t)(i * 37u + 11u);\n' +
      '  for (uint32_t i = 0; i < 64; i++) { buckets[i].hash = key_hash(words[i & 7u]); buckets[i].value = i * 19u + 3u; buckets[i].key = words[i & 7u]; }' : '',
    '  for (uint32_t i = 0;; i++) {',
    '    uint32_t checksum; unsigned long long t0 = __builtin_ia32_rdtsc();',
    '    ' + call,
    '    unsigned long long t1 = __builtin_ia32_rdtsc();',
    '    if (!i) { char text[96]; wsprintfA(text, "k52 ' + kind + ' checksum %08x insns %u", checksum, (unsigned)(t1 - t0)); OutputDebugStringA(text); }',
    '    Sleep(5);',
    '  }',
    '}', ''].join(NL);
}
/** Writes the fixture game directory for `kind`; `pipeline` is merged into the pipeline section. */
export function k52Fixture(kind, { id = 'k52-' + kind, pipeline = {} } = {}) {
  const dir = join(ROOT, 'node_modules/.cache/bgt/k52', id); mkdirSync(dir, { recursive: true });
  const asm = kind === 'flags' || kind === 'memory';
  if (asm) writeFileSync(join(dir, 'kernels.S'), readFileSync(join(ROOT, 'tools/bench/k35-kernels.S')));
  const head = ['/* Original CC0-1.0. */', '#include <windows.h>', '#include <stdint.h>'];
  const body = kind === 'vm' ? vmSource() : kind === 'calls' ? callsSource() :
    'extern uint32_t k35_flags(uint32_t);\nextern uint32_t k35_memory(uint32_t *, uint32_t);\nstatic uint32_t data[4] = {1,2,3,4};\n';
  writeFileSync(join(dir, 'main.c'), [...head, body, guestMain(kind)].join(NL));
  writeFileSync(join(dir, 'game.json'), JSON.stringify({ id, name: 'CC0 K52 ' + kind, pipeline: {
    platform: 'win32', suspensionBuild: 'dual', ...pipeline, fixture: { target: 'x86_64-windows-gnu', crt: true,
      sources: ['main.c', ...(asm ? ['kernels.S'] : [])], out: 'workload.exe', libs: ['kernel32', 'user32'] },
    modules: [{ from: './build/workload.exe', main: true }],
  } }));
  return { dir, id, expected: 'guest: k52 ' + kind + ' checksum ' };
}
/** Native-compiled wasm reference: export run() performs exactly one outer guest iteration. */
export function k52NativeSource(kind) {
  const n = REPEAT[kind];
  if (kind === 'vm') {
    const s = vmSource().replace('#include <windows.h>', '#define __declspec(x) __attribute__((x))');
    return s + ['static uint8_t program[256]; static int ready;',
      'static void init(void) { for (uint32_t i = 0; i < 256; i++) program[i] = (uint8_t)(i * 37u + 11u);',
      '  for (uint32_t i = 0; i < 64; i++) { buckets[i].hash = key_hash(words[i & 7u]); buckets[i].value = i * 19u + 3u; buckets[i].key = words[i & 7u]; } ready = 1; }',
      '__attribute__((export_name("run"))) uint32_t run(void) { if (!ready) init(); uint32_t checksum = 1;',
      '  for (uint32_t r = 0; r < ' + n + 'u; r++) checksum = dispatch(program, 256, checksum + r); return checksum; }', ''].join(NL);
  }
  if (kind === 'calls') return callsSource() + '__attribute__((export_name("run"))) uint32_t run(void) { uint32_t checksum = 7;\n' +
    '  for (uint32_t r = 0; r < ' + n + 'u; r++) checksum = calls_kernel(checksum + r); return checksum; }\n';
  // Scalar C equivalents of the assembly controls (not identical compiler inputs).
  return ['#include <stdint.h>', 'static volatile uint32_t data[4] = {1,2,3,4};',
    '__attribute__((noinline)) static uint32_t leaf(uint32_t x) { return x ^ 85u; }',
    '__attribute__((export_name("run"))) uint32_t run(void) { uint32_t a = 0, d = 1; (void)d; (void)data;',
    '  for (uint32_t i = 0; i < ' + n + 'u; i++) {',
    kind === 'flags' ? '    a += d; if (a >= 16384) a -= 16384; d ^= 21; a += d & 1;' :
      '    uint32_t v = (data[0] + data[1]) ^ data[2]; data[3] = v; a = leaf(a + v);',
    '  }', '  return a; }', ''].join(NL);
}
export function k52BuildNative(kind, dir) {
  mkdirSync(dir, { recursive: true });
  const input = join(dir, 'native.c'), output = join(dir, 'native.wasm');
  writeFileSync(input, k52NativeSource(kind));
  const flags = CFLAGS.map((f) => f === '--target=wasm32-freestanding' ? '--target=wasm32-wasi' : f);
  const start = performance.now();
  execFileSync(requireZig({ quiet: true }).path, ['cc', ...flags, input, join(ROOT, 'bgt/sdk/bgt_libc.c'), ...LDFLAGS, '-o', output], { stdio: 'pipe' });
  return { path: output, buildMs: performance.now() - start, bytes: readFileSync(output).length };
}
