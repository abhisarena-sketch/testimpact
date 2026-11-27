import type { LineRange, ModuleInfo } from './types.js';

export type ChangedSymbols =
  | { kind: 'all'; reason: string }
  | {
      kind: 'some';
      /** Exported names whose implementation (or something it depends on) changed. */
      exports: string[];
      /** Top-level declarations that changed directly or transitively within the file. */
      declarations: string[];
    };

function overlaps(range: LineRange, start: number, end: number): boolean {
  return range.start <= end && range.end >= start;
}

/**
 * Determine which exports of a module are affected by the given changed line ranges.
 *
 * Changes inside a top-level declaration mark that declaration as changed; the change then
 * propagates to every top-level declaration in the same file that references it. A change to a
 * top-level statement that is not a declaration (for example a call with side effects) affects
 * the whole module. When this cannot be determined, `{ kind: 'all' }` is returned.
 */
export function computeChangedSymbols(info: ModuleInfo | undefined, changedLines: LineRange[] | undefined): ChangedSymbols {
  if (!info) return { kind: 'all', reason: 'module could not be analysed' };
  if (!changedLines || changedLines.length === 0) return { kind: 'all', reason: 'changed lines unknown' };
  if (info.commonJsExports) return { kind: 'all', reason: 'CommonJS exports are not analysed per symbol' };
  if (info.parseDiagnostics > 0) return { kind: 'all', reason: 'file has syntax errors' };

  const changed = new Set<string>();
  const importLocalsByLine = new Map<number, string[]>();
  for (const imp of info.imports) {
    if (imp.locals.length > 0) importLocalsByLine.set(imp.line, [...(importLocalsByLine.get(imp.line) ?? []), ...imp.locals]);
  }

  for (const decl of info.declarations) {
    if (!changedLines.some((r) => overlaps(r, decl.start, decl.end))) continue;
    switch (decl.kind) {
      case 'statement':
        return { kind: 'all', reason: `top-level statement changed (line ${decl.start})` };
      case 'import': {
        // A changed import binding affects every declaration that uses it.
        const locals: string[] = [];
        for (const [line, names] of importLocalsByLine) if (line >= decl.start && line <= decl.end) locals.push(...names);
        const sideEffect = info.imports.some((i) => i.line >= decl.start && i.line <= decl.end && i.kind === 'side-effect');
        if (sideEffect) return { kind: 'all', reason: `side-effect import changed (line ${decl.start})` };
        for (const l of locals) changed.add(l);
        break;
      }
      case 'export': {
        // Re-export or export list changed: the names it exports are affected.
        for (const exp of info.exports) if (exp.line >= decl.start && exp.line <= decl.end) changed.add(`export:${exp.name}`);
        break;
      }
      default:
        changed.add(decl.name);
    }
  }

  // Propagate within the file until a fixed point is reached.
  let grew = true;
  while (grew) {
    grew = false;
    for (const decl of info.declarations) {
      if (decl.name.startsWith('<') || changed.has(decl.name)) continue;
      if (decl.references.some((r) => changed.has(r))) {
        changed.add(decl.name);
        grew = true;
      }
    }
  }

  const exports = new Set<string>();
  for (const exp of info.exports) {
    if (changed.has(`export:${exp.name}`) || changed.has(exp.local)) exports.add(exp.name);
    if (exp.name === 'default' && exp.local === 'default' && changed.has('default')) exports.add('default');
  }
  // Star re-exports cannot be narrowed further here.
  if ([...exports].includes('*')) return { kind: 'all', reason: 'star re-export changed' };

  return {
    kind: 'some',
    exports: [...exports].sort(),
    declarations: [...changed].filter((n) => !n.startsWith('export:')).sort(),
  };
}
