// Use the TestImpact engine from your own tooling.
// Usage: node examples/programmatic/analyze.mjs <project-root> [base-branch]
import { analyze, renderTerminal } from '@testimpact/core';

const [root = '.', base] = process.argv.slice(2);
const report = await analyze({
  root,
  source: base ? { kind: 'base', base } : { kind: 'uncommitted' },
  mode: 'recommended',
});

console.log(renderTerminal(report, { color: process.stdout.isTTY }));
for (const rec of report.recommendations.filter((r) => r.selected)) {
  console.log(`${rec.id} ${rec.confidence} ${rec.testFile} <- ${rec.dependencyPath.join(' -> ')}`);
}
