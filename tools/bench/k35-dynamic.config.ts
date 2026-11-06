import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tools/bench/k35-dynamic.test.ts'], testTimeout: 180000, fileParallelism: false, execArgv: ['--experimental-wasm-jspi'] } });
