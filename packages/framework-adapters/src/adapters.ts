import fs from 'node:fs';
import path from 'node:path';
import { asRecord, asStringArray, isRegExpValue, isUnknown, readStaticConfigObject, type StaticValue } from './static-config.js';

export type FrameworkName = 'vitest' | 'jest' | 'node';

export type AliasMap = Record<string, string | string[]>;

export interface ProjectContext {
  /** Absolute project root. */
  root: string;
  /** Project files, POSIX paths relative to root. */
  files: readonly string[];
  /** Parsed root package.json, if present. */
  packageJson?: Record<string, unknown>;
}

export interface FrameworkDetection {
  framework: FrameworkName;
  evidence: string[];
}

export interface TestMatcherSpec {
  /** Glob patterns (picomatch/micromatch syntax), relative to the project root. */
  globs: string[];
  /** Regular expressions tested against the root-relative path (Jest `testRegex`). */
  regexes: string[];
  /** When set, only files under one of these root-relative directories match (Jest `roots`). */
  roots?: string[];
}

export interface FrameworkConfig {
  framework: FrameworkName;
  /** Config file (relative) that the values came from. */
  configFile?: string;
  /** Test inclusion rules; undefined when the framework defaults apply. */
  include?: TestMatcherSpec;
  /** Glob or regex exclusions. */
  exclude?: TestMatcherSpec;
  /** Module aliases understood by the framework. */
  aliases: AliasMap;
  /** Setup files that run before every test (changes to them affect all tests). */
  setupFiles: string[];
  /** Static analysis limitations encountered while reading the config. */
  warnings: string[];
}

export interface RunCommand {
  command: string;
  args: string[];
}

export interface FrameworkAdapter {
  name: FrameworkName;
  displayName: string;
  /** Default test file globs used when the project config does not override them. */
  defaultTestPatterns: string[];
  defaultExcludes: string[];
  configFileNames: string[];
  /** Detect whether a project uses this framework, with the evidence used. */
  detect(ctx: ProjectContext): FrameworkDetection | undefined;
  /** Read framework configuration statically. Never executes the config file. */
  readConfig(ctx: ProjectContext): FrameworkConfig;
  /** Whether a test file's source indicates this framework (for example `from 'vitest'`). */
  sniff(source: string): boolean;
  /** Command that runs exactly the given test files. */
  runCommand(testFiles: readonly string[]): RunCommand;
}

function dependencyNames(pkg: Record<string, unknown> | undefined): Set<string> {
  const names = new Set<string>();
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const deps = pkg?.[field];
    if (deps && typeof deps === 'object') for (const k of Object.keys(deps)) names.add(k);
  }
  return names;
}

function scripts(pkg: Record<string, unknown> | undefined): string[] {
  const s = pkg?.scripts;
  return s && typeof s === 'object' ? Object.values(s as Record<string, unknown>).filter((v): v is string => typeof v === 'string') : [];
}

function findConfigFile(ctx: ProjectContext, names: readonly string[]): string | undefined {
  const set = new Set(ctx.files);
  for (const n of names) if (set.has(n)) return n;
  // Config files can be gitignored or excluded from analysis; fall back to the filesystem.
  for (const n of names) if (fs.existsSync(path.join(ctx.root, n))) return n;
  return undefined;
}

function readText(ctx: ProjectContext, rel: string): string | undefined {
  try {
    return fs.readFileSync(path.join(ctx.root, rel), 'utf8');
  } catch {
    return undefined;
  }
}

function relFromRoot(ctx: ProjectContext, abs: string): string {
  const rel = path.relative(ctx.root, path.resolve(ctx.root, abs)).split(path.sep).join('/');
  return rel;
}

function toAliasTarget(ctx: ProjectContext, value: string): string {
  // Aliases are resolved relative to the project root by the resolver.
  if (path.isAbsolute(value)) {
    const rel = relFromRoot(ctx, value);
    return rel.startsWith('..') ? value : `./${rel}`;
  }
  return value;
}

const JS_CONFIG_EXT = ['ts', 'mts', 'cts', 'js', 'mjs', 'cjs'];

// ---------------------------------------------------------------------------------------------
// Vitest
// ---------------------------------------------------------------------------------------------

export const vitestAdapter: FrameworkAdapter = {
  name: 'vitest',
  displayName: 'Vitest',
  defaultTestPatterns: ['**/*.{test,spec}.?(c|m)[jt]s?(x)'],
  defaultExcludes: ['**/node_modules/**', '**/dist/**'],
  configFileNames: [
    ...JS_CONFIG_EXT.map((e) => `vitest.config.${e}`),
    ...JS_CONFIG_EXT.map((e) => `vite.config.${e}`),
  ],
  detect(ctx) {
    const evidence: string[] = [];
    if (dependencyNames(ctx.packageJson).has('vitest')) evidence.push('package.json depends on vitest');
    const cfg = findConfigFile(ctx, this.configFileNames.filter((n) => n.startsWith('vitest.')));
    if (cfg) evidence.push(`${cfg} present`);
    if (scripts(ctx.packageJson).some((s) => /\bvitest\b/.test(s))) evidence.push('package.json script runs vitest');
    return evidence.length > 0 ? { framework: 'vitest', evidence } : undefined;
  },
  readConfig(ctx) {
    const result: FrameworkConfig = { framework: 'vitest', aliases: {}, setupFiles: [], warnings: [] };
    const file = findConfigFile(ctx, this.configFileNames);
    if (!file) return result;
    const text = readText(ctx, file);
    if (text === undefined) return result;
    result.configFile = file;
    const { value } = readStaticConfigObject(path.join(ctx.root, file), text);
    if (!value) {
      result.warnings.push(`${file}: configuration object could not be read statically; Vitest defaults are used.`);
      return result;
    }
    const test = asRecord(value.test);
    const include = asStringArray(test?.include);
    if (include) result.include = { globs: include.map(stripDot), regexes: [] };
    else if (test?.include !== undefined) result.warnings.push(`${file}: test.include is not a static list; Vitest defaults are used.`);
    const exclude = asStringArray(test?.exclude);
    if (exclude) result.exclude = { globs: exclude.map(stripDot), regexes: [] };
    for (const key of ['setupFiles', 'globalSetup'] as const) {
      const files = asStringArray(test?.[key]);
      if (files) result.setupFiles.push(...files.map((f) => relFromRoot(ctx, f)));
      else if (test?.[key] !== undefined) result.warnings.push(`${file}: test.${key} is not static.`);
    }
    if (test?.projects !== undefined || test?.workspace !== undefined) {
      result.warnings.push(`${file}: Vitest projects/workspaces are not analysed individually; root-level patterns are used.`);
    }
    const alias = asRecord(value.resolve)?.alias;
    collectViteAliases(ctx, alias, result, file);
    return result;
  },
  sniff(source) {
    return /from\s+['"]vitest['"]|require\(\s*['"]vitest['"]\s*\)|\bvi\.(fn|mock|spyOn)\(/.test(source);
  },
  runCommand(testFiles) {
    return { command: 'npx', args: ['vitest', 'run', ...testFiles] };
  },
};

function stripDot(p: string): string {
  return p.replace(/^\.\//, '');
}

function collectViteAliases(ctx: ProjectContext, alias: StaticValue | undefined, result: FrameworkConfig, file: string): void {
  if (alias === undefined) return;
  if (Array.isArray(alias)) {
    for (const entry of alias) {
      const rec = asRecord(entry);
      const find = rec?.find;
      const replacement = rec?.replacement;
      if (typeof find === 'string' && typeof replacement === 'string') result.aliases[find] = toAliasTarget(ctx, replacement);
      else if (isRegExpValue(find) && typeof replacement === 'string') result.aliases[`^${find.$regexp.replace(/^\^/, '')}`] = toAliasTarget(ctx, replacement);
      else result.warnings.push(`${file}: an alias entry could not be read statically.`);
    }
    return;
  }
  const rec = asRecord(alias);
  if (!rec) {
    result.warnings.push(`${file}: resolve.alias could not be read statically.`);
    return;
  }
  for (const [key, val] of Object.entries(rec)) {
    if (typeof val === 'string') result.aliases[key] = toAliasTarget(ctx, val);
    else result.warnings.push(`${file}: alias "${key}" is not a static string (${isUnknown(val) ? val.$unknown : typeof val}).`);
  }
}

// ---------------------------------------------------------------------------------------------
// Jest
// ---------------------------------------------------------------------------------------------

export const jestAdapter: FrameworkAdapter = {
  name: 'jest',
  displayName: 'Jest',
  defaultTestPatterns: ['**/__tests__/**/*.?([mc])[jt]s?(x)', '**/?(*.)+(spec|test).?([mc])[jt]s?(x)'],
  defaultExcludes: ['**/node_modules/**'],
  configFileNames: [...JS_CONFIG_EXT.map((e) => `jest.config.${e}`), 'jest.config.json'],
  detect(ctx) {
    const evidence: string[] = [];
    const deps = dependencyNames(ctx.packageJson);
    for (const d of ['jest', 'ts-jest', 'babel-jest', '@jest/globals']) if (deps.has(d)) evidence.push(`package.json depends on ${d}`);
    const cfg = findConfigFile(ctx, this.configFileNames);
    if (cfg) evidence.push(`${cfg} present`);
    if (ctx.packageJson && typeof ctx.packageJson.jest === 'object') evidence.push('package.json has a "jest" field');
    if (scripts(ctx.packageJson).some((s) => /\bjest\b/.test(s))) evidence.push('package.json script runs jest');
    return evidence.length > 0 ? { framework: 'jest', evidence } : undefined;
  },
  readConfig(ctx) {
    const result: FrameworkConfig = { framework: 'jest', aliases: {}, setupFiles: [], warnings: [] };
    let value: Record<string, StaticValue> | undefined;
    const file = findConfigFile(ctx, this.configFileNames);
    if (file) {
      const text = readText(ctx, file);
      if (text !== undefined) {
        result.configFile = file;
        if (file.endsWith('.json')) {
          try {
            value = JSON.parse(text) as Record<string, StaticValue>;
          } catch {
            result.warnings.push(`${file}: invalid JSON.`);
          }
        } else {
          value = readStaticConfigObject(path.join(ctx.root, file), text).value;
          if (!value) result.warnings.push(`${file}: configuration object could not be read statically; Jest defaults are used.`);
        }
      }
    } else if (ctx.packageJson && typeof ctx.packageJson.jest === 'object' && ctx.packageJson.jest !== null) {
      value = ctx.packageJson.jest as Record<string, StaticValue>;
      result.configFile = 'package.json';
    }
    if (!value) return result;
    const where = result.configFile ?? 'jest config';
    const rootDir = typeof value.rootDir === 'string' ? value.rootDir : '.';
    const sub = (s: string) => s.replace(/<rootDir>/g, rootDir === '.' ? '.' : rootDir).replace(/^\.\//, '');

    const testMatch = asStringArray(value.testMatch);
    const testRegex = value.testRegex;
    const regexes = typeof testRegex === 'string' ? [testRegex] : Array.isArray(testRegex) ? testRegex.filter((r): r is string => typeof r === 'string') : isRegExpValue(testRegex) ? [testRegex.$regexp] : [];
    const roots = asStringArray(value.roots)?.map(sub);
    const scopedRoots = roots && roots.length > 0 && !roots.includes('.') && !roots.includes('') ? roots.map((r) => r.replace(/\/+$/, '')) : undefined;
    if (testMatch) {
      result.include = { globs: testMatch.map(sub), regexes: [], ...(scopedRoots ? { roots: scopedRoots } : {}) };
    } else if (regexes.length > 0) {
      result.include = { globs: [], regexes, ...(scopedRoots ? { roots: scopedRoots } : {}) };
    } else if (scopedRoots) {
      result.include = { globs: [...this.defaultTestPatterns], regexes: [], roots: scopedRoots };
    }
    const ignore = asStringArray(value.testPathIgnorePatterns);
    if (ignore) result.exclude = { globs: [], regexes: ignore.map((r) => r.replace(/<rootDir>\/?/g, '^')) };

    const mapper = asRecord(value.moduleNameMapper);
    if (mapper) {
      for (const [key, val] of Object.entries(mapper)) {
        const target = typeof val === 'string' ? val : asStringArray(val);
        if (target === undefined) {
          result.warnings.push(`${where}: moduleNameMapper "${key}" is not static.`);
          continue;
        }
        const targets = (Array.isArray(target) ? target : [target]).map((t) => t.replace(/<rootDir>/g, path.resolve(ctx.root, rootDir)));
        result.aliases[key.startsWith('^') ? key : `^(?:.*)${key}`] = targets.length === 1 ? (targets[0] as string) : targets;
      }
    }
    for (const key of ['setupFiles', 'setupFilesAfterEnv', 'globalSetup', 'globalTeardown'] as const) {
      const files = asStringArray(value[key]);
      if (files) result.setupFiles.push(...files.map((f) => relFromRoot(ctx, f.replace(/<rootDir>/g, path.resolve(ctx.root, rootDir)))));
    }
    if (value.projects !== undefined) result.warnings.push(`${where}: Jest "projects" are not analysed individually; root-level patterns are used.`);
    if (asRecord(value.transform) && Object.keys(asRecord(value.transform) ?? {}).length > 0) {
      result.warnings.push(`${where}: custom transforms are not applied; files are analysed as plain TypeScript/JavaScript.`);
    }
    return result;
  },
  sniff(source) {
    return /from\s+['"]@jest\/globals['"]|\bjest\.(fn|mock|spyOn|requireActual)\(/.test(source);
  },
  runCommand(testFiles) {
    return { command: 'npx', args: ['jest', '--runTestsByPath', ...testFiles] };
  },
};

// ---------------------------------------------------------------------------------------------
// Node.js test runner
// ---------------------------------------------------------------------------------------------

export const nodeTestAdapter: FrameworkAdapter = {
  name: 'node',
  displayName: 'Node.js test runner',
  // Mirrors the default patterns of `node --test` (Node 21+), including TypeScript variants.
  defaultTestPatterns: [
    '**/*.test.?(c|m)[jt]s',
    '**/*-test.?(c|m)[jt]s',
    '**/*_test.?(c|m)[jt]s',
    '**/test-*.?(c|m)[jt]s',
    '**/test.?(c|m)[jt]s',
    '**/test/**/*.?(c|m)[jt]s',
  ],
  defaultExcludes: ['**/node_modules/**'],
  configFileNames: [],
  detect(ctx) {
    const evidence: string[] = [];
    if (scripts(ctx.packageJson).some((s) => /\bnode\b[^&|;]*--test\b/.test(s))) evidence.push('package.json script runs node --test');
    return evidence.length > 0 ? { framework: 'node', evidence } : undefined;
  },
  readConfig() {
    return { framework: 'node', aliases: {}, setupFiles: [], warnings: [] };
  },
  sniff(source) {
    return /from\s+['"](node:)?test['"]|require\(\s*['"](node:)?test['"]\s*\)/.test(source);
  },
  runCommand(testFiles) {
    return { command: 'node', args: ['--test', ...testFiles] };
  },
};

export const builtinAdapters: readonly FrameworkAdapter[] = [vitestAdapter, jestAdapter, nodeTestAdapter];

export function getAdapter(name: FrameworkName, adapters: readonly FrameworkAdapter[] = builtinAdapters): FrameworkAdapter {
  const adapter = adapters.find((a) => a.name === name);
  if (!adapter) throw new Error(`Unknown test framework: ${name}`);
  return adapter;
}

export function readPackageJson(root: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Detect all frameworks used by a project, in adapter priority order. */
export function detectFrameworks(ctx: ProjectContext, adapters: readonly FrameworkAdapter[] = builtinAdapters): FrameworkDetection[] {
  return adapters.map((a) => a.detect(ctx)).filter((d): d is FrameworkDetection => d !== undefined);
}
