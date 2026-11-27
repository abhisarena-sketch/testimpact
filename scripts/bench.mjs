// Benchmark TestImpact on synthetic projects and (optionally) real open-source repositories.
// Usage: npm run build && node scripts/bench.mjs [--real] [--runs 3]
// Writes bench-results/benchmarks.json and prints a Markdown table.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSyntheticProject } from './synthetic.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const work = path.join(repo, '.bench');
const args = process.argv.slice(2);
const runs = Number(args[args.indexOf('--runs') + 1]) || 3;
const real = args.includes('--real');

const REAL = [
  { name: 'zod', url: 'https://github.com/colinhacks/zod.git', change: 'packages/zod/src/v4/core/util.ts' },
  { name: 'date-fns', url: 'https://github.com/date-fns/date-fns.git', change: 'pkgs/core/src/toDate/index.ts' },
];

function runOnce(root, cache, files) {
  const out = execFileSync(process.execPath, [path.join(here, 'bench-run.mjs'), root, cache ? 'cache' : 'nocache', ...files], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out);
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function measure(name, root, files) {
  fs.rmSync(path.join(root, '.testimpact'), { recursive: true, force: true });
  const cold = Array.from({ length: runs }, () => runOnce(root, false, files));
  runOnce(root, true, files); // prime cache
  const warm = Array.from({ length: runs }, () => runOnce(root, true, files));
  fs.rmSync(path.join(root, '.testimpact'), { recursive: true, force: true });
  const pick = (rs) => {
    const med = median(rs.map((r) => r.wallMs));
    return rs.find((r) => r.wallMs === med);
  };
  const c = pick(cold);
  const w = pick(warm);
  return {
    name,
    changed: files.join(', '),
    files: c.filesAnalysed,
    tests: c.tests,
    edges: c.edges,
    unresolved: c.unresolved,
    candidates: c.candidates,
    cold: { totalMs: c.wallMs, fileDiscoveryMs: c.timings.fileDiscoveryMs, testDiscoveryMs: c.timings.testDiscoveryMs, graphMs: c.timings.graphMs, impactMs: c.timings.impactMs, maxRssMb: c.maxRssMb },
    warm: { totalMs: w.wallMs, graphMs: w.timings.graphMs, reused: w.reused, maxRssMb: w.maxRssMb },
  };
}

fs.mkdirSync(work, { recursive: true });
const results = [];
for (const size of [1000, 5000, 10000]) {
  // Outside the repository: .bench/ is gitignored, which would hide the files from git-based discovery.
  const dir = path.join(os.tmpdir(), 'testimpact-bench', `synthetic-${size}`);
  fs.rmSync(dir, { recursive: true, force: true });
  const project = generateSyntheticProject(dir, { modules: size, layers: 12, fanOut: 3, testRatio: 0.3, seed: 1 });
  results.push(measure(`synthetic-${size}`, dir, [project.modules[3]]));
  console.error(`measured synthetic-${size}`);
}
if (real) {
  for (const r of REAL) {
    const dir = path.join(work, r.name);
    if (!fs.existsSync(dir)) execFileSync('git', ['clone', '--quiet', '--depth', '1', r.url, dir], { stdio: 'inherit' });
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    results.push({ ...measure(`${r.name}@${sha}`, dir, [r.change]) });
    console.error(`measured ${r.name}`);
  }
}

const env = { node: process.version, platform: `${os.platform()} ${os.release()}`, cpus: `${os.cpus().length} × ${os.cpus()[0]?.model ?? 'unknown'}`, memoryGb: Math.round(os.totalmem() / 1024 ** 3), runs, date: new Date().toISOString() };
fs.mkdirSync(path.join(repo, 'bench-results'), { recursive: true });
fs.writeFileSync(path.join(repo, 'bench-results', 'benchmarks.json'), JSON.stringify({ env, results }, null, 2));

const rows = results.map(
  (r) =>
    `| ${r.name} | ${r.files.toLocaleString('en-US')} | ${r.tests.toLocaleString('en-US')} | ${r.edges.toLocaleString('en-US')} | ${r.cold.fileDiscoveryMs} | ${r.cold.testDiscoveryMs} | ${r.cold.graphMs} | ${r.cold.impactMs} | ${r.cold.totalMs} | ${r.warm.totalMs} | ${r.cold.maxRssMb} | ${r.candidates} |`,
);
console.log(`Environment: Node ${env.node}, ${env.platform}, ${env.cpus}, ${env.memoryGb} GB RAM. Median of ${runs} runs, each in a fresh process.\n`);
console.log('| Project | Files analysed | Test files | Imports | File scan (ms) | Test discovery (ms) | Graph build (ms) | Impact (ms) | Total cold (ms) | Total warm cache (ms) | Peak RSS (MB) | Tests recommended |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
console.log(rows.join('\n'));
