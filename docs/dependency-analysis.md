# Dependency analysis guide

TestImpact builds a module dependency graph using the TypeScript Compiler API in **syntax-only** mode (`ts.createSourceFile`); there is no type checker and no code execution. This keeps analysis fast and safe, and it is the reason for the limitations listed in [limitations.md](limitations.md).

## What is extracted from each file

| Construct | Example | Edge kind |
|---|---|---|
| Static import | `import { login } from './login'` | `static` |
| Side-effect import | `import './polyfills'` | `side-effect` |
| Type-only import | `import type { User } from './types'`, or every binding marked `type` | `type` |
| Re-export / barrel | `export { login } from './login'`, `export * from './session'`, `export * as utils from './utils'` | `reexport` |
| Type-only re-export | `export type { User } from './types'` | `reexport-type` |
| Import then export | `import { a } from './a'; export { a }` | recorded as a re-export binding |
| Dynamic import | `import('./lazy')`, ``import(`./lazy`)`` | `dynamic` |
| CommonJS | `require('./x')`, `const { a } = require('./x')`, `import x = require('./x')` | `require` |
| Test mocks | `vi.mock('./api')`, `jest.mock('../db')`, `vi.importActual(...)`, `jest.requireActual(...)` | `mock` |
| Computed dynamic import | ``import(`./locales/${lang}.json`)`` | not an edge; recorded with its static prefix (`./locales/`) |

For each file TestImpact also records exported names, top-level declarations with their line ranges, which other top-level names each declaration references, and how often each imported binding is referenced (function and class references). Namespace imports (`import * as auth`) are narrowed to the members actually used (`auth.login`).

## Module resolution

Resolution uses `ts.resolveModuleName` with `moduleResolution: "bundler"`, `allowJs` and `resolveJsonModule`, on top of the compiler options of the **nearest `tsconfig.json`/`jsconfig.json`** to each file (`extends` is followed; JSON only). This covers:

- extensionless and `index` imports, `.js` specifiers that point at `.ts` sources,
- tsconfig `baseUrl` and `paths`,
- package `exports`, workspace packages linked into `node_modules` (followed to their real path, so they count as project files),
- JSON modules.

Before TypeScript resolution, configured aliases are tried: `aliases` from TestImpact config, Vite/Vitest `resolve.alias` (object or array form, string or regex `find`) and Jest `moduleNameMapper`. Imports of non-code files (`./styles.css`, `./logo.svg?raw`) resolve to the asset when the file exists. Node built-ins and third-party packages are recorded as external and ignored.

## Reverse dependencies and impact

For each changed file, TestImpact walks the **reverse** graph (who imports this file?) breadth-first:

- Barrel hops (`reexport` edges) do not increase the effective distance, so a test that imports `login` through `src/auth/index.ts` is still a direct dependent.
- Every path is ranked by (unaffected symbols?, type-only?, effective distance, hops); the best path is reported as `dependencyPath`.
- Cycles are handled by visiting each (file, state) pair at most once per improvement; `stats.cycles` reports strongly connected components (Tarjan's algorithm).
- `analysis.maxDepth` limits the effective distance.

### Symbol-level narrowing

When Git provides changed line ranges, TestImpact maps them to top-level declarations, propagates changes through references inside the file (a changed private helper changes the exported function that calls it), and computes the set of changed exports. That set then flows across edges:

- through re-exports by name (including renamed re-exports and `export *`),
- into an importer through the bindings it imports; the importer's own affected exports are computed the same way.

If an importer only uses exports that did not change, the path is marked *unaffected* and the test is reported as **low** confidence (`unaffected-symbols`), never silently dropped. Changes to top-level statements, side-effect imports, CommonJS modules and files with syntax errors are treated as whole-module changes.

### Deleted and renamed files

Deleted files and the old path of renamed files are added to the graph as virtual nodes, and resolution behaves as if they still existed. Their former importers (which will now fail to resolve) and those importers' tests are reported.

### Other signals

| Signal | Confidence | Source |
|---|---|---|
| `changed-test` | high | the test file itself changed |
| `direct-import` / `barrel-reexport` | high | test imports the changed file (possibly through barrels) |
| `manual-mapping` | high | `mappings` in config |
| `setup-file` | high | a Vitest `setupFiles`/`globalSetup` or Jest `setupFiles*` file changed: all tests |
| `always-run` | high | `alwaysRun` in config |
| `transitive-import` | medium | dependency 2 or more imports away |
| `type-only` | medium | path includes a type-only import |
| `mock-reference` | medium | the test only references the module through `vi.mock`/`jest.mock` |
| `global-config` | medium | `package.json`, lockfile, tsconfig or framework config changed: all tests, full suite recommended |
| `unaffected-symbols` | low | the test depends on the file but only on exports that did not change |
| `naming-convention` | low | naming only (`x.test.ts` ↔ `x.ts`) |
| `dynamic-pattern` | low | a computed `import()` whose static prefix matches the changed path |
| `file-mention` | low | an unreferenced changed file (for example JSON fixtures) is mentioned by name in a test |

The highest-confidence signal decides a test's confidence; the score (1-100) ranks tests within a level using direct relationships, matched symbols, distance and the number of changed files reaching the test.
