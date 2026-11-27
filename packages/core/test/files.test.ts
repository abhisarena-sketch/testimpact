import { afterEach, describe, expect, it } from 'vitest';
import { createExcludeMatcher, discoverFiles } from '@testimpact/core';
import { createGitProject, createTempProject, removeTemp, writeFiles } from '../../../tests/helpers/fixture.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) removeTemp(dirs.pop() as string);
});

const tree = {
  'src/a.ts': '',
  'src/nested/b.tsx': '',
  'node_modules/pkg/index.js': '',
  'dist/a.js': '',
  'tests/a.test.ts': '',
  'docs/readme.md': '',
};

describe('createExcludeMatcher', () => {
  it('treats bare names as path segments and other entries as globs', () => {
    const m = createExcludeMatcher(['node_modules', 'src/generated', '**/*.snap']);
    expect(m('node_modules/x/y.js')).toBe(true);
    expect(m('packages/a/node_modules/x.js')).toBe(true);
    expect(m('src/generated/x.ts')).toBe(true);
    expect(m('src/a.test.ts.snap')).toBe(true);
    expect(m('src/generatedx.ts')).toBe(false);
    expect(m('src/a.ts')).toBe(false);
  });
});

describe('discoverFiles', () => {
  it('walks the filesystem honouring include and exclude', async () => {
    const dir = createTempProject(tree);
    dirs.push(dir);
    const result = await discoverFiles({ root: dir, include: ['src/**/*'], exclude: ['node_modules', 'dist'], alsoInclude: ['**/*.test.ts'] });
    expect(result.method).toBe('filesystem');
    expect(result.files).toEqual(['src/a.ts', 'src/nested/b.tsx', 'tests/a.test.ts']);
  });

  it('uses git ls-files and honours .gitignore', async () => {
    const dir = createGitProject({ ...tree, '.gitignore': 'docs/\n' });
    dirs.push(dir);
    writeFiles(dir, { 'src/untracked.ts': '', 'docs/ignored.md': '' });
    const result = await discoverFiles({ root: dir, include: ['**/*'], exclude: ['node_modules', 'dist'] });
    expect(result.method).toBe('git');
    expect(result.files).toEqual(['.gitignore', 'src/a.ts', 'src/nested/b.tsx', 'src/untracked.ts', 'tests/a.test.ts']);
  });
});
