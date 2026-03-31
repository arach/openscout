// File server — lightweight HTTP for local files and spectator.
//
// Bun.file() handles MIME, streaming, range requests.
// We add path validation, spectator API, and start/stop lifecycle.

import { existsSync, readFileSync, statSync } from "fs";
import { isAbsolute, join } from "path";
import { homedir } from "os";

// Allowed roots — file requests must resolve under one of these.
const ALLOWED_ROOTS = [homedir(), "/tmp"];

function isAllowedPath(filePath: string): boolean {
  if (!isAbsolute(filePath)) return false;
  const relToHome = filePath.slice(homedir().length + 1);
  if (relToHome.startsWith(".") && !relToHome.startsWith(".claude") && !relToHome.startsWith(".dispatch")) {
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
  const webRoot = findSpectatorDist();

  let server: ReturnType<typeof Bun.serve> | null = null;

  function start(): void {
    try {
      server = Bun.serve({
        port,
        fetch(req) {
          try {
            return route(new URL(req.url), webRoot);
          } catch (err: any) {
            console.error(`[fileserver] ${req.url} →`, err.message);
            return new Response("Internal error", { status: 500 });
          }
        },
      });
      console.log(`[fileserver] http://localhost:${port}` + (webRoot ? ` (spectator: ${webRoot})` : ""));
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

function route(url: URL, webRoot: string | null): Response {
  const path = url.pathname;

  // API
  if (path === "/file") return serveFile(url);
  if (path === "/api/session-by-path") return serveSessionByPath(url);
  if (path === "/api/sessions") return serveSessionList(url);
  if (path === "/health") return Response.json({ ok: true });

  // Static: serve from spectator dist as web root
  if (webRoot) {
    const sub = path === "/" ? "index.html" : path.slice(1);
    const file = Bun.file(join(webRoot, sub));
    if (file.size) {
      // Vite fingerprinted assets (assets/index-ABC123.js) → cache forever
      const headers: Record<string, string> = sub.startsWith("assets/")
        ? { "Cache-Control": "public, max-age=31536000, immutable" }
        : { "Cache-Control": "no-cache" };
      return new Response(file, { headers });
    }
    // SPA fallback
    return new Response(Bun.file(join(webRoot, "index.html")));
  }

  return new Response("Dispatch file server", { status: 200 });
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

// ---------------------------------------------------------------------------
// GET /api/session-by-path?path= — JSONL for spectator
// ---------------------------------------------------------------------------

function serveSessionByPath(url: URL): Response {
  const filePath = url.searchParams.get("path");
  if (!filePath) return Response.json({ error: "Missing ?path=" }, { status: 400 });
  if (!filePath.endsWith(".jsonl")) return Response.json({ error: "Only .jsonl" }, { status: 400 });
  const file = Bun.file(filePath);
  if (!file.size) return Response.json({ error: "Not found" }, { status: 404 });
  const text = readFileSync(filePath, "utf-8");
  const sessionId = Buffer.from(filePath).toString("base64url").slice(0, 32);
  return Response.json({ sessionId, path: filePath, text });
}

// ---------------------------------------------------------------------------
// GET /api/sessions?limit=N — discovered JSONL sessions
// ---------------------------------------------------------------------------

function serveSessionList(url: URL): Response {
  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const home = homedir();
  const results: Array<{ path: string; mtimeMs: number; size: number }> = [];

  for (const dir of [join(home, ".claude/projects"), join(home, ".codex"), join(home, ".openai-codex")]) {
    try {
      if (!existsSync(dir)) continue;
      const out = Bun.spawnSync(["find", dir, "-name", "*.jsonl", "-mtime", "-14", "-type", "f"], {
        stdout: "pipe", stderr: "ignore", timeout: 5000,
      }).stdout.toString().trim();
      if (!out) continue;
      for (const fp of out.split("\n")) {
        if (!fp.trim()) continue;
        try { const s = statSync(fp); results.push({ path: fp, mtimeMs: s.mtimeMs, size: s.size }); } catch {}
      }
    } catch {}
  }

  results.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return Response.json({ sessions: results.slice(0, limit) });
}

// ---------------------------------------------------------------------------
// Spectator dist discovery
// ---------------------------------------------------------------------------

function findSpectatorDist(): string | null {
  for (const dir of [join(homedir(), "dev/spectator/dist"), join(homedir(), ".dispatch/spectator")]) {
    if (existsSync(join(dir, "index.html"))) return dir;
  }
  return null;
}
