import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

import type {
  TerminalBackend,
  TerminalSessionRecord,
  TerminalSurface,
  TerminalSurfaceState,
} from "@openscout/protocol";

type DiscoveredTerminalSession = TerminalSessionRecord & {
  metadata: Record<string, unknown>;
};

type DiscoveryOptions = {
  backend?: TerminalBackend;
  excludeSurfaces?: Iterable<string>;
  limit?: number;
  env?: NodeJS.ProcessEnv;
};

type TmuxSessionInfo = {
  name: string;
  windows: number;
  attached: number;
};

type ZellijSessionInfo = {
  name: string;
  state: TerminalSurfaceState;
  raw: string;
};

export function queryDiscoveredTerminalSessions(options: DiscoveryOptions = {}): TerminalSessionRecord[] {
  const env = options.env ?? process.env;
  const excluded = new Set(options.excludeSurfaces ?? []);
  const limit = normalizedDiscoveryLimit(options.limit);
  const sessions: TerminalSessionRecord[] = [];

  if (!options.backend || options.backend === "tmux") {
    sessions.push(...discoverTmuxSessions({ env, excluded }));
  }

  if (!options.backend || options.backend === "zellij") {
    sessions.push(...discoverZellijSessions({ env, excluded }));
  }

  return sessions.slice(0, limit);
}

function discoverTmuxSessions(input: { env: NodeJS.ProcessEnv; excluded: Set<string> }): DiscoveredTerminalSession[] {
  const result = spawnSync("tmux", ["list-sessions", "-F", "#{session_name}|#{session_windows}|#{session_attached}"], {
    env: input.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") {
    return [];
  }

  return parseTmuxSessionList(result.stdout)
    .filter((session) => !input.excluded.has(terminalSurfaceKey("tmux", session.name)))
    .map((session) => discoveredRecordFromSurface({
      backend: "tmux",
      name: session.name,
      state: "live",
      surface: {
        backend: "tmux",
        sessionName: session.name,
        paneId: null,
        attachCommand: ["tmux", "attach", "-t", session.name],
        observeCommand: null,
        relay: {
          backend: "tmux",
          sessionName: session.name,
          tmuxSession: session.name,
        },
        state: "live",
      },
      metadata: {
        source: "backend-discovery",
        registryState: "discovered",
        attachedClients: session.attached,
        windows: session.windows,
      },
    }));
}

function discoverZellijSessions(input: { env: NodeJS.ProcessEnv; excluded: Set<string> }): DiscoveredTerminalSession[] {
  const socketDir = resolveZellijSocketDir(input.env);
  const result = spawnSync("zellij", ["list-sessions"], {
    env: { ...input.env, ZELLIJ_SOCKET_DIR: socketDir },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") {
    return [];
  }

  return parseZellijSessionList(result.stdout)
    .filter((session) => !input.excluded.has(terminalSurfaceKey("zellij", session.name)))
    .map((session) => discoveredRecordFromSurface({
      backend: "zellij",
      name: session.name,
      state: session.state,
      surface: {
        backend: "zellij",
        sessionName: session.name,
        paneId: null,
        attachCommand: ["env", `ZELLIJ_SOCKET_DIR=${socketDir}`, "zellij", "attach", session.name],
        observeCommand: ["env", `ZELLIJ_SOCKET_DIR=${socketDir}`, "zellij", "watch", session.name],
        relay: {
          backend: "zellij",
          sessionName: session.name,
          zellijSession: session.name,
        },
        state: session.state,
        socketDir,
      },
      metadata: {
        source: "backend-discovery",
        registryState: "discovered",
        backendState: session.state,
        raw: session.raw,
      },
    }));
}

export function parseTmuxSessionList(output: string): TmuxSessionInfo[] {
  return output
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, windows, attached] = line.includes("|") ? line.split("|") : line.split("\t");
      if (!name) return null;
      return {
        name,
        windows: parsePositiveInteger(windows, 1),
        attached: parsePositiveInteger(attached, 0),
      };
    })
    .filter((session): session is TmuxSessionInfo => Boolean(session));
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
      };
    })
    .filter((session): session is ZellijSessionInfo => Boolean(session));
}

export function terminalSurfaceKey(backend: TerminalBackend, sessionName: string): string {
  return `${backend}:${sessionName}`;
}

function discoveredRecordFromSurface(input: {
  backend: TerminalBackend;
  name: string;
  state: TerminalSurfaceState;
  surface: TerminalSurface;
  metadata: Record<string, unknown>;
}): DiscoveredTerminalSession {
  const now = Date.now();
  const id = `discovered.${input.backend}.${createHash("sha1").update(input.name).digest("hex").slice(0, 16)}`;
  return {
    id,
    harness: input.backend,
    sourceSessionId: input.name,
    cwd: "",
    resumeCommand: input.surface.attachCommand.join(" "),
    surfaces: [input.surface],
    createdAt: now,
    updatedAt: now,
    metadata: input.metadata,
  };
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizedDiscoveryLimit(value: number | undefined, fallback = 100, max = 1000): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(max, Math.floor(value)));
}

function resolveZellijSocketDir(env: NodeJS.ProcessEnv): string {
  return env.ZELLIJ_SOCKET_DIR?.trim()
    || env.OPENSCOUT_ZELLIJ_SOCKET_DIR?.trim()
    || join(env.HOME?.trim() || homedir(), ".openscout", "zellij-sockets");
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/gu, "");
}
