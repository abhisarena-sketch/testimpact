import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertSafeRef, detectGitChanges, parseChangedLines, parseNameStatus } from '@testimpact/core';
import { commitAll, createGitProject, git, removeTemp, writeFiles } from '../../../tests/helpers/fixture.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) removeTemp(dirs.pop() as string);
});

function project(files: Record<string, string>): string {
  const dir = createGitProject(files);
  dirs.push(dir);
  return dir;
}

const base = {
  'src/a.ts': 'export const a = 1;\nexport function f() {\n  return 1;\n}\n',
  'src/b.ts': 'export const b = 2;\n',
  'src/old-name.ts': 'export const moved = true;\n// padding line one\n// padding line two\n// padding line three\n',
  'README.md': '# demo\n',
};

describe('parseNameStatus', () => {
  it('parses modifications, deletions and renames from -z output', () => {
    const out = ['M', 'src/a.ts', 'D', 'src/b.ts', 'R087', 'src/x.ts', 'src/y.ts', 'A', 'new file.ts', ''].join('\0');
    expect(parseNameStatus(out)).toEqual([
      { status: 'modified', path: 'src/a.ts' },
      { status: 'deleted', path: 'src/b.ts' },
      { status: 'renamed', path: 'src/y.ts', oldPath: 'src/x.ts' },
      { status: 'added', path: 'new file.ts' },
    ]);
  });
});

describe('parseChangedLines', () => {
  it('extracts new-side ranges, including pure deletions', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -2,0 +3,2 @@',
      '+x',
      '+y',
      '@@ -10 +12 @@',
      '@@ -20,3 +21,0 @@',
    ].join('\n');
    expect(parseChangedLines(diff).get('src/a.ts')).toEqual([
      { start: 3, end: 4 },
      { start: 12, end: 12 },
      { start: 21, end: 22 },
    ]);
  });
});

describe('assertSafeRef', () => {
  it.each(['main', 'origin/main', 'HEAD~2', 'v1.2.3', 'abc123', 'feature/x-y_z', 'HEAD^'])('accepts %s', (ref) => {
    expect(() => assertSafeRef(ref)).not.toThrow();
  });
  it.each(['--output=/tmp/x', '-p', 'main;rm -rf /', 'a b', '$(whoami)', 'a..b', ''])('rejects %s', (ref) => {
    expect(() => assertSafeRef(ref)).toThrow(/Invalid/);
  });
});

describe('detectGitChanges', () => {
  it('detects unstaged, staged and untracked changes as uncommitted', async () => {
    const dir = project(base);
    writeFiles(dir, { 'src/a.ts': 'export const a = 2;\nexport function f() {\n  return 1;\n}\n', 'src/new.ts': 'export {}\n' });
    writeFiles(dir, { 'src/b.ts': 'export const b = 3;\n' });
    git(dir, 'add', 'src/b.ts');
    const { changes } = await detectGitChanges({ root: dir, source: { kind: 'uncommitted' } });
    expect(changes).toEqual([
      { path: 'src/a.ts', status: 'modified', changedLines: [{ start: 1, end: 1 }] },
      { path: 'src/b.ts', status: 'modified', changedLines: [{ start: 1, end: 1 }] },
      { path: 'src/new.ts', status: 'untracked' },
    ]);
  });

  it('detects only staged changes with the staged source', async () => {
    const dir = project(base);
    writeFiles(dir, { 'src/a.ts': 'changed\n', 'src/b.ts': 'changed\n' });
    git(dir, 'add', 'src/b.ts');
    const { changes } = await detectGitChanges({ root: dir, source: { kind: 'staged' } });
    expect(changes.map((c) => c.path)).toEqual(['src/b.ts']);
  });

  it('detects renamed and deleted files', async () => {
    const dir = project(base);
    git(dir, 'mv', 'src/old-name.ts', 'src/new-name.ts');
    git(dir, 'rm', '-q', 'src/b.ts');
    const { changes } = await detectGitChanges({ root: dir, source: { kind: 'staged' } });
    expect(changes).toEqual([
      { path: 'src/b.ts', status: 'deleted' },
      { path: 'src/new-name.ts', status: 'renamed', oldPath: 'src/old-name.ts' },
    ]);
  });

  it('detects changes against a base branch using the merge base', async () => {
    const dir = project(base);
    git(dir, 'checkout', '-q', '-b', 'feature');
    writeFiles(dir, { 'src/a.ts': 'export const a = 42;\n' });
    commitAll(dir, 'feature change');
    git(dir, 'checkout', '-q', 'main');
    writeFiles(dir, { 'src/b.ts': 'export const b = 99;\n' });
    commitAll(dir, 'main change');
    git(dir, 'checkout', '-q', 'feature');
    const { changes, description } = await detectGitChanges({ root: dir, source: { kind: 'base', base: 'main' } });
    // Changes made on main after the branch point are not attributed to the feature branch.
    expect(changes.map((c) => c.path)).toEqual(['src/a.ts']);
    expect(description).toContain('main');
  });

  it('detects changes in a specific commit and between commits', async () => {
    const dir = project(base);
    writeFiles(dir, { 'src/a.ts': 'export const a = 5;\n' });
    commitAll(dir, 'second');
    writeFiles(dir, { 'src/b.ts': 'export const b = 5;\n' });
    commitAll(dir, 'third');
    const commit = await detectGitChanges({ root: dir, source: { kind: 'commit', commit: 'HEAD~1' } });
    expect(commit.changes.map((c) => c.path)).toEqual(['src/a.ts']);
    const range = await detectGitChanges({ root: dir, source: { kind: 'range', from: 'HEAD~2', to: 'HEAD' } });
    expect(range.changes.map((c) => c.path)).toEqual(['src/a.ts', 'src/b.ts']);
    const root = await detectGitChanges({ root: dir, source: { kind: 'commit', commit: 'HEAD~2' } });
    expect(root.changes.map((c) => c.path)).toEqual(['README.md', 'src/a.ts', 'src/b.ts', 'src/old-name.ts']);
  });

  it('reports paths relative to a project root inside the repository', async () => {
    const dir = project({ 'packages/app/src/x.ts': 'export {}\n', 'other/y.ts': 'export {}\n' });
    writeFiles(dir, { 'packages/app/src/x.ts': 'export const x = 1\n', 'other/y.ts': 'export const y = 1\n' });
    const result = await detectGitChanges({ root: path.join(dir, 'packages/app'), source: { kind: 'uncommitted' } });
    expect(result.changes.map((c) => c.path)).toEqual(['src/x.ts']);
    expect(result.warnings.join()).toMatch(/outside the project root/);
  });

  it('rejects unknown and unsafe revisions', async () => {
    const dir = project(base);
    await expect(detectGitChanges({ root: dir, source: { kind: 'base', base: 'does-not-exist' } })).rejects.toThrow(/Unknown base/);
    await expect(detectGitChanges({ root: dir, source: { kind: 'base', base: '--upload-pack=evil' } })).rejects.toThrow(/Invalid/);
  });

  it('handles a repository without commits', async () => {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ti-empty-'));
    dirs.push(dir);
    git(dir, 'init', '-q');
    writeFiles(dir, { 'a.ts': 'export {}\n', 'b.ts': 'export {}\n' });
    git(dir, 'add', 'a.ts');
    const result = await detectGitChanges({ root: dir, source: { kind: 'uncommitted' } });
    expect(result.changes).toEqual([
      { path: 'a.ts', status: 'added' },
      { path: 'b.ts', status: 'untracked' },
    ]);
  });

  it('fails clearly outside a Git repository', async () => {
    const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ti-nogit-'));
    dirs.push(dir);
    await expect(detectGitChanges({ root: dir, source: { kind: 'staged' } })).rejects.toThrow(/Not a Git repository/);
  });
});
