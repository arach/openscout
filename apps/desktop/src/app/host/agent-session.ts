import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";

import { loadScoutBrokerContext } from "../../core/broker/service.ts";
import { getLocalAgentConfig } from "@openscout/runtime/local-agents";
import type { RuntimeRegistrySnapshot } from "@openscout/runtime/registry";
import { relayAgentLogsDirectory } from "@openscout/runtime/support-paths";

export type ScoutDesktopAgentSessionMode = "tmux" | "logs" | "none";

export type ScoutDesktopAgentSessionInspector = {
  agentId: string;
  title: string;
  subtitle: string;
  mode: ScoutDesktopAgentSessionMode;
  harness: string | null;
  transport: string | null;
  sessionId: string | null;
  commandLabel: string | null;
  pathLabel: string | null;
  directoryPath: string | null;
  body: string;
  updatedAtLabel: string | null;
  lineCount: number;
  truncated: boolean;
  missing: boolean;
};

export type ScoutDesktopAgentSessionHost = {
  platform?: string;
  execFile?: (file: string, args: string[]) => Promise<void>;
  openPath?: (targetPath: string) => Promise<string> | string;
};

const LOG_TAIL_CHUNK_BYTES = 64 * 1024;
const DEFAULT_AGENT_SESSION_TAIL_LINES = 180;

function compactHomePath(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const home = process.env.HOME ?? "";
  return home && value.startsWith(home) ? value.replace(home, "~") : value;
}

function expandHomePath(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  if (value === "~") {
    return process.env.HOME ?? value;
  }
  if (value.startsWith("~/")) {
    return path.join(process.env.HOME ?? "", value.slice(2));
  }
  return value;
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function normalizeTimestamp(value: number | null | undefined): number {
  if (!value) {
    return 0;
  }
  return value > 10_000_000_000 ? Math.floor(value / 1000) : value;
}

function formatRelativeTime(value: number): string {
  const deltaSeconds = Math.max(0, Math.floor(Date.now() / 1000) - normalizeTimestamp(value));
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;
  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h ago`;
  const deltaDays = Math.floor(deltaHours / 24);
  return `${deltaDays}d ago`;
}

function runOptionalCommand(command: string, args: string[]): string | null {
  try {
    const output = execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

function splitLogLines(raw: string): string[] {
  const lines = raw.split(/\r?\n/);
  if (lines.length > 0 && lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function logSectionLabel(filePath: string): string {
  return path.basename(filePath);
}

async function readVisibleLogFile(filePath: string, tailLines: number): Promise<{
  lines: string[];
  updatedAtMs: number;
  truncated: boolean;
}> {
  const file = await open(filePath, "r");

  try {
    const stats = await file.stat();
    if (tailLines <= 0 || stats.size <= 0) {
      const raw = stats.size > 0 ? await file.readFile({ encoding: "utf8" }) : "";
      return {
        lines: splitLogLines(raw),
        updatedAtMs: stats.mtimeMs,
        truncated: false,
      };
    }

    let position = stats.size;
    let newlineCount = 0;
    let totalBytes = 0;
    const chunks: Buffer[] = [];

    while (position > 0 && newlineCount <= tailLines) {
      const readSize = Math.min(LOG_TAIL_CHUNK_BYTES, position);
      position -= readSize;
      const buffer = Buffer.allocUnsafe(readSize);
      const { bytesRead } = await file.read(buffer, 0, readSize, position);
      if (bytesRead <= 0) {
        break;
      }
      const chunk = buffer.subarray(0, bytesRead);
      chunks.unshift(chunk);
      totalBytes += bytesRead;
      for (const byte of chunk) {
        if (byte === 10) {
          newlineCount += 1;
        }
      }
    }

    const raw = Buffer.concat(chunks, totalBytes).toString("utf8");
    const lines = splitLogLines(raw);
    return {
      lines: lines.length > tailLines ? lines.slice(-tailLines) : lines,
      updatedAtMs: stats.mtimeMs,
      truncated: position > 0 || lines.length > tailLines,
    };
  } finally {
    await file.close();
  }
}

function captureTmuxPane(sessionId: string, tailLines: number): {
  body: string;
  lineCount: number;
  truncated: boolean;
  missing: boolean;
} {
  const output = runOptionalCommand("tmux", [
    "capture-pane",
    "-p",
    "-t",
    sessionId,
    "-S",
    `-${Math.max(tailLines, 40)}`,
  ]);
  if (output === null) {
    return {
      body: "",
      lineCount: 0,
      truncated: false,
      missing: true,
    };
  }

  const lines = splitLogLines(output);
  const visibleLines = lines.length > tailLines ? lines.slice(-tailLines) : lines;
  return {
    body: visibleLines.join("\n"),
    lineCount: visibleLines.length,
    truncated: lines.length > tailLines,
    missing: false,
  };
}

async function readAgentSessionLogs(agentId: string, tailLines: number): Promise<{
  body: string;
  pathLabel: string;
  targetPath: string | null;
  updatedAtLabel: string | null;
  lineCount: number;
  truncated: boolean;
  missing: boolean;
}> {
  const logsDirectory = relayAgentLogsDirectory(agentId);
  const sources = [
    path.join(logsDirectory, "stdout.log"),
    path.join(logsDirectory, "stderr.log"),
  ];
  const sections: string[] = [];
  let updatedAtMs = 0;
  let lineCount = 0;
  let truncated = false;
  let foundAny = false;
  let targetPath: string | null = null;

  for (const filePath of sources) {
    if (!existsSync(filePath)) {
      continue;
    }

    foundAny = true;
    targetPath ??= filePath;
    const content = await readVisibleLogFile(filePath, tailLines);
    updatedAtMs = Math.max(updatedAtMs, content.updatedAtMs);
    lineCount += content.lines.length;
    truncated = truncated || content.truncated;
    sections.push(`== ${logSectionLabel(filePath)} ==`);
    sections.push(content.lines.join("\n") || "(empty)");
  }

  return {
    body: foundAny ? sections.join("\n\n") : "",
    pathLabel: compactHomePath(targetPath ?? logsDirectory) ?? targetPath ?? logsDirectory,
    targetPath,
    updatedAtLabel: updatedAtMs > 0 ? formatRelativeTime(Math.floor(updatedAtMs / 1000)) : null,
    lineCount,
    truncated,
    missing: !foundAny,
  };
}

type ScoutDesktopAgentEndpoint = {
  agentId: string;
  state?: string;
  transport?: string;
  harness?: string;
  cwd?: string;
  projectRoot?: string;
  sessionId?: string;
};

function activeEndpoint(snapshot: RuntimeRegistrySnapshot, agentId: string): ScoutDesktopAgentEndpoint | null {
  const candidates = Object.values(snapshot.endpoints as Record<string, {
    agentId: string;
    state?: string;
    transport?: string;
    harness?: string;
    cwd?: string;
    projectRoot?: string;
    sessionId?: string;
  }>).filter((endpoint) => endpoint.agentId === agentId);
  const rank = (state: string | undefined) => {
    switch (state) {
      case "active":
        return 0;
      case "idle":
        return 1;
      case "waiting":
        return 2;
      case "offline":
        return 5;
      default:
        return 4;
    }
  };

  return [...candidates].sort((left, right) => rank(left.state) - rank(right.state))[0] ?? null;
}

function buildTmuxInspector(input: {
  agentId: string;
  title: string;
  harness: string | null;
  transport: string | null;
  sessionId: string;
  directoryPath: string | null;
  cwdLabel: string | null;
  tailLines: number;
}): ScoutDesktopAgentSessionInspector | null {
  const tmuxCapture = captureTmuxPane(input.sessionId, input.tailLines);
  if (tmuxCapture.missing) {
    return null;
  }

  return {
    agentId: input.agentId,
    title: input.title,
    subtitle: input.cwdLabel
      ? `Live tmux pane capture · ${input.cwdLabel}`
      : "Live tmux pane capture",
    mode: "tmux",
    harness: input.harness,
    transport: input.transport,
    sessionId: input.sessionId,
    commandLabel: `tmux attach -t ${input.sessionId}`,
    pathLabel: input.cwdLabel ? `${input.cwdLabel} · tmux:${input.sessionId}` : `tmux:${input.sessionId}`,
    directoryPath: input.directoryPath,
    body: tmuxCapture.body,
    updatedAtLabel: null,
    lineCount: tmuxCapture.lineCount,
    truncated: tmuxCapture.truncated,
    missing: false,
  };
}

export async function getScoutDesktopAgentSession(agentId: string): Promise<ScoutDesktopAgentSessionInspector> {
  const [agentConfig, broker] = await Promise.all([
    getLocalAgentConfig(agentId),
    loadScoutBrokerContext(),
  ]);

  const configuredTitle = agentConfig?.agentId ?? agentId;
  const configuredHarness = agentConfig?.runtime.harness ?? null;
  const configuredTransport = agentConfig?.runtime.transport ?? null;
  const configuredSessionId = agentConfig?.runtime.sessionId ?? null;
  const configuredDirectoryPath = agentConfig?.runtime.cwd ?? null;
  const configuredCwd = compactHomePath(configuredDirectoryPath ?? "") || null;

  // Most relay agents are local tmux-backed sessions. Check the canonical local config first
  // so the UI can render immediately instead of waiting on broker status and snapshot fetches.
  if (configuredTransport === "tmux" && configuredSessionId) {
    const inspector = buildTmuxInspector({
      agentId,
      title: configuredTitle,
      harness: configuredHarness,
      transport: configuredTransport,
      sessionId: configuredSessionId,
      directoryPath: configuredDirectoryPath,
      cwdLabel: configuredCwd,
      tailLines: DEFAULT_AGENT_SESSION_TAIL_LINES,
    });
    if (inspector) {
      return inspector;
    }
  }

  const logCapture = await readAgentSessionLogs(agentId, DEFAULT_AGENT_SESSION_TAIL_LINES);

  const snapshot = broker?.snapshot;
  const agent = snapshot?.agents?.[agentId] as { displayName?: string } | undefined;
  const endpoint = snapshot ? activeEndpoint(snapshot, agentId) : null;

  const title = agent?.displayName ?? configuredTitle;
  const harness = endpoint?.harness ?? configuredHarness;
  const transport = endpoint?.transport ?? configuredTransport;
  const sessionId = endpoint?.sessionId ?? configuredSessionId;
  const directoryPath = endpoint?.cwd ?? configuredDirectoryPath;
  const cwd = compactHomePath(directoryPath ?? "") || null;

  if (transport === "tmux" && sessionId) {
    const inspector = buildTmuxInspector({
      agentId,
      title,
      harness,
      transport,
      sessionId,
      directoryPath,
      cwdLabel: cwd,
      tailLines: DEFAULT_AGENT_SESSION_TAIL_LINES,
    });
    if (inspector) {
      return inspector;
    }
  }

  if (!logCapture.missing) {
    return {
      agentId,
      title,
      subtitle: transport && transport !== "tmux"
        ? `${transport} session logs`
        : "Runtime session logs",
      mode: "logs",
      harness,
      transport,
      sessionId,
      commandLabel: null,
      pathLabel: logCapture.pathLabel,
      directoryPath: logCapture.targetPath ?? relayAgentLogsDirectory(agentId),
      body: logCapture.body,
      updatedAtLabel: logCapture.updatedAtLabel,
      lineCount: logCapture.lineCount,
      truncated: logCapture.truncated,
      missing: false,
    };
  }

  return {
    agentId,
    title,
    subtitle: "No live tmux pane or session logs available yet.",
    mode: "none",
    harness,
    transport,
    sessionId,
    commandLabel: sessionId && transport === "tmux" ? `tmux attach -t ${sessionId}` : null,
    pathLabel: cwd,
    directoryPath,
    body: "",
    updatedAtLabel: null,
    lineCount: 0,
    truncated: false,
    missing: true,
  };
}

export async function openScoutDesktopAgentSession(
  agentId: string,
  host: ScoutDesktopAgentSessionHost = {},
): Promise<boolean> {
  const session = await getScoutDesktopAgentSession(agentId);
  const platform = host.platform ?? process.platform;

  if (session.mode === "tmux" && session.commandLabel) {
    if (platform !== "darwin") {
      throw new Error("Direct tmux attach is only wired for macOS right now.");
    }
    if (!host.execFile) {
      throw new Error("Scout agent-session terminal attach is unavailable.");
    }

    await host.execFile("osascript", [
      "-e",
      'tell application "Terminal" to activate',
      "-e",
      `tell application "Terminal" to do script "${escapeAppleScriptString(session.commandLabel)}"`,
    ]);
    return true;
  }

  const targetPath = expandHomePath(session.directoryPath);
  if (targetPath) {
    if (!host.openPath) {
      throw new Error("Scout agent-session path opening is unavailable.");
    }

    const errorMessage = await host.openPath(targetPath);
    if (errorMessage) {
      throw new Error(errorMessage);
    }
    return true;
  }

  throw new Error("No live tmux pane or session logs are available for this agent yet.");
}
