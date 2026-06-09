import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Shared launcher for the native `openscout-repo-service` binary. Both the
// repo-watch scanner and the repo-diff producer drive the same binary, just a
// different subcommand, so the binary resolution and bounded-subprocess JSON
// I/O live here once.

// Generous ceiling on a single response. This must sit comfortably above the
// diff producer's `maxPatchBytes` (16 MB) once JSON-encoded — a near-cap patch
// inflates with escaping, so the old 2 MiB cap could abort large but legitimate
// diffs. 96 MiB is a backstop against a runaway process, not a working limit.
export const REPO_SERVICE_MAX_BUFFER = 96 * 1024 * 1024;

export type RepoServiceCommand = {
  command: string;
  args: string[];
  cwd?: string;
};

/**
 * Resolve how to invoke `openscout-repo-service <subcommand>`. Prefers a
 * prebuilt binary via `OPENSCOUT_REPO_SERVICE_BIN`; otherwise falls back to
 * `cargo run` against the crate manifest when running inside a checkout.
 */
export function resolveRepoServiceCommand(subcommand: string): RepoServiceCommand | null {
  const explicit = process.env.OPENSCOUT_REPO_SERVICE_BIN?.trim();
  if (explicit) {
    return { command: explicit, args: [subcommand] };
  }

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidateRoots = [resolve(moduleDir, "../../../.."), process.cwd()];
  const seen = new Set<string>();
  for (const root of candidateRoots) {
    if (seen.has(root)) continue;
    seen.add(root);
    const manifestPath = resolve(root, "crates", "openscout-repo-service", "Cargo.toml");
    if (!existsSync(manifestPath)) continue;
    return {
      command: process.env.CARGO?.trim() || "cargo",
      args: ["run", "--quiet", "--manifest-path", manifestPath, "--", subcommand],
      cwd: root,
    };
  }

  return null;
}

/**
 * Run a repo-service subcommand, write `input` as JSON to stdin, and parse the
 * stdout JSON response. Bounded by `timeoutMs` and an output buffer cap, with
 * SIGTERM/SIGKILL escalation on timeout.
 */
export async function runRepoServiceJson(
  command: RepoServiceCommand,
  input: unknown,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const killTimer = setTimeout(() => {
      terminate();
      fail(new Error(`${command.command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
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

    function succeed(output: unknown): void {
      if (settled) return;
      settled = true;
      cleanup();
      resolvePromise(output);
    }

    function append(kind: "stdout" | "stderr", chunk: unknown): void {
      const text = typeof chunk === "string" ? chunk : String(chunk);
      if (kind === "stdout") stdout += text;
      else stderr += text;
      if (stdout.length + stderr.length > REPO_SERVICE_MAX_BUFFER) {
        terminate();
        fail(new Error(`${command.command} exceeded output limit`));
      }
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => append("stdout", chunk));
    child.stderr.on("data", (chunk) => append("stderr", chunk));
    child.on("error", (error) => fail(error));
    child.on("close", (code, signal) => {
      if (settled) return;
      if (code !== 0) {
        const detail = (stderr || `${command.command} exited with ${signal ?? code ?? "unknown status"}`).trim();
        fail(new Error(detail));
        return;
      }
      try {
        succeed(JSON.parse(stdout));
      } catch (error) {
        fail(new Error(`Repo service returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`));
      }
    });

    child.stdin.end(JSON.stringify(input));
  });
}
