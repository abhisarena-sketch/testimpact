import { TestImpactError } from '../errors.js';
import { REPORT_SCHEMA_VERSION, type ImpactReport, type Recommendation } from '../report.js';

export function renderJson(report: ImpactReport, pretty = true): string {
  return `${JSON.stringify(report, null, pretty ? 2 : 0)}\n`;
}

/** Validate the basic shape of a parsed report (for example one loaded from disk). */
export function parseReport(value: unknown): ImpactReport {
  const r = value as Partial<ImpactReport> | undefined;
  if (!r || typeof r !== 'object' || r.tool?.name !== 'testimpact' || !Array.isArray(r.recommendations) || !Array.isArray(r.allTests)) {
    throw new TestImpactError('INVALID_INPUT', 'Not a TestImpact report.');
  }
  if (r.schemaVersion !== REPORT_SCHEMA_VERSION) {
    throw new TestImpactError('INVALID_INPUT', `Unsupported report schema version ${String(r.schemaVersion)} (expected ${REPORT_SCHEMA_VERSION}).`);
  }
  return r as ImpactReport;
}

/** Find a recommendation by ID (case-insensitive, `TEST-1` and `1` accepted) or by test file path. */
export function findRecommendation(report: ImpactReport, query: string): Recommendation | undefined {
  const q = query.trim();
  const num = /^(?:test-)?0*(\d+)$/i.exec(q);
  if (num) {
    const id = `TEST-${num[1]?.padStart(3, '0')}`;
    return report.recommendations.find((r) => r.id === id);
  }
  const norm = q.replace(/^\.\//, '');
  return report.recommendations.find((r) => r.testFile === norm);
}
