"use client";

import { useEffect, useState } from "react";
import {
  Bot,
  Layers,
  MessageSquare,
  Network,
  Search,
  Send,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { ExpandableImage } from "@/components/expandable-image";

type AudienceMode = "general" | "technical";
type SurfaceId = "relay" | "pairing";
type RelayViewId = "tui" | "home" | "agents" | "sessions" | "search" | "machines";

type ShowcaseView = {
  alt: string;
  description: string;
  focus: string;
  label: string;
  src: string;
  title: string;
  imageClassName?: string;
  width?: number;
  height?: number;
};

type RelayView = ShowcaseView & {
  icon: LucideIcon;
  id: RelayViewId;
};

const technicalRelayView: RelayView = {
  id: "tui",
  icon: Terminal,
  label: "TUI",
  title: "Terminal console",
  description:
    "The fast compatibility surface for reading broker state, active agents, and recent sessions straight from the terminal.",
  focus: "Best starting point when you want the quickest operator view.",
  src: "/relay-tui.png",
  alt: "OpenScout Relay terminal interface showing active agents and recent sessions.",
  imageClassName: "aspect-[1004/649] w-full object-cover object-top",
  width: 1004,
  height: 649,
};

const relayViews: RelayView[] = [
  {
    id: "home",
    icon: Layers,
    label: "Home",
    title: "Command center",
    description:
      "The front door for Relay: quick entry points into live messaging, sessions, runtime sync, and indexed activity.",
    focus: "Best top-level overview of the current Relay app.",
    src: "/relay/home-command-center.png",
    alt: "OpenScout Relay command center view captured March 31, 2026 at 11:53:45 AM",
  },
  {
    id: "agents",
    icon: Bot,
    label: "Agents",
    title: "Agent overview",
    description:
      "Roster, open threads, live session output, and operational snapshot for a specific Relay agent.",
    focus: "Shows how Relay turns agent state into an inspectable working surface.",
    src: "/relay/agents-overview.png",
    alt: "OpenScout Relay agent overview captured March 31, 2026 at 11:07:25 AM",
  },
  {
    id: "sessions",
    icon: MessageSquare,
    label: "Sessions",
    title: "Session index",
    description:
      "Project and direct-session listing with tags, message counts, and quick scanning across broker-backed conversations.",
    focus: "Shows the broker as an indexable conversation store instead of a terminal log.",
    src: "/relay/sessions-index.png",
    alt: "OpenScout Relay sessions index captured March 31, 2026 at 11:53:59 AM",
  },
  {
    id: "search",
    icon: Search,
    label: "Search",
    title: "Broker-wide search",
    description:
      "Full-text search over sessions, messages, and metadata with scopes, time filters, and agent filters.",
    focus: "Makes the durable record visible as a searchable working surface.",
    src: "/relay/search-view.png",
    alt: "OpenScout Relay search view captured March 31, 2026 at 11:54:04 AM",
  },
  {
    id: "machines",
    icon: Network,
    label: "Machines",
    title: "Machine inventory",
    description:
      "Reachable endpoints, project counts, runtime endpoints, and machine-level health in one operator view.",
    focus: "Shows the mesh as live infrastructure, not just chat threads.",
    src: "/relay/machines-view.png",
    alt: "OpenScout Relay machines view captured March 31, 2026 at 11:53:55 AM",
  },
];

const pairingView: ShowcaseView = {
  label: "Pair Mode",
  title: "Scout pairing host",
  description:
    "Scout keeps pairing, bridge logs, and runtime settings on a dedicated host surface so companion devices can plug in cleanly.",
  focus: "Current desktop host surface for pairing, logs, and settings.",
  src: "/scout/pair-mode.png",
  alt: "Scout pair mode captured March 31, 2026 at 10:17:29 AM",
};

function ShowcaseCaption({
  description,
  eyebrow,
  focus,
  title,
}: {
  description: string;
  eyebrow: string;
  focus: string;
  title: string;
}) {
  return (
    <div className="border-t border-[#eae6dd] bg-[#faf9f6] px-4 py-3.5 sm:px-5">
      <div className="landing-label text-[#2657c6]">{eyebrow}</div>
      <h3 className="mt-1.5 text-base font-semibold tracking-tight text-[#111110]">
        {title}
      </h3>
      <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-[#6b6862]">
        {description}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-[#9a978f]">{focus}</p>
    </div>
  );
}

export function LandingProductShowcase({
  audience = "general",
}: {
  audience?: AudienceMode;
}) {
  const availableRelayViews =
    audience === "technical" ? [technicalRelayView, ...relayViews] : relayViews;

  const [surface, setSurface] = useState<SurfaceId>("relay");
  const [relayView, setRelayView] = useState<RelayViewId>(
    audience === "technical" ? "tui" : "home",
  );

  // Sync default view when audience changes without remounting
  useEffect(() => {
    setRelayView(audience === "technical" ? "tui" : "home");
    setSurface("relay");
  }, [audience]);

  const activeRelayView =
    availableRelayViews.find((view) => view.id === relayView) ?? availableRelayViews[0];
  const activeView = surface === "relay" ? activeRelayView : pairingView;
  const relayEyebrow = activeRelayView.id === "tui" ? "Relay TUI" : "Relay";

  return (
    <div className="landing-panel overflow-hidden rounded-xl">
      {/* ── toolbar ── */}
      <div className="flex h-12 items-center justify-between border-b border-[#eae6dd] bg-[#fbfaf7] px-4">
        <div className="flex items-center gap-3.5">
          <div className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f56]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#27c93f]" />
          </div>

          <div className="flex items-center gap-0.5 rounded-md border border-[#eae6dd] bg-white p-0.5">
            <button
              type="button"
              onClick={() => setSurface("relay")}
              className={`inline-flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors ${
                surface === "relay"
                  ? "bg-[#111110] text-[#f5f4ef]"
                  : "text-[#7a7770] hover:bg-[#f5f4ef]"
              }`}
            >
              <Terminal className="h-3 w-3" />
              Relay
            </button>
            <button
              type="button"
              onClick={() => setSurface("pairing")}
              className={`inline-flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors ${
                surface === "pairing"
                  ? "bg-[#111110] text-[#f5f4ef]"
                  : "text-[#7a7770] hover:bg-[#f5f4ef]"
              }`}
            >
              <Send className="h-3 w-3" />
              Pairing
            </button>
          </div>
        </div>

        <div className="hidden items-center gap-3.5 text-[11px] font-medium uppercase tracking-[0.12em] text-[#9a978f] sm:flex">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[#2f9d5d]" />
            Connected
          </span>
          <span>Mesh Active</span>
        </div>
      </div>

      {/* ── content ── */}
      {surface === "relay" ? (
        <div className="grid lg:grid-cols-[13rem_minmax(0,1fr)]">
          <aside className="hidden border-r border-[#eae6dd] bg-[#f8f7f2] lg:block">
            <div className="flex flex-col gap-1 p-3">
              {availableRelayViews.map((view) => {
                const Icon = view.icon;
                const active = view.id === relayView;

                return (
                  <button
                    key={view.id}
                    type="button"
                    onClick={() => setRelayView(view.id)}
                    className={`rounded-lg border px-2.5 py-2.5 text-left transition-colors ${
                      active
                        ? "border-[#e2ded5] bg-white text-[#111110] shadow-sm"
                        : "border-transparent bg-transparent text-[#6e6b65] hover:bg-white/60"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`flex h-8 w-8 items-center justify-center rounded-lg border ${
                          active
                            ? "border-[#dce4ff] bg-[#f2f5ff] text-[#2657c6]"
                            : "border-[#eae6dd] bg-[#faf9f6] text-[#9a978f]"
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" strokeWidth={1.6} />
                      </span>
                      <div>
                        <div className="text-[13px] font-medium leading-tight">
                          {view.label}
                        </div>
                        <div className="text-[11px] leading-tight text-[#9a978f]">
                          {view.title}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="bg-white p-3 sm:p-4">
            <div className="mb-3 flex gap-1.5 overflow-x-auto lg:hidden">
              {availableRelayViews.map((view) => (
                <button
                  key={view.id}
                  type="button"
                  onClick={() => setRelayView(view.id)}
                  className={`shrink-0 rounded-md border px-2.5 py-1 text-[13px] font-medium transition-colors ${
                    relayView === view.id
                      ? "border-[#111110] bg-[#111110] text-[#f5f4ef]"
                      : "border-[#e2ded5] bg-white text-[#6e6b65]"
                  }`}
                >
                  {view.label}
                </button>
              ))}
            </div>

            <div className="overflow-hidden rounded-lg border border-[#eae6dd] bg-[#f3f1eb]">
              <ExpandableImage
                src={activeView.src}
                alt={activeView.alt}
                width={activeView.width ?? 1552}
                height={activeView.height ?? 1092}
                className={
                  activeView.imageClassName ??
                  "aspect-[1552/1092] w-full object-cover object-top"
                }
                priority
              />
              <ShowcaseCaption
                eyebrow={relayEyebrow}
                title={activeView.title}
                description={activeView.description}
                focus={activeView.focus}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white p-3 sm:p-4">
          <div className="overflow-hidden rounded-lg border border-[#eae6dd] bg-[#f3f1eb]">
            <ExpandableImage
              src={pairingView.src}
              alt={pairingView.alt}
              width={pairingView.width ?? 1552}
              height={pairingView.height ?? 1092}
              className={
                pairingView.imageClassName ??
                "aspect-[1552/1092] w-full object-cover object-top"
              }
            />
            <ShowcaseCaption
              eyebrow="Scout"
              title={pairingView.title}
              description={pairingView.description}
              focus={`${pairingView.focus} Mobile and companion views can slot in here as they land.`}
            />
          </div>
        </div>
      )}
    </div>
  );
}
