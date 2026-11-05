import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tools/bench/accounting.test.ts'],testTimeout:3600000,fileParallelism:false,execArgv:['--experimental-wasm-jspi']}});
