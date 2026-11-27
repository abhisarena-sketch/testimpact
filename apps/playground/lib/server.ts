import path from 'node:path';

/**
 * The playground is a local tool. Analysis requests may only target directories inside
 * TESTIMPACT_ALLOWED_ROOT (default: the repository that contains the playground).
 */
export function allowedBase(): string {
  return path.resolve(process.env.TESTIMPACT_ALLOWED_ROOT ?? path.join(process.cwd(), '..', '..'));
}

export function resolveRoot(input: unknown): string {
  if (typeof input !== 'string' || input.trim() === '' || input.includes('\0')) throw new Error('Project path is required.');
  const base = allowedBase();
  const root = path.resolve(base, input.trim());
  const rel = path.relative(base, root);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Project path must be inside ${base} (set TESTIMPACT_ALLOWED_ROOT to change this).`);
  return root;
}

export function isLocalRequest(req: Request): boolean {
  const host = new URL(req.url).hostname;
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}
