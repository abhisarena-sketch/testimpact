import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { isParseable, parseModule, type ParseOptions } from './parse.js';
import { ModuleResolver, type AliasMap, type Resolution } from './resolver.js';
import type { ImportKind, ModuleInfo, ReexportBinding } from './types.js';

export interface GraphEdge {
  from: string;
  to: string;
  kind: ImportKind;
  specifier: string;
  line: number;
  /** Imported names (`*` for the whole module). */
  names: string[];
  reexports?: ReexportBinding[];
  via: Extract<Resolution, { kind: 'internal' }>['via'];
}

export interface UnresolvedImport {
  from: string;
  specifier: string;
  kind: ImportKind;
  line: number;
  reason: string;
  /** For relative imports: the path the specifier points at, without extension resolution. */
  candidate?: string;
}

export interface GraphNode {
  path: string;
  /** Parsed module information; undefined for non-code files (JSON, CSS, assets). */
  info?: ModuleInfo;
}

export interface SerializedGraph {
  nodes: { path: string; parsed: boolean }[];
  edges: GraphEdge[];
  unresolved: UnresolvedImport[];
}

/** Directed module dependency graph with forward and reverse adjacency. */
export class DependencyGraph {
  readonly nodes = new Map<string, GraphNode>();
  private readonly outEdges = new Map<string, GraphEdge[]>();
  private readonly inEdges = new Map<string, GraphEdge[]>();
  readonly unresolved: UnresolvedImport[] = [];
  /** Specifiers of packages imported from outside the project, per file. */
  readonly externals = new Map<string, Set<string>>();

  addNode(node: GraphNode): void {
    this.nodes.set(node.path, node);
  }

  addEdge(edge: GraphEdge): void {
    const out = this.outEdges.get(edge.from) ?? [];
    out.push(edge);
    this.outEdges.set(edge.from, out);
    const incoming = this.inEdges.get(edge.to) ?? [];
    incoming.push(edge);
    this.inEdges.set(edge.to, incoming);
  }

  has(file: string): boolean {
    return this.nodes.has(file);
  }

  /** Edges from `file` to the modules it imports. */
  dependencies(file: string): readonly GraphEdge[] {
    return this.outEdges.get(file) ?? [];
  }

  /** Edges from modules that import `file` (reverse dependencies). */
  dependents(file: string): readonly GraphEdge[] {
    return this.inEdges.get(file) ?? [];
  }

  get edgeCount(): number {
    let n = 0;
    for (const edges of this.outEdges.values()) n += edges.length;
    return n;
  }

  allEdges(): GraphEdge[] {
    return [...this.outEdges.values()].flat();
  }

  /** All files that transitively depend on `file`, with their shortest distance. */
  transitiveDependents(file: string, maxDepth = Infinity): Map<string, number> {
    const seen = new Map<string, number>([[file, 0]]);
    let frontier = [file];
    let depth = 0;
    while (frontier.length > 0 && depth < maxDepth) {
      depth++;
      const next: string[] = [];
      for (const f of frontier) {
        for (const edge of this.dependents(f)) {
          if (!seen.has(edge.from)) {
            seen.set(edge.from, depth);
            next.push(edge.from);
          }
        }
      }
      frontier = next;
    }
    seen.delete(file);
    return seen;
  }

  /** Strongly connected components with more than one member (import cycles), via Tarjan's algorithm. */
  findCycles(): string[][] {
    let index = 0;
    const indices = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const cycles: string[][] = [];

    const strongConnect = (start: string) => {
      // Iterative to avoid stack overflow on deep graphs.
      const work: { node: string; edgeIndex: number }[] = [{ node: start, edgeIndex: 0 }];
      indices.set(start, index);
      low.set(start, index);
      index++;
      stack.push(start);
      onStack.add(start);
      while (work.length > 0) {
        const frame = work[work.length - 1] as { node: string; edgeIndex: number };
        const edges = this.dependencies(frame.node);
        if (frame.edgeIndex < edges.length) {
          const target = (edges[frame.edgeIndex] as GraphEdge).to;
          frame.edgeIndex++;
          if (!indices.has(target)) {
            indices.set(target, index);
            low.set(target, index);
            index++;
            stack.push(target);
            onStack.add(target);
            work.push({ node: target, edgeIndex: 0 });
          } else if (onStack.has(target)) {
            low.set(frame.node, Math.min(low.get(frame.node) as number, indices.get(target) as number));
          }
        } else {
          work.pop();
          const parent = work[work.length - 1];
          if (parent) low.set(parent.node, Math.min(low.get(parent.node) as number, low.get(frame.node) as number));
          if (low.get(frame.node) === indices.get(frame.node)) {
            const component: string[] = [];
            let member: string | undefined;
            do {
              member = stack.pop() as string;
              onStack.delete(member);
              component.push(member);
            } while (member !== frame.node);
            if (component.length > 1) cycles.push(component.sort());
          }
        }
      }
    };
    for (const node of this.nodes.keys()) if (!indices.has(node)) strongConnect(node);
    return cycles;
  }

  toJSON(): SerializedGraph {
    return {
      nodes: [...this.nodes.values()].map((n) => ({ path: n.path, parsed: n.info !== undefined })),
      edges: this.allEdges(),
      unresolved: this.unresolved,
    };
  }
}

/** Cache of parsed module information keyed by file path and content hash. */
export interface ParseCache {
  get(file: string): { hash: string; mtimeMs: number; size: number; info: ModuleInfo } | undefined;
  set(file: string, entry: { hash: string; mtimeMs: number; size: number; info: ModuleInfo }): void;
}

export interface BuildGraphOptions extends ParseOptions {
  root: string;
  /** Project files, POSIX paths relative to root. */
  files: readonly string[];
  tsconfig?: string;
  aliases?: AliasMap;
  pathAliases?: boolean;
  concurrency?: number;
  cache?: ParseCache;
  /** Cache key component: parse options change invalidates cached entries. */
  readFile?: (absPath: string) => Promise<string>;
  /** Files larger than this are not parsed (default 2 MiB) and are reported as warnings. */
  maxFileSize?: number;
}

export interface BuildGraphStats {
  files: number;
  parsed: number;
  reusedFromCache: number;
  edges: number;
  unresolved: number;
  skippedLarge: number;
  readMs: number;
  parseMs: number;
  resolveMs: number;
  totalMs: number;
}

export interface BuildGraphResult {
  graph: DependencyGraph;
  stats: BuildGraphStats;
  warnings: string[];
  resolver: ModuleResolver;
}

function hashContent(text: string): string {
  return createHash('sha1').update(text).digest('hex');
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

const now = () => performance.now();

/**
 * Build the dependency graph for `files`. Parsing is syntax-only (TypeScript compiler API),
 * cached by content hash, and file reads run with bounded concurrency.
 */
export async function buildDependencyGraph(options: BuildGraphOptions): Promise<BuildGraphResult> {
  const t0 = now();
  const root = path.resolve(options.root);
  const known = new Set(options.files);
  const graph = new DependencyGraph();
  const warnings: string[] = [];
  const maxSize = options.maxFileSize ?? 2 * 1024 * 1024;
  const readFile = options.readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const parseOpts: ParseOptions = {
    imports: options.imports,
    exports: options.exports,
    dynamicImports: options.dynamicImports,
    mockReferences: options.mockReferences,
  };

  let parsed = 0;
  let reused = 0;
  let skippedLarge = 0;
  let readMs = 0;
  let parseMs = 0;

  const parseable = options.files.filter(isParseable);
  for (const file of options.files) graph.addNode({ path: file });

  await mapLimit(parseable, options.concurrency ?? 32, async (file) => {
    const abs = path.join(root, file);
    const r0 = now();
    let stat: { mtimeMs: number; size: number };
    try {
      const s = await fs.stat(abs);
      stat = { mtimeMs: s.mtimeMs, size: s.size };
    } catch {
      return;
    }
    const cached = options.cache?.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      graph.addNode({ path: file, info: cached.info });
      reused++;
      readMs += now() - r0;
      return;
    }
    if (stat.size > maxSize) {
      skippedLarge++;
      warnings.push(`Skipped ${file}: larger than ${Math.round(maxSize / 1024)} KiB`);
      return;
    }
    let text: string;
    try {
      text = await readFile(abs);
    } catch {
      return;
    }
    const hash = hashContent(text);
    readMs += now() - r0;
    if (cached && cached.hash === hash) {
      options.cache?.set(file, { ...cached, mtimeMs: stat.mtimeMs, size: stat.size });
      graph.addNode({ path: file, info: cached.info });
      reused++;
      return;
    }
    const p0 = now();
    const info = parseModule(file, text, parseOpts);
    parseMs += now() - p0;
    parsed++;
    options.cache?.set(file, { hash, mtimeMs: stat.mtimeMs, size: stat.size, info });
    graph.addNode({ path: file, info });
  });

  const s0 = now();
  const resolver = new ModuleResolver({
    root,
    knownFiles: known,
    tsconfig: options.tsconfig,
    aliases: options.aliases,
    pathAliases: options.pathAliases,
  });
  for (const node of [...graph.nodes.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    if (!node.info) continue;
    for (const imp of node.info.imports) {
      const res = resolver.resolve(imp.specifier, node.path);
      switch (res.kind) {
        case 'internal':
          if (res.path === node.path) break;
          graph.addEdge({
            from: node.path,
            to: res.path,
            kind: imp.kind,
            specifier: imp.specifier,
            line: imp.line,
            names: imp.names,
            via: res.via,
            ...(imp.reexports ? { reexports: imp.reexports } : {}),
          });
          break;
        case 'external':
        case 'builtin': {
          const set = graph.externals.get(node.path) ?? new Set<string>();
          set.add(res.name);
          graph.externals.set(node.path, set);
          break;
        }
        case 'excluded':
          break;
        case 'unresolved':
          graph.unresolved.push({
            from: node.path,
            specifier: imp.specifier,
            kind: imp.kind,
            line: imp.line,
            reason: res.reason,
            ...(res.candidate ? { candidate: res.candidate } : {}),
          });
          break;
      }
    }
  }
  const resolveMs = now() - s0;
  warnings.push(...resolver.warnings);

  return {
    graph,
    resolver,
    warnings,
    stats: {
      files: options.files.length,
      parsed,
      reusedFromCache: reused,
      edges: graph.edgeCount,
      unresolved: graph.unresolved.length,
      skippedLarge,
      readMs: Math.round(readMs),
      parseMs: Math.round(parseMs),
      resolveMs: Math.round(resolveMs),
      totalMs: Math.round(now() - t0),
    },
  };
}
