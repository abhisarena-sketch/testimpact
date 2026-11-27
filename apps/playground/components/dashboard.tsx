'use client';
import { AlertTriangle } from 'lucide-react';
import { ConfidenceBadge } from '@/components/confidence-badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ImpactReport, Recommendation } from '@/lib/types';

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
        {hint ? <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}

function RecList({ recs, onSelect, empty }: { recs: Recommendation[]; onSelect: (id: string) => void; empty: string }) {
  if (recs.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="divide-y divide-border">
      {recs.map((r) => (
        <li key={r.id}>
          <button type="button" onClick={() => onSelect(r.id)} className="flex w-full items-start gap-3 py-2 text-left hover:bg-muted/60">
            <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">{r.id}</span>
            <ConfidenceBadge confidence={r.confidence} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-xs">{r.testFile}</span>
              <span className="block text-xs text-muted-foreground">{r.reason}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Dashboard({ report, onSelectTest }: { report: ImpactReport; onSelectTest: (id: string) => void }) {
  const s = report.summary;
  const high = report.recommendations.filter((r) => r.confidence === 'high');
  const indirect = report.recommendations.filter((r) => r.confidence !== 'high');
  return (
    <div className="space-y-6">
      {report.selection.fullSuiteRecommended ? (
        <div className="flex gap-2 rounded-lg border border-[#f1d39a] bg-warn-soft p-3 text-sm text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong>Full test suite recommended.</strong> {report.selection.fullSuiteReasons.join(' ')}
          </span>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="changed files" value={s.changedFiles} />
        <Stat label={`selected of ${s.totalTests} tests`} value={s.selected} hint={`mode: ${report.selection.mode}`} />
        <Stat label="high confidence" value={s.high} />
        <Stat label="medium confidence" value={s.medium} />
        <Stat label="low confidence" value={s.low} />
        <Stat label="not selected" value={`${s.skippedPercent}%`} hint={`threshold: ${report.selection.threshold}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Changed files</CardTitle>
            <CardDescription>{report.change.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {report.change.files.map((f) => (
                <li key={f.path} className="py-2">
                  <div className="flex items-center gap-2">
                    <span className="w-20 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">{f.status}</span>
                    <span className="min-w-0 truncate font-mono text-xs">{f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{f.testsAffected} tests</span>
                  </div>
                  <div className="pl-22 text-xs text-muted-foreground">
                    {f.kind}
                    {Array.isArray(f.changedExports) ? ` · exports changed: ${f.changedExports.length > 0 ? f.changedExports.join(', ') : 'none'}` : f.changedExports === 'all' ? ' · whole module' : ''}
                    {f.notes.length > 0 ? ` · ${f.notes.join(' ')}` : ''}
                  </div>
                </li>
              ))}
              {report.change.files.length === 0 ? <li className="py-2 text-sm text-muted-foreground">No changed files.</li> : null}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Analysis summary</CardTitle>
            <CardDescription>Measured during this run</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              {report.stats.filesAnalysed} files analysed ({report.stats.filesParsed} parsed), {report.stats.edges} imports, {report.stats.testFiles} test files.
            </p>
            <p>
              {report.stats.unresolvedImports} unresolved imports, {report.stats.unresolvedDynamicImports} computed dynamic imports, {report.stats.cycles} import cycles.
            </p>
            <p className="text-muted-foreground">
              Graph {report.stats.timings.graphMs} ms · tests {report.stats.timings.testDiscoveryMs} ms · impact {report.stats.timings.impactMs} ms · total {report.stats.timings.totalMs} ms
            </p>
            <p className="text-muted-foreground">Frameworks: {report.frameworks.map((f) => f.framework).join(', ') || 'none detected'}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>High-confidence recommendations</CardTitle>
            <CardDescription>Direct test or dependency relationships</CardDescription>
          </CardHeader>
          <CardContent>
            <RecList recs={high} onSelect={onSelectTest} empty="No high-confidence recommendations." />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Indirectly affected tests</CardTitle>
            <CardDescription>Medium: indirect dependencies. Low: heuristics, not guaranteed coverage.</CardDescription>
          </CardHeader>
          <CardContent>
            <RecList recs={indirect} onSelect={onSelectTest} empty="No indirect candidates." />
          </CardContent>
        </Card>
      </div>

      {report.runCommands.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Run the selected tests</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {report.runCommands.map((c) => (
              <pre key={c.framework} className="overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-xs">
                {c.commandLine}
              </pre>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {report.warnings.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Analysis warnings</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm text-warn">
              {report.warnings.map((w) => (
                <li key={w}>• {w}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
