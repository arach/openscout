/** @jsxImportSource @opentui/react */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { resolveOperatorName } from "@openscout/runtime/user-config";
import { stripVTControlCharacters } from "node:util";

import {
  type ScoutMonitorActivity,
  type ScoutMonitorAgent,
  type ScoutMonitorSnapshot,
  loadScoutMonitorSnapshot,
} from "../../core/monitor/service.ts";
import type { ScoutBrokerMessageRecord } from "../../core/broker/service.ts";
import { resolveScoutBrokerUrl, scoutConversationIdForChannel } from "../../core/broker/service.ts";
import { scoutBrokerPaths } from "../../core/broker/paths.ts";
import { normalizeUnixTimestamp } from "../../core/broker/view.ts";

export type ScoutMonitorAppProps = {
  currentDirectory: string;
  channel?: string;
  limit: number;
  refreshIntervalMs: number;
  onQuit: () => void;
};

type MonitorTab = "home" | "tail" | "new";

const C = {
  accent: "#34d399",
  bg: "#09090b",
  border: "#2b303b",
  cyan: "#22d3ee",
  dim: "#6b7280",
  muted: "#9ca3af",
  red: "#f87171",
  text: "#e5e7eb",
  yellow: "#fbbf24",
};

const MONITOR_TABS: MonitorTab[] = ["home", "tail", "new"];
const operatorName = resolveOperatorName();

type AgentRow = {
  key: string;
  title: string;
  meta: string;
  project: string;
  runtime: string;
  status: string;
  age: string;
  state: ScoutMonitorAgent["state"];
  timestamp: number | null;
};

const CONTROL_PATTERN = /[\u0000-\u001F\u007F]/g;

function cleanText(value: string): string {
  return stripVTControlCharacters(value).replace(CONTROL_PATTERN, "").trim();
}

function sourceText(value: string | null | undefined): string {
  return cleanText(value ?? "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function displayName(actorId: string | null | undefined): string {
  const trimmed = actorId?.trim();
  if (!trimmed) return "unknown";
  if (trimmed === "operator") return operatorName;
  return cleanText(trimmed.split(".")[0] || trimmed);
}

function normalizeTimestamp(value: unknown): number | null {
  return normalizeUnixTimestamp(value);
}

function formatClock(value: unknown): string {
  const timestamp = normalizeTimestamp(value);
  if (timestamp === null) return "--:--:--";
  const date = new Date(timestamp * 1000);
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((entry) => String(entry).padStart(2, "0"))
    .join(":");
}

function formatRelative(value: unknown): string {
  const timestamp = normalizeTimestamp(value);
  if (timestamp === null) return "not seen";
  const age = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (age < 60) return `${age}s ago`;
  if (age < 3_600) return `${Math.floor(age / 60)}m ago`;
  if (age < 86_400) return `${Math.floor(age / 3_600)}h ago`;
  return `${Math.floor(age / 86_400)}d ago`;
}

function truncate(value: string, width: number): string {
  const clean = cleanText(value);
  if (width <= 0) return "";
  if (clean.length <= width) return clean;
  if (width === 1) return clean.slice(0, 1);
  return `${clean.slice(0, width - 1)}…`;
}

function fitLine(value: string, width: number): string {
  const fitted = truncate(value, width);
  return fitted.padEnd(Math.max(0, width), " ");
}

function wrapText(value: string, width: number): string[] {
  if (width <= 0) return [];
  const normalized = cleanText(value).replace(/\s+/g, " ").trim();
  if (!normalized) return [""];

  const lines: string[] = [];
  let current = "";
  for (const word of normalized.split(" ")) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= width) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word.length > width ? truncate(word, width) : word;
  }
  if (current) lines.push(current);
  return lines;
}

function compactPath(value: string | null): string | null {
  if (!value) return null;
  const clean = cleanText(value);
  const home = process.env.HOME;
  if (home && clean.startsWith(home)) {
    return `~${clean.slice(home.length)}`;
  }
  return clean;
}

function projectLabel(value: string | null): string {
  const compact = compactPath(value);
  if (!compact) return "unknown";
  if (compact === "~") return "home";
  const parts = compact.split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? compact;
  return last === "~" ? "home" : last;
}

function runtimeLabel(value: string | null): string {
  const parts = cleanText(value ?? "")
    .split("·")
    .map((part) => sourceText(part))
    .filter(Boolean)
    .map((part) => part
      .replace(/claude_stream_json/g, "stream")
      .replace(/codex_app_server/g, "app")
      .replace(/claude_channel/g, "channel")
      .replace(/pi_rpc/g, "rpc"));
  return parts.length > 0 ? parts.join("/") : "unknown";
}

function stateRank(state: ScoutMonitorAgent["state"]): number {
  switch (state) {
    case "working":
      return 0;
    case "available":
      return 1;
    case "offline":
    default:
      return 2;
  }
}

function statusRank(status: string, state: ScoutMonitorAgent["state"]): number {
  const clean = status.toLowerCase();
  if (state === "offline" || clean.includes("offline")) return 4;
  if (clean.includes("waiting")) return 2;
  if (state === "available" || clean.includes("available")) return 1;
  if (state === "working" || clean.includes("working") || clean.includes("running")) return 0;
  return 3;
}

function stateColor(state: ScoutMonitorAgent["state"]): string {
  switch (state) {
    case "working":
      return C.yellow;
    case "available":
      return C.accent;
    case "offline":
    default:
      return C.dim;
  }
}

function agentTone(row: AgentRow): string {
  const status = row.status.toLowerCase();
  if (row.state === "offline" || status.includes("offline")) return C.dim;
  if (status.includes("waiting")) return C.text;
  if (row.state === "available" || status.includes("available")) return C.accent;
  if (row.state === "working" || status.includes("working") || status.includes("running")) return C.yellow;
  return C.text;
}

function statusSummary(agents: ScoutMonitorAgent[]): string {
  const counts = new Map<string, number>();
  for (const agent of agents) {
    const label = sourceText(agent.statusLabel || agent.state).toLowerCase() || agent.state;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([label, count]) => `${count} ${label}`)
    .join(" · ");
}

function buildAgentRows(agents: ScoutMonitorAgent[]): AgentRow[] {
  return agents
    .map((agent) => {
      const timestamp = normalizeTimestamp(agent.lastSeenAt);
      const project = compactPath(agent.projectRoot);
      const status = sourceText(agent.statusLabel) || agent.state;
      const meta = [
        agent.role,
        project,
        agent.statusDetail,
      ].filter((item): item is string => Boolean(item && item.trim())).join(" · ");

      return {
        key: agent.id,
        title: agent.title || displayName(agent.id),
        meta: meta || agent.summary || agent.id,
        project: projectLabel(agent.projectRoot),
        runtime: runtimeLabel(agent.statusDetail),
        status,
        age: timestamp === null ? "not seen" : formatRelative(timestamp),
        state: agent.state,
        timestamp,
      };
    })
    .sort((left, right) => (
      statusRank(left.status, left.state) - statusRank(right.status, right.state)
      || stateRank(left.state) - stateRank(right.state)
      || (right.timestamp ?? 0) - (left.timestamp ?? 0)
      || left.title.localeCompare(right.title)
    ));
}

function messageTone(message: ScoutBrokerMessageRecord): string {
  if (message.actorId === "operator") return C.cyan;
  if (message.class === "status") return C.yellow;
  if (message.class === "system") return C.dim;
  return C.text;
}

function activityTone(item: ScoutMonitorActivity): string {
  if (item.kind === "system") return C.yellow;
  return C.text;
}

function Header({
  snapshot,
  loading,
  tab,
}: {
  snapshot: ScoutMonitorSnapshot | null;
  loading: boolean;
  tab: MonitorTab;
}) {
  const counts = snapshot?.brokerHealth.counts;
  const online = snapshot?.brokerHealth.ok === true;
  const status = snapshot ? (online ? "online" : "offline") : "starting";

  return (
    <box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1} paddingTop={1} height={3}>
      <box flexDirection="row" gap={1}>
        <text fg={online ? C.accent : C.yellow}>◆</text>
        <text fg={C.text}>SCOUT</text>
        <text fg={C.dim}>tui</text>
        <text fg={C.dim}>|</text>
        {MONITOR_TABS.map((entry) => (
          <text key={entry} fg={entry === tab ? C.text : C.dim}>
            {entry === tab ? `[${entry}]` : ` ${entry} `}
          </text>
        ))}
        <text fg={online ? C.accent : C.yellow}>{loading ? "refreshing" : status}</text>
      </box>
      <box flexDirection="row" gap={2}>
        {counts ? <text fg={C.dim}>{counts.agents} agents</text> : null}
        {counts ? <text fg={C.dim}>{counts.messages} msgs</text> : null}
        <text fg={C.dim}>{snapshot ? formatClock(snapshot.refreshedAt) : "--:--:--"}</text>
      </box>
    </box>
  );
}

function AgentListPanel({
  agents,
  width,
  height,
}: {
  agents: ScoutMonitorAgent[];
  width: number;
  height: number;
}) {
  const rows = buildAgentRows(agents);
  const tableMode = width >= 76;
  const lineWidth = Math.max(18, width - 4);
  const statusWidth = tableMode ? Math.min(12, Math.max(8, Math.floor(lineWidth * 0.16))) : 0;
  const projectWidth = tableMode ? Math.min(22, Math.max(10, Math.floor(lineWidth * 0.22))) : 0;
  const runtimeWidth = tableMode ? Math.min(18, Math.max(9, Math.floor(lineWidth * 0.18))) : 0;
  const nameWidth = tableMode
    ? Math.max(16, lineWidth - statusWidth - projectWidth - runtimeWidth - 8)
    : lineWidth;
  const visibleCount = tableMode
    ? Math.max(1, Math.min(rows.length, height - 5))
    : Math.max(1, Math.min(rows.length, Math.floor(Math.max(2, height - 3) / 2)));
  const visible = rows.slice(0, visibleCount);
  const hiddenCount = Math.max(0, rows.length - visible.length);

  return (
    <box flexDirection="column" width={width} height={height} border borderStyle="rounded" borderColor={C.border} padding={1} title={`Agents · ${rows.length}${rows.length > 0 ? ` · ${statusSummary(agents)}` : ""}`}>
      {visible.length === 0 ? (
        <box flexDirection="column">
          <text fg={C.dim}>{fitLine("No active agents in broker home.", lineWidth)}</text>
          <text fg={C.dim}>{fitLine("scout up . --harness claude", lineWidth)}</text>
        </box>
      ) : tableMode ? (
        <>
          <box height={1}>
            <text fg={C.dim}>
              {fitLine(`  ${fitLine("agent", nameWidth)} ${fitLine("status", statusWidth)} ${fitLine("project", projectWidth)} ${fitLine("runtime", runtimeWidth)}`, lineWidth)}
            </text>
          </box>
          {visible.map((row) => (
            <box key={row.key} height={1}>
              <text fg={agentTone(row)}>
                {fitLine(`${row.state === "offline" ? "○" : "●"} ${fitLine(row.title, nameWidth)} ${fitLine(row.status, statusWidth)} ${fitLine(row.project, projectWidth)} ${fitLine(row.runtime, runtimeWidth)}`, lineWidth)}
              </text>
            </box>
          ))}
          {hiddenCount > 0 ? (
            <box height={1}>
              <text fg={C.dim}>{fitLine(`${hiddenCount} more agents`, lineWidth)}</text>
            </box>
          ) : null}
        </>
      ) : (
        visible.map((row) => (
          <box key={row.key} flexDirection="column" height={2}>
            <text fg={stateColor(row.state)}>
              {fitLine(`${row.state === "offline" ? "○" : "●"} ${row.title} · ${row.status} · ${row.age}`, lineWidth)}
            </text>
            <text fg={C.dim}>{fitLine(row.meta, lineWidth)}</text>
          </box>
        ))
      )}
    </box>
  );
}

function NewAgentPanel({
  snapshot,
  width,
  height,
}: {
  snapshot: ScoutMonitorSnapshot;
  width: number;
  height: number;
}) {
  const brokerOk = snapshot.brokerHealth.ok;
  const commands: Array<{ command: string; color: string }> = brokerOk
    ? [
        { command: "scout up . --harness claude", color: C.text },
        { command: 'scout ask --project . --harness claude "..."', color: C.text },
        { command: "scout card create . --harness claude", color: C.text },
      ]
    : [
        { command: "scout doctor", color: C.yellow },
        { command: "scout doctor --fix --yes", color: C.yellow },
      ];
  const compact = height <= 7;
  const lineWidth = Math.max(24, width - 4);
  const headerRows = compact ? 1 : 4;
  const maxCommandCount = Math.max(1, height - headerRows - 2);
  const visibleCommands = commands.slice(0, maxCommandCount);
  const path = compactPath(snapshot.currentDirectory) ?? snapshot.currentDirectory;

  return (
    <box
      flexDirection="column"
      width={width}
      height={height}
      border
      borderStyle="rounded"
      borderColor={brokerOk ? C.border : C.red}
      padding={1}
      title="New Agent"
    >
      <box height={1}>
        <text fg={brokerOk ? C.accent : C.red}>
          {fitLine(brokerOk ? "Broker ready" : "Broker offline", lineWidth)}
        </text>
      </box>
      {compact ? null : (
        <box height={1}>
          <text fg={C.dim}>{fitLine(path, lineWidth)}</text>
        </box>
      )}
      {compact ? null : (
        <box height={1}>
          <text fg={C.dim}>{fitLine("", lineWidth)}</text>
        </box>
      )}
      {visibleCommands.map((entry) => {
        return (
          <box key={entry.command} height={1} width={lineWidth}>
            <text fg={entry.color}>{fitLine(entry.command, lineWidth)}</text>
          </box>
        );
      })}
      {visibleCommands.length < commands.length ? (
        <box height={1}>
          <text fg={C.dim}>{fitLine(`${commands.length - visibleCommands.length} more hidden`, lineWidth)}</text>
        </box>
      ) : null}
    </box>
  );
}

function ActivityPanel({
  activity,
  width,
  height,
}: {
  activity: ScoutMonitorActivity[];
  width: number;
  height: number;
}) {
  const lineWidth = Math.max(24, width - 4);
  const kindWidth = 7;
  const actorWidth = Math.min(20, Math.max(10, Math.floor(lineWidth * 0.22)));
  const titleWidth = Math.max(16, lineWidth - kindWidth - actorWidth - 13);
  const availableRows = Math.max(1, height - 3);
  const visibleRows = activity.length > availableRows ? Math.max(1, availableRows - 1) : availableRows;
  const visible = activity.slice(0, Math.max(1, Math.min(activity.length, visibleRows)));
  const hiddenCount = Math.max(0, activity.length - visible.length);

  return (
    <box flexDirection="column" width={width} height={height} border borderStyle="rounded" borderColor={C.border} padding={1} title={`Latest Activity · ${activity.length}`}>
      {visible.length === 0 ? (
        <text fg={C.dim}>{fitLine("No broker activity yet.", lineWidth)}</text>
      ) : (
        <>
          {visible.map((item) => {
            const title = sourceText(item.title || item.detail);
            const actor = sourceText(item.actorName || displayName(item.actorId));
            const line = `${formatClock(item.timestamp)}  ${fitLine(item.kind, kindWidth)} ${fitLine(actor, actorWidth)} ${fitLine(title, titleWidth)}`;
            return (
              <box key={item.id} height={1}>
                <text fg={activityTone(item)}>
                  {fitLine(line, lineWidth)}
                </text>
              </box>
            );
          })}
          {hiddenCount > 0 ? (
            <box height={1}>
              <text fg={C.dim}>{fitLine(`${hiddenCount} older events in tail`, lineWidth)}</text>
            </box>
          ) : null}
        </>
      )}
    </box>
  );
}

function HomeSummaryStrip({
  snapshot,
  width,
}: {
  snapshot: ScoutMonitorSnapshot;
  width: number;
}) {
  const counts = snapshot.brokerHealth.counts;
  const parts = [
    snapshot.brokerHealth.ok ? "broker online" : "broker offline",
    `${snapshot.agents.length} agents`,
    statusSummary(snapshot.agents),
    `${snapshot.activity.length} recent`,
    counts ? `${counts.messages} msgs` : null,
  ].filter((part): part is string => Boolean(part));

  return (
    <box
      width={width}
      height={3}
      border
      borderStyle="rounded"
      borderColor={snapshot.brokerHealth.ok ? C.border : C.red}
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={snapshot.brokerHealth.ok ? C.accent : C.red}>
        {fitLine(parts.join("  ·  "), Math.max(24, width - 4))}
      </text>
    </box>
  );
}

function HomePanel({
  snapshot,
  width,
  height,
}: {
  snapshot: ScoutMonitorSnapshot;
  width: number;
  height: number;
}) {
  const contentHeight = Math.max(10, height - 5);
  const summaryHeight = 3;
  const bodyHeight = Math.max(6, contentHeight - summaryHeight - 1);
  const wide = width >= 112;
  const activityHeight = wide ? bodyHeight : Math.max(3, Math.min(5, Math.floor(bodyHeight * 0.36)));
  const agentsHeight = wide ? bodyHeight : Math.max(3, bodyHeight - activityHeight - 1);
  const agentWidth = wide ? Math.max(56, Math.floor(width * 0.58)) : Math.max(32, width - 2);
  const sideWidth = wide ? Math.max(36, width - agentWidth - 5) : Math.max(32, width - 2);
  const fullWidth = Math.max(32, width - 2);

  return (
    <box flexDirection="column" flexGrow={1} gap={1} paddingLeft={1} paddingRight={1} paddingBottom={1}>
      <HomeSummaryStrip snapshot={snapshot} width={fullWidth} />
      {wide ? (
        <box flexDirection="row" height={bodyHeight} gap={1}>
          <AgentListPanel agents={snapshot.agents} width={agentWidth} height={agentsHeight} />
          <ActivityPanel activity={snapshot.activity} width={sideWidth} height={activityHeight} />
        </box>
      ) : (
        <box flexDirection="column" height={bodyHeight} gap={1}>
          <AgentListPanel agents={snapshot.agents} width={agentWidth} height={agentsHeight} />
          <ActivityPanel activity={snapshot.activity} width={sideWidth} height={activityHeight} />
        </box>
      )}
    </box>
  );
}

type TailLine = {
  key: string;
  timestamp: number;
  color: string;
  text: string;
};

function buildTailLines(snapshot: ScoutMonitorSnapshot, width: number): TailLine[] {
  const seenMessageIds = new Set(snapshot.activity.map((item) => item.id));
  const activityLines = snapshot.activity.map((item): TailLine => {
    const title = sourceText(item.detail || item.title);
    const actor = sourceText(item.actorName || displayName(item.actorId));
    return {
      key: `activity:${item.id}`,
      timestamp: normalizeTimestamp(item.timestamp) ?? 0,
      color: activityTone(item),
      text: `${formatClock(item.timestamp)}  ${item.kind.padEnd(7, " ")}  ${actor}  ${title}`,
    };
  });
  const messageLines = snapshot.recentMessages
    .filter((message) => !seenMessageIds.has(message.id))
    .flatMap((message): TailLine[] => {
      const timestamp = normalizeTimestamp(message.createdAt) ?? 0;
      const actor = truncate(sourceText(displayName(message.actorId)), 12).padEnd(12, " ");
      return wrapText(sourceText(message.body), Math.max(24, width - 28)).map((line, index) => ({
        key: `message:${message.id}:${index}`,
        timestamp,
        color: messageTone(message),
        text: index === 0
          ? `${formatClock(message.createdAt)}  message  ${actor}  ${line}`
          : `${" ".repeat(10)}${" ".repeat(9)}${" ".repeat(12)}  ${line}`,
      }));
    });

  return [...activityLines, ...messageLines]
    .sort((left, right) => left.timestamp - right.timestamp || left.key.localeCompare(right.key));
}

function TailPanel({
  snapshot,
  scrollOffset,
  width,
  height,
}: {
  snapshot: ScoutMonitorSnapshot;
  scrollOffset: number;
  width: number;
  height: number;
}) {
  const panelHeight = Math.max(6, height);
  const rendered = buildTailLines(snapshot, width);
  const availableRows = Math.max(3, panelHeight - 4);
  const end = Math.max(0, rendered.length - scrollOffset);
  const start = Math.max(0, end - availableRows);
  const visible = rendered.slice(start, end);

  return (
    <box flexDirection="column" width={width} height={panelHeight} border borderStyle="rounded" borderColor={C.border} padding={1} title={`Tail · #${snapshot.channel}`}>
      {visible.length === 0 ? (
        <text fg={C.dim}>{fitLine("No tail events yet.", width - 4)}</text>
      ) : (
        visible.map((line) => (
          <box key={line.key} height={1}>
            <text fg={line.color}>
              {fitLine(line.text, width - 4)}
            </text>
          </box>
        ))
      )}
      {scrollOffset > 0 ? <text fg={C.yellow}>↑ {scrollOffset} newer lines below</text> : null}
    </box>
  );
}

function StatusBar({ tab }: { tab: MonitorTab }) {
  const hints: Record<MonitorTab, string> = {
    home: "1 home  2 tail  3 new",
    tail: "↑↓ scroll  1 home  3 new",
    new: "1 home  2 tail",
  };

  return (
    <box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1} height={2}>
      <text fg={C.dim}>{hints[tab]}</text>
      <text fg={C.dim}>r refresh  q quit</text>
    </box>
  );
}

function sortMessages(messages: ScoutBrokerMessageRecord[]): ScoutBrokerMessageRecord[] {
  return messages
    .slice()
    .sort((left, right) => {
      const leftTs = normalizeTimestamp(left.createdAt) ?? 0;
      const rightTs = normalizeTimestamp(right.createdAt) ?? 0;
      if (leftTs !== rightTs) return leftTs - rightTs;
      return String(left.id).localeCompare(String(right.id));
    });
}

export function ScoutMonitorApp(props: ScoutMonitorAppProps) {
  const { width, height } = useTerminalDimensions();
  const [tab, setTab] = useState<MonitorTab>("home");
  const [snapshot, setSnapshot] = useState<ScoutMonitorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const stopped = useRef(false);
  const refreshRunning = useRef(false);
  const refreshQueued = useRef(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sseAbort = useRef<AbortController | null>(null);

  const clearPollTimer = useCallback(() => {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const clearEventTimer = useCallback(() => {
    if (eventRefreshTimer.current) {
      clearTimeout(eventRefreshTimer.current);
      eventRefreshTimer.current = null;
    }
  }, []);

  const refresh = useCallback(async () => {
    if (stopped.current) {
      return;
    }
    if (refreshRunning.current) {
      refreshQueued.current = true;
      return;
    }

    refreshRunning.current = true;
    setLoading(true);
    try {
      do {
        refreshQueued.current = false;
        const next = await loadScoutMonitorSnapshot({
          currentDirectory: props.currentDirectory,
          channel: props.channel,
          limit: props.limit,
        });
        if (stopped.current) return;
        setSnapshot(next);
        setRefreshError(null);
        setScrollOffset((current) => Math.max(0, current));
      } while (refreshQueued.current && !stopped.current);
    } catch (error) {
      if (!stopped.current) {
        setRefreshError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      refreshRunning.current = false;
      if (!stopped.current) {
        setLoading(false);
      }
    }
  }, [props.channel, props.currentDirectory, props.limit]);

  const queueEventRefresh = useCallback(() => {
    if (stopped.current) return;
    clearEventTimer();
    eventRefreshTimer.current = setTimeout(() => {
      eventRefreshTimer.current = null;
      void refresh();
    }, 250);
  }, [clearEventTimer, refresh]);

  const shutdown = useCallback(() => {
    if (stopped.current) return;
    stopped.current = true;
    clearPollTimer();
    clearEventTimer();
    sseAbort.current?.abort();
    sseAbort.current = null;
    props.onQuit();
  }, [clearEventTimer, clearPollTimer, props]);

  const pollMs = Math.max(props.refreshIntervalMs, 5_000);
  useEffect(() => {
    stopped.current = false;

    async function tick() {
      await refresh();
      if (stopped.current) return;
      pollTimer.current = setTimeout(() => void tick(), pollMs);
    }

    void tick();
    return () => {
      stopped.current = true;
      clearPollTimer();
      clearEventTimer();
      sseAbort.current?.abort();
      sseAbort.current = null;
    };
  }, [clearEventTimer, clearPollTimer, pollMs, refresh]);

  useEffect(() => {
    const controller = new AbortController();
    sseAbort.current = controller;
    const relayConversationId = scoutConversationIdForChannel(props.channel);

    async function connect() {
      try {
        const response = await fetch(new URL(scoutBrokerPaths.v1.eventsStream, resolveScoutBrokerUrl()), {
          headers: { accept: "text/event-stream" },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) return;

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          while (true) {
            const index = buffer.indexOf("\n\n");
            if (index === -1) break;
            const block = buffer.slice(0, index).trim();
            buffer = buffer.slice(index + 2);
            if (!block) continue;

            let eventName = "";
            const dataLines: string[] = [];
            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) eventName = line.slice(6).trim();
              if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
            }
            if (dataLines.length === 0) continue;

            let event: { kind?: string; payload?: Record<string, unknown> };
            try {
              event = JSON.parse(dataLines.join("\n"));
            } catch {
              continue;
            }

            const kind = eventName || event.kind;
            if (kind === "message.posted" || event.kind === "message.posted") {
              const message = event.payload?.message as ScoutBrokerMessageRecord | undefined;
              if (!message) continue;
              if (message.conversationId === relayConversationId) {
                setSnapshot((current) => {
                  if (!current || current.recentMessages.some((entry) => entry.id === message.id)) {
                    return current;
                  }
                  const recentMessages = sortMessages([...current.recentMessages, message]).slice(-props.limit);
                  return { ...current, recentMessages, refreshedAt: Date.now() };
                });
              }
              queueEventRefresh();
              continue;
            }

            if (
              kind === "agent.endpoint.upserted"
              || kind === "flight.updated"
              || kind === "collaboration.updated"
            ) {
              queueEventRefresh();
            }
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      }
    }

    void connect();
    return () => {
      controller.abort();
      if (sseAbort.current === controller) {
        sseAbort.current = null;
      }
    };
  }, [props.channel, props.limit, queueEventRefresh]);

  useKeyboard((key) => {
    if (key.name === "q" || key.name === "escape" || (key.name === "c" && key.ctrl)) {
      shutdown();
      return;
    }
    if (key.name === "r") {
      void refresh();
      return;
    }
    if (key.name === "tab") {
      setTab((current) => {
        const index = MONITOR_TABS.indexOf(current);
        return MONITOR_TABS[(index + 1) % MONITOR_TABS.length] ?? "home";
      });
      return;
    }
    if (key.name === "1") {
      setTab("home");
      return;
    }
    if (key.name === "2") {
      setTab("tail");
      return;
    }
    if (key.name === "3") {
      setTab("new");
      return;
    }
    if (key.name === "n") {
      setTab("new");
      return;
    }
    if (tab === "tail" && key.name === "up") {
      setScrollOffset((current) => current + 1);
      return;
    }
    if (tab === "tail" && key.name === "down") {
      setScrollOffset((current) => Math.max(0, current - 1));
    }
  });

  const content = useMemo(() => {
    if (!snapshot) {
      return (
        <box flexGrow={1} padding={1}>
          <text fg={refreshError ? C.red : C.dim}>
            {refreshError ? `Scout TUI failed: ${refreshError}` : "Loading Scout broker aggregate..."}
          </text>
        </box>
      );
    }

    if (tab === "home") {
      return (
        <HomePanel
          snapshot={snapshot}
          width={width}
          height={height}
        />
      );
    }

    if (tab === "tail") {
      return (
        <box flexGrow={1} paddingLeft={1} paddingRight={1} paddingBottom={1}>
          <TailPanel snapshot={snapshot} scrollOffset={scrollOffset} width={Math.max(32, width - 2)} height={Math.max(8, height - 5)} />
        </box>
      );
    }

    return (
      <box flexGrow={1} paddingLeft={1} paddingRight={1} paddingBottom={1}>
        <NewAgentPanel snapshot={snapshot} width={Math.max(32, width - 2)} height={Math.max(8, height - 5)} />
      </box>
    );
  }, [height, refreshError, scrollOffset, snapshot, tab, width]);

  return (
    <box flexDirection="column" width={width} height={height} backgroundColor={C.bg}>
      <Header snapshot={snapshot} loading={loading} tab={tab} />
      {content}
      <StatusBar tab={tab} />
    </box>
  );
}
