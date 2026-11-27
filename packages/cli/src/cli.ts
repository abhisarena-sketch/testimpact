import fs from 'node:fs';
import path from 'node:path';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import {
  analyze,
  CONFIG_FILE_NAMES,
  ConfidenceSchema,
  findConfigFile,
  findRecommendation,
  parseReport,
  renderExplanation,
  renderHtml,
  renderJson,
  renderTerminal,
  TestImpactError,
  validateConfig,
  VERSION,
  type ChangeSource,
  type Confidence,
  type ImpactReport,
  type SelectionMode,
} from '@testimpact/core';
import { detectFrameworks, readPackageJson } from '@testimpact/framework-adapters';

/** Exit codes, documented in docs/cli.md. */
export const EXIT = {
  OK: 0,
  ERROR: 1,
  USAGE: 2,
  POLICY: 3,
} as const;

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  cwd: string;
  env: Record<string, string | undefined>;
  isTTY: boolean;
}

const DEFAULT_REPORT = '.testimpact/last-report.json';

const HELP = `TestImpact ${VERSION} by Workfonic Labs. Change code. Know what to test.

Usage
  testimpact <command> [options]

Commands
  init                     Create testimpact.config.json for this project
  analyze                  Analyse changes and recommend tests (default: uncommitted changes)
  explain <TEST-ID|path>   Explain why a test was recommended (uses the last report)
  report                   Render the last report as terminal, JSON or HTML
  config validate          Validate the configuration file

Change selection (analyze)
  --staged                 Staged changes only
  --base <ref>             Changes on HEAD since it diverged from <ref> (for example main)
  --head <ref>             Head revision for --base (default HEAD)
  --commit <ref>           Changes introduced by a single commit
  --from <ref> --to <ref>  Changes between two revisions
  --files <paths>          Explicit files or directories (repeatable, comma-separated)

Output and selection
  --format <fmt>           terminal (default), json or html
  --output, -o <file>      Write the output to a file instead of stdout
  --list                   Print only the selected test file paths, one per line
  --mode <mode>            recommended (default), all (include low-confidence candidates) or full
  --threshold <level>      high, medium or low (overrides confidenceThreshold)
  --include-graph          Include the dependency graph in JSON output (for the playground)
  --no-save                Do not save the report to ${DEFAULT_REPORT}
  --no-cache               Do not read or write the parse cache
  --no-color               Disable colours (also honours NO_COLOR)
  --verbose                Show notes for each changed file

CI policies (exit code 3 when triggered)
  --fail-on-full-suite     Fail when TestImpact recommends running the full suite
  --fail-on-untested       Fail when a changed source file has no associated tests

General
  --root <dir>             Project root (default: current directory)
  --config <file>          Configuration file (default: ${CONFIG_FILE_NAMES.join(', ')})
  --report <file>          Report file for explain/report (default: ${DEFAULT_REPORT})
  --input <file>           Alias of --report
  -h, --help               Show help
  -v, --version            Show version

Exit codes
  0 success · 1 runtime error (for example Git failure) · 2 invalid usage or configuration · 3 CI policy triggered
`;

const OPTIONS = {
  staged: { type: 'boolean' },
  base: { type: 'string' },
  head: { type: 'string' },
  commit: { type: 'string' },
  from: { type: 'string' },
  to: { type: 'string' },
  files: { type: 'string', multiple: true },
  format: { type: 'string' },
  output: { type: 'string', short: 'o' },
  list: { type: 'boolean' },
  mode: { type: 'string' },
  threshold: { type: 'string' },
  'include-graph': { type: 'boolean' },
  'no-save': { type: 'boolean' },
  'no-cache': { type: 'boolean' },
  'no-color': { type: 'boolean' },
  color: { type: 'boolean' },
  verbose: { type: 'boolean' },
  'fail-on-full-suite': { type: 'boolean' },
  'fail-on-untested': { type: 'boolean' },
  root: { type: 'string' },
  config: { type: 'string' },
  report: { type: 'string' },
  input: { type: 'string' },
  framework: { type: 'string' },
  force: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} satisfies ParseArgsConfig['options'];

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true; strict: true }>>['values'];

function usage(message: string): TestImpactError {
  return new TestImpactError('INVALID_INPUT', message);
}

function parseMode(value: string | undefined): SelectionMode {
  if (value === undefined || value === 'recommended') return 'recommended';
  if (value === 'all' || value === 'all-candidates') return 'all-candidates';
  if (value === 'full') return 'full';
  throw usage(`Invalid --mode "${value}". Use recommended, all or full.`);
}

function parseThreshold(value: string | undefined): Confidence | undefined {
  if (value === undefined) return undefined;
  const r = ConfidenceSchema.safeParse(value);
  if (!r.success) throw usage(`Invalid --threshold "${value}". Use high, medium or low.`);
  return r.data;
}

type Format = 'terminal' | 'json' | 'html';
function parseFormat(value: string | undefined, fallback: Format): Format {
  const v = value ?? fallback;
  if (v === 'terminal' || v === 'json' || v === 'html') return v;
  throw usage(`Invalid --format "${v}". Use terminal, json or html.`);
}

function changeSource(values: Values, extraFiles: string[]): ChangeSource {
  const files = [...(values.files ?? []).flatMap((f) => f.split(',')), ...extraFiles].map((f) => f.trim()).filter(Boolean);
  const chosen = [values.staged ? 'staged' : '', values.base ? 'base' : '', values.commit ? 'commit' : '', values.from || values.to ? 'range' : '', files.length > 0 || values.files ? 'files' : ''].filter(Boolean);
  if (chosen.length > 1) throw usage(`Choose one change source; got ${chosen.map((c) => `--${c}`).join(', ')}.`);
  if (values.head && !values.base) throw usage('--head requires --base.');
  if (values.staged) return { kind: 'staged' };
  if (values.base) return { kind: 'base', base: values.base, ...(values.head ? { head: values.head } : {}) };
  if (values.commit) return { kind: 'commit', commit: values.commit };
  if (values.from || values.to) {
    if (!values.from || !values.to) throw usage('--from and --to must be used together.');
    return { kind: 'range', from: values.from, to: values.to };
  }
  if (values.files) {
    if (files.length === 0) throw usage('--files requires at least one path.');
    return { kind: 'files', paths: files };
  }
  return { kind: 'uncommitted' };
}

function writeOutput(io: CliIO, root: string, output: string | undefined, text: string): void {
  if (!output) {
    io.stdout(text.endsWith('\n') ? text : `${text}\n`);
    return;
  }
  const target = path.resolve(io.cwd, output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text);
  io.stderr(`Wrote ${path.relative(io.cwd, target) || target}\n`);
  void root;
}

function readReport(io: CliIO, root: string, file: string | undefined): ImpactReport {
  const target = path.resolve(file ? io.cwd : root, file ?? DEFAULT_REPORT);
  let raw: string;
  try {
    raw = fs.readFileSync(target, 'utf8');
  } catch {
    throw new TestImpactError('REPORT_NOT_FOUND', `No report found at ${path.relative(io.cwd, target) || target}. Run \`testimpact analyze\` first or pass --report.`);
  }
  try {
    return parseReport(JSON.parse(raw));
  } catch (error) {
    if (error instanceof TestImpactError) throw error;
    throw new TestImpactError('INVALID_INPUT', `Report is not valid JSON: ${target}`);
  }
}

function render(report: ImpactReport, format: Format, io: CliIO, values: Values): string {
  if (format === 'json') return renderJson(report);
  if (format === 'html') return renderHtml(report);
  return renderTerminal(report, { color: useColor(io, values), verbose: values.verbose ?? false });
}

function useColor(io: CliIO, values: Values): boolean {
  if (values['no-color'] || io.env.NO_COLOR !== undefined) return false;
  if (values.color) return true;
  return io.isTTY && io.env.TERM !== 'dumb';
}

async function cmdAnalyze(io: CliIO, root: string, values: Values, positionals: string[]): Promise<number> {
  const source = changeSource(values, values.files ? positionals : []);
  if (!values.files && positionals.length > 0) throw usage(`Unexpected argument "${positionals[0]}". Use --files to analyse specific files.`);
  const format = parseFormat(values.format, 'terminal');
  const report = await analyze({
    root,
    source,
    ...(values.config ? { configPath: values.config } : {}),
    mode: parseMode(values.mode),
    ...(parseThreshold(values.threshold) ? { threshold: parseThreshold(values.threshold) as Confidence } : {}),
    includeGraph: values['include-graph'] ?? false,
    ...(values['no-cache'] ? { cache: false } : {}),
  });

  if (!values['no-save']) {
    const target = path.join(root, DEFAULT_REPORT);
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const ignore = path.join(path.dirname(target), '.gitignore');
      if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n');
      fs.writeFileSync(target, renderJson(report));
    } catch (error) {
      io.stderr(`warning: could not save report: ${(error as Error).message}\n`);
    }
  }

  if (values.list) {
    writeOutput(io, root, values.output, report.selection.selectedTests.join('\n'));
  } else {
    writeOutput(io, root, values.output, render(report, format, io, values));
  }

  if (values['fail-on-full-suite'] && report.selection.fullSuiteRecommended) {
    io.stderr('testimpact: full test suite recommended (--fail-on-full-suite)\n');
    return EXIT.POLICY;
  }
  if (values['fail-on-untested']) {
    const untested = report.change.files.filter((f) => f.kind === 'source' && f.status !== 'deleted' && f.testsAffected === 0);
    if (untested.length > 0) {
      io.stderr(`testimpact: changed source files without associated tests (--fail-on-untested):\n${untested.map((f) => `  ${f.path}`).join('\n')}\n`);
      return EXIT.POLICY;
    }
  }
  return EXIT.OK;
}

async function cmdExplain(io: CliIO, root: string, values: Values, positionals: string[]): Promise<number> {
  const query = positionals[0];
  if (!query) throw usage('Usage: testimpact explain <TEST-ID|test file>');
  const report = readReport(io, root, values.report ?? values.input);
  const rec = findRecommendation(report, query);
  if (!rec) {
    const known = report.recommendations.slice(0, 5).map((r) => r.id).join(', ');
    throw usage(`No recommendation "${query}" in the last report.${known ? ` Available: ${known}${report.recommendations.length > 5 ? ', …' : ''}` : ' The report has no recommendations.'}`);
  }
  const format = parseFormat(values.format, 'terminal');
  if (format === 'json') writeOutput(io, root, values.output, `${JSON.stringify(rec, null, 2)}\n`);
  else if (format === 'html') throw usage('explain supports --format terminal or json.');
  else writeOutput(io, root, values.output, renderExplanation(report, rec, { color: useColor(io, values) }));
  return EXIT.OK;
}

async function cmdReport(io: CliIO, root: string, values: Values): Promise<number> {
  const report = readReport(io, root, values.report ?? values.input);
  const format = parseFormat(values.format, values.output?.endsWith('.html') ? 'html' : values.output?.endsWith('.json') ? 'json' : 'terminal');
  writeOutput(io, root, values.output, render(report, format, io, values));
  return EXIT.OK;
}

async function cmdConfig(io: CliIO, root: string, values: Values, positionals: string[]): Promise<number> {
  const sub = positionals[0];
  if (sub !== 'validate') throw usage('Usage: testimpact config validate [--config <file>]');
  const file = values.config ? path.resolve(io.cwd, values.config) : await findConfigFile(root);
  if (!file) {
    io.stdout(`No configuration file found in ${root}; defaults will be used. Run \`testimpact init\` to create one.\n`);
    return EXIT.OK;
  }
  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    io.stderr(`✗ ${path.relative(io.cwd, file) || file} is not valid JSON: ${(error as Error).message}\n`);
    return EXIT.USAGE;
  }
  const result = validateConfig(json);
  if (!result.ok) {
    io.stderr(`✗ ${path.relative(io.cwd, file) || file} is invalid:\n${result.errors.map((e) => `  - ${e}`).join('\n')}\n`);
    return EXIT.USAGE;
  }
  io.stdout(`✓ ${path.relative(io.cwd, file) || file} is valid.\n`);
  return EXIT.OK;
}

async function cmdInit(io: CliIO, root: string, values: Values): Promise<number> {
  const target = path.join(root, 'testimpact.config.json');
  const existing = await findConfigFile(root);
  if (existing && !values.force) {
    io.stderr(`A configuration file already exists: ${path.relative(io.cwd, existing) || existing}. Use --force to overwrite.\n`);
    return EXIT.USAGE;
  }
  let framework = values.framework;
  if (framework && !['vitest', 'jest', 'node', 'auto'].includes(framework)) throw usage(`Invalid --framework "${framework}". Use vitest, jest, node or auto.`);
  if (!framework) {
    const detected = detectFrameworks({ root, files: [], packageJson: readPackageJson(root) });
    framework = detected.length === 1 ? (detected[0]?.framework ?? 'auto') : 'auto';
  }
  const config = {
    $schema: 'https://raw.githubusercontent.com/abhisarena-sketch/testimpact/main/docs/testimpact.schema.json',
    include: ['**/*'],
    exclude: ['node_modules', '.git', '.next', 'dist', 'build', 'coverage'],
    testFramework: framework,
    analysis: { imports: true, exports: true, dynamicImports: true, pathAliases: true, testDiscovery: true, symbolLevel: true, namingConventions: true },
    confidenceThreshold: 'medium',
    mappings: [],
    alwaysRun: [],
  };
  const result = validateConfig(config);
  if (!result.ok) throw new TestImpactError('CONFIG_INVALID', 'Generated configuration is invalid', result.errors);
  fs.writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);
  io.stdout(`Created ${path.relative(io.cwd, target) || target} (testFramework: ${framework}).\nNext: run \`testimpact analyze\`. Reports and cache are written to .testimpact/ (ignored via its own .gitignore).\n`);
  return EXIT.OK;
}

/** Run the CLI. Returns the process exit code; never calls process.exit itself. */
export async function main(argv: string[], io: CliIO): Promise<number> {
  let parsed: { values: Values; positionals: string[] };
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true }) as { values: Values; positionals: string[] };
  } catch (error) {
    io.stderr(`testimpact: ${(error as Error).message}\nRun \`testimpact --help\` for usage.\n`);
    return EXIT.USAGE;
  }
  const { values, positionals } = parsed;
  if (values.version) {
    io.stdout(`${VERSION}\n`);
    return EXIT.OK;
  }
  const [command, ...rest] = positionals;
  if (values.help || !command || command === 'help') {
    io.stdout(HELP);
    return command || values.help ? EXIT.OK : EXIT.USAGE;
  }
  const root = path.resolve(io.cwd, values.root ?? '.');
  try {
    switch (command) {
      case 'analyze':
        return await cmdAnalyze(io, root, values, rest);
      case 'explain':
        return await cmdExplain(io, root, values, rest);
      case 'report':
        return await cmdReport(io, root, values);
      case 'config':
        return await cmdConfig(io, root, values, rest);
      case 'init':
        return await cmdInit(io, root, values);
      default:
        io.stderr(`testimpact: unknown command "${command}". Run \`testimpact --help\` for usage.\n`);
        return EXIT.USAGE;
    }
  } catch (error) {
    if (error instanceof TestImpactError) {
      io.stderr(`testimpact: ${error.message}\n${error.details.map((d) => `  - ${d}\n`).join('')}`);
      return error.code === 'GIT_ERROR' ? EXIT.ERROR : EXIT.USAGE;
    }
    io.stderr(`testimpact: unexpected error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    return EXIT.ERROR;
  }
}
