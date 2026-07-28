import type { RuntimeEnv } from "../portable-types.js";

import { defineProbeFamily, type ProbeCtx } from "./registry.js";
import { execProbeFile, ProbeCommandError } from "./exec.js";
import { runWithScoutdFallback } from "./scoutd-client.js";

const HERDR_TTL_MS = 5_000;
const HERDR_TIMEOUT_MS = 2_000;

export type HerdrSessionInfo = {
  name: string;
  isDefault: boolean;
  running: boolean;
  /** Server-local only — never forward to browser clients. */
  sessionDir: string | null;
};

/**
 * Agent state as the host reports it, rather than as Scout infers it from
 * screen-scraping a rendered composer. Only meaningful while the session's
 * herdr server is running; a stopped session simply reports no agents.
 */
export type HerdrAgentInfo = {
  /** Pane id, which `herdr agent <verb> <target>` accepts. */
  target: string;
  name: string | null;
  status: "idle" | "working" | "blocked" | "unknown";
  cwd: string | null;
};

function herdrBin(env: RuntimeEnv = process.env): string {
  return env.OPENSCOUT_HERDR_BIN?.trim() || "herdr";
}

function isUnavailable(error: unknown): boolean {
  return error instanceof ProbeCommandError
    && (error.code === "ENOENT" || error.code === "spawn" || error.code === "exit");
}

export function herdrProbeKey(input?: string | { env?: RuntimeEnv } | null): string {
  if (typeof input === "string") return input.trim() || "default";
  // One inventory per environment; a client-supplied socket path is never
  // accepted, so a browser cannot steer the probe at an arbitrary socket.
  return "default";
}

export function parseHerdrSessionListJson(output: string): HerdrSessionInfo[] {
  const trimmed = output.trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return [];
  }

  const sessions = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { sessions?: unknown }).sessions)
      ? (parsed as { sessions: unknown[] }).sessions
      : [];

  const out: HerdrSessionInfo[] = [];
  for (const entry of sessions) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!name) continue;
    const isDefault = record.default === true || name === "default";
    const running = record.running === true;
    const sessionDir = typeof record.session_dir === "string" && record.session_dir.trim()
      ? record.session_dir.trim()
      : typeof record.sessionDir === "string" && record.sessionDir.trim()
        ? record.sessionDir.trim()
        : null;
    out.push({ name, isDefault, running, sessionDir });
  }
  return out;
}

/** Attach argv for a discovered Herdr session. Never includes socket paths. */
export function buildHerdrAttachCommand(session: Pick<HerdrSessionInfo, "name" | "isDefault">): string[] {
  if (session.isDefault || session.name === "default") {
    return ["herdr"];
  }
  return ["herdr", "session", "attach", session.name];
}

/** Create-or-attach argv for a Scout-owned named Herdr session. */
export function buildHerdrCreateAttachCommand(sessionName: string): string[] {
  const name = sessionName.trim();
  if (!name || name === "default") return ["herdr"];
  return ["herdr", "--session", name];
}

/**
 * Argv that brings a named Herdr session into existence with NO terminal
 * attached: the session's own headless server. `herdr --session <name>` needs a
 * TTY because it launches the client too; this is the half Scout wants, and the
 * session then shows up in `herdr session list` for anyone to attach to.
 */
export function buildHerdrStartServerCommand(sessionName: string): string[] {
  const name = sessionName.trim();
  if (!name || name === "default") return ["herdr", "server"];
  return ["herdr", "--session", name, "server"];
}

/** Argv for the first workspace inside a Scout-created Herdr session. */
export function buildHerdrWorkspaceCreateCommand(
  sessionName: string,
  input: { cwd?: string | null; label?: string | null } = {},
): string[] {
  const args = ["herdr", "--session", sessionName.trim(), "workspace", "create"];
  if (input.cwd?.trim()) args.push("--cwd", input.cwd.trim());
  if (input.label?.trim()) args.push("--label", input.label.trim());
  args.push("--no-focus");
  return args;
}

/**
 * `herdr agent list` answers over the socket API in JSON, wrapped as
 * `{ id, result: { agents: [...] } }`. Parse defensively: a status the schema
 * grows later reads as "unknown" rather than being guessed at, and an empty
 * result is an ordinary state (the session's server is not running).
 */
export function parseHerdrAgentList(output: string): HerdrAgentInfo[] {
  const trimmed = output.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return [];
  }
  const result = parsed && typeof parsed === "object" && "result" in parsed
    ? (parsed as { result?: unknown }).result
    : parsed;
  const agents = result && typeof result === "object" && Array.isArray((result as { agents?: unknown }).agents)
    ? (result as { agents: unknown[] }).agents
    : [];

  const out: HerdrAgentInfo[] = [];
  for (const entry of agents) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const target = typeof record.pane_id === "string" && record.pane_id.trim()
      ? record.pane_id.trim()
      : typeof record.terminal_id === "string" && record.terminal_id.trim()
        ? record.terminal_id.trim()
        : null;
    if (!target) continue;
    out.push({
      target,
      name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : null,
      status: normalizeHerdrAgentStatus(record.agent_status),
      cwd: typeof record.cwd === "string" && record.cwd.trim() ? record.cwd.trim() : null,
    });
  }
  return out;
}

function normalizeHerdrAgentStatus(value: unknown): HerdrAgentInfo["status"] {
  switch (typeof value === "string" ? value.toLowerCase() : "") {
    case "idle":
      return "idle";
    case "working":
      return "working";
    case "blocked":
      return "blocked";
    default:
      return "unknown";
  }
}

async function readHerdrSessionsLocal(_key: string, ctx: ProbeCtx): Promise<HerdrSessionInfo[]> {
  try {
    const { stdout } = await execProbeFile(ctx, herdrBin(), ["session", "list", "--json"], {
      maxStdoutBytes: 512 * 1024,
      maxStderrBytes: 64 * 1024,
    });
    return parseHerdrSessionListJson(stdout);
  } catch (error) {
    if (isUnavailable(error)) return [];
    throw error;
  }
}

export const herdrSessionsProbe = defineProbeFamily<string | { env?: RuntimeEnv } | null, HerdrSessionInfo[]>({
  id: "herdr.sessions",
  ttlMs: HERDR_TTL_MS,
  timeoutMs: HERDR_TIMEOUT_MS,
  maxKeys: 4,
  idleKeyTtlMs: 5 * 60_000,
  maxConcurrentKeys: 1,
  normalizeKey: herdrProbeKey,
  run: (key, ctx) => runWithScoutdFallback({
    probeId: "herdr.sessions",
    key,
    ctx,
    local: () => readHerdrSessionsLocal(key, ctx),
  }),
});

export async function readHerdrSessions(options: { env?: RuntimeEnv; maxAgeMs?: number } = {}): Promise<HerdrSessionInfo[]> {
  const snapshot = await herdrSessionsProbe.for({ env: options.env }).fresh({
    maxAgeMs: options.maxAgeMs ?? HERDR_TTL_MS,
  });
  return snapshot.value ?? [];
}

export function invalidateHerdrSessions(options: { env?: RuntimeEnv; reason?: string } = {}): void {
  herdrSessionsProbe.invalidate({ env: options.env }, options.reason);
}

/**
 * Whether the herdr binary is present. Availability is not a capability: herdr
 * may be installed while a given session's server is stopped, in which case the
 * agent-state verbs return nothing rather than failing the host.
 */
export async function isHerdrAvailable(options: { env?: RuntimeEnv } = {}): Promise<boolean> {
  const env = options.env ?? process.env;
  if (env.OPENSCOUT_HERDR_BIN?.trim()) return true;
  try {
    const { stdout } = await execProbeFile(
      {
        probeId: "herdr.which",
        signal: AbortSignal.timeout(HERDR_TIMEOUT_MS),
        timeoutMs: HERDR_TIMEOUT_MS,
        startedAt: Date.now(),
      },
      "which",
      ["herdr"],
      { maxStdoutBytes: 4_096, maxStderrBytes: 1_024 },
    );
    return Boolean(stdout.trim());
  } catch {
    return false;
  }
}
