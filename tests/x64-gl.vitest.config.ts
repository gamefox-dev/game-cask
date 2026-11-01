// Lane-local focused runner; use the same lazy fixture hook as the default suite.
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/unit/x64-gl*.test.ts'], reporters: [['default'], ['./tests/unit/example-build-reporter.ts']], testTimeout: 180_000 } });
