import { expect, it } from 'vitest';
import { login } from '@/auth';

it('logs in end to end', async () => expect(await login({ id: '2', name: 'b' })).toBeTruthy());
