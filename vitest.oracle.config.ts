import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['tests/oracle/**/*.test.ts'], testTimeout: 600000 } });
