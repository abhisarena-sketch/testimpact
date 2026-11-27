import fs from 'node:fs/promises';
import path from 'node:path';
import picomatch from 'picomatch';
import { isGitRepository, listGitFiles } from './git.js';
import { mapLimit } from './concurrency.js';
import { toPosix } from './paths.js';

const GLOB_CHARS = /[*?[\]{}()!]/;

/**
 * Build a matcher for exclude entries. Bare names without a slash or glob characters
 * (for example `node_modules`) match any path segment with that name.
 */
export function createExcludeMatcher(patterns: readonly string[]): (relPath: string) => boolean {
  const segmentNames = new Set<string>();
  const globs: string[] = [];
  for (const raw of patterns) {
    const p = raw.replace(/^\.\//, '').replace(/\/+$/, '');
    if (!p) continue;
    if (!p.includes('/') && !GLOB_CHARS.test(p)) segmentNames.add(p);
    else {
      globs.push(p);
      if (!p.endsWith('/**')) globs.push(`${p}/**`);
    }
  }
  const globMatch = globs.length > 0 ? picomatch(globs, { dot: true }) : undefined;
  return (relPath: string) => {
    if (segmentNames.size > 0) {
      for (const segment of relPath.split('/')) if (segmentNames.has(segment)) return true;
    }
    return globMatch ? globMatch(relPath) : false;
  };
}

export function createIncludeMatcher(patterns: readonly string[]): (relPath: string) => boolean {
  if (patterns.length === 0) return () => true;
  const normalised = patterns.map((p) => p.replace(/^\.\//, ''));
  const isMatch = picomatch(normalised, { dot: true });
  return (relPath) => isMatch(relPath);
}

export interface FileDiscoveryOptions {
  root: string;
  include: readonly string[];
  exclude: readonly string[];
  /** Additional patterns that are always included (for example test patterns). */
  alsoInclude?: readonly string[];
  useGitignore?: boolean;
  concurrency?: number;
}

export interface FileDiscoveryResult {
  /** Sorted POSIX paths relative to the root. */
  files: string[];
  method: 'git' | 'filesystem';
  /** Number of candidate paths considered before include/exclude filtering. */
  candidates: number;
}

async function walk(root: string, isExcluded: (rel: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  const queue: string[] = [''];
  while (queue.length > 0) {
    const batch = queue.splice(0, 64);
    const listings = await Promise.all(
      batch.map(async (dir) => {
        try {
          return { dir, entries: await fs.readdir(path.join(root, dir), { withFileTypes: true }) };
        } catch {
          return { dir, entries: [] };
        }
      }),
    );
    for (const { dir, entries } of listings) {
      for (const entry of entries) {
        const rel = dir ? `${dir}/${entry.name}` : entry.name;
        if (isExcluded(rel)) continue;
        // Symbolic links are not followed, to avoid cycles and escaping the root.
        if (entry.isDirectory()) queue.push(rel);
        else if (entry.isFile()) out.push(rel);
      }
    }
  }
  return out;
}

/**
 * Discover project files. Uses `git ls-files` when available (fast and honours .gitignore),
 * otherwise walks the filesystem without following symbolic links.
 */
export async function discoverFiles(options: FileDiscoveryOptions): Promise<FileDiscoveryResult> {
  const root = path.resolve(options.root);
  const isExcluded = createExcludeMatcher(options.exclude);
  const isIncluded = createIncludeMatcher(options.include);
  const isAlso = options.alsoInclude && options.alsoInclude.length > 0 ? createIncludeMatcher(options.alsoInclude) : () => false;

  let candidates: string[];
  let method: FileDiscoveryResult['method'] = 'filesystem';
  if (options.useGitignore !== false && (await isGitRepository(root))) {
    const listed = await listGitFiles(root);
    // ls-files --cached still lists files deleted from the working tree.
    const filtered = listed.filter((p) => !isExcluded(p));
    const exists = await mapLimit(filtered, options.concurrency ?? 32, async (p) => {
      try {
        const stat = await fs.lstat(path.join(root, p));
        return stat.isFile();
      } catch {
        return false;
      }
    });
    candidates = filtered.filter((_, i) => exists[i]);
    method = 'git';
  } else {
    candidates = await walk(root, isExcluded);
  }

  const files = candidates
    .map(toPosix)
    .filter((p) => !isExcluded(p) && (isIncluded(p) || isAlso(p)))
    .sort();
  return { files, method, candidates: candidates.length };
}
