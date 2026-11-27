import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isLocalRequest, resolveRoot } from '../apps/playground/lib/server.js';
import { asReport } from '../apps/playground/lib/validate.js';

describe('playground server guards', () => {
  const original = process.env.TESTIMPACT_ALLOWED_ROOT;
  afterEach(() => {
    if (original === undefined) delete process.env.TESTIMPACT_ALLOWED_ROOT;
    else process.env.TESTIMPACT_ALLOWED_ROOT = original;
  });

  it('only resolves project paths inside the allowed root', () => {
    process.env.TESTIMPACT_ALLOWED_ROOT = '/srv/projects';
    expect(resolveRoot('app')).toBe(path.resolve('/srv/projects/app'));
    expect(() => resolveRoot('../etc')).toThrow(/must be inside/);
    expect(() => resolveRoot('/etc')).toThrow(/must be inside/);
    expect(() => resolveRoot('')).toThrow(/required/);
    expect(() => resolveRoot('a\0b')).toThrow(/required/);
  });

  it('accepts only local requests', () => {
    expect(isLocalRequest(new Request('http://127.0.0.1:3210/api/analyze'))).toBe(true);
    expect(isLocalRequest(new Request('http://localhost:3210/api/analyze'))).toBe(true);
    expect(isLocalRequest(new Request('http://example.com/api/analyze'))).toBe(false);
  });

  it('validates uploaded reports', () => {
    expect(() => asReport({})).toThrow(/not a TestImpact/);
    expect(() => asReport({ tool: { name: 'testimpact' }, recommendations: [], allTests: [], schemaVersion: 9 })).toThrow(/schema version/);
    expect(asReport({ tool: { name: 'testimpact' }, recommendations: [], allTests: [], schemaVersion: 1 }).recommendations).toEqual([]);
  });
});
