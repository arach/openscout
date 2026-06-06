import { createElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Settings } from "lucide-react";
import type { CommandOption, StatusColor, TakeoverState } from "@hudsonkit";
import { api } from "../lib/api.ts";
import { isOpsEnabled } from "../lib/feature-flags.ts";
import { useScout } from "./Provider.tsx";
import { conversationForAgent } from "../lib/router.ts";
import type { MeshStatus, Route } from "../lib/types.ts";
import { MachineScopeControl } from "../components/MachineScopeControl.tsx";

export type ScoutStatusBarState = {
  status: { label: string; color: StatusColor };
  activeAgents: { label: string; count: number };
  mesh: { label: string; value: string; color: StatusColor };
  build: { label: string; title: string };
};

type BuildInfo = {
  version: string | null;
  branch: string | null;
  commit: string | null;
  dirty: boolean | null;
  mode: "dev" | "production";
};

/* ── useCommands — nav + agent operations ─────────────────────────────── */
export function useScoutCommands(): CommandOption[] {
  const { navigate, agents, reload, openSettings, applyScoutbotUiAction } = useScout();
  const opsEnabled = isOpsEnabled();

  const askScoutbotForState = useCallback(() => {
    applyScoutbotUiAction({ type: "open-scoutbot", mode: "ask" });
    window.dispatchEvent(new CustomEvent("scout:scoutbot-submit", {
      detail: {
        body: "What's the state of things? Give me a terse ops summary, the biggest risk, and the next action you recommend.",
      },
    }));
  }, [applyScoutbotUiAction]);

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
        id: "nav:repos",
        label: "Go to Repos",
        action: () => navigate({ view: "repos" }),
      },
      {
        id: "nav:messages",
        label: "Go to Conversations",
        action: () => navigate({ view: "messages" }),
        shortcut: "Cmd+4",
      },
      {
        id: "nav:messages-dms",
        label: "Go to Conversations — Private",
        action: () => navigate({ view: "messages", filter: "dm" }),
      },
      {
        id: "nav:messages-channels",
        label: "Go to Conversations — Shared",
        action: () => navigate({ view: "messages", filter: "channel" }),
        shortcut: "Cmd+5",
      },
      {
        id: "nav:sessions",
        label: "Go to Sessions",
        action: () => navigate({ view: "sessions" }),
      },
      {
        id: "nav:search",
        label: "Go to Search",
        action: () => navigate({ view: "search" }),
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
      }, {
        id: "nav:ops-atop",
        label: "Open Atop",
        action: () => navigate({ view: "ops", mode: "atop" }),
      }, {
        id: "nav:workflow-topology",
        label: "Open Workflow Topology",
        action: () => navigate({ view: "agents" }),
      }] : []),
      {
        id: "nav:settings",
        label: "Open Settings",
        action: () => openSettings(),
        shortcut: "Cmd+,",
      },
      {
        id: "nav:agent-config",
        label: "Open Agent Configuration",
        action: () => navigate({ view: "settings", section: "agents" }),
      },
      {
        id: "scoutbot:open",
        label: "Open Scout",
        action: () => applyScoutbotUiAction({ type: "open-scoutbot", mode: "ask" }),
      },
      {
        id: "scoutbot:state",
        label: "Ask Scout for State",
        action: () => askScoutbotForState(),
      },
      {
        id: "scoutbot:ops-tail",
        label: "Scout: Open Ops Tail",
        action: () => applyScoutbotUiAction({ type: "navigate", route: { view: "ops", mode: "tail" } }),
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
  }, [agents, applyScoutbotUiAction, askScoutbotForState, interruptAgent, navigate, opsEnabled, reload, openSettings]);
}

export function useScoutStatusBarState(): ScoutStatusBarState {
  const { onlineCount } = useScout();
  const [mesh, setMesh] = useState<MeshStatus | null>(null);
  const [build, setBuild] = useState<BuildInfo | null>(null);
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

  useEffect(() => {
    api<BuildInfo>("/api/build")
      .then(setBuild)
      .catch(() => setBuild(null));
  }, []);

  const buildLabel = (() => {
    if (!build) return { label: "dev", title: "Build information unavailable" };
    const mode = build.mode === "production" ? "prod" : "dev";
    const branch = build.branch ?? "unknown";
    const commit = build.commit ? ` @ ${build.commit}${build.dirty ? "*" : ""}` : "";
    return {
      label: `${mode} ${branch}${commit}`,
      title: [
        `Mode: ${build.mode}`,
        `Version: ${build.version ?? "unknown"}`,
        `Branch: ${build.branch ?? "unknown"}`,
        `Commit: ${build.commit ?? "unknown"}`,
        `Dirty: ${build.dirty === null ? "unknown" : build.dirty ? "yes" : "no"}`,
      ].join("\n"),
    };
  })();

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
    build: buildLabel,
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
  messages: "Conversations",
  sessions: "Sessions",
  repos: "Repos",
  search: "Search",
  channels: "Conversations",
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
    { label: "Conversations", view: "messages" },
    { label: "Sessions", view: "sessions" },
    { label: "Repos", view: "repos" },
    { label: "Search", view: "search" },
    { label: "Mesh", view: "mesh" },
    { label: "Broker", view: "broker" },
    ...(opsEnabled ? [{ label: "Ops" as const, view: "ops" as Route["view"] }] : []),
  ];

  const activeView = route.view === "fleet" ? "inbox"
    : route.view === "activity" ? "inbox"
    : route.view === "conversation" ? "messages"
    : route.view === "agent-info" ? "agents"
    : route.view === "conversations" ? "messages"
    : route.view === "channels" ? "messages"
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

/* ── useNavActions ─────────────────────────────────────────────────────── */
export function useScoutNavActions(): ReactNode | null {
  const { openSettings } = useScout();
  return createElement("div", { className: "scout-nav-actions" },
    createElement(MachineScopeControl, { variant: "nav" }),
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
  if (onboardingSkipped || onboarding.needed === false || onboarding.skippedAt || onboarding.completedAt) {
    return { active: false, dismissible: true };
  }
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
