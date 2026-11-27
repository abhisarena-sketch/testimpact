# Installation

## Requirements

- Node.js 20 or later (tested on 20, 22 and 24 in CI).
- Git 2.30 or later for Git-based change detection (`--files` works without Git).
- A TypeScript or JavaScript project. TypeScript itself does not need to be installed in your project; TestImpact ships its own parser.

## From npm

> Not yet published. The name `testimpact` was available on npm at the time of writing; see [publishing.md](publishing.md).

```sh
npm install --save-dev testimpact
npx testimpact --version
```

## From source

```sh
git clone https://github.com/abhisarena-sketch/testimpact.git
cd testimpact
npm ci
npm run build
node packages/cli/dist/bin.js --help
```

To use the source build in another project, either run the binary by path:

```sh
node /path/to/testimpact/packages/cli/dist/bin.js analyze --root /path/to/project
```

or link it globally:

```sh
cd /path/to/testimpact/packages/cli && npm link
testimpact --help
```

## First run

```sh
cd your-project
npx testimpact init            # optional: writes testimpact.config.json with the detected framework
npx testimpact analyze         # analyse uncommitted changes
```

TestImpact writes its parse cache and the last report to `.testimpact/` in the project root. The directory contains its own `.gitignore`, so it never appears as a change.

## Note on `npm install` in this repository

The repository's `.npmrc` sets `legacy-peer-deps=true`. npm 10 crashes (`Cannot read properties of null (reading 'edgesOut')`) while resolving the optional peer-dependency cycle between Vite 8's devtools packages and Vitest. This affects development of TestImpact only, not users of the published packages.
