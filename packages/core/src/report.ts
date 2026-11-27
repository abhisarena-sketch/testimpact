import type { SerializedGraph } from '@testimpact/dependency-analyzer';
import type { FrameworkDetection, FrameworkName } from '@testimpact/framework-adapters';
import type { TestKind } from '@testimpact/test-discovery';
import type { Confidence } from './config.js';
import type { ChangeSource, ChangeStatus, LineRange } from './git.js';

export const REPORT_SCHEMA_VERSION = 1;

export type SelectionMode = 'recommended' | 'all-candidates' | 'full';

/** A piece of evidence that contributed to a recommendation. */
export type SignalType =
  | 'changed-test'
  | 'direct-import'
  | 'transitive-import'
  | 'barrel-reexport'
  | 'type-only'
  | 'dynamic-import'
  | 'mock-reference'
  | 'symbol-match'
  | 'unaffected-symbols'
  | 'manual-mapping'
  | 'naming-convention'
  | 'setup-file'
  | 'global-config'
  | 'always-run'
  | 'file-mention'
  | 'dynamic-pattern';

export interface Signal {
  type: SignalType;
  confidence: Confidence;
  detail: string;
  changedFile?: string;
}

export interface PathStep {
  file: string;
  /** How `file` imports the previous step (undefined for the first step). */
  via?: string;
  line?: number;
}

export interface Recommendation {
  /** Stable per report: TEST-001, TEST-002, ... ordered by rank. */
  id: string;
  testFile: string;
  framework: FrameworkName;
  testKind: TestKind;
  confidence: Confidence;
  /** Ranking score (0-100). Higher means more likely to be affected. */
  score: number;
  /** Primary, human-readable reason. */
  reason: string;
  /** All reasons (one per signal). */
  reasons: string[];
  changedFiles: string[];
  /** Best dependency path, from the changed file to the test file. */
  dependencyPath: string[];
  /** The same path with import details per hop. */
  dependencyPathDetail: PathStep[];
  /** Number of import hops on the best path (barrel re-exports included). */
  distance: number;
  /** Source files on the dependency paths (excluding the test itself). */
  relatedSourceFiles: string[];
  /** Changed exports this test reaches, when symbol-level analysis was possible. */
  changedSymbols?: string[];
  signals: Signal[];
  /** Whether the test is in the selected set for the report's selection mode. */
  selected: boolean;
  warnings: string[];
}

export type ChangedFileKind = 'source' | 'test' | 'config' | 'setup' | 'asset' | 'other';

export interface ChangedFileReport {
  path: string;
  status: ChangeStatus;
  oldPath?: string;
  kind: ChangedFileKind;
  /** Whether the file is part of the analysed dependency graph. */
  inGraph: boolean;
  changedLines?: LineRange[];
  /** Exports affected by the change, or `all` when this cannot be narrowed. */
  changedExports?: string[] | 'all';
  changedExportsReason?: string;
  /** Number of recommended tests linked to this file. */
  testsAffected: number;
  notes: string[];
}

export interface TestEntry {
  path: string;
  framework: FrameworkName;
  kind: TestKind;
  recommendationId?: string;
  selected: boolean;
}

export interface RunCommandEntry {
  framework: FrameworkName;
  command: string;
  args: string[];
  /** Shell-ready command line (arguments quoted). */
  commandLine: string;
  testCount: number;
}

export interface AnalysisTimings {
  configMs: number;
  fileDiscoveryMs: number;
  changeDetectionMs: number;
  testDiscoveryMs: number;
  graphMs: number;
  impactMs: number;
  totalMs: number;
}

export interface AnalysisStats {
  filesDiscovered: number;
  filesAnalysed: number;
  filesParsed: number;
  filesReusedFromCache: number;
  edges: number;
  unresolvedImports: number;
  unresolvedDynamicImports: number;
  cycles: number;
  testFiles: number;
  fileDiscoveryMethod: 'git' | 'filesystem';
  cacheUsed: boolean;
  timings: AnalysisTimings;
  memory: { rssMb: number; heapUsedMb: number };
}

export interface ImpactReport {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  tool: { name: 'testimpact'; version: string };
  generatedAt: string;
  /** Project directory name (absolute paths are not included in reports). */
  project: string;
  change: {
    source: ChangeSource;
    description: string;
    files: ChangedFileReport[];
  };
  selection: {
    mode: SelectionMode;
    threshold: Confidence;
    fullSuiteRecommended: boolean;
    fullSuiteReasons: string[];
    selectedTests: string[];
  };
  summary: {
    changedFiles: number;
    totalTests: number;
    candidates: number;
    selected: number;
    high: number;
    medium: number;
    low: number;
    /** Tests not selected, as a percentage of all tests. */
    skippedPercent: number;
  };
  recommendations: Recommendation[];
  /** Every discovered test, so that nothing is silently excluded. */
  allTests: TestEntry[];
  runCommands: RunCommandEntry[];
  frameworks: FrameworkDetection[];
  warnings: string[];
  stats: AnalysisStats;
  graph?: SerializedGraph & { tests: string[] };
}
