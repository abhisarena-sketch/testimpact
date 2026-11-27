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

export const FIXTURES = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'fixtures');

export function fixturePath(name: string): string {
  return path.join(FIXTURES, name);
}

/** All files in a directory (POSIX, relative), excluding node_modules. */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.testimpact') continue;
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(child);
      else out.push(child);
    }
  };
  walk('');
  return out.sort();
}

/** Copy a fixture into a fresh Git repository so tests can modify it safely. */
export function copyFixtureToGit(name: string): string {
  const src = fixturePath(name);
  const files: FileTree = {};
  for (const rel of listFiles(src)) files[rel] = fs.readFileSync(path.join(src, rel), 'utf8');
  return createGitProject(files);
}
