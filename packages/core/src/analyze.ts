import fs from 'node:fs';
import path from 'node:path';
import { buildDependencyGraph, isParseable } from '@testimpact/dependency-analyzer';
import { getAdapter, type AliasMap, type FrameworkName } from '@testimpact/framework-adapters';
import { discoverTests, mapTestsByConvention, resolveManualMappings } from '@testimpact/test-discovery';
import { DiskParseCache } from './cache.js';
import { loadConfig, meetsThreshold, type Confidence, type TestImpactConfig } from './config.js';
import { TestImpactError } from './errors.js';
import { createIncludeMatcher, discoverFiles } from './files.js';
import { detectGitChanges, type ChangedFile, type ChangeSource } from './git.js';
import { calculateImpact } from './impact.js';
import { normaliseRelative, relativeToRoot } from './paths.js';
import {
  REPORT_SCHEMA_VERSION,
  type ImpactReport,
  type Recommendation,
  type RunCommandEntry,
  type SelectionMode,
  type TestEntry,
} from './report.js';
import { VERSION } from './version.js';

export interface AnalyzeOptions {
  /** Project root (absolute or relative to cwd). */
  root: string;
  /** What to compare. */
  source: ChangeSource;
  /** Pre-loaded configuration. When omitted, the config file in `root` (or `configPath`) is loaded. */
  config?: TestImpactConfig;
  configPath?: string;
  /** Which tests are marked `selected`. Default `recommended`. */
  mode?: SelectionMode;
  /** Override `confidenceThreshold`. */
  threshold?: Confidence;
  /** Include the dependency graph in the report (used by the playground). */
  includeGraph?: boolean;
  /** Override `cache.enabled`. */
  cache?: boolean;
}

const now = () => performance.now();

function shellQuote(arg: string): string {
  return /^[A-Za-z0-9_./:=@%+-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

async function resolveExplicitFiles(root: string, paths: readonly string[], allFiles: readonly string[], warnings: string[]): Promise<ChangedFile[]> {
  const result = new Map<string, ChangedFile>();
  const known = new Set(allFiles);
  for (const raw of paths) {
    if (raw.includes('\0')) throw new TestImpactError('INVALID_INPUT', 'File paths must not contain NUL bytes.');
    const rel = relativeToRoot(root, raw);
    if (rel === undefined) throw new TestImpactError('INVALID_INPUT', `Path is outside the project root: ${raw}`);
    const norm = normaliseRelative(rel);
    const abs = path.join(root, norm);
    let stat: fs.Stats | undefined;
    try {
      stat = fs.statSync(abs);
    } catch {
      stat = undefined;
    }
    if (norm === '' || stat?.isDirectory()) {
      const prefix = norm === '' ? '' : `${norm}/`;
      const files = allFiles.filter((f) => f.startsWith(prefix));
      if (files.length === 0) warnings.push(`Directory ${norm || '.'} contains no analysed files.`);
      for (const f of files) result.set(f, { path: f, status: 'modified' });
    } else if (stat?.isFile()) {
      result.set(norm, { path: norm, status: 'modified' });
      if (!known.has(norm)) warnings.push(`${norm} is excluded from analysis by include/exclude settings.`);
    } else {
      warnings.push(`${norm} does not exist; it is treated as a deleted file.`);
      result.set(norm, { path: norm, status: 'deleted' });
    }
  }
  return [...result.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Run a full impact analysis: detect changes, discover files and tests, build the dependency
 * graph, and calculate explainable test recommendations. Read-only apart from the cache directory.
 */
export async function analyze(options: AnalyzeOptions): Promise<ImpactReport> {
  const t0 = now();
  const root = path.resolve(options.root);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new TestImpactError('INVALID_INPUT', `Project root does not exist: ${root}`);
  const warnings: string[] = [];

  const config = options.config ?? (await loadConfig(root, options.configPath)).config;
  const tConfig = now();

  // 1. File discovery (all candidate files; include rules are applied to the graph below).
  const discovery = await discoverFiles({ root, include: ['**/*'], exclude: config.exclude, useGitignore: config.useGitignore, concurrency: config.concurrency });
  const allFiles = discovery.files;
  const tFiles = now();

  // 2. Change detection.
  let changes: ChangedFile[];
  let description: string;
  if (options.source.kind === 'files') {
    changes = await resolveExplicitFiles(root, options.source.paths, allFiles, warnings);
    description = `explicitly specified files (${options.source.paths.join(', ')})`;
  } else {
    const detected = await detectGitChanges({ root, source: options.source, lineRanges: config.analysis.symbolLevel });
    changes = detected.changes;
    description = detected.description;
    warnings.push(...detected.warnings);
  }
  const tChanges = now();

  // 3. Test discovery.
  const tests = config.analysis.testDiscovery
    ? await discoverTests({
        root,
        files: allFiles,
        framework: config.testFramework,
        ...(config.testPatterns ? { testPatterns: config.testPatterns } : {}),
        overrides: config.overrides.map((o) => ({ files: o.files, ...(o.testFramework ? { testFramework: o.testFramework } : {}) })),
        concurrency: config.concurrency,
      })
    : undefined;
  if (!tests) warnings.push('Test discovery is disabled (analysis.testDiscovery = false); no tests can be recommended.');
  const testFiles = tests?.tests ?? [];
  warnings.push(...(tests?.warnings ?? []));
  if (tests && testFiles.length === 0) warnings.push('No test files were found. Check "testPatterns" or the test framework configuration.');
  const tTests = now();

  // 4. Dependency graph.
  const isIncluded = createIncludeMatcher(config.include);
  const testPaths = new Set(testFiles.map((t) => t.path));
  const setupFiles = tests?.setupFiles ?? [];
  const graphFiles = allFiles.filter((f) => isIncluded(f) || testPaths.has(f) || setupFiles.includes(f));
  const deletedFiles = changes.flatMap((c) => [c.status === 'deleted' ? c.path : undefined, c.oldPath]).filter((p): p is string => Boolean(p) && isParseable(p as string));
  const aliases: AliasMap = config.analysis.pathAliases ? { ...(tests?.aliases ?? {}), ...config.aliases } : {};
  const parseOptions = {
    imports: config.analysis.imports,
    exports: config.analysis.exports,
    dynamicImports: config.analysis.dynamicImports,
    mockReferences: config.analysis.mockReferences,
  };
  const useCache = options.cache ?? config.cache.enabled;
  const cacheDir = path.resolve(root, config.cache.directory);
  const cache = useCache ? new DiskParseCache(cacheDir, DiskParseCache.optionsKey(parseOptions)) : undefined;
  if (cache) await cache.load();
  const built = await buildDependencyGraph({
    root,
    files: graphFiles,
    ...parseOptions,
    ...(config.tsconfig ? { tsconfig: config.tsconfig } : {}),
    aliases,
    pathAliases: config.analysis.pathAliases,
    concurrency: config.concurrency,
    ...(cache ? { cache } : {}),
    deletedFiles,
  });
  warnings.push(...built.warnings);
  if (cache) {
    cache.prune(new Set(graphFiles));
    try {
      await cache.save();
    } catch (error) {
      warnings.push(`Could not write cache to ${config.cache.directory}: ${(error as Error).message}`);
    }
  }
  const graph = built.graph;
  const tGraph = now();

  // 5. Impact calculation.
  const mappings = resolveManualMappings(
    config.mappings.map((m) => ({ source: m.source, tests: m.tests, ...(m.reason ? { reason: m.reason } : {}) })),
    testFiles.map((t) => t.path),
  );
  for (const m of mappings) {
    for (const p of m.unmatchedTestPatterns) warnings.push(`Manual mapping #${m.index + 1}: test pattern "${p}" matched no discovered test file.`);
  }
  const conventionMap = config.analysis.namingConventions
    ? mapTestsByConvention(
        testFiles.map((t) => t.path),
        graphFiles.filter((f) => !testPaths.has(f)),
      )
    : new Map<string, string[]>();
  const fileCache = new Map<string, string | undefined>();
  const impact = calculateImpact({
    graph,
    tests: testFiles,
    changes,
    config,
    setupFiles,
    frameworkConfigFiles: tests?.configFiles ?? [],
    mappings,
    conventionMap,
    analysedFiles: new Set(graphFiles),
    readFile: (rel) => {
      if (!fileCache.has(rel)) {
        try {
          fileCache.set(rel, fs.readFileSync(path.join(root, rel), 'utf8'));
        } catch {
          fileCache.set(rel, undefined);
        }
      }
      return fileCache.get(rel);
    },
  });
  warnings.push(...impact.warnings);
  const tImpact = now();

  // 6. Selection and report assembly.
  const mode = options.mode ?? 'recommended';
  const threshold = options.threshold ?? config.confidenceThreshold;
  const testInfo = new Map(testFiles.map((t) => [t.path, t]));
  const recommendations: Recommendation[] = impact.candidates.map((c, i) => {
    const info = testInfo.get(c.testFile);
    const selected = mode === 'full' || mode === 'all-candidates' || meetsThreshold(c.confidence, threshold);
    return {
      id: `TEST-${String(i + 1).padStart(3, '0')}`,
      testFile: c.testFile,
      framework: info?.framework ?? tests?.defaultFramework ?? 'vitest',
      testKind: info?.kind ?? 'unit',
      confidence: c.confidence,
      score: c.score,
      reason: c.reason,
      reasons: c.reasons,
      changedFiles: c.changedFiles,
      dependencyPath: c.path.map((s) => s.file),
      dependencyPathDetail: c.path,
      distance: c.distance,
      relatedSourceFiles: c.relatedSourceFiles,
      ...(c.changedSymbols ? { changedSymbols: c.changedSymbols } : {}),
      signals: c.signals,
      selected,
      warnings: c.warnings,
    };
  });
  const recByTest = new Map(recommendations.map((r) => [r.testFile, r]));
  const allTests: TestEntry[] = testFiles.map((t) => {
    const rec = recByTest.get(t.path);
    return {
      path: t.path,
      framework: t.framework,
      kind: t.kind,
      ...(rec ? { recommendationId: rec.id } : {}),
      selected: mode === 'full' || (rec?.selected ?? false),
    };
  });
  const selectedTests = allTests.filter((t) => t.selected).map((t) => t.path);

  // Run commands list tests in rank order (highest-confidence first), then any remaining selected tests.
  const byFramework = new Map<FrameworkName, string[]>();
  const ordered = [
    ...recommendations.filter((r) => allTests.find((t) => t.path === r.testFile)?.selected).map((r) => ({ path: r.testFile, framework: r.framework })),
    ...allTests.filter((t) => t.selected && !recByTest.has(t.path)),
  ];
  for (const t of ordered) byFramework.set(t.framework, [...(byFramework.get(t.framework) ?? []), t.path]);
  const runCommands: RunCommandEntry[] = [...byFramework.entries()].map(([framework, files]) => {
    const cmd = getAdapter(framework).runCommand(files);
    return { framework, command: cmd.command, args: cmd.args, commandLine: [cmd.command, ...cmd.args].map(shellQuote).join(' '), testCount: files.length };
  });

  if (graph.unresolved.length > 0) {
    const first = graph.unresolved[0];
    warnings.push(
      `${graph.unresolved.length} import(s) could not be resolved${first ? ` (for example "${first.specifier}" in ${first.from}:${first.line})` : ''}. Tests that depend on them may be missed.`,
    );
  }
  let dynamicCount = 0;
  for (const n of graph.nodes.values()) dynamicCount += n.info?.dynamicUnresolved.length ?? 0;
  if (dynamicCount > 0) warnings.push(`${dynamicCount} dynamic import()/require() call(s) use computed specifiers and cannot be followed statically.`);
  const cycles = graph.findCycles();
  if (impact.fullSuiteReasons.length > 0) warnings.push(`Full test suite recommended: ${impact.fullSuiteReasons.join(' ')}`);
  if (changes.length === 0) warnings.push('No changed files were detected.');

  const count = (c: Confidence) => recommendations.filter((r) => r.confidence === c).length;
  const mem = process.memoryUsage();
  const tEnd = now();
  const report: ImpactReport = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: { name: 'testimpact', version: VERSION },
    generatedAt: new Date().toISOString(),
    project: path.basename(root),
    change: { source: options.source, description, files: impact.changedFiles },
    selection: { mode, threshold, fullSuiteRecommended: impact.fullSuiteReasons.length > 0, fullSuiteReasons: impact.fullSuiteReasons, selectedTests },
    summary: {
      changedFiles: changes.length,
      totalTests: allTests.length,
      candidates: recommendations.length,
      selected: selectedTests.length,
      high: count('high'),
      medium: count('medium'),
      low: count('low'),
      skippedPercent: allTests.length === 0 ? 0 : Math.round(((allTests.length - selectedTests.length) / allTests.length) * 1000) / 10,
    },
    recommendations,
    allTests,
    runCommands,
    frameworks: tests?.frameworks ?? [],
    warnings: [...new Set(warnings)],
    stats: {
      filesDiscovered: allFiles.length,
      filesAnalysed: graphFiles.length,
      filesParsed: built.stats.parsed,
      filesReusedFromCache: built.stats.reusedFromCache,
      edges: built.stats.edges,
      unresolvedImports: graph.unresolved.length,
      unresolvedDynamicImports: dynamicCount,
      cycles: cycles.length,
      testFiles: testFiles.length,
      fileDiscoveryMethod: discovery.method,
      cacheUsed: Boolean(cache),
      timings: {
        configMs: Math.round(tConfig - t0),
        fileDiscoveryMs: Math.round(tFiles - tConfig),
        changeDetectionMs: Math.round(tChanges - tFiles),
        testDiscoveryMs: Math.round(tTests - tChanges),
        graphMs: Math.round(tGraph - tTests),
        impactMs: Math.round(tImpact - tGraph),
        totalMs: Math.round(tEnd - t0),
      },
      memory: { rssMb: Math.round(mem.rss / 1048576), heapUsedMb: Math.round(mem.heapUsed / 1048576) },
    },
  };
  if (options.includeGraph) report.graph = { ...graph.toJSON(), tests: testFiles.map((t) => t.path) };
  return report;
}
