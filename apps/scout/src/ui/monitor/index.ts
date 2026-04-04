import type { WriteStream } from "node:tty";

import type { ScoutMonitorSnapshot } from "../../core/monitor/service.ts";
import { loadScoutMonitorSnapshot } from "../../core/monitor/service.ts";
import { renderScoutAgentStatus } from "../terminal/agents.ts";
import { renderScoutMessage } from "../terminal/broker.ts";

export type RunScoutMonitorAppOptions = {
  currentDirectory: string;
  channel?: string;
  limit?: number;
  refreshIntervalMs?: number;
  stdout?: WriteStream;
  stdin?: NodeJS.ReadStream;
};

const ANSI_CLEAR_SCREEN = "\u001B[2J\u001B[H";
const ANSI_ALT_SCREEN_ON = "\u001B[?1049h";
const ANSI_ALT_SCREEN_OFF = "\u001B[?1049l";
const ANSI_HIDE_CURSOR = "\u001B[?25l";
const ANSI_SHOW_CURSOR = "\u001B[?25h";
const DEFAULT_TERMINAL_WIDTH = 120;
const DEFAULT_TERMINAL_HEIGHT = 40;
const DEFAULT_REFRESH_INTERVAL_MS = 1_500;
const DEFAULT_MONITOR_LIMIT = 12;
const SECTION_PADDING = 4;

function truncateLine(value: string, width: number): string {
  if (width <= 0) {
    return "";
  }
  if (value.length <= width) {
    return value;
  }
  if (width <= 1) {
    return value.slice(0, width);
  }
  return `${value.slice(0, width - 1)}…`;
}

function ageLabel(timestamp: number): string {
  const age = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (age < 60) return `${age}s ago`;
  if (age < 3600) return `${Math.floor(age / 60)}m ago`;
  if (age < 86_400) return `${Math.floor(age / 3600)}h ago`;
  return `${Math.floor(age / 86_400)}d ago`;
}

function renderSection(title: string, rows: string[], width: number): string[] {
  const body = rows.length > 0 ? rows : ["(empty)"];
  return [
    truncateLine(title, width),
    ...body.map((row) => truncateLine(`  ${row}`, width)),
  ];
}

function renderHealthSummary(snapshot: ScoutMonitorSnapshot): string {
  const broker = snapshot.brokerStatus;
  if (!broker.reachable || !broker.health.ok) {
    return `broker offline · ${snapshot.brokerUrl}`;
  }

  const counts = broker.health.counts;
  if (!counts) {
    return `broker online · ${snapshot.brokerUrl}`;
  }

  return [
    `broker online`,
    `${counts.agents} agents`,
    `${counts.conversations} conversations`,
    `${counts.messages} messages`,
    snapshot.brokerUrl,
  ].join(" · ");
}

function pickRows(rows: string[], maxRows: number): string[] {
  if (maxRows <= 0) {
    return [];
  }
  return rows.slice(0, maxRows);
}

function renderScoutMonitorFrame(snapshot: ScoutMonitorSnapshot, width: number, height: number): string {
  const localAgentRows = snapshot.localAgents.map(renderScoutAgentStatus);
  const brokerAgentRows = snapshot.brokerAgents.map((agent) => {
    const lastSeen = agent.lastSeen ? ageLabel(agent.lastSeen) : "not seen";
    return `${agent.agentId} · ${agent.state} · ${agent.messages} msgs · ${lastSeen}`;
  });
  const messageRows = snapshot.recentMessages
    .slice()
    .reverse()
    .map(renderScoutMessage);

  const headerRows = [
    truncateLine(`Scout Monitor · ${ageLabel(snapshot.refreshedAt)} · q quit · r refresh`, width),
    truncateLine(`cwd: ${snapshot.currentDirectory}`, width),
    truncateLine(`channel: ${snapshot.channel} · ${renderHealthSummary(snapshot)}`, width),
  ];

  const reservedRows = headerRows.length + 3;
  const usableRows = Math.max(height - reservedRows, 12);
  const localMax = Math.max(3, Math.min(6, Math.floor(usableRows * 0.25)));
  const brokerMax = Math.max(4, Math.min(8, Math.floor(usableRows * 0.3)));
  const errorMax = snapshot.errors.length > 0 ? Math.min(3, snapshot.errors.length) + 1 : 0;
  const messageMax = Math.max(
    4,
    usableRows - localMax - brokerMax - errorMax - SECTION_PADDING,
  );

  const lines = [
    ...headerRows,
    "",
    ...renderSection("Local Agents", pickRows(localAgentRows, localMax), width),
    "",
    ...renderSection("Broker Agents", pickRows(brokerAgentRows, brokerMax), width),
  ];

  if (snapshot.errors.length > 0) {
    lines.push("");
    lines.push(...renderSection("Errors", pickRows(snapshot.errors, errorMax - 1), width));
  }

  lines.push("");
  lines.push(...renderSection("Recent Messages", pickRows(messageRows, messageMax), width));

  return `${lines.slice(0, height).join("\n")}\n`;
}

export async function runScoutMonitorApp(options: RunScoutMonitorAppOptions): Promise<void> {
  const stdout = options.stdout ?? process.stdout;
  const stdin = options.stdin ?? process.stdin;
  const refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
  const limit = options.limit ?? DEFAULT_MONITOR_LIMIT;

  if (!stdout.isTTY || !stdin.isTTY) {
    throw new Error("scout tui requires an interactive terminal");
  }

  let closing = false;
  let interval: ReturnType<typeof setInterval> | null = null;
  let refreshInFlight = false;
  let finish: (() => void) | null = null;

  const teardown = () => {
    if (closing) {
      return;
    }
    closing = true;
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    stdin.off("data", onInput);
    stdin.off("end", onEnd);
    if (typeof stdin.setRawMode === "function") {
      stdin.setRawMode(false);
    }
    stdin.pause();
    stdout.write(`${ANSI_SHOW_CURSOR}${ANSI_ALT_SCREEN_OFF}`);
    finish?.();
    finish = null;
  };

  const render = async () => {
    if (refreshInFlight || closing) {
      return;
    }
    refreshInFlight = true;
    try {
      const snapshot = await loadScoutMonitorSnapshot({
        currentDirectory: options.currentDirectory,
        channel: options.channel,
        limit,
      });
      if (closing) {
        return;
      }
      const width = stdout.columns || DEFAULT_TERMINAL_WIDTH;
      const height = stdout.rows || DEFAULT_TERMINAL_HEIGHT;
      stdout.write(`${ANSI_CLEAR_SCREEN}${renderScoutMonitorFrame(snapshot, width, height)}`);
    } catch (error) {
      if (closing) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      stdout.write(`${ANSI_CLEAR_SCREEN}Scout Monitor\n\n${truncateLine(message, stdout.columns || DEFAULT_TERMINAL_WIDTH)}\n`);
    } finally {
      refreshInFlight = false;
    }
  };

  const onInput = (chunk: Buffer | string) => {
    const input = chunk.toString("utf8");
    if (input === "q" || input === "\u0003") {
      teardown();
      return;
    }
    if (input === "r") {
      void render();
    }
  };

  const onEnd = () => {
    teardown();
  };

  stdout.write(`${ANSI_ALT_SCREEN_ON}${ANSI_HIDE_CURSOR}`);
  if (typeof stdin.setRawMode === "function") {
    stdin.setRawMode(true);
  }
  stdin.resume();
  stdin.on("data", onInput);
  stdin.on("end", onEnd);

  try {
    await render();
    interval = setInterval(() => {
      void render();
    }, refreshIntervalMs);
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  } finally {
    teardown();
  }
}
