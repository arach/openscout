"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Download,
  Layers,
  MessageSquare,
  Monitor,
  Network,
  Send,
  Shield,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { CopyCommand } from "@/components/copy-command";
import { TerminalSession } from "@/components/terminal-session";
import { ExpandableImage } from "@/components/expandable-image";
import { HeroIntentForm } from "@/components/hero-intent-form";
import { LandingProductShowcase } from "@/components/landing-product-showcase";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";
import { trackCtaClick, trackNavigationClick } from "@/lib/analytics";

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
    heroEyebrow: "Open-source agent runtime",
    heroTitleTop: "All your agents,",
    heroTitleBottom: "one message away.",
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

function LogoMark({ size = "sm" }: { size?: "sm" | "md" }) {
  const pixelSize = size === "md" ? 40 : 32;
  return (
    <span className="flex shrink-0 items-center justify-center">
      <Image
        src="/openscout-icon.png"
        alt=""
        width={pixelSize}
        height={pixelSize}
        className="rounded-[10px] shadow-[0_1px_0_rgba(255,255,255,0.3)_inset]"
      />
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
    <div className="relative isolate min-h-screen overflow-x-clip bg-[#f5f4ef] text-[#111110]">
      {/* ── hero background layers ── */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[40rem] overflow-hidden">
        <div className="hero-glow absolute inset-0" />
        <div className="dot-grid absolute inset-0" />
      </div>

      {/* ── nav ── */}
      <nav className="sticky top-0 z-50 border-b border-[#ded9cf] bg-[#f5f4ef]/95">
        <div className="mx-auto flex h-16 max-w-[90rem] items-center justify-between px-6">
          <Link
            href="/"
            onClick={onNavigationClick("Scout", "/", "header_logo")}
            className="flex items-center gap-3"
          >
            <LogoMark />
            <span className="font-[family-name:var(--font-spectral)] text-lg font-semibold tracking-tight text-[#111110]">
              Scout
            </span>
          </Link>

          <div className="hidden items-center gap-8 text-[11px] font-medium uppercase tracking-[0.12em] text-[#69675f] md:flex">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={onNavigationClick(link.label, link.href, "header_nav")}
                className="transition-colors hover:text-[#111110]"
              >
                {link.label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-3">
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
              className="hidden text-[11px] font-medium uppercase tracking-[0.12em] text-[#69675f] transition-colors hover:text-[#111110] sm:inline-flex"
            >
              GitHub
            </a>
            <Link
              href="/docs"
              onClick={onCtaClick("Read the docs", "/docs", "header_nav", "docs")}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#111110] px-4 text-sm font-medium text-[#f5f4ef] transition-colors hover:bg-[#2a2a28]"
            >
              <span>Read the docs</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Agent view (replaces everything) ── */}
        <>
          <main ref={scrollRef} className="relative z-10">
            {/* ── Hero ── */}
            <section className="overflow-hidden pb-28 pt-16 md:pt-20">
              <div className="mx-auto grid max-w-[90rem] gap-16 px-6 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] lg:items-start">
                <div className="max-w-xl">
                  <div
                    className="hero-animate landing-label text-[#2a57cb]"
                    style={{ animationDelay: "0s" }}
                  >
                    {copy.heroEyebrow}
                  </div>

                  <h1
                    className="hero-animate mt-8 min-h-[7.5rem] tracking-[-0.04em] text-[#111110] sm:min-h-[9rem] lg:min-h-[10.5rem]"
                    style={{ animationDelay: "0.04s" }}
                  >
                    <span className="block font-[family-name:var(--font-display)] text-5xl italic sm:text-6xl lg:text-[4.5rem] lg:leading-[1.05]">
                      {copy.heroTitleTop}
                    </span>
                    <span className="block text-4xl font-semibold sm:text-5xl lg:text-6xl">
                      {copy.heroTitleBottom}
                    </span>
                  </h1>

                  <p
                    className="hero-animate mt-6 min-h-[5.5rem] max-w-lg text-[17px] leading-relaxed text-[#4a4843]"
                    style={{ animationDelay: "0.1s" }}
                  >
                    {copy.heroDescription}
                  </p>

                  <div
                    className="hero-animate mt-8 flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-center"
                    style={{ animationDelay: "0.16s" }}
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <HeroIntentForm />
                      <Link
                        href="#get-started"
                        onClick={onCtaClick("Get started", "#get-started", "hero", "scroll")}
                        className="inline-flex h-11 items-center gap-2 rounded-lg border border-[#dad6cd] bg-white px-5 text-sm font-medium text-[#111110] shadow-sm transition-all hover:bg-[#faf9f4] hover:shadow"
                      >
                        <span>Get started</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                    <div className="w-full sm:w-auto sm:min-w-[200px]">
                      <CopyCommand
                        analyticsLocation="hero_command"
                        command={copy.heroCommand}
                      />
                    </div>
                  </div>

                  <p
                    className="hero-animate mt-6 text-[13px] text-[#9a978f]"
                    style={{ animationDelay: "0.22s" }}
                  >
                    {copy.heroFootnote}
                  </p>
                </div>

                <div className="hero-showcase">
                  <LandingProductShowcase audience={"general"} />
                </div>
              </div>
            </section>

            {/* ── Problem ── */}
            <section
              id="mesh"
              className="relative border-y border-[#eae6dd] bg-white py-24"
            >
              <div className="mx-auto max-w-6xl px-6">
                <div className="reveal mx-auto max-w-3xl text-center">
                  <div className="landing-label text-[#2a57cb]">
                    The Problem
                  </div>
                  <h2 className="mt-4 min-h-[3.5rem] text-3xl font-semibold tracking-[-0.04em] text-[#111110] sm:text-4xl">
                    {problemContent.meshTitle}
                  </h2>
                  <p className="mt-4 min-h-[3.5rem] text-lg leading-relaxed text-[#4d4b45]">
                    {problemContent.meshDescription}
                  </p>

                </div>

                <div className="reveal-stagger mt-16 grid gap-6 lg:grid-cols-3 md:grid-cols-2">
                  {meshPrinciples.map(
                    ({ icon: Icon, title, description }, i) => (
                      <div
                        key={title}
                        className="reveal landing-card rounded-xl p-6"
                        style={{ "--reveal-i": i } as React.CSSProperties}
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#eae6dd] bg-[#faf9f6] text-[#111110]">
                          <Icon
                            className="h-[18px] w-[18px]"
                            strokeWidth={1.6}
                          />
                        </div>
                        <h3 className="mt-5 text-lg font-semibold tracking-tight text-[#111110]">
                          {title}
                        </h3>
                        <p className="mt-2 text-[15px] leading-relaxed text-[#504d47]">
                          {description}
                        </p>
                      </div>
                    ),
                  )}
                </div>
              </div>
            </section>

            {/* ── Capabilities ── */}
            <section id="capabilities" className="py-24">
              <div className="mx-auto grid max-w-6xl gap-8 px-6 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
                <div className="reveal max-w-sm">
                  <div className="landing-label text-[#2a57cb]">
                    Capabilities
                  </div>
                  <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-[#111110]">
                    {copy.capabilitiesTitle}
                  </h2>
                  <p className="mt-4 text-[15px] leading-relaxed text-[#4d4b45]">
                    {copy.capabilitiesDescription}
                  </p>
                  <Link
                    href="/docs"
                    onClick={onCtaClick("Browse the docs", "/docs", "capabilities", "docs")}
                    className="group mt-6 inline-flex items-center gap-2 text-sm font-medium text-[#111110] transition-colors hover:text-[#2a57cb]"
                  >
                    <span>Browse the docs</span>
                    <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </Link>
                </div>

                <div className="reveal-stagger grid gap-6 lg:grid-cols-3 md:grid-cols-2">
                  {capabilities.map(
                    ({ icon: Icon, label, title, description }, i) => (
                      <div
                        key={title}
                        className="reveal landing-card rounded-xl p-5"
                        style={{ "--reveal-i": i } as React.CSSProperties}
                      >
                        <div className="landing-label text-[#9a978f]">
                          {label}
                        </div>
                        <div className="mt-3 flex h-10 w-10 items-center justify-center rounded-lg border border-[#dce4ff] bg-[#f2f5ff] text-[#2657c6]">
                          <Icon
                            className="h-[18px] w-[18px]"
                            strokeWidth={1.6}
                          />
                        </div>
                        <h3 className="mt-4 text-base font-semibold tracking-tight text-[#111110]">
                          {title}
                        </h3>
                        <p className="mt-2 text-[14px] leading-relaxed text-[#504d47]">
                          {description}
                        </p>
                      </div>
                    ),
                  )}
                </div>
              </div>
            </section>

            {/* ── Surfaces ── */}
            <section
              id="surfaces"
              className="relative border-y border-[#eae6dd] bg-[#faf9f6] py-24"
            >
              <div className="dot-grid pointer-events-none absolute inset-0" />
              <div className="relative mx-auto grid max-w-6xl gap-8 px-6 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] lg:items-start">
                <div className="reveal max-w-xl">
                  <div className="landing-label text-[#2a57cb]">Apps</div>
                  <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-[#111110] sm:text-4xl">
                    {copy.surfacesTitle}
                  </h2>
                  <p className="mt-4 text-[15px] leading-relaxed text-[#4d4b45]">
                    {copy.surfacesDescription}
                  </p>

                  <div className="mt-8 rounded-xl border border-[#eae6dd] bg-white p-5">
                    <div className="landing-label text-[#9a978f]">
                      {copy.surfacesNoteTitle}
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-[#504d47]">
                      {copy.surfacesNoteDescription}
                    </p>
                  </div>
                </div>

                <div className="reveal-stagger grid gap-6 sm:grid-cols-2">
                  {surfaceGallery.map((shot, i) => (
                    <figure
                      key={shot.src}
                      className="reveal landing-card overflow-hidden rounded-xl"
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
                      <figcaption className="border-t border-[#eae6dd] bg-[#faf9f6] px-4 py-3.5">
                        <div className="landing-label text-[#2657c6]">
                          {shot.eyebrow}
                        </div>
                        <h3 className="mt-1.5 text-base font-semibold tracking-tight text-[#111110]">
                          {shot.title}
                        </h3>
                        <p className="mt-1.5 text-[13px] leading-relaxed text-[#504d47]">
                          {shot.description}
                        </p>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            </section>

            {/* ── Get Started ── */}
            <section id="get-started" className="py-24">
              <div className="mx-auto max-w-6xl px-6">
                <div className="reveal landing-panel rounded-2xl p-8 sm:p-10 lg:p-12">
                  <div className="grid gap-12 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
                    <div className="max-w-sm">
                      <div className="landing-label text-[#2a57cb]">
                        Get Started
                      </div>
                      <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-[#111110] sm:text-4xl">
                        {copy.getStartedTitle}
                      </h2>
                      <p className="mt-4 text-[15px] leading-relaxed text-[#4d4b45]">
                        {copy.getStartedDescription}
                      </p>

                      <div className="mt-8 rounded-xl border border-[#eae6dd] bg-[#faf9f6] p-5">
                        <div className="landing-label text-[#9a978f]">
                          Optional: Desktop App
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-[#504d47]">
                          The CLI is the complete runtime. The desktop app adds a
                          visual dashboard for conversations, agents, and machines.
                        </p>
                        <div className="mt-4 flex flex-wrap items-center gap-3">
                          <a
                            href="https://github.com/arach/openscout/releases/latest"
                            onClick={onCtaClick(
                              "Download for macOS",
                              "https://github.com/arach/openscout/releases/latest",
                              "get_started",
                              "download",
                            )}
                            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#111110] px-4 text-sm font-medium text-[#f5f4ef] transition-colors hover:bg-[#2a2a28]"
                          >
                            <Download className="h-3.5 w-3.5" />
                            <span>Download for macOS</span>
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
                            className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#dad6cd] bg-white px-4 text-sm font-medium text-[#111110] transition-colors hover:bg-[#faf9f4]"
                          >
                            <span>Open on GitHub</span>
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      </div>
                    </div>

                    <TerminalSession
                      analyticsLocation="get_started_terminal"
                      steps={getStartedCommands}
                    />
                  </div>
                </div>
              </div>
            </section>
          </main>

          {/* ── Footer ── */}
          <footer className="px-6 pb-20">
            <div className="mx-auto max-w-[90rem] border-t border-[#eae6dd]">
              <div className="flex items-center justify-between py-4">
                <div className="flex items-center gap-2.5 text-[#9a978f]">
                  <LogoMark />
                  <span className="font-[family-name:var(--font-spectral)] text-sm font-semibold tracking-tight">Scout</span>
                </div>
                <div className="flex gap-5 font-[family-name:var(--font-geist-mono)] text-[10px] uppercase tracking-[0.1em] text-[#9a978f]">
                  <a
                    href="/docs"
                    onClick={onNavigationClick("Docs", "/docs", "footer")}
                    className="transition-colors hover:text-[#111110]"
                  >
                    Docs
                  </a>
                  <a
                    href="/privacy"
                    onClick={onNavigationClick("Privacy", "/privacy", "footer")}
                    className="transition-colors hover:text-[#111110]"
                  >
                    Privacy
                  </a>
                  <a
                    href="https://github.com/arach/openscout"
                    onClick={onCtaClick(
                      "GitHub",
                      "https://github.com/arach/openscout",
                      "footer",
                      "repo",
                    )}
                    className="transition-colors hover:text-[#111110]"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    GitHub
                  </a>
                  <a
                    href="https://x.com/arach"
                    onClick={onCtaClick("Twitter", "https://x.com/arach", "footer", "social")}
                    className="transition-colors hover:text-[#111110]"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Twitter
                  </a>
                </div>
              </div>
            </div>
          </footer>
        </>

      {/* ── Floating bottom nav ── */}
      <nav className="fixed bottom-5 left-1/2 z-[60] hidden -translate-x-1/2 animate-in md:flex" style={{ animationDelay: "0.4s" }}>
        <div className="flex items-center gap-0.5 rounded-full border border-[#2a2a28] bg-[#111110]/96 p-1 shadow-lg">
          {[
            ["How it works", "#mesh"],
            ["Features", "#capabilities"],
            ["Apps", "#surfaces"],
            ["Get Started", "#get-started"],
            ["Docs", "/docs"],
            ["Privacy", "/privacy"],
            ["GitHub", "https://github.com/arach/openscout"],
          ].map(([label, href]) => (
            <a
              key={label}
              href={href}
              onClick={
                href.startsWith("http")
                  ? onCtaClick(label, href, "floating_nav", label.toLowerCase())
                  : onNavigationClick(label, href, "floating_nav")
              }
              {...(href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="rounded-full px-3.5 py-1.5 font-[family-name:var(--font-geist-mono)] text-[10px] uppercase tracking-[0.08em] text-[#8b887f] transition-colors hover:bg-[#2a2a28] hover:text-[#f5f4ef]"
            >
              {label}
            </a>
          ))}

        </div>
      </nav>

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
