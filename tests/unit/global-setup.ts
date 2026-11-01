// Kit fixtures only, never port/. Vitest's reporter records the ACTUAL scheduled
// specifications (including CLI filters, sharding, --related and API selections).
import { execFileSync } from 'node:child_process';
// @ts-expect-error plain ESM orchestration
import { testExamples } from '../../tools/build/test-examples.mjs';
// @ts-expect-error original CC0 native reference
import { nativeScale } from '../../tools/build/native-scale.mjs';

export function buildTestExamples(files: string[]): void {
  const targets = testExamples(files);
  console.log(`Test examples: ${targets.length ? targets.join(', ') : 'none'}`);
  if (targets.length) execFileSync(process.execPath, ['tools/build/build.mjs', ...targets], { stdio: 'inherit' });
  // Same principle as wasm fixture preparation: compile outside the test timer,
  // then retain every native checksum assertion inside the unchanged deadline.
  if (targets.includes('examples/x64-scale')) nativeScale();
}
// Called by the reporter on every run (also watch reruns), before the test pool.
export default function setup(): void {}
