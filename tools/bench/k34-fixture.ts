import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../../tests/support/headless';

export function k34WorkloadDir() {
  const dir = join(ROOT, 'node_modules/.cache/bgt/k34-workload');
  mkdirSync(dir, { recursive: true });
  cpSync(join(ROOT, 'tools/bench/k34-workload.c'), join(dir, 'workload.c'));
  writeFileSync(join(dir, 'game.json'), JSON.stringify({ id: 'k34-workload', name: 'CC0 K34 lifted bytecode workload', pipeline: {
    platform: 'win32', suspensionBuild: 'dual', fixture: { target: 'x86_64-windows-gnu', crt: true,
      sources: ['workload.c'], out: 'workload.exe', libs: ['kernel32', 'user32'] },
    modules: [{ from: './build/workload.exe', main: true }],
  }}));
  return dir;
}
