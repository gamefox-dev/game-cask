// Original CC0-1.0. Fixed-shape sustained controls complement the mixed VM.
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../../tests/support/headless';
import { k34WorkloadDir } from './k34-fixture';
export type K35Fixture = 'vm' | 'flags' | 'memory';
export function k35Fixture(kind: K35Fixture) {
  if (kind === 'vm') {
    process.env.BGT_K34_SUSTAINED = '1';
    return { dir: k34WorkloadDir(), id: 'k34-workload', expected: 'guest: k34 workload checksum 88bf80fb' };
  }
  const id = 'k35-' + kind;
  const dir = join(ROOT,'node_modules/.cache/bgt',id); mkdirSync(dir,{recursive:true});
  cpSync(join(ROOT,'tools/bench/k35-kernels.S'),join(dir,'kernels.S'));
  let expected = 0, d = 1;
  for (let n = 0; n < 4096; n++) {
    if (kind === 'flags') { expected = (expected + d) >>> 0; if (expected >= 16384) expected = (expected - 16384) >>> 0; d ^= 21; expected = (expected + (d & 1)) >>> 0; }
    else expected = ((expected + 0) ^ 85) >>> 0; // (p[0]+p[1])^p[2] = (1+2)^3 = 0.
  }
  const call = kind === 'flags' ? 'k35_flags(4096)' : 'k35_memory(data,4096)';
  const main = [
    '/* Original CC0-1.0. */',
    '#include <windows.h>',
    '#include <stdint.h>',
    'extern uint32_t k35_flags(uint32_t);',
    'extern uint32_t k35_memory(uint32_t *, uint32_t);',
    'static uint32_t data[4] = {1,2,3,4};',
    'static void *volatile relocation_anchor = &relocation_anchor;',
    'int main(void) {',
    '  (void)relocation_anchor;',
    '  for (uint32_t i=0;;i++) {',
    '    uint32_t got = ' + call + ';',
    '    if (got != ' + expected + 'u) { OutputDebugStringA("k35 FAIL"); return 1; }',
    '    if (!i) OutputDebugStringA("' + id + ' OK");',
    '    Sleep(5);',
    '  }',
    '}',
  ].join('\n');
  writeFileSync(join(dir, 'main.c'), main);
  writeFileSync(join(dir, 'game.json'), JSON.stringify({ id, name: 'CC0 K35 ' + kind, pipeline: {
    platform: 'win32', suspensionBuild: 'dual', fixture: { target: 'x86_64-windows-gnu', crt: true,
      sources: ['main.c', 'kernels.S'], out: 'workload.exe', libs: ['kernel32'] },
    modules: [{ from: './build/workload.exe', main: true }],
  }}));
  return { dir, id, expected: 'guest: ' + id + ' OK' };
}
