import { expect, it } from 'vitest';
import { formatDate } from '../src/utils/format';

it('formats dates', () => expect(formatDate(new Date(0))).toBe('1970-01-01'));
