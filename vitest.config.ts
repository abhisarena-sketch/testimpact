import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (name: string) => fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@testimpact/core': pkg('core'),
      '@testimpact/dependency-analyzer': pkg('dependency-analyzer'),
      '@testimpact/test-discovery': pkg('test-discovery'),
      '@testimpact/framework-adapters': pkg('framework-adapters'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'tests/fixtures/**', '**/dist/**'],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
  },
});
