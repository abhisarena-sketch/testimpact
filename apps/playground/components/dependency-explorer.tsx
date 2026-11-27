'use client';
import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { ImpactReport } from '@/lib/types';
import { cn } from '@/lib/utils';

type Edge = NonNullable<ImpactReport['graph']>['edges'][number];

interface Indexed {
  files: string[];
  out: Map<string, Edge[]>;
  incoming: Map<string, Edge[]>;
  tests: Set<string>;
  changed: Set<string>;
}

function useIndex(report: ImpactReport): Indexed | undefined {
  return useMemo(() => {
    const g = report.graph;
    if (!g) return undefined;
    const out = new Map<string, Edge[]>();
    const incoming = new Map<string, Edge[]>();
    for (const e of g.edges) {
      out.set(e.from, [...(out.get(e.from) ?? []), e]);
      incoming.set(e.to, [...(incoming.get(e.to) ?? []), e]);
    }
    return {
      files: g.nodes.map((n) => n.path).sort(),
      out,
      incoming,
      tests: new Set(g.tests),
      changed: new Set(report.change.files.flatMap((f) => [f.path, f.oldPath].filter((x): x is string => Boolean(x)))),
    };
  }, [report]);
}

const NODE_W = 230;
const NODE_H = 26;
const GAP_Y = 8;
const COL_GAP = 70;
const MAX_PER_COL = 14;

function short(p: string, max = 34): string {
  return p.length <= max ? p : `…${p.slice(p.length - max + 1)}`;
}

interface Column {
  title: string;
  items: string[];
  more: number;
}

function NeighbourhoodGraph({ index, focus, onFocus, highlight }: { index: Indexed; focus: string; onFocus: (f: string) => void; highlight: Set<string> }) {
  const deps = [...new Set((index.out.get(focus) ?? []).map((e) => e.to))].sort();
  const level1 = [...new Set((index.incoming.get(focus) ?? []).map((e) => e.from))].sort();
  const level1Set = new Set(level1);
  const level2 = [...new Set(level1.flatMap((f) => (index.incoming.get(f) ?? []).map((e) => e.from)))].filter((f) => f !== focus && !level1Set.has(f)).sort();
  const cols: Column[] = [
    { title: 'Imports', items: deps.slice(0, MAX_PER_COL), more: Math.max(0, deps.length - MAX_PER_COL) },
    { title: 'Selected file', items: [focus], more: 0 },
    { title: 'Imported by', items: level1.slice(0, MAX_PER_COL), more: Math.max(0, level1.length - MAX_PER_COL) },
    { title: 'Imported by (2 hops)', items: level2.slice(0, MAX_PER_COL), more: Math.max(0, level2.length - MAX_PER_COL) },
  ];
  const rows = Math.max(...cols.map((c) => c.items.length + (c.more > 0 ? 1 : 0)), 1);
  const height = 36 + rows * (NODE_H + GAP_Y);
  const width = cols.length * NODE_W + (cols.length - 1) * COL_GAP;
  const pos = new Map<string, { x: number; y: number; col: number }>();
  cols.forEach((c, ci) => {
    const colHeight = c.items.length * (NODE_H + GAP_Y);
    const top = 36 + (rows * (NODE_H + GAP_Y) - colHeight) / 2;
    c.items.forEach((f, i) => {
      if (!pos.has(`${ci}:${f}`)) pos.set(`${ci}:${f}`, { x: ci * (NODE_W + COL_GAP), y: top + i * (NODE_H + GAP_Y), col: ci });
    });
  });
  const links: { a: { x: number; y: number }; b: { x: number; y: number }; key: string; hot: boolean; kind: string }[] = [];
  const link = (fromCol: number, from: string, toCol: number, to: string, kind: string) => {
    const a = pos.get(`${fromCol}:${from}`);
    const b = pos.get(`${toCol}:${to}`);
    if (a && b) links.push({ a, b, key: `${fromCol}:${from}->${toCol}:${to}`, hot: highlight.has(from) && highlight.has(to), kind });
  };
  for (const e of index.out.get(focus) ?? []) link(0, e.to, 1, focus, e.kind);
  for (const e of index.incoming.get(focus) ?? []) link(1, focus, 2, e.from, e.kind);
  for (const f of level1) for (const e of index.incoming.get(f) ?? []) link(2, f, 3, e.from, e.kind);

  return (
    <div className="overflow-x-auto rounded-md border border-border bg-white p-3">
      <svg width={width} height={height} role="img" aria-label={`Dependency neighbourhood of ${focus}`} className="block">
        {cols.map((c, ci) => (
          <text key={c.title} x={ci * (NODE_W + COL_GAP)} y={14} className="fill-[#5f6b7a] text-[11px] font-semibold uppercase">
            {c.title}
          </text>
        ))}
        {links.map((l) => {
          const x1 = l.a.x + NODE_W;
          const y1 = l.a.y + NODE_H / 2;
          const x2 = l.b.x;
          const y2 = l.b.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          return (
            <path
              key={l.key}
              d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
              fill="none"
              stroke={l.hot ? '#0047ab' : '#c9ced6'}
              strokeWidth={l.hot ? 2 : 1}
              strokeDasharray={l.kind === 'type' || l.kind === 'reexport-type' ? '4 3' : l.kind === 'dynamic' ? '1 3' : undefined}
            />
          );
        })}
        {cols.map((c, ci) => (
          <g key={`col-${c.title}`}>
            {c.items.map((f) => {
              const p = pos.get(`${ci}:${f}`);
              if (!p) return null;
              const isTest = index.tests.has(f);
              const isChanged = index.changed.has(f);
              const isFocus = ci === 1;
              return (
                <g key={`${ci}:${f}`} transform={`translate(${p.x},${p.y})`} className="cursor-pointer" onClick={() => onFocus(f)}>
                  <title>{f}</title>
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx={5}
                    fill={isFocus ? '#0047ab' : isChanged ? '#e8eefa' : '#ffffff'}
                    stroke={highlight.has(f) ? '#0047ab' : isChanged ? '#0047ab' : '#d5d9df'}
                    strokeWidth={highlight.has(f) ? 2 : 1}
                  />
                  {isTest ? <rect x={NODE_W - 34} y={6} width={28} height={14} rx={3} fill={isFocus ? '#ffffff' : '#f5f6f8'} stroke="#d5d9df" /> : null}
                  {isTest ? (
                    <text x={NODE_W - 20} y={16.5} textAnchor="middle" className="fill-[#5f6b7a] text-[9px] font-semibold">
                      TEST
                    </text>
                  ) : null}
                  <text x={8} y={17} className={cn('font-mono text-[11px]', isFocus ? 'fill-white' : 'fill-[#1f2329]')}>
                    {short(f, isTest ? 30 : 34)}
                  </text>
                </g>
              );
            })}
            {c.more > 0 ? (
              <text x={ci * (NODE_W + COL_GAP) + 8} y={36 + rows * (NODE_H + GAP_Y) - 10} className="fill-[#5f6b7a] text-[11px]">
                +{c.more} more
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      <p className="mt-2 text-[11px] text-muted-foreground">Click a file to explore it. Dashed lines are type-only imports, dotted lines are dynamic imports. Blue outlines trace the selected recommendation path.</p>
    </div>
  );
}

export function DependencyExplorer({ report, tracedPath }: { report: ImpactReport; tracedPath: string[] }) {
  const index = useIndex(report);
  const initial = (tracedPath[0] && index?.files.includes(tracedPath[0]) ? tracedPath[0] : undefined) ?? report.change.files.find((f) => index?.files.includes(f.path))?.path ?? index?.files[0] ?? '';
  const [focus, setFocus] = useState(initial);
  const [query, setQuery] = useState('');
  if (!index) {
    return <p className="text-sm text-muted-foreground">This report has no dependency graph. Re-run with <code className="font-mono">--include-graph</code> or use the Analyse form.</p>;
  }
  const current = index.files.includes(focus) ? focus : initial;
  const matches = (query ? index.files.filter((f) => f.toLowerCase().includes(query.toLowerCase())) : index.files).slice(0, 200);
  const deps = index.out.get(current) ?? [];
  const dependents = index.incoming.get(current) ?? [];
  const highlight = new Set(tracedPath);
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Source files</CardTitle>
          <CardDescription>{index.files.length} files in the graph</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input placeholder="Filter files" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter files" />
          <ul className="max-h-[480px] overflow-y-auto text-xs">
            {matches.map((f) => (
              <li key={f}>
                <button
                  type="button"
                  onClick={() => setFocus(f)}
                  className={cn('w-full truncate rounded px-2 py-1 text-left font-mono hover:bg-muted', f === current && 'bg-cobalt-soft text-cobalt')}
                  title={f}
                >
                  {index.changed.has(f) ? '● ' : ''}
                  {f}
                </button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <div className="min-w-0 space-y-4">
        <NeighbourhoodGraph index={index} focus={current} onFocus={setFocus} highlight={highlight} />
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Imports ({deps.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <EdgeList edges={deps} side="to" onFocus={setFocus} tests={index.tests} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Reverse dependencies ({dependents.length})</CardTitle>
              <CardDescription>Files that import the selected file</CardDescription>
            </CardHeader>
            <CardContent>
              <EdgeList edges={dependents} side="from" onFocus={setFocus} tests={index.tests} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function EdgeList({ edges, side, onFocus, tests }: { edges: Edge[]; side: 'from' | 'to'; onFocus: (f: string) => void; tests: Set<string> }) {
  if (edges.length === 0) return <p className="text-sm text-muted-foreground">None.</p>;
  return (
    <ul className="divide-y divide-border text-xs">
      {edges.map((e) => {
        const f = e[side];
        return (
          <li key={`${e.from}:${e.line}:${e.to}`} className="flex items-center gap-2 py-1.5">
            <button type="button" className="min-w-0 truncate font-mono text-left hover:text-cobalt" onClick={() => onFocus(f)} title={f}>
              {f}
            </button>
            {tests.has(f) ? <span className="rounded border border-border px-1 text-[10px] text-muted-foreground">test</span> : null}
            <span className="ml-auto shrink-0 text-muted-foreground">
              {e.kind}
              {e.names.length > 0 && !e.names.includes('*') ? ` · ${e.names.slice(0, 3).join(', ')}${e.names.length > 3 ? '…' : ''}` : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
