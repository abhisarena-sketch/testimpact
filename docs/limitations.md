# Known limitations

TestImpact only reports relationships it can establish through static analysis. It does not claim to understand runtime behaviour. When in doubt it widens rather than narrows the selection, and it labels heuristics as low confidence.

## Analysis limits

- **Runtime-only dependencies are invisible.** Dependency injection containers, plugin registries populated by string names, `fs.readFile` of fixtures, environment variables, network calls and HTTP routes do not create edges. Partial mitigation: computed `import()` prefixes and file-name mentions in tests produce low-confidence candidates. Use `mappings` or `alwaysRun` for the rest.
- **Computed specifiers** (``import(`./${name}`)``, `require(variable)`) cannot be followed; they are counted in `stats.unresolvedDynamicImports` and reported as warnings.
- **No type checker.** References are matched by identifier name. Shadowed variables with the same name as an import can over-count references; this only affects ranking and symbol narrowing, never adds missing edges.
- **Symbol-level narrowing is per declaration.** Changes to object members, class methods or mutable module state are attributed to the whole top-level declaration. Side effects that flow through shared mutable objects are not tracked; tests affected that way may be downgraded to *low* (`unaffected-symbols`) rather than excluded. Disable with `analysis.symbolLevel: false` if this matters for your project.
- **CommonJS** modules are analysed per file, not per export.
- **Global setup** files are detected only when listed in Vitest/Jest config. Files imported by setup files are not treated as global.
- **Framework configs** that compute values at runtime fall back to defaults with a warning (see the [compatibility matrix](compatibility.md)). Jest `projects` and custom transforms are not applied.
- **Snapshot files** (`__snapshots__/*.snap`) are not linked to tests unless mentioned by name.
- **Non-JS sources** (Vue/Svelte SFCs, GraphQL documents, CSS modules' class usage) are not parsed.
- **Generated code** that is gitignored is not analysed by default. Add it through `include` with `useGitignore: false` if tests depend on it.

## Change detection

- `--base` compares against the merge base, so it does not include uncommitted work. Combine with a separate `analyze` run (default mode) if you need both.
- Line-level information is only available in Git modes. `--files` treats each file as a whole-module change.
- Changes outside the project root (when the root is a sub-directory) are ignored with a warning.

## Operational

- Very large files (over 2 MiB) are skipped with a warning.
- The parse cache is invalidated by TestImpact version or parse-option changes; module resolution is recomputed on every run, which dominates warm-cache time on very large repositories (see [benchmarks](benchmarks.md)).
- The playground is a local tool. Its API only accepts requests to `127.0.0.1`/`localhost` and only analyses directories inside `TESTIMPACT_ALLOWED_ROOT`. Do not expose it on a network.
- `next build` of the playground prints "Dynamic filesystem access causes tracing of the whole project" warnings. They are expected: the analysis engine reads user-chosen project files at runtime.
