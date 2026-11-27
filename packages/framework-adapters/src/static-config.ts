import path from 'node:path';
import ts from 'typescript';

/**
 * Helpers that read framework configuration files *statically* with the TypeScript parser.
 * Configuration files are never executed: only literal values (and a few well-known path
 * helpers such as `path.resolve(__dirname, 'src')`) are understood. Anything else is reported
 * so the user can add an explicit TestImpact setting instead.
 */

export type StaticValue = string | number | boolean | null | StaticValue[] | { [key: string]: StaticValue } | RegExpValue | UnknownValue;

export interface RegExpValue {
  $regexp: string;
  flags: string;
}

export interface UnknownValue {
  $unknown: string;
}

export function isUnknown(v: unknown): v is UnknownValue {
  return typeof v === 'object' && v !== null && '$unknown' in v;
}

export function isRegExpValue(v: unknown): v is RegExpValue {
  return typeof v === 'object' && v !== null && '$regexp' in v;
}

const PATH_FUNCS = new Set(['resolve', 'join']);

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression)) return name.expression.text;
  return undefined;
}

export class StaticEvaluator {
  constructor(
    private readonly sf: ts.SourceFile,
    private readonly configDir: string,
  ) {}

  private readonly constants = new Map<string, ts.Expression>();

  /** Index top-level `const x = <literal>` declarations so references to them can be resolved. */
  indexConstants(): this {
    for (const st of this.sf.statements) {
      if (ts.isVariableStatement(st) && (st.declarationList.flags & ts.NodeFlags.Const) !== 0) {
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.initializer) this.constants.set(d.name.text, d.initializer);
        }
      }
    }
    return this;
  }

  evaluate(node: ts.Expression | undefined, depth = 0): StaticValue {
    if (!node || depth > 20) return { $unknown: 'too deep' };
    while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node)) {
      node = node.expression;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isRegularExpressionLiteral(node)) {
      const text = node.text;
      const last = text.lastIndexOf('/');
      return { $regexp: text.slice(1, last), flags: text.slice(last + 1) };
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.map((e) => (ts.isSpreadElement(e) ? { $unknown: 'spread' } : this.evaluate(e, depth + 1)));
    if (ts.isObjectLiteralExpression(node)) {
      const out: Record<string, StaticValue> = {};
      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop)) {
          const key = propertyName(prop.name);
          if (key !== undefined) out[key] = this.evaluate(prop.initializer, depth + 1);
        } else if (ts.isShorthandPropertyAssignment(prop)) {
          out[prop.name.text] = this.evaluate(prop.name, depth + 1);
        }
      }
      return out;
    }
    if (ts.isIdentifier(node)) {
      if (node.text === '__dirname') return this.configDir;
      const c = this.constants.get(node.text);
      if (c) return this.evaluate(c, depth + 1);
      return { $unknown: node.text };
    }
    if (ts.isTemplateExpression(node)) {
      let s = node.head.text;
      for (const span of node.templateSpans) {
        const v = this.evaluate(span.expression, depth + 1);
        if (typeof v !== 'string') return { $unknown: node.getText(this.sf) };
        s += v + span.literal.text;
      }
      return s;
    }
    if (ts.isPropertyAccessExpression(node)) {
      // new URL('./src', import.meta.url).pathname
      if (node.name.text === 'pathname' && ts.isNewExpression(node.expression)) return this.evaluateUrl(node.expression);
      // import.meta.dirname
      if (node.name.text === 'dirname' && ts.isMetaProperty(node.expression)) return this.configDir;
      return { $unknown: node.getText(this.sf) };
    }
    if (ts.isNewExpression(node)) {
      if (ts.isIdentifier(node.expression) && node.expression.text === 'RegExp') {
        const [src, flags] = (node.arguments ?? []).map((a) => this.evaluate(a, depth + 1));
        if (typeof src === 'string') return { $regexp: src, flags: typeof flags === 'string' ? flags : '' };
      }
      return { $unknown: node.getText(this.sf) };
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const calleeName = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : '';
      const objectName = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) ? callee.expression.text : '';
      // path.resolve(__dirname, 'src') / resolve(__dirname, './src') / path.join(...)
      if (PATH_FUNCS.has(calleeName) && (objectName === 'path' || objectName === '' || objectName === 'posix')) {
        const parts = node.arguments.map((a) => this.evaluate(a, depth + 1));
        if (parts.every((p): p is string => typeof p === 'string')) {
          return calleeName === 'join' ? path.join(...parts) : path.resolve(this.configDir, ...parts);
        }
      }
      if (ts.isIdentifier(callee) && callee.text === 'fileURLToPath') {
        const arg = node.arguments[0];
        if (arg && ts.isNewExpression(arg)) return this.evaluateUrl(arg);
      }
      // process.cwd()
      if (calleeName === 'cwd' && objectName === 'process') return this.configDir;
      // defineConfig({...}) and friends: return the first argument's value
      if (/^define(Config|Project|Workspace)$/.test(calleeName) && node.arguments[0]) return this.evaluate(node.arguments[0], depth + 1);
      return { $unknown: node.getText(this.sf).slice(0, 80) };
    }
    return { $unknown: node.getText(this.sf).slice(0, 80) };
  }

  private evaluateUrl(expr: ts.NewExpression): StaticValue {
    const [first, second] = expr.arguments ?? [];
    const rel = this.evaluate(first);
    if (typeof rel === 'string' && second && second.getText(this.sf) === 'import.meta.url') return path.resolve(this.configDir, rel);
    return { $unknown: expr.getText(this.sf) };
  }
}

function unwrapToObject(expr: ts.Expression | undefined): ts.ObjectLiteralExpression | undefined {
  let node = expr;
  for (let i = 0; node && i < 10; i++) {
    while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression;
    if (ts.isObjectLiteralExpression(node)) return node;
    if (ts.isCallExpression(node)) {
      // defineConfig({...}), mergeConfig(base, defineConfig({...})): prefer the last object-like argument
      const args = [...node.arguments].reverse();
      const found = args.map((a) => unwrapToObject(a)).find(Boolean);
      return found;
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      const body = node.body;
      if (ts.isBlock(body)) {
        const ret = body.statements.find(ts.isReturnStatement);
        node = ret?.expression;
      } else node = body;
      continue;
    }
    return undefined;
  }
  return undefined;
}

export interface ParsedConfigFile {
  value: Record<string, StaticValue> | undefined;
  sourceFile: ts.SourceFile;
}

/** Locate and statically evaluate the exported configuration object of a JS/TS config file. */
export function readStaticConfigObject(fileName: string, text: string): ParsedConfigFile {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const evaluator = new StaticEvaluator(sf, path.dirname(fileName)).indexConstants();
  const constants = new Map<string, ts.Expression>();
  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer) constants.set(d.name.text, d.initializer);
  }
  let target: ts.Expression | undefined;
  for (const st of sf.statements) {
    if (ts.isExportAssignment(st)) target = st.expression;
    else if (
      ts.isExpressionStatement(st) &&
      ts.isBinaryExpression(st.expression) &&
      st.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      st.expression.left.getText(sf) === 'module.exports'
    )
      target = st.expression.right;
  }
  if (target && ts.isIdentifier(target)) target = constants.get(target.text);
  const obj = unwrapToObject(target);
  if (!obj) return { value: undefined, sourceFile: sf };
  const value = evaluator.evaluate(obj);
  return { value: typeof value === 'object' && value !== null && !Array.isArray(value) && !isUnknown(value) && !isRegExpValue(value) ? (value as Record<string, StaticValue>) : undefined, sourceFile: sf };
}

export function asStringArray(v: StaticValue | undefined): string[] | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'string') return [v];
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v as string[];
  return undefined;
}

export function asRecord(v: StaticValue | undefined): Record<string, StaticValue> | undefined {
  if (typeof v === 'object' && v !== null && !Array.isArray(v) && !isUnknown(v) && !isRegExpValue(v)) return v as Record<string, StaticValue>;
  return undefined;
}
