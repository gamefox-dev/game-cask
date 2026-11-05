import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tools/bench/present-accounting.test.ts'],testTimeout:600000,fileParallelism:false,execArgv:['--experimental-wasm-jspi']}});
