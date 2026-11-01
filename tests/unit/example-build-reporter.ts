import type { Reporter, TestSpecification } from 'vitest/node';
import { buildTestExamples } from './global-setup';

// Build before timed hooks/tests, without importing test files to discover dependencies.
export default class ExampleBuildReporter implements Reporter {
  onTestRunStart(specifications: ReadonlyArray<TestSpecification>): void {
    buildTestExamples([...new Set(specifications.map((s) => s.moduleId))]);
  }
}
