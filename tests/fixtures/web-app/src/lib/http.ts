export async function post(url: string, body: unknown): Promise<unknown> {
  return { url, body };
}
