import type { ImpactReport } from '@testimpact/core';

/** Minimal client-side validation of a report loaded from a file. */
export function asReport(value: unknown): ImpactReport {
  const r = value as Partial<ImpactReport> | null;
  if (!r || typeof r !== 'object' || r.tool?.name !== 'testimpact' || !Array.isArray(r.recommendations) || !Array.isArray(r.allTests)) {
    throw new Error('This file is not a TestImpact JSON report.');
  }
  if (r.schemaVersion !== 1) throw new Error(`Unsupported report schema version ${String(r.schemaVersion)}.`);
  return r as ImpactReport;
}
