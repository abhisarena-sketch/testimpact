// Deterministic synthetic project generator used by the large-repository tests and benchmarks.
import fs from 'node:fs';
import path from 'node:path';

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * Generate a layered TypeScript project.
 * @param {string} dir target directory (created)
 * @param {{ modules?: number, layers?: number, fanOut?: number, testRatio?: number, seed?: number, barrels?: boolean }} [opts]
 * @returns {{ modules: string[], tests: Record<string, string>, imports: Record<string, string[]> }}
 */
export function generateSyntheticProject(dir, opts = {}) {
  const modules = opts.modules ?? 2000;
  const layers = opts.layers ?? 10;
  const fanOut = opts.fanOut ?? 3;
  const testRatio = opts.testRatio ?? 0.25;
  const random = rng(opts.seed ?? 42);
  const perLayer = Math.ceil(modules / layers);
  const files = [];
  const imports = {};
  const tests = {};
  for (let i = 0; i < modules; i++) {
    const layer = Math.floor(i / perLayer);
    const pkg = `pkg${i % 20}`;
    files.push({ index: i, layer, rel: `src/${pkg}/layer${layer}/mod${i}.ts` });
  }
  const byLayer = [];
  for (const f of files) (byLayer[f.layer] ??= []).push(f);
  const write = (rel, text) => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  };
  for (const f of files) {
    const deps = new Set();
    if (f.layer > 0) {
      const lower = byLayer[f.layer - 1];
      for (let k = 0; k < fanOut; k++) deps.add(lower[Math.floor(random() * lower.length)]);
    }
    imports[f.rel] = [...deps].map((d) => d.rel);
    const lines = [];
    for (const d of deps) {
      let spec = path.posix.relative(path.posix.dirname(f.rel), d.rel).replace(/\.ts$/, '');
      if (!spec.startsWith('.')) spec = `./${spec}`;
      lines.push(`import { fn${d.index} } from '${spec}';`);
    }
    lines.push('', `export function fn${f.index}(x: number): number {`);
    lines.push(`  return x + ${[...deps].map((d) => `fn${d.index}(x)`).join(' + ') || '1'};`, '}', '');
    lines.push(`export class Mod${f.index} {`, `  value = fn${f.index}(1);`, '}', '');
    write(f.rel, lines.join('\n'));
    if (random() < testRatio) {
      const testRel = f.rel.replace(/\.ts$/, '.test.ts');
      tests[testRel] = f.rel;
      write(testRel, `import { expect, it } from 'vitest';\nimport { fn${f.index} } from './mod${f.index}';\n\nit('works', () => expect(fn${f.index}(1)).toBeGreaterThan(0));\n`);
    }
  }
  write('package.json', JSON.stringify({ name: 'synthetic', private: true, devDependencies: { vitest: '*' } }, null, 2));
  write('tsconfig.json', JSON.stringify({ compilerOptions: { strict: true, module: 'ESNext', moduleResolution: 'Bundler' } }, null, 2));
  return { modules: files.map((f) => f.rel), tests, imports };
}
