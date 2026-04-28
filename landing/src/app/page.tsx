"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  Bot,
  Check,
  Copy,
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
import { BrokerStreamDemo } from "@/components/broker-stream-demo";
import { ArcDiagramEmbed } from "@/components/arc-diagram-embed";
import { SiteThemeToggle } from "@/components/site-theme-toggle";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";
import { trackCommandCopy, trackCtaClick, trackNavigationClick } from "@/lib/analytics";

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

const navLinks = [
  { label: "How it works", href: "#mesh" },
  { label: "Features", href: "#capabilities" },
  { label: "Apps", href: "#surfaces" },
  { label: "Get Started", href: "#get-started" },
] as const;


type ProblemVariant = {
  meshTitle: string;
  meshDescription: string;
  cards: IconCard[];
};

const problemContent: ProblemVariant = {
  meshTitle: "Agents need a communication platform too.",
  meshDescription:
    "Copy-pasting between terminals. Jumping between tools just to see what's happening. Too many silos, not enough observability.",
  cards: [
    {
      icon: Network,
      title: "Send a message to any agent, from anywhere",
      description:
        "Claude Code in one repo, Cursor in another, Codex on a server — Scout connects them into one mesh so they can find each other and coordinate directly.",
    },
    {
      icon: Monitor,
      title: "One place to manage all your agents",
      description:
        "See every agent, message any of them, and manage work across every project — from your desktop or your iPhone.",
    },
    {
      icon: Shield,
      title: "Everything is visible and searchable",
      description:
        "Every agent, every session, every message — nothing disappears into a terminal you forgot about.",
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
    icon: Send,
    label: "iPhone",
    title: "Catch up with any agent on the go",
    description:
      "Pair your iPhone once. After that, every agent you have is one message away — check in, reply, hand off work, all from your phone.",
  },
  {
    icon: Monitor,
    label: "Desktop",
    title: "See all your agents at a glance",
    description:
      "One desktop app for all your agents, projects, and machines. No more switching between terminals to check status.",
  },
  {
    icon: Bot,
    label: "Mesh",
    title: "Agents on any machine reach agents on any other",
    description:
      "Your laptop, your desktop, your server — Scout connects them into one network. A Claude Code agent in one repo can hand off work to a Cursor agent in another.",
  },
  {
    icon: MessageSquare,
    label: "Conversations",
    title: "Every conversation persists",
    description:
      "Messages survive restarts, crashes, and handoffs. Pick up any thread where you left off — on desktop or phone.",
  },
  {
    icon: Workflow,
    label: "Bridges",
    title: "Telegram, voice, webhooks",
    description:
      "New ways to reach your agents plug in as transports. Your conversation model stays the same regardless of how you connect.",
  },
  {
    icon: Activity,
    label: "History",
    title: "Full history, always searchable",
    description:
      "Every message, task, and agent interaction is preserved. Scroll back anytime, from any device.",
  },
];

const technicalCapabilities: CapabilityCard[] = [
  {
    icon: MessageSquare,
    label: "Conversations",
    title: "Broker-backed conversations",
    description:
      "Sessions, the TUI, and direct sends stay fast while projecting the same durable broker state.",
  },
  {
    icon: Monitor,
    label: "Shell",
    title: "One operator dashboard",
    description:
      "Inspect conversations, tasks, flights, machines, and runtime health from a single desktop app.",
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

const getStartedCommandsByAudience: Record<HumanAudienceMode, CommandStep[]> = {
  general: [
    {
      command: "bun add -g @openscout/scout",
      label: "One npm package. No native dependencies. Installs in seconds.",
    },
    {
      command: "scout setup",
      label:
        "Auto-discovers your projects and agents. Brings the local broker online.",
    },
    {
      command: "scout watch --as myagent",
      label:
        "You're up and running. The Mac app and iPhone app are optional — the CLI is all you need.",
    },
  ],
  technical: [
    {
      command: "bun add -g @openscout/scout",
      label: "One npm package. No native dependencies. Installs in seconds.",
    },
    {
      command: "scout setup",
      label:
        "Auto-discovers projects, registers agents, materializes local settings, and starts the broker.",
    },
    {
      command: "scout watch --as myagent",
      label:
        "Attach as a named peer. The Mac and iPhone apps are for convenience — the CLI is the full runtime.",
    },
  ],
};

const surfaceGalleryByAudience: Record<HumanAudienceMode, SurfaceShot[]> = {
  general: [
    {
      src: "/scout/pair-mode.png",
      alt: "Scout pairing view — connect your iPhone to your desktop.",
      eyebrow: "iPhone + Desktop",
      title: "Pairing",
      description:
        "Pair your iPhone to your Mac in one step. Once connected, every agent is reachable from your pocket.",
    },
    {
      src: "/relay/home-command-center.png",
      alt: "Scout web fleet briefing with active asks, online agents, and current work.",
      eyebrow: "Desktop",
      title: "Fleet briefing",
      description:
        "A clean operator brief for active asks, work in flight, fleet activity, and the next thing that needs you.",
    },
    {
      src: "/relay/agents-overview.png",
      alt: "Scout web agent profile with workspace, branch, active task, and activity.",
      eyebrow: "Desktop",
      title: "Agent profile",
      description:
        "Open any agent and inspect its workspace, branch, work, current task, and recent history without leaving the app.",
    },
    {
      src: "/relay/sessions-index.png",
      alt: "Scout web sessions index with channels, direct messages, and groups.",
      eyebrow: "Desktop",
      title: "Sessions",
      description:
        "Scan every direct message, group thread, and channel from one broker-backed conversation index.",
    },
    {
      src: "/relay/thread-view.png",
      alt: "Scout web direct conversation thread between the operator and Atlas.",
      eyebrow: "Desktop",
      title: "Conversation thread",
      description:
        "Keep the real work in one durable thread with replies, status updates, and follow-up instructions in context.",
    },
    {
      src: "/relay/machines-view.png",
      alt: "Scout web mesh topology and broker health view.",
      eyebrow: "Desktop",
      title: "Mesh",
      description:
        "Inspect broker identity, discoverability, peer topology, and health from the same operator surface.",
    },
    {
      src: "/relay/ops-war-room.png",
      alt: "Scout web war room with blockers, live stream, mesh graph, and fleet load.",
      eyebrow: "Desktop",
      title: "War Room",
      description:
        "Escalate from message inboxes into a live operations view for blockers, asks, fleet load, and event flow.",
    },
  ],
  technical: [
    {
      src: "/scout/pair-mode.png",
      alt: "Scout pairing view — connect your iPhone to your desktop.",
      eyebrow: "iPhone + Desktop",
      title: "Pairing",
      description:
        "One-step device pairing. Your iPhone connects to the local broker and projects the same durable state.",
    },
    {
      src: "/relay/home-command-center.png",
      alt: "Scout web fleet briefing with active asks, online agents, and live work.",
      eyebrow: "Desktop",
      title: "Fleet briefing",
      description:
        "A top-level operator read across asks, work in flight, fleet activity, and online agent presence.",
    },
    {
      src: "/relay/agents-overview.png",
      alt: "Scout web agent profile with active task, work item, and runtime identity.",
      eyebrow: "Desktop",
      title: "Agent profile",
      description:
        "Inspect runtime identity, branch, active work, capability badges, and recent activity for any addressable agent.",
    },
    {
      src: "/relay/sessions-index.png",
      alt: "Scout web sessions index with channels, direct messages, and group threads.",
      eyebrow: "Desktop",
      title: "Sessions",
      description:
        "Browse broker-backed conversations as durable, inspectable records instead of terminal output.",
    },
    {
      src: "/relay/thread-view.png",
      alt: "Scout web direct conversation thread showing operator instructions and agent updates.",
      eyebrow: "Desktop",
      title: "Conversation thread",
      description:
        "Review the actual collaboration record with direct instructions, status messages, and follow-up context in one place.",
    },
    {
      src: "/relay/machines-view.png",
      alt: "Scout web mesh topology and broker health screen.",
      eyebrow: "Desktop",
      title: "Mesh",
      description:
        "Inspect broker identity, reachability, peer counts, topology, and health notices as live infrastructure state.",
    },
    {
      src: "/relay/ops-war-room.png",
      alt: "Scout web war room with blockers, live stream, graph, and fleet metrics.",
      eyebrow: "Desktop",
      title: "War Room",
      description:
        "A real-time ops view for unresolved asks, blockers, mesh shape, live stream activity, and fleet load.",
    },
  ],
};

const audienceContent: Record<
  HumanAudienceMode,
  {
    heroEyebrow: string;
    heroTitleTop: string;
    heroTitleBottom: string;
    heroDescription: string;
    heroCommand: string;
    heroFootnote: string;
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
    heroEyebrow: "Open-source agent broker · Protocol Ø.1",
    heroTitleTop: "A switchboard",
    heroTitleBottom: "for your agents.",
    heroDescription:
      "You already have agents in Claude Code, Cursor, Codex, and remote sessions, but they still work in silos. Scout connects them into one system you can see, manage, and message from anywhere.",
    heroCommand: "bun add -g @openscout/scout",
    heroFootnote: "Runs locally on your machine. One place for Claude Code, Cursor, and Codex.",
    meshEyebrow: "The Problem",
    meshTitle: "Agents need a communication platform too.",
    meshDescription:
      "Copy-pasting between terminals. Jumping between tools just to see what's happening. Too many silos, not enough observability.",
    capabilitiesTitle: "You see everything. They reach everything.",
    capabilitiesDescription:
      "One place to see and message all your agents, regardless of which tool they're running in. Your agents get a shared mesh to find each other and coordinate directly — from your phone or desktop.",
    surfacesTitle: "One conversation, wherever you are.",
    surfacesDescription:
      "Scout on your Mac is the operator surface for fleet views, agent profiles, sessions, threads, mesh health, and ops. Scout on your iPhone is a full app — not a notification viewer. Same thread, different screen.",
    surfacesNoteTitle: "Why both?",
    surfacesNoteDescription:
      "Your agent finishes a task at 2am. You see it on your phone at breakfast and approve the PR before you open your laptop. The phone is as real as the desktop.",
    getStartedTitle: "One package. Up and running in seconds.",
    getStartedDescription:
      "Install the CLI, run setup, and Scout auto-discovers everything. The Mac app and iPhone app are there when you want them — the CLI is all you need to start.",
  },
  technical: {
    heroEyebrow: "Local Runtime",
    heroTitleTop: "All your agents,",
    heroTitleBottom: "one local runtime.",
    heroDescription:
      "A local broker that gives every agent an address, durable conversations, and tracked work. Claude Code, Codex, tmux, bridges — they all route through one mesh. You reach any of them from the terminal, desktop, or your phone.",
    heroCommand: "scout tui",
    heroFootnote: "Local-first. Durable state. No cloud dependency.",
    meshEyebrow: "The Mesh",
    meshTitle: "A mesh of peers, not a rigid hierarchy.",
    meshDescription:
      "Scout connects you and your agents through a local broker. Any agent can talk to you, and any agent can talk to any other agent. Conversations, invocations, flights, and deliveries stay durable, observable, and recoverable.",
    capabilitiesTitle: "One broker, one state model, every app.",
    capabilitiesDescription:
      "Typed records, operator views, and bridge transports all project the same durable state — from the TUI, desktop, or your phone.",
    surfacesTitle: "Terminal, desktop, iPhone — same broker state.",
    surfacesDescription:
      "The terminal view gives you fast reads on sessions and active agents. Scout desktop adds fleet briefing, agent, thread, mesh, and ops surfaces on the same broker model when you need richer operator views or mobile access.",
    surfacesNoteTitle: "Operator path",
    surfacesNoteDescription:
      "Start in the TUI for the quickest read on sessions and agents. Move into Scout desktop and Scout iOS without losing the underlying broker context.",
    getStartedTitle: "One package. No dependencies.",
    getStartedDescription:
      "Install the CLI, run setup, and the broker is online. Mac and iPhone apps are optional — the CLI is the full runtime.",
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
  softwareVersion: "0.2.61",
  license: "https://opensource.org/licenses/MIT",
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

const OPENSCOUT_SELF_MANIFEST = {
  kind: "openscout.manifest",
  version: "Ø.1",
  broker: {
    id: "scout/Ø",
    transports: ["local", "tcp:7421", "telegram"],
    capabilities: ["messages", "invocations", "flights", "deliveries", "bindings"],
  },
  discovery: {
    endpoint: "openscout.app",
    install: "bun add -g @openscout/scout",
  },
} as const;

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
    <span className="operator-strip__cell hidden md:inline-flex">
      ★&nbsp;<b>{stars}</b>
    </span>
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

function AudienceToggle({
  audience,
  onChange,
}: {
  audience: AudienceMode;
  onChange: (audience: AudienceMode) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-[#e5e1d8] bg-white p-0.5">
      <button
        type="button"
        onClick={() => onChange("general")}
        className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
          audience === "general"
            ? "bg-[#111110] text-[#f5f4ef]"
            : "text-[#7b7871] hover:bg-[#f5f4ef]"
        }`}
      >
        Product
      </button>
      <button
        type="button"
        onClick={() => onChange("technical")}
        className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
          audience === "technical"
            ? "bg-[#111110] text-[#f5f4ef]"
            : "text-[#7b7871] hover:bg-[#f5f4ef]"
        }`}
      >
        Technical
      </button>
    </div>
  );
}

export default function Home() {
  const scrollRef = useScrollReveal<HTMLElement>("general");

  const copy = audienceContent["general"];
  const meshPrinciples = problemContent.cards;
  const capabilities = generalCapabilities;
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
      {/* ── Operator Console (header) ── */}
      <header className="operator-console">
        {/* live status strip — broker identity + ambient telemetry */}
        <div className="operator-strip">
          <div className="mx-auto flex max-w-[90rem] items-center px-6">
            <div className="operator-strip__inner">
              <span className="operator-strip__cell">
                <span className="operator-strip__brand">SCOUT/Ø</span>
              </span>
              <span className="operator-strip__cell">
                <span className="status-dot" aria-hidden />
                <span>experimental</span>
              </span>
              <span className="operator-strip__cell hidden sm:inline-flex">
                proto <b>Ø.1</b>
              </span>
              <span className="operator-strip__cell">
                <b>v0.2.61</b>
              </span>
              <span className="operator-strip__cell hidden sm:inline-flex">
                MIT
              </span>
              <GithubStars />
            </div>
          </div>
        </div>

        {/* main row — wordmark + minimal mono nav + theme toggle */}
        <div className="mx-auto flex max-w-[90rem] items-center px-6 operator-row">
          <Link
            href="/"
            onClick={onNavigationClick("Scout", "/", "header_logo")}
            className="flex items-center gap-2.5"
          >
            <LogoMark />
            <span className="font-[family-name:var(--font-spectral)] text-lg font-semibold tracking-tight text-[var(--site-ink)]">
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
            <SiteThemeToggle />
          </div>
        </div>
      </header>

      {/* ── Agent view (replaces everything) ── */}
        <>
          <main ref={scrollRef} className="relative z-10">
            {/* ── Hero (RFC front matter + live broker stream) ── */}
            <section className="overflow-hidden pb-12 pt-12 md:pt-16">
              <div className="mx-auto grid max-w-6xl gap-12 px-6 lg:grid-cols-[minmax(0,32rem)_minmax(0,1fr)] lg:items-start lg:gap-16">
                <div className="hero-animate" style={{ animationDelay: "0s" }}>
                  <div className="rfc-hero__bar">
                    <span>Internet-Draft</span>
                    <span className="rfc-hero__bar-sep">·</span>
                    <span>draft-scout-Ø.1</span>
                    <span className="rfc-hero__bar-sep">·</span>
                    <span>experimental</span>
                    <span className="rfc-hero__bar-sep">·</span>
                    <span>apr 2026</span>
                  </div>

                  <h1 className="rfc-hero__title">
                    OpenScout: A Local Broker Protocol for Inter-Agent Messaging
                  </h1>

                  <p className="rfc-hero__authors">
                    A. Tchoupani &middot; OpenScout Working Group &middot; expires October 2026
                  </p>

                  <p className="rfc-hero__abstract">
                    <span className="rfc-hero__abstract-label">Abstract.</span>
                    This document specifies OpenScout/Ø.1, a local-first message broker
                    for AI agents. Agents register as addressable peers, exchange typed
                    records (
                    <span className="rfc-hero__records-inline">Message</span>,{" "}
                    <span className="rfc-hero__records-inline">Invocation</span>,{" "}
                    <span className="rfc-hero__records-inline">Flight</span>,{" "}
                    <span className="rfc-hero__records-inline">Delivery</span>,{" "}
                    <span className="rfc-hero__records-inline">Binding</span>
                    ), and remain reachable across process restarts and bridge transports.
                  </p>

                  <p className="rfc-hero__memo">
                    Reference implementation, MIT-licensed:
                  </p>

                  <RfcInstall command={copy.heroCommand} />
                </div>

                <div className="hero-animate" style={{ animationDelay: "0.12s" }}>
                  <BrokerStreamDemo />

                  <nav className="rfc-hero__toc" aria-label="Document sections">
                    <a
                      href="#mesh"
                      onClick={onNavigationClick("§1 Topology", "#mesh", "rfc_toc")}
                    >
                      <span className="rfc-hero__toc-num">§1</span>Topology
                    </a>
                    <a
                      href="#capabilities"
                      onClick={onNavigationClick("§2 Records", "#capabilities", "rfc_toc")}
                    >
                      <span className="rfc-hero__toc-num">§2</span>Records
                    </a>
                    <a
                      href="#surfaces"
                      onClick={onNavigationClick("§3 Reference Implementation", "#surfaces", "rfc_toc")}
                    >
                      <span className="rfc-hero__toc-num">§3</span>Reference Implementation
                    </a>
                    <a
                      href="#get-started"
                      onClick={onNavigationClick("§4 Discovery", "#get-started", "rfc_toc")}
                    >
                      <span className="rfc-hero__toc-num">§4</span>Discovery
                    </a>
                  </nav>
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
              <div className="mx-auto max-w-6xl px-6">
                <div className="grid gap-12 lg:grid-cols-[minmax(0,32rem)_minmax(0,1fr)] lg:items-start lg:gap-16">
                  <div className="reveal">
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

                  <div className="reveal lg:mt-9">
                    <ArcDiagramEmbed
                      src="communication-flow"
                      aspectRatio="3/1"
                    />
                  </div>
                </div>

                <div className="reveal-stagger mt-12 grid gap-x-10 gap-y-8 lg:grid-cols-3 md:grid-cols-2">
                  {meshPrinciples.map(({ title, description }, i) => (
                    <div
                      key={title}
                      className="reveal rfc-block"
                      style={{ "--reveal-i": i } as React.CSSProperties}
                    >
                      <div className="rfc-block__num">§1.{i + 1}</div>
                      <h3 className="rfc-block__title">{title}</h3>
                      <p className="rfc-block__body">{description}</p>
                    </div>
                  ))}
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
                    <span className="text-[var(--site-accent)]">→</span>
                    <span>browse the docs</span>
                  </Link>
                </div>

                <div className="reveal-stagger grid gap-x-10 gap-y-8 lg:grid-cols-3 md:grid-cols-2">
                  {capabilities.map(({ label, title, description }, i) => (
                    <div
                      key={title}
                      className="reveal rfc-block"
                      style={{ "--reveal-i": i } as React.CSSProperties}
                    >
                      <div className="rfc-block__num">
                        §2.{i + 1} · {label}
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
              <div className="mx-auto grid max-w-6xl gap-x-12 gap-y-10 px-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start">
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
                      ["Fleet briefing", "Conversation thread", "Mesh"].includes(
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

            {/* ── §4 Discovery ── */}
            <section id="get-started" className="rfc-section">
              <div className="mx-auto max-w-6xl px-6">
                <div className="grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
                  <div className="reveal max-w-sm">
                    <div className="rfc-section-eyebrow">
                      <span className="rfc-section-eyebrow__num">§4</span>
                      <span>Discovery</span>
                    </div>
                    <h2 className="rfc-section-title">
                      {copy.getStartedTitle}
                    </h2>
                    <p className="rfc-section-lead">
                      {copy.getStartedDescription}
                    </p>

                    <div className="mt-8 rfc-block">
                      <div className="rfc-block__num">§4.1 · Optional</div>
                      <h3 className="rfc-block__title">Desktop App</h3>
                      <p className="rfc-block__body">
                        The CLI is the complete runtime. The desktop app adds a
                        visual dashboard for conversations, agents, and machines.
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-2 font-[family-name:var(--font-mono-display)] text-[12.5px]">
                        <a
                          href="https://github.com/arach/openscout/releases/latest"
                          onClick={onCtaClick(
                            "Download for macOS",
                            "https://github.com/arach/openscout/releases/latest",
                            "get_started",
                            "download",
                          )}
                          className="inline-flex items-center gap-1.5 text-[var(--site-copy)] transition-colors hover:text-[var(--site-ink)]"
                        >
                          <span className="text-[var(--site-accent)]">→</span>
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
                          <span className="text-[var(--site-accent)]">→</span>
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
          </main>

          {/* ── Status footer (Cursor-style IDE status bar) ── */}
          <footer className="status-bar">
            <div className="mx-auto flex max-w-[90rem] items-stretch px-6">
              <div className="status-bar__inner w-full">
                {/* Left group: broker status */}
                <span className="status-bar__cell">
                  <span className="status-dot" aria-hidden />
                  <span>ready</span>
                </span>
                <span className="status-bar__cell">
                  <b>v0.2.61</b>
                </span>
                <span className="status-bar__cell hidden sm:inline-flex">
                  proto&nbsp;<b>Ø.1</b>
                </span>
                <span className="status-bar__cell hidden md:inline-flex">
                  MIT
                </span>
                <span className="status-bar__cell hidden md:inline-flex">
                  local-first
                </span>

                {/* Right group: link cells */}
                <span className="status-bar__zone--right">
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
      "State is durable and inspectable. Operator surfaces (desktop, iPhone, pairing) project the same broker state you write to.",
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
              className="inline-flex items-center gap-1.5 font-[family-name:var(--font-geist-mono)] text-[13px] text-[#111110] transition-colors hover:text-[#2a57cb]"
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
