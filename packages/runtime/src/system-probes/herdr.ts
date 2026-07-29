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

function herdrBin(env: RuntimeEnv = process.env): string {
  return env.OPENSCOUT_HERDR_BIN?.trim() || "herdr";
}

function isUnavailable(error: unknown): boolean {
  return error instanceof ProbeCommandError
    && (error.code === "ENOENT" || error.code === "spawn" || error.code === "exit");
}

export function herdrProbeKey(input?: string | { env?: RuntimeEnv } | null): string {
  if (typeof input === "string") return input.trim() || "default";
  // One inventory per environment; no client-supplied socket path.
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
