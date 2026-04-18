import { createElement, useMemo, type ReactNode } from "react";
import type { CommandOption, StatusColor } from "@hudson/sdk";
import { useScout } from "./Provider.tsx";

/* ── useCommands — nav shortcuts ───────────────────────────────────────── */
export function useScoutCommands(): CommandOption[] {
  const { navigate } = useScout();
  return useMemo<CommandOption[]>(
    () => [
      { id: "nav:home", label: "Go to Home", action: () => navigate({ view: "inbox" }), shortcut: "Cmd+1" },
      { id: "nav:agents", label: "Go to Agents", action: () => navigate({ view: "agents" }), shortcut: "Cmd+2" },
      { id: "nav:fleet", label: "Go to Fleet", action: () => navigate({ view: "fleet" }), shortcut: "Cmd+3" },
      { id: "nav:sessions", label: "Go to Sessions", action: () => navigate({ view: "sessions" }), shortcut: "Cmd+4" },
      { id: "nav:activity", label: "Go to Activity", action: () => navigate({ view: "activity" }), shortcut: "Cmd+5" },
      { id: "nav:mesh", label: "Go to Mesh", action: () => navigate({ view: "mesh" }), shortcut: "Cmd+6" },
      { id: "nav:settings", label: "Open Settings", action: () => navigate({ view: "settings" }), shortcut: "Cmd+," },
      { id: "nav:pair", label: "Pair Device", action: () => navigate({ view: "settings" }) },
    ],
    [navigate],
  );
}

/* ── useStatus — online indicator ──────────────────────────────────────── */
export function useScoutStatus(): { label: string; color: StatusColor } {
  const { agents, onlineCount } = useScout();
  if (agents.length === 0) return { label: "offline", color: "neutral" };
  if (onlineCount === 0) return { label: `0/${agents.length} agents`, color: "amber" };
  return { label: `${onlineCount}/${agents.length} agents`, color: "emerald" };
}

/* ── useNavCenter — section label / breadcrumb ─────────────────────────── */
const VIEW_LABELS: Record<string, string> = {
  inbox: "Home",
  conversation: "Conversation",
  "agent-info": "Agent",
  agents: "Agents",
  fleet: "Fleet",
  sessions: "Sessions",
  activity: "Activity",
  mesh: "Mesh",
  settings: "Settings",
  work: "Work",
};

export function useScoutNavCenter(): ReactNode | null {
  const { route } = useScout();
  const label = VIEW_LABELS[route.view] ?? route.view;
  return createElement(
    "span",
    { className: "text-[10px] font-mono uppercase tracking-wider text-white/40" },
    label,
  );
}

/* ── useNavActions — "Pair device" button ──────────────────────────────── */
export function useScoutNavActions(): ReactNode | null {
  const { navigate } = useScout();
  return createElement(
    "button",
    {
      onClick: () => navigate({ view: "settings" }),
      className:
        "px-2 py-1 rounded-sm text-[11px] font-mono uppercase tracking-wider text-white/60 hover:text-white/90 hover:bg-white/[0.04] border border-white/[0.06] transition-colors",
    },
    "Pair device",
  );
}

/* ── useLayoutMode ─────────────────────────────────────────────────────── */
export function useScoutLayoutMode(): "canvas" | "panel" {
  return "panel";
}
