// Original CC0-1.0. K65 Asyncify-precision benchmark fixture: a CPU-heavy, call-dense Win64 guest
// (generated distinct functions with switches, integer mixing, SSE doubles, direct call chains,
// a function-pointer table, CRT memset/memcpy leaf calls and a QueryPerformanceCounter import
// every 64 table calls), one Sleep (= one host present/yield) per frame. Not game-derived.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../build/toolchain.mjs';

const NL = '\n';
export function k65Source({ functions = 1500, perFrame = 6000 } = {}) {
  const c = ['/* Original CC0-1.0. Generated K65 benchmark guest. */', '#include <windows.h>', '#include <stdint.h>', '#include <string.h>',
    'typedef uint32_t (*fn_t)(uint32_t, double);', 'static volatile uint32_t sink;'];
  for (let i = 0; i < functions; i++) c.push('__attribute__((noinline)) uint32_t g' + i + '(uint32_t, double);');
  for (let i = 0; i < functions; i++) {
    const b = ['__attribute__((noinline)) uint32_t g' + i + '(uint32_t v, double d) {', '  switch (v & 7u) {'];
    for (let k = 0; k < 8; k++) b.push('  case ' + k + 'u: v = (v * ' + (3 + 2 * k) + 'u) ^ ' + (((i + 1) * 7919 + k * 31) >>> 0) + 'u; break;');
    b.push('  }');
    for (let k = 0; k < 6; k++) b.push('  v ^= v >> 13; v = v * 1664525u + ' + (((i + 1) * 101 + k * 127) >>> 0) + 'u;');
    b.push('  d = d * 1.0000001 + (double)(v & 255u);');
    if (i % 4 === 0) b.push('  { unsigned char buf[96]; memset(buf, (int)(v & 255u), sizeof buf); memcpy(buf + 8, buf + 40, 48); v += buf[17] + buf[60]; }');
    // Direct call chains of bounded depth (only to higher indices).
    if (i % 3 === 0 && i + 1 < functions) b.push('  if (v & 1u) v = g' + (i + 1) + '(v, d);');
    if (i % 5 === 0 && i + 7 < functions) b.push('  if (v & 2u) v ^= g' + (i + 7) + '(v + 3u, d);');
    b.push('  return v ^ (uint32_t)(int32_t)d;', '}');
    c.push(...b);
  }
  c.push('static const fn_t table[] = {' + Array.from({ length: functions }, (_, i) => 'g' + i).join(',') + '};');
  c.push('static uint32_t frame_work(uint32_t v, uint32_t frame) {',
    '  LARGE_INTEGER t;',
    '  for (uint32_t r = 0; r < ' + perFrame + 'u; r++) {',
    '    v = table[(v + r) % ' + functions + 'u](v, (double)(r & 255u));',
    '    if ((r & 63u) == 0u) { QueryPerformanceCounter(&t); sink = (uint32_t)t.QuadPart; }',
    '  }',
    '  return v + frame;', '}',
    'int main(void) {', '  uint32_t v = 1;',
    '  for (uint32_t frame = 0;; frame++) {',
    '    v = frame_work(v, frame);',
    '    if (frame % 30u == 0u) { char text[96]; wsprintfA(text, "k65 frame %u checksum %08x", frame, v); OutputDebugStringA(text); }',
    '    Sleep(16);', '  }', '}', '');
  return c.join(NL);
}
/** Writes a game directory; `pipeline` is merged into the pipeline section. */
export function k65Fixture({ id = 'k65-mixed', functions, perFrame, pipeline = {} } = {}) {
  const dir = join(ROOT, 'node_modules/.cache/bgt/k65', id); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'main.c'), k65Source({ functions, perFrame }));
  writeFileSync(join(dir, 'game.json'), JSON.stringify({ id, name: 'CC0 K65 Asyncify precision', pipeline: {
    platform: 'win32', suspensionBuild: 'dual', liftMode: 'fast', ...pipeline,
    fixture: { target: 'x86_64-windows-gnu', crt: true, sources: ['main.c'], out: 'k65.exe', libs: ['kernel32', 'user32'] },
    modules: [{ from: './build/k65.exe', main: true }],
  } }));
  return { dir, id, expected: 'guest: k65 frame 0 checksum ' };
}
