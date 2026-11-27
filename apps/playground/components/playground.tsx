'use client';
import { FileJson, Play } from 'lucide-react';
import { useRef, useState } from 'react';
import { Dashboard } from '@/components/dashboard';
import { DependencyExplorer } from '@/components/dependency-explorer';
import { ExportPanel } from '@/components/export-panel';
import { TestExplorer } from '@/components/test-explorer';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ImpactReport } from '@/lib/types';
import { asReport } from '@/lib/validate';

type SourceKind = 'uncommitted' | 'staged' | 'base' | 'commit' | 'files';

const SAMPLE = { root: 'tests/fixtures/web-app', kind: 'files' as SourceKind, files: 'src/auth/login.ts' };

const selectClass = 'h-9 rounded-md border border-border bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-cobalt/30';

export function Playground() {
  const [report, setReport] = useState<ImpactReport>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [root, setRoot] = useState(SAMPLE.root);
  const [kind, setKind] = useState<SourceKind>(SAMPLE.kind);
  const [value, setValue] = useState(SAMPLE.files);
  const [mode, setMode] = useState('recommended');
  const [threshold, setThreshold] = useState('medium');
  const [tab, setTab] = useState('dashboard');
  const [selectedId, setSelectedId] = useState<string>();
  const [traced, setTraced] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const run = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const body: Record<string, string> = { root, kind, mode, threshold };
      if (kind === 'files') body.files = value;
      if (kind === 'base') body.base = value;
      if (kind === 'commit') body.commit = value;
      const res = await fetch('/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error((json as { error?: string }).error ?? `Analysis failed (${res.status})`);
      setReport(asReport(json));
      setSelectedId(undefined);
      setTraced([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const load = async (file: File) => {
    setError(undefined);
    try {
      setReport(asReport(JSON.parse(await file.text())));
      setSelectedId(undefined);
      setTraced([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const placeholder = kind === 'files' ? 'src/auth/login.ts, src/utils/' : kind === 'base' ? 'main' : kind === 'commit' ? 'HEAD' : '';

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Workfonic Labs</div>
          <h1 className="text-2xl font-semibold">
            Test<span className="text-cobalt">Impact</span> playground
          </h1>
          <p className="text-sm text-muted-foreground">Change code. Know what to test.</p>
        </div>
        <p className="max-w-md text-xs text-muted-foreground">
          Runs locally. Results come from real static analysis of the project you choose, or from a JSON report produced by <code className="font-mono">testimpact analyze --format json --include-graph</code>.
        </p>
      </header>

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-end gap-3 pt-4">
          <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs text-muted-foreground">
            Project path (relative to the allowed root)
            <Input value={root} onChange={(e) => setRoot(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Changes
            <select className={selectClass} value={kind} onChange={(e) => setKind(e.target.value as SourceKind)}>
              <option value="uncommitted">Uncommitted</option>
              <option value="staged">Staged</option>
              <option value="base">Against branch</option>
              <option value="commit">Single commit</option>
              <option value="files">Files or directories</option>
            </select>
          </label>
          {kind === 'files' || kind === 'base' || kind === 'commit' ? (
            <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs text-muted-foreground">
              {kind === 'files' ? 'Files (comma-separated)' : kind === 'base' ? 'Base branch' : 'Commit'}
              <Input value={value} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} />
            </label>
          ) : null}
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Selection
            <select className={selectClass} value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="recommended">Recommended only</option>
              <option value="all-candidates">Include low-confidence</option>
              <option value="full">Full suite</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Threshold
            <select className={selectClass} value={threshold} onChange={(e) => setThreshold(e.target.value)}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <Button onClick={() => void run()} disabled={loading}>
            <Play className="size-4" /> {loading ? 'Analysing…' : 'Analyse'}
          </Button>
          <Button variant="outline" onClick={() => fileInput.current?.click()}>
            <FileJson className="size-4" /> Load JSON report
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void load(f);
              e.target.value = '';
            }}
          />
          {error ? <p className="w-full text-sm text-warn">{error}</p> : null}
        </CardContent>
      </Card>

      {report ? (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="dependencies">Dependency explorer</TabsTrigger>
            <TabsTrigger value="tests">Test impact explorer</TabsTrigger>
            <TabsTrigger value="export">Export</TabsTrigger>
          </TabsList>
          <TabsContent value="dashboard">
            <Dashboard
              report={report}
              onSelectTest={(id) => {
                setSelectedId(id);
                setTab('tests');
              }}
            />
          </TabsContent>
          <TabsContent value="dependencies">
            <DependencyExplorer key={`${report.generatedAt}-${traced.join('|')}`} report={report} tracedPath={traced} />
          </TabsContent>
          <TabsContent value="tests">
            <TestExplorer
              report={report}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onTrace={(p) => {
                setTraced(p);
                setTab('dependencies');
              }}
            />
          </TabsContent>
          <TabsContent value="export">
            <ExportPanel report={report} />
          </TabsContent>
        </Tabs>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Choose a project and press <strong className="text-foreground">Analyse</strong>, or load a JSON report. The form is pre-filled with the bundled sample project in{' '}
          <code className="font-mono">tests/fixtures/web-app</code>.
        </div>
      )}
    </main>
  );
}
