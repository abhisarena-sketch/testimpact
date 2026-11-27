import { isBuiltin } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export type Resolution =
  | { kind: 'internal'; path: string; via: 'relative' | 'alias' | 'tsconfig-paths' | 'package' | 'asset' }
  | { kind: 'external'; name: string }
  | { kind: 'builtin'; name: string }
  | { kind: 'excluded'; path: string }
  | { kind: 'unresolved'; reason: string; candidate?: string };

/**
 * Alias rule forms:
 * - wildcard (tsconfig style): `{ "@/*": ["src/*"] }`
 * - prefix (Vite/webpack style): `{ "@": "./src" }` matches `@` and `@/x`
 * - regex (Jest moduleNameMapper): key starting with `^`, `$1` substitutions, `<rootDir>` supported
 */
export type AliasMap = Record<string, string | string[]>;

interface AliasRule {
  match: (specifier: string) => string[] | undefined;
  source: string;
}

function compileAliases(aliases: AliasMap, root: string): AliasRule[] {
  const rules: AliasRule[] = [];
  for (const [key, value] of Object.entries(aliases)) {
    const targets = (Array.isArray(value) ? value : [value]).map((t) => t.replace(/<rootDir>/g, root));
    if (key.startsWith('^') || key.endsWith('$')) {
      let re: RegExp;
      try {
        re = new RegExp(key);
      } catch {
        continue;
      }
      rules.push({
        source: key,
        match: (spec) => {
          const m = re.exec(spec);
          if (!m) return undefined;
          return targets.map((t) => t.replace(/\$(\d+)/g, (_, i: string) => m[Number(i)] ?? ''));
        },
      });
    } else if (key.includes('*')) {
      const [prefix = '', suffix = ''] = key.split('*');
      rules.push({
        source: key,
        match: (spec) => {
          if (!spec.startsWith(prefix) || !spec.endsWith(suffix) || spec.length < prefix.length + suffix.length) return undefined;
          const star = spec.slice(prefix.length, spec.length - suffix.length);
          return targets.map((t) => t.replace('*', star));
        },
      });
    } else {
      rules.push({
        source: key,
        match: (spec) => {
          if (spec === key) return targets;
          if (spec.startsWith(`${key}/`)) return targets.map((t) => `${t.replace(/\/+$/, '')}${spec.slice(key.length)}`);
          return undefined;
        },
      });
    }
  }
  // Longest keys first so more specific aliases win.
  return rules.sort((a, b) => b.source.length - a.source.length);
}

export interface ResolverOptions {
  /** Absolute project root. */
  root: string;
  /** Project files (POSIX, relative to root) that belong to the analysed graph. */
  knownFiles: ReadonlySet<string>;
  /** Explicit tsconfig/jsconfig path (absolute or relative to root). Otherwise the nearest one per file is used. */
  tsconfig?: string;
  /** Additional aliases from configuration or framework config. */
  aliases?: AliasMap;
  /** Whether tsconfig `paths` and aliases are honoured. Default true. */
  pathAliases?: boolean;
}

interface ProjectConfig {
  options: ts.CompilerOptions;
  cache: ts.ModuleResolutionCache;
  file?: string;
}

const RESOLUTION_OVERRIDES: ts.CompilerOptions = {
  allowJs: true,
  resolveJsonModule: true,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  module: ts.ModuleKind.ESNext,
  allowImportingTsExtensions: true,
  noEmit: true,
};

/**
 * Resolves module specifiers to project files using the TypeScript module resolver
 * (honouring tsconfig `baseUrl`/`paths`, package `exports` and extension mapping)
 * plus configured aliases. Never executes project code.
 */
export class ModuleResolver {
  private readonly root: string;
  private readonly knownFiles: ReadonlySet<string>;
  private readonly aliasRules: AliasRule[];
  private readonly pathAliases: boolean;
  private readonly explicitConfig?: ProjectConfig;
  private readonly configByDir = new Map<string, ProjectConfig>();
  private readonly parsedConfigs = new Map<string, ProjectConfig>();
  readonly warnings: string[] = [];
  private readonly host: ts.ModuleResolutionHost;
  private readonly memo = new Map<string, Resolution>();

  constructor(options: ResolverOptions) {
    this.root = path.resolve(options.root);
    this.knownFiles = options.knownFiles;
    this.pathAliases = options.pathAliases !== false;
    this.aliasRules = this.pathAliases ? compileAliases(options.aliases ?? {}, this.root) : [];
    this.host = {
      fileExists: ts.sys.fileExists,
      readFile: ts.sys.readFile,
      directoryExists: ts.sys.directoryExists,
      realpath: ts.sys.realpath,
      getCurrentDirectory: () => this.root,
    };
    if (options.tsconfig) {
      this.explicitConfig = this.loadProjectConfig(path.resolve(this.root, options.tsconfig));
    }
  }

  /** tsconfig files used for resolution so far (relative to root). */
  get configFiles(): string[] {
    return [...this.parsedConfigs.values()].map((c) => c.file).filter((f): f is string => Boolean(f)).map((f) => this.toRel(f) ?? f);
  }

  private toRel(abs: string): string | undefined {
    const rel = path.relative(this.root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return undefined;
    return rel.split(path.sep).join('/');
  }

  private loadProjectConfig(file: string): ProjectConfig {
    const cached = this.parsedConfigs.get(file);
    if (cached) return cached;
    let options: ts.CompilerOptions = {};
    const read = ts.readConfigFile(file, ts.sys.readFile);
    if (read.error) {
      this.warnings.push(`Could not read ${this.toRel(file) ?? file}: ${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}`);
    } else {
      // Parses JSON (including `extends`) only; no project code is executed.
      const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(file), undefined, file);
      options = parsed.options;
    }
    if (!this.pathAliases) {
      delete options.paths;
      delete options.baseUrl;
    }
    const merged = { ...options, ...RESOLUTION_OVERRIDES };
    const config: ProjectConfig = {
      options: merged,
      cache: ts.createModuleResolutionCache(path.dirname(file), (s) => s, merged),
      file,
    };
    this.parsedConfigs.set(file, config);
    return config;
  }

  private configFor(fromAbs: string): ProjectConfig {
    if (this.explicitConfig) return this.explicitConfig;
    const dir = path.dirname(fromAbs);
    const hit = this.configByDir.get(dir);
    if (hit) return hit;
    let current = dir;
    let found: ProjectConfig | undefined;
    while (true) {
      for (const name of ['tsconfig.json', 'jsconfig.json']) {
        const candidate = path.join(current, name);
        if (fs.existsSync(candidate)) {
          found = this.loadProjectConfig(candidate);
          break;
        }
      }
      if (found || current === this.root) break;
      const parent = path.dirname(current);
      if (parent === current || !parent.startsWith(this.root)) break;
      current = parent;
    }
    if (!found) {
      const key = '<default>';
      found = this.parsedConfigs.get(key);
      if (!found) {
        const options = { ...RESOLUTION_OVERRIDES };
        found = { options, cache: ts.createModuleResolutionCache(this.root, (s) => s, options) };
        this.parsedConfigs.set(key, found);
      }
    }
    this.configByDir.set(dir, found);
    return found;
  }

  private classify(absResolved: string, via: Extract<Resolution, { kind: 'internal' }>['via']): Resolution {
    const real = (() => {
      try {
        return fs.realpathSync(absResolved);
      } catch {
        return absResolved;
      }
    })();
    for (const candidate of [absResolved, real]) {
      const rel = this.toRel(candidate);
      if (rel === undefined || rel.split('/').includes('node_modules')) continue;
      if (this.knownFiles.has(rel)) return { kind: 'internal', path: rel, via };
      return { kind: 'excluded', path: rel };
    }
    return { kind: 'external', name: absResolved };
  }

  private tsResolve(specifier: string, fromAbs: string): ts.ResolvedModuleFull | undefined {
    const config = this.configFor(fromAbs);
    const result = ts.resolveModuleName(specifier, fromAbs, config.options, this.host, config.cache);
    return result.resolvedModule;
  }

  /** Resolve `specifier` imported from `fromFile` (POSIX path relative to root). */
  resolve(specifier: string, fromFile: string): Resolution {
    const key = `${fromFile}\0${specifier}`;
    const memo = this.memo.get(key);
    if (memo) return memo;
    const result = this.resolveUncached(specifier, fromFile);
    this.memo.set(key, result);
    return result;
  }

  private resolveUncached(specifier: string, fromFile: string): Resolution {
    if (specifier.startsWith('node:') || isBuiltin(specifier)) return { kind: 'builtin', name: specifier };
    const fromAbs = path.join(this.root, fromFile);
    const isRelative = specifier.startsWith('./') || specifier.startsWith('../') || specifier === '.' || specifier === '..' || specifier.startsWith('/');
    // Strip query strings used by bundlers (`./x.svg?raw`).
    const clean = specifier.replace(/\?.*$/, '');

    if (!isRelative) {
      for (const rule of this.aliasRules) {
        const targets = rule.match(clean);
        if (!targets) continue;
        for (const target of targets) {
          const abs = path.isAbsolute(target) ? target : path.resolve(this.root, target);
          const r = this.resolvePath(abs, fromAbs, 'alias');
          if (r) return r;
        }
      }
    }

    const resolved = this.tsResolve(clean, fromAbs);
    if (resolved) {
      if (resolved.isExternalLibraryImport) {
        const r = this.classify(resolved.resolvedFileName, 'package');
        if (r.kind === 'internal') return r;
        return { kind: 'external', name: packageName(clean) };
      }
      const via = isRelative ? 'relative' : 'tsconfig-paths';
      return this.classify(resolved.resolvedFileName, via);
    }

    if (isRelative) {
      const abs = path.resolve(path.dirname(fromAbs), clean);
      const r = this.resolvePath(abs, fromAbs, 'relative');
      if (r) return r;
      const candidate = this.toRel(abs);
      return { kind: 'unresolved', reason: 'file not found', ...(candidate ? { candidate } : {}) };
    }
    // Bare specifier that TypeScript could not resolve: most likely an uninstalled package.
    return { kind: 'external', name: packageName(clean) };
  }

  /** Resolve an absolute path (from aliases or relative specifiers), including non-code assets. */
  private resolvePath(abs: string, fromAbs: string, via: 'alias' | 'relative'): Resolution | undefined {
    const rel = this.toRel(abs);
    if (rel !== undefined && this.knownFiles.has(rel)) {
      return { kind: 'internal', path: rel, via: via === 'relative' && !/\.[cm]?[jt]sx?$/.test(rel) ? 'asset' : via };
    }
    const relSpec = path.relative(path.dirname(fromAbs), abs).split(path.sep).join('/');
    const spec = relSpec.startsWith('.') ? relSpec : `./${relSpec}`;
    const resolved = this.tsResolve(spec, fromAbs);
    if (resolved) return this.classify(resolved.resolvedFileName, via);
    return undefined;
  }
}

function packageName(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
}
