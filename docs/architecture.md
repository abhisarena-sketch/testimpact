# Architecture

```
                         ┌──────────────────────────┐
  testimpact CLI ───────►│  @testimpact/core        │◄────── apps/playground (Next.js API routes)
  (packages/cli)         │  config · git · files    │
                         │  analyze() orchestration │
                         │  impact engine · reports │
                         └───┬──────────┬───────┬───┘
                             │          │       │
        ┌────────────────────▼──┐  ┌────▼───────▼──────────────┐
        │ dependency-analyzer   │  │ test-discovery            │
        │ parse (TS compiler    │  │ test files · kinds ·      │
        │ API, syntax only)     │  │ naming conventions ·      │
        │ resolver · graph ·    │  │ manual mappings           │
        │ symbol propagation    │  └────────────┬──────────────┘
        └───────────────────────┘               │
                                   ┌────────────▼──────────────┐
                                   │ framework-adapters        │
                                   │ Vitest · Jest · node:test │
                                   │ static config reading     │
                                   └───────────────────────────┘
```

The analysis engine has no dependency on the CLI or the playground. Both are thin layers over `analyze()` and the report renderers.

## Pipeline (`analyze()`)

1. **Configuration**: JSON config validated with Zod (`packages/core/src/config.ts`).
2. **File discovery**: `git ls-files --cached --others --exclude-standard` or a filesystem walk that does not follow symlinks; exclusions applied early (`files.ts`).
3. **Change detection**: `git diff --name-status -z -M` for the chosen source plus `-U0` hunks for line ranges, or explicit files/directories (`git.ts`).
4. **Test discovery**: framework detection, static config reading, test pattern matching, per-file framework assignment (`test-discovery`, `framework-adapters`).
5. **Graph construction**: bounded-concurrency reads, content-hash parse cache, syntax-only parsing, module resolution with nearest tsconfig and aliases; deleted/renamed paths become virtual nodes (`dependency-analyzer/src/graph.ts`).
6. **Impact calculation**: reverse traversal with barrel transparency and symbol propagation, plus mapping, convention, setup/config, dynamic-prefix and file-mention signals; confidence, scoring and ranking (`core/src/impact.ts`).
7. **Selection and report**: threshold/mode selection, run commands per framework, warnings, measured timings and memory (`core/src/analyze.ts`, `report.ts`).

## Design principles

- **Static only**: no `eval`, `Function`, `vm` or config execution. Unknown things become warnings, not guesses.
- **Explainable**: every recommendation carries signals; the best path is stored with import kinds and line numbers.
- **Fail wide**: global changes recommend the full suite; symbol narrowing downgrades instead of excluding; full mode never drops tests.
- **Extensible**: `FrameworkAdapter` (`detect`, `readConfig`, `sniff`, `runCommand`) is the extension point for new test frameworks; `isParseable`/`parseModule` is where new languages would plug in.
