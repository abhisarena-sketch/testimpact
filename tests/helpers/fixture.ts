import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type FileTree = Record<string, string>;

/** Create a temporary directory populated with `files`. */
export function createTempProject(files: FileTree, prefix = 'testimpact-'): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  writeFiles(dir, files);
  return dir;
}

export function writeFiles(dir: string, files: FileTree): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

export function removeTemp(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

export function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'TestImpact Tests',
      GIT_AUTHOR_EMAIL: 'tests@example.invalid',
      GIT_COMMITTER_NAME: 'TestImpact Tests',
      GIT_COMMITTER_EMAIL: 'tests@example.invalid',
    },
  });
}

/** Create a temp Git repository with an initial commit containing `files`. */
export function createGitProject(files: FileTree): string {
  const dir = createTempProject(files, 'testimpact-git-');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'initial');
  return dir;
}

export function commitAll(dir: string, message: string): void {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', message);
}
