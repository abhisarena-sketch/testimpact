# CLI reference

```
testimpact <command> [options]
```

## Commands

### `testimpact init`

Creates `testimpact.config.json` in the project root with the detected test framework (`vitest`, `jest`, `node` or `auto` when several or none are detected). Refuses to overwrite an existing config unless `--force` is given. `--framework <name>` sets the framework explicitly.

### `testimpact analyze`

Detects changes, builds the dependency graph and prints recommended tests. With no change option it analyses **uncommitted changes** (staged, unstaged and untracked files against `HEAD`).

| Option | Description |
|---|---|
| `--staged` | Staged changes only (`git diff --cached`) |
| `--base <ref>` | Changes on `HEAD` since it diverged from `<ref>` (`git diff <ref>...HEAD`) |
| `--head <ref>` | Head revision used with `--base` (default `HEAD`) |
| `--commit <ref>` | Changes introduced by one commit (root commits supported) |
| `--from <ref> --to <ref>` | Changes between two revisions |
| `--files <paths>` | Explicit files or directories; repeatable and comma-separated. Paths that do not exist are treated as deleted (with a warning). |
| `--format <fmt>` | `terminal` (default), `json` or `html` |
| `-o, --output <file>` | Write output to a file |
| `--list` | Print only the selected test files, one per line |
| `--mode <mode>` | `recommended` (default), `all` (adds low-confidence candidates) or `full` (every test, ranked first) |
| `--threshold <level>` | `high`, `medium` or `low`; overrides `confidenceThreshold` |
| `--include-graph` | Add the dependency graph to JSON output (used by the playground) |
| `--no-save` | Do not save `.testimpact/last-report.json` |
| `--no-cache` | Do not read or write the parse cache |
| `--no-color` / `--color` | Force colours off or on (`NO_COLOR` is honoured) |
| `--verbose` | Show notes for each changed file |
| `--fail-on-full-suite` | Exit with code 3 when the full suite is recommended |
| `--fail-on-untested` | Exit with code 3 when a changed source file has no associated test |

Only one change source can be used at a time.

### `testimpact explain <TEST-ID | test path>`

Explains one recommendation from the last saved report: confidence and score, reason, changed files and exports, the full dependency path with import kinds and line numbers, related source files and every piece of evidence. `TEST-001`, `test-1` and `1` are equivalent. `--format json` prints the raw recommendation. `--report <file>` reads another report.

### `testimpact report`

Renders the last saved report (or `--report <file>`) as `terminal`, `json` or `html`. When `--output` ends in `.html` or `.json`, the format is inferred.

### `testimpact config validate`

Validates the configuration file (`--config <file>` or the default file names) and prints every problem with its path, for example `analysis.imprts: Unrecognized key`.

## Global options

| Option | Description |
|---|---|
| `--root <dir>` | Project root (default: current directory). May be a sub-directory of a Git repository. |
| `--config <file>` | Configuration file (default: `testimpact.config.json`, `.testimpactrc.json`, `.testimpactrc`) |
| `--report <file>`, `--input <file>` | Report for `explain` and `report` |
| `-h, --help` | Help |
| `-v, --version` | Version |

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success (including "no tests affected") |
| `1` | Runtime error, for example Git failed or the directory is not a repository |
| `2` | Invalid usage, invalid configuration, unknown revision, path outside the root, or missing report |
| `3` | A CI policy flag was triggered (`--fail-on-full-suite`, `--fail-on-untested`) |

## Output formats

- **terminal**: changed files, recommended tests, other candidates, run commands, warnings and statistics.
- **json**: the full report (schema version 1); see [`ImpactReport`](../packages/core/src/report.ts). Recommendations follow this shape:

```json
{
  "id": "TEST-001",
  "testFile": "src/auth/login.test.ts",
  "confidence": "high",
  "reason": "Directly imports the changed file src/auth/login.ts",
  "changedFiles": ["src/auth/login.ts"],
  "dependencyPath": ["src/auth/login.ts", "src/auth/login.test.ts"],
  "warnings": []
}
```

  plus `score`, `framework`, `testKind`, `reasons`, `signals`, `dependencyPathDetail`, `distance`, `relatedSourceFiles`, `changedSymbols` and `selected`.
- **html**: a single self-contained file (no external resources, no executable scripts) that embeds the JSON report.
