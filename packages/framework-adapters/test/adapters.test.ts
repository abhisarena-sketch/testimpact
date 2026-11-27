import { afterEach, describe, expect, it } from 'vitest';
import { detectFrameworks, jestAdapter, nodeTestAdapter, readPackageJson, readStaticConfigObject, vitestAdapter, type ProjectContext } from '@testimpact/framework-adapters';
import { createTempProject, fixturePath, listFiles, removeTemp } from '../../../tests/helpers/fixture.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) removeTemp(dirs.pop() as string);
});

function ctxFor(root: string): ProjectContext {
  return { root, files: listFiles(root), packageJson: readPackageJson(root) };
}

function temp(files: Record<string, string>): ProjectContext {
  const dir = createTempProject(files);
  dirs.push(dir);
  return ctxFor(dir);
}

describe('framework detection', () => {
  it('detects Vitest, Jest and the Node.js test runner from project evidence', () => {
    expect(detectFrameworks(ctxFor(fixturePath('web-app'))).map((d) => d.framework)).toEqual(['vitest']);
    expect(detectFrameworks(ctxFor(fixturePath('jest-app'))).map((d) => d.framework)).toEqual(['jest']);
    expect(detectFrameworks(ctxFor(fixturePath('node-app'))).map((d) => d.framework)).toEqual(['node']);
    expect(detectFrameworks(temp({ 'package.json': '{}' }))).toEqual([]);
  });

  it('sniffs the framework from test source', () => {
    expect(vitestAdapter.sniff("import { it } from 'vitest'")).toBe(true);
    expect(jestAdapter.sniff("jest.mock('./x')")).toBe(true);
    expect(nodeTestAdapter.sniff("import { test } from 'node:test'")).toBe(true);
    expect(nodeTestAdapter.sniff("import { test } from 'vitest'")).toBe(false);
  });

  it('builds run commands for selected files', () => {
    expect(vitestAdapter.runCommand(['a.test.ts'])).toEqual({ command: 'npx', args: ['vitest', 'run', 'a.test.ts'] });
    expect(jestAdapter.runCommand(['a.test.ts'])).toEqual({ command: 'npx', args: ['jest', '--runTestsByPath', 'a.test.ts'] });
    expect(nodeTestAdapter.runCommand(['a.test.mjs'])).toEqual({ command: 'node', args: ['--test', 'a.test.mjs'] });
  });
});

describe('static configuration reading', () => {
  it('reads the fixture vitest config without executing it', () => {
    const config = vitestAdapter.readConfig(ctxFor(fixturePath('web-app')));
    expect(config.configFile).toBe('vitest.config.ts');
    expect(config.include?.globs).toEqual(['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts']);
    expect(config.aliases).toEqual({ '~utils': './src/utils' });
    expect(config.setupFiles).toEqual(['tests/setup.ts']);
    expect(config.warnings).toEqual([]);
  });

  it('understands common path helpers and alias arrays', () => {
    const ctx = temp({
      'vite.config.mjs': `
        import { fileURLToPath, URL } from 'node:url';
        import path from 'node:path';
        const SRC = 'src';
        export default defineConfig(({ mode }) => ({
          resolve: { alias: [
            { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
            { find: /^#lib\\/(.*)/, replacement: path.resolve(__dirname, 'lib/$1') },
            { find: 'dyn', replacement: computeAlias() },
          ] },
          test: { include: [\`\${SRC}/**/*.spec.ts\`], setupFiles: './setup.ts' },
        }));
      `,
    });
    const config = vitestAdapter.readConfig(ctx);
    expect(config.aliases).toEqual({ '@': './src', '^#lib\\/(.*)': './lib/$1' });
    expect(config.include?.globs).toEqual(['src/**/*.spec.ts']);
    expect(config.setupFiles).toEqual(['setup.ts']);
    expect(config.warnings.join('\n')).toMatch(/could not be read statically/);
  });

  it('reads Vitest projects (inline and per-package configs)', () => {
    const ctx = temp({
      'vitest.config.ts': `export default defineConfig({ test: { projects: ['packages/*', { test: { name: 'unit', dir: 'tools', include: ['**/check.ts'] } }] } });`,
      'packages/a/vitest.config.ts': `export default defineConfig({ test: { include: ['src/**/test.ts'], setupFiles: ['./setup.ts'] } });`,
      'packages/a/src/x/test.ts': '',
      'packages/b/package.json': '{}',
    });
    const config = vitestAdapter.readConfig(ctx);
    expect(config.include?.globs).toEqual(['packages/a/src/**/test.ts', 'packages/b/**/*.{test,spec}.?(c|m)[jt]s?(x)', 'tools/**/check.ts']);
    expect(config.setupFiles).toEqual(['packages/a/setup.ts']);
  });

  it('reports configs that cannot be read statically', () => {
    const ctx = temp({ 'vitest.config.ts': 'export default await loadConfigFromSomewhere();' });
    const config = vitestAdapter.readConfig(ctx);
    expect(config.include).toBeUndefined();
    expect(config.warnings[0]).toMatch(/could not be read statically/);
  });

  it('reads Jest configuration from package.json', () => {
    const config = jestAdapter.readConfig(ctxFor(fixturePath('jest-app')));
    expect(config.configFile).toBe('package.json');
    expect(config.include?.globs).toHaveLength(2);
    expect(Object.keys(config.aliases)).toEqual(['^@app/(.*)$', '^(?:.*)\\.(css|less)$']);
  });

  it('reads jest.config.js with module.exports, roots and testRegex', () => {
    const ctx = temp({
      'jest.config.js': `module.exports = { roots: ['<rootDir>/src'], testRegex: '(/__tests__/.*|\\\\.check)\\\\.js$', setupFilesAfterEnv: ['<rootDir>/jest.setup.js'], moduleNameMapper: { '^~/(.*)$': '<rootDir>/src/$1' } };`,
    });
    const config = jestAdapter.readConfig(ctx);
    expect(config.include).toEqual({ globs: [], regexes: ['(/__tests__/.*|\\.check)\\.js$'], roots: ['src'] });
    expect(config.setupFiles).toEqual(['jest.setup.js']);
    expect(Object.keys(config.aliases)).toEqual(['^~/(.*)$']);
  });

  it('locates the config object behind an identifier', () => {
    const { value } = readStaticConfigObject('/x/jest.config.ts', `const config = { testMatch: ['**/*.check.ts'] }; export default config;`);
    expect(value).toEqual({ testMatch: ['**/*.check.ts'] });
  });
});
