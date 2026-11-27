import picomatch from 'picomatch';

const CODE_EXT_RE = /\.(d\.)?[cm]?[jt]sx?$/i;
const TEST_SUFFIX_RE = /([._-](test|spec|integration|int|e2e|unit|flow))+$/i;
const TEST_DIR_NAMES = new Set(['__tests__', '__test__', 'test', 'tests', 'spec', '__specs__']);
const SOURCE_ROOTS = ['src', 'lib', 'app', 'source'];

function stripExt(p: string): string {
  return p.replace(CODE_EXT_RE, '');
}

/**
 * Candidate source paths (without extension) that a test file conventionally covers.
 * Examples:
 *   src/auth/login.test.ts          -> src/auth/login
 *   src/auth/__tests__/token.test.ts -> src/auth/token
 *   tests/auth/login.spec.ts        -> src/auth/login, lib/auth/login, auth/login
 */
export function conventionalSourceCandidates(testPath: string): string[] {
  const noExt = stripExt(testPath);
  const segments = noExt.split('/');
  const base = (segments.pop() ?? '').replace(TEST_SUFFIX_RE, '');
  if (!base) return [];
  const dirs = segments;
  const candidates = new Set<string>();
  const join = (parts: string[]) => [...parts, base].filter(Boolean).join('/');

  candidates.add(join(dirs));
  const testDirIndex = dirs.findIndex((d) => TEST_DIR_NAMES.has(d));
  if (testDirIndex >= 0) {
    const before = dirs.slice(0, testDirIndex);
    const after = dirs.slice(testDirIndex + 1);
    // src/auth/__tests__/x.test.ts -> src/auth/x
    candidates.add(join([...before, ...after]));
    // tests/auth/x.test.ts -> src/auth/x, lib/auth/x (also inside packages: packages/a/test/x.test.ts -> packages/a/src/x)
    if (dirs[testDirIndex] !== '__tests__' && dirs[testDirIndex] !== '__test__') {
      for (const r of SOURCE_ROOTS) candidates.add(join([...before, r, ...after]));
    }
  }
  return [...candidates];
}

/** Map test files to source files using naming conventions only (a low-confidence heuristic). */
export function mapTestsByConvention(testFiles: readonly string[], sourceFiles: readonly string[]): Map<string, string[]> {
  const byStem = new Map<string, string[]>();
  for (const f of sourceFiles) {
    if (!CODE_EXT_RE.test(f)) continue;
    const stem = stripExt(f);
    const list = byStem.get(stem) ?? [];
    list.push(f);
    byStem.set(stem, list);
    // Directory modules: src/auth/index.ts is the source for tests named auth.test.ts
    if (stem.endsWith('/index')) {
      const dirStem = stem.slice(0, -'/index'.length);
      const dl = byStem.get(dirStem) ?? [];
      dl.push(f);
      byStem.set(dirStem, dl);
    }
  }
  const testSet = new Set(testFiles);
  const result = new Map<string, string[]>();
  for (const test of testFiles) {
    const matches = new Set<string>();
    for (const candidate of conventionalSourceCandidates(test)) {
      for (const src of byStem.get(candidate) ?? []) if (!testSet.has(src) && src !== test) matches.add(src);
    }
    if (matches.size > 0) result.set(test, [...matches].sort());
  }
  return result;
}

export interface ManualMapping {
  source: string[];
  tests: string[];
  reason?: string;
}

export interface ResolvedMapping {
  /** Index of the mapping in configuration. */
  index: number;
  sourcePatterns: string[];
  tests: string[];
  reason?: string;
  /** Test patterns that matched no discovered test file. */
  unmatchedTestPatterns: string[];
}

/** Expand manual mappings' test globs against discovered test files. */
export function resolveManualMappings(mappings: readonly ManualMapping[], testFiles: readonly string[], allFiles: readonly string[] = testFiles): ResolvedMapping[] {
  return mappings.map((m, index) => {
    const tests = new Set<string>();
    const unmatched: string[] = [];
    for (const pattern of m.tests) {
      const isMatch = picomatch(pattern);
      const hits = allFiles.filter((t) => isMatch(t));
      if (hits.length === 0) unmatched.push(pattern);
      for (const h of hits) tests.add(h);
    }
    return { index, sourcePatterns: m.source, tests: [...tests].sort(), ...(m.reason ? { reason: m.reason } : {}), unmatchedTestPatterns: unmatched };
  });
}

/** Return the mappings whose source patterns match `file`. */
export function mappingsForSource(file: string, mappings: readonly ResolvedMapping[]): ResolvedMapping[] {
  return mappings.filter((m) => picomatch(m.sourcePatterns)(file));
}
