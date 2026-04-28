// Generated from Hudson relay session/types.
// Refresh with: node ./scripts/sync-terminal-relay-session.mjs
/** Minimal WebSocket interface — satisfied by both `ws` and Bun's ServerWebSocket. */
export interface RelaySocket {
  readonly readyState: number;
  send(data: string | Buffer): void;
}

export interface SessionInitMessage {
  type: 'session:init';
  cols: number;
  rows: number;
  systemPrompt?: string;
  /** Working directory for the PTY session. Defaults to $HOME. */
  cwd?: string;
  /** Files to bootstrap in the CWD before spawning the CLI. Keys are relative paths, values are file contents. Only written if the file doesn't already exist. */
  workspaceFiles?: Record<string, string>;
  /** How long (ms) to keep the PTY alive after the client disconnects. Defaults to 30 min. */
  orphanTTL?: number;
  /** PTY backend. 'pty' spawns a fresh process (default). 'tmux' attaches to a named tmux session. */
  backend?: 'pty' | 'tmux';
  /** For tmux backend: the tmux session name. Required when backend is 'tmux'. */
  tmuxSession?: string;
  /** CLI agent to spawn. 'claude' (default) or 'pi'. */
  agent?: 'claude' | 'pi';
  /** For pi agent: provider name (e.g. 'minimax', 'openai'). */
  provider?: string;
  /** For pi agent: model ID (e.g. 'MiniMax-M1'). */
  model?: string;
}

export interface SessionReconnectMessage {
  type: 'session:reconnect';
  sessionId: string;
  cols?: number;
  rows?: number;
}

export interface TerminalInputMessage {
  type: 'terminal:input';
  data: string;
}

export interface TerminalResizeMessage {
  type: 'terminal:resize';
  cols: number;
  rows: number;
}

export type ClientMessage =
  | SessionInitMessage
  | SessionReconnectMessage
  | TerminalInputMessage
  | TerminalResizeMessage;

import { createRequire } from 'module';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname as pathDirname } from 'path';
import type { IPty } from 'node-pty';

const require = createRequire(import.meta.url);
const pty = require('node-pty') as typeof import('node-pty');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default orphan TTL — how long a detached session lives before being reaped. */
const DEFAULT_ORPHAN_TTL_MS = 30 * 60 * 1000; // 30 minutes

/** Maximum size of the raw output buffer for reconnect replay (~512 KB). */
const MAX_BUFFER_SIZE = 512 * 1024;

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

export interface Session {
  id: string;
  pty: IPty;
  /** Currently attached WebSocket (null when detached/orphaned). */
  ws: RelaySocket | null;
  /** Rolling buffer of raw PTY output for reconnect replay. */
  outputBuffer: string;
  /** Current terminal dimensions. */
  cols: number;
  rows: number;
  /** Set when ws detaches — session is reaped after orphanTTL. */
  reapTimer: ReturnType<typeof setTimeout> | null;
  /** How long this session survives without a client (ms). */
  orphanTTL: number;
  /** PTY backend type. */
  backend: 'pty' | 'tmux';
  /** tmux session name (only set when backend is 'tmux'). */
  tmuxSession?: string;
  /** Whether the PTY process has exited. */
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

function ptyFdClosed(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('EBADF') || message.toLowerCase().includes('bad file descriptor');
}

function markSessionPtyClosed(session: Session, err: unknown, op: 'write' | 'resize') {
  if (session.exited) return;
  session.exited = true;
  console.warn(`[relay] Session ${session.id}: PTY ${op} failed after fd closed (${err instanceof Error ? err.message : String(err)})`);
  scheduleReap(session, 10_000);
}

export function sessionOwnsSocket(session: Session, ws: RelaySocket): boolean {
  return session.ws === ws;
}

export function writeSession(session: Session, data: string): boolean {
  if (session.exited) return false;
  try {
    session.pty.write(data);
    return true;
  } catch (err) {
    if (ptyFdClosed(err)) {
      markSessionPtyClosed(session, err, 'write');
      return false;
    }
    throw err;
  }
}

export function resizeSession(session: Session, cols: number, rows: number): boolean {
  if (session.exited) return false;
  try {
    session.pty.resize(cols, rows);
    session.cols = cols;
    session.rows = rows;
    return true;
  } catch (err) {
    if (ptyFdClosed(err)) {
      markSessionPtyClosed(session, err, 'resize');
      return false;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a cwd string, expanding ~, creating if missing, falling back to $HOME. */
function resolveCwd(raw?: string): string {
  const home = process.env.HOME || '/tmp';
  const expanded = (raw || home).replace(/^~/, home);
  if (existsSync(expanded)) return expanded;
  try {
    mkdirSync(expanded, { recursive: true });
    console.log(`[relay] Created missing cwd: ${expanded}`);
    return expanded;
  } catch {
    console.warn(`[relay] Could not create cwd ${expanded}, falling back to ${home}`);
    return home;
  }
}

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

/** Locate a binary by name, returning null if not found. */
function findBin(name: string, envOverride?: string): string | null {
  if (envOverride && process.env[envOverride]) return process.env[envOverride];
  try {
    return execSync(`which ${name}`, { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

/** Locate the claude binary, returning null if not found. */
function findClaudeBin(): string | null {
  return findBin('claude', 'CLAUDE_BIN');
}

/** Locate the pi binary, returning null if not found. */
function findPiBin(): string | null {
  return findBin('pi', 'PI_BIN');
}

/** Check if a tmux session exists. */
function tmuxSessionExists(name: string): boolean {
  try {
    execSync(`tmux has-session -t ${name} 2>/dev/null`, { encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

/** Bootstrap workspace files into a directory (only creates if missing). */
function bootstrapFiles(cwd: string, files: Record<string, string>, sessionId: string) {
  for (const [relPath, content] of Object.entries(files)) {
    const absPath = join(cwd, relPath);
    if (!existsSync(absPath)) {
      try {
        const dir = pathDirname(absPath);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(absPath, content, 'utf-8');
        console.log(`[relay] Session ${sessionId}: bootstrapped ${relPath}`);
      } catch (err) {
        console.warn(`[relay] Session ${sessionId}: failed to bootstrap ${relPath}:`, err);
      }
    }
  }
}

/** Spawn a PTY that attaches to a tmux session (creating it if needed). */
function spawnTmuxSession(
  tmuxName: string,
  cols: number,
  rows: number,
  cwd: string,
  claudeBin: string,
  claudeArgs: string[],
  env: Record<string, string | undefined>,
): IPty {
  const exists = tmuxSessionExists(tmuxName);

  if (!exists) {
    // Create the tmux session detached, running claude inside it
    const shellCmd = [claudeBin, ...claudeArgs].map(a => a.includes(' ') ? `'${a}'` : a).join(' ');
    execSync(
      `tmux new-session -d -s ${tmuxName} -x ${cols} -y ${rows} -c '${cwd}' '${shellCmd}'`,
      { env: env as NodeJS.ProcessEnv },
    );
    console.log(`[relay] Created tmux session: ${tmuxName}`);
  } else {
    // Resize existing session to match client
    try { execSync(`tmux resize-window -t ${tmuxName} -x ${cols} -y ${rows} 2>/dev/null`); } catch {}
    console.log(`[relay] Attaching to existing tmux session: ${tmuxName}`);
  }

  // Spawn a PTY bridge that attaches to the tmux session
  // This gives us a PTY file descriptor that pipes tmux I/O to our WebSocket
  return pty.spawn('tmux', ['attach', '-t', tmuxName], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env,
  });
}

export function createSession(ws: RelaySocket, msg: SessionInitMessage): Session | null {
  const id = generateId();
  const cols = Math.max(msg.cols || 80, 20);
  const rows = Math.max(msg.rows || 24, 4);
  const backend = msg.backend || 'pty';
  const tmuxName = msg.tmuxSession || `hudson-${id}`;
  const agent = msg.agent || 'claude';

  // ---- Pre-flight: locate agent binary ----
  let agentBin: string | null;
  if (agent === 'pi') {
    agentBin = findPiBin();
    if (!agentBin) {
      const reason = 'pi CLI not found. Install it with: npm install -g @mariozechner/pi-coding-agent';
      console.error(`[relay] Session ${id} failed: ${reason}`);
      send(ws, { type: 'session:error', error: reason });
      return null;
    }
  } else {
    agentBin = findClaudeBin();
    if (!agentBin) {
      const reason = 'Claude CLI not found. Install it with: npm install -g @anthropic-ai/claude-code';
      console.error(`[relay] Session ${id} failed: ${reason}`);
      send(ws, { type: 'session:error', error: reason });
      return null;
    }
  }

  if (!existsSync(agentBin)) {
    const reason = `${agent} binary not found at ${agentBin}`;
    console.error(`[relay] Session ${id} failed: ${reason}`);
    send(ws, { type: 'session:error', error: reason });
    return null;
  }

  // ---- Pre-flight: tmux backend requires tmux ----
  if (backend === 'tmux' && !findBin('tmux')) {
    const reason = 'tmux not found. Install it with: brew install tmux';
    console.error(`[relay] Session ${id} failed: ${reason}`);
    send(ws, { type: 'session:error', error: reason });
    return null;
  }

  // ---- Pre-flight: resolve working directory ----
  const cwd = resolveCwd(msg.cwd);

  // ---- Bootstrap workspace files ----
  if (msg.workspaceFiles) {
    bootstrapFiles(cwd, msg.workspaceFiles, id);
  }

  // ---- Build CLI arguments based on agent type ----
  let agentArgs: string[];

  if (agent === 'pi') {
    agentArgs = ['--verbose'];
    if (msg.provider) agentArgs.push('--provider', msg.provider);
    if (msg.model) agentArgs.push('--model', msg.model);
    if (msg.systemPrompt) agentArgs.push('--system-prompt', msg.systemPrompt);
  } else {
    agentArgs = ['--verbose'];
    if (msg.systemPrompt) agentArgs.push('--system-prompt', msg.systemPrompt);
  }

  const env: Record<string, string | undefined> = { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '1' };
  delete env.CLAUDECODE;

  // ---- Spawn PTY (direct or tmux-backed) ----
  let ptyProcess: IPty;

  try {
    if (backend === 'tmux') {
      console.log(`[relay] Session ${id}: tmux backend (session: ${tmuxName}) in ${cwd} [agent: ${agent}]`);
      ptyProcess = spawnTmuxSession(tmuxName, cols, rows, cwd, agentBin, agentArgs, env);
    } else {
      console.log(`[relay] Session ${id}: pty backend, spawning ${agentBin} in ${cwd} [agent: ${agent}]`);
      ptyProcess = pty.spawn(agentBin, agentArgs, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[relay] Session ${id}: failed to spawn PTY — ${message}`);
    send(ws, { type: 'session:error', error: `Failed to spawn terminal: ${message}` });
    return null;
  }

  const orphanTTL = msg.orphanTTL && msg.orphanTTL > 0 ? msg.orphanTTL : DEFAULT_ORPHAN_TTL_MS;

  const session: Session = {
    id,
    pty: ptyProcess,
    ws,
    outputBuffer: '',
    cols,
    rows,
    reapTimer: null,
    orphanTTL,
    backend,
    ...(backend === 'tmux' ? { tmuxSession: tmuxName } : {}),
    exited: false,
    exitCode: null,
  };

  // Track start time to detect immediate crashes
  const startTime = Date.now();

  ptyProcess.onData((data: string) => {
    // Append to rolling buffer (cap at MAX_BUFFER_SIZE)
    session.outputBuffer += data;
    if (session.outputBuffer.length > MAX_BUFFER_SIZE) {
      session.outputBuffer = session.outputBuffer.slice(-MAX_BUFFER_SIZE);
    }

    // Forward raw data to attached client
    if (session.ws && session.ws.readyState === 1) {
      send(session.ws, { type: 'terminal:data', data });
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    session.exited = true;
    session.exitCode = exitCode;

    const uptime = Date.now() - startTime;
    const crashed = exitCode !== 0 && uptime < 5000;

    // Build a human-readable reason from buffered output for early crashes
    let reason: string | undefined;
    if (crashed) {
      // Strip ANSI escape codes for a clean error message
      const clean = session.outputBuffer.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
      // Take last meaningful lines (skip blanks)
      const lines = clean.split('\n').filter(l => l.trim()).slice(-5);
      reason = lines.join('\n') || `Process exited with code ${exitCode}`;
      console.error(`[relay] Session ${id} crashed after ${uptime}ms (code ${exitCode}): ${reason}`);
    }

    if (session.ws) {
      send(session.ws, { type: 'session:exit', exitCode, ...(reason ? { reason } : {}) });
    }
    // Don't cleanup immediately — let the client see the exit message.
    scheduleReap(session, 10_000);
  });

  sessions.set(id, session);
  console.log(`[relay] Session ${id} created (${cols}x${rows})`);
  return session;
}

/** Attach a WebSocket to an existing session (reconnect). */
export function attachSession(session: Session, ws: RelaySocket, cols?: number, rows?: number) {
  // Cancel any pending reap
  if (session.reapTimer) {
    clearTimeout(session.reapTimer);
    session.reapTimer = null;
  }

  session.ws = ws;

  // Resize if the client has different dimensions
  if (cols && rows) {
    const c = Math.max(cols, 20);
    const r = Math.max(rows, 4);
    if (c !== session.cols || r !== session.rows) {
      resizeSession(session, c, r);
    }
  }

  // Replay buffered output so xterm.js rebuilds the screen
  if (session.exited) {
    send(ws, { type: 'session:exit', exitCode: session.exitCode });
  } else if (session.outputBuffer.length > 0) {
    send(ws, { type: 'terminal:data', data: session.outputBuffer });
  }

  console.log(`[relay] Session ${session.id} reconnected`);
}

/** Detach the WebSocket from a session (keeps PTY alive). */
export function detachSession(session: Session) {
  session.ws = null;

  if (session.exited) {
    scheduleReap(session, 5_000);
  } else {
    scheduleReap(session, session.orphanTTL);
    console.log(`[relay] Session ${session.id} detached (orphaned for ${session.orphanTTL / 1000}s)`);
  }
}

export function scheduleReap(session: Session, delay: number) {
  if (session.reapTimer) clearTimeout(session.reapTimer);
  session.reapTimer = setTimeout(() => {
    if (!session.ws) {
      destroy(session.id);
    }
  }, delay);
}

/** Hard destroy — kill PTY bridge, remove from map.
 *  For tmux sessions: only kills the attach bridge, not the tmux session itself. */
export function destroy(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return;
  if (session.reapTimer) clearTimeout(session.reapTimer);
  try { session.pty.kill(); } catch {}
  sessions.delete(sessionId);
  if (session.backend === 'tmux') {
    console.log(`[relay] Session ${sessionId} bridge destroyed (tmux session '${session.tmuxSession}' still alive)`);
  } else {
    console.log(`[relay] Session ${sessionId} destroyed`);
  }
}
