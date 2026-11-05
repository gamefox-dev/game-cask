import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../../tests/support/headless';

export function k34WorkloadDir() {
  const dir = join(ROOT, 'node_modules/.cache/bgt/k34-workload');
  mkdirSync(dir, { recursive: true });
  const source = process.env.BGT_K34_SUSTAINED === '1' ? 'k34-sustained-workload.c' : 'k34-workload.c';
  cpSync(join(ROOT, 'tools/bench', source), join(dir, 'workload.c'));
  const policy = {
    ...(process.env.BGT_K34_LIFT_INLINE_ALU === '1' ? { liftInlineAlu: true } : {}),
    ...(process.env.BGT_K34_LIFT_INLINE_MEMORY === '1' ? { liftInlineMemory: true } : {}),
  };
  writeFileSync(join(dir, 'game.json'), JSON.stringify({ id: 'k34-workload', name: 'CC0 K34 lifted bytecode workload', pipeline: {
    platform: 'win32', suspensionBuild: 'dual', ...policy, fixture: { target: 'x86_64-windows-gnu', crt: true,
      sources: ['workload.c'], out: 'workload.exe', libs: ['kernel32', 'user32'] },
    modules: [{ from: './build/workload.exe', main: true }],
  }}));
  return dir;
}
