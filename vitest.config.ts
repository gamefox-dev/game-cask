import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // LANE-K4b: report/oracle tooling regressions also run in the default kit suite.
    include: ['tests/unit/**/*.test.ts', 'tests/oracle/tooling.test.ts', 'tests/oracle/failures.test.ts'],
    globalSetup: ['tests/unit/global-setup.ts'],
    reporters: [['default'], ['./tests/unit/example-build-reporter.ts']],
    testTimeout: 60000,
  },
});
