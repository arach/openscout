/** Typed fetch wrapper for Scout API endpoints. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text || `HTTP ${res.status}`;
    try {
      const body = JSON.parse(text);
      if (body?.error) message = body.error;
    } catch { /* plain text */ }
    throw new Error(message);
  }
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}
