import fs from 'node:fs/promises';
import path from 'node:path';
import picomatch from 'picomatch';
import {
  builtinAdapters,
  detectFrameworks,
  getAdapter,
  readPackageJson,
  type AliasMap,
  type FrameworkAdapter,
  type FrameworkConfig,
  type FrameworkDetection,
  type FrameworkName,
  type ProjectContext,
  type TestMatcherSpec,
} from '@testimpact/framework-adapters';

export type TestKind = 'unit' | 'integration' | 'e2e';

export interface TestFileInfo {
  path: string;
  framework: FrameworkName;
  kind: TestKind;
  /** Why the framework was assigned to this file. */
  frameworkSource: 'override' | 'source' | 'project';
}

export interface FrameworkOverride {
  files: string[];
  testFramework?: FrameworkName;
}

export interface DiscoverTestsOptions {
  root: string;
  /** Project files (POSIX, relative to root). */
  files: readonly string[];
  /** Force a framework, or detect automatically. */
  framework?: FrameworkName | 'auto';
  /** Explicit test globs. Overrides framework include rules when given. */
  testPatterns?: string[];
  overrides?: FrameworkOverride[];
  adapters?: readonly FrameworkAdapter[];
  /** Read a root-relative file (defaults to fs). Used to sniff the framework of each test file. */
  readFile?: (rel: string) => Promise<string | undefined>;
  concurrency?: number;
}

export interface DiscoverTestsResult {
  tests: TestFileInfo[];
  /** Frameworks in use, with detection evidence. */
  frameworks: FrameworkDetection[];
  /** Default framework for test files whose framework cannot be determined from source. */
  defaultFramework: FrameworkName;
  configs: FrameworkConfig[];
  /** Effective test matcher description per framework. */
  patterns: Partial<Record<FrameworkName, TestMatcherSpec>>;
  /** Setup files declared by framework configs (root-relative). */
  setupFiles: string[];
  /** Framework config files (root-relative). */
  configFiles: string[];
  /** Aliases collected from framework configuration (Vite `resolve.alias`, Jest `moduleNameMapper`). */
  aliases: AliasMap;
  warnings: string[];
  durationMs: number;
}

export function compileMatcher(spec: TestMatcherSpec): (rel: string) => boolean {
  const globMatch = spec.globs.length > 0 ? picomatch(spec.globs, { dot: false }) : undefined;
  const regexes = spec.regexes.flatMap((r) => {
    try {
      return [new RegExp(r)];
    } catch {
      return [];
    }
  });
  const roots = spec.roots;
  return (rel) => {
    if (roots && !roots.some((r) => rel === r || rel.startsWith(`${r}/`))) return false;
    if (globMatch?.(rel)) return true;
    return regexes.some((re) => re.test(rel) || re.test(`/${rel}`));
  };
}

const INTEGRATION_RE = /(^|[/._-])(integration|int)([/._-]|$)/i;
const E2E_RE = /(^|[/._-])(e2e|end-to-end|acceptance)([/._-]|$)/i;

export function classifyTestKind(rel: string): TestKind {
  if (E2E_RE.test(rel)) return 'e2e';
  if (INTEGRATION_RE.test(rel)) return 'integration';
  return 'unit';
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

/**
 * Discover test files and framework configuration for a project.
 * Framework configuration files are read statically; nothing is executed.
 */
export async function discoverTests(options: DiscoverTestsOptions): Promise<DiscoverTestsResult> {
  const t0 = performance.now();
  const root = path.resolve(options.root);
  const adapters = options.adapters ?? builtinAdapters;
  const warnings: string[] = [];
  const ctx: ProjectContext = { root, files: options.files, packageJson: readPackageJson(root) };
  const readFile =
    options.readFile ??
    (async (rel: string) => {
      try {
        return await fs.readFile(path.join(root, rel), 'utf8');
      } catch {
        return undefined;
      }
    });

  let frameworks: FrameworkDetection[];
  if (options.framework && options.framework !== 'auto') {
    frameworks = [{ framework: options.framework, evidence: ['configured in testimpact config'] }];
  } else {
    frameworks = detectFrameworks(ctx, adapters);
    if (frameworks.length === 0) {
      frameworks = [{ framework: 'vitest', evidence: ['no framework detected; Vitest conventions assumed'] }];
      warnings.push('No test framework detected. Vitest-style naming conventions (*.test.*, *.spec.*) are assumed; set "testFramework" to be explicit.');
    }
  }
  const defaultFramework = (frameworks[0] as FrameworkDetection).framework;

  const configs = frameworks.map((f) => getAdapter(f.framework, adapters).readConfig(ctx));
  for (const c of configs) warnings.push(...c.warnings);

  const patterns: Partial<Record<FrameworkName, TestMatcherSpec>> = {};
  const matchers: { framework: FrameworkName; include: (rel: string) => boolean; exclude?: (rel: string) => boolean }[] = [];
  for (const config of configs) {
    const adapter = getAdapter(config.framework, adapters);
    const include: TestMatcherSpec = options.testPatterns
      ? { globs: options.testPatterns, regexes: [] }
      : (config.include ?? { globs: adapter.defaultTestPatterns, regexes: [] });
    patterns[config.framework] = include;
    const exclude = config.exclude ?? { globs: adapter.defaultExcludes, regexes: [] };
    matchers.push({ framework: config.framework, include: compileMatcher(include), exclude: compileMatcher(exclude) });
  }

  const overrideMatchers = (options.overrides ?? [])
    .filter((o) => o.testFramework)
    .map((o) => ({ match: picomatch(o.files), framework: o.testFramework as FrameworkName }));

  const setupFiles = new Set(configs.flatMap((c) => c.setupFiles));
  const candidates: { path: string; frameworks: FrameworkName[] }[] = [];
  for (const file of options.files) {
    if (setupFiles.has(file)) continue;
    const hits = matchers.filter((m) => m.include(file) && !m.exclude?.(file)).map((m) => m.framework);
    if (hits.length > 0) candidates.push({ path: file, frameworks: hits });
  }

  const tests = await mapLimit(candidates, options.concurrency ?? 32, async (c): Promise<TestFileInfo> => {
    const kind = classifyTestKind(c.path);
    const override = overrideMatchers.find((o) => o.match(c.path));
    if (override) return { path: c.path, framework: override.framework, kind, frameworkSource: 'override' };
    if (frameworks.length > 1 || c.frameworks.length > 1) {
      const source = await readFile(c.path);
      if (source !== undefined) {
        for (const f of frameworks) {
          if (getAdapter(f.framework, adapters).sniff(source)) return { path: c.path, framework: f.framework, kind, frameworkSource: 'source' };
        }
      }
    }
    return { path: c.path, framework: c.frameworks[0] ?? defaultFramework, kind, frameworkSource: 'project' };
  });

  const aliases: AliasMap = {};
  for (const c of configs) Object.assign(aliases, c.aliases);
  const configFiles = configs.map((c) => c.configFile).filter((f): f is string => Boolean(f));

  return {
    tests: tests.sort((a, b) => a.path.localeCompare(b.path)),
    frameworks,
    defaultFramework,
    configs,
    patterns,
    setupFiles: [...setupFiles].sort(),
    configFiles,
    aliases,
    warnings,
    durationMs: Math.round(performance.now() - t0),
  };
}
