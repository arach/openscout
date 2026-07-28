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

// ── Destination fixtures (New session) ─────────────────────────────────────
//
// The two things the New surface has to let you choose: which paired Mac the
// session lands on, and which project it runs in. Shapes are the REAL contract
// shapes, field for field — no invented columns:
//   · Workspace  ← WorkspaceSummary (packages/scout-native-core/Sources/
//     ScoutCapabilities/Listing.swift): id · title · projectName · root ·
//     defaultHarness? · harnesses[{ harness, readiness, detail? }].
//   · PairedMac  ← AppModel.PairedMachine: id · name · isOnline · isActive.
// Anything a row shows beyond those fields is DERIVED here (see
// workspaceActivity, which joins FLEET — the same listAgents inventory the
// Agents surface already reads — onto a workspace by projectName).

export type HarnessReadiness = "ready" | "configured" | "installed" | "missing" | "unknown";
export interface WorkspaceHarness { harness: string; readiness: HarnessReadiness; detail?: string }
export interface Workspace {
  id: string;
  title: string;
  projectName: string;
  root: string;              // absolute path on the Mac
  defaultHarness?: string;
  harnesses: WorkspaceHarness[];
}
export interface PairedMac { id: string; name: string; isOnline: boolean; isActive: boolean }

/** Harnesses that actually ship (ComposerModelHarness.catalog): claude · codex. */
const BOTH: WorkspaceHarness[] = [
  { harness: "claude", readiness: "ready" },
  { harness: "codex", readiness: "ready" },
];
const CLAUDE_ONLY: WorkspaceHarness[] = [
  { harness: "claude", readiness: "ready" },
  { harness: "codex", readiness: "missing", detail: "codex not on PATH" },
];
const CODEX_ONLY: WorkspaceHarness[] = [
  { harness: "codex", readiness: "ready" },
  { harness: "claude", readiness: "installed" },
];

/** [name, parent, defaultHarness, harness set] — the CLEAN long tail. The head
 *  of the real list (umbrella dirs, worktree clones, scratch checkouts) is
 *  spelled out by root in REAL_TABLE below, because those paths are the point. */
const WORKSPACE_TABLE: [string, string, string | undefined, WorkspaceHarness[]][] = [
  ["openscout", "/Users/art/dev", "claude", BOTH],
  ["hudson", "/Users/art/dev", "codex", BOTH],
  ["lattices", "/Users/art/dev", "claude", CLAUDE_ONLY],
  ["talkie", "/Users/art/dev", "claude", BOTH],
  ["studio", "/Users/art/dev", "claude", BOTH],
  ["oscout-net", "/Users/art/dev", "codex", CODEX_ONLY],
  ["herdr", "/Users/art/dev", "claude", CLAUDE_ONLY],
  ["parakeet-ios", "/Users/art/dev", "claude", CLAUDE_ONLY],
  ["glyphd", "/Users/art/dev", undefined, CLAUDE_ONLY],
  ["tinker", "/Users/art/dev", "codex", BOTH],
  ["ledgerly", "/Users/art/dev", "claude", BOTH],
  ["pinboard", "/Users/art/dev", undefined, CLAUDE_ONLY],
  ["waypoint", "/Users/art/dev", "codex", CODEX_ONLY],
  ["quilt", "/Users/art/dev", "claude", CLAUDE_ONLY],
  ["corvid", "/Users/art/dev", "claude", BOTH],
  ["mosaic", "/Users/art/dev", undefined, CLAUDE_ONLY],
  ["driftwood", "/Users/art/dev", "codex", CODEX_ONLY],
  ["kettle", "/Users/art/dev", "claude", CLAUDE_ONLY],
  ["harbor", "/Users/art/dev", "claude", BOTH],
  ["sable", "/Users/art/dev", undefined, CLAUDE_ONLY],
  ["plume", "/Users/art/dev", "claude", CLAUDE_ONLY],
  ["tessera", "/Users/art/dev", "codex", CODEX_ONLY],
  ["junco", "/Users/art/dev", "claude", CLAUDE_ONLY],
  ["marlin", "/Users/art/dev", "claude", BOTH],
  ["dotfiles", "/Users/art/dev", undefined, CLAUDE_ONLY],
  ["scout-web", "/Users/art/dev", "claude", BOTH],
  ["oh-my-pi", "/Users/art/dev/ext", undefined, CLAUDE_ONLY],
  ["ghostty", "/Users/art/dev/ext", undefined, CLAUDE_ONLY],
  ["zed", "/Users/art/dev/ext", undefined, CLAUDE_ONLY],
  ["swift-syntax", "/Users/art/dev/ext", undefined, CLAUDE_ONLY],
  ["tree-sitter", "/Users/art/dev/ext", undefined, CLAUDE_ONLY],
  ["acme-api", "/Users/art/work", "codex", CODEX_ONLY],
  ["acme-web", "/Users/art/work", "codex", CODEX_ONLY],
  ["acme-infra", "/Users/art/work", "codex", CODEX_ONLY],
  ["billing-svc", "/Users/art/work", "claude", BOTH],
  ["pagerbot", "/Users/art/work", "claude", CLAUDE_ONLY],
  ["kernel-notes", "/Users/art/src", undefined, CLAUDE_ONLY],
  ["wasm-lab", "/Users/art/src", "codex", CODEX_ONLY],
  ["rustlings", "/Users/art/src", undefined, CLAUDE_ONLY],
  ["scratch", "/Users/art/src", undefined, CLAUDE_ONLY],
];

function makeWorkspace(name: string, parent: string, dflt: string | undefined, hs: WorkspaceHarness[]): Workspace {
  return {
    id: `ws_${name.replace(/[^a-z0-9]/gi, "_")}_${parent.length}`,
    title: name,
    projectName: name,
    root: `${parent}/${name}`,
    defaultHarness: dflt,
    harnesses: hs,
  };
}

function makeRoot(name: string, root: string, dflt: string | undefined, hs: WorkspaceHarness[]): Workspace {
  return {
    id: `ws_${root.replace(/[^a-z0-9]/gi, "_")}`,
    title: name,
    projectName: name,
    root,
    defaultHarness: dflt,
    harnesses: hs,
  };
}

/**
 * THE HEAD OF THE REAL LIST, transcribed off the phone (2026-07-28, `PROJECT
 * 57`). This is what `mobile/workspaces` actually returns once a Mac is paired,
 * and it is nothing like a tidy inventory:
 *
 *   · UMBRELLA DIRS — `Art` (/Users/art) and `Dev` (~/dev) are indexed as
 *     projects even though they are merely the folders the projects live in.
 *   · WORKTREE CLONES — three `openscout` rows under `~/.codex/worktrees/<hash>`,
 *     one of which the surface had SELECTED by default. Starting a conversation
 *     there is almost never what you meant.
 *   · SCRATCH CHECKOUTS — `/tmp` and `/private/tmp` copies, title-cased into
 *     names like `Openscout Work List Wt`.
 *   · SAME-NAME DUPLICATES — four things called some case of "openscout".
 *
 * The names are verbatim, including the inconsistent casing: the index
 * prettifies some directory names and not others, which is itself part of why
 * the raw list is hard to read.
 */
const REAL_HEAD: Workspace[] = [
  makeRoot("Art", "/Users/art", undefined, CLAUDE_ONLY),
  makeRoot("Dev", "/Users/art/dev", undefined, CLAUDE_ONLY),
  makeRoot("Openscout", "/Users/art/.codex/worktrees/a5d0f1c2/openscout", "claude", BOTH),
  makeRoot("Openscout Work List Wt", "/private/tmp/openscout-work-list-wt", "claude", CLAUDE_ONLY),
  makeRoot("openscout", "/Users/art/.codex/worktrees/c50e77a1/openscout", "codex", BOTH),
  makeRoot("openscout", "/Users/art/.codex/worktrees/b4229d30/openscout", "codex", BOTH),
  makeRoot("talkie", "/tmp/talkie", "claude", CLAUDE_ONLY),
  makeRoot("All", "/Users/art/dev/all", undefined, CLAUDE_ONLY),
  makeRoot("Action", "/Users/art/dev/action", undefined, CLAUDE_ONLY),
  makeRoot("Arach Io", "/Users/art/dev/arach.io", "claude", CLAUDE_ONLY),
  makeRoot("openscout", "/Users/art/.codex/worktrees/7f31b8c4/openscout", "codex", BOTH),
  makeRoot("hudson", "/Users/art/.codex/worktrees/9ab4e025/hudson", "codex", BOTH),
  makeRoot("Scout Ios Nav", "/private/tmp/scout-ios-nav", "claude", CLAUDE_ONLY),
  makeRoot("talkie", "/Users/art/.claude/worktrees/2d19aa7f/talkie", "claude", CLAUDE_ONLY),
  makeRoot("Studio Craft Pass", "/private/tmp/studio-craft-pass", "claude", CLAUDE_ONLY),
  makeRoot("openscout", "/var/folders/gq/T/openscout-check", "claude", CLAUDE_ONLY),
  makeRoot("Src", "/Users/art/src", undefined, CLAUDE_ONLY),
];

/** The common case: ONE Mac, 57 rows — the real head above, then the durable
 *  checkouts. Deliberately in the order the Mac returns them, which is to say
 *  the junk is at the top. */
export const WORKSPACES: Workspace[] = [
  ...REAL_HEAD,
  ...WORKSPACE_TABLE.map((r) => makeWorkspace(...r)),
];

/** The stress case: a platform monorepo's package roots swamp the personal
 *  checkouts. This is how a real inventory gets to 200 — not 200 side projects. */
export const WORKSPACES_STRESS: Workspace[] = [
  ...WORKSPACES,
  ...Array.from({ length: 118 }, (_, i) =>
    makeWorkspace(`svc-${String(i + 1).padStart(3, "0")}`, "/Users/art/work/platform", "codex", CODEX_ONLY)),
  ...Array.from({ length: 46 }, (_, i) =>
    makeWorkspace(`pkg-${String(i + 1).padStart(2, "0")}`, "/Users/art/work/platform/packages", "codex", CODEX_ONLY)),
];

/** Freshly paired — the Mac has answered, and it has nothing to report yet. */
export const WORKSPACES_EMPTY: Workspace[] = [];

/** The common fleet: one Mac, and it IS the answer — a readout, not a choice. */
export const MACS_SOLO: PairedMac[] = [
  { id: "m_studio", name: "studio", isOnline: true, isActive: true },
];
/** The multi-Mac fleet. Every PAIRED Mac shows, including the sleeping one —
 *  hiding it turns "your Mac is asleep" into "you have no Macs". */
export const MACS_FLEET: PairedMac[] = [
  { id: "m_studio", name: "studio", isOnline: true, isActive: true },
  { id: "m_mini", name: "mac mini", isOnline: true, isActive: false },
  { id: "m_loft", name: "loft mbp", isOnline: false, isActive: false },
];

/** `~` for the Mac's home, so a path reads at 10px instead of spending a third
 *  of the row on `/Users/<someone>` (mirrors NewSessionSurface.abbreviate). */
export function abbreviatePath(path: string) {
  if (!path.startsWith("/Users/")) return path;
  const rest = path.slice("/Users/".length);
  const slash = rest.indexOf("/");
  return slash < 0 ? "~" : `~${rest.slice(slash)}`;
}
export function parentPath(path: string) {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}

/**
 * DERIVED, not a contract field: what the fleet is doing in this workspace.
 * Joins the agent inventory (FLEET ← listAgents, which the Agents surface
 * already reads) onto a workspace by projectName. Nothing here comes from
 * WorkspaceSummary — the New surface would have to fetch agents too, which it
 * does not do today.
 */
export function workspaceActivity(ws: Workspace, agents: Agent[] = FLEET) {
  const mine = agents.filter((a) => a.project === ws.projectName);
  if (mine.length === 0) return null;
  const freshest = [...mine].sort((a, b) => ageRank(a.age) - ageRank(b.age))[0];
  return { count: mine.length, age: freshest.age ?? "", live: mine.some((a) => a.state === "live") };
}

/** Group a workspace list under its parent directories, freshest parent first. */
export function groupWorkspaces(list: Workspace[]) {
  const map = new Map<string, Workspace[]>();
  for (const ws of list) {
    const key = abbreviatePath(parentPath(ws.root));
    const arr = map.get(key) ?? [];
    arr.push(ws);
    map.set(key, arr);
  }
  return [...map].map(([parent, items]) => ({ parent, items }));
}

// ── Curation ────────────────────────────────────────────────────────────────
//
// The Mac's inventory is not a list of projects; it is a list of directories
// that happen to contain code. Three of the four kinds below are things you
// almost never mean to start a conversation in, and interleaving them as peers
// is what made the shipped list unreadable (see REAL_HEAD). This is CURATION of
// real data — pure path arithmetic on `root`, no invented fields, no fetch —
// and it ports to Swift as the same four predicates.

export type WorkspaceKind = "project" | "umbrella" | "worktree" | "scratch";

const SCRATCH_PREFIXES = ["/tmp/", "/private/tmp/", "/var/folders/", "/private/var/folders/"];
const WORKTREE_MARKERS = ["/.codex/worktrees/", "/.claude/worktrees/", "/worktrees/", "/.git/worktrees/"];

/** Which of the four a root is. `all` is needed only for the umbrella test —
 *  a directory is an umbrella when the index ALSO knows what is inside it. */
export function workspaceKind(ws: Workspace, all: Workspace[]): WorkspaceKind {
  const root = ws.root;
  if (SCRATCH_PREFIXES.some((p) => root.startsWith(p))) return "scratch";
  if (WORKTREE_MARKERS.some((m) => root.includes(m))) return "worktree";
  // The home directory itself is never a project.
  if (/^\/Users\/[^/]+$/.test(root)) return "umbrella";
  // A directory that merely CONTAINS other indexed roots. Two, not one, so a
  // real project with one vendored checkout inside it stays a project.
  const contained = all.filter((o) => o.root !== root && o.root.startsWith(`${root}/`)).length;
  return contained >= 2 ? "umbrella" : "project";
}

/**
 * Split the inventory into what you meant and what the indexer swept up. The
 * durable half keeps the Mac's own order; the demoted half is kept, labelled
 * and reachable — never hidden, because "my worktree isn't in the list" is a
 * worse bug than a long list.
 */
export function curateWorkspaces(list: Workspace[]) {
  const durable: Workspace[] = [];
  const demoted: Workspace[] = [];
  for (const ws of list) {
    (workspaceKind(ws, list) === "project" ? durable : demoted).push(ws);
  }
  return { durable, demoted };
}

/**
 * The one ranking signal that is actually BACKED today: the roots this DEVICE
 * last started a conversation in. It is written when a session starts and read
 * back on the next visit — no join against the agent inventory (`AgentSummary`
 * carries no project path, so ranking by "where your agents are" is not
 * available), no server call. Empty on a fresh install, which is why the
 * fallback below is the Mac's own order.
 */
export const RECENT_ROOTS = [
  "/Users/art/dev/openscout",
  "/Users/art/dev/talkie",
  "/Users/art/dev/hudson",
];

/** The short list the calm surface shows: device-recent first (in recency
 *  order), then the Mac's own order, capped. Never shows a demoted root. */
export function promoteWorkspaces(durable: Workspace[], recent: string[], limit = 3) {
  const byRoot = new Map(durable.map((ws) => [ws.root, ws] as const));
  const head = recent.map((r) => byRoot.get(r)).filter((ws): ws is Workspace => !!ws);
  const seen = new Set(head.map((ws) => ws.root));
  return [...head, ...durable.filter((ws) => !seen.has(ws.root))].slice(0, limit);
}

/** One line for the demoted pile — honest about what is in it. */
export function demotedSummary(demoted: Workspace[], all: Workspace[]) {
  const counts = { umbrella: 0, worktree: 0, scratch: 0 };
  for (const ws of demoted) {
    const kind = workspaceKind(ws, all);
    if (kind !== "project") counts[kind] += 1;
  }
  const parts: string[] = [];
  if (counts.worktree) parts.push(`${counts.worktree} worktree${counts.worktree === 1 ? "" : "s"}`);
  if (counts.scratch) parts.push(`${counts.scratch} scratch`);
  if (counts.umbrella) parts.push(`${counts.umbrella} folder${counts.umbrella === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/** The filter the surface runs: name, title or path, case-insensitive. */
export function filterWorkspaces(list: Workspace[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((ws) =>
    ws.projectName.toLowerCase().includes(q)
    || ws.title.toLowerCase().includes(q)
    || ws.root.toLowerCase().includes(q));
}

/** A query the operator clearly means as a path that no workspace answers —
 *  offered verbatim, because the Mac may hold a checkout the index hasn't seen. */
export function typedPath(list: Workspace[], query: string) {
  const raw = query.trim();
  if (!raw.startsWith("/") && !raw.startsWith("~")) return null;
  if (list.some((ws) => ws.root === raw || abbreviatePath(ws.root) === raw)) return null;
  return raw;
}

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

// ── Notifications — the detail-grade attention record ──────────────────────
//
// The shape the notification-detail page resolves after an OPAQUE push lands.
// Mirrors `MobileNotificationItem` (packages/scout-native-core/Sources/
// ScoutCapabilities/MobilePush.swift) plus the two fields this study proposes:
// `readAt` / `dismissedAt`. Everything human-readable lives HERE, never in the
// APNs payload — the push carries correlation ids only, and the phone resolves
// them against the paired Mac.

export type NotifDetailKind =
  | "approval" | "question" | "failed_action" | "failed_turn"
  | "session_error" | "native_attention" | "delivery_issue";

export interface NotifDetail {
  /** `itemId` in the push payload — the only handle the phone is given. */
  id: string;
  kind: NotifDetailKind;
  agent: string;
  project: string;
  /** Harness + model, as the conversation header reads it. */
  harness: string;
  sessionName: string;
  /** Correlation ids carried opaquely by the push. */
  sessionId: string;
  turnId?: string;
  blockId?: string;
  conversationId?: string;
  version?: number;
  age: string;
  title: string;
  summary: string;
  /** The evidence block — the command, the failure, the diff. Mono well. */
  detail?: string;
  risk?: "low" | "med" | "high";
  /** Question kinds — the offered directions. */
  options?: string[];
  /** Triage state (proposed contract addition). */
  readAt?: string | null;
  dismissedAt?: string | null;
}

/** Blocking = an agent is literally paused until you act. Drives ranking, the
 *  badge count, and the honesty copy under Dismiss. */
export function notifBlocking(n: NotifDetail) {
  return n.kind === "approval" || n.kind === "question";
}

/** The kind tag as the operator reads it — names the MOVE, not the internal
 *  enum (mirrors `needKindLabel` in HomeSurface.swift). */
export const NOTIF_KIND_LABEL: Record<NotifDetailKind, string> = {
  approval: "Approval",
  question: "Question",
  failed_action: "Action failed",
  failed_turn: "Turn failed",
  session_error: "Session error",
  native_attention: "Needs you",
  delivery_issue: "Delivery issue",
};

export const NOTIFICATIONS: NotifDetail[] = [
  {
    id: "att_9f31", kind: "approval", agent: "broker-smith", project: "openscout",
    harness: "claude · opus-5", sessionName: "feat/in-app-session",
    sessionId: "s_7742", turnId: "t_31", blockId: "b_04", conversationId: "c_7742", version: 3,
    age: "1m",
    title: "Delete resolved SwiftPM checkouts",
    summary: "Forces a clean re-resolve on the next build. Nothing else in the tree is touched.",
    detail: "rm -rf .build/checkouts",
    risk: "med", readAt: null, dismissedAt: null,
  },
  {
    id: "att_7c02", kind: "question", agent: "session initiation", project: "openscout",
    harness: "codex · gpt-5.4", sessionName: "feat/repo-watch-web-converge",
    sessionId: "s_7751", turnId: "t_12", blockId: "b_01", conversationId: "c_7751",
    age: "2m",
    title: "Machine rail above or below the search field?",
    summary: "Both fit. Above reads as context; below reads as a filter on the results.",
    options: ["Above", "Below"], readAt: null, dismissedAt: null,
  },
  {
    id: "att_4d88", kind: "approval", agent: "tail-tuner", project: "hudson",
    harness: "codex · gpt-5.4", sessionName: "feat/tail-tokens",
    sessionId: "s_7708", turnId: "t_58", blockId: "b_11", conversationId: "c_7708", version: 1,
    age: "4m",
    title: "Force-push the rebased branch",
    summary: "Overwrites the remote history on feat/tail-tokens. Anyone else tracking it will need to reset.",
    detail: "git push --force origin feat/tail-tokens",
    risk: "high", readAt: null, dismissedAt: null,
  },
  {
    id: "att_1a05", kind: "failed_action", agent: "voice tray", project: "talkie",
    harness: "codex · gpt-5.4", sessionName: "feat/dictation",
    sessionId: "s_7690", turnId: "t_09", blockId: "b_02", conversationId: "c_7690",
    age: "12m",
    title: "Dictation build failed",
    summary: "HudsonVoice is gated behind HUDSONKIT_WITH_VOICE=1; the target didn't link.",
    detail: "error: no such module 'HudsonVoice'\n  import HudsonVoice\n         ^",
    readAt: "9m", dismissedAt: null,
  },
  {
    id: "att_0b77", kind: "native_attention", agent: "lattices", project: "lattices",
    harness: "claude · opus-5", sessionName: "feat/grid-solver",
    sessionId: "s_7612", conversationId: "c_7612",
    age: "36m",
    title: "Idle mid-task for 30 minutes",
    summary: "The solver finished a pass and stopped without a closing turn.",
    readAt: "31m", dismissedAt: null,
  },
];

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
