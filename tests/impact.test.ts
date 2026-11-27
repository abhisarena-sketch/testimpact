import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyze, type ImpactReport, type Recommendation } from '@testimpact/core';
import { copyFixtureToGit, fixturePath, git, removeTemp, writeFiles } from './helpers/fixture.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) removeTemp(dirs.pop() as string);
});

function gitFixture(name: string): string {
  const dir = copyFixtureToGit(name);
  dirs.push(dir);
  return dir;
}

const byTest = (report: ImpactReport) => Object.fromEntries(report.recommendations.map((r) => [r.testFile, r])) as Record<string, Recommendation>;
const confidences = (report: ImpactReport) => Object.fromEntries(report.recommendations.map((r) => [r.testFile, r.confidence]));

function editLine(dir: string, file: string, search: string, replace: string): void {
  const abs = path.join(dir, file);
  const text = fs.readFileSync(abs, 'utf8');
  if (!text.includes(search)) throw new Error(`"${search}" not found in ${file}`);
  fs.writeFileSync(abs, text.replace(search, replace));
}

describe('impact analysis: explicit files', () => {
  const root = fixturePath('web-app');

  it('ranks direct, barrel and transitive dependents with explanations', async () => {
    const report = await analyze({ root, source: { kind: 'files', paths: ['src/auth/login.ts'] }, cache: false });
    expect(confidences(report)).toEqual({
      'src/auth/login.test.ts': 'high',
      'tests/integration/auth.integration.test.ts': 'high',
      'tests/integration/session.flow.test.ts': 'high',
      'src/components/LoginForm.test.tsx': 'medium',
      'src/pages/lazy.test.ts': 'medium',
    });
    const [first] = report.recommendations;
    expect(first).toMatchObject({
      id: 'TEST-001',
      testFile: 'src/auth/login.test.ts',
      reason: 'Directly imports the changed file src/auth/login.ts',
      changedFiles: ['src/auth/login.ts'],
      dependencyPath: ['src/auth/login.ts', 'src/auth/login.test.ts'],
      selected: true,
    });
    const integration = byTest(report)['tests/integration/auth.integration.test.ts'];
    expect(integration?.dependencyPath).toEqual(['src/auth/login.ts', 'src/auth/index.ts', 'tests/integration/auth.integration.test.ts']);
    expect(integration?.testKind).toBe('integration');
    const lazy = byTest(report)['src/pages/lazy.test.ts'];
    expect(lazy?.signals.map((s) => s.type)).toContain('dynamic-import');
    // Tests that do not depend on login.ts are not recommended (false-positive control).
    for (const t of ['src/utils/crypto.test.ts', 'tests/unrelated.test.ts', 'src/cycle/a.test.ts', 'src/auth/session.test.ts']) {
      expect(byTest(report)[t]).toBeUndefined();
    }
    expect(report.summary).toMatchObject({ totalTests: 13, candidates: 5, selected: 5, high: 3, medium: 2, low: 0 });
    expect(report.runCommands).toEqual([
      expect.objectContaining({ framework: 'vitest', command: 'npx', testCount: 5 }),
    ]);
  });

  it('increases dependency distance for deeper dependencies and lowers the score', async () => {
    const report = await analyze({ root, source: { kind: 'files', paths: ['src/utils/crypto.ts'] }, cache: false });
    const recs = byTest(report);
    expect(recs['src/utils/crypto.test.ts']?.confidence).toBe('high');
    expect(recs['src/auth/__tests__/token.test.ts']?.confidence).toBe('medium');
    expect(recs['src/auth/__tests__/token.test.ts']?.distance).toBe(2);
    expect(recs['src/auth/login.test.ts']?.distance).toBe(4);
    expect(recs['src/auth/__tests__/token.test.ts']!.score).toBeGreaterThan(recs['src/auth/login.test.ts']!.score);
    const ids = report.recommendations.map((r) => r.testFile);
    expect(ids.indexOf('src/auth/__tests__/token.test.ts')).toBeLessThan(ids.indexOf('src/auth/login.test.ts'));
  });

  it('handles circular dependencies without looping', async () => {
    const report = await analyze({ root, source: { kind: 'files', paths: ['src/cycle/b.ts'] }, cache: false });
    expect(confidences(report)).toEqual({ 'src/cycle/a.test.ts': 'medium' });
    expect(report.stats.cycles).toBe(1);
  });

  it('caps type-only dependencies at medium confidence', async () => {
    const report = await analyze({ root, source: { kind: 'files', paths: ['src/types.ts'] }, cache: false });
    const login = byTest(report)['src/auth/login.test.ts'];
    expect(login?.confidence).toBe('medium');
    expect(login?.signals[0]?.type).toBe('type-only');
  });

  it('uses manual mappings, naming conventions and file mentions with appropriate confidence', async () => {
    const report = await analyze({ root, source: { kind: 'files', paths: ['src/legacy/report.ts', 'src/naming/widget.ts', 'src/data/fixtures.json'] }, cache: false });
    expect(confidences(report)).toEqual({
      'tests/legacy-report-suite.test.ts': 'high',
      'src/naming/widget.test.ts': 'low',
      'tests/data.test.ts': 'low',
    });
    expect(byTest(report)['tests/legacy-report-suite.test.ts']?.reason).toMatch(/Manual mapping: Legacy report suite/);
    // Low-confidence candidates are listed but not selected at the default "medium" threshold.
    expect(report.selection.selectedTests).toEqual(['tests/legacy-report-suite.test.ts']);
    const widget = report.change.files.find((f) => f.path === 'src/naming/widget.ts');
    expect(widget?.notes.join(' ')).toMatch(/No test imports this file/);
  });

  it('flags tests that may load a changed file through a computed dynamic import', async () => {
    const report = await analyze({ root, source: { kind: 'files', paths: ['src/locales/en.json'] }, cache: false });
    const lazy = byTest(report)['src/pages/lazy.test.ts'];
    expect(lazy?.confidence).toBe('low');
    expect(lazy?.signals[0]?.type).toBe('dynamic-pattern');
  });

  it('recommends the full suite when a setup file or project configuration changes', async () => {
    const setup = await analyze({ root, source: { kind: 'files', paths: ['tests/setup.ts'] }, cache: false });
    expect(setup.selection.fullSuiteRecommended).toBe(true);
    expect(setup.summary.selected).toBe(setup.summary.totalTests);
    expect(new Set(setup.recommendations.map((r) => r.confidence))).toEqual(new Set(['high']));
    const pkg = await analyze({ root, source: { kind: 'files', paths: ['package.json'] }, cache: false });
    expect(pkg.selection.fullSuiteRecommended).toBe(true);
    expect(pkg.change.files[0]?.kind).toBe('config');
    expect(pkg.recommendations.every((r) => r.confidence === 'medium')).toBe(true);
    expect(pkg.warnings.join('\n')).toMatch(/Full test suite recommended/);
  });

  it('supports selection modes and thresholds without silently excluding tests', async () => {
    const files = { kind: 'files' as const, paths: ['src/legacy/report.ts', 'src/naming/widget.ts'] };
    const full = await analyze({ root, source: files, mode: 'full', cache: false });
    expect(full.summary.selected).toBe(full.summary.totalTests);
    expect(full.allTests.every((t) => t.selected)).toBe(true);
    const all = await analyze({ root, source: files, mode: 'all-candidates', cache: false });
    expect(all.selection.selectedTests.sort()).toEqual(['src/naming/widget.test.ts', 'tests/legacy-report-suite.test.ts']);
    const strict = await analyze({ root, source: { kind: 'files', paths: ['src/auth/login.ts'] }, threshold: 'high', cache: false });
    expect(strict.summary.selected).toBe(3);
    // Every discovered test is listed in allTests, selected or not.
    expect(strict.allTests).toHaveLength(13);
  });

  it('analyses directories', async () => {
    const report = await analyze({ root, source: { kind: 'files', paths: ['src/cycle/'] }, cache: false });
    expect(report.change.files.map((f) => f.path)).toEqual(['src/cycle/a.test.ts', 'src/cycle/a.ts', 'src/cycle/b.ts']);
    expect(byTest(report)['src/cycle/a.test.ts']?.signals[0]?.type).toBe('changed-test');
  });

  it('honours maxDepth', async () => {
    const report = await analyze({
      root,
      source: { kind: 'files', paths: ['src/utils/crypto.ts'] },
      config: (await import('@testimpact/core')).parseConfig({ testFramework: 'vitest', analysis: { maxDepth: 2 } }),
      cache: false,
    });
    expect(Object.keys(confidences(report)).sort()).toEqual(['src/auth/__tests__/token.test.ts', 'src/utils/crypto.test.ts']);
    expect(report.warnings.join()).toMatch(/maxDepth/);
  });

  it('rejects paths outside the project root', async () => {
    await expect(analyze({ root, source: { kind: 'files', paths: ['../../package.json'] }, cache: false })).rejects.toThrow(/outside the project root/);
  });
});

describe('impact analysis: Git changes', () => {
  it('narrows to changed exports (symbol-level analysis)', async () => {
    const dir = gitFixture('web-app');
    editLine(dir, 'src/auth/login.ts', 'export function logout(): void {}', 'export function logout(): void {\n  console.log("bye");\n}');
    const report = await analyze({ root: dir, source: { kind: 'uncommitted' }, cache: false });
    expect(report.change.files[0]).toMatchObject({ path: 'src/auth/login.ts', changedExports: ['logout'] });
    // login.test.ts only imports `login`, which did not change: listed, but as a low-confidence candidate.
    const login = byTest(report)['src/auth/login.test.ts'];
    expect(login?.confidence).toBe('low');
    expect(login?.signals[0]?.type).toBe('unaffected-symbols');
    expect(login?.selected).toBe(false);
    expect(report.summary.selected).toBe(0);

    editLine(dir, 'src/auth/login.ts', "await post('/login', user);", "await post('/v2/login', user);");
    const second = await analyze({ root: dir, source: { kind: 'uncommitted' }, cache: false });
    expect(second.change.files[0]?.changedExports).toEqual(['login', 'logout']);
    expect(byTest(second)['src/auth/login.test.ts']).toMatchObject({ confidence: 'high', changedSymbols: ['login'] });
    expect(byTest(second)['tests/integration/auth.integration.test.ts']?.confidence).toBe('high');
  });

  it('detects staged changes only', async () => {
    const dir = gitFixture('web-app');
    editLine(dir, 'src/utils/format.ts', 'slice(0, 10)', 'slice(0, 11)');
    editLine(dir, 'src/cycle/b.ts', 'n <= 0 ? 1', 'n <= 0 ? 2');
    git(dir, 'add', 'src/cycle/b.ts');
    const report = await analyze({ root: dir, source: { kind: 'staged' }, cache: false });
    expect(report.change.files.map((f) => f.path)).toEqual(['src/cycle/b.ts']);
    expect(Object.keys(confidences(report))).toEqual(['src/cycle/a.test.ts']);
  });

  it('finds tests affected by a deleted file', async () => {
    const dir = gitFixture('web-app');
    git(dir, 'rm', '-q', 'src/auth/token.ts');
    const report = await analyze({ root: dir, source: { kind: 'staged' }, cache: false });
    const change = report.change.files[0];
    expect(change).toMatchObject({ path: 'src/auth/token.ts', status: 'deleted' });
    expect(change?.notes.join(' ')).toMatch(/still import/);
    const recs = confidences(report);
    expect(recs['src/auth/__tests__/token.test.ts']).toBe('high');
    expect(recs['src/auth/session.test.ts']).toBe('medium');
  });

  it('finds tests affected by a renamed file through its old and new paths', async () => {
    const dir = gitFixture('web-app');
    git(dir, 'mv', 'src/utils/format.ts', 'src/utils/date-format.ts');
    const report = await analyze({ root: dir, source: { kind: 'staged' }, cache: false });
    expect(report.change.files[0]).toMatchObject({ path: 'src/utils/date-format.ts', status: 'renamed', oldPath: 'src/utils/format.ts' });
    const recs = confidences(report);
    // Importers still reference the old path, so their tests are affected.
    expect(recs['tests/unrelated.test.ts']).toBe('high');
    expect(recs['src/components/LoginForm.test.tsx']).toBe('medium');
  });

  it('recommends new and modified test files', async () => {
    const dir = gitFixture('web-app');
    writeFiles(dir, { 'src/auth/logout.test.ts': "import { logout } from './login';\nimport { it } from 'vitest';\nit('x', () => logout());\n" });
    const report = await analyze({ root: dir, source: { kind: 'uncommitted' }, cache: false });
    expect(byTest(report)['src/auth/logout.test.ts']).toMatchObject({ confidence: 'high', reason: 'Test file was changed' });
  });

  it('analyses changes against a base branch and in a specific commit', async () => {
    const dir = gitFixture('web-app');
    git(dir, 'checkout', '-q', '-b', 'feature');
    editLine(dir, 'src/cycle/a.ts', 'n <= 0 ? 0', 'n <= 0 ? -1');
    git(dir, 'commit', '-qam', 'change a');
    const base = await analyze({ root: dir, source: { kind: 'base', base: 'main' }, cache: false });
    expect(Object.keys(confidences(base))).toEqual(['src/cycle/a.test.ts']);
    const commit = await analyze({ root: dir, source: { kind: 'commit', commit: 'HEAD' }, cache: false });
    expect(commit.change.files.map((f) => f.path)).toEqual(['src/cycle/a.ts']);
  });

  it('reuses the parse cache for incremental analysis', async () => {
    const dir = gitFixture('web-app');
    const first = await analyze({ root: dir, source: { kind: 'uncommitted' } });
    expect(first.stats.filesParsed).toBeGreaterThan(20);
    expect(first.stats.filesReusedFromCache).toBe(0);
    expect(fs.existsSync(path.join(dir, '.testimpact/.gitignore'))).toBe(true);
    const second = await analyze({ root: dir, source: { kind: 'uncommitted' } });
    expect(second.stats.filesParsed).toBe(0);
    expect(second.stats.filesReusedFromCache).toBe(first.stats.filesParsed);
    editLine(dir, 'src/cycle/a.ts', 'n <= 0 ? 0', 'n <= 0 ? 5');
    const third = await analyze({ root: dir, source: { kind: 'uncommitted' } });
    expect(third.stats.filesParsed).toBe(1);
    expect(Object.keys(confidences(third))).toEqual(['src/cycle/a.test.ts']);
    // The cache directory is ignored, so it never shows up as a change.
    expect(third.change.files.map((f) => f.path)).toEqual(['src/cycle/a.ts']);
  });
});

describe('impact analysis: Jest and Node.js test runner projects', () => {
  it('follows require(), moduleNameMapper aliases and jest.mock references', async () => {
    const root = fixturePath('jest-app');
    const money = await analyze({ root, source: { kind: 'files', paths: ['lib/util/money.js'] }, cache: false });
    expect(confidences(money)).toEqual({
      'test/money.test.js': 'high',
      'lib/cart/__tests__/cart.js': 'medium',
      'lib/cart/tax.spec.js': 'medium',
    });
    expect(money.runCommands[0]?.commandLine).toBe('npx jest --runTestsByPath test/money.test.js lib/cart/__tests__/cart.js lib/cart/tax.spec.js');
    const tax = await analyze({ root, source: { kind: 'files', paths: ['lib/cart/tax.js'] }, cache: false });
    const spec = byTest(tax)['lib/cart/tax.spec.js'];
    expect(spec?.signals.map((s) => s.type)).toContain('mock-reference');
  });

  it('applies symbol-level narrowing to ES modules for node:test projects', async () => {
    const dir = gitFixture('node-app');
    editLine(dir, 'src/math.mjs', 'return a + b;', 'return b + a;');
    const report = await analyze({ root: dir, source: { kind: 'uncommitted' }, cache: false });
    expect(report.frameworks.map((f) => f.framework)).toEqual(['node']);
    expect(confidences(report)).toEqual({ 'test/stats.test.mjs': 'medium', 'test/math.test.mjs': 'low' });
    expect(byTest(report)['test/stats.test.mjs']?.changedSymbols).toEqual(['add']);
    expect(report.runCommands[0]?.commandLine).toBe('node --test test/stats.test.mjs');
  });
});
