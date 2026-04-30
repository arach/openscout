import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { DiscoveredProcess, TailAttribution } from "./types";

const execFileAsync = promisify(execFile);

const PARENT_HOP_LIMIT = 10;

export type RawProcess = {
  pid: number;
  ppid: number;
  etime: string;
  command: string;
};

export async function listProcesses(): Promise<RawProcess[]> {
  const { stdout } = await execFileAsync("ps", ["-axww", "-o", "pid=,ppid=,etime=,command="], {
    maxBuffer: 32 * 1024 * 1024,
  });
  const lines = stdout.split("\n");
  const out: RawProcess[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!match) continue;
    const pid = Number.parseInt(match[1], 10);
    const ppid = Number.parseInt(match[2], 10);
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
    out.push({ pid, ppid, etime: match[3], command: match[4] });
  }
  return out;
}

export function commandBasename(command: string): string {
  const firstToken = command.split(/\s+/)[0] ?? "";
  const slashIdx = firstToken.lastIndexOf("/");
  return slashIdx >= 0 ? firstToken.slice(slashIdx + 1) : firstToken;
}

export function isClaudeBinary(command: string): boolean {
  const base = commandBasename(command);
  if (base === "claude") return true;
  if (base.startsWith("claude ")) return true;
  // Reject anything else even if "claude" appears in args (e.g. helpers).
  return false;
}

export async function readCwd(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
      maxBuffer: 1 * 1024 * 1024,
    });
    for (const line of stdout.split("\n")) {
      if (line.startsWith("n")) {
        const value = line.slice(1).trim();
        if (value) return value;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function classifyAttribution(parentChain: { command: string }[]): TailAttribution {
  for (const ancestor of parentChain) {
    const cmd = ancestor.command.toLowerCase();
    if (cmd.includes("/openscout") || cmd.includes("openscout/") || cmd.includes("packages/runtime")) {
      return "scout-managed";
    }
    if (cmd.includes("/hudson") || cmd.includes("dev/hudson") || cmd.includes("hudson/")) {
      return "hudson-managed";
    }
  }
  return "unattributed";
}

/** @deprecated Use classifyAttribution. */
export const classifyHarness = classifyAttribution;

export function buildParentChain(
  startPid: number,
  byPid: Map<number, RawProcess>,
): { pid: number; command: string }[] {
  const chain: { pid: number; command: string }[] = [];
  let cursor = byPid.get(startPid)?.ppid ?? 0;
  let hops = 0;
  const seen = new Set<number>();
  while (cursor > 1 && hops < PARENT_HOP_LIMIT && !seen.has(cursor)) {
    seen.add(cursor);
    const parent = byPid.get(cursor);
    if (!parent) break;
    chain.push({ pid: parent.pid, command: parent.command });
    cursor = parent.ppid;
    hops++;
  }
  return chain;
}

export async function discoverClaudeProcesses(): Promise<DiscoveredProcess[]> {
  const all = await listProcesses();
  const byPid = new Map<number, RawProcess>();
  for (const proc of all) byPid.set(proc.pid, proc);

  const claudes = all.filter((p) => isClaudeBinary(p.command));
  const out: DiscoveredProcess[] = [];

  await Promise.all(
    claudes.map(async (proc) => {
      const cwd = await readCwd(proc.pid);
      const parentChain = buildParentChain(proc.pid, byPid);
      const harness = classifyAttribution(parentChain);
      out.push({
        pid: proc.pid,
        ppid: proc.ppid,
        command: proc.command,
        etime: proc.etime,
        cwd,
        harness,
        parentChain,
        source: "claude",
      });
    }),
  );

  out.sort((a, b) => a.pid - b.pid);
  return out;
}
