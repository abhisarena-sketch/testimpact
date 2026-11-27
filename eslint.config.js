import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      'tests/fixtures/**',
      'examples/**',
      'apps/playground/next-env.d.ts',
      '.bench/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly' },
    },
    rules: {
      // Security: TestImpact never evaluates code.
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-imports': ['error', { paths: [{ name: 'node:vm', message: 'TestImpact must not execute project code.' }, { name: 'vm', message: 'TestImpact must not execute project code.' }] }],
      'no-restricted-properties': ['error', { object: 'child_process', property: 'exec', message: 'Use execFile without a shell.' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
