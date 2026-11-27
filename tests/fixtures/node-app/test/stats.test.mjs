import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sum } from '../src/stats.mjs';

test('sum', () => assert.equal(sum([1, 2, 3]), 6));
