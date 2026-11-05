import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tools/bench/attribution.test.ts'],testTimeout:7200000,fileParallelism:false}});
