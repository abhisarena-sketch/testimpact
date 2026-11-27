import { expect, it } from 'vitest';
import { createSession } from './session';

it('creates a session', () => expect(createSession('1').userId).toBe('1'));
