import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tools/bench/k72.test.ts'],testTimeout:7200000,fileParallelism:false,execArgv:['--experimental-wasm-jspi']}});
