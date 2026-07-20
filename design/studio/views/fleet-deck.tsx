"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./fleet-deck.module.css";

/**
 * Fleet Deck — v2 iteration (multi-machine · voice · remote control).
 *
 * Mixer DNA, master-detail, one dedicated detail rail:
 *
 *   1. THE SELECTOR REFLECTS THE FLEET. One segmented channel-assign bar,
 *      one segment per real host — a single host skips the bar entirely.
 *      (FLEET 1/3/4 in the masthead is a study control.)
 *   2. THE PANEL IS THE HOST; THE RAIL IS THE DETAIL. Agents, activity,
 *      windows, approvals — everything selectable lands in the one
 *      dedicated rail on the right. Rows don't expand; they select. The
 *      rail answers approvals ("approve refactor?" + the diff + verbs)
 *      and ordinary context ("what the activity says, and what to do
 *      about it") in the same place, at any scale.
 *   3. THE KEYBOARD LINE ONLY EXISTS IN WINDOW MODE. Machine controls
 *      don't park dimmed in agent view — they don't exist. Clipboard
 *      cluster left, enter/backspace right, press-and-hold joystick
 *      center: walk the window list, center-tap focuses on the machine.
 *   4. COMPOSER PLACEMENT IS A CHOICE (MSG DECK/HOST). Docked at deck
 *      level it's universal — route verbally ("on studio, approve
 *      grok"). Scoped into the host panel it's that machine's command
 *      line.
 *   5. ATTENTION IS A SIGNAL, NOT A SURFACE. Amber dot on the row,
 *      amber edge on the segment, a pill in the masthead — all of them
 *      point at the rail, where the ask actually lives.
 *   6. FLAT BY DEFAULT. Color means (amber = attention, green/red =
 *      health), nothing blooms, no bevels.
 */

// ── Data ─────────────────────────────────────────────────────────────

type Reach = "online" | "offline";
type AgentStatus = "thinking" | "running" | "waiting" | "idle" | "offline";
type Verb = "approve" | "reply" | "later" | "message" | "watch" | "focus";

interface LogLine {
  t: string;
  who: string;
  what: string;
  /** what the line means for the operator, and what to do about it */
  gloss?: string;
  verbs?: Verb[];
}

interface Win {
  app: string;
  title: string;
  owner?: string;
  attention?: boolean;
  kind: "code" | "diff" | "term" | "web" | "files";
  peek: string[];
}

interface Host {
  id: string;
  ch: string;
  name: string;
  icon: "laptop" | "desktop" | "mini";
  reach: Reach;
  context: string;
  cpu: number;
  win: number;
  lastSeen?: string;
  parkedNote?: string;
  log: LogLine[];
  windows: Win[];
}

interface Agent {
  id: string;
  name: string;
  hostId: string;
  host: string;
  status: AgentStatus;
  line: string;
  unread: number;
  peekTitle: string;
  peek: string[];
  meta: string;
}

const HOSTS: Host[] = [
  {
    id: "mbp",
    ch: "CH 01",
    name: "Arach MacBook Pro",
    icon: "laptop",
    reach: "online",
    context: "2 agents · Claude, Codex",
    cpu: 34,
    win: 10,
    log: [
      { t: "09:41", who: "CLAUDE", what: "analyzing FleetDeckScreen.swift — mapping call sites", gloss: "Claude is mid-analysis — a patch draft usually follows. No input needed yet.", verbs: ["message"] },
      { t: "09:38", who: "CODEX", what: "npm run build — compiling 42 modules", gloss: "Build running. You'll get a pass/fail when it lands — watch it or ignore it.", verbs: ["watch"] },
      { t: "09:31", who: "CLAUDE", what: "committed 3 files to feat/deck-context", gloss: "Work is landing incrementally — safe to peek, nothing to do.", verbs: ["message"] },
      { t: "09:24", who: "SYNC", what: "2 agents live · mesh nominal", gloss: "Both agents connected and syncing. Nothing to do.", verbs: ["watch"] },
      { t: "09:18", who: "CODEX", what: "test suite green — 214 passed", gloss: "Clean baseline for the build above." },
      { t: "09:07", who: "SYNC", what: "channel #fleet-deck opened", gloss: "Coordination channel opened this morning." },
    ],
    windows: [
      {
        app: "CODE", title: "openscout · FleetDeckScreen.swift", owner: "CLAUDE", kind: "code",
        peek: ["208  const route = useRoutes(fleet)", "209  const channel = route.channel(id)", "210  // map call sites → lanes", "211  for (const site of sites) {"],
      },
      {
        app: "TERMINAL", title: "npm run build · compiling 42 modules", owner: "CODEX", kind: "term",
        peek: ["$ npm run build", "› compiling 42 of 58 modules…", "› scout-web · packages/web"],
      },
      {
        app: "SAFARI", title: "12 tabs · arxiv reader", kind: "web",
        peek: ["arxiv.org/list/cs.CL/recent", "12 tabs · reading 2"],
      },
      {
        app: "FINDER", title: "2 windows", kind: "files",
        peek: ["Downloads · 14 items", "Screenshots · 231 items"],
      },
      {
        app: "SLACK", title: "#fleet-deck", kind: "web",
        peek: ["#fleet-deck · 3 unread", "#openscout · muted"],
      },
    ],
  },
  {
    id: "studio",
    ch: "CH 02",
    name: "Studio",
    icon: "desktop",
    reach: "online",
    context: "1 agent · Grok",
    cpu: 52,
    win: 8,
    log: [
      { t: "09:42", who: "GROK", what: "awaiting review — “approve refactor?”", gloss: "Pass 2 is done and Grok is blocked on you. Everything after this is queued behind your answer.", verbs: ["approve", "reply"] },
      { t: "09:36", who: "GROK", what: "refactor pass 2 of 3 complete", gloss: "Landed cleanly. Pass 3 starts the moment you approve.", verbs: ["approve"] },
      { t: "09:29", who: "QUEUE", what: "1 task queued behind review", gloss: "The queue drains by itself — approving releases it.", verbs: ["approve"] },
      { t: "09:12", who: "SYNC", what: "1 agent live · mesh nominal", gloss: "Studio is connected and syncing fine. Nothing to do.", verbs: ["watch"] },
      { t: "09:05", who: "GROK", what: "refactor pass 1 of 3 complete", gloss: "Earlier pass, already superseded by pass 2." },
      { t: "08:58", who: "SYNC", what: "host registered · mesh join", gloss: "Studio joined the mesh this morning." },
    ],
    windows: [
      {
        app: "CODE", title: "openscout · refactor pass 2 of 3", owner: "GROK", kind: "code",
        peek: [" 91  export function route(f: Flight) {", " 92  return gate(f).through(lanes)", " 93  }"],
      },
      {
        app: "PREVIEW", title: "diff review · awaiting approval", owner: "GROK", attention: true, kind: "diff",
        peek: ["@@ router.ts · 3 hunks · +84 −61", "+  const flight = gate(review).route()", "-  const flight = autoRoute(review)", "+  await broker.ask(target, payload)"],
      },
      {
        app: "TERMINAL", title: "vitest watch · 214 passed", kind: "term",
        peek: ["$ vitest watch", " ✓ 214 passed · 0 failed", "watching for changes…"],
      },
      {
        app: "SAFARI", title: "4 tabs · swift forums", kind: "web",
        peek: ["forums.swift.org/t/actor-isolation", "4 tabs"],
      },
    ],
  },
  {
    id: "mini",
    ch: "CH 03",
    name: "Mac mini",
    icon: "mini",
    reach: "online",
    context: "1 agent · Kimi",
    cpu: 61,
    win: 6,
    log: [
      { t: "09:40", who: "KIMI", what: "summarizing 18 arxiv abstracts into brief", gloss: "12 of 18 done — the brief lands when the batch completes.", verbs: ["watch"] },
      { t: "09:33", who: "KIMI", what: "embedded 42 papers into the index", gloss: "The index is warm — searches will hit these now." },
      { t: "09:27", who: "QUEUE", what: "2 tasks queued", gloss: "Processed in order; nothing blocked on you." },
      { t: "09:15", who: "SYNC", what: "1 agent live · mesh nominal", gloss: "Mac mini is connected. Nothing to do.", verbs: ["watch"] },
      { t: "09:08", who: "KIMI", what: "fetched 18 arxiv PDFs", gloss: "Source material for the summarizing above." },
      { t: "08:52", who: "SYNC", what: "host registered · mesh join", gloss: "Mac mini joined the mesh." },
    ],
    windows: [
      {
        app: "TERMINAL", title: "kimi · arxiv pipeline", owner: "KIMI", kind: "term",
        peek: ["$ kimi run arxiv-pipeline", "› embedding 42 papers · 12 of 18 summarized"],
      },
      {
        app: "SAFARI", title: "18 tabs · arxiv PDFs", kind: "web",
        peek: ["arxiv.org/abs/2507.11432", "18 tabs · PDFs"],
      },
      {
        app: "CODE", title: "notes · brief.md", kind: "code",
        peek: ["# Brief", "## 1. Mixture-of-depths", "- 12 papers cite routing"],
      },
    ],
  },
  {
    id: "build",
    ch: "CH 04",
    name: "Build Mac",
    icon: "desktop",
    reach: "offline",
    context: "Gemini · parked",
    cpu: 0,
    win: 0,
    lastSeen: "12m ago",
    parkedNote: "1 session parked · resumes on reconnect",
    log: [],
    windows: [
      {
        app: "XCODE", title: "Scout.xcworkspace · archived build", kind: "code",
        peek: ["Scout.xcworkspace — archived", "last build · succeeded 12m ago"],
      },
      {
        app: "TERMINAL", title: "xcodebuild · last run 12m ago", kind: "term",
        peek: ["$ xcodebuild -scheme Scout", "** ARCHIVE SUCCEEDED ** · 12m ago"],
      },
    ],
  },
];

const AGENTS: Agent[] = [
  {
    id: "claude",
    name: "CLAUDE",
    hostId: "mbp",
    host: "Arach MacBook Pro",
    status: "thinking",
    line: "analyzing FleetDeckScreen.swift — mapping call sites",
    unread: 3,
    peekTitle: "FleetDeckScreen.swift",
    peek: [
      "208  const route = useRoutes(fleet)",
      "209  const channel = route.channel(id)",
      "210  // map call sites → lanes",
      "211  for (const site of sites) {",
    ],
    meta: "4 files touched · +61 −22 · “found 3 call sites” · 40s ago",
  },
  {
    id: "codex",
    name: "CODEX",
    hostId: "mbp",
    host: "Arach MacBook Pro",
    status: "running",
    line: "$ npm run build — compiling 42 modules",
    unread: 7,
    peekTitle: "npm run build",
    peek: ["$ npm run build", "› compiling 42 of 58 modules…", "› scout-web · packages/web"],
    meta: "no failures so far · 7 new messages",
  },
  {
    id: "grok",
    name: "GROK",
    hostId: "studio",
    host: "Studio",
    status: "waiting",
    line: "awaiting review — “approve refactor?”",
    unread: 1,
    peekTitle: "refactor pass 2 of 3",
    peek: [" 91  export function route(f: Flight) {", " 92  return gate(f).through(lanes)", " 93  }"],
    meta: "6 files changed · +84 −61 · 214 tests green",
  },
  {
    id: "kimi",
    name: "KIMI",
    hostId: "mini",
    host: "Mac mini",
    status: "running",
    line: "summarizing 18 arxiv abstracts into brief",
    unread: 0,
    peekTitle: "brief.md",
    peek: ["# Brief", "## 1. Mixture-of-depths", "- 12 papers cite routing"],
    meta: "12 of 18 summarized · +120 lines",
  },
  {
    id: "gemini",
    name: "GEMINI",
    hostId: "build",
    host: "Build Mac",
    status: "offline",
    line: "offline — last seen 12m ago",
    unread: 0,
    peekTitle: "offline",
    peek: ["— last seen 12m ago", "1 session parked · resumes on reconnect"],
    meta: "queued messages deliver on reconnect",
  },
];

const COMMANDS = [
  { name: "WATCH", meta: "source · live" },
  { name: "SNAPSHOT", meta: "capture · 2h ago" },
  { name: "DIGEST", meta: "brief · 09:41" },
  { name: "COMPARE", meta: "diff · never" },
  { name: "ALERT", meta: "notify · armed" },
  { name: "SCAN", meta: "scout · ok 08:15" },
];

/** A keyboard line, not a keyboard — clipboard left, enter/backspace right. */
const LEFT_KEYS: [string, string][] = [
  ["ESC", "esc"],
  ["TAB", "tab"],
  ["CUT", "cut"],
  ["COPY", "copy"],
  ["PASTE", "paste"],
];
const RIGHT_KEYS: [string, string][] = [
  ["SPACE", "space"],
  ["⌫", "backspace"],
  ["⏎", "return"],
  ["⌘⇥", "app switch"],
];

/** The channel that currently owns the attention ask. */
const ATTENTION = {
  hostId: "studio",
  agentId: "grok",
  waiting: "4m",
  quote: "“approve refactor?”",
  peekTitle: "router.ts — diff review",
  peek: [
    "@@ router.ts · 3 hunks · +84 −61",
    "+  const flight = gate(review).route()",
    "-  const flight = autoRoute(review)",
    "+  await broker.ask(target, payload)",
  ],
  meta: "6 files changed · 214 tests green · preview open on Studio",
};

/** Study control — try the selector at different fleet sizes. */
const FLEETS: Record<1 | 3 | 4, string[]> = {
  1: ["mbp"],
  3: ["mbp", "studio", "mini"],
  4: ["mbp", "studio", "mini", "build"],
};

const STATUS_LABEL: Record<AgentStatus, string> = {
  thinking: "THINKING",
  running: "RUNNING",
  waiting: "WAITING",
  idle: "IDLE",
  offline: "OFFLINE",
};

type JoyDir = "up" | "down" | "left" | "right" | "center";
type DetailSel =
  | { kind: "agent"; id: string }
  | { kind: "activity"; index: number }
  | null;

// ── Icons ────────────────────────────────────────────────────────────

function HostGlyph({ kind }: { kind: Host["icon"] }) {
  if (kind === "laptop") {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="5" y="4" width="14" height="10" rx="1.5" />
        <path d="M2 18h20" />
      </svg>
    );
  }
  if (kind === "mini") {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="4" y="8" width="16" height="8" rx="2" />
        <path d="M7 12h.01" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M9 20h6M12 16v4" />
    </svg>
  );
}

function MicGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

// ── Peek frame — the flat little thumbnail of what something shows ────

function PeekFrame({
  title,
  lines,
  stale,
}: {
  title: string;
  lines: string[];
  stale?: boolean;
}) {
  return (
    <div className={`${styles.peekFrame} ${stale ? styles.winStale : ""}`}>
      <div className={styles.peekChrome}>
        <i />
        <i />
        <i />
        <span className={styles.peekTitle}>{title}</span>
      </div>
      <div className={styles.peekBody}>
        {lines.map((line, i) => (
          <div key={i} className={styles.peekLine}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── View ─────────────────────────────────────────────────────────────

export default function FleetDeck() {
  const [fleetSize, setFleetSize] = useState<1 | 3 | 4>(4);
  const [selected, setSelected] = useState("studio");
  const [resolved, setResolved] = useState(false);
  const [target, setTarget] = useState("grok");
  const [mode, setMode] = useState<"agent" | "window">("agent");
  const [composerAt, setComposerAt] = useState<"deck" | "host">("deck");
  const [split, setSplit] = useState(50);
  const [winCursor, setWinCursor] = useState(0);
  const [focusedWin, setFocusedWin] = useState<number | null>(null);
  const [detailSel, setDetailSel] = useState<DetailSel>({ kind: "agent", id: "grok" });
  const [joyDir, setJoyDir] = useState<JoyDir | null>(null);
  const [mic, setMic] = useState<"idle" | "listening" | "heard">("idle");
  const [flash, setFlash] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const joyRef = useRef<HTMLDivElement>(null);
  const joyDirRef = useRef<JoyDir | null>(null);
  const joyHold = useRef<number | null>(null);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      if (joyHold.current) clearInterval(joyHold.current);
    },
    [],
  );

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const flashStatus = (msg: string) => {
    setFlash(msg);
    later(() => setFlash(null), 2600);
  };

  const fleetIds = FLEETS[fleetSize];
  const fleetHosts = HOSTS.filter((h) => fleetIds.includes(h.id));
  const attentionInFleet = fleetIds.includes(ATTENTION.hostId);

  const effectiveAgents = AGENTS.map((a) =>
    a.id === "grok" && resolved
      ? { ...a, status: "running" as AgentStatus, line: "resuming — review approved, continuing refactor", unread: 0 }
      : a,
  );
  const fleetAgents = effectiveAgents.filter((a) => fleetIds.includes(a.hostId));

  const host = HOSTS.find((h) => h.id === selected) ?? fleetHosts[0];
  const hostAgents = effectiveAgents.filter((a) => a.hostId === host.id);
  const hostTargets = hostAgents.filter((a) => a.status !== "offline");
  const hostOffline = host.reach === "offline";
  const hostHasAttention = host.id === ATTENTION.hostId && !resolved;
  const onlineHosts = fleetHosts.filter((h) => h.reach === "online").length;
  const targetAgent = effectiveAgents.find((a) => a.id === target) ?? hostAgents[0] ?? effectiveAgents[0];
  const windows = host.windows;
  const peekWin = windows.length ? windows[Math.min(winCursor, windows.length - 1)] : null;

  /** default rail content for a host: the ask if there is one, else the first agent */
  const defaultDetail = (hostId: string): DetailSel => {
    if (hostId === ATTENTION.hostId && !resolved) return { kind: "agent", id: ATTENTION.agentId };
    const first = effectiveAgents.find((a) => a.hostId === hostId && a.status !== "offline") ??
      effectiveAgents.find((a) => a.hostId === hostId);
    return first ? { kind: "agent", id: first.id } : null;
  };

  const selectHost = (id: string) => {
    setSelected(id);
    setWinCursor(0);
    setFocusedWin(null);
    setDetailSel(defaultDetail(id));
    const first = effectiveAgents.find((a) => a.hostId === id && a.status !== "offline");
    if (first) setTarget(first.id);
  };

  const setFleet = (n: 1 | 3 | 4) => {
    setFleetSize(n);
    const ids = FLEETS[n];
    if (!ids.includes(selected)) selectHost(ids.includes(ATTENTION.hostId) ? ATTENTION.hostId : ids[0]);
  };

  const resolveAttention = (via: string) => {
    setResolved(true);
    flashStatus(`approved grok · via ${via} — resuming`);
  };

  // Scripted push-to-talk: listen → hear "approve grok" → resolve the ask.
  const pushToTalk = () => {
    if (mic !== "idle") return;
    setMic("listening");
    later(() => setMic("heard"), 1300);
    later(() => {
      setMic("idle");
      if (!resolved && attentionInFleet) resolveAttention("voice");
      else flashStatus("heard “approve grok” — nothing waiting");
    }, 2400);
  };

  const cycleTarget = () => {
    if (hostTargets.length === 0) return;
    const i = hostTargets.findIndex((a) => a.id === target);
    setTarget(hostTargets[(i + 1) % hostTargets.length].id);
  };

  const messageAgent = (id: string) => {
    setTarget(id);
    inputRef.current?.focus();
  };

  const runCommand = (name: string) => {
    flashStatus(
      `${name.toLowerCase()} · ${host.name} — ${hostOffline ? "queued · runs on reconnect" : "started"}`,
    );
  };

  const drive = (what: string) => {
    flashStatus(`${what} · ${host.name}${hostOffline ? " — queued for reconnect" : ""}`);
  };

  const focusWindow = (i: number) => {
    setWinCursor(i);
    if (hostOffline) return;
    setFocusedWin(i);
    drive(`focus · ${windows[i].app.toLowerCase()}`);
  };

  /** rail verbs — the same printed words you could say */
  const runVerb = (verb: Verb, agentId?: string) => {
    if (verb === "approve") resolveAttention("tap");
    else if (verb === "reply" || verb === "message") messageAgent(agentId ?? ATTENTION.agentId);
    else if (verb === "watch") runCommand("WATCH");
    else if (verb === "focus") focusWindow(winCursor);
    else if (verb === "later") setDetailSel(defaultDetail(selected));
  };

  // Press-and-hold joystick — quadrant from pointer position, center = select.
  const joyDirFromPoint = (x: number, y: number): JoyDir => {
    const el = joyRef.current;
    if (!el) return "center";
    const r = el.getBoundingClientRect();
    const dx = x - (r.left + r.width / 2);
    const dy = y - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < r.width * 0.16) return "center";
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
  };

  const joyNudge = (dir: JoyDir) => {
    if (dir === "center") {
      focusWindow(winCursor);
      return;
    }
    if (dir === "up" || dir === "down") {
      if (windows.length === 0) return;
      setWinCursor((c) => (c + (dir === "down" ? 1 : -1) + windows.length) % windows.length);
      return;
    }
    drive(dir === "right" ? "switch app ⌘⇥" : "switch app ⌘⇤");
  };

  const joyDown = (e: React.PointerEvent) => {
    if (mode !== "window" || hostOffline) return;
    e.preventDefault();
    joyRef.current?.setPointerCapture?.(e.pointerId);
    const d = joyDirFromPoint(e.clientX, e.clientY);
    joyDirRef.current = d;
    setJoyDir(d);
    joyNudge(d);
    joyHold.current = window.setInterval(() => {
      if (joyDirRef.current) joyNudge(joyDirRef.current);
    }, 550);
  };

  const joyMove = (e: React.PointerEvent) => {
    if (!joyDirRef.current) return;
    const d = joyDirFromPoint(e.clientX, e.clientY);
    if (d !== joyDirRef.current) {
      joyDirRef.current = d;
      setJoyDir(d);
    }
  };

  const joyUp = () => {
    joyDirRef.current = null;
    setJoyDir(null);
    if (joyHold.current) {
      clearInterval(joyHold.current);
      joyHold.current = null;
    }
  };

  // Drag-resizable agents/activity split.
  const onDividerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      if (!bodyRef.current) return;
      const r = bodyRef.current.getBoundingClientRect();
      const pct = ((ev.clientX - r.left) / r.width) * 100;
      setSplit(Math.min(75, Math.max(25, pct)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const composerPlaceholder = hostOffline
    ? `${host.name} offline — messages queue for reconnect`
    : mode === "window"
      ? `Drive ${host.name} — keystrokes + dictation go to the machine`
      : composerAt === "host"
        ? `Message ${targetAgent.name.toLowerCase()} · ${host.name} — or hold the mic…`
        : `Message ${targetAgent.name.toLowerCase()} — or hold the mic…`;

  const renderComposer = (place: "deck" | "host") => (
    <div className={place === "deck" ? styles.composerWrap : styles.ctxComposer}>
      <div className={styles.composer}>
        <button
          className={styles.targetChip}
          onClick={cycleTarget}
          title="Tap to switch target on this host"
        >
          {targetAgent.name} ▾
        </button>
        {mic === "idle" ? (
          <input
            ref={place === "deck" ? inputRef : undefined}
            className={styles.input}
            placeholder={composerPlaceholder}
          />
        ) : (
          <div className={styles.voiceLine}>
            <span className={styles.bars}>
              <i /><i /><i /><i /><i />
            </span>
            {mic === "listening" ? "listening…" : "“approve grok”"}
          </div>
        )}
        <button
          className={`${styles.micBtn} ${mic !== "idle" ? styles.micActive : ""}`}
          onClick={pushToTalk}
          aria-label="Push to talk"
        >
          <MicGlyph />
        </button>
        <button className={styles.sendBtn}>Send ▸</button>
      </div>
      <div className={styles.grammar}>
        {place === "deck" ? (
          <>
            voice: <em>“on studio, approve grok”</em> · <em>“tell kimi: status”</em> ·{" "}
            <em>“mac mini, run digest”</em>
          </>
        ) : (
          <>
            voice: <em>“approve grok”</em> · <em>“run digest”</em> · <em>“watch”</em>
          </>
        )}
      </div>
    </div>
  );

  // ── Detail rail content ────────────────────────────────────────────

  const railVerbs = (verbs: Verb[], agentId?: string) => (
    <div className={styles.verbRow}>
      {verbs.map((v) => (
        <button
          key={v}
          className={`${styles.verbBtn} ${v === "approve" ? styles.verbAccent : ""}`}
          onClick={() => runVerb(v, agentId)}
        >
          “{v}”
        </button>
      ))}
    </div>
  );

  const renderRail = () => {
    // window view: the rail follows the window cursor
    if (mode === "window" && peekWin) {
      return (
        <>
          <div className={styles.railHead}>
            <span>DETAIL · WINDOW</span>
            <span className={styles.railTag}>
              {hostOffline ? "last known" : focusedWin === winCursor ? "focused" : "live"}
            </span>
          </div>
          <div className={styles.railBody}>
            <div className={styles.railTitle}>
              {peekWin.app} <span>· {peekWin.title}</span>
            </div>
            <PeekFrame title={peekWin.title} lines={peekWin.peek} stale={hostOffline} />
            {!hostOffline && railVerbs(["focus"])}
          </div>
        </>
      );
    }

    if (detailSel?.kind === "activity") {
      const line = host.log[detailSel.index];
      if (line) {
        return (
          <>
            <div className={styles.railHead}>
              <span>DETAIL · ACTIVITY</span>
              <span className={styles.railTag}>{line.t}</span>
            </div>
            <div className={styles.railBody}>
              <div className={styles.railTitle}>
                {line.who} <span>· {line.what}</span>
              </div>
              <div className={styles.railGloss}>
                {line.gloss ?? "Logged for the record — nothing to do."}
              </div>
              {line.verbs && line.verbs.length > 0 && railVerbs(line.verbs)}
            </div>
          </>
        );
      }
    }

    const agentId =
      detailSel?.kind === "agent" ? detailSel.id : defaultDetail(selected)?.kind === "agent"
        ? (defaultDetail(selected) as { kind: "agent"; id: string } | null)?.id
        : undefined;
    const agent = effectiveAgents.find((a) => a.id === agentId && a.hostId === host.id);
    if (agent) {
      const isAsk = agent.id === ATTENTION.agentId && !resolved;
      return (
        <>
          <div className={styles.railHead}>
            <span>{isAsk ? "DETAIL · APPROVAL" : "DETAIL · AGENT"}</span>
            <span className={`${styles.railTag} ${isAsk ? styles.railTagAttention : ""}`}>
              {isAsk ? `waiting ${ATTENTION.waiting}` : STATUS_LABEL[agent.status].toLowerCase()}
            </span>
          </div>
          <div className={styles.railBody}>
            <div className={styles.railTitle}>
              {agent.name} <span>· {agent.host}</span>
            </div>
            {isAsk && <div className={styles.rowQuote}>{ATTENTION.quote}</div>}
            <PeekFrame
              title={isAsk ? ATTENTION.peekTitle : agent.peekTitle}
              lines={isAsk ? ATTENTION.peek : agent.peek}
              stale={hostOffline}
            />
            <div className={styles.rowMeta}>{isAsk ? ATTENTION.meta : agent.meta}</div>
            {isAsk
              ? railVerbs(["approve", "reply", "later"], agent.id)
              : agent.status !== "offline" && railVerbs(["message"], agent.id)}
          </div>
        </>
      );
    }

    return (
      <>
        <div className={styles.railHead}>
          <span>DETAIL</span>
        </div>
        <div className={styles.railBody}>
          <div className={styles.railGloss}>Select an agent, an activity line, or a window.</div>
        </div>
      </>
    );
  };

  const parked = hostOffline;

  return (
    <div className={styles.page}>
      <div className={styles.eyebrow}>· studies · cross · fleet-deck</div>
      <h1 className={styles.title}>Fleet Deck — v2</h1>
      <p className={styles.blurb}>
        One segmented channel row sized to your actual fleet; the panel below is the selected host,
        and the rail on the right is the one place details live — approvals, what an agent is doing,
        what an activity line means and what to do about it. Rows select; they don’t expand. Flat by
        default: color means, light doesn’t bloom.
      </p>

      <div className={styles.deck}>
        {/* Masthead */}
        <div className={styles.masthead}>
          <div className={styles.brand}>
            SCOUT <span>· DECK</span>
          </div>
          <div className={styles.mastRight}>
            {attentionInFleet && !resolved && (
              <button
                className={styles.mastPill}
                onClick={() => {
                  selectHost(ATTENTION.hostId);
                  setMode("agent");
                  setDetailSel({ kind: "agent", id: ATTENTION.agentId });
                }}
                title="Go to the channel that needs you"
              >
                1 NEEDS YOU
              </button>
            )}
            <div className={styles.hostSummary}>
              {fleetHosts.length} HOST{fleetHosts.length === 1 ? "" : "S"} ·{" "}
              <b>{onlineHosts} ONLINE</b>
            </div>
            <div className={styles.layoutSwitch} title="Composer placement — universal vs host-scoped">
              <span className={styles.switchLabel}>MSG</span>
              <button
                className={`${styles.segBtn} ${composerAt === "deck" ? styles.segActive : ""}`}
                onClick={() => setComposerAt("deck")}
              >
                DECK
              </button>
              <button
                className={`${styles.segBtn} ${composerAt === "host" ? styles.segActive : ""}`}
                onClick={() => setComposerAt("host")}
              >
                HOST
              </button>
            </div>
            <div className={styles.layoutSwitch} title="Study control — fleet size">
              <span className={styles.switchLabel}>FLEET</span>
              {([1, 3, 4] as const).map((n) => (
                <button
                  key={n}
                  className={`${styles.segBtn} ${fleetSize === n ? styles.segActive : ""}`}
                  onClick={() => setFleet(n)}
                >
                  {n}
                </button>
              ))}
            </div>
            <button className={styles.closeBtn} aria-label="Close">
              ×
            </button>
          </div>
        </div>

        {/* Channel-assign selector — only exists when the fleet has more than one host */}
        {fleetHosts.length > 1 && (
          <div className={styles.selector}>
            {fleetHosts.map((h) => {
              const isSelected = selected === h.id;
              const offline = h.reach === "offline";
              const needsYou = h.id === ATTENTION.hostId && !resolved;
              const agentCount = AGENTS.filter((a) => a.hostId === h.id).length;
              return (
                <button
                  key={h.id}
                  className={`${styles.segment} ${isSelected ? styles.segSelected : ""} ${
                    needsYou ? styles.segAttention : ""
                  } ${offline ? styles.segOffline : ""}`}
                  onClick={() => selectHost(h.id)}
                >
                  <span className={styles.hostIcon}>
                    <HostGlyph kind={h.icon} />
                  </span>
                  <span className={styles.segName}>{h.name}</span>
                  {needsYou && <i className={styles.segNeed} title="Needs you" />}
                  <span className={styles.segMeta}>
                    {offline ? "offline" : `${agentCount} agt · ${h.cpu}%`}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className={styles.mainRow}>
          {/* Selected host — context panel */}
          <section className={styles.ctxPanel}>
            <div className={styles.ctxHead}>
              <span className={styles.ctxCh}>{host.ch}</span>
              <span className={styles.hostIcon}>
                <HostGlyph kind={host.icon} />
              </span>
              <span className={styles.ctxName}>{host.name}</span>
              <span
                className={`${styles.reach} ${hostOffline ? styles.reachOffline : styles.reachOnline}`}
              >
                <i className={styles.reachDot} />
                {hostOffline ? `offline · last seen ${host.lastSeen}` : "online"}
              </span>
              {!hostOffline && (
                <span className={styles.telem}>
                  <span>
                    <span>CPU</span>
                    {host.cpu}
                  </span>
                  <span>
                    <span>WIN</span>
                    {host.win}
                  </span>
                </span>
              )}
              <div
                className={styles.layoutSwitch}
                title="Panel view — the agents, or the machine's windows"
              >
                <button
                  className={`${styles.segBtn} ${mode === "agent" ? styles.segActive : ""}`}
                  onClick={() => setMode("agent")}
                >
                  AGENT
                </button>
                <button
                  className={`${styles.segBtn} ${mode === "window" ? styles.segActive : ""}`}
                  onClick={() => setMode("window")}
                >
                  WINDOW
                </button>
              </div>
            </div>

            {host.id === ATTENTION.hostId && resolved && mode === "agent" && (
              <div className={styles.attnSlim}>
                <span className={styles.attnSlimOk}>✓ approved — Grok is resuming work</span>
                <button className={styles.attnSlimBtn} onClick={() => setResolved(false)}>
                  Undo
                </button>
              </div>
            )}

            {mode === "window" ? (
              /* WINDOW view — the machine's live windows; the rail follows */
              <div className={styles.winBody}>
                <div className={styles.ctxLabel}>
                  Windows · {hostOffline ? `last known · ${host.lastSeen}` : `${windows.length} open`}
                  {!hostOffline && (
                    <span className={styles.ctxHint}>joystick ↑↓ to walk · center to focus</span>
                  )}
                </div>
                {windows.map((w, i) => (
                  <div
                    key={i}
                    role="button"
                    tabIndex={0}
                    className={`${styles.winRow} ${i === winCursor ? styles.winCursor : ""} ${
                      hostOffline ? styles.winStale : ""
                    }`}
                    onClick={() => setWinCursor(i)}
                    onKeyDown={(e) => e.key === "Enter" && setWinCursor(i)}
                  >
                    <i
                      className={`${styles.winDot} ${w.attention ? styles.winDotAttention : ""} ${
                        i === focusedWin ? styles.winDotFocused : ""
                      }`}
                    />
                    <span className={styles.winApp}>{w.app}</span>
                    <span className={styles.winTitle}>{w.title}</span>
                    <span className={styles.winMeta}>
                      {w.owner ?? (i === focusedWin ? "focused" : "")}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              /* AGENT view — agents + activity in a resizable split */
              <div
                ref={bodyRef}
                className={styles.ctxBody}
                style={{ gridTemplateColumns: `${split}fr 5px ${100 - split}fr` }}
              >
                <div className={styles.ctxCol}>
                  <div className={styles.ctxLabel}>Agents · {hostAgents.length}</div>
                  {hostAgents.map((a) => (
                    <div
                      key={a.id}
                      role="button"
                      tabIndex={0}
                      className={`${styles.row} ${styles.rowBtn} ${
                        styles[`st${a.status[0].toUpperCase()}${a.status.slice(1)}`]
                      } ${a.status === "offline" ? styles.rowDim : ""} ${
                        detailSel?.kind === "agent" && detailSel.id === a.id ? styles.rowSelected : ""
                      }`}
                      onClick={() => setDetailSel({ kind: "agent", id: a.id })}
                      onKeyDown={(e) => e.key === "Enter" && setDetailSel({ kind: "agent", id: a.id })}
                    >
                      <i className={styles.rowDot} />
                      <span className={styles.rowName}>{a.name}</span>
                      <span className={styles.rowStatus}>{STATUS_LABEL[a.status]}</span>
                      <span className={styles.rowLine}>{a.line}</span>
                      <span className={styles.rowUnread}>
                        {a.unread > 0 ? <b>{a.unread} new</b> : "—"}
                      </span>
                      <button
                        className={styles.msgBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          messageAgent(a.id);
                        }}
                      >
                        Message
                      </button>
                    </div>
                  ))}
                </div>

                <div
                  className={styles.ctxDivider}
                  onPointerDown={onDividerDown}
                  role="separator"
                  aria-orientation="vertical"
                  title="Drag to resize"
                />

                <div className={styles.ctxCol}>
                  <div className={styles.ctxLabel}>Activity</div>
                  {hostOffline ? (
                    <>
                      <div className={styles.logRow}>
                        <span className={styles.logWhat}>unreachable — last seen {host.lastSeen}</span>
                      </div>
                      <div className={styles.logRow}>
                        <span className={styles.logWhat}>{host.parkedNote}</span>
                      </div>
                    </>
                  ) : (
                    host.log.map((l, i) => (
                      <div
                        key={i}
                        role="button"
                        tabIndex={0}
                        className={`${styles.logRow} ${styles.rowBtn} ${
                          detailSel?.kind === "activity" && detailSel.index === i
                            ? styles.rowSelected
                            : ""
                        }`}
                        onClick={() => setDetailSel({ kind: "activity", index: i })}
                        onKeyDown={(e) =>
                          e.key === "Enter" && setDetailSel({ kind: "activity", index: i })
                        }
                      >
                        <span className={styles.logT}>{l.t}</span>
                        <span className={styles.logWho}>{l.who}</span>
                        <span className={styles.logWhat}>{l.what}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Control deck — commands + the keyboard line (window mode only) */}
            <div className={styles.ctrlDeck}>
              <div className={styles.ctxCmds}>
                {COMMANDS.map((c) => (
                  <button key={c.name} className={styles.cmd} onClick={() => runCommand(c.name)}>
                    <span className={styles.cmdName}>{c.name}</span>
                    <span className={styles.cmdMeta}>{c.meta}</span>
                  </button>
                ))}
              </div>
              {mode === "window" && (
                <div className={styles.ctrlRow}>
                  <div className={`${styles.keyGroup} ${parked ? styles.ctrlDisabled : ""}`}>
                    {LEFT_KEYS.map(([label, name]) => (
                      <button key={label} className={styles.keyBtn} onClick={() => drive(`key ${name}`)}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <div
                    ref={joyRef}
                    className={`${styles.joyPad} ${parked ? styles.ctrlDisabled : styles.joyArmed}`}
                    onPointerDown={joyDown}
                    onPointerMove={joyMove}
                    onPointerUp={joyUp}
                    onPointerCancel={joyUp}
                    role="button"
                    aria-label="Joystick — hold a direction, center to select"
                  >
                    <i className={styles.joyKnob} data-dir={joyDir ?? ""} />
                  </div>
                  <div className={`${styles.keyGroup} ${parked ? styles.ctrlDisabled : ""}`}>
                    {RIGHT_KEYS.map(([label, name]) => (
                      <button key={label} className={styles.keyBtn} onClick={() => drive(`key ${name}`)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Composer, scoped to this host */}
            {composerAt === "host" && renderComposer("host")}
          </section>

          {/* The one place details live */}
          <aside className={styles.detailRail}>{renderRail()}</aside>
        </div>

        {/* Composer, docked at deck level — universal, verbal routing */}
        {composerAt === "deck" && renderComposer("deck")}

        {/* Status bar */}
        <div className={styles.statusbar}>
          <div className={styles.statusLeft}>
            OUTPUT · <b>{host.name.toUpperCase()}</b>
            {hostOffline && <span> — UNAVAILABLE</span>}
          </div>
          <div className={`${styles.statusRight} ${flash ? styles.statusFlash : ""}`}>
            {flash ?? `${fleetAgents.length} AGENTS · ${onlineHosts} HOSTS ONLINE · READY`}
          </div>
        </div>
      </div>

      {/* v1 → v2 changelog */}
      <div className={styles.changes}>
        <div className={styles.changesTitle}>v1 → v2 — what changed and why</div>
        <div className={styles.changeGrid}>
          <div className={styles.change}>
            <span className={styles.changeNum}>01</span>
            <span>
              <b>Selector reflects the fleet.</b> One segmented channel-assign bar, one segment per
              real host — a single host skips the bar entirely. No fixed slots.
            </span>
          </div>
          <div className={styles.change}>
            <span className={styles.changeNum}>02</span>
            <span>
              <b>A dedicated detail rail.</b> Approvals, agent peeks, window peeks, and “what the
              activity says and what to do about it” all land in one place on the right. Rows
              select; they don’t expand. That’s what scales.
            </span>
          </div>
          <div className={styles.change}>
            <span className={styles.changeNum}>03</span>
            <span>
              <b>Attention is a signal, not a surface.</b> Amber dot on the row, amber edge on the
              segment, a pill in the masthead — all of them point at the rail, where the ask
              actually lives.
            </span>
          </div>
          <div className={styles.change}>
            <span className={styles.changeNum}>04</span>
            <span>
              <b>The key tray only exists in window mode.</b> No dimmed parked controls — machine
              keys appear when you can use them. Joystick walks the window list, the rail follows.
            </span>
          </div>
          <div className={styles.change}>
            <span className={styles.changeNum}>05</span>
            <span>
              <b>Composer placement is a choice.</b> Docked at deck level it’s universal — route
              verbally (“on studio, approve grok”). Scoped into the host panel it’s that machine’s
              command line. MSG DECK/HOST to compare.
            </span>
          </div>
          <div className={styles.change}>
            <span className={styles.changeNum}>06</span>
            <span>
              <b>Flat by default.</b> Color means (amber = attention, green/red = health), nothing
              blooms, no bevels. Offline hosts keep last-known state and queue for reconnect.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
