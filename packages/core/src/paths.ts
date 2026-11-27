import path from 'node:path';

/** Convert any path to POSIX separators. */
export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * Normalise a path to a POSIX path relative to `root`.
 * Returns `undefined` when the path lies outside `root`.
 */
export function relativeToRoot(root: string, p: string): string | undefined {
  const abs = path.isAbsolute(p) ? p : path.resolve(root, p);
  const rel = path.relative(root, abs);
  if (rel === '' ) return '';
  if (rel.startsWith('..') || path.isAbsolute(rel)) return undefined;
  return toPosix(rel);
}

/** Normalise a user-supplied relative path ("./src//a.ts" -> "src/a.ts"). */
export function normaliseRelative(p: string): string {
  const n = path.posix.normalize(toPosix(p));
  return n.replace(/^\.\/+/, '').replace(/\/+$/, '');
}
