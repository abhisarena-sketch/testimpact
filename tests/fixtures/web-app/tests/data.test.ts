import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('reads fixtures', () => {
  const data = JSON.parse(readFileSync(new URL('../src/data/fixtures.json', import.meta.url), 'utf8'));
  expect(data.users).toEqual([]);
});
