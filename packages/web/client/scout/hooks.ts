import { createElement, useCallback, useMemo, type ReactNode } from "react";
import type { CommandOption, StatusColor, TakeoverState } from "@hudson/sdk";
import { api } from "../lib/api.ts";
import { isOpsEnabled } from "../lib/feature-flags.ts";
import { useScout } from "./Provider.tsx";
import { conversationForAgent } from "../lib/router.ts";
import type { Route } from "../lib/types.ts";

/* ── useCommands — nav + agent operations ─────────────────────────────── */
export function useScoutCommands(): CommandOption[] {
  const { navigate, agents, reload, openSettings } = useScout();
  const opsEnabled = isOpsEnabled();

  const interruptAgent = useCallback(async (agentId: string) => {
    await api(`/api/agents/${encodeURIComponent(agentId)}/interrupt`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  }, []);

  return useMemo<CommandOption[]>(() => {
    const commands: CommandOption[] = [
      {
        id: "nav:home",
        label: "Go to Home",
        action: () => navigate({ view: "inbox" }),
        shortcut: "Cmd+1",
      },
      {
        id: "nav:agents",
        label: "Go to Agents",
        action: () => navigate({ view: "agents" }),
        shortcut: "Cmd+2",
      },
      {
        id: "nav:fleet",
        label: "Go to Fleet",
        action: () => navigate({ view: "fleet" }),
        shortcut: "Cmd+3",
      },
      {
        id: "nav:sessions",
        label: "Go to Sessions",
        action: () => navigate({ view: "sessions" }),
        shortcut: "Cmd+4",
      },
      {
        id: "nav:activity",
        label: "Go to Activity",
        action: () => navigate({ view: "activity" }),
        shortcut: "Cmd+5",
      },
      {
        id: "nav:mesh",
        label: "Go to Mesh",
        action: () => navigate({ view: "mesh" }),
        shortcut: "Cmd+6",
      },
      ...(opsEnabled ? [{
        id: "nav:ops",
        label: "Go to Ops",
        action: () => navigate({ view: "ops" }),
        shortcut: "Cmd+7",
      }] : []),
      {
        id: "nav:settings",
        label: "Open Settings",
        action: () => openSettings(),
        shortcut: "Cmd+,",
      },
      {
        id: "nav:pair",
        label: "Pair Device",
        action: () => openSettings(),
      },
      {
        id: "scout:reload",
        label: "Reload Agents",
        action: () => void reload(),
      },
    ];

    for (const agent of agents) {
      commands.push({
        id: `scout:open:${agent.id}`,
        label: `Open ${agent.name}`,
        action: () =>
          navigate({
            view: "conversation",
            conversationId: conversationForAgent(agent.id),
          }),
      });
      commands.push({
        id: `scout:send:${agent.id}`,
        label: `Tell ${agent.name}`,
        action: () =>
          navigate({
            view: "conversation",
            conversationId: conversationForAgent(agent.id),
          }),
      });
      commands.push({
        id: `scout:ask:${agent.id}`,
        label: `Ask ${agent.name}`,
        action: () =>
          navigate({
            view: "conversation",
            conversationId: conversationForAgent(agent.id),
            composeMode: "ask",
          }),
      });
      commands.push({
        id: `scout:interrupt:${agent.id}`,
        label: `Interrupt ${agent.name}`,
        action: () => void interruptAgent(agent.id),
      });
    }

    return commands;
  }, [agents, interruptAgent, navigate, opsEnabled, reload]);
}

/* ── useStatus — online indicator ──────────────────────────────────────── */
export function useScoutStatus(): { label: string; color: StatusColor } {
  const { agents, onlineCount } = useScout();
  if (agents.length === 0) return { label: "offline", color: "neutral" };
  if (onlineCount === 0)
    return { label: `0/${agents.length} agents`, color: "amber" };
  return { label: `${onlineCount}/${agents.length} agents`, color: "emerald" };
}

/* ── useNavCenter — tab bar + breadcrumb ──────────────────────────────── */
const VIEW_LABELS: Record<string, string> = {
  inbox: "Fleet",
  conversation: "Conversation",
  "agent-info": "Agent",
  agents: "Agents",
  fleet: "Fleet",
  sessions: "Sessions",
  activity: "Activity",
  mesh: "Mesh",
  settings: "Settings",
  work: "Work",
  ops: "Ops",
};

export function useScoutNavCenter(): ReactNode | null {
  const { route, navigate } = useScout();
  const opsEnabled = isOpsEnabled();
  const tabItems: { label: string; view: Route["view"] }[] = [
    { label: "Fleet", view: "inbox" },
    { label: "Agents", view: "agents" },
    { label: "Sessions", view: "sessions" },
    { label: "Mesh", view: "mesh" },
    ...(opsEnabled ? [{ label: "Ops" as const, view: "ops" as Route["view"] }] : []),
  ];

  const activeView = route.view === "fleet" ? "inbox"
    : route.view === "activity" ? "inbox"
    : route.view === "conversation" ? "agents"
    : route.view === "agent-info" ? "agents"
    : route.view === "work" ? (opsEnabled ? "ops" : "inbox")
    : route.view;

  const breadcrumb = route.view === "conversation" || route.view === "agent-info" || route.view === "work"
    ? VIEW_LABELS[route.view] ?? route.view
    : null;

  return createElement("div", { className: "scout-nav-tabs" },
    tabItems.map(({ label, view }) =>
      createElement("button", {
        key: view,
        className: `scout-nav-tab${activeView === view ? " active" : ""}`,
        onClick: () => navigate({ view } as Route),
      }, label),
    ),
    breadcrumb && createElement("span", { className: "scout-nav-slash" }, "/"),
    breadcrumb && createElement("span", { className: "scout-nav-crumb" }, breadcrumb),
  );
}

/* ── useNavActions — "Pair device" button ──────────────────────────────── */
export function useScoutNavActions(): ReactNode | null {
  const { openSettings } = useScout();
  return createElement(
    "button",
    {
      onClick: () => openSettings(),
      className: "scout-nav-action",
    },
    "Pair device",
  );
}

/* ── useLayoutMode ─────────────────────────────────────────────────────── */
export function useScoutLayoutMode(): "canvas" | "panel" | "focus" {
  const { route } = useScout();
  if (route.view === "ops" || route.view === "work") {
    return "focus";
  }
  return "panel";
}

/* ── useTakeover — gate chrome on first-run onboarding ─────────────────── */
export function useScoutTakeover(): TakeoverState | null {
  const { onboarding, onboardingSkipped, skipOnboarding } = useScout();
  // Until the first fetch resolves we pass through; false negatives would
  // block the app on reloads and true would flash a takeover for returning
  // users. Waiting one RTT is cheap and correct.
  if (!onboarding) return null;
  if (onboardingSkipped) return { active: false, dismissible: true };
  const needsLocal = !onboarding.hasLocalConfig;
  const needsProject = !onboarding.hasProjectConfig;
  const needsName = !onboarding.hasOperatorName;
  const active = needsLocal || needsName || needsProject;
  return {
    active,
    dismissible: true,
    onDismiss: skipOnboarding,
  };
}
