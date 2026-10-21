import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    globalSetup: ['src/tests/globalSetup.ts'],
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});
