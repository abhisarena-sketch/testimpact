# testimpact

**Change code. Know what to test.** The TestImpact command-line tool by Workfonic Labs.

TestImpact statically analyses your TypeScript/JavaScript dependency graph and tells you which tests are affected by a change, with a confidence level and an explanation for every recommendation.

```sh
npm install --save-dev testimpact
npx testimpact init
npx testimpact analyze                 # uncommitted changes
npx testimpact analyze --base main     # everything on this branch
npx testimpact explain TEST-001
npx vitest run $(npx testimpact analyze --base main --list)
```

Supports Vitest, Jest and the Node.js test runner. Local-first: no telemetry, no uploads, project code is never executed.

Documentation: https://github.com/abhisarena-sketch/testimpact#readme
