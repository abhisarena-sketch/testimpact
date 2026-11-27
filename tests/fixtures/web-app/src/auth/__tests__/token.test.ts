import { expect, it } from 'vitest';
import { createToken } from '../token';

it('creates tokens', () => expect(createToken()).toBeTypeOf('string'));
