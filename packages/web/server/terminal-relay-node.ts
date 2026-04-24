import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createRequire } from "node:module";

import {
  sessions,
  createSession,
  attachSession,
  detachSession,
  destroy,
  send,
} from "../../../../hudson/packages/hudson-relay/src/relay/session";
import type { Session } from "../../../../hudson/packages/hudson-relay/src/relay/session";
import type {
  ClientMessage,
  RelaySocket,
} from "../../../../hudson/packages/hudson-relay/src/relay/types";
import type { WebSocket as NodeWebSocket } from "ws";

const require = createRequire(import.meta.url);
const { WebSocketServer } = require("ws") as typeof import("ws");

const hostname =
  process.env.OPENSCOUT_WEB_TERMINAL_RELAY_HOST?.trim()
  || process.env.OPENSCOUT_WEB_HOST?.trim()
  || process.env.SCOUT_WEB_HOST?.trim()
  || "127.0.0.1";
const port = Number.parseInt(
  process.env.OPENSCOUT_WEB_TERMINAL_RELAY_PORT?.trim() || "3201",
  10,
);
const UPLOAD_DIR = "/tmp/scout-uploads";

let pendingCommand: string | null = null;

function sessionOwnsSocket(session: Session, socket: RelaySocket): boolean {
  return session.ws === socket;
}

function writeSession(session: Session, data: string): boolean {
  if (session.exited) {
    return false;
  }

  try {
    session.pty.write(data);
    return true;
  } catch {
    return false;
  }
}

function resizeSession(session: Session, cols: number, rows: number): boolean {
  if (session.exited) {
    return false;
  }

  try {
    session.pty.resize(cols, rows);
    session.cols = cols;
    session.rows = rows;
    return true;
  } catch {
    return false;
  }
}

function queueTerminalCommand(command: string): void {
  for (const [, session] of sessions) {
    if (writeSession(session, command + "\n")) {
      return;
    }
  }
  pendingCommand = command;
}

function drainPendingCommand(): string | null {
  const command = pendingCommand;
  pendingCommand = null;
  return command;
}

function parseMessage(raw: string): ClientMessage | null {
  try {
    const message = JSON.parse(raw);
    if (typeof message.type === "string") {
      return message as ClientMessage;
    }
  } catch {}
  return null;
}

function setCors(res: import("node:http").ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function readJson<T>(
  req: import("node:http").IncomingMessage,
): Promise<T | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return null;
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(
  res: import("node:http").ServerResponse,
  status: number,
  body: unknown,
) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function relayUploadPath(name: string) {
  return join(UPLOAD_DIR, `${randomUUID()}-${name}`);
}

const server = createServer(async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${hostname}:${port}`);

  if (req.method === "GET" && url.pathname === "/health") {
    writeJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && (url.pathname === "/api/upload" || url.pathname === "/api/relay/upload")) {
    const body = await readJson<{ name?: string; data?: string }>(req);
    if (!body?.name || !body.data) {
      writeJson(res, 400, { error: "Missing name or data" });
      return;
    }
    await mkdir(UPLOAD_DIR, { recursive: true });
    const filepath = relayUploadPath(body.name);
    await writeFile(filepath, Buffer.from(body.data, "base64"));
    writeJson(res, 200, { path: filepath });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/terminal/run") {
    const body = await readJson<{ command?: string }>(req);
    if (!body?.command?.trim()) {
      writeJson(res, 400, { error: "missing command" });
      return;
    }
    queueTerminalCommand(body.command);
    writeJson(res, 200, { ok: true });
    return;
  }

  writeJson(res, 404, { error: "Not found" });
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws: NodeWebSocket) => {
  let sessionId: string | null = null;

  ws.on("message", (raw: Buffer | string) => {
    const msg = parseMessage(raw.toString());
    if (!msg) {
      return;
    }

    switch (msg.type) {
      case "session:init": {
        if (sessionId) {
          const previous = sessions.get(sessionId);
          if (previous && sessionOwnsSocket(previous, ws)) {
            detachSession(previous);
          }
        }
        const session = createSession(ws, msg);
        if (!session) {
          break;
        }
        sessionId = session.id;
        send(ws, { type: "session:ready", sessionId: session.id });
        const pending = drainPendingCommand();
        if (pending) {
          setTimeout(() => writeSession(session, pending + "\n"), 400);
        }
        break;
      }

      case "session:reconnect": {
        const existing = sessions.get(msg.sessionId);
        if (existing && !existing.exited) {
          if (sessionId && sessionId !== msg.sessionId) {
            const previous = sessions.get(sessionId);
            if (previous && sessionOwnsSocket(previous, ws)) {
              detachSession(previous);
            }
          }
          if (existing.ws && existing.ws !== ws) {
            send(existing.ws, { type: "session:detached" });
          }
          sessionId = existing.id;
          attachSession(existing, ws, msg.cols, msg.rows);
          send(ws, {
            type: "session:ready",
            sessionId: existing.id,
            reconnected: true,
          });
          const pending = drainPendingCommand();
          if (pending) {
            setTimeout(() => writeSession(existing, pending + "\n"), 400);
          }
        } else {
          send(ws, { type: "session:expired", sessionId: msg.sessionId });
        }
        break;
      }

      case "terminal:input": {
        if (!sessionId) {
          return;
        }
        const session = sessions.get(sessionId);
        if (session && sessionOwnsSocket(session, ws)) {
          writeSession(session, msg.data);
        }
        break;
      }

      case "terminal:resize": {
        if (!sessionId) {
          return;
        }
        const session = sessions.get(sessionId);
        if (session && sessionOwnsSocket(session, ws)) {
          const cols = Math.max(msg.cols || 80, 20);
          const rows = Math.max(msg.rows || 24, 4);
          resizeSession(session, cols, rows);
        }
        break;
      }
    }
  });

  ws.on("close", () => {
    if (!sessionId) {
      return;
    }
    const session = sessions.get(sessionId);
    if (session && sessionOwnsSocket(session, ws)) {
      detachSession(session);
    }
    sessionId = null;
  });

  ws.on("error", (err: Error) => {
    console.error("[relay] WebSocket error:", err.message);
    if (!sessionId) {
      return;
    }
    const session = sessions.get(sessionId);
    if (session && sessionOwnsSocket(session, ws)) {
      detachSession(session);
    }
    sessionId = null;
  });
});

server.listen(port, hostname, () => {
  console.log(`[relay] Server listening on http://${hostname}:${port} (HTTP + WebSocket)`);
});

const shutdown = () => {
  console.log("\n[relay] Shutting down...");
  for (const [id] of sessions) {
    destroy(id);
  }
  wss.close();
  server.close(() => process.exit(0));
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
