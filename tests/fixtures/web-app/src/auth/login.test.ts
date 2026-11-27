import { expect, it } from 'vitest';
import { login } from './login';

it('logs in', async () => expect(await login({ id: '1', name: 'a' })).toBeTruthy());
