'use client';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ImpactReport } from '@/lib/types';

function download(name: string, type: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExportPanel({ report }: { report: ImpactReport }) {
  const [error, setError] = useState<string>();
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const exportHtml = async () => {
    setError(undefined);
    const res = await fetch('/api/render', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(report) });
    if (!res.ok) {
      setError(((await res.json()) as { error?: string }).error ?? 'Export failed');
      return;
    }
    download(`testimpact-${report.project}-${stamp}.html`, 'text/html', await res.text());
  };
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Export report</CardTitle>
        <CardDescription>The same formats as the CLI: the JSON report and a self-contained HTML report without external resources.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button onClick={() => download(`testimpact-${report.project}-${stamp}.json`, 'application/json', `${JSON.stringify(report, null, 2)}\n`)}>
          <Download className="size-4" /> JSON
        </Button>
        <Button variant="outline" onClick={() => void exportHtml()}>
          <Download className="size-4" /> HTML
        </Button>
        {error ? <p className="w-full text-sm text-warn">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
