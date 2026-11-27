import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, meetsThreshold, parseConfig, validateConfig } from '@testimpact/core';
import { createTempProject, removeTemp } from '../../../tests/helpers/fixture.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) removeTemp(dirs.pop() as string);
});

describe('configuration', () => {
  it('applies defaults', () => {
    const config = parseConfig({});
    expect(config.include).toEqual(['**/*']);
    expect(config.exclude).toContain('node_modules');
    expect(config.confidenceThreshold).toBe('medium');
    expect(config.analysis.imports).toBe(true);
    expect(config.analysis.symbolLevel).toBe(true);
    expect(config.cache.enabled).toBe(true);
  });

  it('accepts the documented example configuration', () => {
    const result = validateConfig({
      include: ['src/**/*'],
      exclude: ['node_modules', '.next', 'dist', 'build'],
      testFramework: 'vitest',
      testPatterns: ['**/*.test.ts', '**/*.spec.ts'],
      analysis: { imports: true, exports: true, dynamicImports: true, pathAliases: true, testDiscovery: true },
      confidenceThreshold: 'medium',
    });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('normalises mappings and rejects unknown keys with readable paths', () => {
    const config = parseConfig({ mappings: [{ source: 'src/legacy/**', tests: ['tests/legacy/**'] }] });
    expect(config.mappings[0]).toEqual({ source: ['src/legacy/**'], tests: ['tests/legacy/**'] });
    const bad = validateConfig({ confidenceThreshold: 'certain', analysis: { imprts: true }, extra: 1 });
    expect(bad.ok).toBe(false);
    expect(bad.errors.join('\n')).toMatch(/confidenceThreshold/);
    expect(bad.errors.join('\n')).toMatch(/analysis/);
  });

  it('loads JSON configuration files and reports invalid JSON', async () => {
    const dir = createTempProject({ 'testimpact.config.json': '{"testFramework":"jest"}', 'bad.json': '{nope' });
    dirs.push(dir);
    const loaded = await loadConfig(dir);
    expect(loaded.config.testFramework).toBe('jest');
    expect(loaded.file).toMatch(/testimpact\.config\.json$/);
    await expect(loadConfig(dir, 'bad.json')).rejects.toThrow(/not valid JSON/);
    await expect(loadConfig(dir, 'missing.json')).rejects.toThrow(/not found/);
  });

  it('compares confidence levels', () => {
    expect(meetsThreshold('high', 'medium')).toBe(true);
    expect(meetsThreshold('low', 'medium')).toBe(false);
    expect(meetsThreshold('medium', 'medium')).toBe(true);
  });
});
