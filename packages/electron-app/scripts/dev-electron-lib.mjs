import net from "node:net";

export const DEFAULT_RENDERER_PORT = 43173;
export const SCOUT_RENDERER_ENTRY_MARKER = "/apps/scout/src/ui/desktop/entry-client.tsx";

export function buildRendererUrl(host, port) {
  return `http://${host}:${port}`;
}

export function isScoutRendererEntrySource(source) {
  return source.includes(SCOUT_RENDERER_ENTRY_MARKER);
}

export async function waitForScoutRenderer(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetchImpl(url);
      if (response.ok) {
        const entryResponse = await fetchImpl(new URL("/src/entry-client.tsx", url));
        const entrySource = entryResponse.ok ? await entryResponse.text() : "";
        if (isScoutRendererEntrySource(entrySource)) {
          return;
        }
      }
    } catch {
      // renderer not up yet
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting for renderer at ${url}`);
}

export async function isPortAvailable(host, port) {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host, port }, () => {
      server.close(() => resolve(true));
    });
  });
}

export async function resolveRendererPort(options = {}) {
  const host = options.host ?? "127.0.0.1";
  const explicitPort = options.explicitPort ?? null;
  const requestedPort = options.requestedPort ?? DEFAULT_RENDERER_PORT;
  const maxAttempts = options.maxAttempts ?? 20;
  const isPortAvailableImpl = options.isPortAvailable ?? isPortAvailable;

  if (explicitPort !== null && explicitPort !== undefined) {
    return explicitPort;
  }

  let port = requestedPort;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1, port += 1) {
    if (await isPortAvailableImpl(host, port)) {
      return port;
    }
  }

  throw new Error(`Unable to find an available renderer port starting at ${requestedPort}.`);
}
