import { homedir } from "node:os";

import type { RuntimeEnv } from "../portable-types.js";

import { defineProbeFamily, probeRunOutput, type ProbeCtx } from "./registry.js";
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

/**
 * The parts of an environment that decide what `herdr session list` answers:
 * which binary runs, where it is found, and which config home its sessions
 * live in. Everything else in an environment is noise for this probe.
 */
type HerdrProbeTarget = { bin: string; path: string; home: string };

function herdrProbeTarget(env: RuntimeEnv): HerdrProbeTarget {
  return {
    bin: herdrBin(env),
    path: env.PATH ?? "",
    home: env.XDG_CONFIG_HOME?.trim() || env.HOME?.trim() || homedir(),
  };
}

function parseHerdrProbeKey(key: string): HerdrProbeTarget {
  try {
    const parsed = JSON.parse(key) as Partial<HerdrProbeTarget>;
    if (typeof parsed?.bin === "string" && typeof parsed.path === "string" && typeof parsed.home === "string") {
      return { bin: parsed.bin, path: parsed.path, home: parsed.home };
    }
  } catch {
    // A caller-supplied opaque string key; fall through to this process.
  }
  return herdrProbeTarget(process.env);
}

function isUnavailable(error: unknown): boolean {
  return error instanceof ProbeCommandError
    && (error.code === "ENOENT" || error.code === "spawn" || error.code === "exit");
}

/**
 * One cache entry per ENVIRONMENT, the way the tmux and zellij probes key on
 * socket path and socket dir.
 *
 * This used to collapse every environment to the literal string `"default"`,
 * so a caller passing an environment with no herdr on its PATH was served the
 * inventory collected for a completely different environment — nine live
 * sessions from a probe that should have found none. A client-supplied socket
 * path is still never accepted, which is the property the old comment was
 * reaching for; that is achieved by deriving the key from an environment
 * instead of taking one.
 */
export function herdrProbeKey(input?: string | { env?: RuntimeEnv } | null): string {
  if (typeof input === "string") return input.trim() || "default";
  return JSON.stringify(herdrProbeTarget(input?.env ?? process.env));
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

/**
 * Run the listing in the environment the KEY names, not in this process's.
 *
 * The key already encodes the binary, the PATH, and the config home, so
 * rebuilding an environment from it is what makes the cache entry honest: the
 * answer stored under a key is the answer that key's environment produces.
 * Previously the environment a caller supplied was thrown away here and the
 * probe always ran against `process.env`.
 */
async function readHerdrSessionsLocal(key: string, ctx: ProbeCtx): Promise<HerdrSessionInfo[]> {
  const target = parseHerdrProbeKey(key);
  try {
    const { stdout } = await execProbeFile(ctx, target.bin, ["session", "list", "--json"], {
      env: { ...process.env, PATH: target.path, HOME: target.home, XDG_CONFIG_HOME: target.home },
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
  maxKeys: 8,
  idleKeyTtlMs: 5 * 60_000,
  maxConcurrentKeys: 1,
  normalizeKey: herdrProbeKey,
  run: (key, ctx) => {
    // scoutd answers from ITS environment, so it cannot serve a key that names
    // a different one. It does not serve this family today; asking anyway once
    // it does would silently reintroduce the bug this key was widened to fix.
    if (key !== herdrProbeKey(process.env ? { env: process.env } : null)) {
      return readHerdrSessionsLocal(key, ctx).then((value) => probeRunOutput(value, { backend: "local" }));
    }
    return runWithScoutdFallback({
      probeId: "herdr.sessions",
      key,
      ctx,
      local: () => readHerdrSessionsLocal(key, ctx),
    });
  },
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
