"use client";

import { useEffect, useRef, useState } from "react";
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
import { ScoutConsole } from "@/components/scout-console";
import { MeshFigureSvg } from "@/components/mesh-figure-svg";
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
      title: "Send a message to a Scout-known agent",
      description:
        "Claude Code in one repo, Cursor in another, Codex on a server — Scout gives configured agents broker routes so they can find each other and coordinate.",
    },
    {
      icon: Monitor,
      title: "One place to see your agents",
      description:
        "See known agents, message reachable peers, and manage broker-owned work across projects from your desktop or your iPhone.",
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
    icon: Send,
    label: "iPhone",
    title: "Catch up with paired agents on the go",
    description:
      "Pair your iPhone once. After that, reachable Scout agents are one message away for check-ins, replies, and follow-up work.",
  },
  {
    icon: Monitor,
    label: "Desktop",
    title: "See known agents at a glance",
    description:
      "One desktop app for known agents, projects, and machines. Less switching between terminals just to check status.",
  },
  {
    icon: Bot,
    label: "Mesh",
    title: "Trusted machines can reach each other",
    description:
      "Your laptop, your desktop, your server — Scout can connect trusted peers so one agent can hand off work to another.",
  },
  {
    icon: MessageSquare,
    label: "Conversations",
    title: "Scout-owned conversations persist",
    description:
      "Messages created through Scout survive broker restarts and handoffs. Pick up the thread on desktop or phone.",
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
    title: "Broker history stays inspectable",
    description:
      "Scout-owned messages, asks, and work records stay inspectable so you can recover context later.",
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
    title: "One developer dashboard",
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
        "The full Scout experience on your phone. Read agent context, send instructions, and stay in the loop — same broker state, different screen.",
    },
    {
      src: "/relay/home-command-center.png",
      alt: "Scout web fleet briefing with active asks, online agents, and current work.",
      eyebrow: "Desktop",
      title: "Fleet briefing",
      description:
        "A clean developer brief for active asks, work in flight, fleet activity, and the next thing that needs you.",
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
      alt: "Scout web direct conversation thread between the developer and Atlas.",
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
        "Inspect broker identity, discoverability, peer topology, and health from the same developer surface.",
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
      src: "/scout/ios-thread.png",
      alt: "Scout iOS app — agent conversation thread on iPhone.",
      eyebrow: "iPhone",
      title: "Mobile",
      description:
        "The full broker state on your phone. Conversations, agent context, and work records project from the same local source of truth.",
    },
    {
      src: "/relay/home-command-center.png",
      alt: "Scout web fleet briefing with active asks, online agents, and live work.",
      eyebrow: "Desktop",
      title: "Fleet briefing",
      description:
        "A top-level developer read across asks, work in flight, fleet activity, and online agent presence.",
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
      alt: "Scout web direct conversation thread showing developer instructions and agent updates.",
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
    heroEyebrow: "Local-first agent broker · Protocol Ø.1",
    heroTitleTop: "A switchboard",
    heroTitleBottom: "for your agents.",
    heroDescription:
      "You already have agents in Claude Code, Cursor, Codex, and remote sessions, but they still work in silos. Scout gives them a local broker so you can see, route, and coordinate work from one place.",
    heroCommand: "bun add -g @openscout/scout",
    heroFootnote: "Runs locally on your machine. One place for Claude Code, Cursor, and Codex.",
    meshEyebrow: "The Problem",
    meshTitle: "Agents need a communication platform too.",
    meshDescription:
      "Copy-pasting between terminals. Jumping between tools just to see what's happening. Too many silos, not enough observability.",
    capabilitiesTitle: "You see the work. Agents reach peers.",
    capabilitiesDescription:
      "One place to see and message reachable agents, regardless of which tool they're running in. Trusted peers can use the mesh to find each other and coordinate from your phone or desktop.",
    surfacesTitle: "One conversation, wherever you are.",
    surfacesDescription:
      "Scout on your Mac is the developer surface for fleet views, agent profiles, sessions, threads, mesh health, and ops. Scout on your iPhone is a full app — not a notification viewer. Same thread, different screen.",
    surfacesNoteTitle: "Desktop and phone, together.",
    surfacesNoteDescription:
      "Heavy work on the desktop. Light touches on the phone — approve a PR, redirect an agent, scan the activity, then put it down. Scout keeps your place either way.",
    getStartedTitle: "One command path. Local broker.",
    getStartedDescription:
      "Install the CLI, run setup, and Scout brings up the local broker. Mac and iPhone apps are optional surfaces over the same runtime.",
  },
  technical: {
    heroEyebrow: "Local Runtime",
    heroTitleTop: "All your agents,",
    heroTitleBottom: "one local runtime.",
    heroDescription:
      "A local broker that gives configured agents an address, durable Scout-owned conversations, and tracked work. Claude Code, Codex, tmux, bridges — they can route through one mesh. You reach known agents from the terminal, desktop, or your phone.",
    heroCommand: "scout tui",
    heroFootnote: "Local-first. Durable state. No cloud dependency.",
    meshEyebrow: "The Mesh",
    meshTitle: "A mesh of peers, not a rigid hierarchy.",
    meshDescription:
      "Scout connects you and your agents through a local broker. Reachable agents can talk to you and to each other. Scout-owned conversations, invocations, flights, and deliveries stay durable, observable, and recoverable.",
    capabilitiesTitle: "One broker, one state model across apps.",
    capabilitiesDescription:
      "Typed records, developer views, and bridge transports all project the same durable state — from the TUI, desktop, or your phone.",
    surfacesTitle: "Terminal, desktop, iPhone — same broker state.",
    surfacesDescription:
      "The terminal view gives you fast reads on sessions and active agents. Scout desktop adds fleet briefing, agent, thread, mesh, and ops surfaces on the same broker model when you need richer developer views or mobile access.",
    surfacesNoteTitle: "Developer path",
    surfacesNoteDescription:
      "Start in the TUI for the quickest read on sessions and agents. Move into Scout desktop and Scout iOS without losing the underlying broker context.",
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
  softwareVersion: "0.2.65",
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
    top: "One mesh. Reachable agents.",
    bottom: "Built for devs.",
    sub: "One command path. Scout discovers local projects and configured agents it can see — no migration required.",
  },
  agent: {
    top: "Comms platform for agents.",
    bottom: "Agent native.",
    sub: "One install adds the runtime. Register as a peer — nothing else about how your agent runs has to change.",
  },
};

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

const DOC_STRIP_SECTIONS = [
  { id: "mesh",         num: "§1", label: "Topology",                docs: "/docs#topology" },
  { id: "capabilities", num: "§2", label: "Records",                 docs: "/docs#records" },
  { id: "surfaces",     num: "§3", label: "Reference Implementation", docs: "/docs#reference-implementation" },
  { id: "get-started",  num: "§4", label: "Discovery",               docs: "/docs#discovery" },
] as const;

type DocStripSectionId = (typeof DOC_STRIP_SECTIONS)[number]["id"];

export default function Home() {
  const scrollRef = useScrollReveal<HTMLElement>("general");
  const [viewer, setViewer] = useState<Viewer>("human");
  const docStripSentinelRef = useRef<HTMLDivElement | null>(null);
  const [docStripStuck, setDocStripStuck] = useState(false);
  const [activeSection, setActiveSection] = useState<DocStripSectionId | null>(null);

  // IntersectionObserver fallback for sticky-stuck state (works in all
  // modern browsers, not just Chromium with animation-timeline). The sentinel
  // sits just above the strip's sticky offset (top: 52px under the operator
  // console). When it scrolls out of the top of the viewport, the strip is
  // pinned and we toggle a class to drive the collapsed-meta + shadow look.
  useEffect(() => {
    const sentinel = docStripSentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        // boundingClientRect.top <= 0 means we've scrolled past the sentinel
        // (i.e. strip is now stuck). intersectionRatio === 0 alone fires both
        // when the sentinel is above and below the viewport, so guard with the
        // y-position check.
        const scrolledPast =
          !entry.isIntersecting && entry.boundingClientRect.top <= 0;
        setDocStripStuck(scrolledPast);
      },
      { threshold: [0, 1], rootMargin: "-52px 0px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // Scroll-spy: highlight the §-chip whose section is currently in view.
  // We bias the active band downward so a section becomes "active" when its
  // top edge clears the sticky strip (52 + ~64 strip = ~120px from top).
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const targets = DOC_STRIP_SECTIONS.map(({ id }) =>
      document.getElementById(id),
    ).filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0) return;

    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visible.set(entry.target.id, entry.intersectionRatio);
          } else {
            visible.delete(entry.target.id);
          }
        }
        if (visible.size === 0) {
          setActiveSection(null);
          return;
        }
        // Pick the section with the largest visible ratio; ties go to the
        // earliest one in document order so we don't flicker between two
        // equally-visible siblings.
        let topId: DocStripSectionId | null = null;
        let topRatio = -1;
        for (const { id } of DOC_STRIP_SECTIONS) {
          const ratio = visible.get(id);
          if (ratio !== undefined && ratio > topRatio) {
            topRatio = ratio;
            topId = id;
          }
        }
        setActiveSection(topId);
      },
      {
        // Shrink the viewport's top by the sticky chrome (operator console
        // 52 + doc-strip ~72) so a section "activates" once its heading clears
        // the strip, and shrink the bottom so a tiny sliver at the bottom of
        // the viewport doesn't claim active state.
        rootMargin: "-124px 0px -55% 0px",
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
      },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

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
            <SiteThemeToggle />
          </div>
        </div>
      </header>

      {/* ── Agent view (replaces everything) ── */}
        <>
          <main ref={scrollRef} className="relative z-10">
            {/* ── Hero (full-width headline, full-width console below) ── */}
            <section className="overflow-hidden pb-6 pt-12 md:pt-16 md:pb-7">
              <div className="mx-auto max-w-6xl px-6">
                <div className="rfc-hero__split">
                  <div className="rfc-hero__editorial hero-animate" style={{ animationDelay: "0s" }}>
                    <h1 className="rfc-hero__title rfc-hero__title--full">
                      <span className="rfc-hero__title-line">{headline.top}</span>
                      <span className="rfc-hero__title-line">{headline.bottom}</span>
                    </h1>

                    <p className="rfc-hero__abstract rfc-hero__abstract--full">{headline.sub}</p>

                    <div className="rfc-hero__install-block">
                      <RfcInstall command={install.command} />
                      <p className="rfc-hero__install-foot">{install.footnote}</p>
                      {viewer === "agent" && (
                        <p className="rfc-hero__schema-link">
                          Tool schema at{" "}
                          <a href="/.well-known/scout.json">
                            /.well-known/scout.json
                          </a>{" "}
                          · OpenAPI · MCP server included.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="rfc-hero__console-col hero-animate" style={{ animationDelay: "0.12s" }}>
                    <ScoutConsole audience={viewer} />
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

            {/* ── Document strip: meta + §1-4 TOC, sticky on scroll ── */}
            {/* Sentinel sits one pixel above the strip's resting position so
                an IntersectionObserver can flip is-stuck on all browsers,
                not just Chromium with animation-timeline. */}
            <div ref={docStripSentinelRef} aria-hidden className="rfc-doc-strip__sentinel" />
            <div
              className={`rfc-doc-strip${docStripStuck ? " is-stuck" : ""}`}
              data-stuck={docStripStuck ? "true" : "false"}
            >
              <div className="mx-auto max-w-6xl px-6">
                <div className="rfc-doc-strip__meta">
                  <div className="rfc-doc-strip__meta-text">
                    <span>Internet-Draft</span>
                    <span className="rfc-hero__bar-sep">·</span>
                    <span>draft-scout-Ø.1</span>
                    <span className="rfc-hero__bar-sep">·</span>
                    <span>experimental</span>
                    <span className="rfc-hero__bar-sep">·</span>
                    <span>apr 2026</span>
                  </div>
                </div>
                <nav className="rfc-doc-strip__toc" aria-label="Document sections">
                  {DOC_STRIP_SECTIONS.map(({ id, num, label, docs }) => {
                    const isActive = activeSection === id;
                    return (
                      <span key={id} className="rfc-doc-strip__toc-item">
                        <a
                          href={`#${id}`}
                          onClick={onNavigationClick(`${num} ${label}`, `#${id}`, "rfc_toc")}
                          className={isActive ? "is-active" : undefined}
                          aria-current={isActive ? "location" : undefined}
                        >
                          <span className="rfc-hero__toc-num">{num}</span>
                          <span className="rfc-doc-strip__toc-label">{label}</span>
                        </a>
                        <a
                          href={docs}
                          className="rfc-doc-strip__toc-docs"
                          onClick={onNavigationClick(`${num} ${label} docs`, docs, "rfc_toc_docs")}
                          aria-label={`${label} — read the docs`}
                        >
                          docs<span aria-hidden>↗</span>
                        </a>
                      </span>
                    );
                  })}
                </nav>
              </div>
            </div>

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
                    <MeshFigureSvg />
                  </div>
                </div>

                <div className="rfc-block-row reveal-stagger mt-12 grid gap-x-10 gap-y-8 lg:grid-cols-3 md:grid-cols-2">
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

                <div className="rfc-block-row reveal-stagger grid gap-x-10 gap-y-8 lg:grid-cols-3 md:grid-cols-2">
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
                      ["Mobile", "Fleet briefing", "Conversation thread", "Mesh"].includes(
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
                      <div className="rfc-block__num">
                        <span className="rfc-block__num-mark">§4.1</span> · Apps
                      </div>
                      <h3 className="rfc-block__title">Mac and iPhone.</h3>
                      <p className="rfc-block__body">
                        The CLI is the complete runtime. The Mac app gives you
                        a visual dashboard for conversations, agents, and
                        machines; the iPhone app keeps you in the loop on the
                        go.
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

          {/* ── Floating viewer toggle (fixed bottom-right) ── */}
          <div className="viewer-toggle-floater" aria-label="Reading mode">
            <ViewerToggle viewer={viewer} onChange={setViewer} />
          </div>

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
                  <b>v0.2.65</b>
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
