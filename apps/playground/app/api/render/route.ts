import { parseReport, renderHtml } from '@testimpact/core';
import { isLocalRequest } from '@/lib/server';

export const runtime = 'nodejs';

/** Render a report as the same self-contained HTML the CLI produces. */
export async function POST(req: Request): Promise<Response> {
  if (!isLocalRequest(req)) return Response.json({ error: 'Local requests only.' }, { status: 403 });
  try {
    const report = parseReport(await req.json());
    return new Response(renderHtml(report), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
