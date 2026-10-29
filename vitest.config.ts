import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    globalSetup: ['tests/unit/global-setup.ts'],
    testTimeout: 60000,
  },
});
