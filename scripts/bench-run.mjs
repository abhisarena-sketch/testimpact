// Runs one analysis in a fresh process and prints measured statistics as JSON.
import { analyze } from '@testimpact/core';
import { performance } from 'node:perf_hooks';

const [root, cacheFlag, ...files] = process.argv.slice(2);
const t0 = performance.now();
const report = await analyze({ root, source: { kind: 'files', paths: files }, cache: cacheFlag === 'cache', mode: 'recommended' });
const wall = performance.now() - t0;
const usage = process.resourceUsage();
process.stdout.write(
  JSON.stringify({
    wallMs: Math.round(wall),
    timings: report.stats.timings,
    filesDiscovered: report.stats.filesDiscovered,
    filesAnalysed: report.stats.filesAnalysed,
    parsed: report.stats.filesParsed,
    reused: report.stats.filesReusedFromCache,
    edges: report.stats.edges,
    unresolved: report.stats.unresolvedImports,
    tests: report.stats.testFiles,
    candidates: report.summary.candidates,
    selected: report.summary.selected,
    maxRssMb: Math.round(usage.maxRSS / 1024),
    heapUsedMb: report.stats.memory.heapUsedMb,
  }),
);
