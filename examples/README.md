# Examples

| Example | What it shows |
|---|---|
| [`../tests/fixtures/web-app`](../tests/fixtures/web-app) | Vitest + React + tsconfig `paths` + Vite alias + barrel files + dynamic imports + a cycle + a manual mapping. Try `node packages/cli/dist/bin.js analyze --root tests/fixtures/web-app --files src/auth/login.ts --no-save`. |
| [`../tests/fixtures/jest-app`](../tests/fixtures/jest-app) | Jest with CommonJS, `__tests__` directories, `moduleNameMapper` aliases and `jest.mock`. |
| [`../tests/fixtures/node-app`](../tests/fixtures/node-app) | Node.js test runner with ES modules. |
| [`configs/`](configs) | Configuration files for a Vitest monorepo, a legacy Jest project and a Next.js app. |
| [`github-actions/impacted-tests.yml`](github-actions/impacted-tests.yml) | Run only impacted tests on pull requests, falling back to the full suite. |
| [`programmatic/analyze.mjs`](programmatic/analyze.mjs) | Calling `analyze()` from Node.js. |

The fixtures double as integration-test inputs, so their expected recommendations are asserted in `tests/impact.test.ts`.
