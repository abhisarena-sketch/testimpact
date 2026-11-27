import { expect, it } from 'vitest';
import { hash } from './crypto';

it('hashes', () => expect(hash('a')).toBe(hash('a')));
