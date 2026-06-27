import { execFileSync, spawnSync } from "node:child_process";
import { resolveCodexExecutable } from "@openscout/agent-sessions/codex-executable";

export type SessionCompactionRequest = {
  harness?: string | null;
  sessionId?: string | null;
  transcriptPath?: string | null;
  tmuxSessionName?: string | null;
  agentId?: string | null;
};

export type SessionCompactionResult = {
  ok: boolean;
  delivered: boolean;
  method?: "codex-app-server" | "tmux-slash-command";
  command?: string;
  error?: string;
};

function tmuxSessionExists(sessionName: string): boolean {
  try {
    execFileSync("tmux", ["has-session", "-t", sessionName], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function sendTmuxSlashCommand(sessionName: string, command: string): boolean {
  try {
    execFileSync("tmux", ["send-keys", "-t", sessionName, "-l", command], { stdio: "ignore" });
    execFileSync("tmux", ["send-keys", "-t", sessionName, "Enter"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function parseJsonRpcLine(output: string): { result?: unknown; error?: { message?: string } } | null {
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as { result?: unknown; error?: { message?: string } };
      if ("result" in parsed || "error" in parsed) {
        return parsed;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export function requestCodexThreadCompaction(threadId: string): SessionCompactionResult {
  const trimmed = threadId.trim();
  if (!trimmed) {
    return { ok: false, delivered: false, error: "missing codex thread id" };
  }

  let codexExecutable: string;
  try {
    codexExecutable = resolveCodexExecutable();
  } catch (error) {
    return {
      ok: false,
      delivered: false,
      error: error instanceof Error ? error.message : "Codex executable is unavailable",
    };
  }

  const request = `${JSON.stringify({
    id: 1,
    method: "thread/compact/start",
    params: { threadId: trimmed },
  })}\n`;

  const result = spawnSync(codexExecutable, ["app-server", "proxy"], {
    input: request,
    encoding: "utf8",
    timeout: 15_000,
  });

  if (result.error) {
    return {
      ok: false,
      delivered: false,
      method: "codex-app-server",
      error: result.error.message,
    };
  }

  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (result.status !== 0) {
    return {
      ok: false,
      delivered: false,
      method: "codex-app-server",
      error: combined || `codex app-server proxy exited with status ${result.status ?? "unknown"}`,
    };
  }

  const response = parseJsonRpcLine(combined);
  if (response?.error?.message) {
    return {
      ok: false,
      delivered: false,
      method: "codex-app-server",
      error: response.error.message,
    };
  }

  return {
    ok: true,
    delivered: true,
    method: "codex-app-server",
  };
}

export function requestHarnessSessionCompaction(
  input: SessionCompactionRequest,
): SessionCompactionResult {
  const harness = input.harness?.trim().toLowerCase() ?? "";
  const sessionId = input.sessionId?.trim() ?? "";
  const tmuxSessionName = input.tmuxSessionName?.trim() ?? "";

  if (harness === "codex" && sessionId) {
    return requestCodexThreadCompaction(sessionId);
  }

  const slashCommand = harness === "claude" || harness === "claude-code"
    ? "/compact"
    : null;
  if (slashCommand && tmuxSessionName && tmuxSessionExists(tmuxSessionName)) {
    const delivered = sendTmuxSlashCommand(tmuxSessionName, slashCommand);
    return delivered
      ? {
          ok: true,
          delivered: true,
          method: "tmux-slash-command",
          command: slashCommand,
        }
      : {
          ok: false,
          delivered: false,
          method: "tmux-slash-command",
          command: slashCommand,
          error: `failed to send ${slashCommand} to tmux session ${tmuxSessionName}`,
        };
  }

  if (slashCommand) {
    return {
      ok: false,
      delivered: false,
      method: "tmux-slash-command",
      command: slashCommand,
      error: "no reachable tmux surface for this session",
    };
  }

  return {
    ok: false,
    delivered: false,
    error: `compaction is not supported for harness ${harness || "unknown"}`,
  };
}