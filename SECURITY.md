# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's [private vulnerability reporting](https://github.com/abhisarena-sketch/testimpact/security/advisories/new). Do not open public issues for security problems. We aim to acknowledge reports within 5 working days.

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | Yes |

## Security model

TestImpact is a local developer tool that reads untrusted repository contents. Its guarantees:

- **Local-first**: no network access, no telemetry, no uploads. The only network-capable component is the optional playground, which listens on `127.0.0.1` and rejects non-local requests.
- **No code execution**: source files are parsed with the TypeScript compiler API in syntax-only mode. Vitest/Jest configuration files are parsed and evaluated only for literal values by a small static evaluator. `eval`, `new Function` and `vm` are not used and are blocked by lint rules.
- **Safe Git execution**: Git runs via `execFile` (no shell) with `GIT_TERMINAL_PROMPT=0` and `GIT_OPTIONAL_LOCKS=0`. User-supplied revisions are validated (no leading `-`, restricted character set, no `..`) and verified with `git rev-parse --verify --end-of-options`.
- **Input validation**: configuration is validated with a strict Zod schema; explicit paths must stay inside the project root; reports are shape-checked before use.
- **No modification of source files**: TestImpact writes only to `.testimpact/` inside the project (cache and last report, which ignores itself) and to output paths you pass explicitly. A cache directory outside the project root is refused.
- **Safe output**: HTML reports escape all values, embed JSON with `<`, `>` and `&` escaped, and load no external resources.
- **Filesystem**: the filesystem walker does not follow symbolic links; files larger than 2 MiB are skipped.
- **No credentials**: the project contains no hardcoded secrets and needs none.

## Known risks

- Regular expressions from Jest `testRegex`/`moduleNameMapper` in the analysed project are compiled and run. A pathological pattern in a repository you analyse could slow analysis down (ReDoS). Only analyse repositories you are prepared to run tooling on.
- `tsconfig.json` `extends` chains are followed and may read JSON files outside the project (read-only).
- Dependencies are audited in CI with `npm audit`.

## Review performed for 0.1.0

- Source scan for `eval`, `Function`, `vm`, `exec`, shell usage and network APIs: none outside documented uses (Git `execFile`).
- Write-path review: only `.testimpact/`, explicit `--output` paths and `testimpact init`.
- `npm audit`: 0 known vulnerabilities at release time.
- Tests cover unsafe revision rejection, paths outside the root, cache directory containment, and that analysis leaves the working tree unchanged.
