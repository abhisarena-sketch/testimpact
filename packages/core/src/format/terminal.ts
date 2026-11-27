import type { Confidence } from '../config.js';
import type { ChangedFileReport, ImpactReport, Recommendation } from '../report.js';

export interface TerminalOptions {
  color?: boolean;
  /** Show low-confidence candidates that are not selected. Default true. */
  showCandidates?: boolean;
  /** Maximum recommendations to print per section. Default 50. */
  limit?: number;
  verbose?: boolean;
}

interface Palette {
  bold: (s: string) => string;
  dim: (s: string) => string;
  accent: (s: string) => string;
  warn: (s: string) => string;
  conf: (c: Confidence, s: string) => string;
}

function palette(color: boolean): Palette {
  const wrap = (open: string, close: string) => (s: string) => (color ? `\u001b[${open}m${s}\u001b[${close}m` : s);
  const bold = wrap('1', '22');
  const dim = wrap('2', '22');
  const blue = wrap('34', '39');
  const yellow = wrap('33', '39');
  return {
    bold,
    dim,
    accent: blue,
    warn: yellow,
    conf: (c, s) => (c === 'high' ? bold(blue(s)) : c === 'medium' ? blue(s) : dim(s)),
  };
}

const STATUS_LETTER: Record<ChangedFileReport['status'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  'type-changed': 'T',
  untracked: '?',
};

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function changedExportsLabel(f: ChangedFileReport): string {
  if (f.kind === 'test') return 'test file';
  if (f.kind === 'config') return 'project configuration';
  if (f.kind === 'setup') return 'test setup file';
  if (f.changedExports === undefined) return f.inGraph ? '' : 'not in dependency graph';
  if (f.changedExports === 'all') return 'whole module';
  if (f.changedExports.length === 0) return 'no exported symbol changed';
  return `exports: ${f.changedExports.join(', ')}`;
}

function recLine(r: Recommendation, p: Palette): string[] {
  const label = p.conf(r.confidence, pad(r.confidence.toUpperCase(), 6));
  return [`  ${p.dim(r.id)}  ${label}  ${r.testFile}`, `                    ${p.dim(r.reason)}`];
}

/** Render a report for the terminal. Plain text when `color` is false. */
export function renderTerminal(report: ImpactReport, options: TerminalOptions = {}): string {
  const p = palette(options.color ?? false);
  const limit = options.limit ?? 50;
  const out: string[] = [];
  out.push(`${p.bold(p.accent('TestImpact'))} ${p.dim(report.tool.version)}  ${p.dim('Change code. Know what to test.')}`, '');

  out.push(`${p.bold('Changes')}  ${p.dim(report.change.description)}`);
  if (report.change.files.length === 0) out.push('  No changed files.');
  const width = Math.min(60, Math.max(20, ...report.change.files.map((f) => f.path.length + 2)));
  for (const f of report.change.files) {
    const from = f.oldPath ? `${f.oldPath} → ` : '';
    out.push(`  ${p.accent(STATUS_LETTER[f.status])} ${pad(from + f.path, width)} ${p.dim(changedExportsLabel(f))}`);
    if (options.verbose) for (const n of f.notes) out.push(`      ${p.dim(n)}`);
  }
  out.push('');

  const selected = report.recommendations.filter((r) => r.selected);
  const others = report.recommendations.filter((r) => !r.selected);
  const s = report.summary;
  if (report.selection.mode === 'full') {
    out.push(`${p.bold('Full test suite')}  ${s.totalTests} tests (mode: full). Ranked recommendations are listed first.`);
  } else {
    out.push(
      `${p.bold('Recommended tests')}  ${s.selected} of ${s.totalTests}${s.totalTests > 0 ? ` (${s.skippedPercent}% not selected)` : ''}  ${p.dim(`threshold: ${report.selection.threshold}`)}`,
    );
  }
  if (report.selection.fullSuiteRecommended) {
    out.push(`  ${p.warn('!')} ${p.warn('Full suite recommended:')} ${report.selection.fullSuiteReasons.join(' ')}`);
  }
  if (selected.length === 0) out.push(`  ${p.dim('No tests meet the confidence threshold.')}`);
  for (const r of selected.slice(0, limit)) out.push(...recLine(r, p));
  if (selected.length > limit) out.push(p.dim(`  … ${selected.length - limit} more (use --format json or the HTML report for the full list)`));

  if (others.length > 0 && options.showCandidates !== false) {
    out.push('', `${p.bold('Other candidates')}  ${p.dim(`${others.length} below the ${report.selection.threshold} threshold (not selected; use --mode all to include)`)}`);
    for (const r of others.slice(0, limit)) out.push(...recLine(r, p));
    if (others.length > limit) out.push(p.dim(`  … ${others.length - limit} more`));
  }

  if (report.runCommands.length > 0) {
    out.push('', p.bold('Run'));
    for (const c of report.runCommands) {
      const line = c.commandLine.length > 400 ? `${c.command} ${c.args.slice(0, 2).join(' ')} … (${c.testCount} test files; use --list)` : c.commandLine;
      out.push(`  ${line}`);
    }
  }

  if (report.warnings.length > 0) {
    out.push('', p.bold('Warnings'));
    for (const w of report.warnings) out.push(`  ${p.warn('!')} ${w}`);
  }

  const st = report.stats;
  out.push(
    '',
    p.dim(
      `Analysed ${st.filesAnalysed} files (${st.filesParsed} parsed, ${st.filesReusedFromCache} from cache), ${st.edges} imports, ${st.testFiles} test files in ${st.timings.totalMs} ms.`,
    ),
  );
  if (report.recommendations.length > 0) out.push(p.dim(`Run \`testimpact explain ${report.recommendations[0]?.id}\` to see why a test was selected.`));
  return out.join('\n');
}

/** Render a single recommendation in detail. */
export function renderExplanation(report: ImpactReport, rec: Recommendation, options: { color?: boolean } = {}): string {
  const p = palette(options.color ?? false);
  const out: string[] = [];
  const row = (k: string, v: string) => out.push(`${p.dim(pad(k, 14))}${v}`);
  out.push(`${p.bold(rec.id)}  ${p.bold(rec.testFile)}`, '');
  row('Confidence', `${p.conf(rec.confidence, rec.confidence.toUpperCase())} ${p.dim(`(score ${rec.score}/100)`)}`);
  row('Framework', `${rec.framework} · ${rec.testKind} test`);
  row('Selected', rec.selected ? 'yes' : `no (below the ${report.selection.threshold} threshold)`);
  row('Reason', rec.reason);
  row('Changed files', rec.changedFiles.join(', ') || '-');
  if (rec.changedSymbols) row('Changed exports', rec.changedSymbols.join(', '));
  out.push('', p.bold('Dependency path'));
  rec.dependencyPathDetail.forEach((step, i) => {
    const note = i === 0 ? 'changed' : `${step.via ?? 'related'}${step.line ? `, line ${step.line}` : ''}`;
    const prefix = i === 0 ? '  ' : `  ${'   '.repeat(i - 1)}└─ `;
    out.push(`${prefix}${step.file}  ${p.dim(`(${note})`)}`);
  });
  if (rec.relatedSourceFiles.length > 0) {
    out.push('', p.bold('Related source files'));
    for (const f of rec.relatedSourceFiles) out.push(`  ${f}`);
  }
  out.push('', p.bold('Evidence'));
  for (const s of rec.signals) out.push(`  ${p.conf(s.confidence, pad(s.confidence.toUpperCase(), 7))} ${pad(s.type, 20)} ${s.detail}`);
  const notes = [...rec.warnings];
  if (rec.confidence === 'low') notes.push('Low confidence: based on heuristics or incomplete mapping. It is not a guarantee that this test covers the change.');
  if (notes.length > 0) {
    out.push('', p.bold('Notes'));
    for (const n of notes) out.push(`  ${p.warn('!')} ${n}`);
  }
  return out.join('\n');
}
