import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tools/bench/k36-prepare.test.ts'], testTimeout: 1800000, fileParallelism: false, execArgv: ['--experimental-wasm-jspi'] } });
