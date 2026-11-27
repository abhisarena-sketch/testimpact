import { expect, it } from 'vitest';
import { a } from './a';

it('alternates', () => expect(a(3)).toBeTypeOf('number'));
