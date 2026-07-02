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
  /** Client-supported protocol capabilities, eg. terminal:ack. */
  clientCapabilities?: string[];
  systemPrompt?: string;
  /** Working directory for the PTY session. Defaults to $HOME. */
  cwd?: string;
  /** Files to bootstrap in the CWD before spawning the CLI. Keys are relative paths, values are file contents. Only written if the file doesn't already exist. */
  workspaceFiles?: Record<string, string>;
  /** How long (ms) to keep the PTY alive after the client disconnects. Defaults to 30 min. */
  orphanTTL?: number;
  /** PTY backend. 'pty' spawns a fresh process; 'tmux'/'zellij' attach to named multiplexers. */
  backend?: 'pty' | 'tmux' | 'zellij';
  /** Client control intent. Current local relay treats this as advisory. */
  controlMode?: 'owner' | 'takeover' | 'observe';
  /** For tmux backend: the tmux session name. Required when backend is 'tmux'. */
  tmuxSession?: string;
  /** For zellij backend: the zellij session name. */
  zellijSession?: string;
  /** For zellij backend: optional shorter socket directory (useful on macOS). */
  zellijSocketDir?: string;
  /** Process to spawn. 'claude' (default), 'pi', or 'shell' for a normal login shell. */
  agent?: 'claude' | 'pi' | 'shell';
  /** For pi agent: provider name (e.g. 'minimax', 'github-copilot'). */
  provider?: string;
  /** For pi agent: model ID (e.g. 'MiniMax-M1'). */
  model?: string;
}

export interface SessionReconnectMessage {
  type: 'session:reconnect';
  sessionId: string;
  cols?: number;
  rows?: number;
  /** Client-supported protocol capabilities, eg. terminal:ack. */
  clientCapabilities?: string[];
  /** Client control intent. Current local relay treats this as advisory. */
  controlMode?: 'owner' | 'takeover' | 'observe';
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

export interface TerminalAckMessage {
  type: 'terminal:ack';
  seq: number;
}

export type ClientMessage =
  | SessionInitMessage
  | SessionReconnectMessage
  | TerminalInputMessage
  | TerminalResizeMessage
  | TerminalAckMessage;

import { createRequire } from 'module';
import { execFileSync, execSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname as pathDirname } from 'path';
import type { IPty } from '@lydell/node-pty';

const require = createRequire(import.meta.url);
const pty = (() => {
  try {
    return require('@lydell/node-pty') as typeof import('@lydell/node-pty');
  } catch {
    return require('node-pty') as typeof import('@lydell/node-pty');
  }
})();

import {
  ackTerminalData,
  createTerminalFlowControlState,
  enqueueTerminalData,
  resetTerminalFlowControl,
  TERMINAL_ACK_CAPABILITY,
  TERMINAL_FLOW_CONTROL_CAPABILITY,
  type TerminalFlowControlState,
} from './terminal-relay-flow';
import {
  buildZellijAttachArgs,
  createZellijLayoutFile,
  prepareZellijSocketDir,
} from './terminal-relay-zellij';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default orphan TTL — how long a detached session lives before being reaped. */
const DEFAULT_ORPHAN_TTL_MS = 30 * 60 * 1000; // 30 minutes

/** Maximum size of the raw output buffer for reconnect replay (~512 KB). */
const MAX_BUFFER_SIZE = 512 * 1024;

export const RELAY_CAPABILITIES = [
  TERMINAL_ACK_CAPABILITY,
  TERMINAL_FLOW_CONTROL_CAPABILITY,
  'backend:pty',
  'backend:tmux',
  'backend:zellij',
  'control-mode:observe',
] as const;

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
  backend: 'pty' | 'tmux' | 'zellij';
  /** Client control intent. */
  controlMode: 'owner' | 'takeover' | 'observe';
  /** tmux session name (only set when backend is 'tmux'). */
  tmuxSession?: string;
  /** zellij session name (only set when backend is 'zellij'). */
  zellijSession?: string;
  /** zellij socket directory override (only set when backend is 'zellij'). */
  zellijSocketDir?: string;
  /** Temporary layout file used to create a zellij session with the requested command. */
  zellijLayoutPath?: string;
  /** ACK-based outbound flow-control state for attached clients. */
  flowControl: TerminalFlowControlState;
  /** Whether the currently attached client supports ACK-based flow control. */
  flowControlEnabled: boolean;
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

function pauseSessionOutput(session: Session) {
  try { session.pty.pause?.(); } catch {}
}

function resumeSessionOutput(session: Session) {
  try { session.pty.resume?.(); } catch {}
}

function resetSessionFlowControl(session: Session) {
  resetTerminalFlowControl(session.flowControl, {
    resume: () => resumeSessionOutput(session),
  });
}

export function ackSessionOutput(session: Session, seq: number): boolean {
  if (!session.flowControlEnabled) return false;
  return ackTerminalData(session.flowControl, session.ws, seq, {
    pause: () => pauseSessionOutput(session),
    resume: () => resumeSessionOutput(session),
  });
}

function sendTerminalOutput(session: Session, data: string) {
  if (!session.flowControlEnabled) {
    if (session.ws && session.ws.readyState === 1) {
      send(session.ws, { type: 'terminal:data', data });
    }
    return;
  }

  enqueueTerminalData(session.flowControl, session.ws, data, {
    pause: () => pauseSessionOutput(session),
    resume: () => resumeSessionOutput(session),
    onDrop: ({ bytes, chunks }) => {
      console.warn(`[relay] Session ${session.id}: dropped ${bytes} bytes across ${chunks} queued output chunks after flow-control overflow`);
    },
  });
}

function clientSupportsAck(capabilities?: string[]): boolean {
  return Array.isArray(capabilities) && capabilities.includes(TERMINAL_ACK_CAPABILITY);
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
    if (session.backend === 'tmux' && session.tmuxSession) {
      resizeTmuxWindow(session.tmuxSession, cols, rows);
    }
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

/** Locate the user's shell, falling back to common POSIX shells. */
function findShellBin(): string | null {
  const configured = process.env.SHELL;
  if (configured && existsSync(configured)) return configured;
  return findBin('zsh') ?? findBin('bash') ?? findBin('sh') ?? (existsSync('/bin/sh') ? '/bin/sh' : null);
}

/** Locate the zellij binary, returning null if not found. */
function findZellijBin(): string | null {
  return findBin('zellij', 'ZELLIJ_BIN');
}

/** Map Hudson-facing provider ids to the exact provider names accepted by the Pi CLI. */
function normalizePiProviderForCli(provider?: string): string | undefined {
  if (!provider) return undefined;
  if (provider === 'copilot' || provider === 'github') return 'github-copilot';
  return provider;
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

/** Resize the tmux window behind an attached bridge PTY. */
function resizeTmuxWindow(name: string, cols: number, rows: number): boolean {
  try {
    execFileSync('tmux', [
      'resize-window',
      '-t',
      name,
      '-x',
      String(cols),
      '-y',
      String(rows),
    ], { stdio: 'ignore' });
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
  commandBin: string,
  commandArgs: string[],
  env: Record<string, string | undefined>,
): IPty {
  const exists = tmuxSessionExists(tmuxName);

  if (!exists) {
    // Create the tmux session detached, running the requested command inside it.
    const shellCmd = [commandBin, ...commandArgs].map(a => a.includes(' ') ? `'${a}'` : a).join(' ');
    execSync(
      `tmux new-session -d -s ${tmuxName} -x ${cols} -y ${rows} -c '${cwd}' '${shellCmd}'`,
      { env: env as NodeJS.ProcessEnv },
    );
    console.log(`[relay] Created tmux session: ${tmuxName}`);
  } else {
    // Resize existing session to match client
    resizeTmuxWindow(tmuxName, cols, rows);
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

/** Spawn a PTY that attaches to a zellij session (creating it if needed). */
function spawnZellijSession(
  zellijBin: string,
  zellijName: string,
  cols: number,
  rows: number,
  cwd: string,
  commandBin: string,
  commandArgs: string[],
  env: Record<string, string | undefined>,
  controlMode: 'owner' | 'takeover' | 'observe',
): { ptyProcess: IPty; layoutPath?: string } {
  const layoutPath = controlMode === 'observe'
    ? undefined
    : createZellijLayoutFile({ cwd, commandBin, commandArgs });
  const args = buildZellijAttachArgs({
    sessionName: zellijName,
    controlMode,
    layoutPath,
    cwd,
  });

  return {
    ptyProcess: pty.spawn(zellijBin, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env,
    }),
    layoutPath,
  };
}

export function createSession(ws: RelaySocket, msg: SessionInitMessage): Session | null {
  const id = generateId();
  const cols = Math.max(msg.cols || 80, 20);
  const rows = Math.max(msg.rows || 24, 4);
  const backend = msg.backend || 'pty';
  const controlMode = msg.controlMode || 'owner';
  const tmuxName = msg.tmuxSession || `hudson-${id}`;
  const zellijName = msg.zellijSession || `hudson-${id}`;
  const agent = msg.agent || 'claude';

  // ---- Pre-flight: locate command binary ----
  let agentBin: string | null;
  if (agent === 'shell') {
    agentBin = findShellBin();
    if (!agentBin) {
      const reason = 'No login shell found. Set SHELL or install zsh, bash, or sh.';
      console.error(`[relay] Session ${id} failed: ${reason}`);
      send(ws, { type: 'session:error', error: reason });
      return null;
    }
  } else if (agent === 'pi') {
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

  const zellijBin = backend === 'zellij' ? findZellijBin() : null;
  if (backend === 'zellij' && !zellijBin) {
    const reason = 'zellij not found. Install it with: brew install zellij';
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

  // ---- Build command arguments based on process type ----
  let agentArgs: string[];

  if (agent === 'shell') {
    const shellName = agentBin.split('/').pop() ?? '';
    agentArgs = shellName === 'sh' ? [] : ['-l'];
  } else if (agent === 'pi') {
    agentArgs = ['--verbose'];
    const provider = normalizePiProviderForCli(msg.provider);
    if (provider) agentArgs.push('--provider', provider);
    if (msg.model) agentArgs.push('--model', msg.model);
    if (msg.systemPrompt) agentArgs.push('--system-prompt', msg.systemPrompt);
  } else {
    agentArgs = ['--verbose'];
    if (msg.systemPrompt) agentArgs.push('--system-prompt', msg.systemPrompt);
  }

  const env: Record<string, string | undefined> = {
    ...process.env,
    ...prepareZellijSocketDir(backend === 'zellij' ? msg.zellijSocketDir : undefined),
    TERM: 'xterm-256color',
    FORCE_COLOR: '1',
  };
  delete env.CLAUDECODE;

  // ---- Spawn PTY (direct or tmux-backed) ----
  let ptyProcess: IPty;
  let zellijLayoutPath: string | undefined;

  try {
    if (backend === 'tmux') {
      console.log(`[relay] Session ${id}: tmux backend (session: ${tmuxName}) in ${cwd} [agent: ${agent}]`);
      ptyProcess = spawnTmuxSession(tmuxName, cols, rows, cwd, agentBin, agentArgs, env);
    } else if (backend === 'zellij') {
      console.log(`[relay] Session ${id}: zellij backend (session: ${zellijName}, mode: ${controlMode}) in ${cwd} [agent: ${agent}]`);
      const spawned = spawnZellijSession(zellijBin!, zellijName, cols, rows, cwd, agentBin, agentArgs, env, controlMode);
      ptyProcess = spawned.ptyProcess;
      zellijLayoutPath = spawned.layoutPath;
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
    controlMode,
    ...(backend === 'tmux' ? { tmuxSession: tmuxName } : {}),
    ...(backend === 'zellij' ? {
      zellijSession: zellijName,
      ...(msg.zellijSocketDir ? { zellijSocketDir: msg.zellijSocketDir } : {}),
      ...(zellijLayoutPath ? { zellijLayoutPath } : {}),
    } : {}),
    flowControl: createTerminalFlowControlState(),
    flowControlEnabled: clientSupportsAck(msg.clientCapabilities),
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

    // Forward raw data to attached client with ACK-based backpressure.
    sendTerminalOutput(session, data);
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
export function attachSession(session: Session, ws: RelaySocket, cols?: number, rows?: number, clientCapabilities?: string[]) {
  // Cancel any pending reap
  if (session.reapTimer) {
    clearTimeout(session.reapTimer);
    session.reapTimer = null;
  }

  resetSessionFlowControl(session);
  session.flowControlEnabled = clientSupportsAck(clientCapabilities);
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
    sendTerminalOutput(session, session.outputBuffer);
  }

  console.log(`[relay] Session ${session.id} reconnected`);
}

/** Detach the WebSocket from a session (keeps PTY alive). */
export function detachSession(session: Session) {
  resetSessionFlowControl(session);
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
  resetSessionFlowControl(session);
  try { session.pty.kill(); } catch {}
  if (session.zellijLayoutPath) {
    try { rmSync(pathDirname(session.zellijLayoutPath), { recursive: true, force: true }); } catch {}
  }
  sessions.delete(sessionId);
  if (session.backend === 'tmux') {
    console.log(`[relay] Session ${sessionId} bridge destroyed (tmux session '${session.tmuxSession}' still alive)`);
  } else if (session.backend === 'zellij') {
    console.log(`[relay] Session ${sessionId} bridge destroyed (zellij session '${session.zellijSession}' still alive)`);
  } else {
    console.log(`[relay] Session ${sessionId} destroyed`);
  }
}
