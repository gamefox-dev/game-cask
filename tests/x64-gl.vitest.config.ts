// Lane-local focused runner; use the same lazy fixture hook as the default suite.
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/unit/x64-gl*.test.ts'], globalSetup: ['tests/unit/global-setup.ts'], testTimeout: 180_000 } });
