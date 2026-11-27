import { describe, expect, it } from 'vitest';
import { computeChangedSymbols, parseModule, propagateFromDependency } from '@testimpact/dependency-analyzer';

const src = [
  "import { hash } from './crypto';", // 1
  '', // 2
  'function helper() {', // 3
  "  return hash('x');", // 4
  '}', // 5
  '', // 6
  'export function login() {', // 7
  '  return helper();', // 8
  '}', // 9
  '', // 10
  'export function logout() {', // 11
  '  return 1;', // 12
  '}', // 13
  '', // 14
  'export class Session {}', // 15
  "registerPlugin('auth');", // 16
].join('\n');
const info = parseModule('auth.ts', src);

describe('computeChangedSymbols', () => {
  it('maps changed lines to exported declarations', () => {
    expect(computeChangedSymbols(info, [{ start: 12, end: 12 }])).toEqual({ kind: 'some', exports: ['logout'], declarations: ['logout'] });
  });

  it('propagates changes through intra-file references', () => {
    expect(computeChangedSymbols(info, [{ start: 4, end: 4 }])).toEqual({ kind: 'some', exports: ['login'], declarations: ['helper', 'login'] });
  });

  it('propagates changed import bindings to their users', () => {
    const result = computeChangedSymbols(info, [{ start: 1, end: 1 }]);
    expect(result).toEqual({ kind: 'some', exports: ['login'], declarations: ['hash', 'helper', 'login'] });
  });

  it('treats top-level statements as whole-module changes', () => {
    expect(computeChangedSymbols(info, [{ start: 16, end: 16 }]).kind).toBe('all');
  });

  it('returns no exports when only blank lines changed', () => {
    expect(computeChangedSymbols(info, [{ start: 14, end: 14 }])).toEqual({ kind: 'some', exports: [], declarations: [] });
  });

  it('falls back to the whole module when line ranges are unknown or the module is CommonJS', () => {
    expect(computeChangedSymbols(info, undefined).kind).toBe('all');
    expect(computeChangedSymbols(parseModule('x.js', 'module.exports = {}'), [{ start: 1, end: 1 }]).kind).toBe('all');
  });
});

describe('propagateFromDependency', () => {
  const barrel = parseModule('index.ts', "export { login, logout } from './login';\nexport * from './session';\n");
  const consumer = parseModule(
    'consumer.ts',
    [
      "import { login, logout as out } from './auth';", // 1
      "import * as ns from './ns';", // 2
      'export function doLogin() { return login(); }', // 3
      'export function doLogout() { return out(); }', // 4
      'export const viaNs = () => ns.helper();', // 5
    ].join('\n'),
  );

  it('maps affected exports through named re-exports and star re-exports', () => {
    const loginEdge = barrel.imports.filter((i) => i.specifier === './login');
    expect(propagateFromDependency(barrel, loginEdge, new Set(['logout']))).toMatchObject({ kind: 'some', exports: ['logout'], usesAffected: true });
    const sessionEdge = barrel.imports.filter((i) => i.specifier === './session');
    expect(propagateFromDependency(barrel, sessionEdge, new Set(['createSession']))).toMatchObject({ kind: 'some', exports: ['createSession'] });
    expect(propagateFromDependency(barrel, sessionEdge, 'all').kind).toBe('all');
  });

  it('follows import bindings into dependent declarations', () => {
    const authEdge = consumer.imports.filter((i) => i.specifier === './auth');
    expect(propagateFromDependency(consumer, authEdge, new Set(['logout']))).toMatchObject({ exports: ['doLogout'], usesAffected: true });
    expect(propagateFromDependency(consumer, authEdge, new Set(['createSession']))).toMatchObject({ exports: [], usesAffected: false });
    const nsEdge = consumer.imports.filter((i) => i.specifier === './ns');
    expect(propagateFromDependency(consumer, nsEdge, new Set(['helper']))).toMatchObject({ exports: ['viaNs'] });
    expect(propagateFromDependency(consumer, nsEdge, new Set(['other']))).toMatchObject({ usesAffected: false });
  });

  it('treats side-effect imports and statements that use changed bindings as whole-module changes', () => {
    const side = parseModule('s.ts', "import './polyfill';\nexport const x = 1;");
    expect(propagateFromDependency(side, side.imports, new Set(['anything'])).kind).toBe('all');
    const stmt = parseModule('t.ts', "import { register } from './r';\nregister('x');\nexport const y = 1;");
    expect(propagateFromDependency(stmt, stmt.imports, new Set(['register'])).kind).toBe('all');
  });
});
