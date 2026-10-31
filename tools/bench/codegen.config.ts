import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tools/bench/codegen.test.ts'], testTimeout: 1200000, fileParallelism: false },
});
