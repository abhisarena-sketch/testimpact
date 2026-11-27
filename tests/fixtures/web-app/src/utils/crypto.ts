export function hash(value: string): string {
  let h = 0;
  for (const ch of value) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return String(h);
}

export function randomId(): string {
  return Math.random().toString(36).slice(2);
}
