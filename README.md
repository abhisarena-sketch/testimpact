# TestImpact

**Change code. Know what to test.**

TestImpact is an open-source developer utility by **Workfonic Labs**. It analyses code changes and tells you which tests are most likely to be affected, so you can run the right tests first instead of the whole suite after every small change.

Every recommendation comes from static analysis of your code (imports, re-exports, references, test configuration and explicit mappings), carries a confidence level, and explains *why* it was selected. TestImpact never guesses with AI, never executes your project code and never uploads anything.

```text
$ npx testimpact analyze --files src/auth/login.ts

Changes  explicitly specified files (src/auth/login.ts)
  M src/auth/login.ts    whole module

Recommended tests  5 of 13 (61.5% not selected)  threshold: medium
  TEST-001  HIGH    src/auth/login.test.ts
                    Directly imports the changed file src/auth/login.ts
  TEST-002  HIGH    tests/integration/auth.integration.test.ts
                    Imports src/auth/login.ts through the re-export src/auth/index.ts
  TEST-003  HIGH    tests/integration/session.flow.test.ts
                    Imports src/auth/login.ts through the re-export src/auth/index.ts
  TEST-004  MEDIUM  src/components/LoginForm.test.tsx
                    Indirect dependency on src/auth/login.ts (2 imports away)
  TEST-005  MEDIUM  src/pages/lazy.test.ts
                    Indirect dependency on src/auth/login.ts (3 imports away)

Run
  npx vitest run src/auth/login.test.ts tests/integration/auth.integration.test.ts …
```

(Output from the bundled fixture in [`tests/fixtures/web-app`](tests/fixtures/web-app).)

## Features

- **Git-aware change detection**: uncommitted, staged, against a base branch (merge base), a single commit, or a commit range. Handles added, deleted, renamed and untracked files. Explicit files and directories work without Git.
- **Dependency analysis** with the TypeScript Compiler API: static, type-only and statically discoverable dynamic imports, `require()`, re-exports and barrel files, `vi.mock`/`jest.mock` references, tsconfig `paths` (nearest tsconfig per file), Vite `resolve.alias`, Jest `moduleNameMapper`, workspace packages and assets.
- **Symbol-level narrowing**: when Git line ranges are available, TestImpact works out which exports changed and follows them across files and barrels. Tests that only use unchanged exports are downgraded, not dropped.
- **Test discovery** for Vitest (including `projects`), Jest (`testMatch`, `testRegex`, `roots`) and the Node.js test runner, read statically from their configuration. Manual mappings, `alwaysRun` tests and per-path framework overrides for unconventional projects.
- **Explainable, ranked recommendations**: `high` (direct relationship), `medium` (indirect), `low` (heuristic or incomplete mapping), each with a dependency path, related source files and evidence.
- **Safe defaults**: setup files and project-wide configuration changes recommend the full suite. Full-suite mode never drops tests. Every discovered test is listed in the report.
- **Reports**: terminal, JSON and self-contained HTML. CI-friendly exit codes and a `--list` mode for piping into your runner.
- **Playground**: an optional local Next.js app with a dashboard, an interactive dependency explorer and a test impact explorer, all driven by real analysis results.
- **Performance**: content-hash parse cache for incremental runs, bounded concurrency and `git ls-files` discovery. See [measured benchmarks](docs/benchmarks.md).

## Quick start

Requires Node.js 20 or later.

```sh
npm install --save-dev testimpact
npx testimpact init                     # writes testimpact.config.json (optional)
npx testimpact analyze                  # uncommitted changes
npx testimpact analyze --staged
npx testimpact analyze --base main
npx testimpact analyze --commit HEAD
npx testimpact analyze --files src/auth/login.ts
npx testimpact analyze --files src/auth/
npx testimpact explain TEST-001
npx testimpact report --format html -o testimpact-report.html
npx testimpact config validate
```

Run only the selected tests:

```sh
npx vitest run $(npx testimpact analyze --base origin/main --list)
npx jest --runTestsByPath $(npx testimpact analyze --base origin/main --list)
```

> The package name `testimpact` was available on npm when this was written, but the package has not been published yet. Until it is, build from source (see [Local development](#local-development)) and run `node packages/cli/dist/bin.js`.

## How confidence works

| Level | Meaning | Examples |
|---|---|---|
| **High** | Direct test or dependency relationship | The test file changed; the test imports the changed file (directly or through barrel re-exports); a manual mapping; a setup file changed |
| **Medium** | Indirect dependency relationship | The test imports a module that imports the changed file; type-only dependency; `vi.mock` reference; project-wide config change |
| **Low** | Heuristic or incomplete mapping. **Not guaranteed coverage.** | Naming convention only; the test only uses exports that did not change; a computed `import()` might load the file; the test mentions a changed data file by name |

The default threshold is `medium`. Use `--mode all` to include low-confidence candidates, or `--mode full` to select every test (ranked recommendations first).

## Documentation

- [Installation](docs/installation.md)
- [CLI reference](docs/cli.md)
- [Configuration reference](docs/configuration.md) ([JSON schema](docs/testimpact.schema.json))
- [Dependency analysis guide](docs/dependency-analysis.md)
- [Framework compatibility matrix](docs/compatibility.md)
- [Known limitations](docs/limitations.md)
- [CI integration](docs/ci.md)
- [Playground](docs/playground.md)
- [Benchmarks](docs/benchmarks.md)
- [Architecture](docs/architecture.md)
- [Publishing](docs/publishing.md)
- [Examples](examples/)

## Packages

| Package | Purpose |
|---|---|
| [`testimpact`](packages/cli) | Command-line interface |
| [`@testimpact/core`](packages/core) | Configuration, Git change detection, file discovery, orchestration, impact calculation, reports |
| [`@testimpact/dependency-analyzer`](packages/dependency-analyzer) | AST parsing, import/export analysis, module resolution, dependency graph |
| [`@testimpact/test-discovery`](packages/test-discovery) | Test file detection, test-to-source mapping, manual mappings |
| [`@testimpact/framework-adapters`](packages/framework-adapters) | Vitest, Jest and Node.js test runner adapters (static config reading, run commands) |
| [`apps/playground`](apps/playground) | Optional local Next.js playground |

## Local development

```sh
git clone https://github.com/abhisarena-sketch/testimpact.git
cd testimpact
npm ci
npm run build
npm run typecheck && npm run lint && npm test
node packages/cli/dist/bin.js analyze --root tests/fixtures/web-app --files src/auth/login.ts --no-save
npm run playground   # http://127.0.0.1:3210
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security and privacy

TestImpact runs locally, sends no telemetry and uploads nothing. It parses source files without executing them (no `eval`, no `Function`, no `vm`), reads framework configuration files statically, runs Git through `execFile` with validated arguments and never modifies your source files. It writes only to `.testimpact/` (cache and last report, ignored by its own `.gitignore`) and to output files you name. See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Workfonic Labs
