import { defineProbeFamily, type ProbeCtx } from "./registry.js";
import { execProbeFile, ProbeCommandError } from "./exec.js";
import { canonicalRepoRoot } from "./git-build-info.js";

export type GitRepoStatusCommandKey = {
  repoRoot: string;
  args: readonly string[];
  maxStdoutBytes?: number;
};

export type GitRepoStatusCommandResult = {
  repoRoot: string;
  args: string[];
  stdout: string;
};

const GIT_REPO_STATUS_TTL_MS = 60_000;
const DEFAULT_GIT_REPO_STATUS_TIMEOUT_MS = 5_000;

function isUnavailable(error: unknown): boolean {
  return error instanceof ProbeCommandError
    && (error.code === "ENOENT" || error.code === "spawn" || error.code === "exit");
}

function normalizeGitRepoStatusKey(input: GitRepoStatusCommandKey): string {
  return JSON.stringify({
    repoRoot: canonicalRepoRoot(input.repoRoot),
    args: input.args,
    maxStdoutBytes: input.maxStdoutBytes ?? null,
  });
}

function parseGitRepoStatusKey(key: string): Required<GitRepoStatusCommandKey> {
  const parsed = JSON.parse(key) as {
    repoRoot: string;
    args: string[];
    maxStdoutBytes?: number | null;
  };
  return {
    repoRoot: parsed.repoRoot,
    args: parsed.args,
    maxStdoutBytes: parsed.maxStdoutBytes ?? 1024 * 1024,
  };
}

export const gitRepoStatusProbe = defineProbeFamily<GitRepoStatusCommandKey, GitRepoStatusCommandResult | null>({
  id: "git.repoStatus",
  ttlMs: GIT_REPO_STATUS_TTL_MS,
  timeoutMs: DEFAULT_GIT_REPO_STATUS_TIMEOUT_MS,
  maxKeys: 256,
  idleKeyTtlMs: 10 * 60_000,
  maxConcurrentKeys: 2,
  normalizeKey: normalizeGitRepoStatusKey,
  run: async (key, ctx: ProbeCtx) => {
    const parsed = parseGitRepoStatusKey(key);
    try {
      const { stdout } = await execProbeFile(ctx, "git", ["-C", parsed.repoRoot, ...parsed.args], {
        maxStdoutBytes: parsed.maxStdoutBytes,
        maxStderrBytes: 256 * 1024,
      });
      return {
        repoRoot: parsed.repoRoot,
        args: [...parsed.args],
        stdout,
      };
    } catch (error) {
      if (isUnavailable(error)) return null;
      throw error;
    }
  },
});

export async function readGitRepoStatusCommand(
  repoRoot: string,
  args: readonly string[],
  options: { maxStdoutBytes?: number; maxAgeMs?: number } = {},
): Promise<string | null> {
  const snapshot = await gitRepoStatusProbe.for({
    repoRoot,
    args,
    maxStdoutBytes: options.maxStdoutBytes,
  }).fresh({ maxAgeMs: options.maxAgeMs ?? GIT_REPO_STATUS_TTL_MS });
  return snapshot.value?.stdout ?? null;
}
