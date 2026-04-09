/** @jsxImportSource @opentui/react */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";

import type { ScoutAgentStatus } from "../../core/agents/service.ts";
import { type ScoutMonitorSnapshot, loadScoutMonitorSnapshot } from "../../core/monitor/service.ts";
import type { ScoutBrokerMessageRecord, ScoutWhoEntry } from "../../core/broker/service.ts";

export type ScoutMonitorAppProps = {
  currentDirectory: string;
  channel?: string;
  limit: number;
  refreshIntervalMs: number;
  onQuit: () => void;
};

type MonitorTab = "relay" | "agents" | "stats";

const C = {
  accent: "#34d399",
  dim: "#6b7280",
  muted: "#9ca3af",
  text: "#e5e7eb",
  bg: "#09090b",
  panel: "#111317",
  border: "#2b303b",
  red: "#f87171",
  yellow: "#fbbf24",
  cyan: "#22d3ee",
  blue: "#60a5fa",
};

function shortAgentName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "unknown";
  }
  return trimmed.split(".")[0] || trimmed;
}

function formatClock(value: number): string {
  const date = new Date(value * 1000);
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((entry) => String(entry).padStart(2, "0"))
    .join(":");
}

function formatRelative(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value)) {
    return "not seen";
  }
  const age = Math.max(0, Math.floor(Date.now() / 1000) - value);
  if (age < 60) return `${age}s ago`;
  if (age < 3_600) return `${Math.floor(age / 60)}m ago`;
  if (age < 86_400) return `${Math.floor(age / 3_600)}h ago`;
  return `${Math.floor(age / 86_400)}d ago`;
}

function formatUptime(value: number): string {
  const age = Math.max(0, Math.floor(Date.now() / 1000) - value);
  if (age < 60) return `${age}s`;
  if (age < 3_600) return `${Math.floor(age / 60)}m`;
  return `${Math.floor(age / 3_600)}h ${Math.floor((age % 3_600) / 60)}m`;
}

function truncate(value: string, width: number): string {
  if (width <= 0) return "";
  if (value.length <= width) return value;
  if (width === 1) return value.slice(0, 1);
  return `${value.slice(0, width - 1)}…`;
}

function wrapText(value: string, width: number): string[] {
  if (width <= 0) return [];
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) return [""];
  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      current = word;
      continue;
    }
    if (current.length + 1 + word.length <= width) {
      current = `${current} ${word}`;
      continue;
    }
    lines.push(current);
    current = word.length > width ? truncate(word, width) : word;
  }
  if (current.length > 0) {
    lines.push(current);
  }
  return lines;
}

function messageTone(message: ScoutBrokerMessageRecord): string {
  if (message.class === "status") return C.yellow;
  if (message.class === "system") return C.dim;
  return C.text;
}

function Header({
  tab,
  snapshot,
  loading,
}: {
  tab: MonitorTab;
  snapshot: ScoutMonitorSnapshot | null;
  loading: boolean;
}) {
  const tabs: MonitorTab[] = ["relay", "agents", "stats"];
  const counts = snapshot?.brokerStatus.health.counts;

  return (
    <box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1} paddingTop={1} height={3}>
      <box flexDirection="row" gap={1}>
        <text fg={C.accent}>◆</text>
        <text fg={C.text}>SCOUT</text>
        <text fg={C.dim}>monitor</text>
        <text fg={C.dim}>│</text>
        {tabs.map((entry) => (
          <text key={entry} fg={entry === tab ? C.text : C.dim}>
            {entry === tab ? `[${entry}]` : ` ${entry} `}
          </text>
        ))}
        {loading ? <text fg={C.yellow}>refreshing</text> : null}
      </box>
      <box flexDirection="row" gap={2}>
        {counts ? <text fg={C.dim}>{counts.agents} agents</text> : null}
        {counts ? <text fg={C.dim}>{counts.messages} msgs</text> : null}
        <text fg={C.dim}>{snapshot ? formatClock(snapshot.refreshedAt) : "--:--:--"}</text>
      </box>
    </box>
  );
}

function AgentCockpit({ localAgents }: { localAgents: ScoutAgentStatus[] }) {
  const visible = localAgents.slice(0, 5);

  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={C.border}
      padding={1}
      marginLeft={1}
      marginRight={1}
      title="Local Agents"
    >
      {visible.length === 0 ? (
        <text fg={C.dim}>No local Scout agents are configured.</text>
      ) : (
        visible.map((agent) => {
          const statusColor = agent.isOnline ? C.accent : C.dim;
          const icon = agent.isOnline ? "●" : "○";
          const left = `${icon} ${truncate(agent.projectName, 18)}`;
          const middle = `${agent.harness} · ${agent.isOnline ? `up ${formatUptime(agent.startedAt)}` : "down"}`;
          const right = `session ${truncate(agent.sessionId, 18)}`;
          return (
            <box key={agent.agentId} flexDirection="row" justifyContent="space-between">
              <text fg={statusColor}>{left}</text>
              <text fg={agent.isOnline ? C.yellow : C.muted}>{truncate(middle, 26)}</text>
              <text fg={C.dim}>{truncate(right, 28)}</text>
            </box>
          );
        })
      )}
    </box>
  );
}

function ChatPanel({
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
  const bodyWidth = Math.max(24, width - 20);
  const ordered = snapshot.recentMessages
    .slice()
    .sort((left, right) => {
      const leftTs = left.createdAt;
      const rightTs = right.createdAt;
      if (leftTs !== rightTs) return leftTs - rightTs;
      return String(left.id).localeCompare(String(right.id));
    });

  const rendered = ordered.flatMap((message) => {
    const actor = truncate(shortAgentName(message.actorId), 12).padEnd(12, " ");
    const stamp = formatClock(Math.floor(message.createdAt / 1000));
    const lines = wrapText(message.body, bodyWidth);
    const color = messageTone(message);
    return lines.map((line, index) => ({
      key: `${message.id}:${index}`,
      color,
      text: index === 0
        ? `${stamp}  ${actor}  ${line}`
        : `${" ".repeat(8)}  ${" ".repeat(12)}  ${line}`,
    }));
  });

  const availableRows = Math.max(4, height - 4);
  const end = Math.max(0, rendered.length - scrollOffset);
  const start = Math.max(0, end - availableRows);
  const visible = rendered.slice(start, end);

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      border
      borderStyle="rounded"
      borderColor={C.border}
      padding={1}
      title={`Relay · #${snapshot.channel}`}
    >
      {visible.length === 0 ? (
        <text fg={C.dim}>No relay traffic yet.</text>
      ) : (
        visible.map((line) => (
          <text key={line.key} fg={line.color}>
            {truncate(line.text, width - 4)}
          </text>
        ))
      )}
      {scrollOffset > 0 ? <text fg={C.yellow}>↑ {scrollOffset} newer lines below</text> : null}
    </box>
  );
}

function OverviewPanel({ snapshot }: { snapshot: ScoutMonitorSnapshot }) {
  const brokerOk = snapshot.brokerStatus.reachable && snapshot.brokerStatus.health.ok;
  const counts = snapshot.brokerStatus.health.counts;
  return (
    <box
      flexDirection="column"
      width={36}
      border
      borderStyle="rounded"
      borderColor={brokerOk ? C.border : C.red}
      padding={1}
      title="Overview"
    >
      <text fg={brokerOk ? C.accent : C.red}>{brokerOk ? "broker online" : "broker offline"}</text>
      <text fg={C.dim}>{truncate(snapshot.brokerUrl, 30)}</text>
      <text fg={C.dim}>cwd {truncate(snapshot.currentDirectory, 30)}</text>
      <text fg={C.dim}>local {snapshot.localAgents.length}</text>
      <text fg={C.dim}>broker {snapshot.brokerAgents.length}</text>
      <text fg={C.dim}>msgs {snapshot.recentMessages.length}</text>
      {counts ? <text fg={C.dim}>registry {counts.conversations} convos</text> : null}
      {snapshot.errors.length > 0 ? <text fg={C.red}>{snapshot.errors.length} errors</text> : null}
    </box>
  );
}

function LocalAgentsPanel({ agents }: { agents: ScoutAgentStatus[] }) {
  return (
    <box
      flexDirection="column"
      flexGrow={1}
      border
      borderStyle="rounded"
      borderColor={C.border}
      padding={1}
      title={`Local (${agents.length})`}
    >
      {agents.length === 0 ? (
        <text fg={C.dim}>No local agents.</text>
      ) : (
        agents.map((agent) => (
          <box key={agent.agentId} flexDirection="column" marginBottom={1}>
            <text fg={agent.isOnline ? C.accent : C.muted}>
              {truncate(`${shortAgentName(agent.projectName)}.${agent.harness}`, 40)}
            </text>
            <text fg={C.dim}>
              {truncate(`${agent.isOnline ? "up" : "down"} · ${formatUptime(agent.startedAt)} · ${agent.source}`, 56)}
            </text>
            <text fg={C.dim}>{truncate(agent.projectRoot, 56)}</text>
          </box>
        ))
      )}
    </box>
  );
}

function BrokerAgentsPanel({ agents }: { agents: ScoutWhoEntry[] }) {
  const ordered = agents
    .slice()
    .sort((left, right) => {
      const leftTs = left.lastSeen ?? 0;
      const rightTs = right.lastSeen ?? 0;
      if (leftTs !== rightTs) return rightTs - leftTs;
      return left.agentId.localeCompare(right.agentId);
    });

  return (
    <box
      flexDirection="column"
      width={42}
      border
      borderStyle="rounded"
      borderColor={C.border}
      padding={1}
      title={`Broker (${ordered.length})`}
    >
      {ordered.length === 0 ? (
        <text fg={C.dim}>No broker agents.</text>
      ) : (
        ordered.map((agent) => (
          <box key={agent.agentId} flexDirection="column" marginBottom={1}>
            <text fg={agent.state === "idle" ? C.muted : C.accent}>
              {truncate(shortAgentName(agent.agentId), 32)}
            </text>
            <text fg={C.dim}>
              {truncate(`${agent.state} · ${agent.messages} msgs · ${formatRelative(agent.lastSeen)}`, 36)}
            </text>
            <text fg={C.dim}>{truncate(agent.agentId, 36)}</text>
          </box>
        ))
      )}
    </box>
  );
}

function StatsPanel({ snapshot }: { snapshot: ScoutMonitorSnapshot }) {
  const counts = snapshot.brokerStatus.health.counts;
  return (
    <box flexDirection="column" flexGrow={1} gap={1}>
      <box border borderStyle="rounded" borderColor={C.border} padding={1} title="Broker">
        <box flexDirection="column">
          <text fg={snapshot.brokerStatus.health.ok ? C.accent : C.red}>
            {snapshot.brokerStatus.health.ok ? "reachable" : "degraded"}
          </text>
          <text fg={C.dim}>url {snapshot.brokerUrl}</text>
          {counts ? <text fg={C.dim}>agents {counts.agents} · conversations {counts.conversations} · messages {counts.messages}</text> : null}
        </box>
      </box>
      <box border borderStyle="rounded" borderColor={C.border} padding={1} title="Workspace">
        <box flexDirection="column">
          <text fg={C.dim}>cwd {snapshot.currentDirectory}</text>
          <text fg={C.dim}>channel {snapshot.channel}</text>
          <text fg={C.dim}>local agents {snapshot.localAgents.length}</text>
          <text fg={C.dim}>recent lines {snapshot.recentMessages.length}</text>
        </box>
      </box>
      <box border borderStyle="rounded" borderColor={snapshot.errors.length > 0 ? C.red : C.border} padding={1} flexGrow={1} title="Errors">
        <box flexDirection="column">
          {snapshot.errors.length === 0 ? (
            <text fg={C.dim}>No active monitor errors.</text>
          ) : (
            snapshot.errors.map((error, index) => (
              <text key={index} fg={C.red}>
                {truncate(error, 100)}
              </text>
            ))
          )}
        </box>
      </box>
    </box>
  );
}

function StatusBar({ tab }: { tab: MonitorTab }) {
  const hints: Record<MonitorTab, string> = {
    relay: "tab switch  ↑↓ scroll  r refresh  q quit",
    agents: "tab switch  1 relay  2 agents  3 stats  r refresh  q quit",
    stats: "tab switch  1 relay  2 agents  3 stats  r refresh  q quit",
  };
  return (
    <box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1} height={2}>
      <text fg={C.dim}>{hints[tab]}</text>
      <text fg={C.dim}>OpenTUI Scout monitor</text>
    </box>
  );
}

export function ScoutMonitorApp(props: ScoutMonitorAppProps) {
  const { width, height } = useTerminalDimensions();
  const [tab, setTab] = useState<MonitorTab>("relay");
  const [snapshot, setSnapshot] = useState<ScoutMonitorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await loadScoutMonitorSnapshot({
        currentDirectory: props.currentDirectory,
        channel: props.channel,
        limit: props.limit,
      });
      setSnapshot(next);
      setRefreshError(null);
      setScrollOffset((current) => Math.max(0, current));
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [props.channel, props.currentDirectory, props.limit]);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, props.refreshIntervalMs);
    return () => clearInterval(interval);
  }, [props.refreshIntervalMs, refresh]);

  useKeyboard((key) => {
    if (key.name === "q" || (key.name === "c" && key.ctrl) || key.name === "escape") {
      props.onQuit();
      return;
    }
    if (key.name === "r") {
      void refresh();
      return;
    }
    if (key.name === "tab") {
      setTab((current) => current === "relay" ? "agents" : current === "agents" ? "stats" : "relay");
      return;
    }
    if (key.name === "1") {
      setTab("relay");
      return;
    }
    if (key.name === "2") {
      setTab("agents");
      return;
    }
    if (key.name === "3") {
      setTab("stats");
      return;
    }
    if (tab === "relay" && key.name === "up") {
      setScrollOffset((current) => current + 1);
      return;
    }
    if (tab === "relay" && key.name === "down") {
      setScrollOffset((current) => Math.max(0, current - 1));
    }
  });

  const content = useMemo(() => {
    if (!snapshot) {
      return (
        <box flexGrow={1} padding={1}>
          <text fg={refreshError ? C.red : C.dim}>
            {refreshError ? `Scout monitor failed: ${refreshError}` : "Loading Scout monitor…"}
          </text>
        </box>
      );
    }

    if (tab === "relay") {
      return (
        <box flexDirection="row" flexGrow={1} gap={1} paddingLeft={1} paddingRight={1} paddingBottom={1}>
          <ChatPanel snapshot={snapshot} scrollOffset={scrollOffset} width={Math.max(48, width - 40)} height={Math.max(12, height - 11)} />
          <OverviewPanel snapshot={snapshot} />
        </box>
      );
    }

    if (tab === "agents") {
      return (
        <box flexDirection="row" flexGrow={1} gap={1} paddingLeft={1} paddingRight={1} paddingBottom={1}>
          <LocalAgentsPanel agents={snapshot.localAgents} />
          <BrokerAgentsPanel agents={snapshot.brokerAgents} />
        </box>
      );
    }

    return (
      <box flexDirection="column" flexGrow={1} paddingLeft={1} paddingRight={1} paddingBottom={1}>
        <StatsPanel snapshot={snapshot} />
      </box>
    );
  }, [height, scrollOffset, snapshot, tab, width]);

  return (
    <box flexDirection="column" width={width} height={height} backgroundColor={C.bg}>
      <Header tab={tab} snapshot={snapshot} loading={loading} />
      <AgentCockpit localAgents={snapshot?.localAgents ?? []} />
      {content}
      <StatusBar tab={tab} />
    </box>
  );
}
