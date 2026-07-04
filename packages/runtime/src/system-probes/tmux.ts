import { homedir } from "node:os";
import { join } from "node:path";

import { defineProbeFamily, type ProbeCtx } from "./registry.js";
import { execProbeFile, ProbeCommandError } from "./exec.js";

const TMUX_TTL_MS = 5_000;
const TMUX_TIMEOUT_MS = 1_500;
const ZELLIJ_TIMEOUT_MS = 1_500;

export type TmuxSessionInfo = {
  name: string;
  windows: number;
  attached: number;
  createdAt: number | null;
  currentCommand: string | null;
  currentPath: string | null;
};

export type ZellijSessionInfo = {
  name: string;
  state: "live" | "exited";
  raw: string;
};

export type TmuxPaneDetail = {
  panePid: number;
  paneTty: string;
  paneCurrentPath: string | null;
};

export type TmuxPaneCapture = {
  body: string;
};

type TmuxPaneProbeKey =
  | {
      kind: "detail";
      target: string;
      socketPath?: string | null;
    }
  | {
      kind: "capture";
      target: string;
      start: string;
      end: string;
      joinWrapped?: boolean;
      maxBytes?: number;
      socketPath?: string | null;
    };

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function cleanOptionalString(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function splitDelimitedLine(line: string, delimiter: "|" | "\t", fieldCount: number): string[] {
  const parts = line.split(delimiter);
  if (parts.length <= fieldCount) return parts;
  return [...parts.slice(0, fieldCount - 1), parts.slice(fieldCount - 1).join(delimiter)];
}

function parseProcessNumber(value: string | undefined): number | null {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isUnavailable(error: unknown): boolean {
  return error instanceof ProbeCommandError
    && (error.code === "ENOENT" || error.code === "spawn" || error.code === "exit");
}

function tmuxSocketFromEnv(env: NodeJS.ProcessEnv): string | null {
  const explicit = env.OPENSCOUT_TMUX_SOCKET?.trim();
  if (explicit) return explicit;
  const tmux = env.TMUX?.trim();
  if (!tmux) return null;
  const [socketPath] = tmux.split(",");
  return socketPath?.trim() || null;
}

export function tmuxSocketKey(input?: string | { env?: NodeJS.ProcessEnv; socketPath?: string | null } | null): string {
  if (typeof input === "string") return input.trim() || "default";
  const socketPath = input?.socketPath?.trim() || tmuxSocketFromEnv(input?.env ?? process.env);
  return socketPath || "default";
}

function tmuxSocketArgs(key: string): string[] {
  return key === "default" ? [] : ["-S", key];
}

function zellijSocketDirFromEnv(env: NodeJS.ProcessEnv): string {
  return env.ZELLIJ_SOCKET_DIR?.trim()
    || env.OPENSCOUT_ZELLIJ_SOCKET_DIR?.trim()
    || join(env.HOME?.trim() || homedir(), ".openscout", "zellij-sockets");
}

export function zellijSocketKey(input?: string | { env?: NodeJS.ProcessEnv; socketDir?: string | null } | null): string {
  if (typeof input === "string") return input.trim() || zellijSocketDirFromEnv(process.env);
  return input?.socketDir?.trim() || zellijSocketDirFromEnv(input?.env ?? process.env);
}

export function parseTmuxSessionList(output: string): TmuxSessionInfo[] {
  return output
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, windows, attached, createdAt, currentCommand, currentPath] = line.includes("|")
        ? splitDelimitedLine(line, "|", 6)
        : splitDelimitedLine(line, "\t", 6);
      if (!name) return null;
      return {
        name,
        windows: parsePositiveInteger(windows, 1),
        attached: parsePositiveInteger(attached, 0),
        createdAt: createdAt ? Number.parseInt(createdAt, 10) || null : null,
        currentCommand: cleanOptionalString(currentCommand),
        currentPath: cleanOptionalString(currentPath),
      };
    })
    .filter((session): session is TmuxSessionInfo => Boolean(session));
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/gu, "");
}

export function parseZellijSessionList(output: string): ZellijSessionInfo[] {
  return stripAnsi(output)
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name] = line.split(/\s+/u);
      if (!name) return null;
      return {
        name,
        state: /\bEXITED\b/iu.test(line) ? "exited" : "live",
        raw: line,
      } satisfies ZellijSessionInfo;
    })
    .filter((session): session is ZellijSessionInfo => Boolean(session));
}

export const tmuxSessionsProbe = defineProbeFamily<string | { env?: NodeJS.ProcessEnv; socketPath?: string | null }, TmuxSessionInfo[]>({
  id: "tmux.sessions",
  ttlMs: TMUX_TTL_MS,
  timeoutMs: TMUX_TIMEOUT_MS,
  maxKeys: 16,
  idleKeyTtlMs: 5 * 60_000,
  maxConcurrentKeys: 2,
  normalizeKey: tmuxSocketKey,
  run: async (key, ctx) => {
    try {
      const { stdout } = await execProbeFile(ctx, "tmux", [
        ...tmuxSocketArgs(key),
        "list-sessions",
        "-F",
        "#{session_name}|#{session_windows}|#{session_attached}|#{session_created}|#{pane_current_command}|#{pane_current_path}",
      ], {
        maxStdoutBytes: 512 * 1024,
        maxStderrBytes: 64 * 1024,
      });
      return parseTmuxSessionList(stdout);
    } catch (error) {
      if (isUnavailable(error)) return [];
      throw error;
    }
  },
});

export const zellijSessionsProbe = defineProbeFamily<string | { env?: NodeJS.ProcessEnv; socketDir?: string | null }, ZellijSessionInfo[]>({
  id: "zellij.sessions",
  ttlMs: TMUX_TTL_MS,
  timeoutMs: ZELLIJ_TIMEOUT_MS,
  maxKeys: 16,
  idleKeyTtlMs: 5 * 60_000,
  maxConcurrentKeys: 2,
  normalizeKey: zellijSocketKey,
  run: async (socketDir, ctx) => {
    try {
      const { stdout } = await execProbeFile(ctx, "zellij", ["list-sessions"], {
        env: { ...process.env, ZELLIJ_SOCKET_DIR: socketDir },
        maxStdoutBytes: 512 * 1024,
        maxStderrBytes: 64 * 1024,
      });
      return parseZellijSessionList(stdout);
    } catch (error) {
      if (isUnavailable(error)) return [];
      throw error;
    }
  },
});

function normalizeTmuxPaneKey(input: TmuxPaneProbeKey): string {
  const socketPath = tmuxSocketKey(input.socketPath ?? null);
  if (input.kind === "detail") {
    return JSON.stringify({ kind: "detail", socketPath, target: input.target.trim() });
  }
  return JSON.stringify({
    kind: "capture",
    socketPath,
    target: input.target.trim(),
    start: input.start,
    end: input.end,
    joinWrapped: input.joinWrapped !== false,
    maxBytes: input.maxBytes ?? null,
  });
}

function parseTmuxPaneKey(key: string): TmuxPaneProbeKey & { socketPath: string } {
  const parsed = JSON.parse(key) as TmuxPaneProbeKey & { socketPath: string };
  return parsed;
}

export const tmuxPanesProbe = defineProbeFamily<TmuxPaneProbeKey, TmuxPaneDetail | TmuxPaneCapture | null>({
  id: "tmux.panes",
  ttlMs: TMUX_TTL_MS,
  timeoutMs: 1_500,
  maxKeys: 128,
  idleKeyTtlMs: 2 * 60_000,
  maxConcurrentKeys: 4,
  normalizeKey: normalizeTmuxPaneKey,
  run: async (key, ctx) => {
    const parsed = parseTmuxPaneKey(key);
    try {
      if (parsed.kind === "detail") {
        const { stdout } = await execProbeFile(ctx, "tmux", [
          ...tmuxSocketArgs(parsed.socketPath),
          "display-message",
          "-p",
          "-t",
          parsed.target,
          "#{pane_pid}\t#{pane_tty}\t#{pane_current_path}",
        ], {
          maxStdoutBytes: 64 * 1024,
          maxStderrBytes: 64 * 1024,
        });
        const [pidRaw, ttyRaw, pathRaw] = stdout.trim().split("\t");
        const panePid = parseProcessNumber(pidRaw);
        const paneTty = ttyRaw?.replace(/^\/dev\//u, "").trim();
        const paneCurrentPath = pathRaw?.trim() || null;
        return panePid && paneTty ? { panePid, paneTty, paneCurrentPath } : null;
      }

      const { stdout } = await execProbeFile(ctx, "tmux", [
        ...tmuxSocketArgs(parsed.socketPath),
        "capture-pane",
        "-p",
        ...(parsed.joinWrapped === false ? [] : ["-J"]),
        "-t",
        parsed.target,
        "-S",
        parsed.start,
        "-E",
        parsed.end,
      ], {
        maxStdoutBytes: parsed.maxBytes ?? 1024 * 1024,
        maxStderrBytes: 64 * 1024,
      });
      return { body: stdout };
    } catch (error) {
      if (isUnavailable(error)) return null;
      throw error;
    }
  },
});

export async function readTmuxSessionExists(sessionName: string, options: { env?: NodeJS.ProcessEnv; socketPath?: string | null; maxAgeMs?: number } = {}): Promise<boolean> {
  const name = sessionName.trim();
  if (!name) return false;
  const snapshot = await tmuxSessionsProbe.for({ env: options.env, socketPath: options.socketPath }).fresh({ maxAgeMs: options.maxAgeMs ?? TMUX_TTL_MS });
  return Boolean(snapshot.value?.some((session) => session.name === name));
}

export function readTmuxSessionExistsSnapshot(sessionName: string, options: { env?: NodeJS.ProcessEnv; socketPath?: string | null } = {}): boolean {
  const name = sessionName.trim();
  if (!name) return false;
  const snapshot = tmuxSessionsProbe.for({ env: options.env, socketPath: options.socketPath }).read();
  return Boolean(snapshot.value?.some((session) => session.name === name));
}

export function invalidateTmuxSessions(options: { env?: NodeJS.ProcessEnv; socketPath?: string | null; reason?: string } = {}): void {
  tmuxSessionsProbe.invalidate({ env: options.env, socketPath: options.socketPath }, options.reason);
}

export async function readZellijSessionExists(sessionName: string, options: { env?: NodeJS.ProcessEnv; socketDir?: string | null; maxAgeMs?: number } = {}): Promise<boolean> {
  const name = sessionName.trim();
  if (!name) return false;
  const snapshot = await zellijSessionsProbe.for({ env: options.env, socketDir: options.socketDir }).fresh({ maxAgeMs: options.maxAgeMs ?? TMUX_TTL_MS });
  return Boolean(snapshot.value?.some((session) => session.name === name));
}

export function invalidateZellijSessions(options: { env?: NodeJS.ProcessEnv; socketDir?: string | null; reason?: string } = {}): void {
  zellijSessionsProbe.invalidate({ env: options.env, socketDir: options.socketDir }, options.reason);
}

export async function readTmuxPaneDetail(target: string, options: { maxAgeMs?: number; socketPath?: string | null } = {}): Promise<TmuxPaneDetail | null> {
  const snapshot = await tmuxPanesProbe.for({ kind: "detail", target, socketPath: options.socketPath }).fresh({ maxAgeMs: options.maxAgeMs ?? TMUX_TTL_MS });
  return snapshot.value && "panePid" in snapshot.value ? snapshot.value : null;
}

export async function captureTmuxPane(target: string, input: {
  start: string;
  end?: string;
  joinWrapped?: boolean;
  maxBytes?: number;
  maxAgeMs?: number;
  socketPath?: string | null;
}): Promise<string | null> {
  const key: TmuxPaneProbeKey = {
    kind: "capture",
    target,
    start: input.start,
    end: input.end ?? "-",
    joinWrapped: input.joinWrapped,
    maxBytes: input.maxBytes,
    socketPath: input.socketPath,
  };
  const snapshot = await tmuxPanesProbe.for(key).fresh({ maxAgeMs: input.maxAgeMs ?? TMUX_TTL_MS });
  return snapshot.value && "body" in snapshot.value ? snapshot.value.body : null;
}
