# CI integration

TestImpact is designed to run in CI alongside, not instead of, your full suite. A common setup is to run the selected tests on every pull request for fast feedback and the full suite on the main branch (or nightly).

## GitHub Actions

```yaml
name: Impacted tests
on: pull_request

jobs:
  impacted-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0            # TestImpact needs the merge base with the target branch
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - name: Select tests
        id: select
        run: |
          npx testimpact analyze --base "origin/${{ github.base_ref }}" --format html -o testimpact-report.html --fail-on-full-suite || echo "full=true" >> "$GITHUB_OUTPUT"
          npx testimpact report --format json -o testimpact-report.json
          npx testimpact analyze --base "origin/${{ github.base_ref }}" --list --no-cache > selected-tests.txt
      - name: Run selected tests
        if: steps.select.outputs.full != 'true'
        run: |
          if [ -s selected-tests.txt ]; then xargs npx vitest run < selected-tests.txt; else echo "No affected tests"; fi
      - name: Run full suite
        if: steps.select.outputs.full == 'true'
        run: npx vitest run
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: testimpact-report
          path: testimpact-report.*
```

A copy is in [`examples/github-actions/impacted-tests.yml`](../examples/github-actions/impacted-tests.yml).

## Exit codes

| Code | Use |
|---|---|
| `0` | Analysis completed |
| `1` | Runtime failure (Git error, not a repository) |
| `2` | Invalid usage or configuration; fix the job |
| `3` | `--fail-on-full-suite` or `--fail-on-untested` triggered |

## Tips

- Use `fetch-depth: 0` (or fetch the base branch) so `--base` can find the merge base.
- `--list` prints nothing when no test is selected; guard the runner call so an empty list does not run the full suite by accident (Vitest and Jest run everything when given no files).
- `--fail-on-untested` is a useful gate for "new code needs tests".
- The parse cache lives in `.testimpact/cache`; caching it between CI runs (keyed on the lockfile) speeds up large repositories.
