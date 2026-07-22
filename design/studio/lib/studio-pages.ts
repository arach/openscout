/**
 * Studio page registry — single source of truth for the persistent
 * nav. Sidebar + per-page header strip both read from this list.
 * Adding a page means appending an entry; nav surfaces it
 * automatically.
 *
 * Buckets:
 *  - plans       — long-form planning + decision docs, sourced from
 *                  `plans/*.md` at the repo root. The sidebar appends
 *                  live plan entries to this bucket at request time.
 *  - eng         — SCO proposals + supporting notes, read live from
 *                  `docs/eng/`.
 *  - foundations — design primitives: tokens, type, spacing/density.
 *  - studies     — inline React surfaces for openscout UI exploration.
 *  - atoms       — live-rendered component gallery for shared primitives.
 *  - meta        — about / conventions.
 */

export type StudioBucket =
  | "plans"
  | "eng"
  | "foundations"
  | "studies"
  | "atoms"
  | "meta";
export type StudioSurface = "web" | "ios" | "macos" | "shell" | "cross";
export type StudioStatus =
  | "draft"
  | "in-flight"
  | "shipped"
  | "shelved"
  | "concept";

export interface StudioPage {
  /** Stable page/study id for cross-runtime references. */
  id?: string;
  /** Route. `/path` form, no trailing slash. */
  href: string;
  /** Sidebar label. */
  label: string;
  /** Drives sidebar group. */
  bucket: StudioBucket;
  /**
   * Family — same logical surface, different variants. Variants get
   * collapsed under one entry in the sidebar.
   */
  family?: string;
  /** Surface — sub-grouping inside `studies`. */
  surface?: StudioSurface;
  /** Status pill rendered in the page strip + status dot in sidebar. */
  status?: StudioStatus;
  /** Linked source file(s), relative to repo root. */
  source?: string[];
  /** Subtitle shown in the page strip. */
  blurb?: string;
  /** Optional host-app insertion target for studies that can be injected. */
  target?: StudioStudyTarget;
  /** ISO mtime — used to sort entries by recency (e.g. the eng bucket's
   *  "Recent 5" sidebar slice). Optional; static registry pages omit it. */
  updatedAt?: string;
}

export type StudioInsertionScope =
  | "shell"
  | "navigation"
  | "app"
  | "page"
  | "section"
  | "component"
  | "object";

export type StudioInsertionMode =
  | "replace"
  | "before"
  | "after"
  | "overlay"
  | "decorate";

export interface StudioInsertionPoint {
  id: string;
  label: string;
  scope: StudioInsertionScope;
  surface?: StudioSurface;
  route?: string;
  allowedModes: StudioInsertionMode[];
  source?: string[];
  blurb?: string;
}

export interface StudioStudyTarget {
  anchor: string;
  mode: StudioInsertionMode;
  route?: string;
  surface?: StudioSurface;
  aliases?: string[];
}

export const STUDIO_INSERTION_POINTS: StudioInsertionPoint[] = [
  {
    id: "agents.directory",
    label: "Agent Directory",
    scope: "page",
    surface: "web",
    route: "/agents",
    allowedModes: ["replace", "decorate"],
    source: [
      "packages/web/client/screens/AgentsScreen.tsx",
      "design/studio/app/studies/agent-view-before-after/page.tsx",
    ],
    blurb: "The live Agents route empty/detail-less state; first Studio-mode replacement anchor.",
  },
];

/** Static pages. Plans are merged in at render time from the
 *  filesystem (see `lib/plans.ts`). */
export const STUDIO_PAGES: StudioPage[] = [
  // ── Plans (index only — individual plans appended dynamically) ──
  {
    href: "/plans",
    label: "Plans Index",
    bucket: "plans",
    status: "shipped",
    blurb: "Every plan in plans/, with status + last-touched.",
  },

  // ── Engineering (index only — SCO docs appended from docs/eng/) ──
  {
    href: "/eng",
    label: "Engineering Index",
    bucket: "eng",
    status: "shipped",
    blurb: "Numbered SCO proposals + supporting notes, read live from docs/eng/.",
  },

  // ── Foundations ─────────────────────────────────────────────────
  {
    href: "/foundations/color-tokens",
    label: "Color Tokens",
    bucket: "foundations",
    family: "color-tokens",
    status: "draft",
    source: ["design/studio/app/globals.css"],
    blurb: "Every studio CSS var as side-by-side dark/light swatches.",
  },
  {
    href: "/foundations/typography",
    label: "Typography",
    bucket: "foundations",
    family: "typography",
    status: "draft",
    source: ["design/studio/app/globals.css", "design/studio/tailwind.config.ts"],
    blurb: "Display · sans · mono ramps + a prose stress-test in both themes.",
  },
  {
    href: "/foundations/spacing-density",
    label: "Spacing & Density",
    bucket: "foundations",
    family: "spacing-density",
    status: "draft",
    source: ["design/studio/tailwind.config.ts"],
    blurb: "Spacing scale + comfortable/compact/manifest density specimens.",
  },

  // ── Studies · Scout ─────────────────────────────────────────────
  {
    href: "/studies/home-whats-moving",
    label: "Home · What's Moving",
    bucket: "studies",
    surface: "web",
    family: "home",
    status: "concept",
    source: [
      "design/studio/views/home-whats-moving.tsx",
      "design/studio/app/studies/home-whats-moving/page.tsx",
      "packages/web/client/screens/home/home-now-card.tsx",
      "packages/web/client/screens/home/content.tsx",
    ],
    blurb:
      "Chosen: signal first, groupable, one-line rows. Selection opens a fixed centered glass overlay over a light scrim — list does not reflow. Recent / Grouped. Studio only until ported.",
  },
  {
    href: "/studies/pr-assign-review",
    label: "Repos · Assign for review",
    bucket: "studies",
    surface: "web",
    family: "repos",
    status: "concept",
    source: [
      "design/studio/views/pr-assign-review.tsx",
      "design/studio/app/studies/pr-assign-review/page.tsx",
      "design/studio/components/MessageComposer.tsx",
      "packages/web/client/scout/repo-watch/PullRequestAssignDialog.tsx",
      "packages/web/client/components/MessageComposer/MessageComposer.tsx",
    ],
    blurb:
      "Second take: pure MessageComposer shell (not a custom form). PR context + project/agent chips in header; harness·model·effort as toolbar selects; guidance draft is the body. Agent defaults empty. Studio only until ported.",
  },
  {
    href: "/studies/session-harness-state",
    label: "Session Harness State",
    bucket: "studies",
    surface: "cross",
    status: "draft",
    source: [
      "design/studio/views/session-harness-state.tsx",
      "docs/eng/sco-079-session-harness-state-machine.md",
    ],
    blurb: "A styled state-machine view for agent sessions as durable context plus live harness attachment; separates session lifecycle from invocation delivery.",
  },
  {
    href: "/studies/scout-shell",
    label: "Scout Design System",
    bucket: "studies",
    surface: "cross",
    status: "in-flight",
    source: [
      "design/studio/app/studies/scout-shell/page.tsx",
      "apps/macos/Sources/Scout/ScoutTheme.swift",
    ],
    blurb: "One token set (the exact sRGB of native ScoutThemeColors) and the whole shell rebuilt from it — Comms, Agents, Repos, Tail, Settings as window mockups. Default skin is the live app theme: juniper · light · indigo.",
  },
  {
    href: "/studies/scout-icon-treatments",
    label: "Scout Icon Treatments",
    bucket: "studies",
    surface: "cross",
    status: "in-flight",
    source: [
      "design/studio/app/studies/scout-icon-treatments/page.tsx",
      "apps/macos/Sources/ScoutMenu/AppDelegate.swift",
      "assets/icons/app/os.icon/Assets/AppIcon.png",
    ],
    blurb: "Menu-bar and app-icon optical sizes side by side: protected small status marks, full app icon, and tiny simplified cube treatments so the mark keeps its O-shaped read at status-bar scale.",
  },
  {
    href: "/studies/scout-ios",
    label: "Scout iOS Theme",
    bucket: "studies",
    surface: "ios",
    family: "scout-ios",
    status: "in-flight",
    source: [
      "design/studio/app/studies/scout-ios/page.tsx",
      "apps/ios/Scout/Theme.swift",
      "design/studio/components/scout-ios/index.ts",
    ],
    blurb: "Family hub for the iOS surfaces — the theme in an iPhone frame with a live token board + Shipped vs Higher-contrast toggle, an in-frame surface switcher, and links to each dedicated lab. All five share components/scout-ios.",
  },
  {
    href: "/studies/scout-ios-home",
    label: "Scout iOS · Home",
    bucket: "studies",
    surface: "ios",
    family: "scout-ios",
    status: "in-flight",
    source: [
      "design/studio/app/studies/scout-ios-home/page.tsx",
      "apps/ios/Scout/HomeSurface.swift",
    ],
    blurb: "Projects-first fleet landing — machine rail, currently-working strip, projects tree with one-child compression, latest-activity log. Faithful port + a Compact density treatment.",
  },
  {
    href: "/studies/scout-ios-agents",
    label: "Scout iOS · Agents",
    bucket: "studies",
    surface: "ios",
    family: "scout-ios",
    status: "in-flight",
    source: [
      "design/studio/app/studies/scout-ios-agents/page.tsx",
      "apps/ios/Scout/AgentsSurface.swift",
    ],
    blurb: "The bridge directory as a project navigator — PROJECT | RECENT sort, project trees with connectors or a flat recent list. Faithful port + a Compact density treatment.",
  },
  {
    href: "/studies/scout-ios-comms",
    label: "Scout iOS · Comms",
    bucket: "studies",
    surface: "ios",
    family: "scout-ios",
    status: "in-flight",
    source: [
      "design/studio/app/studies/scout-ios-comms/page.tsx",
      "apps/ios/Scout/CommsSurface.swift",
    ],
    blurb: "Interleaved channels + DMs with a status separator (ask / working / awaiting / idle) and unread emphasis. Faithful tint-and-rail port + a continuous Hairline list treatment.",
  },
  {
    href: "/studies/scout-ios-tail",
    label: "Scout iOS · Tail",
    bucket: "studies",
    surface: "ios",
    family: "scout-ios",
    status: "in-flight",
    source: [
      "design/studio/app/studies/scout-ios-tail/page.tsx",
      "apps/ios/Scout/TailSurface.swift",
    ],
    blurb: "The live cross-agent firehose — attribution badge · source · kind · time + summary. Faithful inset-card port + a flat Hairline stream treatment.",
  },
  {
    href: "/studies/scout-ios-conversation",
    label: "Scout iOS · Conversation",
    bucket: "studies",
    surface: "ios",
    family: "scout-ios",
    status: "in-flight",
    source: [
      "design/studio/app/studies/scout-ios-conversation/page.tsx",
      "apps/ios/Scout/ConversationSurface.swift",
    ],
    blurb: "The session transcript + composer — typed blocks (text / reasoning / action with approval gate / question), a streaming turn, steer composer. Pushed surface, no tab bar.",
  },
  {
    href: "/studies/scout-ios-terminal",
    label: "Scout iOS · Terminal",
    bucket: "studies",
    surface: "ios",
    family: "scout-ios",
    status: "in-flight",
    source: [
      "design/studio/app/studies/scout-ios-terminal/page.tsx",
      "apps/ios/Scout/TerminalSurface.swift",
    ],
    blurb: "SSH PTY into a paired Mac — Ghostty-style screen + quick-key tray with dictation. Live + Connecting (authorizing) states.",
  },
  {
    href: "/studies/scout-ios-new",
    label: "Scout iOS · New Session",
    bucket: "studies",
    surface: "ios",
    family: "scout-ios",
    status: "in-flight",
    source: [
      "design/studio/app/studies/scout-ios-new/page.tsx",
      "apps/ios/Scout/NewSessionSurface.swift",
    ],
    blurb: "Project + harness + model + prompt composer to start a session on any paired machine. Compose + Started (result ids) states.",
  },
  {
    href: "/studies/scout-steering-loop",
    label: "Scout · Steering Loop",
    bucket: "studies",
    surface: "ios",
    family: "steering-loop",
    status: "draft",
    source: [
      "design/studio/views/scout-steering-loop.tsx",
      "apps/ios/Scout/AgentsSurface.swift",
      "packages/web/client/screens/ops/lane-deck.ts",
      "packages/web/server/create-openscout-web-server.ts",
    ],
    blurb:
      "Rethinks the iOS core surfaces around the operator loop — dispatch → ambient work → attention — as a current ⇄ proposed showcase. WORK becomes a deck of lane cockpits that scales from an iPhone summary tier to an iPad lane deck (grounded in the web AgentLaneSummaryResize cockpit + the lane-deck.ts profiles, which already carry width tiers and an attention lane kind). DISPATCH retires the 8-decision session form for a calm activity feed behind an intent-first \"+\" that promotes the HUD dock's @-routing. ATTENTION is a short low-hanging-fruit ledger: one /api/agents change wakes four dormant surfaces; a full inbox is parked. Every fact verified against the codebase.",
  },
  {
    href: "/studies/scout-ios-connect",
    label: "Scout iOS · Connect",
    bucket: "studies",
    surface: "ios",
    family: "scout-ios",
    status: "in-flight",
    source: [
      "design/studio/app/studies/scout-ios-connect/page.tsx",
      "apps/ios/Scout/ConnectionView.swift",
      "apps/ios/Scout/PairingView.swift",
    ],
    blurb: "Bridging to a Mac — route inspector (LAN → TSN → OSN + connection log) and the QR pairing flow (Noise handshake). Pushed sheet, no tab bar.",
  },
  {
    href: "/studies/scout-ios-settings",
    label: "Scout iOS · Settings",
    bucket: "studies",
    surface: "ios",
    family: "scout-ios",
    status: "in-flight",
    source: [
      "design/studio/app/studies/scout-ios-settings/page.tsx",
      "apps/ios/Scout/AppSettingsView.swift",
    ],
    blurb: "The HudInspectorSettings sheet — a 7-tab inspector (Connection · Routes · Identity · Voice · Alerts · Appearance · Advanced). Pushed sheet, no tab bar.",
  },
  {
    href: "/studies/mobile-chrome",
    label: "Scout iOS · Mobile Chrome",
    bucket: "studies",
    surface: "ios",
    family: "scout-ios",
    status: "in-flight",
    source: [
      "design/studio/views/mobile-chrome.tsx",
      "design/mobile-chrome-study/index.html",
      "apps/ios/Scout/RootView.swift",
      "apps/ios/Scout/StatusBar.swift",
    ],
    blurb: "Second-pass chrome study — does the masthead earn its place, how slim can the dock go, can it collapse. Five frames (baseline, A no-masthead, B slim dock, C collapsible dock, D full reduction) around the settled status strip; A recommended, B the cheapest first ship. Port of design/mobile-chrome-study.",
  },
  {
    href: "/studies/crown-complications",
    label: "Scout iOS · Crown & Complications",
    bucket: "studies",
    surface: "ios",
    family: "scout-ios",
    status: "in-flight",
    source: [
      "design/studio/views/crown-complications.tsx",
      "design/studio/views/mobile-chrome.tsx",
      "apps/ios/Scout/RootView.swift",
      "apps/ios/Scout/Theme.swift",
    ],
    blurb: "High-fidelity interactive take on Proposal C — the scout hex as a summon crown, no wordmark. Two live variants: T (crown-top masthead replacement, tap → Deck/Settings + host filter, bottom chrome as shipped) and B (crown = whole chrome — four big corner circles + a connecting nav bar of tab-like inner slots around the crown, plus a first-class Fleet LED readout up top). Tap the crown to collapse/expand with spring+stagger, channelled from talkie's voice-pivot; ?variant / ?state=collapsed|assembled / ?demo params for deterministic captures.",
  },
  {
    href: "/studies/scout-inspectors",
    label: "Scout · Inspectors In Context",
    bucket: "studies",
    surface: "macos",
    family: "scout-macos-shell",
    status: "draft",
    source: [
      "design/studio/app/studies/scout-inspectors/page.tsx",
      "packages/web/client/scout/inspector/AgentsInspector.tsx",
      "packages/web/client/scout/slots/Inspector.tsx",
    ],
    blurb: "Full inventory of every right-side inspector content-type that ships in the live app (Home · Agents · Chat · Search · Ops · Repos · Work — 15 types), each rendered in the locked Instrument language with realistic live-fleet data and its design decision. Inventoried from scout/inspector/* + the slot router.",
  },
  {
    href: "/studies/scout-shell-directions",
    label: "Scout Shell · Inspector Sidebar",
    bucket: "studies",
    surface: "macos",
    family: "scout-macos-shell",
    status: "draft",
    source: ["design/studio/app/studies/scout-shell-directions/page.tsx"],
    blurb: "The right-side inspector sidebar in the locked Instrument language (near-black, mono-first, telemetry over decoration), shown in context and as three takes — Telemetry · Readout · Modules — to converge the sidebar's design language. The center list is explored elsewhere.",
  },
  {
    href: "/studies/home-sidebar",
    label: "Home · Sidebar",
    bucket: "studies",
    surface: "web",
    family: "navigation",
    status: "concept",
    source: [
      "design/studio/app/studies/home-sidebar/page.tsx",
      "packages/web/client/screens/home/left.tsx",
      "packages/web/client/screens/home/content.tsx",
    ],
    blurb:
      "The Home route left rail — what ships today in BaseLeftRail (Recent agents · Recent activity · Needs attention, each with an all escape) vs a lens-first alternative (Needs you / Moving / Quiet + foot jump tiles). Center Home is dimmed; the study is the rail definition only.",
  },
  {
    href: "/studies/agents-projects-first",
    label: "Agents · Projects First",
    bucket: "studies",
    surface: "web",
    status: "concept",
    source: [
      "design/studio/app/studies/agents-projects-first/page.tsx",
      "packages/web/client/screens/AgentsScreen.tsx",
      "packages/web/client/scout/slots/LeftPanel.tsx",
    ],
    blurb:
      "Flip the body IA: the project is the primary object, not the agent. The page is a calm list of projects; under each, a few recent sessions listed directly — regardless of which agent owns them (harness/agent reduced to a faint attribution). Sortable by recency or project; attention (`needs you`) badges but doesn't override the chosen sort. The left rail stops re-listing projects and becomes attention/activity lenses. Premise: the agent-card directory is secondary — more for agents to find each other than for the operator to think about the world.",
  },
  {
    href: "/studies/projects-landing",
    label: "Projects · Landing",
    bucket: "studies",
    surface: "web",
    status: "concept",
    source: [
      "design/studio/views/projects-landing.tsx",
      "packages/web/client/screens/projects/ProjectsInbox.tsx",
      "packages/web/client/screens/projects/ProjectsRail.tsx",
    ],
    blurb:
      "The unscoped /projects center — shortcuts · recent projects · active diffs — in three switchable takes: Rows (what shipped), Ledger (dense aligned columns), Editorial (quietest, text-led, recommended). Hard rules baked in: nothing pill-shaped (filters that aren't), no raw .jsonl paths as titles, one emerald accent reserved for needs-you/live, and the center never re-lists all projects — the rail owns navigation.",
  },
  {
    href: "/studies/app-nav",
    label: "App nav · Chrome & structure",
    bucket: "studies",
    surface: "shell",
    status: "concept",
    source: [
      "design/studio/views/app-nav.tsx",
      "docs/design/navigation-study.md",
      "design/navigation-study/option-a-anchored-l.html",
      "packages/web/client/OpenScoutAppShell.tsx",
      "packages/web/client/scout/topNavConfig.ts",
    ],
    blurb:
      "Two levels of the nav question. Part 1 · shell chrome (SCO-083→087): where the top-left corner belongs and how the left rails collapse, as a three-column side-by-side of A · Anchored L (recommended — full-height sidebar owns the corner, top row inset), B · Full-width Mast (needs sign-off — mast spans everything, sidebar below), C · Telescoping Rail (most ambitious — nav+context collapse into ONE 48px rail, context flies out as an overlay), each in expanded AND collapsed state with a difference matrix (corner ownership · top-bar span · double-rail vs single-rail). Part 2 · structure: four switchable IA models — A · Status quo (problem-flagged), B · Work nouns (shipped), C · Project-first (shelved), D · Human jobs (proposed) — with the full 24-route inventory mapped onto each.",
  },
  {
    href: "/studies/chat-landing",
    label: "Chat · Landing",
    bucket: "studies",
    surface: "web",
    status: "shipped",
    source: [
      "design/studio/views/chat-landing.tsx",
      "packages/web/client/screens/chat/MessagesScreen.tsx",
      "packages/web/client/screens/chat/left.tsx",
    ],
    blurb:
      "The unscoped /chat center (messages route, nothing selected) — today a card grid that re-lists the rail, with per-card 1/2/4 layout chrome, marketing copy, and filter route state the grid ignores. Three switchable takes: A · Grid (control, problem-flagged), B · Jump board (recommended: shortcuts + unread + a few recents — the rail owns the tree), C · Editorial (quietest, text-led). Principles: the rail navigates, unread is chat's attention (ask-states belong to the rail and Home), no layout chrome on rows, one address per conversation, filters own the rail only.",
  },
  {
    href: "/studies/agents-directory",
    label: "Agents · Directory",
    bucket: "studies",
    surface: "web",
    status: "draft",
    source: [
      "design/studio/app/studies/agents-directory/page.tsx",
      "packages/web/client/screens/agents/library.tsx",
      "packages/web/client/screens/agents/AgentsScreen.tsx",
    ],
    blurb:
      "Clean-sheet rebuild of the Agents starting place after the shipped projects-first table read as a dark, bland inventory. Same primary object (project) reborn as cards: project → agent cards → session map. Assumes many sessions per agent, so the session layer is an always-visible map (recency tiles, active in accent) with a focus caption + `+ start session`, not a collapsed list. A concise live-lanes peek opens full Lanes on engage. Tuned for Graphite Dark with sprite identity; one accent as a precedence ladder (needs-you ▸ working ▸ idle), never categorical status color.",
  },
  {
    href: "/studies/agents-project",
    label: "Agents · Project view",
    bucket: "studies",
    surface: "web",
    status: "draft",
    source: [
      "design/studio/app/studies/agents-project/page.tsx",
      "design/studio/app/studies/agents-directory/page.tsx",
      "packages/web/client/screens/agents/library.tsx",
      "packages/web/client/screens/agents/model.ts",
    ],
    blurb:
      "The wide pane when you focus ONE project — the fix for the near-blank project detail. Synthesis of three explored lenses: a command-center's density + resolve-in-place steering, a project-home's calm digest (harnesses · branches-in-flight · conversations · last-active) so an idle project reads full not blank, and a work-stream's produced changes as the review aside. Spine = the contributor roster (agent = project·harness rollup, sessions expand inline). A conditional `Now` band steers the highest-precedence agent without opening a thread. One accent as a precedence ladder (needs-you ▸ working ▸ idle), coherent with the gmail Directory study.",
  },
  {
    href: "/studies/agents-roster-detailed",
    label: "Agents · Detailed Roster",
    bucket: "studies",
    surface: "web",
    status: "concept",
    source: [
      "design/studio/app/studies/agents-roster-detailed/page.tsx",
      "design/studio/app/studies/session-summary-card/page.tsx",
      "design/studio/app/studies/agents-project/page.tsx",
    ],
    blurb:
      "The project directory roster, but each row is a session-summary MD card instead of a terse one-line directory row. The live roster shows name · branch · `6 instances · 12 conv` · ago — metadata, not work. Here each agent is a card: the WORK is the headline, the agent demotes to a small attribution line, and the body is a compact LOG of recent activity (a few timestamped lines, almost a changelog). More detail per agent, inline, no drill required. Frame above (masthead · digest · find) lifted from the project view; card material from the session-summary card. One accent dot: waiting ▸ working ▸ idle.",
  },
  {
    href: "/studies/agents-roster-tabular",
    label: "Agents · Tabular + rail",
    bucket: "studies",
    surface: "web",
    status: "concept",
    source: [
      "design/studio/app/studies/agents-roster-tabular/page.tsx",
      "design/studio/app/studies/session-profile-full/page.tsx",
      "design/studio/app/studies/session-summary-card/page.tsx",
      "design/studio/app/studies/agents-project/page.tsx",
    ],
    blurb:
      "The roster split the difference between terse one-liners (too little) and fat cards (too much): a DENSE TABLE — one line per agent, but with context columns (one-line work summary · ctx% · last-turn · files · turns) so you can scan many agents and compare them. The column-header row and every data row share one CSS-grid template so columns truly align. Clicking a row doesn't expand in place — it loads 'a bit more' into the RIGHT RAIL (the master–detail pane): attribution · a context gauge · touched files · the session log · a decision row by state. One selection always live (default a working agent). One accent: precedence dot · selected-row left edge · ctx fill · primary CTA.",
  },
  {
    href: "/studies/agents-rail-actions",
    label: "Agents · Rail Actions",
    bucket: "studies",
    surface: "web",
    status: "concept",
    source: [
      "design/studio/app/studies/agents-rail-actions/page.tsx",
      "packages/web/client/screens/agents/left.tsx",
      "packages/web/client/screens/resolve-panes.tsx",
    ],
    blurb:
      "Keep the main view as the list (projects, or the agents under them) and move only the chrome. Search and New-chat leave the center and become rail actions that open a ⌘K command palette (cross-fleet lookup: agents · sessions) / a small composer over the list, then close — no pinned filter box, no second search staged in the center. Kept deliberately simple: two actions, the few agents you last touched, a settings foot (pointers/lenses cut for now). One emerald accent reserved for attention.",
  },
  {
    href: "/studies/agent-lanes-card",
    label: "Agent Lanes · Card",
    bucket: "studies",
    surface: "web",
    status: "concept",
    source: [
      "design/studio/app/studies/agent-lanes-card/page.tsx",
      "design/studio/components/HarnessMark.tsx",
      "packages/web/client/screens/ops/AgentLaneSummaryCard.tsx",
      "packages/web/client/components/HarnessMark.tsx",
    ],
    blurb:
      "Design surface for the OPS agent-lanes summary card: harness brand-mark icons (Claude, Codex cloud, Grok, Gemini, Cursor, GitHub, OpenCode, Amp + geometric stand-ins) and the header/meta layout — avatar identity on the left, a unified secondary line split into where (path · branch) and what (harness logo anchoring model · effort · time). Iterate here, then port to the web component.",
  },
  {
    href: "/studies/lane-detail-sheet",
    label: "Agent Lane · Detail Sheet",
    bucket: "studies",
    surface: "web",
    status: "concept",
    source: [
      "design/studio/app/studies/lane-detail-sheet/page.tsx",
      "design/studio/app/studies/agent-lanes-card/page.tsx",
      "packages/web/client/screens/ops/AgentLaneDetailSheet.tsx",
    ],
    blurb:
      "Tall right-side inspector for one agent's work session — the OPS lane detail sheet, redesigned from a read-only fact dump into a jumpable + copyable + grouped instrument. Three north-star ergonomics: JUMP (sticky anchor bar + per-row open/reveal), COPY (a hover copy dot on every id · path · value, plus Copy-diagnostics / Copy-changed / Copy-all), INVENTORY (collections as real, complete, groupable lists — no 10-cap). IA top→bottom: NOW (lead with the live ❯ action + stat strip) → ACTIONS → RUNTIME (ONE block, duplicate fact blocks killed; model · effort · branch · cwd · session · transcript with reveal) → USAGE → FILES (grouped NEW / MODIFIED / READ with per-file +adds −dels) → COMMANDS (this turn) → PLANS (step tally) → DOCS (collapsed when empty). Self-contained palette matching the lane card; one emerald accent, geometric marks only. Iterate here, port to the web component.",
  },
  {
    href: "/studies/agents-top-collapse",
    label: "Agents · Top Collapse",
    bucket: "studies",
    surface: "web",
    status: "concept",
    source: [
      "design/studio/app/studies/agents-top-collapse/page.tsx",
      "packages/web/client/screens/AgentsScreen.tsx",
      "packages/web/client/screens/agents-screen.css",
      "packages/web/client/scout/slots/LeftPanel.tsx",
    ],
    blurb:
      "The live Agents top stacks five control bands — two searches, two status filters, time, harness, view — before the first card (~7 operable controls). Three takes switchable in place: Before (faithful pile), Tucked (view · search · one filters disclosure), Ruthless (cards/tree hero + one search-carries-everything + a single 24h hint → 2 controls). Status is roster vocab → deleted, shown as an in-card activity signal; harness folds into search (type `claude`). A ledger documents the verdict on every control. Ruthless recommended.",
  },
  {
    href: "/studies/agent-profile-tidy",
    label: "Agent Profile · Tidy Pass",
    bucket: "studies",
    surface: "web",
    status: "in-flight",
    source: [
      "design/studio/app/studies/agent-profile-tidy/page.tsx",
      "packages/web/client/screens/AgentsScreen.tsx",
      "packages/web/client/screens/agents-screen.css",
      "packages/web/client/scout/inspector/AgentsInspector.tsx",
    ],
    blurb: "Before / after for two cleanups to the live Agents → profile surface: the center metadata facets move from a stretchy flex-wrap (two cells balloon to fill the row) to a uniform grid, and the right rail stops re-printing State · Identity · Project — narrowing to a live Instrument. Center + rail shown together so the cross-panel redundancy reads at a glance.",
  },
  {
    href: "/studies/agent-profile-redesign",
    label: "Agent Profile · Redesign",
    bucket: "studies",
    surface: "web",
    status: "concept",
    source: [
      "design/studio/app/studies/agent-profile-redesign/page.tsx",
      "design/studio/app/studies/agent-profile-cockpit/page.tsx",
      "design/studio/app/studies/agent-profile-dossier/page.tsx",
      "design/studio/app/studies/agent-profile-modular/page.tsx",
    ],
    blurb: "Three serious takes on the Agents → profile surface, switchable in place (Before · Cockpit · Dossier · Modular) — no page-hopping to compare. All kill the ballooning facet grid + dead canvas and split the panes cleanly: center owns the facts, the rail is a live Instrument. Cockpit is the recommended spine.",
  },
  {
    href: "/studies/agent-profile-rebalance",
    label: "Agent Profile · Rebalance",
    bucket: "studies",
    surface: "web",
    status: "concept",
    source: [
      "design/studio/app/studies/agent-profile-rebalance/page.tsx",
      "packages/web/client/screens/AgentsScreen.tsx",
      "packages/web/client/scout/inspector/AgentsInspector.tsx",
    ],
    blurb: "Toggle Current ↔ Rebalanced on the shipped Modular profile, both recreated in code. Principle: the main area holds what you came to know and do (state, work, relationships, actions); the side holds reference detail (raw console, runtime plumbing, paths). The live profile inverts this — center half-empty, rail hoarding sessions + talks-to + caps — so this pulls the primary modules into the center and slims the rail to a true inspector.",
  },
  {
    href: "/studies/scout-macos",
    label: "Scout macOS · Elevated",
    bucket: "studies",
    surface: "macos",
    family: "scout-macos-shell",
    status: "concept",
    source: [
      "design/studio/app/studies/scout-macos/page.tsx",
      "apps/macos/Sources/Scout/ScoutModels.swift",
      "apps/macos/Sources/Scout/ScoutRootView.swift",
    ],
    blurb:
      "The iteration canvas for the elevated macOS direction. All four core screens — Comms, Agents, Tail, Repos — in one frosted-depth frame, applying the ScoutNext elegant language (raised surfaces, soft depth, corner ticks, bracketed controls, hand-drawn glyphs, ink-strong type) to the desktop shell. Content mirrors the live app; the treatment is the proposal. Baseline lives in scout-macos-shell; the Comms decision artifact in scout-macos-refresh.",
  },
  {
    href: "/studies/scout-macos-shell",
    label: "Scout macOS Shell",
    bucket: "studies",
    surface: "macos",
    family: "scout-macos-shell",
    status: "draft",
    source: [
      "design/studio/app/studies/scout-macos-shell/page.tsx",
      "apps/macos/Sources/Scout/ScoutRootView.swift",
      "apps/macos/Sources/Scout/ScoutCommsView.swift",
      "apps/macos/Sources/Scout/ScoutTailView.swift",
      "apps/macos/Sources/Scout/ScoutReposView.swift",
    ],
    blurb: "Master page for the four screens in the Scout macOS app — Comms, Agents, Tail, Repos — rendered on the shared shell chrome (titlebar · nav rail · main · right inspector · status bar) so the shell can evolve coherently. Each window is a representative slice; the dedicated study for each screen is the source of truth.",
  },
  {
    href: "/studies/scout-macos-refresh",
    label: "Scout macOS · Refresh",
    bucket: "studies",
    surface: "macos",
    family: "scout-macos-shell",
    status: "draft",
    source: [
      "design/studio/app/studies/scout-macos-refresh/page.tsx",
      "docs/agent/studio-levelup-brief.md",
      "apps/macos/Sources/Scout/ScoutRootView.swift",
      "apps/macos/Sources/Scout/ScoutCommsView.swift",
    ],
    blurb: "The consolidated macOS direction from the design review, in one projection of the refreshed Comms window — list · thread · inspector. Lands the ask-context story end to end (the [ask:<flightId>] reply-context backlink, the pinned originating-ask band, the list chip and inspector Ask block all reading one state), adopts the signed-off inspector grammar (Section/KV from scout-inspectors) for the channel inspector's Conversation/Project/Ask blocks, and adds the thread header sub-line + actions. A ledger maps every change to its macOS symbol and whether it ships, refines, or is net-new.",
  },
  {
    href: "/studies/scout-macos-control",
    label: "Scout macOS · Control",
    bucket: "studies",
    surface: "macos",
    family: "scout-macos-shell",
    status: "concept",
    source: [
      "design/studio/app/studies/scout-macos-control/page.tsx",
      "apps/macos/Sources/Scout/ScoutTheme.swift",
      "apps/macos/Sources/Scout/ScoutCommsView.swift",
    ],
    blurb:
      "The control for the elevated direction: the existing style reconstructed in code (not screenshotted) at the same fidelity — Juniper Light, indigo, flat hairline lists, SF-Symbol rail, system type. An in-place Existing⇄Elevated toggle holds the same Comms content fixed (recency list, pinned ask, reply-context backlink, signed-off inspector blocks) so only the treatment varies, plus a plating-vs-substance ledger that separates real refresh wins from the studio's dark/green/glass plating.",
  },
  {
    href: "/studies/scout-comms",
    label: "Scout Comms",
    bucket: "studies",
    surface: "macos",
    family: "scout-surfaces",
    status: "in-flight",
    source: [
      "design/studio/app/studies/scout-comms/page.tsx",
      "apps/macos/Sources/Scout/ScoutCommsView.swift",
    ],
    blurb: "The conversation surface broken out from the design system — recency groups, labeled filters, unread emphasis, ask answered/pending, pinned Ask, collapsible turns, composer hint. Carries the unreadCount + askState data contract for the native port.",
  },
  {
    href: "/studies/scout-comms-threads",
    label: "Scout Comms · Threads",
    bucket: "studies",
    surface: "macos",
    family: "scout-surfaces",
    status: "draft",
    source: [
      "design/studio/views/scout-comms-threads.tsx",
      "docs/agent/comms-threads-brief.md",
      "apps/macos/Sources/Scout/ScoutCommsView.swift",
      "apps/macos/Sources/ScoutAppCore/ScoutCommsModels.swift",
      "packages/runtime/src/schema.ts",
    ],
    blurb: "Reply and thread as first-class moves in the Comms surface, staged by backing: Current (the shipped custody-caption baseline, plus the orphan row branch-from-message mints today), Reply-to (phase 1 — hover Reply, composer target chip, chain gathered behind a hairline rail; replyToMessageId already decodes, only the send path is new), Sub-thread (phase 2 — an anchored child conversation via parent_conversation_id + message_id with a faces·count·recency stub, expanded inline; the list gains no row and branch-from-message anchors here). Data contract separates the phase-1 client fields from the phase-2 server population.",
  },
  {
    href: "/studies/scout-conversation-presentations",
    label: "Scout Comms · Presentations",
    bucket: "studies",
    surface: "macos",
    family: "scout-surfaces",
    status: "draft",
    source: [
      "design/studio/app/studies/scout-conversation-presentations/page.tsx",
      "apps/macos/Sources/Scout/ScoutCommsView.swift",
      "apps/macos/Sources/Scout/ScoutRootView.swift",
      "packages/web/client/screens/ConversationScreen.tsx",
    ],
    blurb: "The active-agent message stream as switchable treatments (the Presentation control is the future macOS setting): Transcript (sender-led, grouped), Split (alternating sides), Document (reading-first), Ledger (dense ops log). Two fixes — a live Working turn fills the dead air before a reply lands (flight state · latest activity event · motion meter, mirroring the web's Currently-working panel), and one collapse rule across all treatments: the latest turn is always full, recent turns stay full, only older long turns fold. No 'Show more' on what's in front of you.",
  },
  {
    href: "/studies/scout-comms-inspector",
    label: "Scout Comms · With Inspector",
    bucket: "studies",
    surface: "macos",
    family: "scout-comms-inspector",
    status: "draft",
    source: [
      "design/studio/app/studies/scout-comms-inspector/page.tsx",
      "apps/macos/Sources/Scout/ScoutCommsView.swift",
      "design/studio/app/studies/inspector-grammar/page.tsx",
    ],
    blurb: "Focused iteration on adding a 300px right-rail inspector to the Comms surface. §1 is the port target (Dewey selected). §2 weighs three integration variants (always visible, pop on select, toolbar toggle) and recommends the always-visible one for consistency with Agents and Repos. §3 is the data contract — most fields are derivable, two need a join. §4 documents the four decisions that don't follow from the other three surfaces (primary action is 'Open', Ask is its own block, Project is its own block, status badge is 'Open' not 'available').",
  },
  {
    href: "/studies/landing-language",
    label: "Landing · Design Language",
    bucket: "studies",
    surface: "web",
    status: "concept",
    source: [
      "design/studio/app/studies/landing-language/page.tsx",
      "landing/openscout.app/src/app/page.tsx",
      "landing/openscout.app/src/app/globals.css",
    ],
    blurb:
      "What replaces the RFC costume on openscout.app. Three takes on the shared Basel bones (paper/ink, one red, Archivo + Plex Mono, hairlines): Plain — the costume comes off, plain labels and an unlabeled facts strip; Thread — real transcript excerpts as the figures, the page demonstrates the product; Instrument — the app's gauge language on paper, stat readouts and dot-led record rows.",
  },
  {
    href: "/studies/scout-comms-channels",
    label: "Scout Comms · Channels",
    bucket: "studies",
    surface: "macos",
    family: "scout-comms-inspector",
    status: "draft",
    source: [
      "design/studio/app/studies/scout-comms-channels/page.tsx",
      "design/studio/components/SpriteAvatar.tsx",
      "design/studio/lib/agent-identity.ts",
      "packages/web/client/screens/ChannelsScreen.tsx",
    ],
    blurb: "The group-conversation surface in the sprite identity language — every participant, agents AND the operator 'you', is a deterministic creature. Channel list rows lead with a stacked sprite cluster of their cast (+N for the rest); the thread gives the operator an accent-ringed sprite; a participant rail sits above the composer. Hue is the harness, shape is the name; the single red accent stays reserved for you-ring / unread / selection.",
  },
  {
    href: "/studies/screen-headers",
    label: "Screen Headers · One Treatment",
    bucket: "studies",
    surface: "macos",
    family: "scout-surfaces",
    status: "concept",
    source: [
      "design/studio/views/screen-headers.tsx",
      "apps/macos/Sources/Scout/ScoutRootView.swift",
      "apps/macos/Sources/Scout/ScoutTailView.swift",
    ],
    blurb: "One header language across Tail, Agents, and Repos so the app reads as one surface: a grotesk title (no glyph), counts as a flat mono eyebrow (no rounded pills), a breathing controls band (never two tight rows), and a shared mono column-header band. Typography is the lattices pairing — Inter Tight + JetBrains Mono.",
  },
  {
    href: "/studies/tail-header",
    label: "Tail · Header Treatments",
    bucket: "studies",
    surface: "macos",
    family: "scout-surfaces",
    status: "concept",
    source: [
      "design/studio/views/tail-header.tsx",
      "apps/macos/Sources/Scout/ScoutTailView.swift",
    ],
    blurb: "Four header bars for the firehose, same payload (identity, inventory, search, source filter, Ledger/Timeline toggle, Follow/Pause), different structure + relief: an Instrument gauge cluster, a two-tier Editorial split, a search-hero Command bar, and a dense single-line Console. Pick one to port to ScoutTailView's header.",
  },
  {
    href: "/studies/tail-treatments",
    label: "Tail · Treatments",
    bucket: "studies",
    surface: "macos",
    family: "scout-surfaces",
    status: "concept",
    source: [
      "design/studio/views/tail-treatments.tsx",
      "apps/macos/Sources/Scout/ScoutTailView.swift",
    ],
    blurb: "Four directions for the event stream, same data, compared like-for-like: a dense Console, a columnar Ledger, a roomy two-line Feed, and a Timeline spine. All keep one full line per event, drop every live cue, and drop throughput. Grounded in well-known log viewers.",
  },
  {
    href: "/studies/tail-great",
    label: "Tail · What Great Looks Like",
    bucket: "studies",
    surface: "macos",
    family: "scout-surfaces",
    status: "concept",
    source: [
      "design/studio/views/tail-great.tsx",
      "apps/macos/Sources/Scout/ScoutTailView.swift",
    ],
    blurb: "The north-star for the live event stream: a firehose that reads like a calm shell log. One full line per event — the same agent stacks up and takes its space, never collapsed; runs breathe. Tool calls read like shell history, results collapse to an outcome. Each kind carries a glyph AND a color so it reads at a glance. One state only: Follow or Pause.",
  },
  {
    href: "/studies/scout-tail",
    label: "Scout Tail",
    bucket: "studies",
    surface: "macos",
    family: "scout-surfaces",
    status: "in-flight",
    source: [
      "design/studio/app/studies/scout-tail/page.tsx",
      "apps/macos/Sources/Scout/ScoutTailView.swift",
      "apps/macos/Sources/Scout/ScoutModels.swift",
    ],
    blurb: "The live event stream — inline filter-chip bar (replacing the kind dropdown) and a colored KIND chip per row, with a token-only tone vocabulary that moves tool/output off raw .cyan/.orange.",
  },
  {
    href: "/studies/scout-settings",
    label: "Scout Settings",
    bucket: "studies",
    surface: "macos",
    family: "scout-surfaces",
    status: "in-flight",
    source: [
      "design/studio/app/studies/scout-settings/page.tsx",
      "apps/macos/Sources/Scout/ScoutSettingsView.swift",
    ],
    blurb: "The Appearance page as it should ship — accent as an inline dot row (not big tiles), sections reordered (Theme → Mode → Accent → Window material), plus a Preview-accents-on-hover toggle.",
  },
  {
    href: "/studies/scout-new-conversation",
    label: "Scout · New Conversation",
    bucket: "studies",
    surface: "macos",
    family: "scout-surfaces",
    status: "in-flight",
    source: [
      "design/studio/app/studies/scout-new-conversation/page.tsx",
      "apps/macos/Sources/Scout/ScoutSessionService.swift",
    ],
    blurb: "The native New-conversation modal rebuilt in the shell token language — refined header, a compact Project / Agent target (inline harness · model + target token, not stacked 48pt fields), a focus-bordered message well (no left bar, ~2.5 lines), a quiet Options disclosure, and a harmonized Cancel / Start footer.",
  },
  {
    href: "/studies/quick-capture-magic",
    label: "Quick Capture · Magic Motion",
    bucket: "studies",
    surface: "macos",
    family: "scout-surfaces",
    status: "concept",
    source: [
      "design/studio/app/studies/quick-capture-magic/page.tsx",
      "apps/macos/Sources/ScoutHUD/HUDCaptureHotZone.swift",
      "apps/macos/Sources/ScoutHUD/HUDController.swift",
      "apps/macos/Sources/ScoutHUD/HUDRunnerComposerView.swift",
    ],
    blurb:
      "Interactive motion lab for the two quick-create entries — the Hyper+A hotkey and the hot-corner image drop. A simulated desktop plays the whole choreography (arrival spring · receiver entrance · drop-continuity flying thumbnail · departure to the menu-bar glyph) switchable Current ⇄ Proposed with ¼× slow-mo, plus a moment ledger mapping each spec to its Swift call site and a proposed HUDMotion token vocabulary. Thesis: object permanence and a little physics, not more chrome.",
  },

  // ── Studies · Web ───────────────────────────────────────────────
  {
    href: "/studies/inspector-bar",
    label: "Inspector Bar",
    bucket: "studies",
    surface: "web",
    family: "inspector",
    status: "concept",
    source: ["packages/web/client/scout/slots/Inspector.tsx"],
    blurb: "Cross-screen inspector bar — eight variants in one view.",
  },
  {
    href: "/studies/status-pills",
    label: "Status Pills",
    bucket: "studies",
    surface: "web",
    family: "pills",
    status: "draft",
    source: ["design/studio/app/globals.css"],
    blurb: "Five status tones × three pill forms, theme-aware.",
  },
  {
    href: "/studies/agent-pulse",
    label: "Agent Pulse",
    bucket: "studies",
    surface: "web",
    family: "agent-pulse",
    status: "draft",
    source: ["packages/web/client/scout/inspector/HomeAgentsInspector.tsx"],
    blurb: "Agent state vocabulary — three densities.",
  },
  {
    href: "/studies/agent-identity",
    label: "Agent Identity",
    bucket: "studies",
    surface: "web",
    family: "agent-identity",
    status: "concept",
    source: [
      "design/studio/app/studies/agent-identity/page.tsx",
      "design/studio/lib/agent-identity.ts",
      "apps/macos/Sources/ScoutAppCore/ScoutCommsModels.swift",
    ],
    blurb:
      "Generative agent marks from the name alone — hash → seed → PRNG. Four engines (sprite · sigil · constellation · monogram), a live generator, identity cards, and the roster wall.",
  },
  {
    href: "/studies/sprite-fleet",
    label: "Sprite Fleet",
    bucket: "studies",
    surface: "web",
    family: "agent-identity",
    status: "concept",
    source: [
      "design/studio/app/studies/sprite-fleet/page.tsx",
      "design/studio/components/SpriteAvatar.tsx",
      "design/studio/lib/agent-identity.ts",
    ],
    blurb:
      "The sprite, productized — the curated crew as one set, dropped into rows · card · tree · iOS · comms at true size, a 16→160px legibility ramp, and deterministic-ish controls (blessed · auto · harness · reroll).",
  },
  {
    href: "/studies/fleet-deck",
    label: "Fleet Deck",
    bucket: "studies",
    surface: "cross",
    status: "concept",
    source: [
      "design/studio/views/fleet-deck.tsx",
      "design/studio/views/fleet-deck.module.css",
    ],
    blurb:
      "v2.2 of the multi-machine Deck (voice · remote control), master-detail: a segmented channel-assign bar sized to the real fleet (one host = thin strip), and below it the selected host in two views — AGENT (pending ask with inline Approve/Reply, agents + activity log in a drag-resizable split) and WINDOW (the machine's live windows as a joystick-navigable list), switched from the panel title bar. The control row is a keyboard line — clipboard cluster left, enter/backspace right, press-and-hold joystick center: hold ↑↓ to walk windows, center-tap to focus on the machine. Composer docked-universal or host-scoped (MSG DECK/HOST). Amber reserved for attention; offline hosts show last-known windows and queue for reconnect. FLEET 1/3/4 study toggle, scripted push-to-talk demo, film-grain console texture.",
  },
  {
    href: "/studies/comms-mobile",
    label: "Comms Mobile",
    bucket: "studies",
    surface: "ios",
    family: "comms-mobile",
    status: "concept",
    source: ["apps/ios/ScoutNext/CommsSurface.swift"],
    blurb: "Density pass on the Comms tab — continuous hairline list vs. today's card-per-row. Before / after / ultra-compact.",
  },
  {
    href: "/studies/scoutnext-home",
    label: "ScoutNext Home",
    bucket: "studies",
    surface: "ios",
    family: "scoutnext-home",
    status: "concept",
    source: [
      "design/studio/app/studies/scoutnext-home/page.tsx",
      "apps/ios/ScoutNext/HomeSurface.swift",
      "apps/ios/ScoutNext/Glyphs.swift",
    ],
    blurb: "Local browser workbench for the Home projects tree: one-child compression, single-line agent leaves, rail density, and iPhone mini width.",
  },
  {
    href: "/studies/scoutnext-nav",
    label: "ScoutNext Nav Lab",
    bucket: "studies",
    surface: "ios",
    family: "scoutnext-home",
    status: "concept",
    source: [
      "design/studio/app/studies/scoutnext-nav/page.tsx",
      "apps/ios/ScoutNext/RootView.swift",
      "apps/ios/ScoutNext/Glyphs.swift",
    ],
    blurb: "Breadth-first gallery of bottom-nav treatments (active state, height/density, material) at 375pt, plus Home polish experiments.",
  },
  {
    href: "/studies/agent-cards",
    label: "Agent Cards",
    bucket: "studies",
    surface: "web",
    family: "agent-cards",
    status: "draft",
    source: ["packages/web/client/scout/inspector/AgentsInspector.tsx"],
    blurb: "Info-dense agent tile — identity · state · task · project · capabilities.",
  },
  {
    id: "agent-directory",
    href: "/studies/agent-view-before-after",
    label: "Agent View Before / After",
    bucket: "studies",
    surface: "web",
    family: "agent-cards",
    status: "concept",
    source: [
      "design/studio/app/studies/agent-view-before-after/page.tsx",
      "packages/web/client/screens/AgentsScreen.tsx",
      "packages/web/client/screens/agents-screen.css",
    ],
    blurb: "Studio-mode pilot: clone the Agents board, compare before/after with a button or Option hold, and mark candidate insertion points.",
    target: {
      anchor: "agents.directory",
      mode: "replace",
      route: "/agents",
      surface: "web",
      aliases: ["agents", "agent", "agent-directory-before-after"],
    },
  },
  {
    href: "/studies/agent-inspector-card",
    label: "Agent Inspector Card",
    bucket: "studies",
    surface: "macos",
    family: "agent-cards",
    status: "draft",
    source: ["apps/macos/Sources/Scout/ScoutRootView.swift"],
    blurb: "Per-agent sidebar card — no AVAILABLE tag, header→profile, Observe top-right, New-session CTA explored three ways.",
  },
  {
    href: "/studies/agent-inspector-dm",
    label: "Agent Inspector · contexts",
    bucket: "studies",
    surface: "macos",
    family: "agent-cards",
    status: "concept",
    source: ["apps/macos/Sources/Scout/ScoutRootView.swift"],
    blurb: "One inspector card flexed across the contexts it serves (switch at top): your own DM (one bound session elevated, Engage strip removed, Runtime promoted into a Session block with Traces · Watch · Take over, no Message); an agent↔agent DM (two sides, each its own session, Message returns as Interject); and the agent view with no DM (sessions as a peer list, Message present). The rule that unifies them: Message shows only when you're not already a participant. Includes the Current ↔ Proposed before/after.",
  },
  {
    href: "/studies/agents-tree",
    label: "Agents Tree",
    bucket: "studies",
    surface: "macos",
    family: "agent-cards",
    status: "concept",
    source: [
      "design/studio/app/studies/agents-tree/page.tsx",
      "apps/macos/Sources/Scout/ScoutRootView.swift",
    ],
    blurb: "The Agents view as a project · agent · session tree — keyboard-first (j/k/h/l), inspector follows the cursor.",
  },
  {
    href: "/studies/branch-diff-sheet",
    label: "Branch Diff Sheet",
    bucket: "studies",
    surface: "macos",
    family: "repos",
    status: "concept",
    source: [
      "design/studio/app/studies/branch-diff-sheet/page.tsx",
      "apps/macos/Sources/Scout/ScoutReposView.swift",
    ],
    blurb: "Click a branch → a diff sheet enters from the right or the bottom (one edge-switchable component). Real unified/split diff from commit 807c2d23.",
  },
  {
    href: "/studies/agent-work-preview",
    label: "Agent Work In Progress",
    bucket: "studies",
    surface: "macos",
    family: "agent-cards",
    status: "concept",
    source: [
      "design/studio/app/studies/agent-work-preview/page.tsx",
      "apps/macos/Sources/Scout/ScoutRootView.swift",
    ],
    blurb: "Live activity below the inspector card while an agent works — NOW (Observe), TAIL (this agent), FILES — no drill-down.",
  },
  {
    href: "/studies/agent-session-actions",
    label: "Agent Session Actions",
    bucket: "studies",
    surface: "macos",
    family: "agent-cards",
    status: "concept",
    source: [
      "design/studio/app/studies/agent-session-actions/page.tsx",
      "apps/macos/Sources/Scout/ScoutRootView.swift",
    ],
    blurb: "Sessions as the unit — per-session role + progressive disclosure of Observe/Take over/Fork/Message (⋯); Message/New-session placement top vs end.",
  },
  {
    href: "/studies/agent-inspector-rework",
    label: "Agent Inspector Rework",
    bucket: "studies",
    surface: "macos",
    family: "agent-cards",
    status: "concept",
    source: [
      "design/studio/app/studies/agent-inspector-rework/page.tsx",
      "apps/macos/Sources/Scout/ScoutRootView.swift",
    ],
    blurb: "Drop ENGAGE (Message → composer, Observe → session); + New becomes New session under Sessions; session dot lights only when working, not when selected.",
  },
  {
    href: "/studies/project-session-glance",
    label: "Projects · Session Glance",
    bucket: "studies",
    surface: "web",
    family: "projects",
    status: "draft",
    source: [
      "design/studio/views/project-session-glance.tsx",
      "docs/design/project-session-glance-proposal.md",
      "packages/web/client/screens/projects/ProjectsInbox.tsx",
    ],
    blurb:
      "Two-band selected-session treatment under a stable project header: Band A masthead (Sessions ▸ title · live/idle · one mono meta line) + Band B vitals strip (turns/tools/edits/files · static context bar · collapsed tokens expanding to a legend-below split). Related as reasoned chips (same branch ▸ same agent adjacent ▸ ran alongside), absent when empty. Three scenarios (live cache-heavy codex · ended claude with no usage · worktree-diverged) plus a Narrow 420 width toggle. No sparkline, no left-edge accent bar, no duplicated nav chrome.",
  },
  {
    href: "/studies/session-search",
    label: "Session Search",
    bucket: "studies",
    surface: "web",
    family: "session-search",
    status: "concept",
    source: [
      "design/studio/app/studies/session-search/page.tsx",
      "docs/eng/sco-059-session-knowledge-search-exploration.md",
    ],
    blurb: "Interactive QMD-style pass over six real sessions: files, index rows, queries, and raw drilldown.",
  },
  {
    href: "/studies/terminal-sessions",
    label: "Terminal Sessions",
    bucket: "studies",
    surface: "web",
    family: "runtime",
    status: "concept",
    source: [
      "design/studio/app/studies/terminal-sessions/page.tsx",
      "docs/eng/sco-030-claude-code-tmux-personal-dev-transport.md",
      "docs/eng/sco-031-native-terminal-surfaces.md",
      "packages/web/client/screens/TerminalScreen.tsx",
    ],
    blurb: "Scout-managed terminal sessions: create from Scout, run any command, attach through the relay, and materialize harness sessions through interchangeable terminal surfaces.",
  },
  {
    href: "/studies/workflow-run",
    label: "Workflow Topology Lab",
    bucket: "studies",
    surface: "web",
    family: "workflow-observation",
    status: "concept",
    source: [
      "design/studio/app/studies/workflow-run/page.tsx",
      "packages/agent-sessions/src/adapters/claude-code/workflow-topology.ts",
      "packages/runtime/src/tail/claude-source.ts",
    ],
    blurb: "A live read-only visualization for Claude workflows: parent launch, fan-out workers, journal order, result shape, and topology gaps.",
  },
  {
    href: "/studies/data",
    label: "Session DB Explorer",
    bucket: "studies",
    surface: "web",
    family: "session-search",
    status: "concept",
    source: [
      "design/studio/app/studies/data/page.tsx",
      "design/studio/lib/studio/commands/inspect-db.ts",
    ],
    blurb: "Read-only window into the session-search index.db — schema, FTS5 MATCH, ad-hoc SELECT, schema-aware shortcuts.",
  },
  {
    href: "/studies/search-results",
    label: "Search Results",
    bucket: "studies",
    surface: "web",
    family: "session-search",
    status: "concept",
    source: [
      "design/studio/app/studies/search-results/page.tsx",
      "packages/web/client/screens/KnowledgeSearchScreen.tsx",
      "packages/web/client/screens/KnowledgeSearchInspector.tsx",
      "docs/eng/reviews/knowledge-search-redesign-dewey.md",
    ],
    blurb: "Result-experience redesign: session cards, conversation-first inspector, rendered vs raw, ranking, next actions.",
  },
  {
    href: "/studies/tree-viewer",
    label: "Tree Viewer",
    bucket: "studies",
    surface: "web",
    family: "tree-viewer",
    status: "draft",
    source: ["design/studio/lib/repo-tree.ts"],
    blurb: "Collapsible directory tree — live walk of docs/eng, plans, design/studio/app.",
  },
  {
    href: "/studies/file-card",
    label: "File Card",
    bucket: "studies",
    surface: "web",
    family: "file-card",
    status: "draft",
    source: ["design/studio/components/FileCard.tsx"],
    blurb: "At-a-glance file metadata in three sizes; real repo files.",
  },
  {
    href: "/studies/file-explorer",
    label: "File Explorer",
    bucket: "studies",
    surface: "web",
    family: "file-explorer",
    status: "concept",
    source: [
      "design/studio/app/studies/file-explorer/page.tsx",
      "design/studio/components/FileExplorerWorkspace.tsx",
    ],
    blurb: "Split-pane composition: tree + breadcrumb + excerpt + outline.",
  },
  {
    href: "/studies/agent",
    label: "Agent Vocabulary",
    bucket: "studies",
    surface: "web",
    family: "agent-vocabulary",
    status: "draft",
    source: [
      "design/studio/app/studies/agent/page.tsx",
      "design/studio/components/AgentRow.tsx",
      "design/studio/components/AgentCard.tsx",
    ],
    blurb: "Presence dot · row · card · mention · stats · alert · mesh.",
  },
  {
    href: "/studies/choreography",
    label: "Choreography",
    bucket: "studies",
    surface: "web",
    family: "choreography",
    status: "concept",
    source: ["design/studio/app/studies/choreography/page.tsx"],
    blurb: "The fleet as a score — voices, notes, silences, cross-voice arcs.",
  },
  {
    href: "/studies/arrangements",
    label: "Arrangements",
    bucket: "studies",
    surface: "web",
    family: "choreography",
    status: "concept",
    source: ["design/studio/app/studies/arrangements/page.tsx"],
    blurb: "Structural companion to Choreography — agents wired as a schematic; gallery, anatomy, compose, in-flight.",
  },
  {
    href: "/studies/standing-watch",
    label: "Standing Watch",
    bucket: "studies",
    surface: "web",
    family: "standing-watch",
    status: "concept",
    source: ["design/studio/app/studies/standing-watch/page.tsx"],
    blurb: "The mesh as a sonar scope — heading carries node, distance carries recency.",
  },
  {
    href: "/studies/almanac",
    label: "Almanac",
    bucket: "studies",
    surface: "web",
    family: "almanac",
    status: "concept",
    source: ["design/studio/app/studies/almanac/page.tsx"],
    blurb: "The broker's overnight as a printed morning brief — three columns, in italic.",
  },
  {
    href: "/studies/telegraph",
    label: "Telegraph",
    bucket: "studies",
    surface: "web",
    family: "ticker",
    status: "concept",
    source: [
      "design/studio/app/studies/telegraph/page.tsx",
      "design/studio/components/Ticker.tsx",
    ],
    blurb: "Single-line printer-tape strip. Ambient. Dots, dashes, agent hues, scrolls all day.",
  },
  {
    href: "/studies/ticker",
    label: "Ticker · Quick Steer",
    bucket: "studies",
    surface: "web",
    family: "ticker",
    status: "concept",
    source: [
      "design/studio/app/studies/ticker/page.tsx",
      "design/studio/components/Ticker.tsx",
      "design/studio/components/QuickSteer.tsx",
    ],
    blurb: "Reusable activity stream. Passive + steer modes; hover-to-pause, click-to-commit.",
  },
  {
    href: "/studies/ticker-interactions",
    label: "Ticker · Interactions",
    bucket: "studies",
    surface: "web",
    family: "ticker",
    status: "concept",
    source: [
      "design/studio/app/studies/ticker-interactions/page.tsx",
      "design/studio/components/QuickSteer.tsx",
    ],
    blurb: "Static frame-by-frame of every interaction state — storyboard, kinds, dock states, anatomy.",
  },
  {
    href: "/studies/operator-brief",
    label: "Operator Brief & Handoff",
    bucket: "studies",
    surface: "web",
    family: "operator-brief",
    status: "concept",
    source: [
      "design/studio/app/studies/operator-brief/page.tsx",
      "design/studio/components/QuickSteer.tsx",
    ],
    blurb: "The full arc: kickoff brief → check-in cadence (4 stations) → debrief → continuity.",
  },
  {
    href: "/studies/brief-author",
    label: "Brief Author",
    bucket: "studies",
    surface: "web",
    family: "operator-brief",
    status: "concept",
    source: [
      "design/studio/app/studies/brief-author/page.tsx",
      "design/studio/components/QuickSteer.tsx",
    ],
    blurb: "Two-pane composer — typed-slot chunks on the left, the rendered brief on the right.",
  },
  {
    href: "/studies/hud-chrome",
    label: "HUD Chrome",
    bucket: "studies",
    surface: "web",
    family: "hud",
    status: "concept",
    source: [
      "design/studio/app/studies/hud-chrome/page.tsx",
      "design/studio/components/hud/HudGlyphRail.tsx",
      "design/studio/components/hud/HudCapsule.tsx",
      "design/studio/components/hud/HudGroundControl.tsx",
    ],
    blurb: "Floating glass chrome over edge-to-edge content; Telegraph at the bottom.",
  },
  {
    href: "/studies/hud-native",
    label: "HUD Native",
    bucket: "studies",
    surface: "macos",
    family: "hud",
    status: "concept",
    source: ["design/studio/app/studies/hud-native/page.tsx"],
    blurb: "Glass pop-out from the menu bar — hotkey-summoned fleet glance over any window.",
  },
  {
    href: "/studies/assistant",
    label: "Assistant · Compose",
    bucket: "studies",
    surface: "macos",
    family: "hud",
    status: "shipped",
    source: [
      "apps/macos/Sources/HUD/HUDDockState.swift",
      "apps/macos/Sources/Services/HudComposeService.swift",
      "apps/macos/Sources/HUD/HudMessageDock.swift",
    ],
    blurb: "Optimistic send — field clears on intent, echo lands immediately, network resolves in the background.",
  },
  {
    href: "/studies/hud",
    label: "HUD",
    bucket: "studies",
    surface: "macos",
    family: "hud",
    status: "concept",
    source: [
      "design/studio/app/studies/hud/page.tsx",
      "design/studio/components/hud/index.ts",
      "apps/macos/Sources/HUD/HUDStatusView.swift",
      "apps/macos/Sources/HUD/HUDTailView.swift",
      "apps/macos/Sources/HUD/HUDSessionsView.swift",
      "apps/macos/Sources/HUD/HUDChrome.swift",
    ],
    blurb: "Canonical interactive HUD — switchable size (compact/medium/large) × tab (fleet/observe/tail/sessions). Supersedes the locked stacked studies.",
  },
  {
    href: "/studies/hud-compact",
    label: "HUD Compact",
    bucket: "studies",
    surface: "macos",
    family: "hud",
    status: "concept",
    source: [
      "design/studio/app/studies/hud-compact/page.tsx",
      "design/studio/components/hud/index.ts",
      "apps/macos/Sources/HUD/HUDStatusView.swift",
      "apps/macos/Sources/HUD/HUDTailView.swift",
      "apps/macos/Sources/HUD/HUDSessionsView.swift",
      "apps/macos/Sources/HUD/HUDChrome.swift",
    ],
    blurb: "Locked reference at the compact size (420 × 520). All four tabs (fleet/observe/tail/sessions) stacked for one-pass review.",
  },
  {
    href: "/studies/hud-medium",
    label: "HUD Medium",
    bucket: "studies",
    surface: "macos",
    family: "hud",
    status: "concept",
    source: [
      "design/studio/app/studies/hud-medium/page.tsx",
      "design/studio/components/hud/index.ts",
    ],
    blurb: "Locked reference at the medium size (680 × 640). 2-up fleet tiles, wider observe dispatch, firehose tail, session cards with pane peek.",
  },
  {
    href: "/studies/hud-large",
    label: "HUD Large",
    bucket: "studies",
    surface: "macos",
    family: "hud",
    status: "concept",
    source: [
      "design/studio/app/studies/hud-large/page.tsx",
      "design/studio/components/hud/index.ts",
    ],
    blurb: "Locked reference at the large size (900 × 720). Single-column fleet rows again at full width; observe with stacked time gutter, firehose tail, pane peek.",
  },
  {
    href: "/studies/role-builder",
    label: "Role Builder",
    bucket: "studies",
    surface: "web",
    family: "role-builder",
    status: "concept",
    source: ["design/studio/app/studies/role-builder/page.tsx"],
    blurb: "Roles as dossiers; construction as a bench. Skills · tools · context · permissions.",
  },

  // ── Atoms ───────────────────────────────────────────────────────
  {
    href: "/atoms",
    label: "Atoms Index",
    bucket: "atoms",
    status: "shipped",
    blurb: "Live-rendered scout/web primitives.",
  },
  {
    href: "/atoms/inspector-section",
    label: "InspectorSection",
    bucket: "atoms",
    family: "inspector-atoms",
    status: "draft",
    source: ["design/studio/app/atoms/inspector-section/page.tsx"],
    blurb: "Proposed Tier-1 atom from the inspector-bar audit.",
  },
  {
    href: "/atoms/message-composer",
    label: "MessageComposer",
    bucket: "atoms",
    family: "message-composer",
    status: "in-flight",
    source: [
      "design/studio/components/MessageComposer.tsx",
      "design/studio/app/atoms/message-composer/page.tsx",
      "packages/web/client/components/MessageComposer/MessageComposer.tsx",
      "packages/web/client/screens/home/content.tsx",
      "packages/web/client/screens/chat/ConversationComposer.tsx",
    ],
    blurb:
      "Classic chat input: shell · textarea · send bottom-right · optional header/footer. Shared by home quiet-start and conversation threads.",
  },

  {
    href: "/studies/scout-one-system",
    label: "One System",
    bucket: "studies",
    surface: "cross",
    family: "one-system",
    status: "draft",
    source: [
      "design/studio/views/scout-one-system.tsx",
      "apps/macos/Sources/Scout/ScoutTheme.swift",
      "apps/ios/Scout/Theme.swift",
    ],
    blurb:
      "Scout ships four visual dialects today — main-window indigo (themable, 5×5), the HUD lime broadsheet, the menu-bar green, and iOS emerald (dark-locked). One System keeps each platform's depth idiom (flat ruled panels on desktop, raised cards on phone, the broadsheet HUD) and unifies the grammar: sprite identity, status vocabulary, hand-drawn icon language, and theme inheritance — a paired phone adopts the Mac's theme. Current ⇄ One System flips both platforms; a ledger maps every proposal to ship/refine/defer.",
  },
  {
    href: "/studies/scout-green-question",
    label: "The Green Question",
    bucket: "studies",
    surface: "cross",
    family: "one-system",
    status: "draft",
    source: [
      "design/studio/views/scout-green-question.tsx",
      "apps/macos/Sources/ScoutHUD/HUDChrome.swift",
      "apps/macos/Sources/ScoutMenu/Views/Theme.swift",
    ],
    blurb:
      "Settles the open brand call left by One System (its deferred Row 6): Scout ships three near-neighbor greens — HUD lime #94E36B, menu-bar green #6DDB8C, iOS/web emerald #10B981. Should they converge on one green (and which), or follow the user's chosen accent instead? A comparison matrix — three signal surfaces (HUD · menu · iOS card) down × four treatments (Current · One green·Emerald · One green·Lime · Follow accent) across — with the brand-constant vs. default-accent tension named, a cost ledger against the real palette constants, and a VERDICT slot left to the owner.",
  },

  // ── Meta ────────────────────────────────────────────────────────
  {
    href: "/",
    label: "Overview",
    bucket: "meta",
    status: "shipped",
    blurb: "Landing — every plan, study, and atom in one list.",
  },
  {
    href: "/meta/routes",
    label: "Route Inventory",
    bucket: "meta",
    status: "draft",
    source: [
      "design/studio/app/meta/routes/page.tsx",
      "packages/web/client/lib/router.ts",
      "packages/web/client/router/tanstack/route-tree.ts",
      "packages/web/client/scout/topNavConfig.ts",
      "packages/web/client/scout/secondaryNavConfig.ts",
    ],
    blurb: "Every app page, canonical URL shape, compatibility route, and component-offered navigation target.",
  },
];

/** Find the registry entry for a route. */
export function pageForPath(
  pathname: string | null,
  extra: StudioPage[] = [],
): StudioPage | undefined {
  if (!pathname) return undefined;
  const all = [...STUDIO_PAGES, ...extra];
  return all.find((p) => p.href === pathname);
}

export function insertionPointForId(id: string): StudioInsertionPoint | undefined {
  return STUDIO_INSERTION_POINTS.find((point) => point.id === id);
}

export function studiesForInsertionPoint(
  anchor: string,
  extra: StudioPage[] = [],
): StudioPage[] {
  return [...STUDIO_PAGES, ...extra].filter((page) => page.target?.anchor === anchor);
}

export function studyForInsertionPoint(
  anchor: string,
  extra: StudioPage[] = [],
): StudioPage | undefined {
  return studiesForInsertionPoint(anchor, extra)[0];
}

/** All pages in a bucket. */
export function pagesIn(
  bucket: StudioBucket,
  extra: StudioPage[] = [],
): StudioPage[] {
  return [...STUDIO_PAGES, ...extra].filter((p) => p.bucket === bucket);
}

/** Pages within a bucket grouped by surface; surfaces appear in
 *  web → ios → macos → shell → cross order regardless of registry
 *  order. */
export function pagesBySurface(
  bucket: StudioBucket,
  extra: StudioPage[] = [],
): Array<{ surface: StudioSurface; pages: StudioPage[] }> {
  const order: StudioSurface[] = ["web", "ios", "macos", "shell", "cross"];
  const bySurface = new Map<StudioSurface, StudioPage[]>();
  for (const p of pagesIn(bucket, extra)) {
    const s = (p.surface ?? "cross") as StudioSurface;
    const list = bySurface.get(s) ?? [];
    list.push(p);
    bySurface.set(s, list);
  }
  return order
    .map((surface) => ({ surface, pages: bySurface.get(surface) ?? [] }))
    .filter((g) => g.pages.length > 0);
}

/** Family grouping — primary first, variants nested. The first page
 *  added to a family is the primary; the rest become variants. */
export function familyGroups(pages: StudioPage[]): Array<{
  primary: StudioPage;
  variants: StudioPage[];
}> {
  const groups: Array<{ primary: StudioPage; variants: StudioPage[] }> = [];
  const byFamily = new Map<string, number>();
  for (const p of pages) {
    const fam = p.family ?? p.label;
    const existing = byFamily.get(fam);
    if (existing === undefined) {
      groups.push({ primary: p, variants: [] });
      byFamily.set(fam, groups.length - 1);
    } else {
      groups[existing].variants.push(p);
    }
  }
  return groups;
}

export function surfaceLabel(surface: StudioSurface): string {
  switch (surface) {
    case "web":
      return "Web";
    case "ios":
      return "iOS";
    case "macos":
      return "macOS";
    case "shell":
      return "Shell";
    case "cross":
      return "Cross";
  }
}

export function bucketLabel(bucket: StudioBucket): string {
  switch (bucket) {
    case "plans":
      return "Plans";
    case "eng":
      return "Engineering";
    case "foundations":
      return "Foundations";
    case "studies":
      return "Studies";
    case "atoms":
      return "Atoms";
    case "meta":
      return "Meta";
  }
}
