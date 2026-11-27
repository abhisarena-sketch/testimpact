# Contributing to TestImpact

Thanks for helping. TestImpact's value comes from accurate, explainable analysis, so contributions are held to two rules:

1. **No guessing.** New signals must be grounded in static evidence, and heuristics must be reported as low confidence.
2. **Tests for every behaviour.** Include a fixture or test showing both the correct recommendation and the false positive it avoids.

## Setup

```sh
npm ci          # uses legacy-peer-deps via .npmrc (see docs/installation.md)
npm run build
npm run typecheck
npm run lint
npm test
```

Node.js 20+ is required. Use `npm run playground` to work on the web UI.

## Repository layout

- `packages/core`: config, Git, file discovery, orchestration, impact engine, report renderers
- `packages/dependency-analyzer`: parsing, resolution, graph, symbol propagation
- `packages/test-discovery`: test detection and mappings
- `packages/framework-adapters`: Vitest, Jest, Node.js test runner
- `packages/cli`: command-line interface
- `apps/playground`: Next.js playground
- `tests/`: cross-package integration tests, fixtures (`tests/fixtures/*`) and helpers
- `scripts/`: synthetic project generator, benchmarks, schema generation

## Guidelines

- TypeScript strict mode, ESM, no `any` unless unavoidable.
- No `eval`, `Function`, `vm`, `child_process.exec` or shell strings. Git runs through `execFile` with validated arguments.
- Do not execute project code or configuration files. Extend `StaticEvaluator` instead.
- Keep the core engine free of CLI and UI concerns.
- Document user-visible changes in `CHANGELOG.md` and the relevant `docs/` page.
- Benchmarks in docs must be measured with `scripts/bench.mjs`; never edit numbers by hand.

## Adding a test framework

Implement `FrameworkAdapter` in `packages/framework-adapters/src/adapters.ts` (`detect`, `readConfig`, `sniff`, `runCommand`, default patterns), add it to `builtinAdapters` and the `FrameworkName` union, add a fixture under `tests/fixtures/` and update `docs/compatibility.md`.

## Pull requests

- Keep PRs focused; describe the behaviour change and how it was tested.
- CI must pass: build, type check, lint, tests, playground build, package check and audit.
- By contributing you agree that your contributions are licensed under the MIT License.

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).
