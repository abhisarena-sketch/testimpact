import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { TestImpactError } from './errors.js';

export const CONFIG_FILE_NAMES = ['testimpact.config.json', '.testimpactrc.json', '.testimpactrc'] as const;

export const ConfidenceSchema = z.enum(['high', 'medium', 'low']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const FrameworkSchema = z.enum(['auto', 'vitest', 'jest', 'node']);
export type FrameworkSetting = z.infer<typeof FrameworkSchema>;

const globList = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).transform((v) => (Array.isArray(v) ? v : [v]));

export const MappingSchema = z
  .object({
    source: globList,
    tests: globList,
    reason: z.string().min(1).optional(),
  })
  .strict();
export type TestMapping = z.output<typeof MappingSchema>;

export const OverrideSchema = z
  .object({
    files: globList,
    testFramework: FrameworkSchema.exclude(['auto']).optional(),
  })
  .strict();
export type ConfigOverride = z.output<typeof OverrideSchema>;

export const AnalysisOptionsSchema = z
  .object({
    imports: z.boolean().default(true),
    exports: z.boolean().default(true),
    dynamicImports: z.boolean().default(true),
    pathAliases: z.boolean().default(true),
    testDiscovery: z.boolean().default(true),
    /** Narrow impact to changed functions/classes when changed line ranges are known. */
    symbolLevel: z.boolean().default(true),
    /** Use test/source naming conventions as a low-confidence heuristic. */
    namingConventions: z.boolean().default(true),
    /** Follow `vi.mock()` / `jest.mock()` module paths as dependencies. */
    mockReferences: z.boolean().default(true),
    /** Maximum reverse-dependency distance to traverse. Omit for unlimited. */
    maxDepth: z.number().int().positive().optional(),
  })
  .strict();

export const CacheOptionsSchema = z
  .object({
    enabled: z.boolean().default(true),
    directory: z.string().min(1).default('.testimpact/cache'),
  })
  .strict();

export const DEFAULT_EXCLUDE = ['node_modules', '.git', '.next', 'dist', 'build', 'coverage', 'out', '.turbo', '.testimpact'];

export const DEFAULT_GLOBAL_FILES = [
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'tsconfig.json',
  'tsconfig.*.json',
  'jsconfig.json',
  'vitest.config.*',
  'vitest.workspace.*',
  'vite.config.*',
  'jest.config.*',
  'babel.config.*',
  '.babelrc',
  'testimpact.config.json',
  '.testimpactrc.json',
  '.testimpactrc',
];

export const ConfigSchema = z
  .object({
    $schema: z.string().optional(),
    include: z.array(z.string().min(1)).default(['**/*']),
    exclude: z.array(z.string().min(1)).default(DEFAULT_EXCLUDE),
    testFramework: FrameworkSchema.default('auto'),
    /** Glob patterns identifying test files. Defaults come from the detected framework adapter(s). */
    testPatterns: z.array(z.string().min(1)).optional(),
    analysis: AnalysisOptionsSchema.prefault({}),
    confidenceThreshold: ConfidenceSchema.default('medium'),
    /** Explicit source-to-test mappings for unconventional structures. */
    mappings: z.array(MappingSchema).default([]),
    /** Tests that are always recommended (for example smoke tests). */
    alwaysRun: z.array(z.string().min(1)).default([]),
    /** Files whose change makes TestImpact recommend the full suite. */
    globalFiles: z.array(z.string().min(1)).default(DEFAULT_GLOBAL_FILES),
    /** Extra path aliases, merged with tsconfig `paths` and framework aliases. */
    aliases: z.record(z.string().min(1), z.union([z.string().min(1), z.array(z.string().min(1))])).default({}),
    /** Path to tsconfig/jsconfig used for module resolution. Auto-detected when omitted. */
    tsconfig: z.string().min(1).optional(),
    /** Per-path overrides for test files. */
    overrides: z.array(OverrideSchema).default([]),
    cache: CacheOptionsSchema.prefault({}),
    /** Maximum concurrent file reads. */
    concurrency: z.number().int().min(1).max(256).default(32),
    /** Use `git ls-files` (respects .gitignore) for file discovery when inside a Git repository. */
    useGitignore: z.boolean().default(true),
  })
  .strict();

export type TestImpactConfigInput = z.input<typeof ConfigSchema>;
export type TestImpactConfig = z.output<typeof ConfigSchema>;

export interface ConfigValidationResult {
  ok: boolean;
  config?: TestImpactConfig;
  errors: string[];
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const where = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${where}: ${issue.message}`;
  });
}

/** Validate an already-parsed configuration object. */
export function validateConfig(input: unknown): ConfigValidationResult {
  const result = ConfigSchema.safeParse(input ?? {});
  if (result.success) return { ok: true, config: result.data, errors: [] };
  return { ok: false, errors: formatIssues(result.error) };
}

/** Parse configuration, throwing a TestImpactError on invalid input. */
export function parseConfig(input: unknown, source = 'configuration'): TestImpactConfig {
  const result = validateConfig(input);
  if (!result.ok || !result.config) {
    throw new TestImpactError('CONFIG_INVALID', `Invalid ${source}`, result.errors);
  }
  return result.config;
}

export async function findConfigFile(root: string): Promise<string | undefined> {
  for (const name of CONFIG_FILE_NAMES) {
    const candidate = path.join(root, name);
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      // not present
    }
  }
  return undefined;
}

export interface LoadedConfig {
  config: TestImpactConfig;
  /** Absolute path of the file that was loaded, if any. */
  file?: string;
}

/**
 * Load configuration from `explicitPath` or from the first config file found in `root`.
 * Configuration is JSON only: TestImpact never executes project code to read configuration.
 */
export async function loadConfig(root: string, explicitPath?: string): Promise<LoadedConfig> {
  const file = explicitPath ? path.resolve(root, explicitPath) : await findConfigFile(root);
  if (!file) return { config: parseConfig({}) };
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch {
    throw new TestImpactError('CONFIG_NOT_FOUND', `Configuration file not found: ${file}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new TestImpactError('CONFIG_INVALID', `Configuration file is not valid JSON: ${file}`, [
      error instanceof Error ? error.message : String(error),
    ]);
  }
  return { config: parseConfig(json, `configuration in ${path.basename(file)}`), file };
}

export const CONFIDENCE_ORDER: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

export function meetsThreshold(confidence: Confidence, threshold: Confidence): boolean {
  return CONFIDENCE_ORDER[confidence] >= CONFIDENCE_ORDER[threshold];
}
