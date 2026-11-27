import { afterEach, describe, expect, it } from 'vitest';
import { classifyTestKind, conventionalSourceCandidates, discoverTests, mapTestsByConvention, mappingsForSource, resolveManualMappings } from '@testimpact/test-discovery';
import { createTempProject, fixturePath, listFiles, removeTemp } from '../../../tests/helpers/fixture.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) removeTemp(dirs.pop() as string);
});

describe('discoverTests', () => {
  it('discovers Vitest tests using the project config include patterns', async () => {
    const root = fixturePath('web-app');
    const result = await discoverTests({ root, files: listFiles(root) });
    expect(result.defaultFramework).toBe('vitest');
    expect(result.tests.map((t) => t.path)).toEqual([
      'src/auth/__tests__/token.test.ts',
      'src/auth/login.test.ts',
      'src/auth/session.test.ts',
      'src/components/LoginForm.test.tsx',
      'src/cycle/a.test.ts',
      'src/naming/widget.test.ts',
      'src/pages/lazy.test.ts',
      'src/utils/crypto.test.ts',
      'tests/data.test.ts',
      'tests/integration/auth.integration.test.ts',
      'tests/integration/session.flow.test.ts',
      'tests/legacy-report-suite.test.ts',
      'tests/unrelated.test.ts',
    ]);
    expect(result.tests.find((t) => t.path.includes('auth.integration'))?.kind).toBe('integration');
    expect(result.setupFiles).toEqual(['tests/setup.ts']);
    expect(result.aliases).toEqual({ '~utils': './src/utils' });
  });

  it('discovers Jest tests including __tests__ directories and .spec files', async () => {
    const root = fixturePath('jest-app');
    const result = await discoverTests({ root, files: listFiles(root) });
    expect(result.defaultFramework).toBe('jest');
    expect(result.tests.map((t) => t.path)).toEqual(['lib/cart/__tests__/cart.js', 'lib/cart/tax.spec.js', 'test/money.test.js']);
  });

  it('discovers Node.js test runner tests', async () => {
    const root = fixturePath('node-app');
    const result = await discoverTests({ root, files: listFiles(root) });
    expect(result.tests.map((t) => [t.path, t.framework])).toEqual([
      ['test/math.test.mjs', 'node'],
      ['test/stats.test.mjs', 'node'],
    ]);
  });

  it('honours explicit test patterns, overrides and mixed frameworks', async () => {
    const dir = createTempProject({
      'package.json': JSON.stringify({ devDependencies: { vitest: '1', jest: '1' } }),
      'a.test.ts': "import { it } from 'vitest';",
      'b.test.ts': "jest.mock('./x');",
      'legacy/c.check.ts': '',
      'legacy/d.test.ts': '',
    });
    dirs.push(dir);
    const files = listFiles(dir);
    const mixed = await discoverTests({ root: dir, files, overrides: [{ files: ['legacy/**'], testFramework: 'node' }] });
    expect(mixed.tests.map((t) => [t.path, t.framework, t.frameworkSource])).toEqual([
      ['a.test.ts', 'vitest', 'source'],
      ['b.test.ts', 'jest', 'source'],
      ['legacy/d.test.ts', 'node', 'override'],
    ]);
    const explicit = await discoverTests({ root: dir, files, framework: 'vitest', testPatterns: ['**/*.check.ts'] });
    expect(explicit.tests.map((t) => t.path)).toEqual(['legacy/c.check.ts']);
  });

  it('warns when no framework can be detected', async () => {
    const dir = createTempProject({ 'x.test.ts': '' });
    dirs.push(dir);
    const result = await discoverTests({ root: dir, files: listFiles(dir) });
    expect(result.tests).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/No test framework detected/);
  });
});

describe('test kind classification', () => {
  it.each([
    ['src/a.test.ts', 'unit'],
    ['tests/integration/a.test.ts', 'integration'],
    ['src/a.int.test.ts', 'integration'],
    ['e2e/login.spec.ts', 'e2e'],
    ['src/split.test.ts', 'unit'],
  ])('%s is %s', (p, kind) => expect(classifyTestKind(p)).toBe(kind));
});

describe('naming convention mapping', () => {
  it('generates conventional candidates', () => {
    expect(conventionalSourceCandidates('src/auth/login.test.ts')).toEqual(['src/auth/login']);
    expect(conventionalSourceCandidates('src/auth/__tests__/token.test.ts')).toEqual(['src/auth/__tests__/token', 'src/auth/token']);
    expect(conventionalSourceCandidates('tests/auth/login.spec.ts')).toContain('src/auth/login');
  });

  it('maps tests to sources by name', () => {
    const map = mapTestsByConvention(
      ['src/auth/login.test.ts', 'tests/auth/session.spec.ts', 'src/naming/widget.test.ts', 'tests/auth.test.ts', 'src/orphan.test.ts'],
      ['src/auth/login.ts', 'src/auth/session.ts', 'src/naming/widget.ts', 'src/auth/index.ts', 'src/auth/login.test.ts'],
    );
    expect(Object.fromEntries(map)).toEqual({
      'src/auth/login.test.ts': ['src/auth/login.ts'],
      'tests/auth/session.spec.ts': ['src/auth/session.ts'],
      'src/naming/widget.test.ts': ['src/naming/widget.ts'],
      'tests/auth.test.ts': ['src/auth/index.ts'],
    });
  });
});

describe('manual mappings', () => {
  it('resolves test globs and finds mappings for a source file', () => {
    const resolved = resolveManualMappings(
      [
        { source: ['src/legacy/**'], tests: ['tests/legacy-*.test.ts'], reason: 'legacy suite' },
        { source: ['src/other.ts'], tests: ['tests/missing/**'] },
      ],
      ['tests/legacy-report.test.ts', 'tests/a.test.ts'],
    );
    expect(resolved[0]).toMatchObject({ tests: ['tests/legacy-report.test.ts'], reason: 'legacy suite', unmatchedTestPatterns: [] });
    expect(resolved[1]?.unmatchedTestPatterns).toEqual(['tests/missing/**']);
    expect(mappingsForSource('src/legacy/report.ts', resolved).map((m) => m.index)).toEqual([0]);
    expect(mappingsForSource('src/new.ts', resolved)).toEqual([]);
  });
});
