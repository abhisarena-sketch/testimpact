import { execFile } from 'node:child_process';
import path from 'node:path';
import { TestImpactError } from './errors.js';
import { relativeToRoot, toPosix } from './paths.js';

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'type-changed' | 'untracked';

export interface LineRange {
  start: number;
  end: number;
}

export interface ChangedFile {
  /** POSIX path relative to the project root. For deletions this is the deleted path. */
  path: string;
  status: ChangeStatus;
  /** Previous path for renames and copies. */
  oldPath?: string;
  /**
   * Changed line ranges in the new version of the file (1-based, inclusive).
   * `undefined` means "unknown or the whole file".
   */
  changedLines?: LineRange[];
}

export type ChangeSource =
  | { kind: 'uncommitted' }
  | { kind: 'staged' }
  | { kind: 'base'; base: string; head?: string }
  | { kind: 'commit'; commit: string }
  | { kind: 'range'; from: string; to: string }
  | { kind: 'files'; paths: string[] };

const GIT_MAX_BUFFER = 512 * 1024 * 1024;

/**
 * Run git with an argument array (never through a shell).
 * Disables optional locks and pagers so analysis never mutates the repository.
 */
export function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=off', '--no-pager', ...args],
      {
        cwd,
        maxBuffer: GIT_MAX_BUFFER,
        windowsHide: true,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
      },
      (error, stdout, stderr) => {
        if (error) {
          const message = (stderr || error.message).toString().trim();
          reject(new TestImpactError('GIT_ERROR', `git ${args[0] ?? ''} failed: ${message}`));
          return;
        }
        resolve(stdout.toString());
      },
    );
  });
}

// Allowed characters in revision expressions: names, hashes, HEAD~2, main^, origin/main, @{u}.
const REF_PATTERN = /^[A-Za-z0-9._/@{}~^+-]+$/;

/** Validate a user-supplied revision before it reaches git. */
export function assertSafeRef(ref: string, label = 'revision'): void {
  if (ref.length === 0 || ref.length > 255 || ref.startsWith('-') || !REF_PATTERN.test(ref) || ref.includes('..')) {
    throw new TestImpactError('INVALID_INPUT', `Invalid ${label}: "${ref}"`);
  }
}

async function verifyCommit(ref: string, cwd: string, label: string): Promise<void> {
  assertSafeRef(ref, label);
  try {
    await runGit(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`], cwd);
  } catch {
    throw new TestImpactError('INVALID_INPUT', `Unknown ${label}: "${ref}"`);
  }
}

export async function isGitRepository(cwd: string): Promise<boolean> {
  try {
    const out = await runGit(['rev-parse', '--is-inside-work-tree'], cwd);
    return out.trim() === 'true';
  } catch {
    return false;
  }
}

export async function getRepositoryRoot(cwd: string): Promise<string> {
  const out = await runGit(['rev-parse', '--show-toplevel'], cwd);
  return path.resolve(out.trim());
}

async function hasHead(cwd: string): Promise<boolean> {
  try {
    await runGit(['rev-parse', '--verify', '--quiet', 'HEAD'], cwd);
    return true;
  } catch {
    return false;
  }
}

const STATUS_MAP: Record<string, ChangeStatus> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'type-changed',
};

interface RawChange {
  status: ChangeStatus;
  path: string;
  oldPath?: string;
}

/** Parse `git diff --name-status -z` output (repository-relative paths). */
export function parseNameStatus(output: string): RawChange[] {
  const tokens = output.split('\0');
  const changes: RawChange[] = [];
  let i = 0;
  while (i < tokens.length) {
    const code = tokens[i];
    if (!code) {
      i++;
      continue;
    }
    const letter = code[0] ?? '';
    const status = STATUS_MAP[letter];
    if (!status) {
      // Unmerged (U), unknown (X) or broken pairing (B): treat as modified when a path follows.
      const p = tokens[i + 1];
      if (p) changes.push({ status: 'modified', path: p });
      i += 2;
      continue;
    }
    if (status === 'renamed' || status === 'copied') {
      const oldPath = tokens[i + 1];
      const newPath = tokens[i + 2];
      if (oldPath && newPath) changes.push({ status, path: newPath, oldPath });
      i += 3;
    } else {
      const p = tokens[i + 1];
      if (p) changes.push({ status, path: p });
      i += 2;
    }
  }
  return changes;
}

/** Parse unified diff output with `-U0` into changed line ranges keyed by repository-relative path. */
export function parseChangedLines(diff: string): Map<string, LineRange[]> {
  const result = new Map<string, LineRange[]>();
  let current: string | undefined;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim();
      current = target === '/dev/null' ? undefined : target.replace(/^b\//, '');
      if (current && !result.has(current)) result.set(current, []);
      continue;
    }
    if (!current || !line.startsWith('@@')) continue;
    const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!match) continue;
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    const ranges = result.get(current);
    if (!ranges) continue;
    if (count === 0) {
      // Pure deletion after line `start`: the lines around the deletion point are affected.
      ranges.push({ start: Math.max(1, start), end: start + 1 });
    } else {
      ranges.push({ start, end: start + count - 1 });
    }
  }
  return result;
}

function diffArgsFor(source: ChangeSource): string[] | undefined {
  switch (source.kind) {
    case 'uncommitted':
      return ['diff', 'HEAD'];
    case 'staged':
      return ['diff', '--cached'];
    case 'base':
      return ['diff', `${source.base}...${source.head ?? 'HEAD'}`];
    case 'commit':
      return ['diff-tree', '--root', '-r', '--no-commit-id', source.commit];
    case 'range':
      return ['diff', source.from, source.to];
    case 'files':
      return undefined;
  }
}

export interface DetectChangesOptions {
  /** Project root (may be a sub-directory of the repository). */
  root: string;
  source: ChangeSource;
  /** Compute changed line ranges for symbol-level analysis. Default true. */
  lineRanges?: boolean;
}

export interface DetectChangesResult {
  changes: ChangedFile[];
  /** Human-readable description of what was compared. */
  description: string;
  warnings: string[];
}

/**
 * Detect changed files using Git. Paths in the result are relative to the project root;
 * changes outside the project root are dropped (and reported as a warning).
 */
export async function detectGitChanges(options: DetectChangesOptions): Promise<DetectChangesResult> {
  const { root, source } = options;
  const warnings: string[] = [];
  if (source.kind === 'files') {
    throw new TestImpactError('INVALID_INPUT', 'detectGitChanges does not handle explicit file lists');
  }
  if (!(await isGitRepository(root))) {
    throw new TestImpactError('GIT_ERROR', `Not a Git repository: ${root}. Use --files to analyse explicit files.`);
  }
  const repoRoot = await getRepositoryRoot(root);
  const head = await hasHead(root);

  let description: string;
  let raw: RawChange[] = [];
  let args = diffArgsFor(source);

  switch (source.kind) {
    case 'uncommitted':
      description = 'uncommitted changes (staged, unstaged and untracked) against HEAD';
      if (!head) {
        // Fresh repository: everything in the index is new.
        args = undefined;
        const staged = await runGit(['ls-files', '-z', '--cached'], repoRoot);
        raw = staged
          .split('\0')
          .filter(Boolean)
          .map((p) => ({ status: 'added' as const, path: p }));
      }
      break;
    case 'staged':
      description = 'staged changes';
      if (!head) {
        args = undefined;
        const staged = await runGit(['ls-files', '-z', '--cached'], repoRoot);
        raw = staged
          .split('\0')
          .filter(Boolean)
          .map((p) => ({ status: 'added' as const, path: p }));
      }
      break;
    case 'base':
      await verifyCommit(source.base, root, 'base branch');
      if (source.head) await verifyCommit(source.head, root, 'head revision');
      description = `changes on ${source.head ?? 'HEAD'} since it diverged from ${source.base}`;
      break;
    case 'commit':
      await verifyCommit(source.commit, root, 'commit');
      description = `changes introduced by commit ${source.commit}`;
      break;
    case 'range':
      await verifyCommit(source.from, root, 'from revision');
      await verifyCommit(source.to, root, 'to revision');
      description = `changes between ${source.from} and ${source.to}`;
      break;
  }

  if (args) {
    const out = await runGit([...args, '--name-status', '-z', '-M', '--'], repoRoot);
    raw = parseNameStatus(out);
  }

  if (source.kind === 'uncommitted') {
    const untracked = await runGit(['ls-files', '-z', '--others', '--exclude-standard'], repoRoot);
    const known = new Set(raw.map((c) => c.path));
    for (const p of untracked.split('\0').filter(Boolean)) {
      if (!known.has(p)) raw.push({ status: 'untracked', path: p });
    }
  }

  let lineMap = new Map<string, LineRange[]>();
  if (options.lineRanges !== false && args) {
    const tracked = raw.filter((c) => c.status === 'modified' || c.status === 'renamed' || c.status === 'copied');
    if (tracked.length > 0) {
      try {
        const diff = await runGit([...args, '-U0', '--no-color', '--no-ext-diff', '-M', '--'], repoRoot);
        lineMap = parseChangedLines(diff);
      } catch (error) {
        warnings.push(`Could not compute changed line ranges: ${(error as Error).message}`);
      }
    }
  }

  const changes: ChangedFile[] = [];
  let outside = 0;
  for (const change of raw) {
    const abs = path.join(repoRoot, change.path);
    const rel = relativeToRoot(root, abs);
    if (rel === undefined || rel === '') {
      outside++;
      continue;
    }
    const entry: ChangedFile = { path: toPosix(rel), status: change.status };
    if (change.oldPath) {
      const oldRel = relativeToRoot(root, path.join(repoRoot, change.oldPath));
      if (oldRel !== undefined) entry.oldPath = toPosix(oldRel);
    }
    const ranges = lineMap.get(change.path);
    if (ranges && (change.status === 'modified' || change.status === 'renamed' || change.status === 'copied')) {
      entry.changedLines = ranges;
    }
    changes.push(entry);
  }
  if (outside > 0) warnings.push(`${outside} changed file(s) outside the project root were ignored.`);
  changes.sort((a, b) => a.path.localeCompare(b.path));
  return { changes, description, warnings };
}

/** List files known to Git (tracked plus untracked-but-not-ignored), relative to `root`. */
export async function listGitFiles(root: string): Promise<string[]> {
  const out = await runGit(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'], root);
  const files = new Set<string>();
  for (const p of out.split('\0')) {
    if (p) files.add(toPosix(p));
  }
  return [...files];
}
