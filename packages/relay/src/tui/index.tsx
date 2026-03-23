#!/usr/bin/env bun

import React, { useState, useEffect, useCallback, useRef } from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useTerminalDimensions } from "@opentui/react";
import { existsSync, readFileSync, appendFileSync, writeFileSync, statSync } from "fs";
import { homedir, userInfo } from "os";
import { join } from "path";
import { execSync } from "child_process";
import {
  appendRelayEvent,
  appendRelayMessage,
  createRelayEventId,
  DEFAULT_USER_TWIN,
  getUserTwinName as resolveUserTwinName,
  getRelayEventsPath,
  readProjectedRelayAgentStatesSync,
  readProjectedRelayFlightsSync,
  readProjectedRelayMessagesSync,
  readProjectedRelayTwinsSync,
  type ProjectTwinRecord,
  type ProjectedRelayMessage,
} from "../core/index.js";


// ── Flights (tracked requests with callbacks) ────────────────────────────────

type Flight = Awaited<ReturnType<typeof readProjectedRelayFlightsSync>>[number];

async function createFlight(relayDir: string, from: string, to: string, message: string): Promise<Flight> {
  const flightId = `f-${Date.now().toString(36)}`;
  const ts = Math.floor(Date.now() / 1000);

  await appendRelayEvent(relayDir, {
    id: createRelayEventId("flight"),
    kind: "flight.opened",
    v: 1,
    ts,
    actor: from,
    payload: {
      flightId,
      to,
      message,
    },
  });

  return {
    id: flightId,
    from,
    to,
    message,
    sentAt: ts,
    status: "pending",
  };
}

// ── Vox Voice Integration ────────────────────────────────────────────────────

interface VoxSessionEvent {
  text?: string;
}

interface VoxLiveSessionLike {
  start(params?: Record<string, unknown>): Promise<unknown>;
  stop(): Promise<void>;
  on(event: "partial", handler: (event: VoxSessionEvent) => void): void;
  on(event: "final", handler: (event: VoxSessionEvent) => void): void;
  on(event: "error", handler: () => void): void;
}

interface VoxClientLike {
  connected: boolean;
  connect(): Promise<void>;
  disconnect(): void;
  createLiveSession(): VoxLiveSessionLike;
}

type VoxClientConstructor = new (options: { clientId: string }) => VoxClientLike;

let voxClient: VoxClientLike | null = null;
let voxAvailable = false;

let VoxClientClass: VoxClientConstructor | null = null;

async function initVox(): Promise<boolean> {
  try {
    if (!VoxClientClass) {
      const mod = await import(join(process.env.HOME || "~", "dev", "vox", "packages", "client", "src", "index.ts")) as {
        VoxClient: VoxClientConstructor;
      };
      VoxClientClass = mod.VoxClient;
    }
    // Always create a fresh client to avoid stale socket state
    voxClient = new VoxClientClass({ clientId: "relay-tui" });
    await voxClient.connect();
    voxAvailable = true;
    return true;
  } catch {
    voxAvailable = false;
    return false;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

type RelayMessage = ProjectedRelayMessage;

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

type ActiveTab = "chat" | "agents" | "twin" | "stats" | "voice";

function getCliFlagValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const value = process.argv[idx + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

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

function messageInvolvesTwin(message: RelayMessage, twinName: string): boolean {
  if (message.from === twinName) return true;
  if (message.to?.includes(twinName)) return true;
  return message.rawBody.includes(`@${twinName}`);
}

// ── Relay Data ────────────────────────────────────────────────────────────────

function findRelayDir(): string | null {
  const home = homedir();

  // 1. Check local relay.json link
  const localLink = join(process.cwd(), ".openscout", "relay.json");
  if (existsSync(localLink)) {
    try {
      const config = JSON.parse(readFileSync(localLink, "utf8"));
      if (config.hub) {
        const hub = config.hub.replace(/^~/, home);
        if (existsSync(getRelayEventsPath(hub)) || existsSync(join(hub, "channel.log"))) return hub;
      }
    } catch { /* fall through */ }
  }

  // 2. Check global hub
  const globalHub = join(home, ".openscout", "relay");
  if (existsSync(getRelayEventsPath(globalHub)) || existsSync(join(globalHub, "channel.log"))) return globalHub;

  // 3. Legacy: check local .openscout/relay/
  const localRelay = join(process.cwd(), ".openscout", "relay");
  if (existsSync(getRelayEventsPath(localRelay)) || existsSync(join(localRelay, "channel.log"))) return localRelay;

  return null;
}

function readAllMessages(relayDir: string): RelayMessage[] {
  return readProjectedRelayMessagesSync(relayDir);
}

function getConfiguredUserTwinName(relayDir: string): string {
  return resolveUserTwinName(loadRelayConfigSyncForHub(relayDir));
}

function postRelaySystemMessage(relayDir: string, from: string, body: string): void {
  void appendRelayMessage(relayDir, {
    ts: Math.floor(Date.now() / 1000),
    from,
    type: "SYS",
    body,
  });
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

function Header({ tab, agentCount, msgCount, voiceState, isSpeaking, focusTwinName }: { tab: ActiveTab; agentCount: number; msgCount: number; voiceState?: string; isSpeaking?: boolean; focusTwinName?: string }) {
  const [clock, setClock] = useState(ts());

  useEffect(() => {
    const iv = setInterval(() => setClock(ts()), 1000);
    return () => clearInterval(iv);
  }, []);

  const tabs: ActiveTab[] = ["chat", "agents", "twin", "stats", "voice"];

  return (
    <box flexDirection="row" justifyContent="space-between" padding={1} height={3}>
      <box flexDirection="row" gap={1}>
        <text fg={C.accent}><strong>◆</strong></text>
        <text fg={C.text}><strong> RELAY </strong></text>
        <text fg={C.dim}>{focusTwinName ? `focus @${focusTwinName}` : "monitor"}</text>
        <text fg={C.dim}>│</text>
        {tabs.map((t) => {
          const label = t === "voice" && voiceState === "recording" ? `● ${t}`
            : t === "voice" && isSpeaking ? `◉ ${t}`
            : ` ${t} `;
          const color = t === "voice" && voiceState === "recording" ? C.red
            : t === "voice" && isSpeaking ? C.cyan
            : t === tab ? C.text : C.dim;
          return (
            <text key={t} fg={color}>
              {t === tab ? <strong>{label}</strong> : label}
            </text>
          );
        })}
      </box>
      <box flexDirection="row" gap={2}>
        <text fg={C.dim}><span fg={C.text}>{agentCount}</span> agents</text>
        <text fg={C.dim}><span fg={C.text}>{msgCount}</span> msgs</text>
        <text fg={C.dim}>{clock}</text>
      </box>
    </box>
  );
}

// Filter out noisy SYS messages
const NOISY_SYS = ["heartbeat", "stopped monitoring", "monitoring the relay"];

function isNoisySys(msg: RelayMessage): boolean {
  if (msg.type !== "SYS") return false;
  return NOISY_SYS.some((n) => msg.body.includes(n));
}

function ChatPanel({
  messages,
  scrollOffset,
  maxVisible,
  width,
  title = "Relay",
  emptyText = "No messages yet. Waiting for relay activity...",
}: {
  messages: RelayMessage[];
  scrollOffset: number;
  maxVisible: number;
  width: number;
  title?: string;
  emptyText?: string;
}) {
  const filtered = messages.filter((m) => !isNoisySys(m));

  const visible = filtered.slice(
    Math.max(0, filtered.length - maxVisible - scrollOffset),
    filtered.length - scrollOffset
  );

  // Available width for message body: total - border(2) - padding(2) - cursor(2) - time(9) - name(14) - gaps(6)
  const bodyWidth = Math.max(20, width - 35);

  return (
    <box flexDirection="column" flexGrow={1} border borderStyle="rounded" borderColor={C.border} padding={1} title={title}>
      {visible.length === 0 ? (
        <text fg={C.dim}>{emptyText}</text>
      ) : (
        visible.map((msg) => {
          const time = fmtTime(msg.timestamp);

          if (msg.type === "SYS") {
            return <text key={msg.id} fg={C.dim}>{`${time}  ${pad("--", 12)}  ${msg.body.slice(0, bodyWidth)}`}</text>;
          }

          if (msg.type === "ACK") {
            return <text key={msg.id} fg={C.dim}>{`${time}  ${pad(msg.from, 12)}  ack ${msg.body.slice(0, bodyWidth)}`}</text>;
          }

          const name = pad(msg.from, 12);
          const body = msg.body.length > bodyWidth ? msg.body.slice(0, bodyWidth - 1) + "..." : msg.body;

          // Color: timestamp white, name green, @mentions cyan, [speak] yellow
          return (
            <text key={msg.id} fg={C.text}>{time}{"  "}<span fg={C.accent}><strong>{name}</strong></span>{"  "}<span fg={C.text}>{body}</span></text>
          );
        })
      )}
      {scrollOffset > 0 && (
        <text fg={C.yellow}>  ↑ {scrollOffset} more below</text>
      )}
    </box>
  );
}

function loadTwinsSync(relayDir: string): Record<string, ProjectTwinRecord> {
  return readProjectedRelayTwinsSync(relayDir);
}

function isTwinAlive(tmuxSession: string): boolean {
  try {
    execSync(`tmux has-session -t ${tmuxSession} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)|\x1b[^[\]]/g, "").trim();
}

function captureTwinActivity(tmuxSession: string): string {
  try {
    // Grab last few visible lines from the twin's pane
    const raw = execSync(`tmux capture-pane -t ${tmuxSession} -p 2>/dev/null`, { encoding: "utf8", timeout: 500 });
    const lines = raw.split("\n").map(stripAnsi).filter((l) => l.length > 0);
    if (lines.length === 0) return "starting...";

    // Walk from bottom, find the most informative line
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 10); i--) {
      const line = lines[i];
      // Skip empty, prompts, status bars
      if (!line || line === "❯" || line.startsWith("--") || line.startsWith("Opus") || line.startsWith("Sonnet")) continue;
      // Claude activity indicators
      if (line.includes("⏺") || line.includes("✻") || line.includes("✶") || line.includes("✽")) {
        const truncated = line.length > 60 ? line.slice(0, 60) + "…" : line;
        return truncated;
      }
      // Idle at prompt
      if (line.startsWith("❯")) {
        const afterPrompt = line.slice(1).trim();
        return afterPrompt ? afterPrompt.slice(0, 50) : "idle";
      }
    }

    // Fallback: last non-empty line
    const last = lines[lines.length - 1];
    return last.length > 60 ? last.slice(0, 60) + "…" : last || "active";
  } catch {
    return "unreachable";
  }
}

function AgentsPanel({ agents, selectedAgent, twins }: {
  agents: AgentStatus[];
  selectedAgent: number;
  twins: Record<string, ProjectTwinRecord>;
}) {
  const alive = agents.filter((a) => a.status !== "forgotten");
  const forgotten = agents.filter((a) => a.status === "forgotten");

  const statusIcon = (s: AgentStatus["status"]) =>
    s === "online" ? "●" : s === "idle" ? "○" : "✗";
  const statusLabel = (a: AgentStatus) => {
    const twin = twins[a.name];
    if (twin && isTwinAlive(twin.tmuxSession)) return "twin ⏵";
    return a.status === "online" ? "online" : a.status === "idle" ? "idle" : "removed";
  };

  return (
    <box flexDirection="column" flexGrow={1} gap={1}>
      <box border borderStyle="rounded" borderColor={C.border} padding={1} flexDirection="column" title={`Active (${alive.length})`}>
        {alive.length === 0 ? (
          <text fg={C.dim}>No agents have used the relay yet</text>
        ) : (
          <>
            <text fg={C.dim}>{`   ${pad("agent", 14)}  ${pad("msgs", 6)}  ${pad("last seen", 12)}  ${pad("status", 10)}  activity`}</text>
            {alive.map((agent, i) => {
              const isSelected = i === selectedAgent;
              const twin = twins[agent.name];
              const hasTwin = twin && isTwinAlive(twin.tmuxSession);
              const activity = hasTwin ? captureTwinActivity(twin.tmuxSession) : "";
              const isWorking = activity && activity !== "idle" && activity !== "unreachable" && activity !== "starting...";
              const cleanAct = activity ? stripAnsi(activity).replace(/[^\x20-\x7e]/g, "").trim() : "";
              const truncAct = cleanAct.length > 36 ? cleanAct.slice(0, 35) + "…" : cleanAct;

              const cursor = isSelected ? "▸" : " ";
              const icon = statusIcon(agent.status);
              const label = statusLabel(agent);
              const line = `${cursor} ${icon} ${pad(agent.name, 14)}  ${pad(String(agent.messages), 6)}  ${pad(fmtRelative(agent.lastSeen), 12)}  ${pad(label, 10)}  ${truncAct}`;

              return <text key={agent.name} fg={isSelected ? C.text : isWorking ? C.yellow : C.muted}>{line}</text>;
            })}
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

function StatsPanel({ messages, agents, dbEntries, nowTs }: { messages: RelayMessage[]; agents: AgentInfo[]; dbEntries: number; nowTs: number }) {
  const msgOnly = messages.filter((m) => m.type === "MSG");
  const sysOnly = messages.filter((m) => m.type === "SYS");
  const onlineCount = agents.filter((a) => a.online).length;

  // Messages per agent
  const perAgent = agents
    .filter((a) => a.messages > 0)
    .sort((a, b) => b.messages - a.messages);

  // Activity timeline — last 60 minutes in 6 buckets of 10m each
  const buckets = Array.from({ length: 6 }, (_, i) => {
    const start = nowTs - (6 - i) * 600;
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

function TwinPanel({
  twinName,
  twin,
  messages,
  agents,
  activeFlights,
  scrollOffset,
  maxVisible,
  width,
}: {
  twinName: string;
  twin?: ProjectTwinRecord;
  messages: RelayMessage[];
  agents: AgentStatus[];
  activeFlights: Flight[];
  scrollOffset: number;
  maxVisible: number;
  width: number;
}) {
  const relatedMessages = messages.filter((message) => messageInvolvesTwin(message, twinName));
  const alive = twin ? isTwinAlive(twin.tmuxSession) : false;
  const activity = twin && alive
    ? captureTwinActivity(twin.tmuxSession)
    : twin
      ? "offline"
      : "not registered";
  const agent = agents.find((entry) => entry.name === twinName);
  const pendingFlights = activeFlights.filter((flight) => flight.to === twinName).length;
  const statusColor = alive ? C.accent : agent?.status === "online" ? C.yellow : C.dim;
  const statusText = alive ? "twin online" : agent?.status === "online" ? "relay online" : "offline";

  return (
    <box flexDirection="column" flexGrow={1} gap={1}>
      <box border borderStyle="rounded" borderColor={C.border} padding={1} flexDirection="column" title={`Twin @${twinName}`}>
        <box flexDirection="row" gap={3}>
          <text fg={C.dim}>status <span fg={statusColor}>{statusText}</span></text>
          <text fg={C.dim}>msgs <span fg={C.text}>{relatedMessages.length}</span></text>
          <text fg={C.dim}>pending <span fg={pendingFlights > 0 ? C.yellow : C.text}>{pendingFlights}</span></text>
        </box>
        {twin ? (
          <>
            <text fg={C.dim}>project <span fg={C.text}>{twin.project}</span></text>
            <text fg={C.dim}>tmux <span fg={C.text}>{twin.tmuxSession}</span></text>
            <text fg={C.dim}>cwd <span fg={C.text}>{twin.projectRoot}</span></text>
          </>
        ) : (
          <>
            <text fg={C.dim}>{`No twin record for @${twinName}.`}</text>
            <text fg={C.dim}>Run `relay twin up` here.</text>
          </>
        )}
        <text fg={C.dim}>activity <span fg={alive ? C.yellow : C.dim}>{activity}</span></text>
      </box>

      <ChatPanel
        messages={relatedMessages}
        scrollOffset={scrollOffset}
        maxVisible={maxVisible}
        width={width}
        title={`Conversation @${twinName}`}
        emptyText={`No relay traffic for @${twinName} yet.`}
      />
    </box>
  );
}

function WaveBar({ active, color }: { active: boolean; color?: string }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!active) return;
    const iv = setInterval(() => setFrame((f) => f + 1), 150);
    return () => clearInterval(iv);
  }, [active]);

  if (!active) return null;

  const BRAILLE = [" ", "⠁", "⠃", "⠇", "⡇", "⣇", "⣧", "⣷", "⣿"];
  const wave = Array.from({ length: 6 }, (_, i) => {
    const v = Math.sin(frame * 0.4 + i * 0.9) * 0.4 + Math.sin(frame * 0.7 + i * 1.6) * 0.3 + 0.5;
    const n = Math.max(0, Math.min(1, v));
    return BRAILLE[Math.floor(n * (BRAILLE.length - 1))];
  }).join("");

  return <text fg={color || C.red}>{wave}</text>;
}

interface VoiceThread {
  role: "you" | "agent";
  from: string;
  text: string;
  timestamp: number;
}

function VoicePanel({
  voiceState,
  partialText,
  thread,
  isSpeaking,
}: {
  voiceState: "idle" | "connecting" | "recording" | "processing" | "error";
  partialText: string;
  thread: VoiceThread[];
  isSpeaking: boolean;
}) {
  const stateLabel = (): { icon: string; label: string; color: string } => {
    if (isSpeaking) return { icon: "◉", label: "Speaking...", color: C.cyan };
    switch (voiceState) {
      case "idle": return { icon: "○", label: "Ready — press v to record", color: C.dim };
      case "connecting": return { icon: "◌", label: "Connecting to Vox...", color: C.yellow };
      case "recording": return { icon: "●", label: "Recording — press v to stop", color: C.red };
      case "processing": return { icon: "◐", label: "Transcribing...", color: C.yellow };
      case "error": return { icon: "✗", label: "Vox not available — is voxd running?", color: C.red };
    }
  };

  const s = stateLabel();

  return (
    <box flexDirection="column" flexGrow={1} gap={1}>
      {/* Status */}
      <box border borderStyle="rounded" borderColor={voiceState === "recording" ? C.red : isSpeaking ? C.cyan : C.border} padding={1} flexDirection="column" title="Audio Channel">
        <box flexDirection="row" gap={2}>
          <text fg={s.color}>{s.icon}</text>
          <text fg={s.color}>{s.label}</text>
          {isSpeaking && <WaveBar active={true} color={C.cyan} />}
        </box>
        {voiceState === "recording" && (
          <box flexDirection="column" marginTop={1}>
            {!isSpeaking && <WaveBar active={true} color={C.red} />}
            {partialText ? (
              <text fg={C.text}><strong>{partialText}</strong></text>
            ) : (
              <text fg={C.dim}>Speak now</text>
            )}
          </box>
        )}
        {voiceState === "processing" && partialText && (
          <box flexDirection="column" marginTop={1}>
            <text fg={C.yellow}>{partialText}</text>
          </box>
        )}
      </box>

      {/* Conversation thread */}
      <box border borderStyle="rounded" borderColor={C.border} padding={1} flexDirection="column" flexGrow={1} title="Conversation">
        {thread.length === 0 ? (
          <text fg={C.dim}>No voice messages yet. Press v to start.</text>
        ) : (
          thread.slice(-15).map((t, i) => {
            const isYou = t.role === "you";
            return (
              <box key={i} flexDirection="row" gap={1} marginBottom={isYou ? 0 : 1}>
                <text fg={C.dim}>{fmtTime(t.timestamp)}</text>
                <text fg={isYou ? C.accent : C.cyan}>{isYou ? "you" : t.from}</text>
                <text fg={isYou ? C.muted : C.text}>{t.text}</text>
              </box>
            );
          })
        )}
      </box>

      {/* Help */}
      <box border borderStyle="rounded" borderColor={C.border} padding={1} flexDirection="column" title="Tips">
        <text fg={C.dim}>v  toggle recording from any tab</text>
        <text fg={C.dim}>Responses from @mentioned agents appear here and are spoken</text>
        <text fg={C.dim}>{'Say "@system up <project>" to spawn twins by voice'}</text>
      </box>
    </box>
  );
}

// ── Agent Cockpit (persistent across all views) ──────────────────────────────

function loadAgentStatesSync(relayDir: string): Record<string, string> {
  const states = readProjectedRelayAgentStatesSync(relayDir);
  return Object.fromEntries(
    Object.entries(states).map(([agent, state]) => [agent, state.state]),
  );
}

function AgentCockpit({ twins, agents, userTwinName, voiceState, isSpeaking, relayDir, width, recordingStart }: {
  twins: Record<string, ProjectTwinRecord>;
  agents: AgentStatus[];
  userTwinName: string;
  voiceState: "idle" | "connecting" | "recording" | "processing" | "error";
  isSpeaking: boolean;
  relayDir: string;
  width: number;
  recordingStart: number | null;
}) {
  const [frame, setFrame] = useState(0);
  const [recordingNow, setRecordingNow] = useState<number | null>(null);

  useEffect(() => {
    if (!isSpeaking && voiceState !== "recording") return;
    const iv = setInterval(() => setFrame((f) => f + 1), 150);
    return () => clearInterval(iv);
  }, [isSpeaking, voiceState]);

  // Recording elapsed timer
  useEffect(() => {
    if (!recordingStart || voiceState === "idle") return;
    const iv = setInterval(() => setRecordingNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [recordingStart, voiceState]);

  const elapsed = !recordingStart || voiceState === "idle"
    ? ""
    : (() => {
        const seconds = Math.floor((Math.max(recordingNow ?? recordingStart, recordingStart) - recordingStart) / 1000);
        const minutes = Math.floor(seconds / 60);
        return minutes > 0
          ? `${minutes}:${String(seconds % 60).padStart(2, "0")}`
          : `0:${String(seconds).padStart(2, "0")}`;
      })();

  // Braille wave animation (from Vox TUI)
  const BRAILLE = [" ", "⠁", "⠃", "⠇", "⡇", "⣇", "⣧", "⣷", "⣿"];
  const wave = Array.from({ length: 6 }, (_, i) => {
    const v = Math.sin(frame * 0.4 + i * 0.9) * 0.4 + Math.sin(frame * 0.7 + i * 1.6) * 0.3 + 0.5;
    const n = Math.max(0, Math.min(1, v));
    return BRAILLE[Math.floor(n * (BRAILLE.length - 1))];
  }).join("");

  // Read agent states — these take priority over tmux activity
  const agentStates = loadAgentStatesSync(relayDir);

  // Build agent entries
  const entries: Array<{ name: string; activity: string; status: "working" | "idle" | "offline" }> = [];

  for (const [name, twin] of Object.entries(twins)) {
    const alive = isTwinAlive(twin.tmuxSession);
    if (!alive) {
      entries.push({ name, activity: "offline", status: "offline" });
      continue;
    }
    // Agent-set state takes priority (speaking, thinking, etc.)
    const agentState = agentStates[name];
    if (agentState && agentState !== "idle") {
      entries.push({ name, activity: agentState, status: "working" });
      continue;
    }
    const activity = captureTwinActivity(twin.tmuxSession);
    const isWorking = activity && activity !== "idle" && activity !== "unreachable" && activity !== "starting...";
    entries.push({ name, activity: activity || "idle", status: isWorking ? "working" : "idle" });
  }

  // Show non-twin online agents, but skip the TUI operator (that's you)
  const tuiName = userInfo().username;
  for (const agent of agents) {
    if (twins[agent.name]) continue;
    if (agent.name === tuiName) continue;
    if (agent.name === "system") continue;
    if (agent.status === "online") {
      entries.push({ name: agent.name, activity: "online", status: "idle" });
    }
  }

  // The configured user twin is always pinned at top.
  // If the twin looks offline from tmux but still shows online in the agent list, prefer online.
  let userTwinEntry = entries.find((e) => e.name === userTwinName);
  if (!userTwinEntry) {
    const userTwinAgent = agents.find((a) => a.name === userTwinName && a.status === "online");
    userTwinEntry = userTwinAgent
      ? { name: userTwinName, activity: "online", status: "idle" as const }
      : { name: userTwinName, activity: "offline", status: "offline" as const };
  } else if (userTwinEntry.status === "offline") {
    const userTwinAgent = agents.find((a) => a.name === userTwinName && a.status === "online");
    if (userTwinAgent) {
      userTwinEntry = { name: userTwinName, activity: "online", status: "idle" as const };
    }
  }
  const rest = entries.filter((e) => e.name !== userTwinName).sort((a, b) => {
    // Working agents first, then by name as tiebreaker
    const order = { working: 0, idle: 1, offline: 2 };
    return order[a.status] - order[b.status];
  });

  const maxRows = 5;
  const otherSlots = maxRows - 1; // 1 slot reserved for the user twin
  const shownOthers = rest.slice(0, otherSlots);
  const hidden = rest.length - shownOthers.length;

  // Strip ANSI and non-ASCII from activity strings
  const clean = (s: string) => s.replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)|\x1b[^[\]]/g, "").replace(/[^\x20-\x7e]/g, "");

  // Align with chat columns: time(8) + gap(2) + name(12) + gap(2) + body
  const fmtAgent = (icon: string, name: string, activity: string) => {
    const act = clean(activity).trim();
    const truncAct = act.length > 40 ? act.slice(0, 40) + "..." : act;
    const stars = icon === "*" ? " * * * *" : icon === "o" ? " o o o o" : " . . . .";
    return `${stars}  ${pad(name, 12)}  ${truncAct}`;
  };

  const userTwinIcon = userTwinEntry.status === "working" ? "*" : userTwinEntry.status === "idle" ? "o" : "x";

  // Inner width = total - border(2) - padding(2)
  const innerW = width - 4;

  // Audio state
  const isRecording = voiceState === "recording";
  const isProcessing = voiceState === "processing" || voiceState === "connecting";

  // Right-aligned audio indicators (only when active)
  const micStr = isRecording ? `● REC ${elapsed || "0:00"} ${wave}`
    : isProcessing ? "◌ processing..."
    : "";
  const spkStr = isSpeaking ? `◉ playing ${wave}` : "";

  // Build a row with optional right-aligned audio
  const buildRow = (agentStr: string, audioStr?: string) => {
    if (!audioStr) return agentStr;
    const gap = Math.max(1, innerW - agentStr.length - audioStr.length);
    return agentStr + " ".repeat(gap) + audioStr;
  };

  // Build agent rows
  const agentRows: string[] = [];
  agentRows.push(buildRow(fmtAgent(userTwinIcon, userTwinEntry.name, userTwinEntry.activity), micStr || undefined));
  for (let i = 0; i < shownOthers.length; i++) {
    const e = shownOthers[i];
    const icon = e.status === "working" ? "*" : e.status === "idle" ? "o" : "x";
    const audio = i === 0 && spkStr ? spkStr : undefined;
    agentRows.push(buildRow(fmtAgent(icon, e.name, e.activity), audio));
  }
  if (hidden > 0) {
    agentRows.push("   +" + hidden + " more");
  }
  // Pad to maxRows so the box doesn't collapse
  while (agentRows.length < maxRows) agentRows.push("");

  return (
    <box flexDirection="column" border borderStyle="rounded" borderColor={isSpeaking ? C.cyan : isRecording ? C.red : C.border} padding={1} height={maxRows + 2}>
      <text fg={C.yellow}>{agentRows.join("\n")}</text>
    </box>
  );
}

function StatusBar({ tab }: { tab: ActiveTab }) {
  const hints: Record<ActiveTab, string> = {
    chat: "↑↓ scroll  c copy  v voice  tab  r  q",
    agents: "↑↓ select  ⏎ peek  u/d  n nudge  tab  q",
    twin: "⏎ peek  u/d  n nudge  tab  r  q",
    stats: "v voice  tab  r  x clear  q",
    voice: "v record  tab  q",
  };

  return (
    <box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1} height={2}>
      <text fg={C.dim}>{hints[tab]}</text>
      <text fg={C.dim}>1 chat  2 ag  3 twin  4 stats  5 voice</text>
    </box>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

function App() {
  const requestedFocusTwin = getCliFlagValue("--focus-twin");
  const { width, height } = useTerminalDimensions();
  const [relayDir] = useState(() => findRelayDir() || "");
  const [tab, setTab] = useState<ActiveTab>(requestedFocusTwin ? "twin" : "chat");
  const [messages, setMessages] = useState<RelayMessage[]>([]);
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [dbEntries, setDbEntries] = useState(0);
  const [statsNow, setStatsNow] = useState(() => Math.floor(Date.now() / 1000));
  const [selectedId, setSelectedId] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [voiceState, setVoiceState] = useState<"idle" | "connecting" | "recording" | "processing" | "error">("idle");
  const [recordingStart, setRecordingStart] = useState<number | null>(null);
  const [partialText, setPartialText] = useState("");
  const [voiceThread, setVoiceThread] = useState<VoiceThread[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState(0);
  const [twins, setTwins] = useState<Record<string, ProjectTwinRecord>>({});
  const [userTwinName, setUserTwinName] = useState(DEFAULT_USER_TWIN);
  const [focusedTwinName, setFocusedTwinName] = useState(requestedFocusTwin || DEFAULT_USER_TWIN);
  const [activeFlights, setActiveFlights] = useState<Flight[]>([]);
  const relayDirRef = useRef<string | null>(null);
  const filePosRef = useRef(0);
  const voxSessionRef = useRef<VoxLiveSessionLike | null>(null);
  const tuiNameRef = useRef<string>("");
  const userTwinNameRef = useRef<string>(DEFAULT_USER_TWIN);
  const focusedTwinNameRef = useRef<string>(requestedFocusTwin || DEFAULT_USER_TWIN);
  // Watermark: last message id we've spoken — anything above this is new
  const lastSpokenMsgRef = useRef<number>(0);

  // header(3) + cockpit(6) + status(2) + chat border/padding(4) = 15
  const maxVisible = Math.max(height - 15, 5);

  const refresh = useCallback(() => {
    const relayDir = relayDirRef.current;
    if (!relayDir) return;
    setStatsNow(Math.floor(Date.now() / 1000));

    const configuredUserTwin = getConfiguredUserTwinName(relayDir);
    userTwinNameRef.current = configuredUserTwin;
    setUserTwinName(configuredUserTwin);
    const currentFocusTwin = requestedFocusTwin || configuredUserTwin;
    focusedTwinNameRef.current = currentFocusTwin;
    setFocusedTwinName(currentFocusTwin);

    const allMessages = readAllMessages(relayDir);
    setMessages(allMessages);
    const agentMap = buildAgentMap(allMessages);
    setAgents(agentMap);

    // Sync to JSONL database
    syncToDb(relayDir, allMessages);
    setDbEntries(allMessages.length);

    // Load twins registry and compute live activity
    const currentTwins = loadTwinsSync(relayDir);
    setTwins(currentTwins);

    // Auto-select newest message and reset scroll to bottom
    if (allMessages.length > 0) {
      setSelectedId(allMessages[allMessages.length - 1].id);
      setScrollOffset(0);
    }

    const visibleAgents = agentMap.filter((entry) => entry.status !== "forgotten");
    const focusedAgentIndex = visibleAgents.findIndex((entry) => entry.name === currentFocusTwin);
    if (focusedAgentIndex !== -1) {
      setSelectedAgent(focusedAgentIndex);
    }

    // Resolve flights
    const tuiName = tuiNameRef.current;
    if (tuiName) {
      const flights = readProjectedRelayFlightsSync(relayDir);
      setActiveFlights(flights.filter((f) => f.status === "pending"));
    }

    // Voice channel: speak any new messages tagged with [speak]
    // The agent decides what's worth saying aloud — we just honor the tag.
    const newSpoken: VoiceThread[] = [];
    for (const msg of allMessages) {
      if (msg.id <= lastSpokenMsgRef.current) continue;
      if (msg.type !== "MSG") continue;
      if (msg.from === tuiName) continue; // don't speak your own messages
      if (!msg.tags.includes("speak")) continue;

      newSpoken.push({
        role: "agent",
        from: msg.from,
        text: msg.rawBody,
        timestamp: msg.timestamp,
      });
      lastSpokenMsgRef.current = msg.id;
    }
    if (newSpoken.length > 0) {
      setVoiceThread((prev) => [...prev, ...newSpoken]);
    }

    const states = readProjectedRelayAgentStatesSync(relayDir);
    const anySpeaking = Object.values(states).some((s) => s.state === "speaking");
    setIsSpeaking(anySpeaking);
  }, [requestedFocusTwin]);

  // Initial setup
  useEffect(() => {
    if (!relayDir) {
      console.error("No relay found. Run: openscout relay init");
      process.exit(1);
    }
    relayDirRef.current = relayDir;

    // TUI identity — the human operator
    const channelPath = getRelayEventsPath(relayDir);
    const asIdx = process.argv.indexOf("--as");
    const tuiName = asIdx !== -1 && process.argv[asIdx + 1]
      ? process.argv[asIdx + 1]
      : process.env.OPENSCOUT_AGENT || userInfo().username;
    tuiNameRef.current = tuiName;
    postRelaySystemMessage(relayDir, tuiName, `${tuiName} monitoring the relay`);

    // Try to connect to Vox for voice input
    initVox().then((ok) => {
      if (!ok) setVoiceState("error");
    });

    const configuredUserTwin = getConfiguredUserTwinName(relayDir);
    userTwinNameRef.current = configuredUserTwin;

    // Heartbeat — keep TUI and user twin showing as online
    const heartbeatIv = setInterval(() => {
      postRelaySystemMessage(relayDir, tuiName, "heartbeat");
      const currentUserTwin = userTwinNameRef.current;
      if (tuiName !== currentUserTwin) {
        try {
          const tw = loadTwinsSync(relayDir);
          const userTwin = tw[currentUserTwin];
          if (userTwin && isTwinAlive(userTwin.tmuxSession)) {
            postRelaySystemMessage(relayDir, currentUserTwin, "heartbeat");
          }
        } catch { /* noop */ }
      }
    }, ONLINE_THRESHOLD * 500); // halfway through threshold (5 min for 10 min threshold)

    // Set the spoken watermark to current message count so we don't speak old messages
    const initialMessages = readAllMessages(relayDir);
    lastSpokenMsgRef.current = initialMessages.length > 0 ? initialMessages[initialMessages.length - 1].id : 0;

    // Initial load
    const initialRefresh = setTimeout(() => refresh(), 0);

    // Watch for changes using polling (more reliable than fs.watch for appends)
    const iv = setInterval(() => {
      try {
        const stat = statSync(channelPath);
        if (stat.size !== filePosRef.current) {
          filePosRef.current = stat.size;
          refresh();
        }
      } catch { /* file may not exist yet */ }
    }, 500);

    // Periodic refresh for online/offline status updates
    const statusIv = setInterval(() => refresh(), 5000);

    return () => {
      clearTimeout(initialRefresh);
      clearInterval(iv);
      clearInterval(statusIv);
      clearInterval(heartbeatIv);
      postRelaySystemMessage(relayDir, tuiName, `${tuiName} stopped monitoring`);
    };
  }, [refresh, relayDir]);

  // Voice toggle
  const toggleVoice = useCallback(async () => {
    const relayDir = relayDirRef.current;
    if (!relayDir) return;
    const tuiName = tuiNameRef.current;

    // If recording, stop
    if (voiceState === "recording" && voxSessionRef.current) {
      setVoiceState("processing");
      setRecordingStart(null);
      try {
        await voxSessionRef.current.stop();
      } catch {
        setVoiceState("idle");
      }
      return;
    }

    // If idle or error, try to start
    if (voiceState !== "idle" && voiceState !== "error") return;

    // Ensure Vox is connected (reconnect if dropped)
    if (!voxAvailable || !voxClient?.connected) {
      setVoiceState("connecting");
      const ok = await initVox();
      if (!ok) {
        setVoiceState("error");
        return;
      }
    }
    const client = voxClient;
    if (!client) {
      setVoiceState("error");
      return;
    }

    setVoiceState("recording");
    setRecordingStart(Date.now());
    setPartialText("");

    const session = client.createLiveSession();
    voxSessionRef.current = session;

    session.on("partial", (event: VoxSessionEvent) => {
      setPartialText(event.text || "");
    });

    session.on("final", (event: VoxSessionEvent) => {
      let text = (event.text || "").trim();
      if (text) {
        // If no @mention, route to the configured user twin.
        const hasMention = /@[\w.-]+/.test(text);
        if (!hasMention) {
          text = `@${userTwinNameRef.current} ${text}`;
        }

        const now = Math.floor(Date.now() / 1000);
        // Send via CLI — handles log write, @system, and @mention delivery
        // Tag as voice channel so responses get spoken
        try {
          execSync(`openscout relay send --as ${tuiName} --channel voice ${JSON.stringify(text)}`, { stdio: "ignore" });
        } catch {
          // Fallback: route directly through the shared Relay writer.
          void appendRelayMessage(relayDir, {
            ts: now,
            from: tuiName,
            type: "MSG",
            body: text,
            channel: "voice",
          });
        }

        // Track @mentioned agents — we expect voice responses from them
        // Create flights for @mentioned targets
        const mentions = text.match(/@([\w.-]+)/g);
        if (mentions) {
          for (const m of mentions) {
            const target = m.slice(1);
            if (target !== tuiName && target !== "system") {
              void createFlight(relayDirRef.current || relayDir, tuiName, target, text);
            }
          }
        }

        // Add to voice thread
        setVoiceThread((prev) => [...prev, { role: "you", from: tuiName, text, timestamp: now }]);
        refresh();
      }
      setVoiceState("idle");
      setPartialText("");
      voxSessionRef.current = null;
    });

    session.on("error", () => {
      setVoiceState("error");
      setPartialText("");
      voxSessionRef.current = null;
    });

    try {
      await session.start();
    } catch {
      setVoiceState("error");
      voxSessionRef.current = null;
    }
  }, [voiceState, refresh]);

  // Keyboard
  useKeyboard((key) => {
    if (key.name === "escape" || (key.name === "c" && key.ctrl) || key.name === "q") {
      if (voxClient) {
        try { voxClient.disconnect(); } catch { /* noop */ }
      }
      quit();
    }

    if (key.name === "tab") {
      setTab((prev) => {
        const tabs: ActiveTab[] = ["chat", "agents", "twin", "stats", "voice"];
        const dir = key.shift ? -1 : 1;
        return tabs[(tabs.indexOf(prev) + dir + tabs.length) % tabs.length];
      });
    }

    if (key.name === "1") setTab("chat");
    if (key.name === "2") setTab("agents");
    if (key.name === "3") setTab("twin");
    if (key.name === "4") setTab("stats");
    if (key.name === "5") setTab("voice");
    if (key.name === "r") refresh();

    // Voice toggle — works from any tab
    if (key.name === "v") {
      toggleVoice();
    }

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

    // Agents navigation
    if (tab === "agents") {
      const alive = agents.filter((a) => a.status !== "forgotten");
      if (key.name === "up") {
        setSelectedAgent((prev) => Math.max(0, prev - 1));
      }
      if (key.name === "down") {
        setSelectedAgent((prev) => Math.min(alive.length - 1, prev + 1));
      }
      // Enter → peek at twin's tmux session
      if (key.name === "return") {
        const agent = alive[selectedAgent];
        if (agent) {
          const twin = twins[agent.name];
          if (twin && isTwinAlive(twin.tmuxSession)) {
            const inTmux = !!process.env.TMUX;
            if (inTmux) {
              // Floating popup — overlays on TUI, no resize, press q/Ctrl-c to dismiss
              try {
                execSync(`tmux display-popup -w 80% -h 80% -E "tmux attach -t ${twin.tmuxSession}"`);
              } catch {
                // display-popup not available (tmux < 3.2), fall back to new window
                try {
                  execSync(`tmux new-window -n "${agent.name}" "tmux attach -t ${twin.tmuxSession}"`);
                } catch { /* noop */ }
              }
            } else {
              // Not in tmux — open in new iTerm tab
              try {
                execSync(
                  `osascript -e 'tell application "iTerm2" to tell current window to create tab with default profile command "tmux attach -t ${twin.tmuxSession}"' 2>/dev/null`
                );
              } catch {
                try {
                  execSync(`tmux new-window -n "${agent.name}" "tmux attach -t ${twin.tmuxSession}"`);
                } catch { /* noop */ }
              }
            }
          }
        }
      }

      // u → bring up a twin (start it if it has a registered cwd)
      if (key.name === "u") {
        const agent = alive[selectedAgent];
        if (agent) {
          const twin = twins[agent.name];
          if (twin && !isTwinAlive(twin.tmuxSession)) {
            // Twin is registered but offline — restart it
            try {
              execSync(`openscout relay up ${JSON.stringify(twin.cwd)} --name ${agent.name}`, { stdio: "ignore", timeout: 10000 });
              refresh();
            } catch { /* noop */ }
          } else if (!twin) {
            // No twin registered — check if there's a known project path
            // For now, just nudge via relay if the agent is online
            try {
              const relayDir = relayDirRef.current;
              if (relayDir) {
                postRelaySystemMessage(relayDir, agent.name, "nudge");
              }
              refresh();
            } catch { /* noop */ }
          }
        }
      }

      // d → bring down a twin
      if (key.name === "d") {
        const agent = alive[selectedAgent];
        if (agent) {
          const twin = twins[agent.name];
          if (twin && isTwinAlive(twin.tmuxSession)) {
            try {
              execSync(`openscout relay down ${agent.name}`, { stdio: "ignore", timeout: 5000 });
              refresh();
            } catch { /* noop */ }
          }
        }
      }

      // n → nudge a twin (send empty Enter to wake it up)
      if (key.name === "n") {
        const agent = alive[selectedAgent];
        if (agent) {
          const twin = twins[agent.name];
          if (twin && isTwinAlive(twin.tmuxSession)) {
            try {
              execSync(`tmux send-keys -t ${twin.tmuxSession} "" Enter`);
              const relayDir = relayDirRef.current;
              if (relayDir) {
                postRelaySystemMessage(relayDir, agent.name, "heartbeat");
              }
              refresh();
            } catch { /* noop */ }
          }
        }
      }
    }

    if (tab === "twin") {
      const twinName = focusedTwinNameRef.current;
      const twin = twins[twinName];

      if (key.name === "return" && twin && isTwinAlive(twin.tmuxSession)) {
        const inTmux = !!process.env.TMUX;
        if (inTmux) {
          try {
            execSync(`tmux display-popup -w 80% -h 80% -E "tmux attach -t ${twin.tmuxSession}"`);
          } catch {
            try {
              execSync(`tmux new-window -n "${twinName}" "tmux attach -t ${twin.tmuxSession}"`);
            } catch { /* noop */ }
          }
        } else {
          try {
            execSync(
              `osascript -e 'tell application "iTerm2" to tell current window to create tab with default profile command "tmux attach -t ${twin.tmuxSession}"' 2>/dev/null`
            );
          } catch {
            try {
              execSync(`tmux new-window -n "${twinName}" "tmux attach -t ${twin.tmuxSession}"`);
            } catch { /* noop */ }
          }
        }
      }

      if (key.name === "u" && twin && !isTwinAlive(twin.tmuxSession)) {
        try {
          execSync(`openscout relay up ${JSON.stringify(twin.cwd)} --name ${twinName}`, { stdio: "ignore", timeout: 10000 });
          refresh();
        } catch { /* noop */ }
      }

      if (key.name === "d" && twin && isTwinAlive(twin.tmuxSession)) {
        try {
          execSync(`openscout relay down ${twinName}`, { stdio: "ignore", timeout: 5000 });
          refresh();
        } catch { /* noop */ }
      }

      if (key.name === "n" && twin && isTwinAlive(twin.tmuxSession)) {
        try {
          execSync(`tmux send-keys -t ${twin.tmuxSession} "" Enter`);
          const relayDir = relayDirRef.current;
          if (relayDir) {
            postRelaySystemMessage(relayDir, twinName, "heartbeat");
          }
          refresh();
        } catch { /* noop */ }
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
      <Header tab={tab} agentCount={agents.length} msgCount={messages.filter((m) => m.type === "MSG").length} voiceState={voiceState} isSpeaking={isSpeaking} focusTwinName={focusedTwinName} />

      <AgentCockpit twins={twins} agents={agents} userTwinName={userTwinName} voiceState={voiceState} isSpeaking={isSpeaking} relayDir={relayDir} width={width} recordingStart={recordingStart} />

      <box flexDirection="row" flexGrow={1}>
        <box flexDirection="column" flexGrow={1}>
          {tab === "chat" && (
            <ChatPanel
              messages={messages}
              scrollOffset={scrollOffset}
              maxVisible={maxVisible}
              width={width}
            />
          )}
          {tab === "agents" && <AgentsPanel agents={agents} selectedAgent={selectedAgent} twins={twins} />}
          {tab === "twin" && (
            <TwinPanel
              twinName={focusedTwinName}
              twin={twins[focusedTwinName]}
              messages={messages}
              agents={agents}
              activeFlights={activeFlights}
              scrollOffset={scrollOffset}
              maxVisible={maxVisible}
              width={width}
            />
          )}
          {tab === "stats" && <StatsPanel messages={messages} agents={agents} dbEntries={dbEntries} nowTs={statsNow} />}
          {tab === "voice" && <VoicePanel voiceState={voiceState} partialText={partialText} thread={voiceThread} isSpeaking={isSpeaking} />}
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
