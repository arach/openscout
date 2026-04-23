// Scout relay — PTY-based WebSocket relay for the Hudson SDK Assistant.
//
// Mounts directly on Scout's Bun server. Imports the session module from
// hudson-relay so the protocol stays in sync with the SDK's useTerminalRelay.

import {
  sessions,
  createSession,
  attachSession,
  detachSession,
  destroy,
  send,
} from "../../../../hudson/packages/hudson-relay/src/relay/session";
import type {
  ClientMessage,
  RelaySocket,
} from "../../../../hudson/packages/hudson-relay/src/relay/types";
import { mkdir } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Upload handler — save base64 images to /tmp for CLI agent consumption
// ---------------------------------------------------------------------------

const UPLOAD_DIR = "/tmp/scout-uploads";

export async function handleRelayUpload(req: Request): Promise<Response> {
  const { name, data } = (await req.json()) as { name: string; data: string };
  if (!name || !data) {
    return Response.json({ error: "Missing name or data" }, { status: 400 });
  }

  await mkdir(UPLOAD_DIR, { recursive: true });
  const filename = `${randomUUID()}-${name}`;
  const filepath = join(UPLOAD_DIR, filename);
  await Bun.write(filepath, Buffer.from(data, "base64"));
  return Response.json({ path: filepath });
}

// ---------------------------------------------------------------------------
// Terminal command queue — lets the web server inject commands into the
// currently attached pty session, or queue them for the next session:init.
// ---------------------------------------------------------------------------

let _pendingCommand: string | null = null;

export function queueTerminalCommand(cmd: string): void {
  // If there's already an active session, write to it immediately
  for (const [, session] of sessions) {
    if (!session.exited) {
      session.pty.write(cmd + "\n");
      return;
    }
  }
  // No active session yet — queue it for the next session:init/reconnect
  _pendingCommand = cmd;
}

function drainPendingCommand(): string | null {
  const cmd = _pendingCommand;
  _pendingCommand = null;
  return cmd;
}

// ---------------------------------------------------------------------------
// WebSocket helpers
// ---------------------------------------------------------------------------

export interface RelayWSData {
  sessionId: string | null;
}

function asRelay(ws: {
  readyState: number;
  send(data: string | Buffer): void;
}): RelaySocket {
  return ws as RelaySocket;
}

function parseMessage(raw: string): ClientMessage | null {
  try {
    const msg = JSON.parse(raw);
    if (typeof msg.type === "string") return msg as ClientMessage;
  } catch {}
  return null;
}

// ---------------------------------------------------------------------------
// Bun WebSocket handlers — drop-in for Bun.serve({ websocket: ... })
// ---------------------------------------------------------------------------

export const relayWebSocket = {
  open(_ws: { data: RelayWSData }) {
    // Wait for session:init or session:reconnect
  },

  message(
    ws: { data: RelayWSData; readyState: number; send(data: string | Buffer): void },
    raw: string | Buffer,
  ) {
    const msg = parseMessage(typeof raw === "string" ? raw : raw.toString());
    if (!msg) return;

    const rws = asRelay(ws);

    switch (msg.type) {
      case "session:init": {
        if (ws.data.sessionId) {
          const prev = sessions.get(ws.data.sessionId);
          if (prev) detachSession(prev);
        }
        const session = createSession(rws, msg);
        if (!session) break;
        ws.data.sessionId = session.id;
        send(rws, { type: "session:ready", sessionId: session.id });
        const pending = drainPendingCommand();
        if (pending) setTimeout(() => session.pty.write(pending + "\n"), 400);
        break;
      }

      case "session:reconnect": {
        const existing = sessions.get(msg.sessionId);
        if (existing && !existing.exited) {
          if (ws.data.sessionId && ws.data.sessionId !== msg.sessionId) {
            const prev = sessions.get(ws.data.sessionId);
            if (prev) detachSession(prev);
          }
          if (existing.ws && existing.ws !== rws) {
            send(existing.ws, { type: "session:detached" });
          }
          ws.data.sessionId = existing.id;
          attachSession(existing, rws, msg.cols, msg.rows);
          send(rws, {
            type: "session:ready",
            sessionId: existing.id,
            reconnected: true,
          });
          const pending = drainPendingCommand();
          if (pending) setTimeout(() => existing.pty.write(pending + "\n"), 400);
        } else {
          send(rws, { type: "session:expired", sessionId: msg.sessionId });
        }
        break;
      }

      case "terminal:input": {
        if (!ws.data.sessionId) return;
        const session = sessions.get(ws.data.sessionId);
        if (session && !session.exited) {
          session.pty.write(msg.data);
        }
        break;
      }

      case "terminal:resize": {
        if (!ws.data.sessionId) return;
        const session = sessions.get(ws.data.sessionId);
        if (session && !session.exited) {
          const cols = Math.max(msg.cols || 80, 20);
          const rows = Math.max(msg.rows || 24, 4);
          session.pty.resize(cols, rows);
          session.cols = cols;
          session.rows = rows;
        }
        break;
      }
    }
  },

  close(ws: { data: RelayWSData }) {
    if (ws.data.sessionId) {
      const session = sessions.get(ws.data.sessionId);
      if (session) detachSession(session);
      ws.data.sessionId = null;
    }
  },
};

// ---------------------------------------------------------------------------
// Graceful shutdown — call from server's SIGINT/SIGTERM handler
// ---------------------------------------------------------------------------

export function destroyAllRelaySessions() {
  for (const [id] of sessions) destroy(id);
}
