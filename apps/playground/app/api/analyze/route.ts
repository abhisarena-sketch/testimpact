import { analyze, TestImpactError, type ChangeSource } from '@testimpact/core';
import { allowedBase, isLocalRequest, resolveRoot } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sourceFrom(body: Record<string, unknown>): ChangeSource {
  const kind = body.kind;
  const str = (v: unknown, name: string) => {
    if (typeof v !== 'string' || v.trim() === '') throw new TestImpactError('INVALID_INPUT', `${name} is required.`);
    return v.trim();
  };
  switch (kind) {
    case 'uncommitted':
    case 'staged':
      return { kind };
    case 'base':
      return { kind, base: str(body.base, 'Base branch') };
    case 'commit':
      return { kind, commit: str(body.commit, 'Commit') };
    case 'files': {
      const files = str(body.files, 'Files')
        .split(/[\n,]/)
        .map((f) => f.trim())
        .filter(Boolean);
      return { kind, paths: files };
    }
    default:
      throw new TestImpactError('INVALID_INPUT', 'Unknown change source.');
  }
}

/** Run a real analysis on a local project (read-only; results are never fabricated). */
export async function POST(req: Request): Promise<Response> {
  if (!isLocalRequest(req)) return Response.json({ error: 'The playground API only accepts local requests.' }, { status: 403 });
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const root = resolveRoot(body.root);
    const mode = body.mode === 'full' || body.mode === 'all-candidates' ? body.mode : 'recommended';
    const threshold = body.threshold === 'high' || body.threshold === 'low' ? body.threshold : undefined;
    const report = await analyze({ root, source: sourceFrom(body), mode, ...(threshold ? { threshold } : {}), includeGraph: true, cache: false });
    return Response.json(report);
  } catch (error) {
    const status = error instanceof TestImpactError ? 400 : 500;
    return Response.json({ error: error instanceof Error ? error.message : String(error), base: allowedBase() }, { status });
  }
}

export async function GET(req: Request): Promise<Response> {
  if (!isLocalRequest(req)) return Response.json({ error: 'Local requests only.' }, { status: 403 });
  return Response.json({ base: allowedBase() });
}
