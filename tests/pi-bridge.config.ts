import { defineConfig } from 'vitest/config';

// Fast, no-model bridge-only loop; the same tests are included in the full npm test suite.
export default defineConfig({ test: { include: ['tests/unit/pi-bridge.test.ts'], testTimeout: 10000 } });
