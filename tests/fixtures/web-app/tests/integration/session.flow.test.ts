import { expect, it } from 'vitest';
import { createSession } from '../../src/auth';

it('creates sessions through the barrel', () => expect(createSession('3').token).toBeTruthy());
