const inFlightGets = new Map<string, Promise<string>>();

function parseApiResponse<T>(text: string): T {
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

function normalizeHeaders(headers?: HeadersInit): string {
  if (!headers) return "";
  return JSON.stringify([...new Headers(headers).entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function requestKey(path: string, init?: RequestInit): string {
  const method = (init?.method ?? "GET").toUpperCase();
  return `${method}:${path}:${normalizeHeaders(init?.headers)}`;
}

async function fetchApiText(path: string, init?: RequestInit): Promise<string> {
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
    } catch {
      /* plain text */
    }
    throw new Error(message);
  }
  return await res.text();
}

export function clearApiGetCache(): void {
  inFlightGets.clear();
}

/** Typed fetch wrapper for Scout API endpoints. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const dedupeGet = method === "GET" && !init?.body;

  if (!dedupeGet) {
    return parseApiResponse<T>(await fetchApiText(path, init));
  }

  const key = requestKey(path, init);
  const existing = inFlightGets.get(key);
  if (existing) {
    return parseApiResponse<T>(await existing);
  }

  const request = fetchApiText(path, init);
  inFlightGets.set(key, request);

  try {
    return parseApiResponse<T>(await request);
  } finally {
    inFlightGets.delete(key);
  }
}
