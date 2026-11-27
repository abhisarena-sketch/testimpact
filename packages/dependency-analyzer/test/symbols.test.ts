import { describe, expect, it } from 'vitest';
import { computeChangedSymbols, parseModule } from '@testimpact/dependency-analyzer';

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
