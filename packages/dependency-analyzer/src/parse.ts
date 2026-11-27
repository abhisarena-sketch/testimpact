import ts from 'typescript';
import type {
  Declaration,
  DeclarationKind,
  ExportedSymbol,
  ImportKind,
  ModuleImport,
  ModuleInfo,
  ReexportBinding,
  UnresolvedDynamicImport,
} from './types.js';

export interface ParseOptions {
  /** Analyse static `import` declarations. Default true. */
  imports?: boolean;
  /** Analyse exports and re-exports. Default true. */
  exports?: boolean;
  /** Analyse `import()` and `require()` calls with literal specifiers. Default true. */
  dynamicImports?: boolean;
  /** Treat `vi.mock('./x')` / `jest.mock('./x')` module paths as references. Default true. */
  mockReferences?: boolean;
}

export const PARSEABLE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'] as const;

export function isParseable(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return PARSEABLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function scriptKindFor(fileName: string): ts.ScriptKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return ts.ScriptKind.JSX;
  return ts.ScriptKind.TS;
}

const MOCK_OBJECTS = new Set(['vi', 'jest']);
const MOCK_METHODS = new Set([
  'mock',
  'doMock',
  'unmock',
  'doUnmock',
  'importActual',
  'importMock',
  'requireActual',
  'requireMock',
  'setMock',
  'createMockFromModule',
]);

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return mods?.some((m) => m.kind === kind) ?? false;
}

function bindingNames(name: ts.BindingName, out: string[] = []): string[] {
  if (ts.isIdentifier(name)) out.push(name.text);
  else {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) bindingNames(element.name, out);
    }
  }
  return out;
}

function stringLiteralValue(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

/** Whether `id` is in a position where it names a property rather than referencing a binding. */
function isNonReferencePosition(id: ts.Identifier): boolean {
  const parent = id.parent;
  if (!parent) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return true;
  if (ts.isQualifiedName(parent) && parent.right === id) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === id) return true;
  if ((ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) || ts.isMethodSignature(parent)) && parent.name === id)
    return true;
  if ((ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent)) && parent.name === id) return true;
  if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) || ts.isImportEqualsDeclaration(parent)) return true;
  if (ts.isExportSpecifier(parent) && parent.name === id && parent.propertyName !== undefined) return true;
  if (ts.isBindingElement(parent) && parent.propertyName === id) return true;
  if (ts.isEnumMember(parent) && parent.name === id) return true;
  if (ts.isJsxAttribute(parent)) return true;
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return true;
  return false;
}

/**
 * Parse a module with the TypeScript compiler API (syntax only, no type checking)
 * and extract imports, exports, top-level declarations and references.
 */
export function parseModule(fileName: string, sourceText: string, options: ParseOptions = {}): ModuleInfo {
  const opts = {
    imports: options.imports ?? true,
    exports: options.exports ?? true,
    dynamicImports: options.dynamicImports ?? true,
    mockReferences: options.mockReferences ?? true,
  };
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, scriptKindFor(fileName));
  const lineOf = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;

  const imports: ModuleImport[] = [];
  const exportsList: ExportedSymbol[] = [];
  const declarations: Declaration[] = [];
  const dynamicUnresolved: UnresolvedDynamicImport[] = [];
  let commonJsExports = false;

  /** local name -> import record */
  const importLocals = new Map<string, ModuleImport>();
  /** namespace import local -> import record */
  const namespaceLocals = new Map<string, ModuleImport>();
  const namespaceUsage = new Map<string, Set<string> | '*'>();
  const localExports: { name: string; local: string; line: number }[] = [];

  const unresolvedDynamic = (arg: ts.Expression, line: number, kind: 'dynamic' | 'require'): UnresolvedDynamicImport => {
    const entry: UnresolvedDynamicImport = { line, expression: arg.getText(sf).slice(0, 80), kind };
    if (ts.isTemplateExpression(arg) && arg.head.text.length > 0) entry.prefix = arg.head.text;
    else if (ts.isBinaryExpression(arg) && arg.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = stringLiteralValue(arg.left);
      if (left) entry.prefix = left;
    }
    return entry;
  };

  const declare = (name: string, kind: DeclarationKind, node: ts.Node) => {
    const decl: Declaration = { name, kind, start: lineOf(node.getStart(sf)), end: lineOf(node.getEnd()), references: [] };
    declarations.push(decl);
    (nodeDecls.get(node) ?? nodeDecls.set(node, []).get(node))?.push(decl);
    return decl;
  };
  const nodeDecls = new Map<ts.Node, Declaration[]>();

  for (const statement of sf.statements) {
    const line = lineOf(statement.getStart(sf));
    const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);
    const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);

    if (ts.isImportDeclaration(statement)) {
      const specifier = stringLiteralValue(statement.moduleSpecifier);
      declare('<import>', 'import', statement);
      if (!specifier || !opts.imports) continue;
      const clause = statement.importClause;
      if (!clause) {
        imports.push({ specifier, kind: 'side-effect', line, names: ['*'], locals: [] });
        continue;
      }
      const names: string[] = [];
      const locals: string[] = [];
      let allType = clause.isTypeOnly;
      let anyValue = false;
      const bindingsList: { imported: string; local: string }[] = [];
      const record: ModuleImport = { specifier, kind: 'static', line, names, locals, bindings: bindingsList };
      if (clause.name) {
        names.push('default');
        locals.push(clause.name.text);
        bindingsList.push({ imported: 'default', local: clause.name.text });
        importLocals.set(clause.name.text, record);
        anyValue = !clause.isTypeOnly;
      }
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        locals.push(bindings.name.text);
        bindingsList.push({ imported: '*', local: bindings.name.text });
        namespaceLocals.set(bindings.name.text, record);
        importLocals.set(bindings.name.text, record);
        anyValue = !clause.isTypeOnly;
      } else if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          names.push((element.propertyName ?? element.name).text);
          locals.push(element.name.text);
          bindingsList.push({ imported: (element.propertyName ?? element.name).text, local: element.name.text });
          importLocals.set(element.name.text, record);
          if (!element.isTypeOnly && !clause.isTypeOnly) anyValue = true;
        }
      }
      if (!anyValue && (names.length > 0 || locals.length > 0)) allType = true;
      record.kind = allType ? 'type' : 'static';
      imports.push(record);
      continue;
    }

    if (ts.isImportEqualsDeclaration(statement)) {
      declare('<import>', 'import', statement);
      const ref = statement.moduleReference;
      if (opts.imports && ts.isExternalModuleReference(ref)) {
        const specifier = stringLiteralValue(ref.expression);
        if (specifier) {
          const record: ModuleImport = {
            specifier,
            kind: statement.isTypeOnly ? 'type' : 'require',
            line,
            names: ['*'],
            locals: [statement.name.text],
            bindings: [{ imported: '*', local: statement.name.text }],
          };
          importLocals.set(statement.name.text, record);
          imports.push(record);
        }
      }
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      declare('<export>', 'export', statement);
      if (!opts.exports) continue;
      const specifier = stringLiteralValue(statement.moduleSpecifier);
      const clause = statement.exportClause;
      if (specifier) {
        const reexports: ReexportBinding[] = [];
        if (!clause) reexports.push({ exported: '*', imported: '*' });
        else if (ts.isNamespaceExport(clause)) reexports.push({ exported: clause.name.text, imported: '*' });
        else for (const el of clause.elements) reexports.push({ exported: el.name.text, imported: (el.propertyName ?? el.name).text });
        const typeOnly = statement.isTypeOnly || (clause !== undefined && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every((e) => e.isTypeOnly));
        imports.push({
          specifier,
          kind: typeOnly ? 'reexport-type' : 'reexport',
          line,
          names: [...new Set(reexports.map((r) => r.imported))],
          locals: [],
          reexports,
        });
        for (const r of reexports) exportsList.push({ name: r.exported, local: r.exported, kind: 'reexport', line });
      } else if (clause && ts.isNamedExports(clause)) {
        for (const el of clause.elements) {
          localExports.push({ name: el.name.text, local: (el.propertyName ?? el.name).text, line });
        }
      }
      continue;
    }

    if (ts.isExportAssignment(statement)) {
      const decl = declare('default', 'default', statement);
      void decl;
      if (opts.exports) {
        const local = ts.isIdentifier(statement.expression) ? statement.expression.text : 'default';
        if (local !== 'default') localExports.push({ name: 'default', local, line });
        else exportsList.push({ name: 'default', local: 'default', kind: 'default', line });
      }
      continue;
    }

    const exportName = (name: string) => (isDefault ? 'default' : name);
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      const kind: DeclarationKind = ts.isFunctionDeclaration(statement) ? 'function' : 'class';
      const name = statement.name?.text ?? 'default';
      declare(name, kind, statement);
      if (exported && opts.exports) exportsList.push({ name: exportName(name), local: name, kind, line });
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      const names = statement.declarationList.declarations.flatMap((d) => bindingNames(d.name));
      for (const name of names) {
        declare(name, 'variable', statement);
        if (exported && opts.exports) exportsList.push({ name, local: name, kind: 'variable', line });
      }
      // CommonJS: const x = require('./y') is handled in the full walk.
      continue;
    }
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement)) {
      const kind: DeclarationKind = ts.isInterfaceDeclaration(statement)
        ? 'interface'
        : ts.isTypeAliasDeclaration(statement)
          ? 'type'
          : ts.isEnumDeclaration(statement)
            ? 'enum'
            : 'namespace';
      const name = ts.isIdentifier(statement.name) ? statement.name.text : statement.name.text;
      declare(name, kind, statement);
      if (exported && opts.exports) exportsList.push({ name: exportName(name), local: name, kind, line });
      continue;
    }
    declare('<statement>', 'statement', statement);
  }

  const topLevelNames = new Set(declarations.filter((d) => !d.name.startsWith('<') && d.name !== 'default').map((d) => d.name));
  const references: Record<string, number> = {};

  const visit = (node: ts.Node, currentDecls: Declaration[] | undefined): void => {
    const decls = nodeDecls.get(node) ?? currentDecls;

    if (ts.isIdentifier(node) && !isNonReferencePosition(node)) {
      const text = node.text;
      if (importLocals.has(text)) {
        const parent = node.parent;
        const isOwnBinding = parent && (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent));
        if (!isOwnBinding) {
          references[text] = (references[text] ?? 0) + 1;
          if (namespaceLocals.has(text)) {
            const usage = namespaceUsage.get(text);
            if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === node) {
              if (usage !== '*') namespaceUsage.set(text, (usage ?? new Set()).add(parent.name.text));
            } else if (parent && ts.isQualifiedName(parent) && parent.left === node) {
              if (usage !== '*') namespaceUsage.set(text, (usage ?? new Set()).add(parent.right.text));
            } else {
              namespaceUsage.set(text, '*');
            }
          }
        }
      }
      if (decls && (topLevelNames.has(text) || importLocals.has(text))) {
        for (const d of decls) if (d.name !== text && !d.references.includes(text)) d.references.push(text);
      }
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const firstArg = node.arguments[0];
      const callLine = lineOf(node.getStart(sf));
      if (callee.kind === ts.SyntaxKind.ImportKeyword) {
        if (opts.dynamicImports) {
          const spec = stringLiteralValue(firstArg);
          if (spec) imports.push({ specifier: spec, kind: 'dynamic', line: callLine, names: ['*'], locals: [] });
          else if (firstArg) dynamicUnresolved.push(unresolvedDynamic(firstArg, callLine, 'dynamic'));
        }
      } else if (ts.isIdentifier(callee) && callee.text === 'require' && node.arguments.length === 1) {
        if (opts.dynamicImports) {
          const spec = stringLiteralValue(firstArg);
          if (spec) {
            const parent = node.parent;
            let names = ['*'];
            const locals: string[] = [];
            if (parent && ts.isVariableDeclaration(parent) && parent.initializer === node) {
              if (ts.isObjectBindingPattern(parent.name)) {
                names = parent.name.elements.map((el) => {
                  const prop = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : '*';
                  return prop;
                });
                locals.push(...bindingNames(parent.name));
              } else if (ts.isIdentifier(parent.name)) locals.push(parent.name.text);
            } else if (parent && ts.isPropertyAccessExpression(parent) && parent.expression === node) {
              names = [parent.name.text];
            }
            const requireBindings = !names.includes('*') && names.length === locals.length ? names.map((n, i) => ({ imported: n, local: locals[i] as string })) : locals.map((l) => ({ imported: '*', local: l }));
            imports.push({ specifier: spec, kind: 'require', line: callLine, names: names.includes('*') ? ['*'] : names, locals, bindings: requireBindings });
          } else if (firstArg) {
            dynamicUnresolved.push(unresolvedDynamic(firstArg, callLine, 'require'));
          }
        }
      } else if (
        opts.mockReferences &&
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        MOCK_OBJECTS.has(callee.expression.text) &&
        MOCK_METHODS.has(callee.name.text)
      ) {
        const spec = stringLiteralValue(firstArg);
        if (spec) imports.push({ specifier: spec, kind: 'mock', line: callLine, names: ['*'], locals: [] });
      }
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = node.left;
      const text = ts.isPropertyAccessExpression(left) ? left.getText(sf) : '';
      if (text === 'module.exports' || text.startsWith('module.exports.') || text.startsWith('exports.')) commonJsExports = true;
    }

    ts.forEachChild(node, (child) => visit(child, decls));
  };
  for (const statement of sf.statements) visit(statement, undefined);

  // Resolve namespace import usage into imported names.
  for (const [local, record] of namespaceLocals) {
    const usage = namespaceUsage.get(local);
    const usedNames = usage === undefined || usage === '*' ? ['*'] : [...usage];
    for (const n of usedNames) if (!record.names.includes(n)) record.names.push(n);
  }

  // Local export lists: `export { a as b }`. If `a` is an import binding, this is a re-export.
  for (const { name, local, line } of localExports) {
    const imp = importLocals.get(local);
    if (imp) {
      const isNamespace = namespaceLocals.get(local) === imp;
      const importedName = isNamespace ? '*' : (imp.bindings?.find((b) => b.local === local)?.imported ?? '*');
      (imp.reexports ??= []).push({ exported: name, imported: importedName });
      exportsList.push({ name, local, kind: 'reexport', line });
    } else {
      const decl = declarations.find((d) => d.name === local);
      exportsList.push({ name, local, kind: decl?.kind ?? 'variable', line });
    }
  }

  const parseDiagnostics = (sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics?.length ?? 0;
  return {
    imports,
    exports: exportsList,
    declarations,
    dynamicUnresolved,
    references,
    commonJsExports,
    parseDiagnostics,
    lineCount: sf.getLineAndCharacterOfPosition(sf.getEnd()).line + 1,
  };
}

export type { ImportKind };
