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

import { createRegistry, type StudioPage as SharedStudioPage } from "studio/registry";

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

/**
 * A studio page — now the shared generic from `studio/registry`, bound to
 * this app's Bucket/Surface/Status unions. Same fields as before (href,
 * label, bucket, family?, surface?, status?, source?, blurb?, updatedAt?).
 */
export type StudioPage = SharedStudioPage<StudioBucket, StudioSurface, StudioStatus>;

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
    href: "/studies/web-taxonomy",
    label: "Web Taxonomy",
    bucket: "studies",
    surface: "web",
    family: "navigation",
    status: "shipped",
    source: [
      "design/studio/app/studies/web-taxonomy/page.tsx",
      "design/studio/lib/web-taxonomy.ts",
      "packages/web/client/scout/topNavConfig.ts",
      "packages/web/client/scout/secondaryNavConfig.ts",
    ],
    blurb:
      "Interactive map of packages/web/client (66 surfaces, 6 areas): a live main-nav → sub-nav header, global search, and a pin board for side-by-side comparison + the agent-lens overlap deep-dive. Data from the web-taxonomy agent workflow.",
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

/**
 * Shared registry bound to this app's taxonomy — provides pageForPath /
 * pagesIn / pagesBySurface / familyGroups / bucketLabel / surfaceLabel
 * (see `studio/registry`; behaviour is identical to the hand-written
 * helpers it replaces). The standalone exports below delegate to it so
 * existing call sites keep working unchanged.
 */
export const registry = createRegistry<StudioBucket, StudioSurface, StudioStatus>({
  pages: STUDIO_PAGES,
  surfaceOrder: ["web", "ios", "macos", "shell", "cross"],
  defaultSurface: "cross",
  bucketLabel: (b) =>
    ({
      plans: "Plans",
      eng: "Engineering",
      foundations: "Foundations",
      studies: "Studies",
      atoms: "Atoms",
      meta: "Meta",
    })[b],
  surfaceLabel: (s) =>
    ({ web: "Web", ios: "iOS", macos: "macOS", shell: "Shell", cross: "Cross" })[s],
});

export const pageForPath = registry.pageForPath;
export const pagesIn = registry.pagesIn;
export const pagesBySurface = registry.pagesBySurface;
export const familyGroups = registry.familyGroups;
export const surfaceLabel = registry.surfaceLabel;
export const bucketLabel = registry.bucketLabel;
