# Configuration reference

TestImpact reads `testimpact.config.json`, `.testimpactrc.json` or `.testimpactrc` from the project root (or the file given with `--config`). Configuration is **JSON only**: TestImpact never executes a JavaScript config file. Every key is optional. Unknown keys are rejected so typos are caught; run `testimpact config validate`.

A JSON schema is available at [`docs/testimpact.schema.json`](testimpact.schema.json) for editor completion:

```json
{ "$schema": "https://raw.githubusercontent.com/abhisarena-sketch/testimpact/main/docs/testimpact.schema.json" }
```

## Example

```json
{
  "include": ["src/**/*"],
  "exclude": ["node_modules", ".next", "dist", "build"],
  "testFramework": "vitest",
  "testPatterns": ["**/*.test.ts", "**/*.spec.ts"],
  "analysis": {
    "imports": true,
    "exports": true,
    "dynamicImports": true,
    "pathAliases": true,
    "testDiscovery": true
  },
  "confidenceThreshold": "medium",
  "mappings": [
    { "source": "src/legacy/**", "tests": "tests/legacy/**", "reason": "Legacy suite drives the CLI end to end" }
  ],
  "alwaysRun": ["tests/smoke/**"]
}
```

## Keys

| Key | Type | Default | Description |
|---|---|---|---|
| `include` | `string[]` | `["**/*"]` | Globs for source files that belong to the dependency graph. Test files and setup files are always added, even outside `include`. |
| `exclude` | `string[]` | `node_modules`, `.git`, `.next`, `dist`, `build`, `coverage`, `out`, `.turbo`, `.testimpact` | Bare names (no `/` or glob characters) match any path segment; other entries are globs. Files ignored by `.gitignore` are also skipped when `useGitignore` is on. |
| `testFramework` | `auto` \| `vitest` \| `jest` \| `node` | `auto` | `auto` detects frameworks from `package.json` dependencies, scripts and config files. Several frameworks can be active at once; each test file is assigned by its imports (`vitest`, `@jest/globals`, `node:test`). |
| `testPatterns` | `string[]` | framework config, else framework defaults | Globs identifying test files. Overrides the include rules read from Vitest/Jest config. |
| `analysis.imports` | `boolean` | `true` | Analyse static `import` declarations. |
| `analysis.exports` | `boolean` | `true` | Analyse exports and re-exports (barrel files). |
| `analysis.dynamicImports` | `boolean` | `true` | Follow `import()` and `require()` with literal specifiers, and flag computed `import()` prefixes. |
| `analysis.pathAliases` | `boolean` | `true` | Honour tsconfig `paths`/`baseUrl`, Vite aliases, Jest `moduleNameMapper` and `aliases`. |
| `analysis.testDiscovery` | `boolean` | `true` | Discover tests. Turning it off means no tests can be recommended. |
| `analysis.symbolLevel` | `boolean` | `true` | Use changed line ranges to work out which exports changed (Git modes only). |
| `analysis.namingConventions` | `boolean` | `true` | Add low-confidence matches based on test/source naming (`login.test.ts` ↔ `login.ts`, `__tests__/`, `tests/` ↔ `src/`). |
| `analysis.mockReferences` | `boolean` | `true` | Treat `vi.mock('./x')`, `jest.mock('./x')`, `vi.importActual`, `jest.requireActual` as references. |
| `analysis.maxDepth` | `integer` | unlimited | Stop reverse traversal after this many import hops (barrel re-exports do not count). A warning is added when the limit is hit. |
| `confidenceThreshold` | `high` \| `medium` \| `low` | `medium` | Minimum confidence for a test to be *selected* in `recommended` mode. Lower-confidence candidates are still listed. |
| `mappings` | `{ source, tests, reason? }[]` | `[]` | Manual source-to-test mappings (globs; strings or arrays). Matching tests get **high** confidence with the given reason. Test patterns that match nothing produce a warning. |
| `alwaysRun` | `string[]` | `[]` | Tests always selected when there is any change (for example smoke tests). |
| `globalFiles` | `string[]` | lockfiles, `package.json`, `tsconfig*.json`, Vite/Vitest/Jest/Babel configs, TestImpact config | Changing one of these recommends the full suite (all tests at medium confidence). |
| `aliases` | `Record<string, string \| string[]>` | `{}` | Extra aliases: `"@/*": ["src/*"]` (tsconfig style), `"@": "./src"` (prefix style) or `"^@app/(.*)$": "<rootDir>/lib/$1"` (regex style). |
| `tsconfig` | `string` | nearest per file | Use one tsconfig/jsconfig for all resolution instead of the nearest one to each file. |
| `overrides` | `{ files, testFramework? }[]` | `[]` | Assign a framework to test files matching `files`. |
| `cache.enabled` | `boolean` | `true` | Persist parsed module information between runs. |
| `cache.directory` | `string` | `.testimpact/cache` | Must be inside the project root; otherwise caching is disabled with a warning. |
| `concurrency` | `integer` (1-256) | `32` | Maximum concurrent file reads. |
| `useGitignore` | `boolean` | `true` | Use `git ls-files` (respects `.gitignore`) for file discovery inside Git repositories. |

## Project-specific overrides

- **Unconventional test locations**: set `testPatterns`, or add `mappings` for suites that exercise code without importing it (CLI tests, end-to-end tests).
- **Mixed frameworks**: leave `testFramework` as `auto`, or use `overrides` to assign frameworks by path.
- **Monorepos**: run TestImpact from the repository root so cross-package imports are visible. Each file is resolved with its nearest `tsconfig.json`, and workspace packages are followed through `node_modules` symlinks to their source.
