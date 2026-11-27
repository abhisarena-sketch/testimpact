import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '~utils': './src/utils',
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
  },
});
