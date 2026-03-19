#!/usr/bin/env bun

import React, { useState, useEffect, useCallback, useRef } from "react";
import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useTerminalDimensions } from "@opentui/react";
import { existsSync, readFileSync, appendFileSync, writeFileSync, watchFile, unwatchFile, statSync, openSync, readSync, closeSync } from "fs";
import { join } from "path";
import { execSync, spawn } from "child_process";


// ── Flights (tracked requests with callbacks) ────────────────────────────────

interface Flight {
  id: string;
  from: string;
  to: string;
  message: string;
  sentAt: number;
  status: "pending" | "completed";
  response?: string;
  respondedAt?: number;
}

function getFlightsPath(): string {
  const os = require("os");
  return join(os.homedir(), ".openscout", "relay", "flights.json");
}

function loadFlights(): Flight[] {
  try {
    return JSON.parse(readFileSync(getFlightsPath(), "utf8"));
  } catch {
    return [];
  }
}

function saveFlights(flights: Flight[]): void {
  writeFileSync(getFlightsPath(), JSON.stringify(flights, null, 2) + "\n");
}

function createFlight(from: string, to: string, message: string): Flight {
  const flights = loadFlights();
  const flight: Flight = {
    id: `f-${Date.now().toString(36)}`,
    from,
    to,
    message,
    sentAt: Math.floor(Date.now() / 1000),
    status: "pending",
  };
  flights.push(flight);
  // Keep only last 50 flights
  if (flights.length > 50) flights.splice(0, flights.length - 50);
  saveFlights(flights);
  return flight;
}

function resolveFlights(messages: RelayMessage[], tuiName: string): Flight[] {
  const flights = loadFlights();
  let changed = false;

  for (const flight of flights) {
    if (flight.status !== "pending") continue;

    // Look for a reply from the target agent that mentions the requester
    for (const msg of messages) {
      if (
        msg.type === "MSG" &&
        msg.from === flight.to &&
        msg.timestamp > flight.sentAt &&
        (msg.body.includes(`@${flight.from}`) || msg.from === flight.to)
      ) {
        flight.status = "completed";
        flight.response = msg.body;
        flight.respondedAt = msg.timestamp;
        changed = true;
        break;
      }
    }
  }

  // Auto-expire flights older than 5 minutes
  const now = Math.floor(Date.now() / 1000);
  for (const flight of flights) {
    if (flight.status === "pending" && (now - flight.sentAt) > 300) {
      flight.status = "completed";
      flight.response = "(expired)";
      flight.respondedAt = now;
      changed = true;
    }
  }

  if (changed) saveFlights(flights);
  return flights;
}

// ── Vox Voice Integration ────────────────────────────────────────────────────

let voxClient: any = null;
let voxAvailable = false;

let VoxClientClass: any = null;

async function initVox(): Promise<boolean> {
  try {
    if (!VoxClientClass) {
      const mod = await import(join(process.env.HOME || "~", "dev", "vox", "packages", "client", "src", "index.ts"));
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

// ── TTS (audio output for the voice channel) ────────────────────────────────

interface RelayChannelConfig {
  audio: boolean;
  voice?: string;
}

interface RelayConfig {
  channels?: Record<string, RelayChannelConfig>;
  defaultVoice?: string;
}

function loadRelayConfig(relayDir: string): RelayConfig {
  try {
    return JSON.parse(readFileSync(join(relayDir, "config.json"), "utf8"));
  } catch {
    return {};
  }
}

let speakingNow = false;

function speakText(text: string, relayDir: string, onStart?: () => void, onEnd?: () => void): void {
  const config = loadRelayConfig(relayDir);
  const voiceCh = config.channels?.voice;
  if (!voiceCh?.audio) return;

  let apiKey = process.env.OPENAI_API_KEY || null;
  if (!apiKey) {
    try {
      const os = require("os");
      const raw = readFileSync(join(os.homedir(), ".config", "speakeasy", "settings.json"), "utf8");
      apiKey = JSON.parse(raw).providers?.openai?.apiKey || null;
    } catch { /* noop */ }
  }
  if (!apiKey) return;

  const clean = text.replace(/@[\w.-]+\s*/g, "").trim();
  if (!clean) return;

  const voice = voiceCh.voice || config.defaultVoice || "nova";

  speakingNow = true;
  onStart?.();

  fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "tts-1", voice, input: clean, response_format: "pcm", speed: 1.1 }),
  }).then(async (res) => {
    if (!res.ok || !res.body) { speakingNow = false; onEnd?.(); return; }

    const player = spawn("ffplay", [
      "-nodisp", "-autoexit", "-loglevel", "quiet",
      "-f", "s16le", "-ar", "24000", "-ch_layout", "mono", "-",
    ], { stdio: ["pipe", "ignore", "ignore"] });

    player.on("close", () => { speakingNow = false; onEnd?.(); });

    const reader = res.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      player.stdin.write(value);
    }
    player.stdin.end();
  }).catch(() => { speakingNow = false; onEnd?.(); });
}

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

type ActiveTab = "chat" | "agents" | "stats" | "voice";

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

function Header({ tab, agentCount, msgCount, voiceState, isSpeaking, flightsInFlight }: { tab: ActiveTab; agentCount: number; msgCount: number; voiceState?: string; isSpeaking?: boolean; flightsInFlight?: number }) {
  const [clock, setClock] = useState(ts());

  useEffect(() => {
    const iv = setInterval(() => setClock(ts()), 1000);
    return () => clearInterval(iv);
  }, []);

  const tabs: ActiveTab[] = ["chat", "agents", "stats", "voice"];

  return (
    <box flexDirection="row" justifyContent="space-between" padding={1} height={3}>
      <box flexDirection="row" gap={1}>
        <text fg={C.accent}><strong>◆</strong></text>
        <text fg={C.text}><strong> RELAY </strong></text>
        <text fg={C.dim}>monitor</text>
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
  selectedId,
  scrollOffset,
  maxVisible,
  width,
}: {
  messages: RelayMessage[];
  selectedId: number;
  scrollOffset: number;
  maxVisible: number;
  width: number;
}) {
  const filtered = messages.filter((m) => !isNoisySys(m));

  const visible = filtered.slice(
    Math.max(0, filtered.length - maxVisible - scrollOffset),
    filtered.length - scrollOffset
  );

  // Available width for message body: total - border(2) - padding(2) - cursor(2) - time(9) - name(14) - gaps(6)
  const bodyWidth = Math.max(20, width - 35);

  return (
    <box flexDirection="column" flexGrow={1} border borderStyle="rounded" borderColor={C.border} padding={1}>
      {visible.length === 0 ? (
        <text fg={C.dim}>No messages yet. Waiting for relay activity...</text>
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

function loadTwinsSync(): Record<string, { tmuxSession: string; project: string }> {
  const os = require("os");
  const twinsPath = join(os.homedir(), ".openscout", "relay", "twins.json");
  try {
    return JSON.parse(readFileSync(twinsPath, "utf8"));
  } catch {
    return {};
  }
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
  twins: Record<string, { tmuxSession: string; project: string }>;
}) {
  const alive = agents.filter((a) => a.status !== "forgotten");
  const forgotten = agents.filter((a) => a.status === "forgotten");

  const statusIcon = (s: AgentStatus["status"]) =>
    s === "online" ? "●" : s === "idle" ? "○" : "✗";
  const statusColor = (s: AgentStatus["status"]) =>
    s === "online" ? C.accent : s === "idle" ? C.muted : C.dim;
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
            <box flexDirection="row" gap={2}>
              <text fg={C.dim}>{pad("", 3)}</text>
              <text fg={C.dim}>{pad("agent", 18)}</text>
              <text fg={C.dim}>{pad("messages", 10)}</text>
              <text fg={C.dim}>{pad("last seen", 14)}</text>
              <text fg={C.dim}>status</text>
            </box>
            {alive.map((agent, i) => {
              const isSelected = i === selectedAgent;
              const twin = twins[agent.name];
              const hasTwin = twin && isTwinAlive(twin.tmuxSession);
              const activity = hasTwin ? captureTwinActivity(twin.tmuxSession) : "";
              const isWorking = activity && activity !== "idle" && activity !== "unreachable" && activity !== "starting...";
              return (
                <box key={agent.name} flexDirection="column">
                  <box flexDirection="row" gap={2}>
                    <text fg={isSelected ? C.accent : C.dim}>{isSelected ? "▸" : " "}</text>
                    <text fg={statusColor(agent.status)}>{statusIcon(agent.status)}</text>
                    <text fg={isSelected ? C.text : C.muted}><strong>{pad(agent.name, 18)}</strong></text>
                    <text fg={C.cyan}>{pad(String(agent.messages), 10)}</text>
                    <text fg={C.muted}>{pad(fmtRelative(agent.lastSeen), 14)}</text>
                    <text fg={hasTwin ? C.blue : statusColor(agent.status)}>{statusLabel(agent)}</text>
                  </box>
                  {hasTwin && activity && (
                    <box flexDirection="row" gap={2}>
                      <text fg={C.dim}>   </text>
                      <text fg={isWorking ? C.yellow : C.dim}>{isWorking ? "⏺" : "○"} {activity}</text>
                    </box>
                  )}
                </box>
              );
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
        <text fg={C.dim}>Say "@system up dewey" to spawn twins by voice</text>
      </box>
    </box>
  );
}

// ── Agent Cockpit (persistent across all views) ──────────────────────────────

function loadAgentStatesSync(relayDir: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(join(relayDir, "state.json"), "utf8"));
  } catch {
    return {};
  }
}

function AgentCockpit({ twins, agents, voiceState, isSpeaking, partialText, pendingCount, relayDir, width, recordingStart }: {
  twins: Record<string, { tmuxSession: string; project: string }>;
  agents: AgentStatus[];
  voiceState: "idle" | "connecting" | "recording" | "processing" | "error";
  isSpeaking: boolean;
  partialText: string;
  relayDir: string;
  pendingCount: number;
  width: number;
  recordingStart: number | null;
}) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!isSpeaking && voiceState !== "recording") return;
    const iv = setInterval(() => setFrame((f) => f + 1), 150);
    return () => clearInterval(iv);
  }, [isSpeaking, voiceState]);

  // Recording elapsed timer
  const [elapsed, setElapsed] = useState("");
  useEffect(() => {
    if (!recordingStart || voiceState === "idle") {
      setElapsed("");
      return;
    }
    const iv = setInterval(() => {
      const s = Math.floor((Date.now() - recordingStart) / 1000);
      const m = Math.floor(s / 60);
      setElapsed(m > 0 ? `${m}:${String(s % 60).padStart(2, "0")}` : `0:${String(s).padStart(2, "0")}`);
    }, 1000);
    return () => clearInterval(iv);
  }, [recordingStart, voiceState]);

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
  const tuiName = require("os").userInfo().username;
  for (const agent of agents) {
    if (twins[agent.name]) continue;
    if (agent.name === tuiName) continue;
    if (agent.name === "system") continue;
    if (agent.status === "online") {
      entries.push({ name: agent.name, activity: "online", status: "idle" });
    }
  }

  // Dev is always pinned at top; rest sorted by recency (most recent first)
  const devEntry = entries.find((e) => e.name === "dev") || { name: "dev", activity: "offline", status: "offline" as const };
  const rest = entries.filter((e) => e.name !== "dev").sort((a, b) => {
    // Working agents first, then by name as tiebreaker
    const order = { working: 0, idle: 1, offline: 2 };
    return order[a.status] - order[b.status];
  });

  const maxRows = 5;
  const otherSlots = maxRows - 1; // 1 slot reserved for dev
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

  const devIcon = devEntry.status === "working" ? "*" : devEntry.status === "idle" ? "o" : "x";

  // Inner width = total - border(2) - padding(2)
  const innerW = width - 4;

  // Build agent rows
  const agentRows: string[] = [];
  agentRows.push(fmtAgent(devIcon, devEntry.name, devEntry.activity));
  for (const e of shownOthers) {
    const icon = e.status === "working" ? "*" : e.status === "idle" ? "o" : "x";
    agentRows.push(fmtAgent(icon, e.name, e.activity));
  }
  if (hidden > 0) {
    agentRows.push("   +" + hidden + " more");
  }
  // Pad to maxRows so the box doesn't collapse
  while (agentRows.length < maxRows) agentRows.push("");

  // Recording / speaking indicator with wave animation
  const isRecording = voiceState === "recording";
  const isProcessing = voiceState === "processing" || voiceState === "connecting";
  const audioActive = isRecording || isProcessing || isSpeaking;
  const audioStr = isRecording ? `● REC ${elapsed || "0:00"}  ${wave}`
    : isProcessing ? "◌ processing..."
    : isSpeaking ? `◉ speaking  ${wave}`
    : "";

  return (
    <box flexDirection="column" border borderStyle="rounded" borderColor={isSpeaking ? C.cyan : isRecording ? C.red : C.border} padding={1} height={maxRows + (audioActive ? 3 : 2)}>
      <text fg={C.yellow}>{agentRows.join("\n")}</text>
      {audioActive && <text fg={isRecording ? C.red : isSpeaking ? C.cyan : C.yellow}>{audioStr}</text>}
    </box>
  );
}

function StatusBar({ tab }: { tab: ActiveTab }) {
  const hints: Record<ActiveTab, string> = {
    chat: "↑↓ scroll  c copy  v voice  tab switch  r refresh  q quit",
    agents: "↑↓ select  ⏎ peek  v voice  tab switch  r refresh  q quit",
    stats: "v voice  tab switch  r refresh  x clear  q quit",
    voice: "v record/stop  tab switch  q quit",
  };

  return (
    <box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1} height={2}>
      <text fg={C.dim}>{hints[tab]}</text>
      <text fg={C.dim}>1 chat  2 agents  3 stats  4 voice</text>
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
  const [voiceState, setVoiceState] = useState<"idle" | "connecting" | "recording" | "processing" | "error">("idle");
  const [recordingStart, setRecordingStart] = useState<number | null>(null);
  const [partialText, setPartialText] = useState("");
  const [recentTranscriptions, setRecentTranscriptions] = useState<Array<{ text: string; timestamp: number }>>([]);
  const [voiceThread, setVoiceThread] = useState<VoiceThread[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState(0);
  const [twins, setTwins] = useState<Record<string, { tmuxSession: string; project: string }>>({});
  const [activeFlights, setActiveFlights] = useState<Flight[]>([]);
  const relayDirRef = useRef<string | null>(null);
  const filePosRef = useRef(0);
  const voxSessionRef = useRef<any>(null);
  const tuiNameRef = useRef<string>("");
  // Watermark: last message id we've spoken — anything above this is new
  const lastSpokenMsgRef = useRef<number>(0);

  // header(3) + cockpit(6) + status(2) + chat border/padding(4) = 15
  const maxVisible = Math.max(height - 15, 5);

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

    // Load twins registry and compute live activity
    const currentTwins = loadTwinsSync();
    setTwins(currentTwins);

    // Auto-select newest message and reset scroll to bottom
    if (allMessages.length > 0) {
      setSelectedId(allMessages[allMessages.length - 1].id);
      setScrollOffset(0);
    }

    // Resolve flights
    const tuiName = tuiNameRef.current;
    if (tuiName) {
      const flights = resolveFlights(allMessages, tuiName);
      setActiveFlights(flights.filter((f) => f.status === "pending"));
    }

    // Voice channel: speak any new messages tagged with [speak]
    // The agent decides what's worth saying aloud — we just honor the tag.
    const newSpoken: VoiceThread[] = [];
    for (const msg of allMessages) {
      if (msg.id <= lastSpokenMsgRef.current) continue;
      if (msg.type !== "MSG") continue;
      if (msg.from === tuiName) continue; // don't speak your own messages
      if (!msg.body.startsWith("[speak] ")) continue;

      newSpoken.push({
        role: "agent",
        from: msg.from,
        text: msg.body.replace("[speak] ", ""),
        timestamp: msg.timestamp,
      });
      lastSpokenMsgRef.current = msg.id;
    }
    if (newSpoken.length > 0) {
      setVoiceThread((prev) => [...prev, ...newSpoken]);
    }

    // Read agent states from state.json — this is the source of truth
    try {
      const statePath = join(relayDir, "state.json");
      if (existsSync(statePath)) {
        const states: Record<string, string> = JSON.parse(readFileSync(statePath, "utf8"));
        const anySpeaking = Object.values(states).some((s) => s === "speaking");
        setIsSpeaking(anySpeaking);
      } else {
        setIsSpeaking(false);
      }
    } catch {
      setIsSpeaking(false);
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
    tuiNameRef.current = tuiName;
    const now = Math.floor(Date.now() / 1000);
    appendFileSync(logPath, `${now} ${tuiName} SYS ${tuiName} monitoring the relay\n`);

    // Try to connect to Vox for voice input
    initVox().then((ok) => {
      if (!ok) setVoiceState("error");
    });

    // Heartbeat — keep TUI showing as online
    const heartbeatIv = setInterval(() => {
      const t = Math.floor(Date.now() / 1000);
      appendFileSync(logPath, `${t} ${tuiName} SYS heartbeat\n`);
    }, ONLINE_THRESHOLD * 500); // halfway through threshold (5 min for 10 min threshold)

    // Set the spoken watermark to current message count so we don't speak old messages
    const initialMessages = readAllMessages(join(relayDir, "channel.log"));
    lastSpokenMsgRef.current = initialMessages.length > 0 ? initialMessages[initialMessages.length - 1].id : 0;

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

  // Voice toggle
  const toggleVoice = useCallback(async () => {
    const relayDir = relayDirRef.current;
    if (!relayDir) return;
    const logPath = join(relayDir, "channel.log");
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

    setVoiceState("recording");
    setRecordingStart(Date.now());
    setPartialText("");

    const session = voxClient.createLiveSession();
    voxSessionRef.current = session;

    session.on("partial", (event: any) => {
      setPartialText(event.text || "");
    });

    session.on("final", (event: any) => {
      let text = (event.text || "").trim();
      if (text) {
        // If no @mention, route to default agent (dev twin)
        const hasMention = /@[\w.-]+/.test(text);
        if (!hasMention) {
          text = `@dev ${text}`;
        }

        const now = Math.floor(Date.now() / 1000);
        // Send via CLI — handles log write, @system, and @mention delivery
        // Tag as voice channel so responses get spoken
        try {
          execSync(`openscout relay send --as ${tuiName} --channel voice ${JSON.stringify(text)}`, { stdio: "ignore" });
        } catch {
          // Fallback: write directly to log
          appendFileSync(logPath, `${now} ${tuiName} MSG ${text}\n`);
        }

        // Track @mentioned agents — we expect voice responses from them
        // Create flights for @mentioned targets
        const mentions = text.match(/@([\w.-]+)/g);
        if (mentions) {
          for (const m of mentions) {
            const target = m.slice(1);
            if (target !== tuiName && target !== "system") {
              createFlight(tuiName, target, text);
            }
          }
        }

        // Add to voice thread
        setVoiceThread((prev) => [...prev, { role: "you", from: tuiName, text, timestamp: now }]);
        setRecentTranscriptions((prev) => [...prev, { text, timestamp: now }]);
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
        const tabs: ActiveTab[] = ["chat", "agents", "stats", "voice"];
        const dir = key.shift ? -1 : 1;
        return tabs[(tabs.indexOf(prev) + dir + tabs.length) % tabs.length];
      });
    }

    if (key.name === "1") setTab("chat");
    if (key.name === "2") setTab("agents");
    if (key.name === "3") setTab("stats");
    if (key.name === "4") setTab("voice");
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
      <Header tab={tab} agentCount={agents.length} msgCount={messages.filter((m) => m.type === "MSG").length} voiceState={voiceState} isSpeaking={isSpeaking} flightsInFlight={activeFlights.length} />

      <AgentCockpit twins={twins} agents={agents} voiceState={voiceState} isSpeaking={isSpeaking} partialText={partialText} pendingCount={activeFlights.length} relayDir={relayDirRef.current || ""} width={width} recordingStart={recordingStart} />

      <box flexDirection="row" flexGrow={1}>
        <box flexDirection="column" flexGrow={1}>
          {tab === "chat" && (
            <ChatPanel
              messages={messages}
              selectedId={selectedId}
              scrollOffset={scrollOffset}
              maxVisible={maxVisible}
              width={width}
            />
          )}
          {tab === "agents" && <AgentsPanel agents={agents} selectedAgent={selectedAgent} twins={twins} />}
          {tab === "stats" && <StatsPanel messages={messages} agents={agents} dbEntries={dbEntries} />}
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
