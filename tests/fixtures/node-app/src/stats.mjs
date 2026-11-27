import { add } from './math.mjs';

export function sum(values) {
  return values.reduce((s, v) => add(s, v), 0);
}
