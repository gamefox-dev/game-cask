// Lane-local focused runner; normal npm test still runs global fixture setup.
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/unit/x64-gl*.test.ts'], testTimeout: 180_000 } });
