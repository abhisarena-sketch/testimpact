import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractReportFromHtml, type ImpactReport } from '@testimpact/core';
import { main } from '../packages/cli/src/cli.js';
import { copyFixtureToGit, createTempProject, removeTemp, writeFiles } from './helpers/fixture.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) removeTemp(dirs.pop() as string);
});

async function run(cwd: string, ...argv: string[]) {
  let stdout = '';
  let stderr = '';
  const code = await main(argv, { stdout: (t) => void (stdout += t), stderr: (t) => void (stderr += t), cwd, env: {}, isTTY: false });
  return { code, stdout, stderr };
}

function project(): string {
  const dir = copyFixtureToGit('web-app');
  dirs.push(dir);
  return dir;
}

function touch(dir: string, file: string): void {
  fs.appendFileSync(path.join(dir, file), '\n// touched\n');
}

describe('testimpact CLI', () => {
  it('prints help and version', async () => {
    const dir = project();
    const help = await run(dir, '--help');
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('testimpact <command>');
    expect((await run(dir, '--version')).stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect((await run(dir)).code).toBe(2);
  });

  it('analyzes uncommitted changes, saves the report and explains a recommendation', async () => {
    const dir = project();
    touch(dir, 'src/auth/session.ts');
    const res = await run(dir, 'analyze');
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Recommended tests');
    expect(res.stdout).toContain('src/auth/session.test.ts');
    expect(fs.existsSync(path.join(dir, '.testimpact/last-report.json'))).toBe(true);

    const explain = await run(dir, 'explain', 'TEST-001');
    expect(explain.code).toBe(0);
    expect(explain.stdout).toContain('Dependency path');
    expect(explain.stdout).toContain('Evidence');
    expect((await run(dir, 'explain', '1')).stdout).toContain('TEST-001');
    const byPath = await run(dir, 'explain', 'src/auth/session.test.ts', '--format', 'json');
    expect(JSON.parse(byPath.stdout).testFile).toBe('src/auth/session.test.ts');
    const missing = await run(dir, 'explain', 'TEST-999');
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('No recommendation');
  });

  it('supports --files, --list, JSON and HTML output', async () => {
    const dir = project();
    const list = await run(dir, 'analyze', '--files', 'src/auth/login.ts', '--list', '--no-save');
    expect(list.stdout.trim().split('\n')).toEqual([
      'src/auth/login.test.ts',
      'src/components/LoginForm.test.tsx',
      'src/pages/lazy.test.ts',
      'tests/integration/auth.integration.test.ts',
      'tests/integration/session.flow.test.ts',
    ]);
    const json = await run(dir, 'analyze', '--files', 'src/auth/login.ts,src/cycle/b.ts', '--format', 'json', '--include-graph', '--no-save');
    const report = JSON.parse(json.stdout) as ImpactReport;
    expect(report.change.files.map((f) => f.path)).toEqual(['src/auth/login.ts', 'src/cycle/b.ts']);
    expect(report.graph?.edges.length).toBeGreaterThan(10);
    expect(report.recommendations[0]).toMatchObject({ id: 'TEST-001', confidence: 'high' });
    const html = await run(dir, 'analyze', '--files', 'src/auth/login.ts', '--format', 'html', '-o', 'out/report.html', '--no-save');
    expect(html.code).toBe(0);
    const htmlText = fs.readFileSync(path.join(dir, 'out/report.html'), 'utf8');
    expect(htmlText).toContain('<!doctype html>');
    expect(htmlText).not.toMatch(/<script src=|<link [^>]*href="http/);
    expect((extractReportFromHtml(htmlText) as ImpactReport).summary.candidates).toBe(5);
  });

  it('renders saved reports with the report command', async () => {
    const dir = project();
    expect((await run(dir, 'report')).code).toBe(2);
    await run(dir, 'analyze', '--files', 'src/cycle/b.ts');
    const html = await run(dir, 'report', '--format', 'html');
    expect(html.stdout).toContain('Test impact for');
    const out = await run(dir, 'report', '-o', 'r.json');
    expect(out.code).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'r.json'), 'utf8')).tool.name).toBe('testimpact');
  });

  it('supports selection modes and thresholds', async () => {
    const dir = project();
    const full = await run(dir, 'analyze', '--files', 'src/cycle/b.ts', '--mode', 'full', '--list', '--no-save');
    expect(full.stdout.trim().split('\n')).toHaveLength(13);
    const high = await run(dir, 'analyze', '--files', 'src/auth/login.ts', '--threshold', 'high', '--list', '--no-save');
    expect(high.stdout.trim().split('\n')).toHaveLength(3);
  });

  it('returns CI-friendly exit codes', async () => {
    const dir = project();
    expect((await run(dir, 'analyze', '--bogus')).code).toBe(2);
    expect((await run(dir, 'analyze', '--staged', '--base', 'main')).code).toBe(2);
    expect((await run(dir, 'analyze', '--mode', 'nope')).code).toBe(2);
    const badRef = await run(dir, 'analyze', '--base', 'no-such-branch');
    expect(badRef.code).toBe(2);
    expect(badRef.stderr).toContain('Unknown base branch');
    expect((await run(dir, 'analyze', '--files', 'package.json', '--fail-on-full-suite', '--no-save')).code).toBe(3);
    expect((await run(dir, 'analyze', '--files', 'src/naming/widget.ts', '--fail-on-untested', '--no-save')).code).toBe(0);
    writeFiles(dir, { 'src/orphan.ts': 'export const orphan = 1;\n' });
    expect((await run(dir, 'analyze', '--files', 'src/orphan.ts', '--fail-on-untested', '--no-save')).code).toBe(3);
    const nogit = createTempProject({ 'a.ts': '' });
    dirs.push(nogit);
    const res = await run(nogit, 'analyze');
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('Not a Git repository');
  });

  it('initialises and validates configuration', async () => {
    const dir = createTempProject({ 'package.json': JSON.stringify({ devDependencies: { jest: '30' } }) });
    dirs.push(dir);
    expect((await run(dir, 'config', 'validate')).stdout).toContain('No configuration file');
    const init = await run(dir, 'init');
    expect(init.code).toBe(0);
    const config = JSON.parse(fs.readFileSync(path.join(dir, 'testimpact.config.json'), 'utf8'));
    expect(config.testFramework).toBe('jest');
    expect((await run(dir, 'init')).code).toBe(2);
    expect((await run(dir, 'init', '--force', '--framework', 'vitest')).code).toBe(0);
    expect((await run(dir, 'config', 'validate')).stdout).toContain('is valid');
    fs.writeFileSync(path.join(dir, 'testimpact.config.json'), JSON.stringify({ confidenceThreshold: 'certain', unknown: true }));
    const invalid = await run(dir, 'config', 'validate');
    expect(invalid.code).toBe(2);
    expect(invalid.stderr).toContain('confidenceThreshold');
    fs.writeFileSync(path.join(dir, 'testimpact.config.json'), '{ broken');
    expect((await run(dir, 'config', 'validate')).code).toBe(2);
    expect((await run(dir, 'analyze', '--files', 'package.json')).code).toBe(2);
  });

  it('runs as a real binary from the build output', () => {
    const bin = path.resolve('packages/cli/dist/bin.js');
    if (!fs.existsSync(bin)) return; // build output is checked separately in CI
    const dir = project();
    const out = execFileSync(process.execPath, [bin, 'analyze', '--files', 'src/cycle/b.ts', '--list', '--no-save'], { cwd: dir, encoding: 'utf8' });
    expect(out.trim()).toBe('src/cycle/a.test.ts');
  });
});
