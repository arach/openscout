"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  Bot,
  Check,
  Copy,
  ExternalLink,
  Layers,
  MessageSquare,
  Monitor,
  Network,
  Send,
  Shield,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { TerminalSession } from "@/components/terminal-session";
import { ExpandableImage } from "@/components/expandable-image";
import { ScoutConsole } from "@/components/scout-console";
import { MeshFigureSvg } from "@/components/mesh-figure-svg";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";
import { trackCommandCopy, trackCtaClick, trackNavigationClick } from "@/lib/analytics";
import { SCOUT_VERSION } from "@/lib/version";
import openscoutManifest from "../../public/.well-known/scout.json";

type AudienceMode = "general" | "technical" | "agent";
type HumanAudienceMode = Exclude<AudienceMode, "agent">;

type IconCard = {
  icon: LucideIcon;
  title: string;
  description: string;
};

type CapabilityCard = {
  icon: LucideIcon;
  label: string;
  title: string;
  description: string;
};

type CommandStep = {
  command: string;
  label: string;
};

type SurfaceShot = {
  src: string;
  alt: string;
  eyebrow: string;
  title: string;
  description: string;
  imageClassName?: string;
  width?: number;
  height?: number;
};

type IntegrationCard = {
  host: string;
  name: string;
  mark: string;
  repoHref: string;
  pageHref: string;
  description: string;
  install?: string;
};

const navLinks = [
  { label: "How it works", href: "#mesh" },
  { label: "Features", href: "#capabilities" },
  { label: "Apps", href: "#surfaces" },
  { label: "Integrations", href: "#integrations" },
  { label: "Get Started", href: "#get-started" },
  { label: "FAQ", href: "#faq" },
] as const;

const macosDownloadUrl = "https://github.com/arach/openscout/releases/latest/download/OpenScout.dmg";


type ProblemVariant = {
  meshTitle: string;
  meshDescription: string;
  cards: IconCard[];
};

const problemContent: ProblemVariant = {
  meshTitle: "Your agents can't talk to each other.",
  meshDescription:
    "So you copy-paste between sessions, carrying context from one agent to the next by hand. Scout gives them a route to each other.",
  cards: [
    {
      icon: Network,
      title: "Reach any agent, whatever runs it",
      description:
        "Claude Code in one repo, Cursor in another, Codex on a server — Scout gives configured agents broker routes so you can reach them and route work, whatever model or harness each one runs.",
    },
    {
      icon: Monitor,
      title: "One place to see your agents",
      description:
        "See known agents, message reachable peers, and manage broker-owned work across projects from your Mac or your iPhone.",
    },
    {
      icon: Shield,
      title: "Scout-owned work is inspectable",
      description:
        "Messages, asks, flights, and work items created through Scout stay visible instead of disappearing into a terminal you forgot about.",
    },
  ],
};

const technicalMeshPrinciples: IconCard[] = [
  {
    icon: Network,
    title: "Peer mesh",
    description:
      "Agents stay addressable peers on a local broker instead of being forced into brittle parent-child hierarchies.",
  },
  {
    icon: Layers,
    title: "Durable broker state",
    description:
      "Conversation, invocation, flight, delivery, and binding records stay separate and rebuildable after failure.",
  },
  {
    icon: Shield,
    title: "Local-first control plane",
    description:
      "Workspaces, runtimes, launch-agent services, and endpoint identity all live on your machines with inspectable health.",
  },
];

const generalCapabilities: CapabilityCard[] = [
  {
    icon: Activity,
    label: "Flights",
    title: "Delegation with receipts",
    description:
      "Hand work to an agent and the broker opens a flight: a durable record of who was asked, what ran, and how it landed. Restart the broker or pick it up on your phone — the flight, its deliveries, and the thread are still there.",
  },
  {
    icon: Workflow,
    label: "Protocol",
    title: "Speaks ACP",
    description:
      "Scout implements the Agent Client Protocol, so any ACP-compatible editor or client can drive your local agents — open and model-neutral, no lock-in.",
  },
  {
    icon: Bot,
    label: "Mesh",
    title: "Trusted machines can reach each other",
    description:
      "Your laptop, your desktop, your server — Scout can connect trusted peers so one agent can hand off work to another.",
  },
  {
    icon: Workflow,
    label: "Bridges",
    title: "Telegram, voice, webhooks",
    description:
      "New ways to reach your agents plug in as transports. Your conversation model stays the same regardless of how you connect.",
  },
];

const technicalCapabilities: CapabilityCard[] = [
  {
    icon: Workflow,
    label: "Protocol",
    title: "Agent Client Protocol",
    description:
      "A first-class ACP endpoint: ACP clients connect to the local broker to discover, address, and drive agents over the open, model-neutral protocol.",
  },
  {
    icon: MessageSquare,
    label: "Conversations",
    title: "Broker-backed conversations",
    description:
      "Sessions, the TUI, and direct sends stay fast while projecting the same durable broker state.",
  },
  {
    icon: Monitor,
    label: "Surfaces",
    title: "One state, native and web",
    description:
      "Inspect conversations, tasks, flights, machines, and runtime health from the native Mac app or the local web dashboard — same broker state.",
  },
  {
    icon: Workflow,
    label: "Protocol",
    title: "Explicit work records",
    description:
      "Messages, invocations, flights, deliveries, and bindings share one typed contract across every app and agent.",
  },
  {
    icon: Bot,
    label: "Discovery",
    title: "Real agent identities",
    description:
      "Workspace roots, manifests, and runtime discovery map local repos to tracked agents and reachable endpoints.",
  },
  {
    icon: Send,
    label: "Bindings",
    title: "Bridge-ready delivery",
    description:
      "Telegram, voice, webhooks, and future transports attach without forking the core conversation model.",
  },
  {
    icon: Activity,
    label: "Runtime",
    title: "Observable delivery",
    description:
      "Queued work, running flights, ownership, failures, and recoverable state stay visible instead of disappearing into terminals.",
  },
];

const hostIntegrations: IntegrationCard[] = [
  {
    host: "Codex",
    name: "Codex Scout",
    mark: "CX",
    repoHref: "https://github.com/arach/codex-scout",
    pageHref: "https://arach.github.io/codex-scout/",
    description:
      "Codex plugin for Scout MCP tools, agent discovery, direct messages, and ask-style work handoffs.",
    install: "/plugin marketplace add arach/codex-scout",
  },
  {
    host: "Claude Code",
    name: "Claude Scout",
    mark: "CL",
    repoHref: "https://github.com/arach/claude-scout",
    pageHref: "https://arach.github.io/claude-scout/",
    description:
      "Claude Code plugin with /scout:* commands and a Scout channel for broker-routed messages.",
    install: "/plugin marketplace add arach/claude-scout",
  },
  {
    host: "pi",
    name: "Pi Scout",
    mark: "PI",
    repoHref: "https://github.com/arach/pi-scout",
    pageHref: "https://arach.github.io/pi-scout/",
    description:
      "pi extension for Scout send, ask, who, and broker-backed coordination from pi sessions.",
    install: "pi install git:github.com/arach/pi-scout",
  },
  {
    host: "Hermes Agent",
    name: "Hermes Scout",
    mark: "HS",
    repoHref: "https://github.com/arach/hermes-scout",
    pageHref: "https://github.com/arach/hermes-scout",
    description:
      "Hermes plugin that exposes Scout MCP tools for identity, messaging, asks, replies, and work updates.",
    install: "hermes plugins install arach/hermes-scout",
  },
  {
    host: "Cursor",
    name: "Cursor Scout",
    mark: "CU",
    repoHref: "https://github.com/arach/cursor-scout",
    pageHref: "https://arach.github.io/cursor-scout/",
    description:
      "Cursor MCP configuration and installer that points Cursor at scout mcp, so Cursor can discover, message, and hand off work to agents on the local broker.",
  },
];

type FaqEntry = {
  question: string;
  answer: string;
};

const faqEntries: FaqEntry[] = [
  {
    question: "What does the broker actually do?",
    answer:
      "It is a local service that keeps durable records of agent coordination: messages, invocations, flights, deliveries, and bindings. It routes those records between addressable agents and rebuilds surfaces from stored state instead of terminal scrollback, so work survives restarts and handoffs.",
  },
  {
    question: "Does anything leave my machine?",
    answer:
      "No. The broker and Scout-owned state run locally, and solo and mesh use require zero outside contact. Remote device access is opt-in: pairing and mesh forwarding are explicit actions, and an optional oscout.net front door (OpenScout-owned, Cloudflare-hosted) exists only for off-network reachability when you choose it.",
  },
  {
    question: "Which harnesses work today?",
    answer:
      "Thin host packages connect Claude Code, Codex, Cursor, pi, and Hermes to the same broker. Each is installed on its own and talks to the local broker over the published CLI and protocol, so adding one joins that agent to the mesh without forking the runtime.",
  },
  {
    question: "Do I need the Mac app?",
    answer:
      "No. The CLI is the complete runtime and ships the local web dashboard for fleet, agent, and mesh views. The Mac menu-bar app and the iPhone app are optional surfaces over the same broker state.",
  },
  {
    question: "How is this different from a pile of terminals?",
    answer:
      "Terminals and tmux give you panes, not records. Scout makes agents addressable peers, keeps conversation and work as durable typed records you can inspect, routes work between agents, and gives you one place to watch and steer instead of copy-pasting between windows.",
  },
  {
    question: "What is the maturity and license story?",
    answer:
      "OpenScout is an experimental local-first prototype in active v0.x development, built for high-trust local developer pilots — not enterprise, compliance, or multi-tenant use. There is no top-level license file yet and package manifests are UNLICENSED, so the license posture is pending; do not infer reuse rights.",
  },
  {
    question: "What do I install first?",
    answer:
      "Scout runs on Bun, so install that first, then add the CLI with one command. Run scout setup to materialize local settings, discover projects, register agents, and bring the broker online, then scout doctor to confirm it is reachable.",
  },
];

const getStartedCommandsByAudience: Record<HumanAudienceMode, CommandStep[]> = {
  general: [
    {
      command: "bun add -g @openscout/scout",
      label: "Install the CLI package.",
    },
    {
      command: "scout setup",
      label:
        "Discovers local projects and configured agents it can see. Brings the local broker online.",
    },
    {
      command: "scout doctor",
      label: "Verify the broker is installed and reachable.",
    },
  ],
  technical: [
    {
      command: "bun add -g @openscout/scout",
      label: "Install the CLI package.",
    },
    {
      command: "scout setup",
      label:
        "Auto-discovers projects, registers agents, materializes local settings, and starts the broker.",
    },
    {
      command: "scout doctor",
      label:
        "Verify broker health before sending messages or asking agents to work.",
    },
  ],
};

const surfaceGalleryByAudience: Record<HumanAudienceMode, SurfaceShot[]> = {
  general: [
    {
      src: "/scout/ios-thread.png",
      alt: "Scout iOS app — agent conversation thread on iPhone.",
      eyebrow: "iPhone",
      title: "Mobile",
      description:
        "Pair your iPhone once and the full Scout experience is on your phone. Read agent context, send instructions, and stay in the loop — same broker state, different screen.",
    },
    {
      src: "/mac/hud-agents-roster.png",
      alt: "Scout macOS menu-bar HUD — agents roster listing reachable agents with availability, host runtime, and current work.",
      eyebrow: "Mac",
      title: "Menu-bar HUD",
      description:
        "The native menu-bar cockpit. A one-key operator HUD with a live roster of every reachable agent — availability, the host it answers on, and what it's working on — over the same local broker.",
      width: 606,
      height: 566,
      imageClassName: "aspect-[606/566] w-full object-cover object-top",
    },
    {
      src: "/relay/home-command-center.png",
      alt: "Scout web fleet briefing with active asks, online agents, and current work.",
      eyebrow: "Web",
      title: "Fleet briefing",
      description:
        "A clean developer brief for active asks, work in flight, fleet activity, and the next thing that needs you.",
    },
    {
      src: "/relay/agents-overview.png",
      alt: "Scout web agent profile with workspace, branch, active task, and activity.",
      eyebrow: "Web",
      title: "Agent profile",
      description:
        "Open any agent and inspect its workspace, branch, work, current task, and recent history without leaving the app.",
    },
    {
      src: "/relay/sessions-index.png",
      alt: "Scout web sessions index with channels, direct messages, and groups.",
      eyebrow: "Web",
      title: "Sessions",
      description:
        "Scan every direct message, group thread, and channel from one broker-backed conversation index.",
    },
    {
      src: "/relay/thread-view.png",
      alt: "Scout web direct conversation thread between the developer and Atlas.",
      eyebrow: "Web",
      title: "Conversation thread",
      description:
        "Keep the real work in one durable thread with replies, status updates, and follow-up instructions in context.",
    },
    {
      src: "/relay/machines-view.png",
      alt: "Scout web mesh topology and broker health view.",
      eyebrow: "Web",
      title: "Mesh",
      description:
        "Inspect broker identity, discoverability, peer topology, and health from the same developer surface.",
    },
    {
      src: "/relay/ops-war-room.png",
      alt: "Scout web war room with blockers, live stream, mesh graph, and fleet load.",
      eyebrow: "Web",
      title: "War Room",
      description:
        "Escalate from message inboxes into a live operations view for blockers, asks, fleet load, and event flow.",
    },
  ],
  technical: [
    {
      src: "/scout/ios-thread.png",
      alt: "Scout iOS app — agent conversation thread on iPhone.",
      eyebrow: "iPhone",
      title: "Mobile",
      description:
        "The full broker state on your phone. Conversations, agent context, and work records project from the same local source of truth.",
    },
    {
      src: "/mac/hud-agents-roster.png",
      alt: "Scout macOS menu-bar HUD — agents roster listing reachable peers with presence, host runtime, and current work.",
      eyebrow: "Mac",
      title: "Menu-bar HUD",
      description:
        "The native menu-bar cockpit. Slots for agents, activity, tail, sessions, and assistant; the roster lists every reachable peer with presence, host runtime, and current work.",
      width: 606,
      height: 566,
      imageClassName: "aspect-[606/566] w-full object-cover object-top",
    },
    {
      src: "/relay/home-command-center.png",
      alt: "Scout web fleet briefing with active asks, online agents, and live work.",
      eyebrow: "Web",
      title: "Fleet briefing",
      description:
        "A top-level developer read across asks, work in flight, fleet activity, and online agent presence.",
    },
    {
      src: "/relay/agents-overview.png",
      alt: "Scout web agent profile with active task, work item, and runtime identity.",
      eyebrow: "Web",
      title: "Agent profile",
      description:
        "Inspect runtime identity, branch, active work, capability badges, and recent activity for any addressable agent.",
    },
    {
      src: "/relay/sessions-index.png",
      alt: "Scout web sessions index with channels, direct messages, and group threads.",
      eyebrow: "Web",
      title: "Sessions",
      description:
        "Browse broker-backed conversations as durable, inspectable records instead of terminal output.",
    },
    {
      src: "/relay/thread-view.png",
      alt: "Scout web direct conversation thread showing developer instructions and agent updates.",
      eyebrow: "Web",
      title: "Conversation thread",
      description:
        "Review the actual collaboration record with direct instructions, status messages, and follow-up context in one place.",
    },
    {
      src: "/relay/machines-view.png",
      alt: "Scout web mesh topology and broker health screen.",
      eyebrow: "Web",
      title: "Mesh",
      description:
        "Inspect broker identity, reachability, peer counts, topology, and health notices as live infrastructure state.",
    },
    {
      src: "/relay/ops-war-room.png",
      alt: "Scout web war room with blockers, live stream, graph, and fleet metrics.",
      eyebrow: "Web",
      title: "War Room",
      description:
        "A real-time ops view for unresolved asks, blockers, mesh shape, live stream activity, and fleet load.",
    },
  ],
};

const audienceContent: Record<
  HumanAudienceMode,
  {
    meshEyebrow: string;
    meshTitle: string;
    meshDescription: string;
    capabilitiesTitle: string;
    capabilitiesDescription: string;
    surfacesTitle: string;
    surfacesDescription: string;
    surfacesNoteTitle: string;
    surfacesNoteDescription: string;
    getStartedTitle: string;
    getStartedDescription: string;
  }
> = {
  general: {
    meshEyebrow: "The Problem",
    meshTitle: "Your agents can't talk to each other.",
    meshDescription:
      "So you copy-paste between sessions, carrying context from one agent to the next by hand. Scout gives them a route to each other.",
    capabilitiesTitle: "Agents do the work. You own the record.",
    capabilitiesDescription:
      "Work routed through Scout becomes typed records the broker keeps: messages, invocations, flights, deliveries. They survive restarts and handoffs, so you read what an agent actually did instead of scrolling for it.",
    surfacesTitle: "One conversation, wherever you are.",
    surfacesDescription:
      "The local web dashboard is the deep developer surface — fleet views, agent profiles, sessions, threads, mesh health, and ops. The native Mac app keeps Scout present in your menu bar. Scout on your iPhone is a full app, not a notification viewer. Same broker state, different screen.",
    surfacesNoteTitle: "Native, web, and phone.",
    surfacesNoteDescription:
      "Heavy inspection in the web dashboard. Scout always within reach in the Mac menu bar. Light touches on the phone — approve a PR, redirect an agent, scan the activity, then put it down. Scout keeps your place across all three.",
    getStartedTitle: "One command path. Local broker.",
    getStartedDescription:
      "Install the CLI, run setup, and Scout brings up the local broker. Mac and iPhone apps are optional surfaces over the same runtime.",
  },
  technical: {
    meshEyebrow: "The Mesh",
    meshTitle: "A mesh of peers, not a rigid hierarchy.",
    meshDescription:
      "Scout connects you and your agents through a local broker. Reachable agents can talk to you and to each other. Scout-owned conversations, invocations, flights, and deliveries stay durable, observable, and recoverable.",
    capabilitiesTitle: "One broker, one state model across apps.",
    capabilitiesDescription:
      "Typed records, developer views, and bridge transports all project the same durable state — from the TUI, the Mac app, the web dashboard, or your phone.",
    surfacesTitle: "Terminal, native, web, iPhone — same broker state.",
    surfacesDescription:
      "The TUI gives you fast reads on sessions and active agents. The local web dashboard adds fleet briefing, agent, thread, mesh, and ops surfaces on the same broker model. The native Mac app keeps Scout in the menu bar; Scout iOS gives you the same state on the go.",
    surfacesNoteTitle: "Developer path",
    surfacesNoteDescription:
      "Start in the TUI for the quickest read on sessions and agents. Move into the web dashboard, the native Mac app, and Scout iOS without losing the underlying broker context.",
    getStartedTitle: "One command path. Local broker.",
    getStartedDescription:
      "Install the CLI, run setup, and Scout brings up the local broker. Mac and iPhone apps are optional surfaces over the same runtime.",
  },
};

/* ──────────────────────────────────────────────────────────
   Machine-readable manifest layer (agent-first DOM)
   ────────────────────────────────────────────────────────── */

const SCHEMA_ORG_LD = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "OpenScout",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "macOS, Linux",
  softwareVersion: SCOUT_VERSION,
  url: "https://openscout.app",
  codeRepository: "https://github.com/arach/openscout",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
} as const;

const OPENSCOUT_PROTOCOL_LD = {
  "@context": { openscout: "https://openscout.app/ns#" },
  "@type": "openscout:Protocol",
  "openscout:version": "Ø.1",
  "openscout:status": "experimental",
  "openscout:recordTypes": ["Message", "Invocation", "Flight", "Delivery", "Binding"],
  "openscout:transports": ["local", "telegram", "voice", "webhook"],
  "openscout:referenceImplementation": "https://github.com/arach/openscout",
} as const;

const OPENSCOUT_SELF_MANIFEST = openscoutManifest;

/* ──────────────────────────────────────────────────────────
   RFC install — inline, document-styled command line
   ────────────────────────────────────────────────────────── */

function RfcInstall({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    navigator.clipboard.writeText(command);
    trackCommandCopy({ command, location: "hero_rfc_install" });
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      className={`rfc-hero__install ${copied ? "rfc-hero__install--copied" : ""}`}
      aria-label="Copy install command"
    >
      <span className="rfc-hero__install-prompt">$</span>
      <span>{command}</span>
      <span className="rfc-hero__install-copy inline-flex items-center gap-1.5">
        {copied ? (
          <>
            <Check className="h-3 w-3" />
            copied
          </>
        ) : (
          <>
            <Copy className="h-3 w-3" />
            copy
          </>
        )}
      </span>
    </button>
  );
}

function GithubStars() {
  const [stars, setStars] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/stars")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { stars?: number | null } | null) => {
        if (!cancelled && data?.stars != null) {
          setStars(data.stars);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  if (stars == null) return null;
  return (
    <a
      href="https://github.com/arach/openscout/stargazers"
      target="_blank"
      rel="noopener noreferrer"
      className="status-bar__cell status-bar__cell--link hidden md:inline-flex"
    >
      ★&nbsp;<b>{stars}</b>
    </a>
  );
}

function LogoMark({ size = "sm" }: { size?: "sm" | "md" }) {
  const pixelSize = size === "md" ? 32 : 26;
  return (
    <span
      className="flex shrink-0 items-center justify-center text-[var(--site-ink)]"
      style={{ width: pixelSize, height: pixelSize }}
      aria-hidden
    >
      <svg
        viewBox="0 0 32 32"
        width={pixelSize}
        height={pixelSize}
        fill="none"
        stroke="currentColor"
      >
        {/* peer connections */}
        <line x1="16" y1="16" x2="16" y2="6"  strokeWidth="1" opacity="0.45" />
        <line x1="16" y1="16" x2="6"  y2="22" strokeWidth="1" opacity="0.45" />
        <line x1="16" y1="16" x2="26" y2="22" strokeWidth="1" opacity="0.45" />
        {/* peers */}
        <circle cx="16" cy="6"  r="2"   fill="currentColor" stroke="none" />
        <circle cx="6"  cy="22" r="2"   fill="currentColor" stroke="none" />
        <circle cx="26" cy="22" r="2"   fill="currentColor" stroke="none" />
        {/* broker (center) */}
        <circle cx="16" cy="16" r="3.4" fill="currentColor" stroke="none" />
        <circle cx="16" cy="16" r="3.4" fill="none" stroke="var(--site-page-bg)" strokeWidth="1.2" opacity="0.9" />
        <circle cx="16" cy="16" r="2"   fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}

type Viewer = "human" | "agent";

function ViewerToggle({
  viewer,
  onChange,
}: {
  viewer: Viewer;
  onChange: (viewer: Viewer) => void;
}) {
  const isAgent = viewer === "agent";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isAgent}
      aria-label="Read this page as an agent"
      onClick={() => onChange(isAgent ? "human" : "agent")}
      className="viewer-toggle"
      data-on={isAgent}
    >
      <span className="viewer-toggle__icon" aria-hidden>
        {/* hand-drawn cute bot — antenna, square head, two eyes, smile */}
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <line x1="10" y1="2" x2="10" y2="4" />
          <circle cx="10" cy="2" r="0.9" fill="currentColor" stroke="none" />
          <rect x="4" y="5" width="12" height="10" rx="2.4" />
          <circle cx="7.5" cy="9" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="12.5" cy="9" r="0.9" fill="currentColor" stroke="none" />
          <path d="M7.5 12.2 Q10 13.4 12.5 12.2" />
          <line x1="3" y1="9" x2="3" y2="11" />
          <line x1="17" y1="9" x2="17" y2="11" />
        </svg>
      </span>
      <span className="viewer-toggle__text">Agent View</span>
      <span className="viewer-toggle__track" aria-hidden>
        <span className="viewer-toggle__knob" />
      </span>
    </button>
  );
}

const heroHeadlines: Record<Viewer, { top: string; bottom: string; sub: string }> = {
  human: {
    top: "Communication for agents.",
    bottom: "Local-first. Model-neutral.",
    sub: "Claude Code, Cursor, Codex — every harness runs its own agents in its own silo. Scout gives them a common layer so they can reach each other, and you can reach them all.",
  },
  agent: {
    top: "Comms platform for agents.",
    bottom: "Agent native.",
    sub: "One install adds the runtime. Register as a peer — nothing else about how your agent runs has to change.",
  },
};

// Spec masthead under the hero install — real protocol facts (mirrors the
// JSON-LD manifest emitted below) that ground the editorial column against the
// taller live console: the page of the spec, beside the running system.
const heroMasthead: { key: string; tokens: string[] }[] = [
  { key: "Protocol", tokens: ["Ø.1", "experimental"] },
  { key: "Records", tokens: ["message", "invocation", "flight", "delivery", "binding"] },
  { key: "Transports", tokens: ["local", "telegram", "voice", "webhook"] },
  { key: "Harnesses", tokens: ["claude", "codex", "cursor", "pi", "hermes"] },
];

const heroInstall: Record<Viewer, { command: string; footnote: string }> = {
  human: {
    command: "bun add -g @openscout/scout",
    footnote: "Local-first. Runs on your machine. Mac and iPhone apps optional.",
  },
  agent: {
    command: "bun add @openscout/runtime",
    footnote: "Local-first. Typed records. Durable across restarts.",
  },
};

export default function Home() {
  const scrollRef = useScrollReveal<HTMLElement>("general");
  const [viewer, setViewer] = useState<Viewer>("human");

  const copy = audienceContent["general"];
  const meshPrinciples = problemContent.cards;
  const capabilities = generalCapabilities;
  const surfaceGallery = surfaceGalleryByAudience["general"];
  const getStartedCommands = getStartedCommandsByAudience["general"];
  const headline = heroHeadlines[viewer];
  const install = heroInstall[viewer];
  const onNavigationClick = (label: string, destination: string, location: string) => () => {
    trackNavigationClick({
      destination,
      label,
      location,
    });
  };
  const onCtaClick = (
    label: string,
    destination: string,
    location: string,
    ctaType: string,
  ) => () => {
    trackCtaClick({
      ctaType,
      destination,
      label,
      location,
    });
  };
  return (
    <div className="site-marketing relative isolate min-h-screen overflow-x-clip bg-[var(--site-page-bg)] text-[var(--site-ink)]">
      {/* ── Operator Console (header) ── */}
      <header className="operator-console">
        {/* main row — wordmark + minimal mono nav + theme toggle */}
        <div className="mx-auto flex max-w-6xl items-center px-6 operator-row">
          <Link
            href="/"
            onClick={onNavigationClick("Scout", "/", "header_logo")}
            className="flex items-center gap-2.5"
          >
            <LogoMark />
            <span className="font-[family-name:var(--font-spectral)] text-lg font-semibold tracking-tight text-[var(--site-ink)]">
              Scout
            </span>
            <span
              className="hidden font-[family-name:var(--font-mono-display)] text-[11px] tracking-tight text-[var(--site-muted)] sm:inline-flex sm:items-baseline sm:gap-1.5"
              aria-hidden
            >
              <span className="text-[var(--site-border-strong)]">·</span>
              the OpenScout broker
            </span>
          </Link>

          <nav className="hidden items-center gap-7 md:flex">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={onNavigationClick(link.label, link.href, "header_nav")}
                className="operator-link"
              >
                <span className="operator-link__sigil">:</span>
                {link.label.toLowerCase().replace(/\s+/g, "-")}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-4">
            <a
              href="https://github.com/arach/openscout"
              target="_blank"
              rel="noopener noreferrer"
              onClick={onCtaClick(
                "GitHub",
                "https://github.com/arach/openscout",
                "header_nav",
                "repo",
              )}
              className="operator-link hidden sm:inline-flex"
            >
              <span className="operator-link__sigil">:</span>github
            </a>
            <Link
              href="/docs"
              onClick={onCtaClick("Read the docs", "/docs", "header_nav", "docs")}
              className="operator-link"
            >
              <span className="operator-link__sigil">:</span>docs
            </Link>
            <Link
              href="/blog"
              onClick={onCtaClick("Read the blog", "/blog", "header_nav", "blog")}
              className="operator-link"
            >
              <span className="operator-link__sigil">:</span>blog
            </Link>
          </div>
        </div>
      </header>

      {/* ── Agent view (replaces everything) ── */}
        <>
          <main ref={scrollRef} className="relative z-10">
            {/* ── Hero (full-width headline, full-width console below) ── */}
            <section className="overflow-hidden pb-8 pt-20 md:pt-28 md:pb-10">
              <div className="mx-auto max-w-6xl px-6">
                <div className="rfc-hero__split">
                  <div className="rfc-hero__editorial hero-animate" style={{ animationDelay: "0s" }}>
                    <h1 className="rfc-hero__title rfc-hero__title--full">
                      <span className="rfc-hero__title-line">{headline.top}</span>
                      <span className="rfc-hero__title-line">{headline.bottom}</span>
                    </h1>

                    <p className="rfc-hero__abstract rfc-hero__abstract--full">{headline.sub}</p>

                    <div className="rfc-hero__install-block">
                      {viewer === "human" && (
                        <p className="rfc-hero__install-pain">
                          Today: one terminal per agent, alt-tabbing to keep up, finished work lost to scrollback.
                        </p>
                      )}
                      <RfcInstall command={install.command} />
                      {viewer === "human" && (
                        <p className="rfc-hero__install-next">
                          <span className="rfc-hero__install-next-label">then</span>
                          <span className="rfc-hero__install-next-prompt">$</span>
                          <span>scout setup</span>
                        </p>
                      )}
                      <p className="rfc-hero__install-foot">{install.footnote}</p>
                      {viewer === "human" && (
                        <a
                          href={macosDownloadUrl}
                          onClick={onCtaClick(
                            "Download for Mac",
                            macosDownloadUrl,
                            "hero",
                            "download",
                          )}
                          className="rfc-hero__mac-link"
                        >
                          Download for Mac
                          <span className="rfc-hero__mac-link-arrow" aria-hidden>↗</span>
                        </a>
                      )}
                      {viewer === "agent" && (
                        <p className="rfc-hero__schema-link">
                          Tool manifest at{" "}
                          <a href="/scout/manifest">
                            /scout/manifest
                          </a>{" "}
                          · raw JSON at{" "}
                          <a href="/.well-known/scout.json">
                            /.well-known/scout.json
                          </a>
                        </p>
                      )}
                    </div>

                    <dl className="rfc-hero__masthead" aria-label="Protocol summary">
                      {heroMasthead.map(({ key, tokens }) => (
                        <div key={key} className="rfc-hero__masthead-row">
                          <dt className="rfc-hero__masthead-key">{key}</dt>
                          <dd className="rfc-hero__masthead-val">
                            {tokens.map((t, i) => (
                              <span key={t} className="rfc-hero__masthead-token">
                                {i > 0 && (
                                  <span className="rfc-hero__masthead-sep" aria-hidden>
                                    ·
                                  </span>
                                )}
                                {t}
                              </span>
                            ))}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>

                  <div className="rfc-hero__console-col hero-animate" style={{ animationDelay: "0.12s" }}>
                    <div className="rfc-hero__viewer-perch">
                      <ViewerToggle viewer={viewer} onChange={setViewer} />
                    </div>
                    <ScoutConsole audience={viewer} />
                    {viewer === "human" && (
                      <div className="rfc-hero__console-caption">
                        <span className="rfc-hero__console-caption-num">Fig. 0 · Thread</span>
                        <span className="rfc-hero__console-caption-meta">
                          atlas hands off, hudson merges pr-1287, the flight closes — you ping echo, it ships.
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Machine-readable manifest layer ── */}
              <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(SCHEMA_ORG_LD) }}
              />
              <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(OPENSCOUT_PROTOCOL_LD) }}
              />
              <script
                type="application/openscout-manifest+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(OPENSCOUT_SELF_MANIFEST) }}
              />
            </section>

            {/* ── §1 Topology ── */}
            <section id="mesh" className="rfc-section">
              <div className="mx-auto grid max-w-6xl gap-x-12 gap-y-10 px-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
                <div className="reveal max-w-sm">
                  <div className="rfc-section-eyebrow">
                    <span className="rfc-section-eyebrow__num">§1</span>
                    <span>Topology</span>
                  </div>
                  <h2 className="rfc-section-title">
                    {problemContent.meshTitle}
                  </h2>
                  <p className="rfc-section-lead">
                    {problemContent.meshDescription}
                  </p>
                </div>

                <div className="reveal">
                  <MeshFigureSvg />
                  <div className="rfc-block-row reveal-stagger grid gap-x-10 gap-y-8 md:grid-cols-2 lg:grid-cols-3">
                    {meshPrinciples.map(({ title, description }, i) => (
                      <div
                        key={title}
                        className="reveal rfc-block"
                        style={{ "--reveal-i": i } as React.CSSProperties}
                      >
                        <div className="rfc-block__num">
                          <span className="rfc-block__num-mark">§1.{i + 1}</span>
                        </div>
                        <h3 className="rfc-block__title">{title}</h3>
                        <p className="rfc-block__body">{description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* ── §2 Records ── */}
            <section id="capabilities" className="rfc-section">
              <div className="mx-auto grid max-w-6xl gap-x-12 gap-y-10 px-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
                <div className="reveal max-w-sm">
                  <div className="rfc-section-eyebrow">
                    <span className="rfc-section-eyebrow__num">§2</span>
                    <span>Records</span>
                  </div>
                  <h2 className="rfc-section-title">
                    {copy.capabilitiesTitle}
                  </h2>
                  <p className="rfc-section-lead">
                    {copy.capabilitiesDescription}
                  </p>
                  <Link
                    href="/docs"
                    onClick={onCtaClick("Browse the docs", "/docs", "capabilities", "docs")}
                    className="group mt-6 inline-flex items-center gap-1.5 font-[family-name:var(--font-mono-display)] text-[12.5px] text-[var(--site-copy)] transition-colors hover:text-[var(--site-ink)]"
                  >
                    <span className="text-[var(--site-muted)]">→</span>
                    <span>browse the docs</span>
                  </Link>
                </div>

                <div className="rfc-block-row reveal-stagger grid gap-x-10 gap-y-8 md:grid-cols-2">
                  {capabilities.map(({ label, title, description }, i) => (
                    <div
                      key={title}
                      className="reveal rfc-block"
                      style={{ "--reveal-i": i } as React.CSSProperties}
                    >
                      <div className="rfc-block__num">
                        <span className="rfc-block__num-mark">§2.{i + 1}</span>{" "}
                        · {label}
                      </div>
                      <h3 className="rfc-block__title">{title}</h3>
                      <p className="rfc-block__body">{description}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* ── §3 Reference Implementation ── */}
            <section id="surfaces" className="rfc-section">
              <div className="mx-auto grid max-w-6xl gap-x-12 gap-y-10 px-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
                <div className="reveal max-w-xl">
                  <div className="rfc-section-eyebrow">
                    <span className="rfc-section-eyebrow__num">§3</span>
                    <span>Reference Implementation</span>
                  </div>
                  <h2 className="rfc-section-title">
                    {copy.surfacesTitle}
                  </h2>
                  <p className="rfc-section-lead">
                    {copy.surfacesDescription}
                  </p>

                  <div className="mt-8 rfc-block">
                    <div className="rfc-block__num">Note</div>
                    <h3 className="rfc-block__title">
                      {copy.surfacesNoteTitle}
                    </h3>
                    <p className="rfc-block__body">
                      {copy.surfacesNoteDescription}
                    </p>
                  </div>
                </div>

                <div className="reveal-stagger grid gap-6 sm:grid-cols-2">
                  {surfaceGallery
                    .filter((s) =>
                      ["Mobile", "Menu-bar HUD", "Conversation thread", "Mesh"].includes(
                        s.title,
                      ),
                    )
                    .map((shot, i) => (
                      <figure
                        key={shot.src}
                        className="reveal rfc-figure"
                        style={{ "--reveal-i": i } as React.CSSProperties}
                      >
                        <ExpandableImage
                          analyticsId={shot.src}
                          analyticsLocation="surfaces_gallery"
                          src={shot.src}
                          alt={shot.alt}
                          width={shot.width ?? 1552}
                          height={shot.height ?? 1092}
                          className={
                            shot.imageClassName ??
                            "aspect-[1552/1092] w-full object-cover object-top"
                          }
                        />
                        <figcaption className="rfc-figure__caption">
                          <div className="rfc-figure__caption-num">
                            Fig. 3.{i + 1} · {shot.eyebrow}
                          </div>
                          <h3 className="rfc-figure__caption-title">
                            {shot.title}
                          </h3>
                          <p className="rfc-figure__caption-body">
                            {shot.description}
                          </p>
                        </figcaption>
                      </figure>
                    ))}
                </div>
              </div>
            </section>

            {/* ── §4 Host Integrations ── */}
            <section id="integrations" className="rfc-section">
              <div className="mx-auto grid max-w-6xl gap-x-12 gap-y-10 px-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
                <div className="reveal max-w-sm">
                  <div className="rfc-section-eyebrow">
                    <span className="rfc-section-eyebrow__num">§4</span>
                    <span>Host Integrations</span>
                  </div>
                  <h2 className="rfc-section-title">
                    Scout where agents already work.
                  </h2>
                  <p className="rfc-section-lead">
                    Developers run agents across vendors, so the coordination layer
                    can&apos;t belong to one of them. Five thin host packages — claude,
                    codex, cursor, pi, and hermes — connect to the same local broker
                    without forking any runtime.
                  </p>
                  <p className="mt-6 font-[family-name:var(--font-mono-display)] text-[12.5px] leading-relaxed text-[var(--site-muted)]">
                    Five host packages today. Each is a thin client over the same
                    broker — install one, and that agent joins the mesh.
                  </p>
                </div>

                <div className="rfc-block-row reveal-stagger grid gap-x-8 gap-y-8 sm:grid-cols-2">
                  {hostIntegrations.map((integration, i) => (
                    <div
                      key={integration.repoHref}
                      className="reveal integration-block group"
                      style={{ "--reveal-i": i } as React.CSSProperties}
                    >
                      <div className="integration-block__header">
                        <span className="integration-block__mark" aria-hidden="true">
                          {integration.mark}
                        </span>
                        <div className="integration-block__heading">
                          <div className="rfc-block__num">
                            <span className="rfc-block__num-mark">§4.{i + 1}</span>{" "}
                            · {integration.host}
                          </div>
                          <h3 className="integration-block__name transition-colors group-hover:text-[var(--site-ink)]">
                            {integration.name}
                          </h3>
                        </div>
                      </div>
                      <p className="rfc-block__body">{integration.description}</p>
                      {integration.install && (
                        <code className="integration-block__install">
                          {integration.install}
                        </code>
                      )}
                      <div className="integration-block__links">
                        <a
                          href={integration.repoHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={onCtaClick(`${integration.name} repo`, integration.repoHref, "integrations", "repo")}
                          className="inline-flex items-center gap-1.5 font-[family-name:var(--font-mono-display)] text-[12px] text-[var(--site-copy)] transition-colors hover:text-[var(--site-ink)]"
                        >
                          <span>Repo</span>
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                        <a
                          href={integration.pageHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={onCtaClick(`${integration.name} page`, integration.pageHref, "integrations", "page")}
                          className="inline-flex items-center gap-1.5 font-[family-name:var(--font-mono-display)] text-[12px] text-[var(--site-copy)] transition-colors hover:text-[var(--site-ink)]"
                        >
                          <span>Page</span>
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* ── §5 Discovery ── */}
            <section id="get-started" className="rfc-section">
              <div className="mx-auto max-w-6xl px-6">
                <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
                  <div className="reveal max-w-sm">
                    <div className="rfc-section-eyebrow">
                      <span className="rfc-section-eyebrow__num">§5</span>
                      <span>Discovery</span>
                    </div>
                    <h2 className="rfc-section-title">
                      {copy.getStartedTitle}
                    </h2>
                    <p className="rfc-section-lead">
                      {copy.getStartedDescription}
                    </p>

                    <div className="mt-8 rfc-block">
                      <div className="rfc-block__num">
                        <span className="rfc-block__num-mark">§5.1</span> · Apps
                      </div>
                      <h3 className="rfc-block__title">Mac and iPhone.</h3>
                      <p className="rfc-block__body">
                        The CLI is the complete runtime, and it ships the local
                        web dashboard for deep fleet, agent, and mesh views. The
                        native Mac app keeps Scout in your menu bar; the iPhone
                        app keeps you in the loop on the go.
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-2 font-[family-name:var(--font-mono-display)] text-[12.5px]">
                        <a
                          href={macosDownloadUrl}
                          onClick={onCtaClick(
                            "Download for macOS",
                            macosDownloadUrl,
                            "get_started",
                            "download",
                          )}
                          className="inline-flex items-center gap-1.5 text-[var(--site-copy)] transition-colors hover:text-[var(--site-ink)]"
                        >
                          <span className="text-[var(--site-muted)]">→</span>
                          <span>download for macOS</span>
                        </a>
                        <a
                          href="https://github.com/arach/openscout"
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={onCtaClick(
                            "Open on GitHub",
                            "https://github.com/arach/openscout",
                            "get_started",
                            "repo",
                          )}
                          className="inline-flex items-center gap-1.5 text-[var(--site-copy)] transition-colors hover:text-[var(--site-ink)]"
                        >
                          <span className="text-[var(--site-muted)]">→</span>
                          <span>open on github</span>
                        </a>
                      </div>
                    </div>
                  </div>

                  <div className="reveal">
                    <TerminalSession
                      analyticsLocation="get_started_terminal"
                      steps={getStartedCommands}
                    />
                  </div>
                </div>
              </div>
            </section>

            {/* ── §6 Questions ── */}
            <section id="faq" className="rfc-section">
              <div className="mx-auto grid max-w-6xl gap-x-12 gap-y-10 px-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
                <div className="reveal max-w-sm">
                  <div className="rfc-section-eyebrow">
                    <span className="rfc-section-eyebrow__num">§6</span>
                    <span>Questions</span>
                  </div>
                  <h2 className="rfc-section-title">
                    What a developer asks before installing.
                  </h2>
                  <p className="rfc-section-lead">
                    Plain answers about scope, data boundary, and maturity. Read
                    these before you make trust or capability claims.
                  </p>
                  <p className="mt-6 font-[family-name:var(--font-mono-display)] text-[12.5px] leading-relaxed text-[var(--site-muted)]">
                    Grounded in the repo docs, not the pitch. When the posture is
                    early, the answer says so.
                  </p>
                </div>

                <div className="rfc-block-row reveal-stagger grid gap-x-10 gap-y-8 md:grid-cols-2">
                  {faqEntries.map(({ question, answer }, i) => (
                    <div
                      key={question}
                      className="reveal rfc-block"
                      style={{ "--reveal-i": i } as React.CSSProperties}
                    >
                      <div className="rfc-block__num">
                        <span className="rfc-block__num-mark">§6.{i + 1}</span>
                      </div>
                      <h3 className="rfc-block__title">{question}</h3>
                      <p className="rfc-block__body">{answer}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </main>

          {/* ── Status footer (Cursor-style IDE status bar) ── */}
          <footer className="status-bar">
            <div className="mx-auto flex max-w-6xl items-stretch px-6">
              <div className="status-bar__inner w-full">
                {/* Left group: identity + broker status */}
                <span className="status-bar__cell">
                  <span className="status-bar__brand">SCOUT/Ø</span>
                </span>
                <span className="status-bar__cell hidden sm:inline-flex">
                  proto&nbsp;<b>Ø.1</b>
                </span>
                <span className="status-bar__cell">
                  <span className="status-dot" aria-hidden />
                  <span>online</span>
                </span>
                <span className="status-bar__cell">
                  <b>v{SCOUT_VERSION}</b>
                </span>
                <span className="status-bar__cell hidden md:inline-flex">
                  license pending
                </span>
                <span className="status-bar__cell hidden md:inline-flex">
                  local
                </span>

                {/* Right group: link cells */}
                <span className="status-bar__zone--right">
                  <GithubStars />
                  <a
                    href="/docs"
                    onClick={onNavigationClick("Docs", "/docs", "footer")}
                    className="status-bar__cell status-bar__cell--link"
                  >
                    <span className="status-bar__sigil">:</span>docs
                  </a>
                  <a
                    href="https://github.com/arach/openscout"
                    onClick={onCtaClick(
                      "GitHub",
                      "https://github.com/arach/openscout",
                      "footer",
                      "repo",
                    )}
                    className="status-bar__cell status-bar__cell--link"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="status-bar__sigil">:</span>github
                  </a>
                  <a
                    href="/privacy"
                    onClick={onNavigationClick("Privacy", "/privacy", "footer")}
                    className="status-bar__cell status-bar__cell--link hidden sm:inline-flex"
                  >
                    <span className="status-bar__sigil">:</span>privacy
                  </a>
                  <a
                    href="https://x.com/arach"
                    onClick={onCtaClick("Twitter", "https://x.com/arach", "footer", "social")}
                    className="status-bar__cell status-bar__cell--link hidden md:inline-flex"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="status-bar__sigil">:</span>twitter
                  </a>
                </span>
              </div>
            </div>
          </footer>
        </>

    </div>
  );
}

/* ═══════════════════════════════════════════════
   Agent View — flat, utilitarian, machine-friendly
   ═══════════════════════════════════════════════ */

const agentResources = [
  { label: "GitHub", href: "https://github.com/arach/openscout" },
  { label: "Docs", href: "/docs" },
  { label: "@openscout/scout", href: "https://github.com/arach/openscout" },
  { label: "@openscout/runtime", href: "https://github.com/arach/openscout" },
  { label: "@openscout/protocol", href: "https://github.com/arach/openscout" },
] as const;

const agentSections = [
  {
    title: "What you can do",
    items: [
      "Send and receive messages through a local broker. Any agent on the mesh can address any other agent directly.",
      "Persist conversations and task state across terminal closes, machine restarts, and handoffs. Your context survives.",
      "Register as a discoverable peer. Other agents and operator surfaces can find you by workspace, manifest, or endpoint.",
      "Receive invocations from operators or other agents. Work arrives as typed records, not raw text piped through stdout.",
    ],
  },
  {
    title: "How to join the mesh",
    items: [
      "Install Bun: `brew install bun`",
      "Install Scout: `bun add -g @openscout/scout`",
      "Bootstrap: `scout setup` — creates local settings, discovers projects, registers agents, starts the broker.",
      "Connect: import `@openscout/runtime` to send messages, create sessions, and listen for invocations programmatically.",
      "Or use the CLI: `scout watch --as myagent` to attach as a named peer from any terminal.",
    ],
  },
  {
    title: "Protocol shape",
    items: [
      "Messages, invocations, flights, deliveries, and bindings are the five record types. All are typed via `@openscout/protocol`.",
      "Agents are peers, not children. No parent-child hierarchy — the broker routes between equals.",
      "Bridges (Telegram, voice, webhooks) attach as transports. Your conversation model stays the same regardless of surface.",
      "State is durable and inspectable. Operator surfaces (Mac app, web dashboard, iPhone) project the same broker state you write to.",
    ],
  },
] as const;

function AgentView({ onExit }: { onExit: () => void }) {
  return (
    <main className="relative z-10 mx-auto max-w-2xl px-6 pt-24 pb-20">
      {/* ── banner ── */}
      <div className="border-b border-[#111110]/10 pb-6">
        <h1 className="font-[family-name:var(--font-spectral)] text-lg font-semibold tracking-tight text-[#111110]">
          Scout
        </h1>
        <p className="mt-2 max-w-lg text-[13px] leading-relaxed text-[#111110]/55">
          Local-first broker for AI agents. Send messages, persist state,
          discover peers, and receive invocations through one runtime on the
          operator&apos;s machine.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          {agentResources.map((r) => (
            <a
              key={r.label}
              href={r.href}
              className="inline-flex items-center gap-1.5 font-[family-name:var(--font-geist-mono)] text-[13px] text-[#111110] transition-colors hover:text-[#111110]/70"
            >
              {r.label}
              <span className="text-[11px] text-[#111110]/30">&#x2197;</span>
            </a>
          ))}
        </div>
      </div>

      {/* ── numbered sections ── */}
      {agentSections.map((section, si) => (
        <div
          key={section.title}
          className="mt-8 border-b border-[#111110]/10 pb-6 last:border-b-0"
        >
          <div className="font-[family-name:var(--font-geist-mono)] text-[11px] font-semibold uppercase tracking-[0.08em] text-[#111110]/40">
            {section.title}
          </div>
          <ol className="mt-3 space-y-2">
            {section.items.map((item, ii) => (
              <li
                key={ii}
                className="flex items-baseline gap-3 text-[13px] leading-relaxed text-[#111110]/70"
              >
                <span className="shrink-0 font-[family-name:var(--font-geist-mono)] text-[12px] font-semibold text-[#111110]/25">
                  {si + 1}.{ii + 1}
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ol>
        </div>
      ))}

      {/* ── quick start ── */}
      <div className="mt-8">
        <div className="font-[family-name:var(--font-geist-mono)] text-[11px] font-semibold uppercase tracking-[0.08em] text-[#111110]/40">
          Quick start
        </div>
        <div className="mt-3 space-y-1.5 font-[family-name:var(--font-geist-mono)] text-[13px] text-[#111110]/60">
          <div>
            <span className="text-[#111110]/30">$ </span>bun add -g
            @openscout/scout
          </div>
          <div>
            <span className="text-[#111110]/30">$ </span>scout setup
          </div>
          <div>
            <span className="text-[#111110]/30">$ </span>scout watch
            --as myagent
          </div>
        </div>
      </div>

      {/* ── back link ── */}
      <button
        type="button"
        onClick={onExit}
        className="mt-10 font-[family-name:var(--font-geist-mono)] text-[12px] text-[#111110]/40 transition-colors hover:text-[#111110]/70"
      >
        ← Back to product view
      </button>
    </main>
  );
}
