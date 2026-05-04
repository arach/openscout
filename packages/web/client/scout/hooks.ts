import { createElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Settings } from "lucide-react";
import type { CommandOption, StatusColor, TakeoverState } from "@hudson/sdk";
import { api } from "../lib/api.ts";
import { isOpsEnabled } from "../lib/feature-flags.ts";
import { useScout } from "./Provider.tsx";
import { conversationForAgent } from "../lib/router.ts";
import type { MeshStatus, Route } from "../lib/types.ts";

export type ScoutStatusBarState = {
  status: { label: string; color: StatusColor };
  activeAgents: { label: string; count: number };
  mesh: { label: string; value: string; color: StatusColor };
};

/* ── useCommands — nav + agent operations ─────────────────────────────── */
export function useScoutCommands(): CommandOption[] {
  const { navigate, agents, reload, openSettings, rangerConversationId, applyRangerUiAction } = useScout();
  const opsEnabled = isOpsEnabled();

  const askRangerForState = useCallback(async () => {
    try {
      const result = await api<{ conversationId?: string }>("/api/ask", {
        method: "POST",
        body: JSON.stringify({
          conversationId: rangerConversationId,
          body: "What's the state of things? Give me a terse ops summary, the biggest risk, and the next action you recommend.",
        }),
      });
      navigate({
        view: "conversation",
        conversationId: result.conversationId ?? rangerConversationId,
        composeMode: "ask",
      });
    } catch {
      navigate({ view: "conversation", conversationId: rangerConversationId, composeMode: "ask" });
    }
  }, [navigate, rangerConversationId]);

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
        id: "nav:conversations",
        label: "Go to Conversations",
        action: () => navigate({ view: "conversations" }),
      },
      {
        id: "nav:sessions",
        label: "Go to Sessions",
        action: () => navigate({ view: "sessions" }),
        shortcut: "Cmd+4",
      },
      {
        id: "nav:channels",
        label: "Go to Channels",
        action: () => navigate({ view: "channels" }),
        shortcut: "Cmd+5",
      },
      {
        id: "nav:activity",
        label: "Go to Activity",
        action: () => navigate({ view: "activity" }),
        shortcut: "Cmd+6",
      },
      {
        id: "nav:mesh",
        label: "Go to Mesh",
        action: () => navigate({ view: "mesh" }),
        shortcut: "Cmd+7",
      },
      ...(opsEnabled ? [{
        id: "nav:ops",
        label: "Go to Ops",
        action: () => navigate({ view: "ops" }),
        shortcut: "Cmd+8",
      }] : []),
      {
        id: "nav:settings",
        label: "Open Settings",
        action: () => openSettings(),
        shortcut: "Cmd+,",
      },
      {
        id: "ranger:open",
        label: "Open Ranger",
        action: () => navigate({ view: "conversation", conversationId: rangerConversationId, composeMode: "ask" }),
      },
      {
        id: "ranger:state",
        label: "Ask Ranger for State",
        action: () => void askRangerForState(),
      },
      {
        id: "ranger:ops-tail",
        label: "Ranger: Open Ops Tail",
        action: () => applyRangerUiAction({ type: "navigate", route: { view: "ops", mode: "tail" } }),
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
  }, [agents, applyRangerUiAction, askRangerForState, interruptAgent, navigate, opsEnabled, rangerConversationId, reload, openSettings]);
}

export function useScoutStatusBarState(): ScoutStatusBarState {
  const { onlineCount } = useScout();
  const [mesh, setMesh] = useState<MeshStatus | null>(null);
  const requestIdRef = useRef(0);

  const loadMesh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    try {
      const data = await api<MeshStatus>("/api/mesh");
      if (requestId !== requestIdRef.current) return;
      setMesh(data);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setMesh(null);
    }
  }, []);

  useEffect(() => {
    void loadMesh();
    const timer = setInterval(() => {
      void loadMesh();
    }, 15_000);
    return () => clearInterval(timer);
  }, [loadMesh]);

  return {
    status: mesh === null
      ? { label: "Broker: …", color: "neutral" }
      : mesh.health.reachable
        ? { label: "Broker: UP", color: "emerald" }
        : { label: "Broker: DOWN", color: "red" },
    activeAgents: {
      label: "Active Agents",
      count: onlineCount,
    },
    mesh: (() => {
      if (mesh === null) {
        return { label: "Mesh", value: "checking", color: "neutral" as StatusColor };
      }
      if (!mesh.health.reachable) {
        return { label: "Mesh", value: "offline", color: "neutral" as StatusColor };
      }
      const remoteNodes = Object.values(mesh.nodes).filter((node) => node.id !== mesh.localNode?.id);
      if (remoteNodes.length > 0) {
        return { label: "Mesh", value: "connected", color: "neutral" as StatusColor };
      }
      if (mesh.identity.discoverable) {
        return { label: "Mesh", value: "discoverable", color: "neutral" as StatusColor };
      }
      return { label: "Mesh", value: "local", color: "amber" as StatusColor };
    })(),
  };
}

/* ── useStatus — shell compatibility ───────────────────────────────────── */
export function useScoutStatus(): { label: string; color: StatusColor } {
  return useScoutStatusBarState().status;
}

/* ── useNavCenter — tab bar + breadcrumb ──────────────────────────────── */
const VIEW_LABELS: Record<string, string> = {
  inbox: "Fleet",
  conversation: "Conversation",
  "agent-info": "Agent",
  agents: "Agents",
  fleet: "Fleet",
  conversations: "Conversations",
  sessions: "Sessions",
  channels: "Channels",
  activity: "Activity",
  mesh: "Mesh",
  broker: "Broker",
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
    { label: "Conversations", view: "conversations" },
    { label: "Sessions", view: "sessions" },
    { label: "Channels", view: "channels" },
    { label: "Mesh", view: "mesh" },
    { label: "Broker", view: "broker" },
    ...(opsEnabled ? [{ label: "Ops" as const, view: "ops" as Route["view"] }] : []),
  ];

  const activeView = route.view === "fleet" ? "inbox"
    : route.view === "activity" ? "inbox"
    : route.view === "conversation" ? "agents"
    : route.view === "agent-info" ? "agents"
    : route.view === "conversations" ? "conversations"
    : route.view === "work" ? (opsEnabled ? "ops" : "inbox")
    : route.view === "channels" ? "channels"
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

/* ── useNavActions ─────────────────────────────────────────────────────── */
export function useScoutNavActions(): ReactNode | null {
  const { openSettings, navigate, rangerConversationId } = useScout();
  return createElement("div", { className: "scout-nav-actions" },
    createElement(
      "button",
      {
        onClick: () => navigate({ view: "conversation", conversationId: rangerConversationId, composeMode: "ask" }),
        className: "scout-nav-action scout-nav-action--ranger",
      },
      "Ranger",
    ),
    createElement(
      "button",
      {
        onClick: () => openSettings(),
        className: "scout-nav-action scout-nav-action--settings",
        title: "Settings",
      },
      createElement(Settings, { size: 12, strokeWidth: 1.6, "aria-hidden": true }),
      createElement("span", null, "Settings"),
    ),
  );
}

/* ── useLayoutMode ─────────────────────────────────────────────────────── */
export function useScoutLayoutMode(): "canvas" | "panel" {
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
