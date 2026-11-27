import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDependencyGraph, ModuleResolver, type DependencyGraph, type ParseCache } from '@testimpact/dependency-analyzer';
import { createTempProject, fixturePath, listFiles, removeTemp } from '../../../tests/helpers/fixture.js';

const root = fixturePath('web-app');
const files = listFiles(root);
let graph: DependencyGraph;

beforeAll(async () => {
  const result = await buildDependencyGraph({ root, files, aliases: { '~utils': './src/utils' } });
  graph = result.graph;
});

const deps = (file: string) => graph.dependencies(file).map((e) => `${e.kind}:${e.to}`).sort();
const dependents = (file: string) => graph.dependents(file).map((e) => e.from).sort();

describe('dependency graph on the web-app fixture', () => {
  it('resolves relative imports, .js extension mapping and tsconfig path aliases', () => {
    expect(deps('src/auth/login.ts')).toEqual(['static:src/auth/session.ts', 'static:src/lib/http.ts', 'type:src/types.ts']);
    expect(deps('src/auth/token.ts')).toEqual(['static:src/utils/crypto.ts']);
  });

  it('resolves barrel re-exports and records their bindings', () => {
    const edges = graph.dependencies('src/auth/index.ts');
    expect(edges.map((e) => `${e.kind}:${e.to}`).sort()).toEqual(['reexport-type:src/types.ts', 'reexport:src/auth/login.ts', 'reexport:src/auth/session.ts']);
    expect(edges.find((e) => e.to === 'src/auth/login.ts')?.reexports).toEqual([
      { exported: 'login', imported: 'login' },
      { exported: 'logout', imported: 'logout' },
    ]);
  });

  it('resolves directory imports to index files, configured aliases and CSS assets', () => {
    expect(deps('src/components/LoginForm.tsx')).toEqual([
      'side-effect:src/components/LoginForm.css',
      'static:src/auth/index.ts',
      'static:src/utils/format.ts',
    ]);
    expect(deps('tests/integration/session.flow.test.ts')).toEqual(['static:src/auth/index.ts']);
  });

  it('follows statically discoverable dynamic imports and reports the rest', async () => {
    expect(deps('src/pages/lazy.ts')).toEqual(['dynamic:src/components/LoginForm.tsx']);
    const result = await buildDependencyGraph({ root, files });
    const info = result.graph.nodes.get('src/pages/lazy.ts')?.info;
    expect(info?.dynamicUnresolved).toHaveLength(1);
  });

  it('computes reverse dependencies', () => {
    expect(dependents('src/auth/login.ts')).toEqual(['src/auth/index.ts', 'src/auth/login.test.ts']);
    expect(dependents('src/auth/index.ts')).toEqual(['src/components/LoginForm.tsx', 'tests/integration/auth.integration.test.ts', 'tests/integration/session.flow.test.ts']);
    const transitive = graph.transitiveDependents('src/utils/crypto.ts');
    expect(transitive.get('src/auth/token.ts')).toBe(1);
    expect(transitive.get('src/auth/session.ts')).toBe(2);
    // session.ts is re-exported by the barrel directly, so the shortest path is 5 hops.
    expect(transitive.get('src/components/LoginForm.test.tsx')).toBe(5);
  });

  it('handles circular dependencies', () => {
    expect(graph.findCycles()).toEqual([['src/cycle/a.ts', 'src/cycle/b.ts']]);
    const t = graph.transitiveDependents('src/cycle/b.ts');
    expect([...t.keys()].sort()).toEqual(['src/cycle/a.test.ts', 'src/cycle/a.ts']);
  });

  it('ignores external packages but records them', () => {
    expect(graph.externals.get('src/auth/login.test.ts')).toEqual(new Set(['vitest']));
  });

  it('honours the pathAliases switch', async () => {
    const result = await buildDependencyGraph({ root, files, pathAliases: false });
    expect(result.graph.dependencies('src/auth/login.ts').map((e) => e.to)).toEqual(['src/auth/session.ts']);
  });

  it('serialises to JSON', () => {
    const json = graph.toJSON();
    expect(json.nodes.length).toBe(files.length);
    expect(json.edges.length).toBe(graph.edgeCount);
  });
});

describe('incremental parsing with a cache', () => {
  let dir: string;
  beforeAll(() => {
    dir = createTempProject({ 'a.ts': "import { b } from './b';\nexport const a = b;\n", 'b.ts': 'export const b = 1;\n' });
  });
  afterAll(() => removeTemp(dir));

  it('reuses unchanged files and re-parses changed ones', async () => {
    const store = new Map<string, Parameters<ParseCache['set']>[1]>();
    const cache: ParseCache = { get: (f) => store.get(f), set: (f, e) => void store.set(f, e) };
    const first = await buildDependencyGraph({ root: dir, files: ['a.ts', 'b.ts'], cache });
    expect(first.stats).toMatchObject({ parsed: 2, reusedFromCache: 0 });
    const second = await buildDependencyGraph({ root: dir, files: ['a.ts', 'b.ts'], cache });
    expect(second.stats).toMatchObject({ parsed: 0, reusedFromCache: 2 });
    fs.writeFileSync(path.join(dir, 'b.ts'), "import { a } from './a';\nexport const b = 2;\n");
    const third = await buildDependencyGraph({ root: dir, files: ['a.ts', 'b.ts'], cache });
    expect(third.stats).toMatchObject({ parsed: 1, reusedFromCache: 1 });
    expect(third.graph.dependencies('b.ts').map((e) => e.to)).toEqual(['a.ts']);
  });
});

describe('ModuleResolver', () => {
  let dir: string;
  beforeAll(() => {
    dir = createTempProject({
      'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '#shared/*': ['shared/*'] } } }),
      'packages/app/tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '~/*': ['src/*'] } } }),
      'packages/app/src/main.ts': "import { util } from '@acme/lib';\nimport { x } from '~/x';\n",
      'packages/app/src/x.ts': 'export const x = 1;\n',
      'packages/lib/package.json': JSON.stringify({ name: '@acme/lib', exports: { '.': './src/index.ts' } }),
      'packages/lib/src/index.ts': 'export const util = 1;\n',
      'shared/s.ts': 'export {}\n',
      'src/a.ts': '',
      'node_modules/left-pad/package.json': JSON.stringify({ name: 'left-pad', main: 'index.js' }),
      'node_modules/left-pad/index.js': 'module.exports = 1',
    });
    fs.mkdirSync(path.join(dir, 'node_modules/@acme'), { recursive: true });
    fs.symlinkSync(path.join(dir, 'packages/lib'), path.join(dir, 'node_modules/@acme/lib'), 'dir');
  });
  afterAll(() => removeTemp(dir));

  it('uses the nearest tsconfig, follows workspace symlinks and classifies externals', () => {
    const known = new Set(['packages/app/src/main.ts', 'packages/app/src/x.ts', 'packages/lib/src/index.ts', 'shared/s.ts', 'src/a.ts']);
    const r = new ModuleResolver({ root: dir, knownFiles: known, aliases: { '^@jest/(.*)$': '<rootDir>/shared/$1' } });
    expect(r.resolve('~/x', 'packages/app/src/main.ts')).toEqual({ kind: 'internal', path: 'packages/app/src/x.ts', via: 'tsconfig-paths' });
    expect(r.resolve('@acme/lib', 'packages/app/src/main.ts')).toMatchObject({ kind: 'internal', path: 'packages/lib/src/index.ts' });
    expect(r.resolve('#shared/s', 'src/a.ts')).toMatchObject({ kind: 'internal', path: 'shared/s.ts' });
    expect(r.resolve('@jest/s', 'src/a.ts')).toMatchObject({ kind: 'internal', path: 'shared/s.ts', via: 'alias' });
    expect(r.resolve('left-pad', 'src/a.ts')).toEqual({ kind: 'external', name: 'left-pad' });
    expect(r.resolve('node:fs', 'src/a.ts')).toEqual({ kind: 'builtin', name: 'node:fs' });
    expect(r.resolve('fs', 'src/a.ts')).toEqual({ kind: 'builtin', name: 'fs' });
    expect(r.resolve('./missing', 'src/a.ts')).toEqual({ kind: 'unresolved', reason: 'file not found', candidate: 'src/missing' });
  });
});
