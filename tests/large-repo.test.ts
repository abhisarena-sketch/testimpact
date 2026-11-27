import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyze } from '@testimpact/core';
import { generateSyntheticProject } from '../scripts/synthetic.mjs';
import { removeTemp } from './helpers/fixture.js';

let dir: string;
let project: ReturnType<typeof generateSyntheticProject>;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'testimpact-large-'));
  project = generateSyntheticProject(dir, { modules: 3000, layers: 12, fanOut: 3, testRatio: 0.3, seed: 7 });
});
afterAll(() => removeTemp(dir));

/** Independent reference implementation: reverse BFS over the generator's import map. */
function expectedTests(changed: string): Set<string> {
  const reverse = new Map<string, string[]>();
  for (const [from, deps] of Object.entries(project.imports)) for (const d of deps) reverse.set(d, [...(reverse.get(d) ?? []), from]);
  const seen = new Set([changed]);
  const queue = [changed];
  while (queue.length) {
    const f = queue.shift() as string;
    for (const r of reverse.get(f) ?? []) {
      if (seen.has(r)) continue;
      seen.add(r);
      queue.push(r);
    }
  }
  return new Set(Object.entries(project.tests).filter(([, src]) => seen.has(src)).map(([t]) => t));
}

describe('large repositories', () => {
  it('matches a reference reverse-dependency search on a 3,000-module project', async () => {
    const changed = project.modules[5] as string; // bottom layer: many dependents
    const report = await analyze({ root: dir, source: { kind: 'files', paths: [changed] }, cache: false });
    const expected = expectedTests(changed);
    expect(expected.size).toBeGreaterThan(20);
    expect(new Set(report.recommendations.map((r) => r.testFile))).toEqual(expected);
    expect(report.stats.filesAnalysed).toBe(3000 + Object.keys(project.tests).length + 2);
    expect(report.stats.unresolvedImports).toBe(0);
    // Generous bound so the test is stable on slow CI machines; see docs/benchmarks.md for measured numbers.
    expect(report.stats.timings.totalMs).toBeLessThan(60000);
  });

  it('selects only the tests of a top-layer module', async () => {
    const top = project.modules[project.modules.length - 1] as string;
    const report = await analyze({ root: dir, source: { kind: 'files', paths: [top] }, cache: false });
    const expected = expectedTests(top);
    expect(new Set(report.recommendations.map((r) => r.testFile))).toEqual(expected);
    expect(report.summary.selected).toBeLessThanOrEqual(1);
  });
});
