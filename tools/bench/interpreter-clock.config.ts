import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tools/bench/interpreter-clock.test.ts'],fileParallelism:false}});
