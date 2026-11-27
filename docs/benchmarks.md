# Benchmarks

All numbers on this page were **measured** with `scripts/bench.mjs` on 2026-11-27. Nothing is estimated or extrapolated. Re-run them on your own hardware with:

```sh
npm run build
node scripts/bench.mjs --real --runs 3   # --real clones the open-source repositories below
```

The script writes raw results to `bench-results/benchmarks.json`.

## Method

- Each measurement runs `analyze()` in a **fresh Node.js process** for one changed file (`--files` mode), so file reading, parsing, module resolution, test discovery and impact calculation are all included.
- **Cold**: no parse cache. **Warm**: parse cache populated by a previous run (module resolution is still recomputed).
- The table shows the median wall-clock time of 3 runs. Phase columns come from the same median cold run. Peak RSS is the process's maximum resident set size.
- Synthetic projects are generated deterministically by `scripts/synthetic.mjs`: 12 layers of modules, each importing 3 modules from the layer below, with a test for about 30% of modules. The changed file is in the bottom layer, so a large share of the graph depends on it (a worst case for traversal).
- Real repositories (shallow clones at the commit shown) and the changed file:
  - `zod`: `packages/zod/src/v4/core/util.ts` (a widely used internal utility module; Vitest)
  - `date-fns`: `pkgs/core/src/toDate/index.ts` (used by almost every function; Vitest `projects` with `**/test.ts` patterns)

## Results

Environment: Node v22.23.5, Linux 6.18 (cloud container), 4 × Intel Xeon @ 2.10 GHz, 16 GB RAM. Median of 3 runs, each in a fresh process.

| Project | Files analysed | Test files | Imports | File scan (ms) | Test discovery (ms) | Graph build (ms) | Impact (ms) | Total cold (ms) | Total warm cache (ms) | Peak RSS (MB) | Tests recommended |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| synthetic-1000 | 1,306 | 304 | 3,018 | 22 | 14 | 658 | 13 | 722 | 290 | 159 | 181 |
| synthetic-5000 | 6,527 | 1,525 | 15,239 | 30 | 18 | 2453 | 53 | 2605 | 705 | 200 | 872 |
| synthetic-10000 | 12,980 | 2,978 | 30,446 | 47 | 26 | 4159 | 113 | 4421 | 1335 | 234 | 1636 |
| zod@d40c329 | 741 | 203 | 909 | 38 | 30 | 1192 | 9 | 1277 | 230 | 184 | 134 |
| date-fns@a9739fb | 2,050 | 336 | 5,006 | 91 | 48 | 1529 | 10 | 1695 | 536 | 183 | 275 |

"Files analysed" includes test files and non-code files (JSON, Markdown, assets) that are graph nodes. "Imports" counts resolved edges between project files.

## Observations

- Graph construction (reading, parsing and resolving) dominates cold runs. Impact calculation itself takes milliseconds even with 30,000 import edges.
- The parse cache cuts total time by by 2.5x to 5.6x in these runs. The remaining warm-cache time is mostly module resolution, which is not cached yet.
- Memory stays under 250 MB RSS for a 13,000-file project.
- Large recommendation counts in this table are expected: the changed files were chosen because many modules depend on them. A leaf module selects only its own tests (see `tests/large-repo.test.ts`).
