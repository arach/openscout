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
  /** ISO mtime — used to sort entries by recency (e.g. the eng bucket's
   *  "Recent 5" sidebar slice). Optional; static registry pages omit it. */
  updatedAt?: string;
}

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
    href: "/studies/inspector-grammar",
    label: "Inspector Grammar",
    bucket: "studies",
    surface: "macos",
    family: "inspector-grammar",
    status: "draft",
    source: [
      "apps/macos/Sources/Scout/ScoutRootView.swift",
      "apps/macos/Sources/Scout/ScoutReposView.swift",
      "apps/macos/Sources/Scout/ScoutTailView.swift",
    ],
    blurb: "The unified right-rail grammar for the Scout macOS inspectors — nine rules (title rule, identity, status badge, section title, key-value, stat callout, description, action row, spacing), the three inspectors rebuilt from the rules, three concrete before/after diffs, and a token map for the native port.",
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
    href: "/studies/workflow-run",
    label: "Workflow Run Brief",
    bucket: "studies",
    surface: "web",
    family: "workflow-observation",
    status: "concept",
    source: [
      "design/studio/app/studies/workflow-run/page.tsx",
      "packages/agent-sessions/src/adapters/claude-code/workflow-topology.ts",
      "packages/runtime/src/tail/claude-source.ts",
    ],
    blurb: "A concrete run brief for a Claude workflow: parent launch, journal, worker outputs, synthesis, and projection gaps.",
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
    href: "/studies/navigation-taxonomy",
    label: "Navigation Taxonomy",
    bucket: "studies",
    surface: "web",
    family: "navigation",
    status: "concept",
    source: [
      "design/studio/app/studies/navigation-taxonomy/page.tsx",
      "packages/web/client/scout/topNavConfig.ts",
      "packages/web/client/components/SecondaryNav.tsx",
      "packages/web/client/lib/router.ts",
    ],
    blurb: "Before/after header model: primary intent, secondary surfaces, and route coverage.",
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

  // ── Meta ────────────────────────────────────────────────────────
  {
    href: "/",
    label: "Overview",
    bucket: "meta",
    status: "shipped",
    blurb: "Landing — every plan, study, and atom in one list.",
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
