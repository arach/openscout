import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname as pathDirname, join } from "node:path";

import type { IPty } from "node-pty";

const require = createRequire(import.meta.url);
const pty = require("node-pty") as typeof import("node-pty");

const DEFAULT_ORPHAN_TTL_MS = 30 * 60 * 1000;
const MAX_BUFFER_SIZE = 512 * 1024;

export interface RelaySocket {
  readonly readyState: number;
  send(data: string | Buffer): void;
}

export interface SessionInitMessage {
  type: "session:init";
  cols: number;
  rows: number;
  systemPrompt?: string;
  cwd?: string;
  workspaceFiles?: Record<string, string>;
  orphanTTL?: number;
  backend?: "pty" | "tmux";
  tmuxSession?: string;
  agent?: "claude" | "pi";
  provider?: string;
  model?: string;
}

export interface SessionReconnectMessage {
  type: "session:reconnect";
  sessionId: string;
  cols?: number;
  rows?: number;
}

export interface TerminalInputMessage {
  type: "terminal:input";
  data: string;
}

export interface TerminalResizeMessage {
  type: "terminal:resize";
  cols: number;
  rows: number;
}

export type ClientMessage =
  | SessionInitMessage
  | SessionReconnectMessage
  | TerminalInputMessage
  | TerminalResizeMessage;

export interface Session {
  id: string;
  pty: IPty;
  ws: RelaySocket | null;
  outputBuffer: string;
  cols: number;
  rows: number;
  reapTimer: ReturnType<typeof setTimeout> | null;
  orphanTTL: number;
  backend: "pty" | "tmux";
  tmuxSession?: string;
  exited: boolean;
  exitCode: number | null;
}

export const sessions = new Map<string, Session>();

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function send(ws: RelaySocket, data: Record<string, unknown>) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

function ptyFdClosed(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("EBADF") || message.toLowerCase().includes("bad file descriptor");
}

function markSessionPtyClosed(
  session: Session,
  error: unknown,
  operation: "write" | "resize",
) {
  if (session.exited) {
    return;
  }
  session.exited = true;
  console.warn(
    `[relay] Session ${session.id}: PTY ${operation} failed after fd closed (${error instanceof Error ? error.message : String(error)})`,
  );
  scheduleReap(session, 10_000);
}

export function sessionOwnsSocket(session: Session, ws: RelaySocket): boolean {
  return session.ws === ws;
}

export function writeSession(session: Session, data: string): boolean {
  if (session.exited) {
    return false;
  }
  try {
    session.pty.write(data);
    return true;
  } catch (error) {
    if (ptyFdClosed(error)) {
      markSessionPtyClosed(session, error, "write");
      return false;
    }
    throw error;
  }
}

export function resizeSession(session: Session, cols: number, rows: number): boolean {
  if (session.exited) {
    return false;
  }
  try {
    session.pty.resize(cols, rows);
    session.cols = cols;
    session.rows = rows;
    return true;
  } catch (error) {
    if (ptyFdClosed(error)) {
      markSessionPtyClosed(session, error, "resize");
      return false;
    }
    throw error;
  }
}

function resolveCwd(raw?: string): string {
  const home = process.env.HOME || "/tmp";
  const expanded = (raw || home).replace(/^~/, home);
  if (existsSync(expanded)) {
    return expanded;
  }
  try {
    mkdirSync(expanded, { recursive: true });
    console.log(`[relay] Created missing cwd: ${expanded}`);
    return expanded;
  } catch {
    console.warn(`[relay] Could not create cwd ${expanded}, falling back to ${home}`);
    return home;
  }
}

function findBin(name: string, envOverride?: string): string | null {
  if (envOverride && process.env[envOverride]) {
    return process.env[envOverride] || null;
  }
  try {
    return execSync(`which ${name}`, { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

function findClaudeBin(): string | null {
  return findBin("claude", "CLAUDE_BIN");
}

function findPiBin(): string | null {
  return findBin("pi", "PI_BIN");
}

function tmuxSessionExists(name: string): boolean {
  try {
    execSync(`tmux has-session -t ${name} 2>/dev/null`, { encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

function bootstrapFiles(
  cwd: string,
  files: Record<string, string>,
  sessionId: string,
) {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(cwd, relativePath);
    if (existsSync(absolutePath)) {
      continue;
    }
    try {
      const directory = pathDirname(absolutePath);
      if (!existsSync(directory)) {
        mkdirSync(directory, { recursive: true });
      }
      writeFileSync(absolutePath, content, "utf8");
      console.log(`[relay] Session ${sessionId}: bootstrapped ${relativePath}`);
    } catch (error) {
      console.warn(
        `[relay] Session ${sessionId}: failed to bootstrap ${relativePath}:`,
        error,
      );
    }
  }
}

function spawnTmuxSession(
  tmuxName: string,
  cols: number,
  rows: number,
  cwd: string,
  agentBin: string,
  agentArgs: string[],
  env: Record<string, string | undefined>,
): IPty {
  const exists = tmuxSessionExists(tmuxName);

  if (!exists) {
    const shellCommand = [agentBin, ...agentArgs]
      .map((arg) => (arg.includes(" ") ? `'${arg}'` : arg))
      .join(" ");
    execSync(
      `tmux new-session -d -s ${tmuxName} -x ${cols} -y ${rows} -c '${cwd}' '${shellCommand}'`,
      { env: env as NodeJS.ProcessEnv },
    );
    console.log(`[relay] Created tmux session: ${tmuxName}`);
  } else {
    try {
      execSync(`tmux resize-window -t ${tmuxName} -x ${cols} -y ${rows} 2>/dev/null`);
    } catch {
      // Ignore resize failures when attaching to an existing tmux session.
    }
    console.log(`[relay] Attaching to existing tmux session: ${tmuxName}`);
  }

  return pty.spawn("tmux", ["attach", "-t", tmuxName], {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env,
  });
}

export function createSession(
  ws: RelaySocket,
  message: SessionInitMessage,
): Session | null {
  const id = generateId();
  const cols = Math.max(message.cols || 80, 20);
  const rows = Math.max(message.rows || 24, 4);
  const backend = message.backend || "pty";
  const tmuxName = message.tmuxSession || `hudson-${id}`;
  const agent = message.agent || "claude";

  let agentBin: string | null;
  if (agent === "pi") {
    agentBin = findPiBin();
    if (!agentBin) {
      const reason = "pi CLI not found. Install it with: npm install -g @mariozechner/pi-coding-agent";
      console.error(`[relay] Session ${id} failed: ${reason}`);
      send(ws, { type: "session:error", error: reason });
      return null;
    }
  } else {
    agentBin = findClaudeBin();
    if (!agentBin) {
      const reason = "Claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code";
      console.error(`[relay] Session ${id} failed: ${reason}`);
      send(ws, { type: "session:error", error: reason });
      return null;
    }
  }

  if (!existsSync(agentBin)) {
    const reason = `${agent} binary not found at ${agentBin}`;
    console.error(`[relay] Session ${id} failed: ${reason}`);
    send(ws, { type: "session:error", error: reason });
    return null;
  }

  if (backend === "tmux" && !findBin("tmux")) {
    const reason = "tmux not found. Install it with: brew install tmux";
    console.error(`[relay] Session ${id} failed: ${reason}`);
    send(ws, { type: "session:error", error: reason });
    return null;
  }

  const cwd = resolveCwd(message.cwd);
  if (message.workspaceFiles) {
    bootstrapFiles(cwd, message.workspaceFiles, id);
  }

  let agentArgs: string[];
  if (agent === "pi") {
    agentArgs = ["--verbose"];
    if (message.provider) {
      agentArgs.push("--provider", message.provider);
    }
    if (message.model) {
      agentArgs.push("--model", message.model);
    }
    if (message.systemPrompt) {
      agentArgs.push("--system-prompt", message.systemPrompt);
    }
  } else {
    agentArgs = ["--verbose"];
    if (message.systemPrompt) {
      agentArgs.push("--system-prompt", message.systemPrompt);
    }
  }

  const env: Record<string, string | undefined> = {
    ...process.env,
    TERM: "xterm-256color",
    FORCE_COLOR: "1",
  };
  delete env.CLAUDECODE;

  let ptyProcess: IPty;
  try {
    if (backend === "tmux") {
      console.log(
        `[relay] Session ${id}: tmux backend (session: ${tmuxName}) in ${cwd} [agent: ${agent}]`,
      );
      ptyProcess = spawnTmuxSession(
        tmuxName,
        cols,
        rows,
        cwd,
        agentBin,
        agentArgs,
        env,
      );
    } else {
      console.log(
        `[relay] Session ${id}: pty backend, spawning ${agentBin} in ${cwd} [agent: ${agent}]`,
      );
      ptyProcess = pty.spawn(agentBin, agentArgs, {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env,
      });
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    console.error(`[relay] Session ${id}: failed to spawn PTY — ${messageText}`);
    send(ws, { type: "session:error", error: `Failed to spawn terminal: ${messageText}` });
    return null;
  }

  const orphanTTL =
    message.orphanTTL && message.orphanTTL > 0
      ? message.orphanTTL
      : DEFAULT_ORPHAN_TTL_MS;

  const session: Session = {
    id,
    pty: ptyProcess,
    ws,
    outputBuffer: "",
    cols,
    rows,
    reapTimer: null,
    orphanTTL,
    backend,
    ...(backend === "tmux" ? { tmuxSession: tmuxName } : {}),
    exited: false,
    exitCode: null,
  };

  const startedAt = Date.now();

  ptyProcess.onData((data: string) => {
    session.outputBuffer += data;
    if (session.outputBuffer.length > MAX_BUFFER_SIZE) {
      session.outputBuffer = session.outputBuffer.slice(-MAX_BUFFER_SIZE);
    }

    if (session.ws && session.ws.readyState === 1) {
      send(session.ws, { type: "terminal:data", data });
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    session.exited = true;
    session.exitCode = exitCode;

    const uptimeMs = Date.now() - startedAt;
    const crashedEarly = exitCode !== 0 && uptimeMs < 5000;

    let reason: string | undefined;
    if (crashedEarly) {
      const cleanOutput = session.outputBuffer
        .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
        .trim();
      const lines = cleanOutput
        .split("\n")
        .filter((line) => line.trim())
        .slice(-5);
      reason = lines.join("\n") || `Process exited with code ${exitCode}`;
      console.error(
        `[relay] Session ${id} crashed after ${uptimeMs}ms (code ${exitCode}): ${reason}`,
      );
    }

    if (session.ws) {
      send(session.ws, {
        type: "session:exit",
        exitCode,
        ...(reason ? { reason } : {}),
      });
    }
    scheduleReap(session, 10_000);
  });

  sessions.set(id, session);
  console.log(`[relay] Session ${id} created (${cols}x${rows})`);
  return session;
}

export function attachSession(
  session: Session,
  ws: RelaySocket,
  cols?: number,
  rows?: number,
) {
  if (session.reapTimer) {
    clearTimeout(session.reapTimer);
    session.reapTimer = null;
  }

  session.ws = ws;

  if (cols && rows) {
    const nextCols = Math.max(cols, 20);
    const nextRows = Math.max(rows, 4);
    if (nextCols !== session.cols || nextRows !== session.rows) {
      resizeSession(session, nextCols, nextRows);
    }
  }

  if (session.exited) {
    send(ws, { type: "session:exit", exitCode: session.exitCode });
  } else if (session.outputBuffer.length > 0) {
    send(ws, { type: "terminal:data", data: session.outputBuffer });
  }

  console.log(`[relay] Session ${session.id} reconnected`);
}

export function detachSession(session: Session) {
  session.ws = null;

  if (session.exited) {
    scheduleReap(session, 5_000);
    return;
  }

  scheduleReap(session, session.orphanTTL);
  console.log(
    `[relay] Session ${session.id} detached (orphaned for ${session.orphanTTL / 1000}s)`,
  );
}

export function scheduleReap(session: Session, delayMs: number) {
  if (session.reapTimer) {
    clearTimeout(session.reapTimer);
  }
  session.reapTimer = setTimeout(() => {
    if (!session.ws) {
      destroy(session.id);
    }
  }, delayMs);
}

export function destroy(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) {
    return;
  }
  if (session.reapTimer) {
    clearTimeout(session.reapTimer);
  }
  try {
    session.pty.kill();
  } catch {
    // Ignore PTY kill errors during cleanup.
  }
  sessions.delete(sessionId);
  if (session.backend === "tmux") {
    console.log(
      `[relay] Session ${sessionId} bridge destroyed (tmux session '${session.tmuxSession}' still alive)`,
    );
    return;
  }
  console.log(`[relay] Session ${sessionId} destroyed`);
}
