/**
 * Map over items with at most `limit` promises in flight.
 * Results keep the input order.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const max = Math.max(1, Math.floor(limit));
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i] as T, i);
    }
  }
  const workers = Array.from({ length: Math.min(max, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
