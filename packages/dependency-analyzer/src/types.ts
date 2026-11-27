/** How a module refers to another module. */
export type ImportKind =
  /** `import { a } from './x'` or `import x from './x'` */
  | 'static'
  /** `import './x'` */
  | 'side-effect'
  /** `import type { A } from './x'` or an import whose bindings are all `type` */
  | 'type'
  /** `import('./x')` with a statically known specifier */
  | 'dynamic'
  /** `require('./x')` with a string literal */
  | 'require'
  /** `export { a } from './x'` / `export * from './x'` */
  | 'reexport'
  /** `export type { A } from './x'` */
  | 'reexport-type'
  /** `vi.mock('./x')`, `jest.mock('./x')`, `vi.importActual('./x')` and similar */
  | 'mock';

export interface ReexportBinding {
  /** Name exported from the re-exporting module (`*` for `export * from`). */
  exported: string;
  /** Name imported from the target module (`*` for namespace or star re-exports). */
  imported: string;
}

export interface ModuleImport {
  specifier: string;
  kind: ImportKind;
  /** 1-based line number of the import. */
  line: number;
  /**
   * Imported names that are actually used. `default` for default imports and `*` when the
   * whole module is used (namespace imports used dynamically, side-effect imports, require, dynamic import).
   */
  names: string[];
  /** Local identifiers bound by this import. */
  locals: string[];
  reexports?: ReexportBinding[];
}

export type DeclarationKind =
  | 'function'
  | 'class'
  | 'variable'
  | 'type'
  | 'interface'
  | 'enum'
  | 'namespace'
  | 'default'
  | 'statement'
  | 'import'
  | 'export';

export interface Declaration {
  /** Declared name (`default` for anonymous default exports, `<statement>` for other statements). */
  name: string;
  kind: DeclarationKind;
  /** 1-based inclusive line range. */
  start: number;
  end: number;
  /** Names of other top-level declarations and import locals referenced from this declaration. */
  references: string[];
}

export interface ExportedSymbol {
  /** Public export name (`default` for default exports). */
  name: string;
  /** Local declaration name that backs the export. */
  local: string;
  kind: DeclarationKind | 'reexport';
  line: number;
}

export interface UnresolvedDynamicImport {
  line: number;
  /** Source text of the non-literal specifier expression (truncated). */
  expression: string;
  kind: 'dynamic' | 'require';
}

export interface ModuleInfo {
  imports: ModuleImport[];
  exports: ExportedSymbol[];
  declarations: Declaration[];
  /** Dynamic imports/requires whose specifier is not statically known. */
  dynamicUnresolved: UnresolvedDynamicImport[];
  /** Number of references to each imported local binding (function and class references). */
  references: Record<string, number>;
  /** True when the module uses CommonJS `module.exports` / `exports.x` assignments. */
  commonJsExports: boolean;
  /** Number of syntax errors reported by the parser (analysis continues on a best-effort basis). */
  parseDiagnostics: number;
  lineCount: number;
}

export interface LineRange {
  start: number;
  end: number;
}
