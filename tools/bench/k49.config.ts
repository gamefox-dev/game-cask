import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tools/bench/k49.test.ts'],testTimeout:1800000,maxWorkers:1,execArgv:['--experimental-wasm-jspi']}});
