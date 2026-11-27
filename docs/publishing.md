# Publishing

## Package names

Checked on 2026-11-27 with `npm view`:

| Package | Status on npm |
|---|---|
| `testimpact` | Available (404) |
| `@testimpact/core`, `@testimpact/dependency-analyzer`, `@testimpact/test-discovery`, `@testimpact/framework-adapters` | Available (404). Publishing under `@testimpact` requires creating the `testimpact` organisation on npm first. |

Re-check right before publishing: `npm view testimpact` and `npm view @testimpact/core` should return 404.

If the `@testimpact` scope cannot be created, rename the libraries (for example to `@workfonic/testimpact-core`) in each `package.json`, the `dependencies` that reference them, the imports, and `tsconfig.test.json`/`vitest.config.ts` aliases.

## Release checklist

1. Update versions in every `packages/*/package.json`, the internal dependency versions, and `packages/core/src/version.ts`.
2. Update `CHANGELOG.md`.
3. `npm ci && npm run build && npm run typecheck && npm run lint && npm test && npm run build:playground`
4. `npm run pack:check` and inspect the file lists (only `dist`, `README.md`, `LICENSE`).
5. `npm run schema` and commit `docs/testimpact.schema.json` if it changed.
6. Publish in dependency order, with provenance from CI if possible:

```sh
npm login
for p in framework-adapters dependency-analyzer test-discovery core cli; do
  npm publish --workspace packages/$p --access public
done
```

7. Tag the release: `git tag v0.1.0 && git push origin v0.1.0`, then create a GitHub release with the changelog entry.

The playground (`apps/playground`) is private and not published.

## GitHub

- CI (`.github/workflows/ci.yml`) runs build, type check, lint, tests (Node 20, 22, 24), the playground build, `npm pack --dry-run`, and `npm audit`.
- Recommended repository settings: protect `main`, require the CI checks, and enable private vulnerability reporting (used by SECURITY.md).
