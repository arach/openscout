import { spawn } from "node:child_process";
import { lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

import type { DiscoverySnapshot } from "../tail/index.js";

export type RepoWatchHintSource =
  | "agent"
  | "endpoint"
  | "tail-process"
  | "tail-transcript"
  | "environment";

export type RepoWatchAttentionLevel = "critical" | "attention" | "active" | "quiet" | "unknown";

export type RepoWatchPathHint = {
  path: string;
  source: RepoWatchHintSource;
  sourceLabel?: string;
  agentId?: string;
  agentName?: string;
  agentState?: string;
  sessionId?: string;
  harness?: string;
  runtimeSource?: string;
};

export type RepoWatchHintSummary = Omit<RepoWatchPathHint, "path"> & {
  path: string;
};

export type RepoWatchChangedFile = {
  path: string;
  status: string;
};

export type RepoWatchStatusSummary = {
  clean: boolean;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicts: number;
  changedFiles: number;
  files: RepoWatchChangedFile[];
};

export type RepoWatchBranchSummary = {
  name: string | null;
  upstream: string | null;
  head: string | null;
  detached: boolean;
  ahead: number;
  behind: number;
  isMain: boolean;
  diverged: boolean;
};

export type RepoWatchDiffSummary = {
  unstagedShortstat: string | null;
  stagedShortstat: string | null;
};

export type RepoWatchAgentRef = {
  id: string;
  name: string | null;
  state: string | null;
  harness: string | null;
};

export type RepoWatchSessionRef = {
  id: string;
  source: string | null;
  harness: string | null;
};

export type RepoWatchWorktree = {
  id: string;
  path: string;
  name: string;
  isBare: boolean;
  branch: RepoWatchBranchSummary;
  status: RepoWatchStatusSummary;
  diff: RepoWatchDiffSummary;
  attention: RepoWatchAttentionLevel;
  attentionReasons: string[];
  agents: RepoWatchAgentRef[];
  sessions: RepoWatchSessionRef[];
  hints: RepoWatchHintSummary[];
  lastCommitAt: number | null;
  scannedAt: number;
  error: string | null;
};

export type RepoWatchProjectStats = {
  worktrees: number;
  dirtyWorktrees: number;
  conflictedWorktrees: number;
  attachedAgents: number;
  attachedSessions: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicts: number;
};

export type RepoWatchProject = {
  id: string;
  name: string;
  root: string;
  commonGitDir: string;
  attention: RepoWatchAttentionLevel;
  attentionReasons: string[];
  worktrees: RepoWatchWorktree[];
  stats: RepoWatchProjectStats;
  hints: RepoWatchHintSummary[];
};

export type RepoWatchSnapshot = {
  generatedAt: number;
  projects: RepoWatchProject[];
  totals: {
    projects: number;
    worktrees: number;
    dirtyWorktrees: number;
    conflictedWorktrees: number;
    attentionWorktrees: number;
    attachedAgents: number;
    attachedSessions: number;
  };
  warnings: string[];
};

type GitExec = (cwd: string, args: string[]) => Promise<string>;

export type RepoWatchSnapshotOptions = {
  hints?: RepoWatchPathHint[];
  force?: boolean;
  cacheTtlMs?: number;
  scanBudgetMs?: number;
  maxRoots?: number;
  maxWorktrees?: number;
  maxFilesPerWorktree?: number;
  includeDiff?: boolean;
  includeLastCommit?: boolean;
  now?: () => number;
  git?: GitExec;
};

type NormalizedHint = RepoWatchHintSummary;

type GitRoot = {
  topLevel: string;
  commonGitDir: string;
  hints: NormalizedHint[];
};

type ParsedWorktree = {
  path: string;
  head: string | null;
  branch: string | null;
  detached: boolean;
  bare: boolean;
};

type ParsedStatus = {
  branch: RepoWatchBranchSummary;
  status: RepoWatchStatusSummary;
};

const DEFAULT_CACHE_TTL_MS = 2_500;
const DEFAULT_MAX_ROOTS = 8;
const DEFAULT_MAX_WORKTREES = 4;
const DEFAULT_MAX_FILES_PER_WORKTREE = 12;
const DEFAULT_SCAN_BUDGET_MS = 4_000;
const GIT_TIMEOUT_MS = 650;
const GIT_MAX_BUFFER = 1024 * 1024;

let cachedSnapshot: { signature: string; generatedAt: number; snapshot: RepoWatchSnapshot } | null = null;

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  if (!metadata) return null;
  return stringValue(metadata[key]);
}

function expandHome(input: string): string {
  if (input === "~") return homedir();
  if (input.startsWith("~/")) return resolve(homedir(), input.slice(2));
  return input;
}

function normalizePath(input: string): string {
  return resolve(expandHome(input.trim()));
}

function isBroadLocalRootPath(path: string): boolean {
  const home = normalizePath(homedir());
  return path === home
    || path === resolve(home, "dev")
    || path === resolve(home, "Developer")
    || path === dirname(home)
    || path === "/";
}

function isTempLocalPath(path: string): boolean {
  const roots = [
    "/tmp",
    "/private/tmp",
    process.env.TMPDIR ? normalizePath(process.env.TMPDIR) : null,
  ].filter((root): root is string => Boolean(root));
  return roots.some((root) => pathContains(root, path));
}

function shouldIncludeBrokerPath(path: string): boolean {
  const normalized = normalizePath(path);
  return !isBroadLocalRootPath(normalized) && !isTempLocalPath(normalized);
}

function stateRank(state: string | undefined): number {
  switch (state?.toLowerCase()) {
    case "active": return 0;
    case "idle": return 10;
    case "waiting": return 20;
    case "offline": return 200;
    default: return 40;
  }
}

function sourceRank(source: RepoWatchHintSource): number {
  switch (source) {
    case "environment": return -100;
    case "endpoint": return 0;
    case "tail-process": return 10;
    case "tail-transcript": return 20;
    case "agent": return 50;
  }
}

function hintDiscoveryRank(hint: Pick<RepoWatchPathHint, "path" | "source" | "agentState">): number {
  let rank = sourceRank(hint.source) + stateRank(hint.agentState);
  if (isBroadLocalRootPath(hint.path)) rank += 300;
  if (isTempLocalPath(hint.path)) rank += 200;
  return rank;
}

function hashId(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function pathContains(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function uniqueBy<T>(items: T[], keyFor: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyFor(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

async function defaultGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const killTimer = (setTimeout(() => {
      terminate();
      fail(new Error(`git ${args.join(" ")} timed out after ${GIT_TIMEOUT_MS}ms`));
    }, GIT_TIMEOUT_MS));
    killTimer.unref?.();

    function terminate(): void {
      child.kill("SIGTERM");
      const hardKillTimer = setTimeout(() => child.kill("SIGKILL"), 250);
      hardKillTimer.unref?.();
    }

    function cleanup(): void {
      clearTimeout(killTimer);
    }

    function fail(error: Error): void {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }

    function succeed(output: string): void {
      if (settled) return;
      settled = true;
      cleanup();
      resolvePromise(output);
    }

    function append(kind: "stdout" | "stderr", chunk: unknown): void {
      const text = typeof chunk === "string" ? chunk : String(chunk);
      if (kind === "stdout") stdout += text;
      else stderr += text;
      if (stdout.length + stderr.length > GIT_MAX_BUFFER) {
        terminate();
        fail(new Error(`git ${args.join(" ")} exceeded output limit`));
      }
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    child.on("error", (error) => fail(error));
    child.on("close", (code, signal) => {
      if (code === 0) {
        succeed(stdout);
        return;
      }
      const detail = (stderr || `git exited with ${signal ?? code ?? "unknown status"}`).trim();
      fail(new Error(detail));
    });
  });
}

async function existingDirectoryForPath(path: string): Promise<string | null> {
  try {
    const stats = await lstat(path);
    if (stats.isDirectory()) return path;
    if (stats.isFile()) return dirname(path);
    return null;
  } catch {
    return null;
  }
}

function environmentHints(): RepoWatchPathHint[] {
  const raw = process.env.OPENSCOUT_REPO_WATCH_ROOTS?.trim();
  if (!raw) return [];
  return raw
    .split(/[,:]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((path) => ({
      path,
      source: "environment" as const,
      sourceLabel: "OPENSCOUT_REPO_WATCH_ROOTS",
    }));
}

function normalizeHints(hints: RepoWatchPathHint[]): NormalizedHint[] {
  const normalized = uniqueBy(
    hints
      .filter((hint) => hint.path.trim())
      .map((hint) => ({
        ...hint,
        path: normalizePath(hint.path),
      })),
    (hint) => [
      hint.path,
      hint.source,
      hint.agentId ?? "",
      hint.sessionId ?? "",
      hint.runtimeSource ?? "",
      hint.harness ?? "",
    ].join("\u0000"),
  );
  return normalized.sort((left, right) => {
    const rankDelta = hintDiscoveryRank(left) - hintDiscoveryRank(right);
    if (rankDelta !== 0) return rankDelta;
    return left.path.localeCompare(right.path);
  });
}

function groupHintsByPath(hints: NormalizedHint[]): Array<{ path: string; hints: NormalizedHint[] }> {
  const groups = new Map<string, NormalizedHint[]>();
  for (const hint of hints) {
    const group = groups.get(hint.path);
    if (group) {
      group.push(hint);
    } else {
      groups.set(hint.path, [hint]);
    }
  }
  return [...groups.entries()].map(([path, groupedHints]) => ({ path, hints: groupedHints }));
}

function budgetExceeded(deadlineMs: number | null): boolean {
  return deadlineMs !== null && Date.now() >= deadlineMs;
}

async function discoverGitRoots(hints: NormalizedHint[], git: GitExec, maxRoots: number, deadlineMs: number | null): Promise<{
  roots: GitRoot[];
  warnings: string[];
}> {
  const warnings: string[] = [];
  const roots = new Map<string, GitRoot>();
  const groups = groupHintsByPath(hints);
  let truncatedByBudget = false;
  let truncatedByMax = false;

  for (const group of groups) {
    if (budgetExceeded(deadlineMs)) {
      truncatedByBudget = true;
      break;
    }
    if (roots.size >= maxRoots) {
      truncatedByMax = true;
      break;
    }

    const dir = await existingDirectoryForPath(group.path);
    if (!dir) {
      warnings.push(`Skipped missing repo-watch path: ${group.path}`);
      continue;
    }

    let topLevel: string;
    try {
      topLevel = normalizePath((await git(dir, ["rev-parse", "--show-toplevel"])).trim());
    } catch {
      continue;
    }

    let commonGitDir = topLevel;
    try {
      const rawCommon = (await git(topLevel, ["rev-parse", "--git-common-dir"])).trim();
      commonGitDir = normalizePath(isAbsolute(rawCommon) ? rawCommon : resolve(topLevel, rawCommon));
    } catch {
      warnings.push(`Could not resolve Git common directory for ${topLevel}`);
    }

    const existing = roots.get(commonGitDir);
    if (existing) {
      existing.hints.push(...group.hints);
    } else if (roots.size < maxRoots) {
      roots.set(commonGitDir, { topLevel, commonGitDir, hints: [...group.hints] });
    }
  }

  if (truncatedByMax) {
    warnings.push(`Repo Watch limited discovery to ${maxRoots} repositories.`);
  }
  if (truncatedByBudget) {
    warnings.push("Repo Watch stopped discovery after reaching the scan budget.");
  }

  return {
    roots: [...roots.values()].map((root) => ({
      ...root,
      hints: uniqueBy(root.hints, (hint) => [
        hint.path,
        hint.source,
        hint.agentId ?? "",
        hint.sessionId ?? "",
      ].join("\u0000")),
    })),
    warnings,
  };
}

export function parseGitWorktreeList(output: string): ParsedWorktree[] {
  const worktrees: ParsedWorktree[] = [];
  let current: Partial<ParsedWorktree> | null = null;

  const flush = () => {
    if (!current?.path) return;
    worktrees.push({
      path: normalizePath(current.path),
      head: current.head ?? null,
      branch: current.branch ?? null,
      detached: current.detached ?? current.branch == null,
      bare: current.bare ?? false,
    });
    current = null;
  };

  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) {
      flush();
      continue;
    }
    const [key, ...rest] = line.split(" ");
    const value = rest.join(" ").trim();
    if (key === "worktree") {
      flush();
      current = { path: value };
    } else if (current && key === "HEAD") {
      current.head = value || null;
    } else if (current && key === "branch") {
      current.branch = value.replace(/^refs\/heads\//, "") || null;
    } else if (current && key === "detached") {
      current.detached = true;
    } else if (current && key === "bare") {
      current.bare = true;
    }
  }
  flush();
  return worktrees;
}

function blankStatus(): RepoWatchStatusSummary {
  return {
    clean: true,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicts: 0,
    changedFiles: 0,
    files: [],
  };
}

function extractStatusPath(line: string): string {
  if (line.startsWith("? ")) return line.slice(2).trim();
  if (line.startsWith("u ")) {
    return line.split(" ").slice(10).join(" ").trim();
  }
  if (line.startsWith("2 ")) {
    const primary = line.split("\t")[0] ?? line;
    return primary.split(" ").slice(9).join(" ").trim();
  }
  if (line.startsWith("1 ")) {
    return line.split(" ").slice(8).join(" ").trim();
  }
  return "";
}

function pushChangedFile(status: RepoWatchStatusSummary, path: string, label: string, maxFiles: number): void {
  status.changedFiles += 1;
  if (status.files.length >= maxFiles) return;
  status.files.push({ path: path || "unknown", status: label });
}

export function parseGitStatusPorcelainV2(
  output: string,
  options?: { maxFiles?: number },
): ParsedStatus {
  const maxFiles = options?.maxFiles ?? DEFAULT_MAX_FILES_PER_WORKTREE;
  const status = blankStatus();
  let head: string | null = null;
  let branchName: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;

  for (const line of output.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith("# branch.oid ")) {
      const value = line.slice("# branch.oid ".length).trim();
      head = value && value !== "(initial)" ? value : null;
      continue;
    }
    if (line.startsWith("# branch.head ")) {
      const value = line.slice("# branch.head ".length).trim();
      branchName = value && value !== "(detached)" ? value : null;
      continue;
    }
    if (line.startsWith("# branch.upstream ")) {
      upstream = line.slice("# branch.upstream ".length).trim() || null;
      continue;
    }
    if (line.startsWith("# branch.ab ")) {
      const match = line.match(/\+(\d+)\s+-(\d+)/);
      ahead = match?.[1] ? Number.parseInt(match[1], 10) : 0;
      behind = match?.[2] ? Number.parseInt(match[2], 10) : 0;
      continue;
    }

    if (line.startsWith("? ")) {
      status.untracked += 1;
      pushChangedFile(status, extractStatusPath(line), "untracked", maxFiles);
      continue;
    }

    if (line.startsWith("u ")) {
      status.conflicts += 1;
      pushChangedFile(status, extractStatusPath(line), "conflict", maxFiles);
      continue;
    }

    if (line.startsWith("1 ") || line.startsWith("2 ")) {
      const xy = line.slice(2, 4);
      const staged = xy[0] && xy[0] !== ".";
      const unstaged = xy[1] && xy[1] !== ".";
      if (staged) status.staged += 1;
      if (unstaged) status.unstaged += 1;
      const label = [
        staged ? "staged" : null,
        unstaged ? "unstaged" : null,
      ].filter(Boolean).join("+") || "changed";
      pushChangedFile(status, extractStatusPath(line), label, maxFiles);
    }
  }

  status.clean = status.staged === 0
    && status.unstaged === 0
    && status.untracked === 0
    && status.conflicts === 0;

  const isMain = branchName === "main" || branchName === "master";
  return {
    branch: {
      name: branchName,
      upstream,
      head,
      detached: branchName == null,
      ahead,
      behind,
      isMain,
      diverged: ahead > 0 && behind > 0,
    },
    status,
  };
}

function attentionRank(level: RepoWatchAttentionLevel): number {
  switch (level) {
    case "critical": return 4;
    case "attention": return 3;
    case "active": return 2;
    case "quiet": return 1;
    case "unknown": return 0;
  }
}

function maxAttention(levels: RepoWatchAttentionLevel[]): RepoWatchAttentionLevel {
  return levels.reduce<RepoWatchAttentionLevel>((best, candidate) => (
    attentionRank(candidate) > attentionRank(best) ? candidate : best
  ), "unknown");
}

function classifyWorktree(input: {
  status: RepoWatchStatusSummary;
  branch: RepoWatchBranchSummary;
  agents: RepoWatchAgentRef[];
  sessions: RepoWatchSessionRef[];
  error: string | null;
}): { attention: RepoWatchAttentionLevel; reasons: string[] } {
  const reasons: string[] = [];
  if (input.error) {
    return { attention: "attention", reasons: [input.error] };
  }
  if (input.status.conflicts > 0) {
    reasons.push(`${input.status.conflicts} conflicted file${input.status.conflicts === 1 ? "" : "s"}`);
    return { attention: "critical", reasons };
  }
  if (input.branch.isMain && !input.status.clean) {
    reasons.push(`Dirty ${input.branch.name}`);
  }
  if (input.branch.diverged) {
    reasons.push(`Diverged from ${input.branch.upstream ?? "upstream"}`);
  }
  if (reasons.length > 0) {
    return { attention: "attention", reasons };
  }
  if (!input.status.clean) {
    reasons.push(`${input.status.changedFiles} changed file${input.status.changedFiles === 1 ? "" : "s"}`);
  }
  if (input.branch.ahead > 0) {
    reasons.push(`${input.branch.ahead} ahead`);
  }
  if (input.branch.behind > 0) {
    reasons.push(`${input.branch.behind} behind`);
  }
  if (input.agents.length > 0 || input.sessions.length > 0) {
    reasons.push("Scout activity attached");
  }
  if (reasons.length > 0) {
    return { attention: "active", reasons };
  }
  return { attention: "quiet", reasons: [] };
}

async function safeGit(git: GitExec, cwd: string, args: string[]): Promise<string | null> {
  try {
    return await git(cwd, args);
  } catch {
    return null;
  }
}

function refsForHints(hints: NormalizedHint[]): {
  agents: RepoWatchAgentRef[];
  sessions: RepoWatchSessionRef[];
} {
  const agents = uniqueBy(
    hints
      .filter((hint) => hint.agentId)
      .map((hint) => ({
        id: hint.agentId!,
        name: hint.agentName ?? null,
        state: hint.agentState ?? null,
        harness: hint.harness ?? hint.runtimeSource ?? null,
      })),
    (agent) => agent.id,
  );

  const sessions = uniqueBy(
    hints
      .filter((hint) => hint.sessionId)
      .map((hint) => ({
        id: hint.sessionId!,
        source: hint.runtimeSource ?? null,
        harness: hint.harness ?? null,
      })),
    (session) => session.id,
  );

  return { agents, sessions };
}

async function scanWorktree(
  worktree: ParsedWorktree,
  hints: NormalizedHint[],
  git: GitExec,
  now: number,
  options: {
    maxFiles: number;
    includeDiff: boolean;
    includeLastCommit: boolean;
  },
): Promise<RepoWatchWorktree> {
  const statusOutput = await safeGit(git, worktree.path, ["status", "--porcelain=v2", "--branch", "-unormal"]);
  const parsed = statusOutput
    ? parseGitStatusPorcelainV2(statusOutput, { maxFiles: options.maxFiles })
    : {
      branch: {
        name: worktree.branch,
        upstream: null,
        head: worktree.head,
        detached: worktree.detached,
        ahead: 0,
        behind: 0,
        isMain: worktree.branch === "main" || worktree.branch === "master",
        diverged: false,
      },
      status: blankStatus(),
    };

  const branch: RepoWatchBranchSummary = {
    ...parsed.branch,
    name: parsed.branch.name ?? worktree.branch,
    head: parsed.branch.head ?? worktree.head,
    detached: parsed.branch.name == null && worktree.branch == null,
    isMain: (parsed.branch.name ?? worktree.branch) === "main" || (parsed.branch.name ?? worktree.branch) === "master",
  };
  const [unstagedDiff, stagedDiff] = options.includeDiff
    ? await Promise.all([
      safeGit(git, worktree.path, ["diff", "--shortstat"]),
      safeGit(git, worktree.path, ["diff", "--cached", "--shortstat"]),
    ])
    : [null, null];
  const lastCommitRaw = options.includeLastCommit
    ? await safeGit(git, worktree.path, ["log", "-1", "--format=%ct"])
    : null;
  const refs = refsForHints(hints);
  const error = statusOutput ? null : "Could not read Git status";
  const classified = classifyWorktree({
    status: parsed.status,
    branch,
    agents: refs.agents,
    sessions: refs.sessions,
    error,
  });
  const lastCommitSeconds = Number.parseInt(lastCommitRaw?.trim() ?? "", 10);

  return {
    id: `worktree:${hashId(worktree.path)}`,
    path: worktree.path,
    name: basename(worktree.path) || worktree.path,
    isBare: worktree.bare,
    branch,
    status: parsed.status,
    diff: {
      unstagedShortstat: unstagedDiff?.trim() || null,
      stagedShortstat: stagedDiff?.trim() || null,
    },
    attention: classified.attention,
    attentionReasons: classified.reasons,
    agents: refs.agents,
    sessions: refs.sessions,
    hints,
    lastCommitAt: Number.isFinite(lastCommitSeconds) ? lastCommitSeconds * 1_000 : null,
    scannedAt: now,
    error,
  };
}

function statsForProject(worktrees: RepoWatchWorktree[]): RepoWatchProjectStats {
  const agentIds = new Set<string>();
  const sessionIds = new Set<string>();
  for (const worktree of worktrees) {
    worktree.agents.forEach((agent) => agentIds.add(agent.id));
    worktree.sessions.forEach((session) => sessionIds.add(session.id));
  }
  return {
    worktrees: worktrees.length,
    dirtyWorktrees: worktrees.filter((worktree) => !worktree.status.clean).length,
    conflictedWorktrees: worktrees.filter((worktree) => worktree.status.conflicts > 0).length,
    attachedAgents: agentIds.size,
    attachedSessions: sessionIds.size,
    staged: worktrees.reduce((sum, worktree) => sum + worktree.status.staged, 0),
    unstaged: worktrees.reduce((sum, worktree) => sum + worktree.status.unstaged, 0),
    untracked: worktrees.reduce((sum, worktree) => sum + worktree.status.untracked, 0),
    conflicts: worktrees.reduce((sum, worktree) => sum + worktree.status.conflicts, 0),
  };
}

async function scanProject(
  root: GitRoot,
  git: GitExec,
  now: number,
  maxWorktrees: number,
  options: {
    maxFiles: number;
    includeDiff: boolean;
    includeLastCommit: boolean;
    deadlineMs: number | null;
  },
): Promise<{ project: RepoWatchProject; warnings: string[] }> {
  const warnings: string[] = [];
  const rawWorktrees = await safeGit(git, root.topLevel, ["worktree", "list", "--porcelain"]);
  const parsedWorktrees = rawWorktrees
    ? parseGitWorktreeList(rawWorktrees)
    : [{ path: root.topLevel, head: null, branch: null, detached: false, bare: false }];
  const orderedWorktrees = [...parsedWorktrees].sort((left, right) => {
    const leftRank = Math.min(
      ...root.hints
        .filter((hint) => pathContains(left.path, hint.path))
        .map((hint) => hintDiscoveryRank(hint)),
      100,
    );
    const rightRank = Math.min(
      ...root.hints
        .filter((hint) => pathContains(right.path, hint.path))
        .map((hint) => hintDiscoveryRank(hint)),
      100,
    );
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.path.localeCompare(right.path);
  });
  const limitedWorktrees = orderedWorktrees.slice(0, maxWorktrees);
  if (parsedWorktrees.length > limitedWorktrees.length) {
    warnings.push(`Repo Watch limited ${root.topLevel} to ${maxWorktrees} worktrees.`);
  }
  const worktrees: RepoWatchWorktree[] = [];
  for (const worktree of limitedWorktrees) {
    if (budgetExceeded(options.deadlineMs)) {
      warnings.push(`Repo Watch stopped scanning ${root.topLevel} after reaching the scan budget.`);
      break;
    }
    const matchedHints = root.hints.filter((hint) => pathContains(worktree.path, hint.path));
    const hints = matchedHints.length > 0 || worktree.path !== root.topLevel
      ? matchedHints
      : root.hints;
    const scanned = await scanWorktree(worktree, hints, git, now, options);
    // Drop worktrees we can't actually read — stale `git worktree list`
    // registrations whose dir was deleted (ephemeral /tmp or cache builds), or
    // otherwise unreadable. They surface as "SCAN ERR" noise with no signal.
    if (scanned.error != null) {
      warnings.push(`Repo Watch skipped unreadable worktree ${worktree.path}.`);
      continue;
    }
    worktrees.push(scanned);
  }
  const stats = statsForProject(worktrees);
  const attention = maxAttention(worktrees.map((worktree) => worktree.attention));
  const attentionReasons = uniqueBy(
    worktrees.flatMap((worktree) => worktree.attentionReasons),
    (reason) => reason,
  ).slice(0, 6);
  const rootPath = worktrees[0]?.path ?? root.topLevel;

  return {
    project: {
    id: `repo:${hashId(root.commonGitDir)}`,
    name: basename(rootPath) || basename(root.commonGitDir) || rootPath,
    root: rootPath,
    commonGitDir: root.commonGitDir,
    attention,
    attentionReasons,
    worktrees,
    stats,
    hints: root.hints,
    },
    warnings,
  };
}

function totalsForProjects(projects: RepoWatchProject[]): RepoWatchSnapshot["totals"] {
  const agentIds = new Set<string>();
  const sessionIds = new Set<string>();
  let worktrees = 0;
  let dirtyWorktrees = 0;
  let conflictedWorktrees = 0;
  let attentionWorktrees = 0;
  for (const project of projects) {
    worktrees += project.worktrees.length;
    dirtyWorktrees += project.stats.dirtyWorktrees;
    conflictedWorktrees += project.stats.conflictedWorktrees;
    attentionWorktrees += project.worktrees.filter((worktree) =>
      worktree.attention === "critical" || worktree.attention === "attention",
    ).length;
    project.worktrees.forEach((worktree) => {
      worktree.agents.forEach((agent) => agentIds.add(agent.id));
      worktree.sessions.forEach((session) => sessionIds.add(session.id));
    });
  }
  return {
    projects: projects.length,
    worktrees,
    dirtyWorktrees,
    conflictedWorktrees,
    attentionWorktrees,
    attachedAgents: agentIds.size,
    attachedSessions: sessionIds.size,
  };
}

type RepoWatchSnapshotCacheShape = {
  includeDiff: boolean;
  includeLastCommit: boolean;
  maxFiles: number;
  maxRoots: number;
  maxWorktrees: number;
  scanBudgetMs: number;
};

function snapshotSignature(hints: NormalizedHint[], shape: RepoWatchSnapshotCacheShape): string {
  const shapeSignature = [
    shape.includeDiff ? "diff:1" : "diff:0",
    shape.includeLastCommit ? "commit:1" : "commit:0",
    `maxFiles:${shape.maxFiles}`,
    `maxRoots:${shape.maxRoots}`,
    `maxWorktrees:${shape.maxWorktrees}`,
    `scanBudgetMs:${shape.scanBudgetMs}`,
  ].join("\u0000");
  const hintSignature = hints
    .map((hint) => [
      hint.path,
      hint.source,
      hint.agentId ?? "",
      hint.sessionId ?? "",
      hint.runtimeSource ?? "",
    ].join("\u0000"))
    .sort()
    .join("\u0001");
  return `${shapeSignature}\u0002${hintSignature}`;
}

export async function getRepoWatchSnapshot(options: RepoWatchSnapshotOptions = {}): Promise<RepoWatchSnapshot> {
  const now = options.now?.() ?? Date.now();
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const maxRoots = options.maxRoots ?? readPositiveIntEnv("OPENSCOUT_REPO_WATCH_MAX_ROOTS", DEFAULT_MAX_ROOTS);
  const maxWorktrees = options.maxWorktrees ?? readPositiveIntEnv("OPENSCOUT_REPO_WATCH_MAX_WORKTREES", DEFAULT_MAX_WORKTREES);
  const maxFiles = options.maxFilesPerWorktree ?? readPositiveIntEnv(
    "OPENSCOUT_REPO_WATCH_MAX_FILES_PER_WORKTREE",
    DEFAULT_MAX_FILES_PER_WORKTREE,
  );
  const scanBudgetMs = options.scanBudgetMs ?? readPositiveIntEnv(
    "OPENSCOUT_REPO_WATCH_SCAN_BUDGET_MS",
    DEFAULT_SCAN_BUDGET_MS,
  );
  const deadlineMs = scanBudgetMs > 0 ? Date.now() + scanBudgetMs : null;
  const git = options.git ?? defaultGit;
  const hints = normalizeHints([
    ...environmentHints(),
    ...(options.hints ?? []),
  ]);
  const includeDiff = options.includeDiff ?? false;
  const includeLastCommit = options.includeLastCommit ?? false;
  const signature = snapshotSignature(hints, {
    includeDiff,
    includeLastCommit,
    maxFiles,
    maxRoots,
    maxWorktrees,
    scanBudgetMs,
  });

  if (!options.force
    && cachedSnapshot
    && cachedSnapshot.signature === signature
    && now - cachedSnapshot.generatedAt <= cacheTtlMs) {
    return cachedSnapshot.snapshot;
  }

  const discovered = await discoverGitRoots(hints, git, maxRoots, deadlineMs);
  const projects: RepoWatchProject[] = [];
  const warnings = [...discovered.warnings];
  for (const root of discovered.roots) {
    if (budgetExceeded(deadlineMs)) {
      warnings.push("Repo Watch stopped scanning repositories after reaching the scan budget.");
      break;
    }
    const result = await scanProject(root, git, now, maxWorktrees, {
      maxFiles,
      includeDiff,
      includeLastCommit,
      deadlineMs,
    });
    // A project whose only worktrees were unreadable (all skipped) is itself
    // stale — don't surface an empty shell.
    if (result.project.worktrees.length > 0) {
      projects.push(result.project);
    }
    warnings.push(...result.warnings);
  }
  projects.sort((left, right) => {
    const attentionDelta = attentionRank(right.attention) - attentionRank(left.attention);
    if (attentionDelta !== 0) return attentionDelta;
    return left.name.localeCompare(right.name);
  });

  const snapshot: RepoWatchSnapshot = {
    generatedAt: now,
    projects,
    totals: totalsForProjects(projects),
    warnings,
  };
  cachedSnapshot = { signature, generatedAt: now, snapshot };
  return snapshot;
}

export function repoWatchHintsFromBrokerSnapshot(snapshot: {
  agents?: Record<string, {
    id?: string;
    displayName?: string;
    handle?: string;
    metadata?: Record<string, unknown>;
  }>;
  endpoints?: Record<string, {
    id?: string;
    agentId?: string;
    harness?: string;
    transport?: string;
    state?: string;
    sessionId?: string;
    cwd?: string;
    projectRoot?: string;
    metadata?: Record<string, unknown>;
  }>;
} | null | undefined): RepoWatchPathHint[] {
  if (!snapshot) return [];
  const hints: RepoWatchPathHint[] = [];
  const agentsWithEndpointHints = new Set<string>();
  for (const endpoint of Object.values(snapshot.endpoints ?? {})) {
    const endpointState = endpoint.state?.toLowerCase();
    if (endpointState === "offline" || endpointState === "stale" || endpointState === "retired") continue;
    const path = endpoint.projectRoot ?? endpoint.cwd ?? metadataString(endpoint.metadata, "projectRoot");
    if (!path || !shouldIncludeBrokerPath(path)) continue;
    const agent = endpoint.agentId ? snapshot.agents?.[endpoint.agentId] : undefined;
    if (endpoint.agentId) agentsWithEndpointHints.add(endpoint.agentId);
    hints.push({
      path,
      source: "endpoint",
      sourceLabel: endpoint.id ? `endpoint:${endpoint.id}` : "endpoint",
      agentId: endpoint.agentId,
      agentName: agent?.displayName ?? agent?.handle ?? endpoint.agentId,
      agentState: endpoint.state,
      sessionId: endpoint.sessionId,
      harness: endpoint.harness ?? endpoint.transport,
      runtimeSource: endpoint.transport,
    });
  }
  for (const [agentId, agent] of Object.entries(snapshot.agents ?? {})) {
    if (agentsWithEndpointHints.has(agentId)) continue;
    const path = metadataString(agent.metadata, "projectRoot")
      ?? metadataString(agent.metadata, "cwd")
      ?? metadataString(agent.metadata, "workspaceRoot");
    if (!path || !shouldIncludeBrokerPath(path)) continue;
    hints.push({
      path,
      source: "agent",
      sourceLabel: `agent:${agentId}`,
      agentId,
      agentName: agent.displayName ?? agent.handle ?? agentId,
    });
  }
  return hints;
}

export function repoWatchHintsFromTailDiscovery(discovery: DiscoverySnapshot | null | undefined): RepoWatchPathHint[] {
  if (!discovery) return [];
  const hints: RepoWatchPathHint[] = [];
  for (const process of discovery.processes ?? []) {
    if (!process.cwd) continue;
    hints.push({
      path: process.cwd,
      source: "tail-process",
      sourceLabel: `pid:${process.pid}`,
      harness: process.harness,
      runtimeSource: process.source,
    });
  }
  for (const transcript of discovery.transcripts ?? []) {
    if (!transcript.cwd) continue;
    hints.push({
      path: transcript.cwd,
      source: "tail-transcript",
      sourceLabel: transcript.transcriptPath,
      sessionId: transcript.sessionId ?? undefined,
      harness: transcript.harness,
      runtimeSource: transcript.source,
    });
  }
  return hints;
}
