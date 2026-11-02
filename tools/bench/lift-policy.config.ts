import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tools/bench/lift-policy.test.ts'], testTimeout: 1800000, fileParallelism: false },
});
