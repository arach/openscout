"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Layers,
  MessageSquare,
  Monitor,
  Network,
  Send,
  Shield,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { CopyCommand, CopyCommandBlock } from "@/components/copy-command";
import { ExpandableImage } from "@/components/expandable-image";
import { LandingProductShowcase } from "@/components/landing-product-showcase";
import { useScrollReveal } from "@/hooks/use-scroll-reveal";

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
  { label: "Problem", href: "#mesh" },
  { label: "Capabilities", href: "#capabilities" },
  { label: "Surfaces", href: "#surfaces" },
  { label: "Get Started", href: "#get-started" },
] as const;


type ProblemVariant = {
  meshTitle: string;
  meshDescription: string;
  cards: IconCard[];
};

const problemVariants: ProblemVariant[] = [
  // ── Variation A: Structural gap ──
  {
    meshTitle: "Your agents are siloed.",
    meshDescription:
      "To date, every multi-agent feature — swarms, orchestration, teams — has been scoped to a single project with a rigid hierarchy. But your agents span projects, tools, and runtimes. Nothing connects them across that boundary.",
    cards: [
      {
        icon: Network,
        title: "No discovery",
        description:
          "An agent has no way to know what other agents exist on your machine, what they're working on, or how to reach them.",
      },
      {
        icon: Layers,
        title: "No communication",
        description:
          "You can't say \"ask the agent on the iOS side.\" There's no channel between them. You are the channel.",
      },
      {
        icon: Shield,
        title: "No presence",
        description:
          "Nothing announces itself. Nothing is findable. An agent running in the next terminal might as well not exist.",
      },
    ],
  },
  // ── Variation B: First-person agent perspective ──
  {
    meshTitle: "\"I have no idea who else is running right now.\"",
    meshDescription:
      "That's what every agent on your machine would tell you. They can't see who's around, can't ask for help, and can't be asked. You end up being the only one who knows the full picture.",
    cards: [
      {
        icon: Network,
        title: "I can't see who's around",
        description:
          "Right now I know about this repo because I was told. I have no idea what other agents are running on this machine, or what they know.",
      },
      {
        icon: Layers,
        title: "I can't ask for help",
        description:
          "If another agent already solved the problem I'm hitting, I have no way to find that out. I'll rediscover it from scratch or you'll have to tell me.",
      },
      {
        icon: Shield,
        title: "I can't be found",
        description:
          "If another agent needs what I know, it can't reach me. There's no way to look me up, no way to hand off, no way to refer.",
      },
    ],
  },
  // ── Variation C: Concrete scenario ──
  {
    meshTitle: "You're the router between agents that can't find each other.",
    meshDescription:
      "You have agents everywhere but none of them know about the others. You end up being the one who connects them — copying context, pointing one at another's output, and bridging gaps that shouldn't exist.",
    cards: [
      {
        icon: Network,
        title: "\"Ask the agent working on the iOS side\"",
        description:
          "You can't say this. There's no way to point one agent at another. So you copy the answer yourself and paste it into the other terminal.",
      },
      {
        icon: Layers,
        title: "\"What are all my active agents right now?\"",
        description:
          "You don't know. Nobody knows. There's no inventory of what's running, what's idle, and what each one is working on.",
      },
      {
        icon: Shield,
        title: "\"We already figured this out yesterday\"",
        description:
          "An agent solved this exact problem in another session. But today's agent starts fresh. The knowledge exists on your machine — it's just locked in a dead session.",
      },
    ],
  },
];

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
    icon: MessageSquare,
    label: "Relay",
    title: "Live work stays in sync",
    description:
      "Sessions, search, messages, and activity stay aligned in one operator surface instead of scattering across tools.",
  },
  {
    icon: Send,
    label: "Dispatch",
    title: "Companion pairing",
    description:
      "Bring a phone or companion device into the loop without turning it into a separate backend or a separate product.",
  },
  {
    icon: Monitor,
    label: "Desktop",
    title: "One place to supervise",
    description:
      "Move between conversations, machines, tasks, and runtime health from a single desktop shell.",
  },
  {
    icon: Bot,
    label: "Agents",
    title: "Known agents and devices",
    description:
      "See which repos, agents, and machines belong to your local system and how they are connected.",
  },
  {
    icon: Workflow,
    label: "Bridges",
    title: "New surfaces fit naturally",
    description:
      "Voice, Telegram, webhooks, and future companion surfaces can plug into the same flow instead of starting from scratch.",
  },
  {
    icon: Activity,
    label: "History",
    title: "Inspectable runtime state",
    description:
      "Messages, tasks, and machine state remain visible after restarts, failures, and handoffs.",
  },
];

const technicalCapabilities: CapabilityCard[] = [
  {
    icon: MessageSquare,
    label: "Relay",
    title: "Broker-backed conversations",
    description:
      "Relay read/watch, the TUI, and direct sends stay fast while projecting the same durable broker state.",
  },
  {
    icon: Monitor,
    label: "Shell",
    title: "One operator surface",
    description:
      "Inspect conversations, tasks, flights, machines, and runtime health from a single desktop dashboard.",
  },
  {
    icon: Workflow,
    label: "Protocol",
    title: "Explicit work records",
    description:
      "Messages, invocations, flights, deliveries, and bindings share one typed contract across surfaces and agents.",
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
      command: "bun add -g @openscout/cli",
      label: "Install the public OpenScout CLI with Bun.",
    },
    {
      command: "openscout init",
      label:
        "Bootstrap local settings, discover projects, register agents, and bring the broker online.",
    },
    {
      command: "openscout dispatch pair",
      label:
        "Pair a companion device into Dispatch when you want the mobile and host surface in the loop.",
    },
    {
      command: "openscout relay watch --as myagent",
      label:
        "Drop into Relay when you want the broker-native operator surface and direct agent traffic.",
    },
  ],
  technical: [
    {
      command: "bun add -g @openscout/cli",
      label: "Install the OpenScout CLI with Bun.",
    },
    {
      command: "openscout init",
      label:
        "Materialize machine-local settings, discover projects, register agents, and bring the broker online.",
    },
    {
      command: "openscout relay tui",
      label:
        "Start with the fast compatibility surface when you want broker state, active agents, and sessions in the terminal.",
    },
    {
      command: "openscout relay watch --as myagent",
      label:
        "Keep a watcher attached when you want direct agent traffic and broker-native collaboration.",
    },
  ],
};

const surfaceGalleryByAudience: Record<HumanAudienceMode, SurfaceShot[]> = {
  general: [
    {
      src: "/relay/sessions-index.png",
      alt: "OpenScout Relay sessions index captured March 31, 2026 at 11:53:59 AM",
      eyebrow: "Relay",
      title: "Sessions",
      description:
        "Browse project and direct-session history from the broker-backed index instead of reconstructing context by hand.",
    },
    {
      src: "/relay/search-view.png",
      alt: "OpenScout Relay search view captured March 31, 2026 at 11:54:04 AM",
      eyebrow: "Relay",
      title: "Search",
      description:
        "Full-text search across sessions, messages, tags, and agents with scope and time filters.",
    },
    {
      src: "/relay/machines-view.png",
      alt: "OpenScout Relay machines view captured March 31, 2026 at 11:53:55 AM",
      eyebrow: "Relay",
      title: "Machines",
      description:
        "Inspect nodes, reachable endpoints, projects, and machine-level runtime health in one place.",
    },
    {
      src: "/dispatch/pair-mode.png",
      alt: "OpenScout Dispatch pair mode captured March 31, 2026 at 10:17:29 AM",
      eyebrow: "Dispatch",
      title: "Pair mode",
      description:
        "Keep pairing, bridge logs, and runtime settings on the companion host surface instead of overloading Relay.",
    },
  ],
  technical: [
    {
      src: "/relay-tui.png",
      alt: "OpenScout Relay terminal interface showing active agents and recent sessions.",
      eyebrow: "Relay TUI",
      title: "Terminal console",
      description:
        "The fast compatibility surface for operators who want broker state, sessions, and active agents in the terminal first.",
      imageClassName: "aspect-[1004/649] w-full object-cover object-top",
      width: 1004,
      height: 649,
    },
    {
      src: "/relay/home-command-center.png",
      alt: "OpenScout Relay command center captured March 31, 2026 at 11:53:45 AM",
      eyebrow: "Relay",
      title: "Command center",
      description:
        "Jump from the TUI into richer Relay views when you want indexed sessions, runtime sync, and launch messaging.",
    },
    {
      src: "/relay/machines-view.png",
      alt: "OpenScout Relay machines view captured March 31, 2026 at 11:53:55 AM",
      eyebrow: "Relay",
      title: "Machines",
      description:
        "Inspect reachable endpoints, project counts, runtime endpoints, and machine-level health as live infrastructure.",
    },
    {
      src: "/dispatch/pair-mode.png",
      alt: "OpenScout Dispatch pair mode captured March 31, 2026 at 10:17:29 AM",
      eyebrow: "Dispatch",
      title: "Pair mode",
      description:
        "Keep pairing, bridge logs, and runtime settings in a dedicated companion host surface instead of leaking them into Relay.",
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
    heroEyebrow: "OpenScout System",
    heroTitleTop: "All your agents,",
    heroTitleBottom: "connected.",
    heroDescription:
      "OpenScout keeps your agents, tools, and companion surfaces connected on one local system. Conversations, tasks, and runtime state stay visible instead of disappearing into tabs, terminals, and background services.",
    heroCommand: "bun add -g @openscout/cli",
    heroFootnote: "Open source. Local-first.",
    meshEyebrow: "The Problem",
    meshTitle: "You're the router between agents that can't find each other.",
    meshDescription:
      "You have agents everywhere but none of them know about the others. You end up being the one who connects them — copying context, pointing one at another's output, and bridging gaps that shouldn't exist.",
    capabilitiesTitle: "Messaging, pairing, and runtime state stay aligned.",
    capabilitiesDescription:
      "Every surface sits on top of the same local system, so the product feels coherent instead of stitched together.",
    surfacesTitle: "Relay, Dispatch, and companion views stay in sync.",
    surfacesDescription:
      "Start with the current product surfaces, then inspect each screenshot in detail without leaving the page.",
    surfacesNoteTitle: "Why This Matters",
    surfacesNoteDescription:
      "Relay handles live agent work and search. Dispatch handles pairing and companion hosting. New surfaces can slot into the same system over time.",
    getStartedTitle: "Install once. Move between surfaces cleanly.",
    getStartedDescription:
      "The public flow should stay simple: install OpenScout, bootstrap the local mesh, pair Dispatch when you need a companion surface, and drop into Relay when you want the lower-level operator view.",
  },
  technical: {
    heroEyebrow: "Broker-Backed Runtime",
    heroTitleTop: "The local broker",
    heroTitleBottom: "for your AI agents.",
    heroDescription:
      "Broker-backed local communication and execution for Claude, Codex, tmux, bridges, and companion surfaces. Persistent conversations, explicit invocations, tracked agent flights, and inspectable runtime state — all without digging through terminal scrollback.",
    heroCommand: "openscout relay tui",
    heroFootnote: "Broker-backed. Durable. Inspectable.",
    meshEyebrow: "The Mesh",
    meshTitle: "A mesh of peers, not a rigid agent hierarchy.",
    meshDescription:
      "OpenScout connects your agents through a local broker so any agent can talk to any other agent, while conversation and work state stay durable, observable, and recoverable.",
    capabilitiesTitle: "The broker, runtime, and surfaces line up.",
    capabilitiesDescription:
      "Typed records, operator views, and bridge surfaces all project the same durable state.",
    surfacesTitle: "Start in the TUI, then move outward.",
    surfacesDescription:
      "Technical mode leads with the fast compatibility surface, then fans out into Relay and Dispatch views that sit on the same broker model.",
    surfacesNoteTitle: "Operator Path",
    surfacesNoteDescription:
      "Start in the Relay TUI when you want the quickest read on sessions and active agents. Move into richer Relay views and Dispatch without losing the underlying broker context.",
    getStartedTitle: "Install once. Start with the terminal.",
    getStartedDescription:
      "The operator flow should stay direct: install OpenScout, bootstrap the local mesh, open the Relay TUI, and keep a watcher running when you want direct agent traffic.",
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
  const [audience, setAudience] = useState<AudienceMode>("general");
  const [problemVariant, setProblemVariant] = useState(0);
  const scrollRef = useScrollReveal<HTMLElement>(`${problemVariant}-${audience}`);

  // Keyboard toggle: 1/2/3 to switch problem variations
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "1") setProblemVariant(0);
      if (e.key === "2") setProblemVariant(1);
      if (e.key === "3") setProblemVariant(2);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const humanMode: HumanAudienceMode =
    audience === "technical" ? "technical" : "general";
  const copy = audienceContent[humanMode];
  const currentProblem = problemVariants[problemVariant];
  const meshPrinciples =
    humanMode === "technical"
      ? technicalMeshPrinciples
      : currentProblem.cards;
  const capabilities =
    humanMode === "technical" ? technicalCapabilities : generalCapabilities;
  const surfaceGallery = surfaceGalleryByAudience[humanMode];
  const getStartedCommands = getStartedCommandsByAudience[humanMode];
  return (
    <div className="min-h-screen bg-[#f5f4ef] text-[#111110]">
      {/* ── hero background layers ── */}
      <div className="hero-glow pointer-events-none fixed inset-x-0 top-0 z-0 h-[40rem]" />
      <div className="dot-grid pointer-events-none fixed inset-x-0 top-0 z-0 h-[40rem]" />

      {/* ── nav ── */}
      <nav className="fixed inset-x-0 top-0 z-50 border-b border-[#ded9cf]/60 bg-[#f5f4ef]/80 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-16 max-w-[90rem] items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-3">
            <LogoMark />
            <span className="text-base font-semibold tracking-tight text-[#111110]">
              OpenScout
            </span>
          </Link>

          <div className="hidden items-center gap-8 text-sm font-medium text-[#69675f] md:flex">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
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
              className="hidden text-sm font-medium text-[#69675f] transition-colors hover:text-[#111110] sm:inline-flex"
            >
              GitHub
            </a>
            <Link
              href="/docs/relay"
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#111110] px-4 text-sm font-medium text-[#f5f4ef] transition-colors hover:bg-[#2a2a28]"
            >
              <span>Read the docs</span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Agent view (replaces everything) ── */}
      {audience === "agent" ? (
        <AgentView onExit={() => setAudience("general")} />
      ) : (
        <>
          <main ref={scrollRef} className="relative z-10">
            {/* ── Hero ── */}
            <section className="overflow-hidden pt-32 pb-28">
              <div className="mx-auto grid max-w-[90rem] gap-16 px-6 lg:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] lg:items-start">
                <div className="max-w-xl">
                  <div className="hero-animate">
                    <AudienceToggle
                      audience={audience}
                      onChange={setAudience}
                    />
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
                    <CopyCommand command={copy.heroCommand} />
                    <Link
                      href="#get-started"
                      className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#dad6cd] bg-white px-4 text-sm font-medium text-[#111110] shadow-sm transition-all hover:bg-[#faf9f4] hover:shadow"
                    >
                      <span>Get started</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>

                  <p
                    className="hero-animate mt-6 text-[13px] text-[#9a978f]"
                    style={{ animationDelay: "0.22s" }}
                  >
                    {copy.heroFootnote}
                  </p>
                </div>

                <div className="hero-showcase">
                  <LandingProductShowcase audience={humanMode} />
                </div>
              </div>
            </section>

            {/* ── Problem ── */}
            <section
              id="mesh"
              className="relative border-y border-[#eae6dd] bg-white py-28"
            >
              <div className="mx-auto max-w-[90rem] px-6">
                <div className="reveal mx-auto max-w-3xl text-center">
                  <div className="landing-label text-[#2a57cb]">
                    {humanMode === "technical"
                      ? copy.meshEyebrow
                      : "The Problem"}
                  </div>
                  <h2 className="mt-4 min-h-[3.5rem] text-3xl font-semibold tracking-[-0.04em] text-[#111110] sm:text-4xl">
                    {humanMode === "technical"
                      ? copy.meshTitle
                      : currentProblem.meshTitle}
                  </h2>
                  <p className="mt-4 min-h-[3.5rem] text-lg leading-relaxed text-[#4d4b45]">
                    {humanMode === "technical"
                      ? copy.meshDescription
                      : currentProblem.meshDescription}
                  </p>

                  {/* Variant indicator — only in general mode */}
                  {humanMode === "general" && (
                    <div className="mt-6 inline-flex items-center gap-1.5">
                      {problemVariants.map((_, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setProblemVariant(i)}
                          className={`flex h-7 w-7 items-center justify-center rounded-md font-[family-name:var(--font-geist-mono)] text-[11px] font-medium transition-colors ${
                            problemVariant === i
                              ? "bg-[#111110] text-[#f5f4ef]"
                              : "text-[#9a978f] hover:bg-[#eae6dd]"
                          }`}
                        >
                          {i + 1}
                        </button>
                      ))}
                      <span className="ml-2 font-[family-name:var(--font-geist-mono)] text-[11px] text-[#b5b1a8]">
                        press 1 / 2 / 3
                      </span>
                    </div>
                  )}
                </div>

                <div className="reveal-stagger mt-16 grid gap-5 md:grid-cols-3">
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
            <section id="capabilities" className="py-28">
              <div className="mx-auto grid max-w-[90rem] gap-12 px-6 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
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
                    href="/docs/relay"
                    className="group mt-6 inline-flex items-center gap-2 text-sm font-medium text-[#111110] transition-colors hover:text-[#2a57cb]"
                  >
                    <span>Read the Relay docs</span>
                    <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </Link>
                </div>

                <div className="reveal-stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
              className="relative border-y border-[#eae6dd] bg-[#faf9f6] py-28"
            >
              <div className="dot-grid pointer-events-none absolute inset-0" />
              <div className="relative mx-auto grid max-w-[90rem] gap-12 px-6 lg:grid-cols-[minmax(0,28rem)_minmax(0,1fr)] lg:items-start">
                <div className="reveal max-w-xl">
                  <div className="landing-label text-[#2a57cb]">Surfaces</div>
                  <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-[#111110] sm:text-4xl">
                    {copy.surfacesTitle}
                  </h2>
                  <p className="mt-4 text-[15px] leading-relaxed text-[#4d4b45]">
                    {copy.surfacesDescription}
                  </p>

                  <div className="mt-8 rounded-xl border border-[#eae6dd] bg-white/90 p-5 backdrop-blur-sm">
                    <div className="landing-label text-[#9a978f]">
                      {copy.surfacesNoteTitle}
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-[#504d47]">
                      {copy.surfacesNoteDescription}
                    </p>
                  </div>
                </div>

                <div className="reveal-stagger grid gap-4 sm:grid-cols-2">
                  {surfaceGallery.map((shot, i) => (
                    <figure
                      key={shot.src}
                      className="reveal landing-card overflow-hidden rounded-xl"
                      style={{ "--reveal-i": i } as React.CSSProperties}
                    >
                      <ExpandableImage
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
            <section id="get-started" className="py-28">
              <div className="mx-auto max-w-[90rem] px-6">
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
                          Repo Dev Mode
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-[#504d47]">
                          Want the full desktop shell? Clone the repo and
                          relaunch the local app wrapper from source.
                        </p>
                        <div className="mt-4 flex flex-wrap items-center gap-3">
                          <a
                            href="https://github.com/arach/openscout"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#111110] px-4 text-sm font-medium text-[#f5f4ef] transition-colors hover:bg-[#2a2a28]"
                          >
                            <span>Open on GitHub</span>
                            <ArrowUpRight className="h-3.5 w-3.5" />
                          </a>
                          <Link
                            href="/docs/relay"
                            className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#dad6cd] bg-white px-4 text-sm font-medium text-[#111110] transition-colors hover:bg-[#faf9f4]"
                          >
                            <span>Read setup docs</span>
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {getStartedCommands.map(({ command, label }) => (
                        <CopyCommandBlock
                          key={command}
                          command={command}
                          label={label}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </main>

          {/* ── Footer ── */}
          <footer className="px-6 pb-20">
            <div className="mx-auto max-w-[90rem] border-t border-[#eae6dd]">
              <div className="flex items-center justify-between py-4">
                <div className="flex items-center gap-2.5 font-[family-name:var(--font-geist-mono)] text-[10px] uppercase tracking-[0.1em] text-[#9a978f]">
                  <LogoMark />
                  <span>OpenScout</span>
                </div>
                <div className="flex gap-5 font-[family-name:var(--font-geist-mono)] text-[10px] uppercase tracking-[0.1em] text-[#9a978f]">
                  <a
                    href="/docs/relay"
                    className="transition-colors hover:text-[#111110]"
                  >
                    Docs
                  </a>
                  <a
                    href="https://github.com/arach/openscout"
                    className="transition-colors hover:text-[#111110]"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    GitHub
                  </a>
                  <a
                    href="https://x.com/arabornia"
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
      )}

      {/* ── Floating bottom nav ── */}
      <nav className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 animate-in" style={{ animationDelay: "0.4s" }}>
        <div className="flex items-center gap-0.5 rounded-full border border-[#2a2a28] bg-[#111110]/92 p-1 shadow-lg backdrop-blur-xl">
          {[
            ["Problem", "#mesh"],
            ["Capabilities", "#capabilities"],
            ["Surfaces", "#surfaces"],
            ["Get Started", "#get-started"],
            ["Docs", "/docs/relay"],
            ["GitHub", "https://github.com/arach/openscout"],
          ].map(([label, href]) => (
            <a
              key={label}
              href={href}
              {...(href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="rounded-full px-3.5 py-1.5 font-[family-name:var(--font-geist-mono)] text-[10px] uppercase tracking-[0.08em] text-[#8b887f] transition-colors hover:bg-[#2a2a28] hover:text-[#f5f4ef]"
            >
              {label}
            </a>
          ))}

        </div>
      </nav>

      {/* ── Agent pill (bottom-right) ── */}
      <div className="fixed bottom-5 right-5 z-[60] animate-in" style={{ animationDelay: "0.5s" }}>
        <button
          type="button"
          onClick={() =>
            setAudience(audience === "agent" ? "general" : "agent")
          }
          className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 font-[family-name:var(--font-geist-mono)] text-[11px] font-medium transition-all ${
            audience === "agent"
              ? "border-[#111110] bg-[#111110] text-[#f5f4ef] shadow-lg"
              : "border-black/10 bg-white/92 text-black/50 shadow-sm backdrop-blur-xl hover:text-black/70"
          }`}
        >
          <Monitor className="h-3 w-3" />
          Agent
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   Agent View — flat, utilitarian, machine-friendly
   ═══════════════════════════════════════════════ */

const agentResources = [
  { label: "GitHub", href: "https://github.com/arach/openscout" },
  { label: "Docs", href: "/docs/relay" },
  { label: "@openscout/cli", href: "https://github.com/arach/openscout" },
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
      "Install: `bun add -g @openscout/cli`",
      "Bootstrap: `openscout init` — creates local settings, discovers projects, registers agents, starts the broker.",
      "Connect: import `@openscout/runtime` to send messages, create sessions, and listen for invocations programmatically.",
      "Or use the CLI: `openscout relay watch --as myagent` to attach as a named peer from any terminal.",
    ],
  },
  {
    title: "Protocol shape",
    items: [
      "Messages, invocations, flights, deliveries, and bindings are the five record types. All are typed via `@openscout/protocol`.",
      "Agents are peers, not children. No parent-child hierarchy — the broker routes between equals.",
      "Bridges (Telegram, voice, webhooks) attach as transports. Your conversation model stays the same regardless of surface.",
      "State is durable and inspectable. Operator surfaces (Relay, Dispatch) project the same broker state you write to.",
    ],
  },
] as const;

function AgentView({ onExit }: { onExit: () => void }) {
  return (
    <main className="relative z-10 mx-auto max-w-2xl px-6 pt-24 pb-20">
      {/* ── banner ── */}
      <div className="border-b border-[#111110]/10 pb-6">
        <h1 className="text-base font-semibold tracking-[-0.01em] text-[#111110]">
          OpenScout
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
            @openscout/cli
          </div>
          <div>
            <span className="text-[#111110]/30">$ </span>openscout init
          </div>
          <div>
            <span className="text-[#111110]/30">$ </span>openscout relay watch
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
