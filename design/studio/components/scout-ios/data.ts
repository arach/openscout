// Scout iOS — study fixtures + surface data helpers.
//
// Faithful to the real app fixtures (HomeSurface.seedDemoActivity, the
// AgentsSurface tree, CommsSurface.demoConversations, Tail's TailEvent feed)
// and the recurring fleet vocabulary across the repo (openscout / hudson /
// lattices / talkie; claude / codex; relay agents; feat/* branches).

import type { GlyphKind } from "./Glyph";

export type AgentState = "live" | "idle" | "offline" | "unknown";

export interface Agent {
  id: string;
  title: string;
  project: string;
  harness: string;      // claude | codex
  branch?: string;
  dirty?: number;       // git dirty count
  action?: string;      // statusLabel (current action) — drives the working card
  state: AgentState;
  age?: string;         // relative last-active
}

// The fleet roster — mirrors the demo seeds plus the recurring repo vocabulary.
// Live agents come first in their groups (sortAgents), newest first.
export const FLEET: Agent[] = [
  { id: "a1", title: "broker-smith", project: "openscout", harness: "claude",
    branch: "feat/in-app-session", dirty: 3, action: "editing HomeSurface.swift",
    state: "live", age: "now" },
  { id: "a2", title: "session initiation", project: "openscout", harness: "codex",
    branch: "feat/repo-watch-web-converge", dirty: 6, action: "wiring ScoutSessionService.swift",
    state: "live", age: "now" },
  { id: "a3", title: "theme port", project: "openscout", harness: "claude",
    branch: "master", state: "idle", age: "41m" },
  { id: "a4", title: "tail-tuner", project: "hudson", harness: "codex",
    branch: "feat/tail-tokens", dirty: 0, action: "streaming tail tokens",
    state: "live", age: "now" },
  { id: "a5", title: "relay-hudson-claude", project: "hudson", harness: "claude",
    branch: "main", state: "idle", age: "2h" },
  { id: "a6", title: "lattices", project: "lattices", harness: "claude",
    branch: "feat/grid-solver", state: "idle", age: "13h 6m" },
  { id: "a7", title: "voice tray", project: "talkie", harness: "codex",
    branch: "feat/dictation", state: "idle", age: "3h" },
  { id: "a8", title: "iOS capture pass", project: "talkie", harness: "claude",
    branch: "feat/capture", state: "offline", age: "1d" },
  { id: "a9", title: "landing polish", project: "talkie", harness: "claude",
    state: "offline", age: "1d" },
];

// Paired base machines (Home machine rail). Multiple may be online; one focused.
export const MACHINES: { name: string; state: "connected" | "idle" }[] = [
  { name: "studio", state: "connected" },
  { name: "mini", state: "idle" },
];

// Subscription quotas — the plans you're actually burning across the fleet.
// The "Log" Home surfaces only the two useful glance-values at the top: the
// activity chart and how much of each subscription you've spent. Each plan
// bills two rolling windows — a short one (the 5h session) and a long one (the
// weekly cap) — so both are shown. `used` is 0..1 of that window; ≥0.8 reads
// amber ("watch the cap"), else accent.
export interface QuotaWindow { label: string; used: number; reset: string; }
export interface Quota { id: string; label: string; plan: string; windows: QuotaWindow[]; }
export const QUOTAS: Quota[] = [
  { id: "claude", label: "Claude", plan: "Max 20×", windows: [
    { label: "5h", used: 0.84, reset: "48m" },
    { label: "wk", used: 0.52, reset: "4d" },
  ] },
  { id: "codex", label: "Codex", plan: "ChatGPT Pro", windows: [
    { label: "5h", used: 0.34, reset: "2h" },
    { label: "wk", used: 0.61, reset: "Sun" },
  ] },
];

// Recent notifications — the home shelf of alerts that pinged you (push/relay).
// Distinct from the activity log (which is the whole swarm humming): only events
// with a claim on your attention, most-recent first. approval/error read amber
// ("act on it"); the rest stay mono. Sits just under the chart/quota strip.
export type NotifKind = "approval" | "question" | "reply" | "done" | "error";
export interface Notif { id: string; kind: NotifKind; agent: string; text: string; age: string; }
export const NOTIFS: Notif[] = [
  { id: "n1", kind: "approval", agent: "broker-smith", text: "rm -rf .build/checkouts", age: "1m" },
  { id: "n2", kind: "question", agent: "session initiation", text: "machine rail above or below the field?", age: "2m" },
  { id: "n3", kind: "error", agent: "voice tray", text: "dictation build failed — HudsonVoice gated", age: "12m" },
  { id: "n4", kind: "done", agent: "tail-tuner", text: "streamed 1.2k tail tokens", age: "18m" },
];

// Recent terminals — the home shelf of PTY sessions you can jump back into,
// docked at the bottom. Terminal-styled tiles: cwd · the command · last output.
// A running session reads live (accent age); exited ones recede to dim.
export interface TermSession { id: string; cmd: string; cwd: string; last: string; running: boolean; age: string; }
export const TERMINALS_RECENT: TermSession[] = [
  { id: "tm1", cmd: "scout dev-build", cwd: "openscout", last: "Build complete — 0 errors, 0 warnings", running: true, age: "now" },
  { id: "tm2", cmd: "git status -s", cwd: "hudson", last: " M apps/ios/Scout/HomeSurface.swift", running: false, age: "6m" },
  { id: "tm3", cmd: "bun test", cwd: "openscout", last: "798 pass · 0 fail", running: false, age: "22m" },
];

// Latest activity — Home's curated log (HomeSurface.seedDemoActivity).
export type ActKind = "assistant" | "tool" | "toolResult" | "user" | "system";
export interface ActEvent { id: string; kind: ActKind; summary: string; source: string; age: string; }
export const ACTIVITY: ActEvent[] = [
  // Increasingly the activity is agents talking to each other, not to us.
  { id: "ev0", kind: "assistant", summary: "broker-smith → tail-tuner · confirm the firehose still streams?", source: "claude", age: "now" },
  { id: "ev1", kind: "tool", summary: "Ran swift build — 0 errors, 0 warnings", source: "claude", age: "now" },
  { id: "ev6", kind: "assistant", summary: "session initiation → broker-smith · going with machine rail above the field", source: "codex", age: "1m" },
  { id: "ev2", kind: "assistant", summary: "Wired HudCodeHighlighter into the message renderer", source: "codex", age: "2m" },
  { id: "ev7", kind: "tool", summary: "Read ScoutTheme.swift", source: "claude", age: "3m" },
  { id: "ev3", kind: "toolResult", summary: "Edited ConversationSurface.swift (+14 −6)", source: "claude", age: "5m" },
  { id: "ev8", kind: "toolResult", summary: "Edited ScoutSessionService.swift (+22 −4)", source: "codex", age: "8m" },
  { id: "ev4", kind: "tool", summary: "git commit — projects-first Home + machine rail", source: "codex", age: "14m" },
  { id: "ev9", kind: "system", summary: "session.start · claude · openscout · feat/repo-watch-web-converge", source: "system", age: "18m" },
  { id: "ev5", kind: "user", summary: "ship the v0-2 ttf to hero/output", source: "claude", age: "25m" },
  { id: "ev10", kind: "assistant", summary: "tail-tuner: Parakeet warm-up no longer cancels on thread exit", source: "codex", age: "32m" },
];
export const ACT_COLOR: Record<ActKind, string> = {
  assistant: "var(--i-accent)",
  tool: "var(--i-warn)",
  toolResult: "var(--i-warn)",
  user: "var(--i-muted)",
  system: "var(--i-dim)",
};

// Comms — interleaved channels + DMs (CommsSurface.demoConversations), recency.
export type CommsKind = "channel" | "group" | "system" | "direct";
export type CommsStatus = "ask" | "working" | "awaiting" | "idle";
export interface Convo {
  id: string; kind: CommsKind; name: string;
  preview: string; status: CommsStatus; age: string; unread?: number;
}
export const COMMS: Convo[] = [
  { id: "c1", kind: "channel", name: "shared", status: "working",
    preview: "broker-smith: shipping the projects-first Home now — machine rail looks great",
    age: "2m", unread: 3 },
  { id: "c2", kind: "direct", name: "broker-smith", status: "ask",
    preview: "can you confirm the in-app session route lands on the operator DM?",
    age: "5m", unread: 1 },
  { id: "c3", kind: "direct", name: "tail-tuner", status: "working",
    preview: "Parakeet warm-up no longer cancels on thread exit", age: "12m" },
  { id: "c4", kind: "channel", name: "voice", status: "idle",
    preview: "tail-tuner: TTS + dictation pass landed in both mirrors", age: "25m" },
  { id: "c5", kind: "group", name: "openscout-ship", status: "idle",
    preview: "broker-smith: web launch flags — slice 1 is in", age: "57m" },
  { id: "c6", kind: "direct", name: "relay-hudson-claude", status: "awaiting",
    preview: "You: can you confirm the firehose still streams?", age: "1h" },
  { id: "c7", kind: "system", name: "system", status: "idle",
    preview: "bridge handshake completed · studio", age: "2h" },
];

// Tail — the live firehose (TailSurface rows). Attribution = scout/hudson/unattributed.
export type Attribution = "scout" | "hudson" | "unattributed";
export type TailKind = "tool" | "assistant" | "toolResult" | "user" | "system";
export interface TailRow { id: string; attr: Attribution; source: string; kind: TailKind; time: string; summary: string; }
export const TAIL: TailRow[] = [
  { id: "t1", attr: "scout", source: "claude", kind: "tool", time: "09:41:17",
    summary: "Ran swift build — 0 errors, 0 warnings" },
  { id: "t2", attr: "hudson", source: "codex", kind: "assistant", time: "09:41:12",
    summary: "Wired HudCodeHighlighter into the message renderer" },
  { id: "t3", attr: "scout", source: "claude", kind: "toolResult", time: "09:41:09",
    summary: "Edited ConversationSurface.swift (+14 −6)" },
  { id: "t4", attr: "scout", source: "claude", kind: "tool", time: "09:41:06",
    summary: "Read ScoutTheme.swift" },
  { id: "t5", attr: "hudson", source: "codex", kind: "tool", time: "09:41:04",
    summary: "git commit — projects-first Home + machine rail" },
  { id: "t6", attr: "unattributed", source: "system", kind: "system", time: "09:41:02",
    summary: "session.start · claude · openscout · feat/repo-watch-web-converge" },
  { id: "t7", attr: "scout", source: "claude", kind: "user", time: "09:40:55",
    summary: "ship the v0-2 ttf to hero/output" },
];
export const ATTR_COLOR: Record<Attribution, string> = {
  scout: "var(--i-accent)",
  hudson: "var(--i-muted)",
  unattributed: "var(--i-dim)",
};

// Inbox — the unified "needs you" queue. Not a list of conversations (that's
// the Agents/Conversations lens) and not the raw firehose (Tail) — only fleet
// events with a claim on your attention, ranked blocking-first. The first two
// items are the live approval + AskUserQuestion from the CONVERSATION fixture,
// surfaced to the shell so you act without digging into the transcript.
export type InboxKind = "approval" | "question" | "reply" | "done" | "errored";
export interface InboxItem {
  id: string;
  kind: InboxKind;
  agent: string;        // conversation / agent name
  project: string;
  summary: string;      // the demand, in one line
  age: string;
  command?: string;     // approval — the call awaiting consent
  risk?: "low" | "med" | "high";
  options?: string[];   // question — the choices
}
// Blocking kinds literally pause an agent until you answer; FYI kinds want a
// glance. Authored blocking-first.
export const INBOX: InboxItem[] = [
  { id: "i1", kind: "approval", agent: "broker-smith", project: "openscout", age: "1m",
    summary: "Delete resolved SwiftPM checkouts — forces a clean re-resolve.",
    command: "rm -rf .build/checkouts", risk: "med" },
  { id: "i2", kind: "question", agent: "session initiation", project: "openscout", age: "2m",
    summary: "Land the machine rail above or below the search field?",
    options: ["Above", "Below"] },
  { id: "i3", kind: "approval", agent: "tail-tuner", project: "hudson", age: "4m",
    summary: "Force-push the rebased branch over the remote.",
    command: "git push --force origin feat/tail-tokens", risk: "high" },
  { id: "i4", kind: "reply", agent: "broker-smith", project: "openscout", age: "5m",
    summary: "can you confirm the in-app session route lands on the operator DM?" },
  { id: "i5", kind: "errored", agent: "voice tray", project: "talkie", age: "12m",
    summary: "Dictation build failed — HudsonVoice gated by flag." },
];
export const INBOX_TONE: Record<InboxKind, string> = {
  approval: "var(--i-warn)",
  question: "var(--i-info)",
  reply: "var(--i-accent)",
  done: "var(--i-ok)",
  errored: "var(--i-error)",
};
/** Blocking = an agent is paused waiting on you (approval / question). */
export function inboxBlocking(it: InboxItem) { return it.kind === "approval" || it.kind === "question"; }

export interface TokenRow { name: string; cssVar: string; shipped: string; hc: string; ratio?: [string, string]; }
export interface TokenGroup { label: string; rows: TokenRow[]; }
export const BOARD: TokenGroup[] = [
  {
    label: "Surfaces",
    rows: [
      { name: "bg", cssVar: "--i-bg", shipped: "#0a0a0a", hc: "#0a0a0a" },
      { name: "surface", cssVar: "--i-surface", shipped: "#171717", hc: "#1e1e1e" },
      { name: "chrome", cssVar: "--i-chrome", shipped: "#060606", hc: "#060606" },
    ],
  },
  {
    label: "Text (ratio on bg)",
    rows: [
      { name: "ink", cssVar: "--i-ink", shipped: "#e5e5e5", hc: "#f0f0f0", ratio: ["15.7:1", "17.4:1"] },
      { name: "muted", cssVar: "--i-muted", shipped: "#a3a3a3", hc: "#b0b0b0", ratio: ["7.9:1", "9.2:1"] },
      { name: "dim", cssVar: "--i-dim", shipped: "#737373", hc: "#808080", ratio: ["4.2:1", "5.0:1"] },
    ],
  },
  {
    label: "Structure",
    rows: [
      { name: "border", cssVar: "--i-border", shipped: "#272727", hc: "#303030" },
      { name: "hairline", cssVar: "--i-hairline", shipped: "#181818", hc: "#1c1c1c" },
      { name: "hairlineStrong", cssVar: "--i-hairline-strong", shipped: "#262626", hc: "#2e2e2e" },
    ],
  },
  {
    label: "Accent · Status",
    rows: [
      { name: "accent (emerald)", cssVar: "--i-accent", shipped: "#10b981", hc: "#10b981" },
      { name: "ok", cssVar: "--i-ok", shipped: "#22c55e", hc: "#22c55e" },
      { name: "warn", cssVar: "--i-warn", shipped: "#f59e0b", hc: "#f59e0b" },
      { name: "error", cssVar: "--i-error", shipped: "#dc2626", hc: "#dc2626" },
      { name: "info", cssVar: "--i-info", shipped: "#3b82f6", hc: "#3b82f6" },
    ],
  },
  {
    label: "Scout card depth",
    rows: [
      { name: "cardTop", cssVar: "--i-card-top", shipped: "#1b1b1e", hc: "#202024" },
      { name: "cardEdgeTop", cssVar: "--i-card-edge-top", shipped: "#383a3f", hc: "#46484f" },
      { name: "cardBottom", cssVar: "--i-card-bottom", shipped: "#131315", hc: "#161618" },
    ],
  },
];

// ── Surface data helpers ──────────────────────────────────────────────────

export interface Group { name: string; agents: Agent[]; age: string; }
export function groupByProject(list: Agent[]): Group[] {
  const map = new Map<string, Agent[]>();
  for (const a of list) {
    const arr = map.get(a.project) ?? [];
    arr.push(a);
    map.set(a.project, arr);
  }
  const groups: Group[] = [];
  for (const [name, agents] of map) {
    const sorted = [...agents].sort((x, y) =>
      stateRank(x.state) - stateRank(y.state) || ageRank(x.age) - ageRank(y.age));
    groups.push({ name, agents: sorted, age: sorted[0]?.age ?? "" });
  }
  // live projects first, then by recency of their freshest agent
  return groups.sort((a, b) => {
    const la = a.agents.some((x) => x.state === "live") ? 0 : 1;
    const lb = b.agents.some((x) => x.state === "live") ? 0 : 1;
    return la - lb || ageRank(a.age) - ageRank(b.age);
  });
}
export function stateRank(s: AgentState) { return s === "live" ? 0 : s === "idle" ? 1 : s === "unknown" ? 2 : 3; }
export function ageRank(age?: string) {
  if (!age) return 9999;
  if (age === "now") return 0;
  const m = age.match(/(\d+)\s*m/); if (m && !age.includes("h")) return parseInt(m[1]);
  const h = age.match(/(\d+)\s*h/); if (h) return parseInt(h[1]) * 60;
  const d = age.match(/(\d+)\s*d/); if (d) return parseInt(d[1]) * 1440;
  return 9999;
}
/** Working-card meta: project · +dirty · ⎇branch (the live strip omits the age). */
export function workingMeta(a: Agent) {
  const parts: string[] = [a.project];
  if (a.dirty && a.dirty > 0) parts.push(`+${a.dirty}`);
  if (a.branch) parts.push(`⎇ ${a.branch}`);
  return parts.join(" · ");
}
/** A solo project's compressed agent label — drop the agent title when it just
 * restates the project (homeAgentDisplayTitle), falling back to the harness/branch. */
export function soloLabel(a: Agent) {
  if (sameIdentity(a.title, a.project)) return a.harness ?? a.branch ?? "agent";
  return a.title;
}
export function leafTitle(a: Agent, project: string) {
  if (sameIdentity(a.title, project)) return a.harness ?? a.branch ?? "agent";
  return a.title;
}
export function sameIdentity(x: string, y: string) {
  const k = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return k(x) === k(y);
}

// ── Conversation transcript (ConversationSurface) ──────────────────────────
//
// Turns of typed blocks: text (markdown), reasoning, action (tool call + status
// + optional approval gate), question (pending ask). Mirrors BlockView's cases.

export type ConvRole = "user" | "agent";
export type ConvBlock =
  | { t: "text"; md: string }
  | { t: "reasoning"; text: string }
  | { t: "action"; icon: GlyphKind; title: string; status: "running" | "ok" | "error"; output?: string;
      approval?: { desc: string; risk: "low" | "med" | "high" } }
  | { t: "question"; q: string; options: string[]; answered?: string };
export interface ConvTurn { id: string; role: ConvRole; streaming?: boolean; blocks: ConvBlock[]; }

export const CONVERSATION: ConvTurn[] = [
  { id: "u1", role: "user", blocks: [
    { t: "text", md: "ship the projects-first Home + machine rail" },
  ] },
  { id: "a1", role: "agent", blocks: [
    { t: "reasoning", text: "Home should lead with projects, not a flat agent list — group by repo, compress one-child projects, and surface live agents in a strip above." },
    { t: "action", icon: "search", title: "Read HomeSurface.swift", status: "ok", output: "218 lines · projects tree + activity log" },
    { t: "text", md: "Here's the plan:\n- machine rail at the very top\n- a **currently working** strip\n- projects tree with one-child compression" },
    { t: "action", icon: "check", title: "Edited HomeSurface.swift", status: "ok", output: "+64 −18" },
    { t: "action", icon: "terminal", title: "Ran swift build", status: "ok", output: "Build complete — 0 errors, 0 warnings" },
  ] },
  { id: "a2", role: "agent", streaming: true, blocks: [
    { t: "action", icon: "terminal", title: "Run  rm -rf .build/checkouts", status: "running",
      approval: { desc: "Delete resolved SwiftPM checkouts — forces a clean re-resolve.", risk: "med" } },
    { t: "question", q: "Land the machine rail above or below the search field?", options: ["Above", "Below"] },
  ] },
];

// ── Terminal PTY (TerminalSurface) ─────────────────────────────────────────
export interface TermLine { kind: "prompt" | "out" | "dim"; text: string; }
export const TERMINAL_LINES: TermLine[] = [
  { kind: "prompt", text: "bun bin/scout-app.ts dev-build" },
  { kind: "dim", text: "Building Scout dev bundle…" },
  { kind: "out", text: "[12/14] Linking Scout" },
  { kind: "out", text: "Build of product 'Scout' complete! (9.23s)" },
  { kind: "dim", text: "Built dist/Scout.app (dev)" },
  { kind: "prompt", text: "git status -s" },
  { kind: "out", text: " M apps/ios/Scout/HomeSurface.swift" },
];
export const TERMINAL_KEYS = ["esc", "tab", "ctrl", "/", "|", "~", "←", "→"];

// ── Connect / route inspector (ConnectionView) ─────────────────────────────
export type Route = "LAN" | "TSN" | "OSN";
export const ROUTES: Route[] = ["LAN", "TSN", "OSN"];
export type ConnLevel = "ok" | "info" | "warn" | "error";
export interface ConnLogRow { route: Route | "SYS"; event: string; msg: string; level: ConnLevel; }
export const CONNECT_LOG: ConnLogRow[] = [
  { route: "LAN", event: "connected", msg: "studio · 192.168.1.24:7777", level: "ok" },
  { route: "TSN", event: "standby", msg: "tailnet route warm", level: "info" },
  { route: "SYS", event: "handshake", msg: "noise XX complete", level: "ok" },
  { route: "OSN", event: "disabled", msg: "openscout net — not signed in", level: "warn" },
  { route: "SYS", event: "pair", msg: "device key registered with studio", level: "info" },
];
export const CONN_LEVEL_COLOR: Record<ConnLevel, string> = {
  ok: "var(--i-accent)", info: "var(--i-muted)", warn: "var(--i-warn)", error: "var(--i-error)",
};
