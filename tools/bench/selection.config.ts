import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tools/bench/selection.test.ts'],testTimeout:3600000,fileParallelism:false}});
