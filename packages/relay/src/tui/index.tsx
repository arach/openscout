#!/usr/bin/env bun

import React, { useState, useEffect, useCallback, useRef } from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useTerminalDimensions } from "@opentui/react";
import { existsSync, readFileSync, appendFileSync, writeFileSync, watchFile, unwatchFile, statSync, openSync, readSync, closeSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RelayMessage {
  id: number;
  timestamp: number;
  from: string;
  type: "MSG" | "ACK" | "SYS";
  body: string;
}

interface AgentInfo {
  name: string;
  messages: number;
  lastSeen: number;
  online: boolean;
}

interface DbEntry {
  timestamp: number;
  from: string;
  type: string;
  body: string;
  indexedAt: string;
}

type ActiveTab = "chat" | "agents" | "stats";

// ── Helpers ───────────────────────────────────────────────────────────────────

function ts(): string {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

function fmtTime(epoch: number): string {
  const d = new Date(epoch * 1000);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

function fmtRelative(epoch: number): string {
  const s = Math.floor(Date.now() / 1000 - epoch);
  if (s < 0) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function pad(s: string, width: number): string {
  return s + " ".repeat(Math.max(width - s.length, 0));
}

// ── Relay Data ────────────────────────────────────────────────────────────────

function findRelayDir(): string | null {
  const os = require("os");
  const homedir = os.homedir();

  // 1. Check local relay.json link
  const localLink = join(process.cwd(), ".openscout", "relay.json");
  if (existsSync(localLink)) {
    try {
      const config = JSON.parse(readFileSync(localLink, "utf8"));
      if (config.hub) {
        const hub = config.hub.replace(/^~/, homedir);
        if (existsSync(join(hub, "channel.log"))) return hub;
      }
    } catch { /* fall through */ }
  }

  // 2. Check global hub
  const globalHub = join(homedir, ".openscout", "relay");
  if (existsSync(join(globalHub, "channel.log"))) return globalHub;

  // 3. Legacy: check local .openscout/relay/
  const localRelay = join(process.cwd(), ".openscout", "relay");
  if (existsSync(join(localRelay, "channel.log"))) return localRelay;

  return null;
}

function parseLogLine(line: string, id: number): RelayMessage | null {
  const parts = line.split(" ");
  if (parts.length < 3) return null;
  const [tsStr, from, type, ...rest] = parts;
  const timestamp = Number(tsStr);
  if (!Number.isFinite(timestamp)) return null;
  return {
    id,
    timestamp,
    from,
    type: type as RelayMessage["type"],
    body: rest.join(" "),
  };
}

function readAllMessages(logPath: string): RelayMessage[] {
  if (!existsSync(logPath)) return [];
  try {
    return readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line, i) => parseLogLine(line, i + 1))
      .filter((m): m is RelayMessage => m !== null);
  } catch {
    return [];
  }
}

const ONLINE_THRESHOLD = 600; // 10 minutes

interface AgentStatus extends AgentInfo {
  status: "online" | "idle" | "forgotten";
}

function buildAgentMap(messages: RelayMessage[]): AgentStatus[] {
  const now = Math.floor(Date.now() / 1000);
  const map = new Map<string, AgentStatus>();
  for (const msg of messages) {
    if (!map.has(msg.from)) {
      map.set(msg.from, { name: msg.from, messages: 0, lastSeen: msg.timestamp, online: false, status: "idle" });
    }
    const agent = map.get(msg.from)!;
    agent.lastSeen = Math.max(agent.lastSeen, msg.timestamp);
    if (msg.type === "MSG") agent.messages++;
    if (msg.type === "SYS" && msg.body.includes("forgotten")) agent.status = "forgotten";
  }
  return [...map.values()]
    .map((a) => {
      if (a.status !== "forgotten") {
        a.status = (now - a.lastSeen) < ONLINE_THRESHOLD ? "online" : "idle";
        a.online = a.status === "online";
      }
      return a;
    })
    .sort((a, b) => {
      // online first, then idle, then forgotten
      const order = { online: 0, idle: 1, forgotten: 2 };
      const diff = order[a.status] - order[b.status];
      if (diff !== 0) return diff;
      return b.lastSeen - a.lastSeen;
    });
}

// ── Database (JSONL) ──────────────────────────────────────────────────────────

function getDbPath(relayDir: string): string {
  return join(relayDir, "messages.jsonl");
}

function syncToDb(relayDir: string, messages: RelayMessage[]): void {
  const dbPath = getDbPath(relayDir);
  // Count existing lines
  let existingCount = 0;
  if (existsSync(dbPath)) {
    try {
      existingCount = readFileSync(dbPath, "utf8").split("\n").filter(Boolean).length;
    } catch { /* noop */ }
  }
  // Only append new messages
  const newMessages = messages.slice(existingCount);
  if (newMessages.length === 0) return;
  const lines = newMessages
    .map((m) => JSON.stringify({
      timestamp: m.timestamp,
      from: m.from,
      type: m.type,
      body: m.body,
      indexedAt: new Date().toISOString(),
    } satisfies DbEntry))
    .join("\n") + "\n";
  appendFileSync(dbPath, lines);
}

function readDb(relayDir: string): DbEntry[] {
  const dbPath = getDbPath(relayDir);
  if (!existsSync(dbPath)) return [];
  try {
    return readFileSync(dbPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as DbEntry);
  } catch {
    return [];
  }
}

// ── Colors ────────────────────────────────────────────────────────────────────

const C = {
  accent: "#34d399",
  dim: "#666666",
  muted: "#999999",
  text: "#e5e5e5",
  bg: "#0a0a0a",
  panel: "#141414",
  border: "#333333",
  red: "#ef4444",
  yellow: "#eab308",
  cyan: "#22d3ee",
  blue: "#60a5fa",
};

// ── Components ────────────────────────────────────────────────────────────────

function Header({ tab, agentCount, msgCount }: { tab: ActiveTab; agentCount: number; msgCount: number }) {
  const [clock, setClock] = useState(ts());

  useEffect(() => {
    const iv = setInterval(() => setClock(ts()), 1000);
    return () => clearInterval(iv);
  }, []);

  const tabs: ActiveTab[] = ["chat", "agents", "stats"];

  return (
    <box flexDirection="row" justifyContent="space-between" padding={1} height={3}>
      <box flexDirection="row" gap={1}>
        <text fg={C.accent}><strong>◆</strong></text>
        <text fg={C.text}><strong> RELAY </strong></text>
        <text fg={C.dim}>monitor</text>
        <text fg={C.dim}>│</text>
        {tabs.map((t) => (
          <text key={t} fg={t === tab ? C.text : C.dim}>
            {t === tab ? <strong>{` ${t} `}</strong> : ` ${t} `}
          </text>
        ))}
      </box>
      <box flexDirection="row" gap={2}>
        <text fg={C.dim}><span fg={C.text}>{agentCount}</span> agents</text>
        <text fg={C.dim}><span fg={C.text}>{msgCount}</span> msgs</text>
        <text fg={C.dim}>{clock}</text>
      </box>
    </box>
  );
}

function ChatPanel({
  messages,
  selectedId,
  scrollOffset,
  maxVisible,
}: {
  messages: RelayMessage[];
  selectedId: number;
  scrollOffset: number;
  maxVisible: number;
}) {
  const visible = messages.slice(
    Math.max(0, messages.length - maxVisible - scrollOffset),
    messages.length - scrollOffset
  );

  return (
    <box flexDirection="column" flexGrow={1} border borderStyle="rounded" borderColor={C.border} padding={1}>
      {visible.length === 0 ? (
        <text fg={C.dim}>No messages yet. Waiting for relay activity...</text>
      ) : (
        visible.map((msg) => {
          const isSelected = msg.id === selectedId;
          const time = fmtTime(msg.timestamp);

          if (msg.type === "SYS") {
            return (
              <box key={msg.id} flexDirection="row" gap={1}>
                <text fg={C.dim}>{time}</text>
                <text fg={C.dim}>∙ {msg.body}</text>
              </box>
            );
          }

          if (msg.type === "ACK") {
            return (
              <box key={msg.id} flexDirection="row" gap={1}>
                <text fg={C.dim}>{time}</text>
                <text fg={C.dim}>{msg.from} ✓ ack {msg.body}</text>
              </box>
            );
          }

          return (
            <box key={msg.id} flexDirection="row" gap={1}>
              {isSelected && <text fg={C.accent}>▸</text>}
              {!isSelected && <text fg={C.dim}> </text>}
              <text fg={C.dim}>{time}</text>
              <text fg={C.accent}><strong>{pad(msg.from, 14)}</strong></text>
              <text fg={C.text}>{msg.body}</text>
            </box>
          );
        })
      )}
      {scrollOffset > 0 && (
        <box flexDirection="row" justifyContent="space-between">
          <text fg={C.yellow}>↑ {scrollOffset} more below</text>
        </box>
      )}
    </box>
  );
}

function AgentsPanel({ agents }: { agents: AgentStatus[] }) {
  const alive = agents.filter((a) => a.status !== "forgotten");
  const forgotten = agents.filter((a) => a.status === "forgotten");

  const statusIcon = (s: AgentStatus["status"]) =>
    s === "online" ? "●" : s === "idle" ? "○" : "✗";
  const statusColor = (s: AgentStatus["status"]) =>
    s === "online" ? C.accent : s === "idle" ? C.muted : C.dim;
  const statusLabel = (s: AgentStatus["status"]) =>
    s === "online" ? "online" : s === "idle" ? "idle" : "removed";

  return (
    <box flexDirection="column" flexGrow={1} gap={1}>
      <box border borderStyle="rounded" borderColor={C.border} padding={1} flexDirection="column" title={`Active (${alive.length})`}>
        {alive.length === 0 ? (
          <text fg={C.dim}>No agents have used the relay yet</text>
        ) : (
          <>
            <box flexDirection="row" gap={2}>
              <text fg={C.dim}>{pad("", 2)}</text>
              <text fg={C.dim}>{pad("agent", 18)}</text>
              <text fg={C.dim}>{pad("messages", 10)}</text>
              <text fg={C.dim}>{pad("last seen", 14)}</text>
              <text fg={C.dim}>status</text>
            </box>
            {alive.map((agent) => (
              <box key={agent.name} flexDirection="row" gap={2}>
                <text fg={statusColor(agent.status)}>{statusIcon(agent.status)}</text>
                <text fg={C.text}><strong>{pad(agent.name, 18)}</strong></text>
                <text fg={C.cyan}>{pad(String(agent.messages), 10)}</text>
                <text fg={C.muted}>{pad(fmtRelative(agent.lastSeen), 14)}</text>
                <text fg={statusColor(agent.status)}>{statusLabel(agent.status)}</text>
              </box>
            ))}
          </>
        )}
      </box>
      {forgotten.length > 0 && (
        <box border borderStyle="rounded" borderColor={C.border} padding={1} flexDirection="column" title={`Removed (${forgotten.length})`}>
          {forgotten.map((agent) => (
            <box key={agent.name} flexDirection="row" gap={2}>
              <text fg={C.dim}>✗</text>
              <text fg={C.dim}>{pad(agent.name, 18)}</text>
              <text fg={C.dim}>{pad(String(agent.messages), 10)}</text>
              <text fg={C.dim}>{fmtRelative(agent.lastSeen)}</text>
            </box>
          ))}
        </box>
      )}
    </box>
  );
}

function StatsPanel({ messages, agents, dbEntries }: { messages: RelayMessage[]; agents: AgentInfo[]; dbEntries: number }) {
  const msgOnly = messages.filter((m) => m.type === "MSG");
  const sysOnly = messages.filter((m) => m.type === "SYS");
  const onlineCount = agents.filter((a) => a.online).length;

  // Messages per agent
  const perAgent = agents
    .filter((a) => a.messages > 0)
    .sort((a, b) => b.messages - a.messages);

  // Activity timeline — last 60 minutes in 6 buckets of 10m each
  const now = Math.floor(Date.now() / 1000);
  const buckets = Array.from({ length: 6 }, (_, i) => {
    const start = now - (6 - i) * 600;
    const end = start + 600;
    return msgOnly.filter((m) => m.timestamp >= start && m.timestamp < end).length;
  });
  const maxBucket = Math.max(...buckets, 1);
  const bars = "▁▂▃▄▅▆▇█";
  const sparkline = buckets.map((b) => bars[Math.min(Math.floor((b / maxBucket) * (bars.length - 1)), bars.length - 1)]).join("");

  return (
    <box flexDirection="column" flexGrow={1} gap={1}>
      {/* Overview */}
      <box border borderStyle="rounded" borderColor={C.border} padding={1} flexDirection="column" title="Overview">
        <box flexDirection="row" gap={3}>
          <text fg={C.dim}>total messages <span fg={C.text}>{messages.length}</span></text>
          <text fg={C.dim}>MSG <span fg={C.cyan}>{msgOnly.length}</span></text>
          <text fg={C.dim}>SYS <span fg={C.muted}>{sysOnly.length}</span></text>
        </box>
        <box flexDirection="row" gap={3}>
          <text fg={C.dim}>agents <span fg={C.text}>{agents.length}</span></text>
          <text fg={C.dim}>online <span fg={C.accent}>{onlineCount}</span></text>
          <text fg={C.dim}>db entries <span fg={C.text}>{dbEntries}</span></text>
        </box>
      </box>

      {/* Activity sparkline */}
      <box border borderStyle="rounded" borderColor={C.border} padding={1} flexDirection="column" title="Activity (last 60m)">
        <box flexDirection="row" gap={1}>
          <text fg={C.accent}>{sparkline}</text>
          <text fg={C.dim}> {buckets.map(String).join(" ")}</text>
        </box>
        <text fg={C.dim}>└─ 60m ago ─────────── now ─┘</text>
      </box>

      {/* Leaderboard */}
      <box border borderStyle="rounded" borderColor={C.border} padding={1} flexDirection="column" flexGrow={1} title="Messages by Agent">
        {perAgent.length === 0 ? (
          <text fg={C.dim}>No messages yet</text>
        ) : (
          perAgent.map((agent) => {
            const pct = msgOnly.length > 0 ? Math.round((agent.messages / msgOnly.length) * 100) : 0;
            const barLen = msgOnly.length > 0 ? Math.max(1, Math.round((agent.messages / msgOnly.length) * 20)) : 0;
            const bar = "█".repeat(barLen) + "░".repeat(20 - barLen);
            return (
              <box key={agent.name} flexDirection="row" gap={2}>
                <text fg={C.text}>{pad(agent.name, 16)}</text>
                <text fg={C.accent}>{bar}</text>
                <text fg={C.muted}>{agent.messages} ({pct}%)</text>
              </box>
            );
          })
        )}
      </box>
    </box>
  );
}

function StatusBar({ tab }: { tab: ActiveTab }) {
  const hints: Record<ActiveTab, string> = {
    chat: "↑↓ scroll  c copy  tab switch  r refresh  q quit",
    agents: "tab switch  r refresh  q quit",
    stats: "tab switch  r refresh  x clear  q quit",
  };

  return (
    <box flexDirection="row" padding={1} height={3} justifyContent="space-between">
      <text fg={C.dim}>{hints[tab]}</text>
      <text fg={C.dim}>1 chat  2 agents  3 stats</text>
    </box>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

function App() {
  const { width, height } = useTerminalDimensions();
  const [tab, setTab] = useState<ActiveTab>("chat");
  const [messages, setMessages] = useState<RelayMessage[]>([]);
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [dbEntries, setDbEntries] = useState(0);
  const [selectedId, setSelectedId] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const relayDirRef = useRef<string | null>(null);
  const filePosRef = useRef(0);

  const maxVisible = Math.max(height - 10, 5);

  const refresh = useCallback(() => {
    const relayDir = relayDirRef.current;
    if (!relayDir) return;

    const logPath = join(relayDir, "channel.log");
    const allMessages = readAllMessages(logPath);
    setMessages(allMessages);
    setAgents(buildAgentMap(allMessages));

    // Sync to JSONL database
    syncToDb(relayDir, allMessages);
    setDbEntries(allMessages.length);

    // Auto-select newest message and reset scroll to bottom
    if (allMessages.length > 0) {
      setSelectedId(allMessages[allMessages.length - 1].id);
      setScrollOffset(0);
    }
  }, []);

  // Initial setup
  useEffect(() => {
    const relayDir = findRelayDir();
    if (!relayDir) {
      console.error("No relay found. Run: openscout relay init");
      process.exit(1);
    }
    relayDirRef.current = relayDir;

    // TUI identity — the human operator
    const logPath = join(relayDir, "channel.log");
    const asIdx = process.argv.indexOf("--as");
    const tuiName = asIdx !== -1 && process.argv[asIdx + 1]
      ? process.argv[asIdx + 1]
      : process.env.OPENSCOUT_AGENT || require("os").userInfo().username;
    const now = Math.floor(Date.now() / 1000);
    appendFileSync(logPath, `${now} ${tuiName} SYS ${tuiName} monitoring the relay\n`);

    // Heartbeat — keep TUI showing as online
    const heartbeatIv = setInterval(() => {
      const t = Math.floor(Date.now() / 1000);
      appendFileSync(logPath, `${t} ${tuiName} SYS heartbeat\n`);
    }, ONLINE_THRESHOLD * 500); // halfway through threshold (5 min for 10 min threshold)

    // Initial load
    refresh();

    // Watch for changes using polling (more reliable than fs.watch for appends)
    const iv = setInterval(() => {
      try {
        const stat = statSync(logPath);
        if (stat.size !== filePosRef.current) {
          filePosRef.current = stat.size;
          refresh();
        }
      } catch { /* file may not exist yet */ }
    }, 500);

    // Periodic refresh for online/offline status updates
    const statusIv = setInterval(() => refresh(), 5000);

    return () => {
      clearInterval(iv);
      clearInterval(statusIv);
      clearInterval(heartbeatIv);
      const t = Math.floor(Date.now() / 1000);
      appendFileSync(logPath, `${t} ${tuiName} SYS ${tuiName} stopped monitoring\n`);
    };
  }, [refresh]);

  // Keyboard
  useKeyboard((key) => {
    if (key.name === "escape" || (key.name === "c" && key.ctrl) || key.name === "q") {
      quit();
    }

    if (key.name === "tab") {
      setTab((prev) => {
        const tabs: ActiveTab[] = ["chat", "agents", "stats"];
        const dir = key.shift ? -1 : 1;
        return tabs[(tabs.indexOf(prev) + dir + tabs.length) % tabs.length];
      });
    }

    if (key.name === "1") setTab("chat");
    if (key.name === "2") setTab("agents");
    if (key.name === "3") setTab("stats");
    if (key.name === "r") refresh();

    // Chat navigation
    if (tab === "chat") {
      if (key.name === "up") {
        setScrollOffset((prev) => Math.min(prev + 1, Math.max(0, messages.length - maxVisible)));
      }
      if (key.name === "down") {
        setScrollOffset((prev) => Math.max(prev - 1, 0));
      }
      if (key.name === "c") {
        const msg = messages.find((m) => m.id === selectedId);
        if (msg) {
          try {
            execSync("pbcopy", { input: msg.body });
          } catch { /* noop */ }
        }
      }
    }

    if (tab === "stats" && key.name === "x") {
      const relayDir = relayDirRef.current;
      if (relayDir) {
        const dbPath = getDbPath(relayDir);
        try {
          writeFileSync(dbPath, "");
          setDbEntries(0);
        } catch { /* noop */ }
      }
    }
  });

  return (
    <box flexDirection="column" width={width} height={height} backgroundColor={C.bg}>
      <Header tab={tab} agentCount={agents.length} msgCount={messages.filter((m) => m.type === "MSG").length} />

      <box flexDirection="row" flexGrow={1}>
        <box flexDirection="column" flexGrow={1}>
          {tab === "chat" && (
            <ChatPanel
              messages={messages}
              selectedId={selectedId}
              scrollOffset={scrollOffset}
              maxVisible={maxVisible}
            />
          )}
          {tab === "agents" && <AgentsPanel agents={agents} />}
          {tab === "stats" && <StatsPanel messages={messages} agents={agents} dbEntries={dbEntries} />}
        </box>
      </box>

      <StatusBar tab={tab} />
    </box>
  );
}

// ── Entry ─────────────────────────────────────────────────────────────────────

const renderer = await createCliRenderer();

function quit() {
  renderer.destroy();
}

createRoot(renderer).render(<App />);
