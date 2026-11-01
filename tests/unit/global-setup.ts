// Kit fixtures only, never port/. Vitest's reporter records the ACTUAL scheduled
// specifications (including CLI filters, sharding, --related and API selections).
import { execFileSync } from 'node:child_process';
// @ts-expect-error plain ESM orchestration
import { testExamples } from '../../tools/build/test-examples.mjs';

export function buildTestExamples(files: string[]): void {
  const targets = testExamples(files);
  console.log(`Test examples: ${targets.length ? targets.join(', ') : 'none'}`);
  if (targets.length) execFileSync(process.execPath, ['tools/build/build.mjs', ...targets], { stdio: 'inherit' });
}
// Called by the reporter on every run (also watch reruns), before the test pool.
export default function setup(): void {}
