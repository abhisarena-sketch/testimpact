'use client';
import { useState } from 'react';
import { ConfidenceBadge } from '@/components/confidence-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { ImpactReport } from '@/lib/types';
import { cn } from '@/lib/utils';

type Filter = 'all' | 'high' | 'medium' | 'low' | 'selected';

export function TestExplorer({
  report,
  selectedId,
  onSelect,
  onTrace,
}: {
  report: ImpactReport;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onTrace: (path: string[]) => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const recs = report.recommendations.filter(
    (r) =>
      (filter === 'all' || (filter === 'selected' ? r.selected : r.confidence === filter)) &&
      (query === '' || r.testFile.toLowerCase().includes(query.toLowerCase())),
  );
  const current = report.recommendations.find((r) => r.id === selectedId) ?? recs[0];
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Recommended tests</CardTitle>
          <CardDescription>
            {report.recommendations.length} candidates of {report.summary.totalTests} tests, ranked by confidence and score
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1">
            {(['all', 'selected', 'high', 'medium', 'low'] as Filter[]).map((f) => (
              <Button key={f} size="sm" variant={filter === f ? 'default' : 'outline'} onClick={() => setFilter(f)}>
                {f}
              </Button>
            ))}
          </div>
          <Input placeholder="Filter by test path" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter tests" />
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-left text-xs">
              <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-20 py-2 pr-2">ID</th>
                  <th className="w-24 py-2 pr-2">Confidence</th>
                  <th className="py-2 pr-2">Test file</th>
                  <th className="w-14 py-2 text-right">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recs.map((r) => (
                  <tr key={r.id} onClick={() => onSelect(r.id)} className={cn('cursor-pointer hover:bg-muted', current?.id === r.id && 'bg-cobalt-soft', !r.selected && 'text-muted-foreground')}>
                    <td className="py-2 pr-2 font-mono">{r.id}</td>
                    <td className="py-2 pr-2">
                      <ConfidenceBadge confidence={r.confidence} />
                    </td>
                    <td className="max-w-0 truncate py-2 pr-2 font-mono" title={r.testFile}>
                      {r.testFile}
                    </td>
                    <td className="py-2 text-right tabular-nums">{r.score}</td>
                  </tr>
                ))}
                {recs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-3 text-muted-foreground">
                      No tests match.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      {current ? (
        <Card className="h-fit">
          <CardHeader>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">{current.id}</span>
              <ConfidenceBadge confidence={current.confidence} />
              <span className="text-xs text-muted-foreground">
                score {current.score}/100 · {current.framework} · {current.testKind} · {current.selected ? 'selected' : 'not selected'}
              </span>
            </div>
            <CardTitle className="break-all font-mono">{current.testFile}</CardTitle>
            <CardDescription>{current.reason}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <section>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dependency path</h4>
              <ol className="space-y-1">
                {current.dependencyPathDetail.map((s, i) => (
                  <li key={`${s.file}-${i}`} className="font-mono text-xs" style={{ paddingLeft: `${i * 14}px` }}>
                    {i > 0 ? '↳ ' : ''}
                    {s.file} <span className="text-muted-foreground">{i === 0 ? '(changed)' : `(${s.via ?? 'related'}${s.line ? `, line ${s.line}` : ''})`}</span>
                  </li>
                ))}
              </ol>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => onTrace(current.dependencyPath)}>
                Trace in dependency explorer
              </Button>
            </section>
            <section>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Changed files</h4>
              <p className="font-mono text-xs">{current.changedFiles.join(', ') || 'none'}</p>
              {current.changedSymbols ? <p className="mt-1 text-xs">Changed exports reached: <span className="font-mono">{current.changedSymbols.join(', ')}</span></p> : null}
            </section>
            {current.relatedSourceFiles.length > 0 ? (
              <section>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Related source files</h4>
                <ul className="font-mono text-xs">
                  {current.relatedSourceFiles.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </section>
            ) : null}
            <section>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evidence</h4>
              <ul className="space-y-1.5">
                {current.signals.map((s) => (
                  <li key={`${s.type}-${s.detail}`} className="flex items-start gap-2 text-xs">
                    <ConfidenceBadge confidence={s.confidence} />
                    <span>
                      <span className="font-mono text-muted-foreground">{s.type}</span> {s.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            {current.confidence === 'low' ? (
              <p className="rounded-md bg-warn-soft p-2 text-xs text-warn">Low confidence: based on heuristics or incomplete mapping. This is not guaranteed coverage.</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
