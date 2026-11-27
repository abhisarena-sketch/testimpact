import { describe, expect, it } from 'vitest';
import { parseModule } from '@testimpact/dependency-analyzer';

const byKind = (src: string, file = 'x.ts') => parseModule(file, src).imports.map((i) => ({ s: i.specifier, k: i.kind, n: i.names }));

describe('parseModule imports', () => {
  it('extracts static, default, namespace and side-effect imports', () => {
    const src = `
      import def, { a, b as c } from './one';
      import * as ns from './two';
      import './side';
      ns.login(); ns.logout();
      c(); a; def();
    `;
    expect(byKind(src)).toEqual([
      { s: './one', k: 'static', n: ['default', 'a', 'b'] },
      { s: './two', k: 'static', n: ['login', 'logout'] },
      { s: './side', k: 'side-effect', n: ['*'] },
    ]);
  });

  it('marks namespace imports used as values as whole-module imports', () => {
    expect(byKind(`import * as ns from './two'; register(ns);`)[0]?.n).toEqual(['*']);
  });

  it('distinguishes type-only imports', () => {
    const src = `
      import type { User } from './types';
      import { type Session, type Token } from './session';
      import { type A, value } from './mixed';
    `;
    expect(byKind(src).map((i) => i.k)).toEqual(['type', 'type', 'static']);
  });

  it('extracts dynamic imports and require calls with literal specifiers', () => {
    const src = `
      const lazy = () => import('./lazy');
      const tpl = import(\`./template\`);
      const { a, b: bee } = require('./cjs');
      const whole = require('./whole');
      const member = require('./member').thing;
      const dyn = import(\`./locales/\${lang}\`);
      const dyn2 = require(name);
    `;
    const info = parseModule('x.ts', src);
    expect(info.imports.map((i) => [i.specifier, i.kind, i.names])).toEqual([
      ['./lazy', 'dynamic', ['*']],
      ['./template', 'dynamic', ['*']],
      ['./cjs', 'require', ['a', 'b']],
      ['./whole', 'require', ['*']],
      ['./member', 'require', ['thing']],
    ]);
    expect(info.dynamicUnresolved.map((d) => d.kind)).toEqual(['dynamic', 'require']);
    expect(info.dynamicUnresolved[0]?.expression).toContain('locales');
  });

  it('can disable dynamic import analysis', () => {
    const info = parseModule('x.ts', `import('./lazy'); require('./r');`, { dynamicImports: false });
    expect(info.imports).toEqual([]);
  });

  it('extracts vi.mock and jest.mock module references', () => {
    const src = `
      vi.mock('./api');
      jest.mock('../db', () => ({}));
      const actual = await vi.importActual('./real');
      jest.requireActual('./other');
    `;
    expect(byKind(src).map((i) => [i.s, i.k])).toEqual([
      ['./api', 'mock'],
      ['../db', 'mock'],
      ['./real', 'mock'],
      ['./other', 'mock'],
    ]);
  });
});

describe('parseModule exports', () => {
  it('extracts declarations, default exports and re-exports', () => {
    const src = `
      export function login() {}
      export class Session {}
      export const a = 1, b = 2;
      export interface User {}
      export type Id = string;
      export enum Role { Admin }
      export default function main() {}
      export { x as y } from './x';
      export * from './all';
      export * as utils from './utils';
      export type { T } from './types';
    `;
    const info = parseModule('x.ts', src);
    expect(info.exports.map((e) => e.name)).toEqual(['login', 'Session', 'a', 'b', 'User', 'Id', 'Role', 'default', 'y', '*', 'utils', 'T']);
    const reexports = info.imports.filter((i) => i.kind.startsWith('reexport'));
    expect(reexports.map((r) => [r.specifier, r.kind, r.reexports])).toEqual([
      ['./x', 'reexport', [{ exported: 'y', imported: 'x' }]],
      ['./all', 'reexport', [{ exported: '*', imported: '*' }]],
      ['./utils', 'reexport', [{ exported: 'utils', imported: '*' }]],
      ['./types', 'reexport-type', [{ exported: 'T', imported: 'T' }]],
    ]);
  });

  it('treats import-then-export as a re-export', () => {
    const info = parseModule('index.ts', `import { login } from './login'; import * as all from './all'; export { login, all as everything };`);
    expect(info.imports[0]?.reexports).toEqual([{ exported: 'login', imported: 'login' }]);
    expect(info.imports[1]?.reexports).toEqual([{ exported: 'everything', imported: '*' }]);
  });

  it('detects CommonJS exports', () => {
    expect(parseModule('x.js', 'module.exports = { a };').commonJsExports).toBe(true);
    expect(parseModule('x.js', 'exports.a = 1;').commonJsExports).toBe(true);
    expect(parseModule('x.js', 'export const a = 1;').commonJsExports).toBe(false);
  });
});

describe('parseModule references', () => {
  it('counts function and class references and ignores property names', () => {
    const src = `
      import { login, Session, unused } from './auth';
      const s = new Session();
      login(); login();
      const obj = { login: 1 };
      obj.login;
    `;
    const info = parseModule('x.ts', src);
    expect(info.references).toEqual({ Session: 1, login: 2 });
  });

  it('records intra-file references between top-level declarations', () => {
    const src = `
      import { hash } from './crypto';
      function helper() { return hash('x'); }
      export function login() { return helper(); }
      export function logout() { return 1; }
    `;
    const info = parseModule('x.ts', src);
    const refs = Object.fromEntries(info.declarations.filter((d) => d.kind === 'function').map((d) => [d.name, d.references]));
    expect(refs).toEqual({ helper: ['hash'], login: ['helper'], logout: [] });
  });

  it('parses JSX and counts component references', () => {
    const info = parseModule('x.tsx', `import { Button } from './Button'; export const App = () => <Button label="x" />;`);
    expect(info.references).toEqual({ Button: 1 });
    expect(info.parseDiagnostics).toBe(0);
  });

  it('survives syntax errors', () => {
    const info = parseModule('x.ts', `import { a } from './a';\nexport const = ;`);
    expect(info.imports[0]?.specifier).toBe('./a');
    expect(info.parseDiagnostics).toBeGreaterThan(0);
  });
});
