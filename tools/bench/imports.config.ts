import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tools/bench/imports.test.ts'], testTimeout: 1800000, maxWorkers: 1 } });
