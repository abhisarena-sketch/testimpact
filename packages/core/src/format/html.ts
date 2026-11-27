import type { ImpactReport, Recommendation } from '../report.js';

/** Escape text for safe inclusion in HTML. */
export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Serialise JSON for a `<script type="application/json">` block without allowing tag breakout. */
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

const CSS = `
:root{--bg:#ffffff;--fg:#1f2329;--muted:#5f6b7a;--line:#e3e6ea;--soft:#f5f6f8;--accent:#0047ab;--accent-soft:#e8eefa;--warn:#9a5b00;--warn-soft:#fff6e5}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif}
main{max-width:1100px;margin:0 auto;padding:32px 20px 64px}
header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:1px solid var(--line);padding-bottom:16px;margin-bottom:24px;gap:16px;flex-wrap:wrap}
.brand{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}h1{margin:4px 0 0;font-size:24px}h1 span{color:var(--accent)}
.tag{color:var(--muted)}h2{font-size:16px;margin:32px 0 12px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.card{border:1px solid var(--line);border-radius:8px;padding:12px 14px}.card b{display:block;font-size:22px}.card small{color:var(--muted)}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px}
.badge{display:inline-block;border-radius:4px;padding:1px 7px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.high{background:var(--accent);color:#fff}.medium{background:var(--accent-soft);color:var(--accent)}.low{background:var(--soft);color:var(--muted);border:1px solid var(--line)}
.muted{color:var(--muted)}details summary{cursor:pointer;color:var(--accent)}details>div{padding:8px 0 4px}
.path{margin:6px 0;padding:0;list-style:none}.path li{padding:2px 0}.path li+li:before{content:"↳ ";color:var(--muted)}
.warn{background:var(--warn-soft);border:1px solid #f1d39a;color:var(--warn);border-radius:8px;padding:10px 14px;margin:6px 0}
.cmd{background:var(--soft);border:1px solid var(--line);border-radius:8px;padding:10px 12px;overflow-x:auto;white-space:pre}
.unselected td{color:var(--muted)}footer{margin-top:40px;color:var(--muted);font-size:12px;border-top:1px solid var(--line);padding-top:12px}
`;

function recRow(r: Recommendation): string {
  const signals = r.signals.map((s) => `<li><span class="badge ${s.confidence}">${escapeHtml(s.confidence)}</span> <code>${escapeHtml(s.type)}</code> ${escapeHtml(s.detail)}</li>`).join('');
  const steps = r.dependencyPathDetail
    .map((s, i) => `<li><code>${escapeHtml(s.file)}</code> <span class="muted">${i === 0 ? '(changed)' : escapeHtml(`(${s.via ?? 'related'}${s.line ? `, line ${s.line}` : ''})`)}</span></li>`)
    .join('');
  return `<tr class="${r.selected ? '' : 'unselected'}" id="${escapeHtml(r.id)}">
<td class="mono">${escapeHtml(r.id)}</td>
<td><span class="badge ${r.confidence}">${escapeHtml(r.confidence)}</span><br><span class="muted">${r.score}/100</span></td>
<td><code>${escapeHtml(r.testFile)}</code><br><span class="muted">${escapeHtml(r.framework)} · ${escapeHtml(r.testKind)}${r.selected ? '' : ' · not selected'}</span>
<details><summary>${escapeHtml(r.reason)}</summary><div>
<strong>Dependency path</strong><ul class="path">${steps}</ul>
${r.changedSymbols ? `<p><strong>Changed exports reached:</strong> ${r.changedSymbols.map((s) => `<code>${escapeHtml(s)}</code>`).join(', ')}</p>` : ''}
${r.relatedSourceFiles.length > 0 ? `<p><strong>Related source files:</strong> ${r.relatedSourceFiles.map((f) => `<code>${escapeHtml(f)}</code>`).join(', ')}</p>` : ''}
<strong>Evidence</strong><ul>${signals}</ul></div></details></td>
<td>${r.changedFiles.map((f) => `<code>${escapeHtml(f)}</code>`).join('<br>')}</td>
</tr>`;
}

/** Render a self-contained HTML report (no external resources, no scripts executed). */
export function renderHtml(report: ImpactReport): string {
  const s = report.summary;
  const changed = report.change.files
    .map((f) => {
      const exportsLabel = f.changedExports === undefined ? '' : f.changedExports === 'all' ? 'whole module' : f.changedExports.length === 0 ? 'none' : f.changedExports.join(', ');
      return `<tr><td><code>${escapeHtml(f.oldPath ? `${f.oldPath} → ${f.path}` : f.path)}</code></td><td>${escapeHtml(f.status)}</td><td>${escapeHtml(f.kind)}</td><td>${escapeHtml(exportsLabel)}</td><td>${f.testsAffected}</td><td class="muted">${f.notes.map(escapeHtml).join('<br>')}</td></tr>`;
    })
    .join('');
  const notRecommended = report.allTests.filter((t) => !t.recommendationId);
  const warnings = report.warnings.map((w) => `<div class="warn">${escapeHtml(w)}</div>`).join('');
  const commands = report.runCommands.map((c) => `<div class="cmd mono">${escapeHtml(c.commandLine)}</div>`).join('');
  const t = report.stats.timings;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="TestImpact ${escapeHtml(report.tool.version)}">
<title>TestImpact report · ${escapeHtml(report.project)}</title><style>${CSS}</style></head>
<body><main>
<header><div><div class="brand">Workfonic Labs · TestImpact</div><h1>Test impact for <span>${escapeHtml(report.project)}</span></h1>
<div class="tag">Change code. Know what to test.</div></div>
<div class="muted">${escapeHtml(report.change.description)}<br>Generated ${escapeHtml(report.generatedAt)}</div></header>
${report.selection.fullSuiteRecommended ? `<div class="warn"><strong>Full test suite recommended.</strong> ${escapeHtml(report.selection.fullSuiteReasons.join(' '))}</div>` : ''}
<section class="cards">
<div class="card"><b>${s.changedFiles}</b><small>changed files</small></div>
<div class="card"><b>${s.selected}</b><small>selected of ${s.totalTests} tests</small></div>
<div class="card"><b>${s.high}</b><small>high confidence</small></div>
<div class="card"><b>${s.medium}</b><small>medium confidence</small></div>
<div class="card"><b>${s.low}</b><small>low confidence</small></div>
<div class="card"><b>${s.skippedPercent}%</b><small>not selected (mode: ${escapeHtml(report.selection.mode)}, threshold: ${escapeHtml(report.selection.threshold)})</small></div>
</section>
<h2>Changed files</h2>
<table><thead><tr><th>File</th><th>Status</th><th>Kind</th><th>Changed exports</th><th>Tests</th><th>Notes</th></tr></thead><tbody>${changed || '<tr><td colspan="6" class="muted">No changed files.</td></tr>'}</tbody></table>
<h2>Recommended tests</h2>
<table><thead><tr><th>ID</th><th>Confidence</th><th>Test</th><th>Changed files</th></tr></thead><tbody>${report.recommendations.map(recRow).join('') || '<tr><td colspan="4" class="muted">No affected tests found.</td></tr>'}</tbody></table>
${commands ? `<h2>Run</h2>${commands}` : ''}
${warnings ? `<h2>Analysis warnings</h2>${warnings}` : ''}
<h2>Tests not linked to these changes (${notRecommended.length})</h2>
<details><summary>Show ${notRecommended.length} test files</summary><div><table><tbody>${notRecommended.map((t2) => `<tr class="${t2.selected ? '' : 'unselected'}"><td><code>${escapeHtml(t2.path)}</code></td><td>${escapeHtml(t2.framework)}</td><td>${t2.selected ? 'selected (full suite)' : 'not selected'}</td></tr>`).join('')}</tbody></table></div></details>
<h2>Analysis statistics</h2>
<table><tbody>
<tr><td>Files analysed</td><td>${report.stats.filesAnalysed} of ${report.stats.filesDiscovered} discovered (${report.stats.filesParsed} parsed, ${report.stats.filesReusedFromCache} from cache)</td></tr>
<tr><td>Imports</td><td>${report.stats.edges} resolved, ${report.stats.unresolvedImports} unresolved, ${report.stats.unresolvedDynamicImports} computed dynamic imports</td></tr>
<tr><td>Import cycles</td><td>${report.stats.cycles}</td></tr>
<tr><td>Timings</td><td>files ${t.fileDiscoveryMs} ms · changes ${t.changeDetectionMs} ms · tests ${t.testDiscoveryMs} ms · graph ${t.graphMs} ms · impact ${t.impactMs} ms · total ${t.totalMs} ms</td></tr>
<tr><td>Frameworks</td><td>${report.frameworks.map((f) => `${escapeHtml(f.framework)} <span class="muted">(${escapeHtml(f.evidence.join('; '))})</span>`).join('<br>')}</td></tr>
</tbody></table>
<footer>TestImpact recommendations come from static analysis. Low-confidence results are heuristics, not guaranteed coverage. Run the full suite before releasing.</footer>
</main>
<script type="application/json" id="testimpact-report">${safeJson(report)}</script>
</body></html>
`;
}

/** Extract the embedded report from an HTML report produced by `renderHtml`. */
export function extractReportFromHtml(html: string): unknown {
  const match = /<script type="application\/json" id="testimpact-report">([\s\S]*?)<\/script>/.exec(html);
  if (!match?.[1]) return undefined;
  return JSON.parse(match[1]);
}
