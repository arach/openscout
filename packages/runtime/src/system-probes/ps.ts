import { defineProbe, defineProbeFamily, type ProbeCtx } from "./registry.js";
import { execProbeFile, ProbeCommandError } from "./exec.js";

const PS_TTL_MS = 5_000;
const PS_TIMEOUT_MS = 1_500;

export type ProcessRow = {
  pid: number;
  ppid: number;
  pgid: number;
  comm: string;
  tty: string | null;
};

export type ProcessCommandRow = ProcessRow & {
  command: string;
};

export type PsRuntimeSnapshot = {
  rows: ProcessRow[];
  commandRows: ProcessCommandRow[];
};

function parseProcessNumber(value: string | undefined): number | null {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeTty(value: string | null | undefined): string | null {
  const normalized = value?.replace(/^\/dev\//u, "").trim();
  if (!normalized || normalized === "??" || normalized === "?") return null;
  return normalized;
}

function isUnavailable(error: unknown): boolean {
  return error instanceof ProbeCommandError
    && (error.code === "ENOENT" || error.code === "spawn" || error.code === "exit");
}

function parseRows(output: string): ProcessRow[] {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/u);
      const pid = parseProcessNumber(parts[0]);
      const ppid = parseProcessNumber(parts[1]);
      const pgid = parseProcessNumber(parts[2]);
      const tty = normalizeTty(parts[3]);
      const comm = parts.slice(4).join(" ");
      return pid && ppid && pgid && comm ? { pid, ppid, pgid, tty, comm } : null;
    })
    .filter((row): row is ProcessRow => Boolean(row));
}

function parseCommandRows(output: string): ProcessCommandRow[] {
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/u);
      const pid = parseProcessNumber(parts[0]);
      const ppid = parseProcessNumber(parts[1]);
      const pgid = parseProcessNumber(parts[2]);
      const tty = normalizeTty(parts[3]);
      const command = parts.slice(4).join(" ");
      const comm = command.split(/\s+/u)[0] ?? "";
      return pid && ppid && pgid && comm && command
        ? { pid, ppid, pgid, tty, comm, command }
        : null;
    })
    .filter((row): row is ProcessCommandRow => Boolean(row));
}

async function readPsRuntimeLocal(ctx: ProbeCtx): Promise<PsRuntimeSnapshot> {
  try {
    const [rows, commandRows] = await Promise.all([
      execProbeFile(ctx, "ps", ["-axo", "pid=,ppid=,pgid=,tty=,comm="], {
        maxStdoutBytes: 4 * 1024 * 1024,
        maxStderrBytes: 128 * 1024,
      }),
      execProbeFile(ctx, "ps", ["-axo", "pid=,ppid=,pgid=,tty=,command="], {
        maxStdoutBytes: 8 * 1024 * 1024,
        maxStderrBytes: 128 * 1024,
      }),
    ]);
    return {
      rows: parseRows(rows.stdout),
      commandRows: parseCommandRows(commandRows.stdout),
    };
  } catch (error) {
    if (isUnavailable(error)) {
      return { rows: [], commandRows: [] };
    }
    throw error;
  }
}

export const psRuntimeProbe = defineProbe<PsRuntimeSnapshot>({
  id: "ps.runtime",
  ttlMs: PS_TTL_MS,
  timeoutMs: PS_TIMEOUT_MS,
  run: readPsRuntimeLocal,
});

export async function readProcessRowsForTty(tty: string, maxAgeMs = PS_TTL_MS): Promise<ProcessRow[]> {
  const target = normalizeTty(tty);
  if (!target) return [];
  const snapshot = await psRuntimeProbe.fresh({ maxAgeMs });
  return (snapshot.value?.rows ?? []).filter((row) => row.tty === target);
}

export async function readAllProcessRows(maxAgeMs = PS_TTL_MS): Promise<ProcessRow[]> {
  const snapshot = await psRuntimeProbe.fresh({ maxAgeMs });
  return snapshot.value?.rows ?? [];
}

export async function readAllProcessCommandRows(maxAgeMs = PS_TTL_MS): Promise<ProcessCommandRow[]> {
  const snapshot = await psRuntimeProbe.fresh({ maxAgeMs });
  return snapshot.value?.commandRows ?? [];
}

export async function readProcessField(pid: number, field: "command" | "ppid", maxAgeMs = PS_TTL_MS): Promise<string | null> {
  const snapshot = await psRuntimeProbe.fresh({ maxAgeMs });
  const row = snapshot.value?.commandRows.find((candidate) => candidate.pid === pid);
  if (!row) return null;
  if (field === "command") return row.command;
  return String(row.ppid);
}

export async function pgrepCommand(pattern: RegExp, maxAgeMs = PS_TTL_MS): Promise<ProcessCommandRow[]> {
  const rows = await readAllProcessCommandRows(maxAgeMs);
  return rows.filter((row) => pattern.test(row.command));
}

export const processCwdProbe = defineProbeFamily<number | string, string | null>({
  id: "ps.cwd",
  ttlMs: PS_TTL_MS,
  timeoutMs: 1_500,
  maxKeys: 256,
  idleKeyTtlMs: 2 * 60_000,
  maxConcurrentKeys: 4,
  normalizeKey: (pid) => String(pid).trim(),
  run: async (key, ctx) => {
    const pid = Number.parseInt(key, 10);
    if (!Number.isFinite(pid) || pid <= 0) return null;
    try {
      const { stdout } = await execProbeFile(ctx, "lsof", [
        "-a",
        "-p",
        String(pid),
        "-d",
        "cwd",
        "-Fn",
      ], {
        maxStdoutBytes: 64 * 1024,
        maxStderrBytes: 64 * 1024,
      });
      for (const line of stdout.split(/\r?\n/u)) {
        if (!line.startsWith("n")) continue;
        const value = line.slice(1).trim();
        if (value) return value;
      }
      return null;
    } catch (error) {
      if (isUnavailable(error)) return null;
      throw error;
    }
  },
});

export async function readProcessCwd(pid: number, maxAgeMs = PS_TTL_MS): Promise<string | null> {
  const snapshot = await processCwdProbe.for(pid).fresh({ maxAgeMs });
  return snapshot.value ?? null;
}
