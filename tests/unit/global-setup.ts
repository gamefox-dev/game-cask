// Build before timed hooks using actual scheduled Vitest specifications. Never
// import test modules or parse argv; reporters must not control artifact freshness.
import { execFileSync } from 'node:child_process';
import type { TestProject } from 'vitest/node';
// @ts-expect-error plain ESM orchestration
import { testExamples } from '../../tools/build/test-examples.mjs';
// @ts-expect-error original CC0 native reference
import { nativeScale } from '../../tools/build/native-scale.mjs';

export function buildTestExamples(files: string[]): void {
  const targets = testExamples(files);
  console.log(`Test examples: ${targets.length ? targets.join(', ') : 'none'}`);
  if (targets.length) execFileSync(process.execPath, ['tools/build/build.mjs', ...targets], { stdio: 'inherit' });
  if (targets.includes('examples/x64-scale')) nativeScale();
}

export default function setup(project: TestProject): void {
  // Pinned Vitest 4.1.11 populates pathsSet before initializeGlobalSetup. This
  // includes CLI/API filters, exclusions and sharding, unlike globbing all files.
  buildTestExamples([...project.vitest.state.pathsSet]);
  // Global setup is initialized once; reruns supply their own exact spec list.
  project.onTestsRerun((specifications) => buildTestExamples(specifications.map((s) => s.moduleId)));
}
