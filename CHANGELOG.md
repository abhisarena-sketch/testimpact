# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-27

Initial release candidate (not yet published to npm).

### Added

- Git change detection: uncommitted, staged, base branch (merge base), single commit, commit range; renames, deletions, untracked files and changed line ranges. Explicit files and directories.
- Dependency analysis with the TypeScript Compiler API: static, type-only and dynamic imports, `require`, re-exports and barrels, `vi.mock`/`jest.mock` references, function and class reference counts.
- Module resolution with nearest tsconfig `paths`, Vite aliases, Jest `moduleNameMapper`, workspace packages and assets.
- Symbol-level narrowing of changed exports across files and barrels.
- Test discovery for Vitest (including `projects`), Jest and the Node.js test runner, read statically from configuration; manual mappings, `alwaysRun`, overrides and naming conventions.
- Impact engine with high/medium/low confidence, evidence signals, ranking and explanations; full-suite recommendation for setup and configuration changes.
- CLI: `init`, `analyze`, `explain`, `report`, `config validate`; terminal, JSON and HTML output; `--list`; CI exit codes and policy flags.
- Content-hash parse cache for incremental analysis.
- Local Next.js playground: dashboard, dependency explorer, test impact explorer, JSON/HTML export.
- Benchmarks script, documentation, GitHub Actions CI.
