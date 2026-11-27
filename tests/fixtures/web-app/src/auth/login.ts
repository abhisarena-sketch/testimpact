import { post } from '@/lib/http';
import type { User } from '@/types';
import { createSession } from './session';

export async function login(user: User) {
  await post('/login', user);
  return createSession(user.id);
}

export function logout(): void {}
