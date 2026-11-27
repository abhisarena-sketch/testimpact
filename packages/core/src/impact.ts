import path from 'node:path';
import picomatch from 'picomatch';
import {
  computeChangedSymbols,
  isParseable,
  propagateFromDependency,
  type DependencyGraph,
  type GraphEdge,
} from '@testimpact/dependency-analyzer';
import { mappingsForSource, type ResolvedMapping, type TestFileInfo } from '@testimpact/test-discovery';
import { CONFIDENCE_ORDER, type Confidence, type TestImpactConfig } from './config.js';
import type { ChangedFile } from './git.js';
import type { ChangedFileKind, ChangedFileReport, PathStep, Signal, SignalType } from './report.js';

export interface ImpactInput {
  graph: DependencyGraph;
  tests: readonly TestFileInfo[];
  changes: readonly ChangedFile[];
  config: TestImpactConfig;
  setupFiles: readonly string[];
  frameworkConfigFiles: readonly string[];
  mappings: readonly ResolvedMapping[];
  /** test file -> conventionally matching source files */
  conventionMap: ReadonlyMap<string, readonly string[]>;
  /** Synchronous file reader for the file-mention heuristic (root-relative path). */
  readFile: (rel: string) => string | undefined;
  /** Files included in the analysis (graph nodes that exist). */
  analysedFiles: ReadonlySet<string>;
}

export interface Candidate {
  testFile: string;
  confidence: Confidence;
  score: number;
  reason: string;
  reasons: string[];
  signals: Signal[];
  changedFiles: string[];
  path: PathStep[];
  distance: number;
  relatedSourceFiles: string[];
  changedSymbols?: string[];
  warnings: string[];
}

export interface ImpactResult {
  candidates: Candidate[];
  changedFiles: ChangedFileReport[];
  fullSuiteReasons: string[];
  warnings: string[];
}

interface TraversalState {
  file: string;
  narrowed: boolean;
  typeOnly: boolean;
  /** Effective distance: import hops excluding pure re-export (barrel) hops. */
  eff: number;
  hops: number;
  symbols: Set<string> | 'all';
  path: PathStep[];
  /** Exports the importer used from the changed file when symbol analysis applied. */
  usedSymbols?: string[];
  kinds: Set<GraphEdge['kind']>;
  origin: 'graph' | 'dynamic-pattern';
  unaffectedDetail?: string;
}

interface Accumulator {
  testFile: string;
  signals: Signal[];
  changedFiles: Set<string>;
  related: Set<string>;
  bestPath?: { rank: number[]; path: PathStep[]; eff: number; hops: number };
  symbols: Set<string>;
  warnings: Set<string>;
}

const SIGNAL_PRIORITY: SignalType[] = [
  'changed-test',
  'manual-mapping',
  'setup-file',
  'direct-import',
  'barrel-reexport',
  'always-run',
  'transitive-import',
  'mock-reference',
  'type-only',
  'global-config',
  'dynamic-import',
  'unaffected-symbols',
  'dynamic-pattern',
  'naming-convention',
  'file-mention',
  'symbol-match',
];

const BASE_SCORE: Record<Confidence, number> = { high: 80, medium: 50, low: 20 };

function rankOf(state: TraversalState): number[] {
  return [state.narrowed ? 1 : 0, state.typeOnly ? 1 : 0, state.eff, state.hops];
}

function better(a: number[], b: number[] | undefined): boolean {
  if (!b) return true;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    if (x !== y) return x < y;
  }
  return false;
}

function fmtList(names: readonly string[], max = 4): string {
  const shown = names.slice(0, max).map((n) => `\`${n}\``);
  return names.length > max ? `${shown.join(', ')} and ${names.length - max} more` : shown.join(', ');
}

const DELETED_TEST_RE = /(^|\/)(__tests__|__test__)\/|[._-](test|spec)\.[cm]?[jt]sx?$/;

/**
 * Calculate which tests are affected by a set of changes. Every recommendation carries the
 * signals (evidence) that produced it; heuristic signals are always reported as low confidence.
 */
export function calculateImpact(input: ImpactInput): ImpactResult {
  const { graph, config } = input;
  const testSet = new Map(input.tests.map((t) => [t.path, t]));
  const acc = new Map<string, Accumulator>();
  const warnings = new Set<string>();
  const fullSuiteReasons: string[] = [];
  const changedReports: ChangedFileReport[] = [];
  const noImporterTests = new Set<string>();
  const symbolLevel = config.analysis.symbolLevel;
  const maxDepth = config.analysis.maxDepth ?? Infinity;
  const isGlobal = picomatch(config.globalFiles, { dot: true, basename: false });
  const isGlobalBasename = picomatch(config.globalFiles, { dot: true, basename: true });
  const frameworkConfigs = new Set(input.frameworkConfigFiles);
  const setupFiles = new Set(input.setupFiles);

  const get = (test: string): Accumulator => {
    let a = acc.get(test);
    if (!a) {
      a = { testFile: test, signals: [], changedFiles: new Set(), related: new Set(), symbols: new Set(), warnings: new Set() };
      acc.set(test, a);
    }
    return a;
  };
  const addSignal = (test: string, signal: Signal, changedFile?: string) => {
    const a = get(test);
    if (!a.signals.some((s) => s.type === signal.type && s.detail === signal.detail)) a.signals.push(signal);
    if (changedFile) a.changedFiles.add(changedFile);
  };

  // Reverse map for naming conventions: source -> tests
  const conventionBySource = new Map<string, string[]>();
  for (const [test, sources] of input.conventionMap) {
    for (const s of sources) conventionBySource.set(s, [...(conventionBySource.get(s) ?? []), test]);
  }

  // Index dynamic-import prefixes: absolute-ish posix prefix -> importer files
  const dynamicPrefixes: { prefix: string; file: string; expression: string }[] = [];
  for (const node of graph.nodes.values()) {
    for (const d of node.info?.dynamicUnresolved ?? []) {
      if (!d.prefix || !(d.prefix.startsWith('./') || d.prefix.startsWith('../'))) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(node.path), d.prefix));
      if (resolved.startsWith('..')) continue;
      dynamicPrefixes.push({ prefix: d.prefix.endsWith('/') && !resolved.endsWith('/') ? `${resolved}/` : resolved, file: node.path, expression: d.expression });
    }
  }

  const recordGraphHit = (test: string, state: TraversalState, changedFile: string) => {
    const a = get(test);
    a.changedFiles.add(changedFile);
    for (const step of state.path) if (step.file !== test && !testSet.has(step.file)) a.related.add(step.file);
    if (state.usedSymbols && !state.narrowed) for (const s of state.usedSymbols) a.symbols.add(s);
    const rank = rankOf(state);
    if (better(rank, a.bestPath?.rank)) a.bestPath = { rank, path: state.path, eff: state.eff, hops: state.hops };

    const lastEdgeKind = state.path[state.path.length - 1]?.via;
    const target = changedFile;
    let signal: Signal;
    if (state.origin === 'dynamic-pattern') {
      signal = { type: 'dynamic-pattern', confidence: 'low', detail: `May load ${target} through a computed dynamic import (${state.path[1]?.file ?? ''})`, changedFile };
    } else if (state.narrowed) {
      signal = {
        type: 'unaffected-symbols',
        confidence: 'low',
        detail: `Depends on ${target} but only uses exports that did not change${state.unaffectedDetail ? ` (${state.unaffectedDetail})` : ''}`,
        changedFile,
      };
    } else if (state.typeOnly) {
      signal = { type: 'type-only', confidence: 'medium', detail: `Type-only dependency on ${target}: runtime behaviour is unaffected, but type checking may fail`, changedFile };
    } else if (lastEdgeKind === 'mock' && state.eff <= 1) {
      signal = { type: 'mock-reference', confidence: 'medium', detail: `References ${target} through vi.mock()/jest.mock()`, changedFile };
    } else if (state.eff <= 1) {
      const barrels = state.path.slice(1, -1).map((s) => s.file);
      signal =
        barrels.length > 0
          ? { type: 'barrel-reexport', confidence: 'high', detail: `Imports ${target} through the re-export ${barrels.join(' → ')}`, changedFile }
          : { type: 'direct-import', confidence: 'high', detail: `Directly imports the changed file ${target}`, changedFile };
    } else {
      signal = { type: 'transitive-import', confidence: 'medium', detail: `Indirect dependency on ${target} (${state.eff} imports away)`, changedFile };
    }
    addSignal(test, signal, changedFile);
    if (state.kinds.has('dynamic') && !state.narrowed) {
      addSignal(test, { type: 'dynamic-import', confidence: signal.confidence, detail: `Path includes a dynamic import()`, changedFile }, changedFile);
    }
    if (state.usedSymbols && state.usedSymbols.length > 0 && !state.narrowed && state.origin === 'graph') {
      addSignal(test, { type: 'symbol-match', confidence: signal.confidence, detail: `Reaches changed export(s) ${fmtList(state.usedSymbols)}`, changedFile }, changedFile);
    }
  };

  const traverse = (changedFile: string, initial: Set<string> | 'all', seeds?: TraversalState[]) => {
    const best = new Map<string, TraversalState>();
    const queue: TraversalState[] = [];
    const start: TraversalState = {
      file: changedFile,
      narrowed: false,
      typeOnly: false,
      eff: 0,
      hops: 0,
      symbols: initial,
      path: [{ file: changedFile }],
      kinds: new Set(),
      origin: 'graph',
      ...(initial !== 'all' ? { usedSymbols: [...initial] } : {}),
    };
    if (!seeds) {
      queue.push(start);
      best.set(`${changedFile}|false`, start);
    } else {
      for (const s of seeds) {
        queue.push(s);
        best.set(`${s.file}|${s.narrowed}`, s);
        if (testSet.has(s.file)) recordGraphHit(s.file, s, changedFile);
      }
    }
    let depthLimited = false;
    while (queue.length > 0) {
      const state = queue.shift() as TraversalState;
      for (const edge of graph.dependents(state.file)) {
        const importer = edge.from;
        if (importer === changedFile) continue;
        const node = graph.nodes.get(importer);
        let usesAffected = true;
        let nextSymbols: Set<string> | 'all' = 'all';
        if (!state.narrowed && state.symbols !== 'all' && symbolLevel && node?.info) {
          const records = node.info.imports.filter((i) => i.specifier === edge.specifier && i.line === edge.line && i.kind === edge.kind);
          const prop = propagateFromDependency(node.info, records, state.symbols);
          usesAffected = prop.usesAffected;
          nextSymbols = prop.kind === 'all' ? 'all' : new Set(prop.exports);
        }
        const narrowed = state.narrowed || !usesAffected;
        // Symbols the importer uses from the changed file (tracked while the path is direct or through barrels).
        const directOrBarrel = state.path.slice(1).every((step) => step.via === 'reexport' || step.via === 'reexport-type');
        let usedSymbols = state.usedSymbols;
        if (directOrBarrel && state.symbols !== 'all') {
          const affected = state.symbols;
          usedSymbols = edge.names.includes('*') ? [...affected] : edge.names.filter((n) => affected.has(n));
        }
        const isBarrelHop = edge.kind === 'reexport' || edge.kind === 'reexport-type';
        const next: TraversalState = {
          file: importer,
          narrowed,
          typeOnly: state.typeOnly || edge.kind === 'type' || edge.kind === 'reexport-type',
          eff: state.eff + (isBarrelHop ? 0 : 1),
          hops: state.hops + 1,
          symbols: narrowed ? 'all' : nextSymbols,
          path: [...state.path, { file: importer, via: edge.kind, line: edge.line }],
          kinds: new Set([...state.kinds, edge.kind]),
          origin: state.origin,
          ...(usedSymbols ? { usedSymbols } : {}),
          ...(narrowed && !state.narrowed
            ? { unaffectedDetail: `${importer} imports ${fmtList(edge.names.filter((n) => n !== '*'))} from ${state.file}` }
            : state.unaffectedDetail
              ? { unaffectedDetail: state.unaffectedDetail }
              : {}),
        };
        if (next.eff > maxDepth) {
          depthLimited = true;
          continue;
        }
        const key = `${importer}|${narrowed}`;
        const existing = best.get(key);
        let grew = false;
        if (existing && existing.symbols !== 'all') {
          if (next.symbols === 'all') grew = true;
          else for (const s of next.symbols) if (!existing.symbols.has(s)) grew = true;
        }
        const improved = !existing || better(rankOf(next), rankOf(existing));
        if (!improved && !grew) continue;
        if (existing && !improved) {
          // Keep the better path; widen the symbol set.
          existing.symbols = next.symbols === 'all' || existing.symbols === 'all' ? 'all' : new Set([...existing.symbols, ...next.symbols]);
          queue.push(existing);
          continue;
        }
        if (existing && existing.symbols !== 'all' && next.symbols !== 'all') next.symbols = new Set([...existing.symbols, ...next.symbols]);
        else if (existing?.symbols === 'all') next.symbols = 'all';
        best.set(key, next);
        if (testSet.has(importer)) recordGraphHit(importer, next, changedFile);
        if (isBarrelHop) queue.unshift(next);
        else queue.push(next);
      }
    }
    if (depthLimited) warnings.add(`Traversal from ${changedFile} stopped at maxDepth ${maxDepth}; more distant tests are not listed.`);
    let n = 0;
    for (const key of best.keys()) if (testSet.has(key.split('|')[0] as string)) n++;
    return n;
  };

  for (const change of input.changes) {
    const file = change.path;
    const notes: string[] = [];
    const exists = change.status !== 'deleted';
    const isTest = testSet.has(file) || (!exists && DELETED_TEST_RE.test(file));
    let kind: ChangedFileKind = 'other';
    if (setupFiles.has(file)) kind = 'setup';
    else if (isTest) kind = 'test';
    else if (frameworkConfigs.has(file) || isGlobal(file) || (!file.includes('/') && isGlobalBasename(file))) kind = 'config';
    else if (isParseable(file)) kind = 'source';
    else if (graph.has(file) || input.analysedFiles.has(file)) kind = 'asset';

    const report: ChangedFileReport = {
      path: file,
      status: change.status,
      ...(change.oldPath ? { oldPath: change.oldPath } : {}),
      kind,
      inGraph: graph.has(file) && !graph.nodes.get(file)?.deleted,
      ...(change.changedLines ? { changedLines: change.changedLines } : {}),
      testsAffected: 0,
      notes,
    };
    changedReports.push(report);

    if (kind === 'setup') {
      fullSuiteReasons.push(`Setup file ${file} changed; it runs before every test.`);
      for (const t of input.tests) addSignal(t.path, { type: 'setup-file', confidence: 'high', detail: `Setup file ${file} runs before every test`, changedFile: file }, file);
      notes.push('Setup file: every test is affected.');
      continue;
    }
    if (kind === 'config') {
      fullSuiteReasons.push(`Project configuration ${file} changed.`);
      for (const t of input.tests) addSignal(t.path, { type: 'global-config', confidence: 'medium', detail: `Project-wide configuration changed (${file})`, changedFile: file }, file);
      notes.push('Project-wide configuration: the full suite is recommended.');
      continue;
    }

    if (isTest) {
      if (exists) addSignal(file, { type: 'changed-test', confidence: 'high', detail: 'Test file was changed', changedFile: file }, file);
      else notes.push('Deleted test file: nothing to run.');
    }

    // Manual mappings (old and new paths).
    for (const p of [file, change.oldPath].filter((x): x is string => Boolean(x))) {
      for (const m of mappingsForSource(p, input.mappings)) {
        for (const t of m.tests) {
          if (!testSet.has(t)) continue;
          addSignal(t, { type: 'manual-mapping', confidence: 'high', detail: `Manual mapping${m.reason ? `: ${m.reason}` : ` (${m.sourcePatterns.join(', ')})`}`, changedFile: file }, file);
        }
      }
    }

    // Naming conventions.
    if (config.analysis.namingConventions && !isTest) {
      for (const t of conventionBySource.get(file) ?? []) {
        addSignal(t, { type: 'naming-convention', confidence: 'low', detail: `Naming convention: ${t} is the conventional test for ${file}`, changedFile: file }, file);
      }
    }

    // Dependency graph traversal.
    let reached = 0;
    const traversalRoots: { file: string; symbols: Set<string> | 'all'; note?: string }[] = [];
    if (graph.has(file)) {
      let symbols: Set<string> | 'all' = 'all';
      const node = graph.nodes.get(file);
      if (change.status === 'modified' && symbolLevel && node?.info) {
        const changed = computeChangedSymbols(node.info, change.changedLines);
        if (changed.kind === 'some') {
          symbols = new Set(changed.exports);
          report.changedExports = changed.exports;
          if (changed.exports.length === 0) report.changedExportsReason = 'No exported declaration changed (only non-exported code, comments or whitespace).';
        } else {
          report.changedExports = 'all';
          report.changedExportsReason = changed.reason;
        }
      } else {
        report.changedExports = 'all';
        report.changedExportsReason = change.status === 'modified' ? 'symbol-level analysis unavailable' : `file ${change.status}`;
      }
      traversalRoots.push({ file, symbols });
    } else if (exists && !input.analysedFiles.has(file)) {
      notes.push('Not part of the analysed file set (check include/exclude).');
    }
    if (change.oldPath && graph.has(change.oldPath)) {
      traversalRoots.push({ file: change.oldPath, symbols: 'all', note: 'old path' });
    }
    for (const r of traversalRoots) {
      if (graph.nodes.get(r.file)?.deleted) {
        const importers = graph.dependents(r.file).length;
        if (importers > 0) notes.push(`${importers} file(s) still import ${r.file}; they will fail to resolve it.`);
      }
      reached += traverse(r.file, r.symbols);
    }

    // Dynamic imports with a static prefix that matches the changed path.
    if (config.analysis.dynamicImports) {
      for (const d of dynamicPrefixes) {
        if (!file.startsWith(d.prefix) || d.file === file) continue;
        const seed: TraversalState = {
          file: d.file,
          narrowed: true,
          typeOnly: false,
          eff: 1,
          hops: 1,
          symbols: 'all',
          path: [{ file }, { file: d.file, via: 'dynamic', line: undefined }],
          kinds: new Set(['dynamic']),
          origin: 'dynamic-pattern',
        };
        reached += traverse(file, 'all', [seed]);
        notes.push(`May be loaded by the computed dynamic import ${d.expression} in ${d.file}.`);
      }
    }

    // Heuristic: tests that mention an unreferenced changed file by name.
    const hasDependents = traversalRoots.some((r) => graph.dependents(r.file).length > 0);
    if (!isTest && !hasDependents && exists) {
      const base = path.posix.basename(file);
      const stem = base.replace(/\.[^.]+$/, '');
      if (stem.length >= 4 && !['index', 'main', 'types', 'utils', 'README'].includes(stem)) {
        for (const t of input.tests) {
          const text = input.readFile(t.path);
          if (text && text.includes(base)) {
            addSignal(t.path, { type: 'file-mention', confidence: 'low', detail: `Test mentions ${base} by name (possible runtime file access)`, changedFile: file }, file);
          }
        }
      }
    }
    if (reached === 0 && kind === 'source') noImporterTests.add(file);
  }

  // Always-run tests.
  if (config.alwaysRun.length > 0 && input.changes.length > 0) {
    const isAlways = picomatch(config.alwaysRun);
    for (const t of input.tests) if (isAlways(t.path)) addSignal(t.path, { type: 'always-run', confidence: 'high', detail: 'Configured to always run (alwaysRun)' });
  }

  const candidates: Candidate[] = [];
  for (const a of acc.values()) {
    if (!testSet.has(a.testFile)) continue;
    const signals = [...a.signals].sort((x, y) => {
      const c = CONFIDENCE_ORDER[y.confidence] - CONFIDENCE_ORDER[x.confidence];
      return c !== 0 ? c : SIGNAL_PRIORITY.indexOf(x.type) - SIGNAL_PRIORITY.indexOf(y.type);
    });
    const top = signals[0];
    if (!top) continue;
    const confidence = top.confidence;
    const eff = a.bestPath?.eff ?? (signals.some((s) => s.type === 'changed-test') ? 0 : 1);
    let score = BASE_SCORE[confidence];
    const has = (t: SignalType) => signals.some((s) => s.type === t);
    if (has('changed-test')) score += 15;
    if (has('manual-mapping')) score += 10;
    if (has('direct-import')) score += 10;
    if (has('barrel-reexport')) score += 8;
    if (has('symbol-match')) score += 6;
    if (has('naming-convention')) score += 3;
    if (a.bestPath && eff > 1) score -= Math.min(25, 5 * (eff - 1));
    score += Math.min(6, 2 * (a.changedFiles.size - 1));
    score = Math.max(1, Math.min(100, score));

    const firstChanged = top.changedFile ?? [...a.changedFiles][0];
    const pathSteps = a.bestPath?.path ?? (firstChanged && firstChanged !== a.testFile ? [{ file: firstChanged }, { file: a.testFile }] : [{ file: a.testFile }]);
    candidates.push({
      testFile: a.testFile,
      confidence,
      score,
      reason: top.detail,
      reasons: signals.map((s) => s.detail),
      signals,
      changedFiles: [...a.changedFiles].sort(),
      path: pathSteps,
      distance: a.bestPath?.hops ?? (pathSteps.length - 1),
      relatedSourceFiles: [...a.related].sort(),
      ...(a.symbols.size > 0 ? { changedSymbols: [...a.symbols].sort() } : {}),
      warnings: [...a.warnings],
    });
  }

  candidates.sort((x, y) => {
    const c = CONFIDENCE_ORDER[y.confidence] - CONFIDENCE_ORDER[x.confidence];
    if (c !== 0) return c;
    if (y.score !== x.score) return y.score - x.score;
    return x.testFile.localeCompare(y.testFile);
  });

  for (const r of changedReports) {
    r.testsAffected = candidates.filter((c) => c.changedFiles.includes(r.path)).length;
    if (noImporterTests.has(r.path)) {
      r.notes.push(
        r.testsAffected === 0
          ? 'No test depends on this file, directly or indirectly. Consider adding a test or a manual mapping.'
          : 'No test imports this file; its recommendations come from mappings or heuristics.',
      );
    }
  }

  return { candidates, changedFiles: changedReports, fullSuiteReasons, warnings: [...warnings] };
}
