"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, ExternalLink } from "lucide-react";
import { TerminalSession } from "@/components/terminal-session";
import { ExpandableImage } from "@/components/expandable-image";
import { LogoMark } from "@/components/logo-mark";
import { ScoutConsole } from "@/components/scout-console";
import { MeshFigureSvg } from "@/components/mesh-figure-svg";
import { SiloDesktop } from "@/components/silo-desktop";
import { SiteThemeToggle } from "@/components/site-theme-toggle";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";
import { trackCommandCopy, trackCtaClick, trackNavigationClick } from "@/lib/analytics";
import { SCOUT_VERSION } from "@/lib/version";
import openscoutManifest from "../../public/.well-known/scout.json";

type AudienceMode = "general" | "technical" | "agent";
type HumanAudienceMode = Exclude<AudienceMode, "agent">;

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
  // Faux window-chrome id rendered above non-phone shots (e.g. "relay · /machines").
  chrome?: string;
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
  { label: "Why Scout", href: "#mesh" },
  { label: "Features", href: "#capabilities" },
  { label: "Apps", href: "#surfaces" },
  { label: "Integrations", href: "#integrations" },
  { label: "Get Started", href: "#get-started" },
  { label: "FAQ", href: "#faq" },
] as const;

const macosDownloadUrl = "https://github.com/arach/openscout/releases/latest/download/OpenScout.dmg";


// Why Scout — an editorial head row, then two matched plates (problem →
// solution) over a shared hairline, with the capability records pulled out
// into their own band underneath. The panels stay symmetric: label, title,
// one short body, figure. The records are the #capabilities anchor.
type HiwCapability = { label: string; text: string };

const howItWorksContent: {
  eyebrow: string;
  statement: string;
  support: string;
  before: { label: string; title: string; body: string };
  after: { label: string; title: string; body: string };
  capabilities: HiwCapability[];
} = {
  eyebrow: "Why Scout",
  statement: "Stop juggling agents across windows.",
  support:
    "Scout sees all your agents, no matter where you run them. You don't have to change anything about your workflow to get a single pane of glass over every harness, session, and machine.",
  before: {
    label: "Without Scout",
    title: "Every agent in its own tool.",
    body: "A tmux pane here, an IDE there, a different harness for the next one. Context moves by hand, and finished work disappears into scrollback.",
  },
  after: {
    label: "With Scout",
    title: "One common layer for your agents.",
    body: "Any agent can reach any other, hand work off, and you steer from one place — every step kept as a durable record.",
  },
  capabilities: [
    { label: "Flights", text: "Delegation with receipts — who was asked, what ran, how it landed." },
    { label: "Mesh", text: "Trusted machines reach each other so agents can hand off work." },
    { label: "Protocol", text: "Speaks ACP — open protocol, no lock-in." },
    { label: "Bridges", text: "Telegram, voice, and webhooks plug in as transports." },
  ],
};

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
    question: "Is Scout an orchestrator?",
    answer:
      "No. Orchestrators race a swarm of agents at a task inside their own framework — a different job. Scout sits underneath the agents you already run: one place to see, steer, and remember them, over an open protocol. You keep your tools and workflow; it keeps you from losing track.",
  },
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
      "OpenScout is experimental v0.x product code for high-trust local developer pilots, not enterprise, compliance, or untrusted multi-tenant use. The repository and published packages are licensed under Apache License 2.0; see LICENSE and NOTICE.",
  },
  {
    question: "What do I install first?",
    answer:
      "Just the CLI — one command: curl -fsSL https://openscout.app/install | sh. It installs Bun if needed, then the Scout CLI. Run scout setup to materialize local settings, discover projects, register agents, and bring the broker online, then scout doctor to confirm it is reachable.",
  },
];

const getStartedCommandsByAudience: Record<HumanAudienceMode, CommandStep[]> = {
  general: [
    {
      command: "curl -fsSL https://openscout.app/install | sh",
      label: "One command — installs Bun if needed, then the CLI.",
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
      command: "curl -fsSL https://openscout.app/install | sh",
      label: "One command — installs Bun if needed, then the CLI.",
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
      src: "/scout/ios-home.png",
      alt: "Scout iOS app — fleet home on iPhone: machines, projects, and latest activity.",
      eyebrow: "iPhone",
      title: "Mobile",
      description:
        "Kick off a long job at your desk and walk away — when an agent needs a decision, Scout nudges your phone. Tap in, answer, and the work keeps going. Same broker state, different screen.",
      width: 1206,
      height: 2622,
      imageClassName: "aspect-[606/566] w-full object-cover object-top",
      chrome: "scout · iphone",
    },
    {
      src: "/mac/native-repos-diff.png",
      alt: "Scout native Mac app showing the Repos surface with live worktrees, agent activity, changed files, and a split diff.",
      eyebrow: "Mac",
      title: "Native app",
      description:
        "The native Mac app brings repos, worktrees, agents, changed files, and review context into one Scout window.",
      width: 1917,
      height: 1528,
      imageClassName: "aspect-[538/312] w-full object-cover object-top",
      chrome: "scout · repos",
    },
    {
      src: "/relay/ops-lanes-chrome.png",
      alt: "Scout web Ops lanes in Chrome showing live agent lanes, trace cards, and coordination context.",
      eyebrow: "Web",
      title: "Ops lanes",
      description:
        "Watch live agent lanes, trace cards, and coordination context from the local web dashboard.",
      width: 2864,
      height: 1410,
      imageClassName: "aspect-[960/314] w-full object-cover object-top",
      chrome: "relay · /ops/lanes",
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
      chrome: "relay · /threads/atlas",
    },
    {
      src: "/relay/machines-view.png",
      alt: "Scout web mesh topology and broker health view.",
      eyebrow: "Web",
      title: "Mesh",
      description:
        "Inspect broker identity, discoverability, peer topology, and health from the same developer surface.",
      chrome: "relay · /machines",
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
      src: "/scout/ios-home.png",
      alt: "Scout iOS app — fleet home on iPhone: machines, projects, and latest activity.",
      eyebrow: "iPhone",
      title: "Mobile",
      description:
        "The full broker state on your phone — machines, projects, agents, and the live activity feed all project from the same local source of truth.",
      width: 1206,
      height: 2622,
      imageClassName: "aspect-[606/566] w-full object-cover object-top",
    },
    {
      src: "/mac/native-repos-diff.png",
      alt: "Scout native Mac app showing the Repos surface with live worktrees, agent activity, changed files, and a split diff.",
      eyebrow: "Mac",
      title: "Native app",
      description:
        "Repos, worktrees, changed files, split diffs, and live agent context project from the same broker state as the web dashboard.",
      width: 1917,
      height: 1528,
      imageClassName: "aspect-[606/566] w-full object-cover object-top",
      chrome: "scout · repos",
    },
    {
      src: "/relay/ops-lanes-chrome.png",
      alt: "Scout web Ops lanes in Chrome showing live agent lanes, trace cards, and coordination context.",
      eyebrow: "Web",
      title: "Ops lanes",
      description:
        "A lane-oriented operator view for live traces, agent progress, recent turns, and the coordination panel beside active work.",
      width: 2864,
      height: 1410,
      imageClassName: "aspect-[2864/1410] w-full object-cover object-top",
      chrome: "relay · /ops/lanes",
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
    capabilitiesTitle: "Agents do the work. You set the loops and steer.",
    capabilitiesDescription:
      "Work routed through Scout becomes typed records the broker keeps: messages, invocations, flights, deliveries. They survive restarts and handoffs, so you read what an agent actually did instead of scrolling for it.",
    surfacesTitle: "One conversation, wherever you are.",
    surfacesDescription:
      "It's mostly about the agents — engage with them however you want, on whatever surface you're at. You set the loops, the agents do the work, you steer. Scout just stays underneath, keeping every conversation visible and organized.",
    surfacesNoteTitle: "Local, and dead simple.",
    surfacesNoteDescription:
      "The agents only need the binary. One install and you're off to the races — no dependencies, no virtual environments, nothing to wire up. And nothing leaves your control or your network. It's all local.",
    getStartedTitle: "One command to install. Local broker.",
    getStartedDescription:
      "Install the CLI, run setup, and Scout brings up the local broker. Mac and iPhone apps are optional surfaces over the same runtime.",
  },
  technical: {
    capabilitiesTitle: "One broker, one state model across apps.",
    capabilitiesDescription:
      "Typed records, developer views, and bridge transports all project the same durable state — from the TUI, the Mac app, the web dashboard, or your phone.",
    surfacesTitle: "Terminal, native, web, iPhone — same broker state.",
    surfacesDescription:
      "The TUI gives you fast reads on sessions and active agents. The local web dashboard adds fleet briefing, agent, thread, mesh, and ops surfaces on the same broker model. The native Mac app keeps Scout in the menu bar; Scout iOS gives you the same state on the go.",
    surfacesNoteTitle: "Developer path",
    surfacesNoteDescription:
      "Start in the TUI for the quickest read on sessions and agents. Move into the web dashboard, the native Mac app, and Scout iOS without losing the underlying broker context.",
    getStartedTitle: "One command to install. Local broker.",
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
  name: "Scout",
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
   Install command — flat, copyable command line in the hero
   ────────────────────────────────────────────────────────── */

function InstallCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    navigator.clipboard.writeText(command);
    // location id kept stable for analytics continuity
    trackCommandCopy({ command, location: "hero_rfc_install" });
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      className={`hero-install ${copied ? "hero-install--copied" : ""}`}
      aria-label="Copy install command"
    >
      <span className="hero-install__cmd">
        <span className="hero-install__prompt">$</span>
        {tokenizeCommand(command)}
      </span>
      <span className="hero-install__copy inline-flex items-center gap-1.5">
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

/* Splits a shell line into styled tokens: command word, -flags, the URL (the
   one accent), and pipe operators. */
function tokenizeCommand(command: string) {
  const parts = command.split(" ");
  return parts.flatMap((word, i) => {
    let cls: string | undefined;
    if (word === "|") cls = "hero-install__tok--op";
    else if (/^https?:\/\//.test(word)) cls = "hero-install__tok--url";
    else if (word.startsWith("-")) cls = "hero-install__tok--flag";
    else if (i === 0) cls = "hero-install__tok--cmd";
    const el = cls ? (
      <span key={`${i}-${word}`} className={cls}>
        {word}
      </span>
    ) : (
      word
    );
    return i === 0 ? [el] : [" ", el];
  });
}

/* Install channels for the CLI row. curl is primary (installs Bun + the CLI in
   one shot); bun/npm are the package-manager paths for the published
   @openscout/scout. brew is intentionally absent — there is no Homebrew tap yet,
   so shipping one would be a dead command. */
const INSTALL_METHODS = [
  {
    id: "curl",
    label: "curl",
    command: "curl -fsSL https://openscout.app/install | sh",
    note: "installs Bun if needed, then the CLI",
  },
  {
    id: "bun",
    label: "bun",
    command: "bun add -g @openscout/scout",
    note: "global install · then scout setup",
  },
  {
    id: "npm",
    label: "npm",
    command: "npm install -g @openscout/scout",
    note: "global install · then scout setup",
  },
] as const;

/* CLI install with a package-manager selector — curl leads, bun/npm swap in the
   published package command. The command box + copy is the shared InstallCommand. */
function InstallPicker() {
  const [methodId, setMethodId] = useState<(typeof INSTALL_METHODS)[number]["id"]>(
    INSTALL_METHODS[0].id,
  );
  const active = INSTALL_METHODS.find((m) => m.id === methodId) ?? INSTALL_METHODS[0];
  return (
    <div className="install-picker">
      <div className="install-picker__tabs" role="tablist" aria-label="Install method">
        {INSTALL_METHODS.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={m.id === methodId}
            className={`install-picker__tab ${m.id === methodId ? "install-picker__tab--active" : ""}`}
            onClick={() => setMethodId(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <InstallCommand command={active.command} />
      <p className="hero-setup__note">{active.note}</p>
    </div>
  );
}

function MacDownloadButton({ onClick }: { onClick?: () => void }) {
  return (
    <a href={macosDownloadUrl} onClick={onClick} className="mac-download" draggable={false}>
      <span className="mac-download__glyph" aria-hidden>
        <svg viewBox="0 0 384 512" fill="currentColor">
          <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
        </svg>
      </span>
      <span className="mac-download__label">Download for macOS</span>
    </a>
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
      href="https://github.com/arach/openscout"
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`openscout on GitHub — ${stars} stars`}
      className="status-bar__cell status-bar__cell--link hidden md:inline-flex"
    >
      ★&nbsp;<b>{stars}</b>
    </a>
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
      aria-label="Agent view"
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
    top: "Every agent. Every session.",
    bottom: "One place to steer.",
    sub: "One agent was easy to babysit. Now it's five sessions across harnesses and terminals — and the one that stalls waiting on your yes is the one you miss. Scout shows what every agent is doing and flags the one blocked on your decision. Local-first: nothing leaves your machine.",
  },
  agent: {
    top: "Comms platform for agents.",
    bottom: "Agent native.",
    sub: "One install adds the runtime. Register as a peer — nothing else about how your agent runs has to change.",
  },
};

const heroInstall: Record<Viewer, { command: string; footnote?: string }> = {
  human: {
    command: "curl -fsSL https://openscout.app/install | sh",
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
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {/* ── Operator Console (header) ── */}
      <header className="operator-console">
        {/* main row — wordmark + minimal mono nav + theme toggle */}
        <div className="mx-auto flex max-w-7xl items-center px-6 operator-row">
          <Link
            href="/"
            onClick={onNavigationClick("Scout", "/", "header_logo")}
            className="site-wordmark flex items-center"
          >
            <LogoMark />
            <span className="site-wordmark__text font-[family-name:var(--font-spectral)]">
              Scout
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
                {link.label}
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
              GitHub
            </a>
            <Link
              href="/docs"
              onClick={onCtaClick("Read the docs", "/docs", "header_nav", "docs")}
              className="operator-link"
            >
              Docs
            </Link>
            <Link
              href="/blog"
              onClick={onCtaClick("Read the blog", "/blog", "header_nav", "blog")}
              className="operator-link"
            >
              Blog
            </Link>
            <SiteThemeToggle />
          </div>
        </div>
      </header>

        <>
          <main id="main" ref={scrollRef} className="relative z-10">
            {/* ── Hero (editorial column beside the live console) ── */}
            <section className="overflow-hidden pb-8 pt-20 md:pt-28 md:pb-10">
              <div className="mx-auto max-w-7xl px-6">
                <div className="hero-split">
                  <div className="hero-editorial hero-animate" style={{ animationDelay: "0s" }}>
                    <h1 className="hero-title">
                      <span className="hero-title__line">{headline.top}</span>
                      <span className="hero-title__line">{headline.bottom}</span>
                    </h1>

                    <p className="hero-sub">{headline.sub}</p>

                    {viewer === "human" && (
                      <ul
                        className="hero-neutral"
                        aria-label="Neutral across model, harness, and framework"
                      >
                        <li>model-neutral</li>
                        <li>harness-neutral</li>
                        <li>framework-neutral</li>
                      </ul>
                    )}

                    {viewer === "agent" ? (
                      <div className="hero-install-block">
                        <InstallCommand command={install.command} />
                        <p className="hero-install-foot">{install.footnote}</p>
                        <p className="hero-links">
                          Tool manifest at{" "}
                          <a href="/scout/manifest">
                            /scout/manifest
                          </a>{" "}
                          · raw JSON at{" "}
                          <a href="/.well-known/scout.json">
                            /.well-known/scout.json
                          </a>
                        </p>
                      </div>
                    ) : (
                      <div className="hero-setup">
                        <div className="hero-setup__row">
                          <div className="hero-setup__label">How it runs</div>
                          <p className="hero-setup__body">
                            Scout is a native app and a Rust watcher — keep your
                            tools. As long as it can find your harness logs,
                            you&apos;re good to go.
                          </p>
                        </div>
                        <div className="hero-setup__row">
                          <div className="hero-setup__label">CLI</div>
                          <div className="hero-setup__content">
                            <InstallPicker />
                          </div>
                        </div>
                        <div className="hero-setup__row">
                          <div className="hero-setup__label">Mac app</div>
                          <div className="hero-setup__content">
                            <MacDownloadButton
                              onClick={onCtaClick(
                                "Download for macOS",
                                macosDownloadUrl,
                                "hero",
                                "download",
                              )}
                            />
                            <p className="hero-setup__note">
                              optional surface · iPhone companion too
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="hero-console-col hero-animate" style={{ animationDelay: "0.12s" }}>
                    <div className="hero-viewer-perch">
                      <ViewerToggle viewer={viewer} onChange={setViewer} />
                    </div>
                    <div className="hero-console-mat">
                      <ScoutConsole audience={viewer} />
                    </div>
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

            {/* ── Why Scout — head row, problem → solution plates, capability band ── */}
            <section id="mesh" className="section-band">
              <div className="mx-auto max-w-7xl px-6">
                {/* Editorial head — split treatment: the pull-quote statement
                    seats left, the no-adoption support line to its right, both
                    bottom-aligned under a full-width eyebrow. */}
                <header className="reveal hiw-head">
                  <div className="hiw-head__main">
                    <div className="section-eyebrow">{howItWorksContent.eyebrow}</div>
                    <h2 className="hiw-statement">{howItWorksContent.statement}</h2>
                    <p className="hiw-statement__support">{howItWorksContent.support}</p>
                  </div>
                </header>

                <div className="reveal hiw-contrast">
                  {/* The hinge — one quiet directional mark on the center rule. */}
                  <span className="hiw-contrast__hinge" aria-hidden>
                    →
                  </span>

                  {/* Without — problem, muted */}
                  <article className="hiw-panel hiw-panel--before">
                    <div className="hiw-panel__label">{howItWorksContent.before.label}</div>
                    <h3 className="hiw-panel__title">{howItWorksContent.before.title}</h3>
                    <p className="hiw-panel__body">{howItWorksContent.before.body}</p>
                    <div className="hiw-panel__stage">
                      <SiloDesktop />
                    </div>
                  </article>

                  {/* With — solution, primary */}
                  <article className="hiw-panel hiw-panel--after">
                    <div className="hiw-panel__label">{howItWorksContent.after.label}</div>
                    <h3 className="hiw-panel__title">{howItWorksContent.after.title}</h3>
                    <p className="hiw-panel__body">{howItWorksContent.after.body}</p>
                    <div className="hiw-panel__stage">
                      <MeshFigureSvg />
                    </div>
                  </article>
                </div>

                {/* What the layer gives you — the records, as their own band. */}
                <div id="capabilities" className="reveal hiw-caps">
                  <div className="hiw-caps__head">
                    <span className="hiw-caps__eyebrow">Capabilities</span>
                    <Link
                      href="/docs"
                      onClick={onCtaClick("Browse the docs", "/docs", "capabilities", "docs")}
                      className="hiw-caps__link"
                    >
                      <span aria-hidden>→</span>
                      <span>browse the docs</span>
                    </Link>
                  </div>
                  <ul className="hiw-caps__grid">
                    {howItWorksContent.capabilities.map((cap) => (
                      <li key={cap.label} className="hiw-cap">
                        <span className="hiw-cap__label">{cap.label}</span>
                        <span className="hiw-cap__text">{cap.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>

            {/* ── The apps ── */}
            <section id="surfaces" className="section-band">
              <div className="mx-auto grid max-w-7xl gap-x-12 gap-y-10 px-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
                <div className="reveal max-w-xl">
                  <div className="section-eyebrow">The apps</div>
                  <h2 className="section-title">
                    {copy.surfacesTitle}
                  </h2>
                  <p className="section-lead">
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
                      ["Mobile", "Native app", "Ops lanes"].includes(s.title),
                    )
                    .map((shot, i) => {
                      const isPhone = shot.eyebrow === "iPhone";
                      return (
                        <figure
                          key={shot.src}
                          className={`reveal surface-figure${isPhone ? " surface-figure--phone" : ""}`}
                          style={{ "--reveal-i": i } as React.CSSProperties}
                        >
                          <div className="surface-figure__chrome">
                            <span className="surface-figure__dots" aria-hidden>
                              <i />
                              <i />
                              <i />
                            </span>
                            {shot.chrome && (
                              <span className="surface-figure__chrome-id">
                                {shot.chrome}
                              </span>
                            )}
                          </div>
                          {isPhone ? (
                            <div className="surface-phone__stage">
                              <div className="surface-phone__device">
                                <span className="surface-phone__island" aria-hidden />
                                <ExpandableImage
                                  analyticsId={shot.src}
                                  analyticsLocation="surfaces_gallery"
                                  src={shot.src}
                                  alt={shot.alt}
                                  width={shot.width ?? 1206}
                                  height={shot.height ?? 2622}
                                  containerClassName="surface-phone__screen-wrap"
                                  className="surface-phone__screen"
                                  frame="phone"
                                />
                              </div>
                            </div>
                          ) : (
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
                          )}
                          <figcaption className="surface-figure__caption">
                            <div className="surface-figure__caption-tag">
                              {shot.eyebrow}
                            </div>
                            <h3 className="surface-figure__caption-title">
                              {shot.title}
                            </h3>
                            <p className="surface-figure__caption-body">
                              {shot.description}
                            </p>
                          </figcaption>
                        </figure>
                      );
                    })}
                </div>
              </div>
            </section>

            {/* ── Works with ── */}
            <section id="integrations" className="section-band">
              <div className="mx-auto grid max-w-7xl gap-x-12 gap-y-10 px-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
                <div className="reveal max-w-sm">
                  <div className="section-eyebrow">Works with</div>
                  <h2 className="section-title">
                    Scout where agents already work.
                  </h2>
                  <p className="section-lead">
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
                      <div className="integration-block__heading">
                        <div className="rfc-block__num">{integration.host}</div>
                        <h3 className="integration-block__name">
                          {integration.name}
                        </h3>
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

            {/* ── Getting started ── */}
            <section id="get-started" className="section-band">
              <div className="mx-auto max-w-7xl px-6">
                <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
                  <div className="reveal max-w-sm">
                    <div className="section-eyebrow">Getting started</div>
                    <h2 className="section-title">
                      {copy.getStartedTitle}
                    </h2>
                    <p className="section-lead">
                      {copy.getStartedDescription}
                    </p>

                    <div className="mt-8 rfc-block">
                      <div className="rfc-block__num">Apps</div>
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

            {/* ── Questions ── */}
            <section id="faq" className="section-band">
              <div className="mx-auto grid max-w-7xl gap-x-12 gap-y-10 px-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
                <div className="reveal max-w-sm">
                  <div className="section-eyebrow">Questions</div>
                  <h2 className="section-title">
                    What a developer asks before installing.
                  </h2>
                  <p className="section-lead">
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
                      <h3 className="rfc-block__title">{question}</h3>
                      <p className="rfc-block__body">{answer}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* ── Where we are ── */}
            <section className="section-band">
              <div className="mx-auto max-w-7xl px-6">
                <div className="reveal max-w-2xl">
                  <div className="section-eyebrow">Where we are</div>
                  <h2 className="section-title">
                    Early, honest, and open.
                  </h2>
                  <p className="section-lead">
                    Scout is v0.x under active development — genuinely useful
                    today for steering agents on your own machine, early enough
                    that your feedback still moves the roadmap. It’s Apache-2.0
                    and on GitHub, so “help shape it” is a real invitation.
                  </p>
                  <p className="mt-6 font-[family-name:var(--font-mono-display)] text-[12.5px] leading-relaxed text-[var(--site-muted)]">
                    The straight version: built for developers who want to run
                    ahead of the curve — not for enterprise, compliance, or
                    multi-tenant deployments yet.
                  </p>
                  <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 font-[family-name:var(--font-mono-display)] text-[12.5px]">
                    <a
                      href="https://github.com/arach/openscout/issues"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={onCtaClick(
                        "Open an issue",
                        "https://github.com/arach/openscout/issues",
                        "where_we_are",
                        "repo",
                      )}
                      className="inline-flex items-center gap-1.5 text-[var(--site-copy)] transition-colors hover:text-[var(--site-ink)]"
                    >
                      <span className="text-[var(--site-muted)]">→</span>
                      <span>open an issue</span>
                    </a>
                    <a
                      href="https://github.com/arach/openscout"
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={onCtaClick(
                        "Browse the repo",
                        "https://github.com/arach/openscout",
                        "where_we_are",
                        "repo",
                      )}
                      className="inline-flex items-center gap-1.5 text-[var(--site-copy)] transition-colors hover:text-[var(--site-ink)]"
                    >
                      <span className="text-[var(--site-muted)]">→</span>
                      <span>browse the repo</span>
                    </a>
                  </div>
                </div>
              </div>
            </section>
          </main>

          {/* ── Status footer (Cursor-style IDE status bar) ── */}
          <footer className="status-bar">
            <div className="mx-auto flex max-w-7xl items-stretch px-6">
              <div className="status-bar__inner w-full">
                {/* Left group: identity, release line, license, and the repo
                    with its stargazers seated right beside it. */}
                <span className="status-bar__cell">
                  <span className="status-bar__brand">SCOUT</span>
                </span>
                <span className="status-bar__cell hidden sm:inline-flex">
                  proto&nbsp;<b>experimental</b>
                </span>
                <span className="status-bar__cell">
                  <b>v{SCOUT_VERSION}</b>
                </span>
                <span className="status-bar__cell hidden md:inline-flex">
                  apache-2.0
                </span>
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
                <GithubStars />

                {/* Right group: content links, then social + legal. */}
                <span className="status-bar__zone--right">
                  <Link
                    href="/docs"
                    onClick={onNavigationClick("Docs", "/docs", "footer")}
                    className="status-bar__cell status-bar__cell--link"
                  >
                    <span className="status-bar__sigil">:</span>docs
                  </Link>
                  <a
                    href="#faq"
                    onClick={onNavigationClick("FAQ", "#faq", "footer")}
                    className="status-bar__cell status-bar__cell--link hidden sm:inline-flex"
                  >
                    <span className="status-bar__sigil">:</span>faq
                  </a>
                  <a
                    href="https://x.com/arach"
                    onClick={onCtaClick("Twitter", "https://x.com/arach", "footer", "social")}
                    className="status-bar__cell status-bar__cell--link hidden sm:inline-flex"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="status-bar__sigil">:</span>x
                  </a>
                  <Link
                    href="/privacy"
                    onClick={onNavigationClick("Privacy", "/privacy", "footer")}
                    className="status-bar__cell status-bar__cell--link hidden sm:inline-flex"
                  >
                    <span className="status-bar__sigil">:</span>privacy
                  </Link>
                </span>
              </div>
            </div>
          </footer>
        </>

    </div>
  );
}
