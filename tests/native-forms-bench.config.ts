import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/native-forms.bench.ts'], testTimeout: 600000 } });
