// File server — lightweight HTTP for pairing-local file access.
//
// Bun.file() handles MIME, streaming, range requests.
// We add path validation plus start/stop lifecycle.

import { existsSync } from "fs";
import { isAbsolute } from "path";
import { homedir } from "os";

// Allowed roots — file requests must resolve under one of these.
const ALLOWED_ROOTS = [homedir(), "/tmp"];

function isAllowedPath(filePath: string): boolean {
  if (!isAbsolute(filePath)) return false;
  const relToHome = filePath.slice(homedir().length + 1);
  if (relToHome.startsWith(".") && !relToHome.startsWith(".claude") && !relToHome.startsWith(".scout/pairing")) {
    return false;
  }
  return ALLOWED_ROOTS.some((root) => filePath.startsWith(root));
}

// ---------------------------------------------------------------------------
// File Server
// ---------------------------------------------------------------------------

export interface FileServer {
  port: number;
  stop: () => void;
  restart: () => void;
}

export function startFileServer(options: { port: number }): FileServer {
  const { port } = options;

  let server: ReturnType<typeof Bun.serve> | null = null;

  function start(): void {
    try {
      server = Bun.serve({
        port,
        fetch(req) {
          try {
            return route(new URL(req.url));
          } catch (err: any) {
            console.error(`[fileserver] ${req.url} →`, err.message);
            return new Response("Internal error", { status: 500 });
          }
        },
      });
      console.log(`[fileserver] http://localhost:${port}`);
    } catch (err: any) {
      console.error(`[fileserver] failed to start: ${err.message}`);
    }
  }

  function stop(): void { server?.stop(); server = null; }
  function restart(): void { stop(); start(); }

  start();
  return { port, stop, restart };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function route(url: URL): Response {
  const path = url.pathname;

  // API
  if (path === "/file") return serveFile(url);
  if (path === "/health") return Response.json({ ok: true });

  return new Response("Pairing file server", { status: 200 });
}

// ---------------------------------------------------------------------------
// GET /file?path= — serve any allowed local file
// ---------------------------------------------------------------------------

function serveFile(url: URL): Response {
  const filePath = url.searchParams.get("path");
  if (!filePath) return new Response("Missing ?path=", { status: 400 });
  if (!isAllowedPath(filePath)) return new Response("Forbidden", { status: 403 });
  const file = Bun.file(filePath);
  if (!file.size) return new Response("Not found", { status: 404 });
  return new Response(file);
}
