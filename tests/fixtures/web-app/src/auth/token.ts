import { randomId } from '../utils/crypto.js';

export function createToken(): string {
  return randomId();
}
