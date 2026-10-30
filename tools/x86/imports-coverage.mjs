// Static import capability census. CRT status and groups come from the runtime's exact registry.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from '../build/toolchain.mjs';
import { isProfileDll, x86tool } from '../build/pipeline.mjs';

export function crtRegistry() {
  const source = readFileSync(join(ROOT, 'platforms/win32/crt.def'), 'utf8');
  return [...source.matchAll(/CRT\("([^"]+)",\s*"([^"]+)",\s*(\w+)\)/g)]
    .map((m) => ({ name: m[1], group: m[2], status: m[3] === '0' ? 'stub' : 'implemented' }));
}

export function importStatus(name, dll, machine = 'x86-64') {
  if (!isProfileDll(dll)) return { status: 'unknown', group: null };
  if (machine === 'x86-64') {
    const crt = crtRegistry().find((e) => e.name === name);
    if (crt) return { status: crt.status, group: crt.group };
    const data = readFileSync(join(ROOT, 'platforms/win32/crt.def'), 'utf8');
    if ([...data.matchAll(/DATA\("([^"]+)"\)/g)].some((m) => m[1] === name)) {
      return { status: 'implemented', group: 'startup-data' };
    }
    const wide = readFileSync(join(ROOT, 'platforms/win32/w32_x64.c'), 'utf8');
    const names = [...wide.matchAll(/\{"([^"]+)",\w+\}/g),
      ...wide.matchAll(/w32_streqi\(name,"([^"]+)"\)/g)];
    if (names.some((m) => m[1] === name)) return { status: 'implemented', group: 'win64' };
  }
  /* LANE-GL: same explicit API registry as runtime dispatch. */
  for (const file of ['w32_kernel.c', 'w32_user.c', 'w32_gdi.c', 'w32_gl_api.h']) {
    const source = readFileSync(join(ROOT, 'platforms/win32', file), 'utf8');
    for (const m of source.matchAll(/\b(API|CAPI|DATAI|STUB|CSTUB|GLSTUB)\("([^"]+)"/g)) {
      if (m[2] === name) return { status: m[1].includes('STUB') ? 'stub' : 'implemented', group: 'win32' };
    }
  }
  return { status: 'unknown', group: null };
}

export function importsCoverage(file) {
  const pe = JSON.parse(execFileSync(x86tool(), ['analyze', file], { encoding: 'utf8', maxBuffer: 256 << 20 }));
  const imports = pe.imports.map(({ dll, name }) => ({ dll, name, ...importStatus(name, dll, pe.machine) }));
  const totals = { implemented: 0, stub: 0, unknown: 0 };
  for (const i of imports) totals[i.status]++;
  return { schema: 'game-cask/imports-coverage/1', machine: pe.machine, imports, totals };
}
