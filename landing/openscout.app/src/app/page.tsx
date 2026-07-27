"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, ExternalLink } from "lucide-react";
import { TerminalSession } from "@/components/terminal-session";
import { ExpandableImage } from "@/components/expandable-image";
import { LogoMark } from "@/components/logo-mark";
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
  { label: "Verify install", href: "#get-started" },
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
    {
      command: "scout whoami",
      label: "Confirm Scout resolved the intended project and sender identity.",
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
    {
      command: "scout whoami --json",
      label: "Confirm the sender, project, and discovery URLs as structured data.",
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
    getStartedTitle: "Verify the broker before moving on.",
    getStartedDescription:
      "A self-install is complete only when setup has brought up the local broker, doctor reports it reachable, and whoami resolves the intended project identity.",
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
    getStartedTitle: "Verify the broker before moving on.",
    getStartedDescription:
      "A self-install is complete only when setup has brought up the local broker, doctor reports it reachable, and whoami resolves the intended project identity.",
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

const OPENSCOUT_AGENT_INSTALL = {
  kind: "openscout.agent-install",
  version: "0.1",
  discovery: "https://openscout.app/.well-known/agent.md",
  guide: "https://openscout.app/install.md",
  command: "curl -fsSL https://openscout.app/install | sh",
  setup: "scout setup",
  verify: ["scout doctor", "scout whoami --json"],
  safety: [
    "review prerequisites before installing",
    "explain the local support footprint before setup",
    "ask before privilege escalation or overwriting existing configuration",
  ],
} as const;

const AGENT_INSTALL_BRIEF =
  "Install OpenScout on this machine. Start at https://openscout.app/.well-known/agent.md and follow its linked install guide. Check the prerequisites, explain what scout setup will change, then install the CLI and run setup. Stop only after scout doctor passes and scout whoami resolves this project. Ask before privilege escalation or overwriting existing configuration.";

function AgentInstallHandoff() {
  const [copied, setCopied] = useState(false);

  const onCopy = () => {
    navigator.clipboard.writeText(AGENT_INSTALL_BRIEF);
    trackCommandCopy({
      command: AGENT_INSTALL_BRIEF,
      commandCount: 1,
      location: "agent_install_handoff",
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="agent-handoff" aria-labelledby="agent-handoff-label">
      <div className="agent-handoff__bar">
        <span id="agent-handoff-label">Agent install brief</span>
        <button type="button" onClick={onCopy} className="agent-handoff__copy">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy for your agent"}
        </button>
      </div>
      <p className="agent-handoff__prompt">{AGENT_INSTALL_BRIEF}</p>
      <ol className="agent-handoff__route" aria-label="Agent self-install route">
        <li><span>01</span> Discover</li>
        <li><span>02</span> Inspect</li>
        <li><span>03</span> Install</li>
        <li><span>04</span> Verify</li>
      </ol>
      <div className="agent-handoff__links">
        <a href="/.well-known/agent.md">agent entry</a>
        <a href="/install.md">install guide</a>
        <a href="/.well-known/scout.json">raw manifest</a>
      </div>
    </div>
  );
}

const AGENT_INSTALL_PROOF = [
  {
    step: "discover",
    command: "GET /.well-known/agent.md",
    result: "canonical route found",
  },
  {
    step: "inspect",
    command: "READ /install.md",
    result: "prerequisites + footprint reviewed",
  },
  {
    step: "install",
    command: "curl -fsSL openscout.app/install | sh",
    result: "@openscout/scout installed",
  },
  {
    step: "setup",
    command: "scout setup",
    result: "local broker started",
  },
  {
    step: "verify",
    command: "scout doctor && scout whoami --json",
    result: "healthy · project resolved",
  },
] as const;

function AgentInstallProof() {
  return (
    <figure className="agent-install-proof">
      <div className="agent-install-proof__chrome">
        <span className="agent-install-proof__dots" aria-hidden><i /><i /><i /></span>
        <span>expected healthy run</span>
      </div>
      <div className="agent-install-proof__body">
        <div className="agent-install-proof__intro">
          <span>agent</span>
          <strong>Self-installing Scout from its published contract</strong>
        </div>
        <ol>
          {AGENT_INSTALL_PROOF.map((item, index) => (
            <li key={item.step}>
              <span className="agent-install-proof__index">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <span className="agent-install-proof__step">{item.step}</span>
                <code>{item.command}</code>
                <span className="agent-install-proof__result">✓ {item.result}</span>
              </div>
            </li>
          ))}
        </ol>
        <figcaption>
          A successful install ends in verified local state, not at a downloaded binary.
        </figcaption>
      </div>
    </figure>
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



export default function Home() {
  const scrollRef = useScrollReveal<HTMLElement>("general");

  const copy = audienceContent["general"];
  const surfaceGallery = surfaceGalleryByAudience["general"];
  const getStartedCommands = getStartedCommandsByAudience["general"];
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
            <a
              href="#agent-install"
              onClick={onNavigationClick("Agent install", "#agent-install", "header_nav")}
              className="operator-install-link hidden lg:inline-flex"
            >
              Agent install
            </a>
            <SiteThemeToggle />
          </div>
        </div>
      </header>

        <>
          <main id="main" ref={scrollRef} className="relative z-10">
            {/* Measured margin rule — the mission "sheet edge." Purely a
                registration line; carries no fabricated readouts. */}
            <div className="mission-page-ruler" aria-hidden="true" />

            {/* ── Hero (editorial column beside the live console) ── */}
            <section id="agent-install" className="mission-hero overflow-hidden pb-8 pt-20 md:pt-28 md:pb-10">
              <div className="mission-hero__field" aria-hidden="true">
                <div className="mission-hero__layer mission-hero__layer--far" />
              </div>

              <div className="mission-hero__content relative z-10 mx-auto max-w-7xl px-6">
                <div className="hero-split">
                  <div className="hero-editorial hero-animate" style={{ animationDelay: "0s" }}>
                    <h1 className="hero-title">
                      <span className="hero-title__line">Your agent can install Scout.</span>
                      <span className="hero-title__line">Hand it one URL.</span>
                    </h1>

                    <p className="hero-sub">
                      An agent with shell access can discover the canonical guide,
                      review the local footprint, install the CLI, and verify the broker
                      without guessing at the next step. Copy the complete handoff below.
                    </p>

                    <AgentInstallHandoff />

                    <p className="hero-human-path">
                      Installing by hand? <a href="#get-started">Use the same verified path</a>.
                      The Mac and iPhone apps remain optional surfaces.
                    </p>
                  </div>

                  <div className="hero-console-col hero-animate" style={{ animationDelay: "0.12s" }}>
                    <AgentInstallProof />
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
              <script
                type="application/openscout-install+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(OPENSCOUT_AGENT_INSTALL) }}
              />
            </section>

            {/* ── Why Scout — head row, problem → solution plates, capability band ── */}
            <section id="mesh" className="section-band mission-briefing" data-mission="02">
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
            <section id="surfaces" className="section-band" data-mission="03">
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
            <section id="integrations" className="section-band" data-mission="04">
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
            <section id="get-started" className="section-band" data-mission="05">
              <div className="mx-auto max-w-7xl px-6">
                <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
                  <div className="reveal max-w-sm">
                    <div className="section-eyebrow">Healthy install</div>
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
            <section id="faq" className="section-band" data-mission="06">
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
            <section className="section-band" data-mission="07">
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
