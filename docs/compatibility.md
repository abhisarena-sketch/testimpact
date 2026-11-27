# Framework compatibility matrix

Status reflects what is implemented **and covered by automated tests** in this repository.

## Languages and syntax

| Language / syntax | Status | Notes |
|---|---|---|
| TypeScript (`.ts`, `.mts`, `.cts`) | Supported | Parsed with the TypeScript 5.9 compiler API (syntax only) |
| JavaScript (`.js`, `.mjs`, `.cjs`) | Supported | ESM and CommonJS (`require`, `module.exports`) |
| React (`.tsx`, `.jsx`) | Supported | JSX component references are counted as references |
| Next.js projects | Supported as TS/React code | tsconfig `paths` (`@/*`) honoured. App Router file conventions (`page.tsx` loaded by the framework) are not imports; changes there only reach tests that import them. |
| JSON modules, CSS and asset imports | Supported as graph nodes | `import data from './x.json'`, `import './x.css'` |
| `.d.ts` files | Parsed | Usually reached through type-only imports (medium confidence) |
| Vue, Svelte, Astro, MDX single-file components | Not supported | Not parsed; imports *of* these files from TS/JS are resolved only if the file exists at the exact path |
| Flow, decorators-heavy Babel syntax | Best effort | TypeScript's parser handles standard decorators; Flow type annotations are not supported |
| Other languages (Python, Go, …) | Not supported | The adapter interface allows future languages; see `FrameworkAdapter` |

## Test frameworks

| Capability | Vitest | Jest | Node.js test runner |
|---|---|---|---|
| Detection | dependency, `vitest.config.*`, scripts | dependency (`jest`, `ts-jest`, `babel-jest`, `@jest/globals`), `jest.config.*`, `package.json#jest`, scripts | `node --test` in scripts, or `--framework node` |
| Default test patterns | `**/*.{test,spec}.?(c\|m)[jt]s?(x)` | `**/__tests__/**`, `*.test.*`, `*.spec.*` | Node 21+ defaults (`*.test.*`, `*-test.*`, `*_test.*`, `test-*.*`, `test.*`, `test/**`), including TS variants |
| Config read statically | `test.include`, `test.exclude`, `test.dir`, `setupFiles`, `globalSetup`, `resolve.alias`, `test.projects` (inline and per-package configs) | `testMatch`, `testRegex`, `roots`, `testPathIgnorePatterns`, `moduleNameMapper`, `setupFiles`, `setupFilesAfterEnv`, `globalSetup` | none (no config file) |
| Per-file framework sniffing | `from 'vitest'`, `vi.*` | `@jest/globals`, `jest.*` | `node:test` |
| Mock references | `vi.mock`, `vi.doMock`, `vi.importActual`, `vi.importMock` | `jest.mock`, `jest.doMock`, `jest.requireActual`, `jest.requireMock` | n/a |
| Run command | `npx vitest run <files>` | `npx jest --runTestsByPath <files>` | `node --test <files>` |
| Not supported | config produced at runtime (for example `await` or function calls returning config) falls back to defaults with a warning | `projects` analysed at root level only; custom `transform` not applied; `<rootDir>` subdirectories in `testMatch` | `--test-name-pattern` style selection |

Configs are parsed, not executed: literals, `const` references, template strings, `path.resolve(__dirname, …)`, `path.join`, `fileURLToPath(new URL(…, import.meta.url))` and `import.meta.dirname` are understood. Anything else produces an analysis warning and the framework default is used.

## Platforms

| Platform | Status |
|---|---|
| Node.js 20, 22, 24 | CI matrix |
| Linux | Tested |
| macOS, Windows | Expected to work (POSIX paths are normalised internally) but not covered by CI yet |
| npm workspaces / pnpm / Yarn monorepos | File discovery is package-manager independent; workspace packages resolve through `node_modules` symlinks |
