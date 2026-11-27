import { createToken } from './token';

export function createSession(userId: string) {
  return { userId, token: createToken() };
}

export function endSession(): void {}
