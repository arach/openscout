import { createElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Settings } from "lucide-react";
import { type CommandOption, type StatusColor, type TakeoverState } from "@hudsonkit";
import { useOptionalFlag } from "hudsonkit/flags";
import { api } from "../lib/api.ts";
import { useScout } from "./Provider.tsx";
import { conversationForAgent } from "../lib/router.ts";
import type { MeshStatus } from "../lib/types.ts";
import { MachineScopeControl } from "../components/MachineScopeControl.tsx";
import {
  topNavBreadcrumbForRoute,
  topNavItems,
  topNavKeyForRoute,
} from "./topNavConfig.ts";

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
  const opsEnabled = useOptionalFlag("ops.control", true);
  const scoutbotEnabled = useOptionalFlag("surface.scoutbot", true);

  const askScoutbotForState = useCallback(() => {
    applyScoutbotUiAction({ type: "open-scoutbot", mode: "ask" });
    window.dispatchEvent(new CustomEvent("scout:scoutbot-submit", {
      detail: {
        body: "What's the state of things? Give me a terse ops summary, the biggest risk, and the next action you recommend.",
      },
    }));
  }, [applyScoutbotUiAction]);

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
        label: "Open Home Overview",
        action: () => navigate({ view: "fleet" }),
      },
      {
        id: "nav:messages",
        label: "Go to Chat",
        action: () => navigate({ view: "messages" }),
        shortcut: "Cmd+3",
      },
      {
        id: "nav:messages-dms",
        label: "Go to Chat — Private",
        action: () => navigate({ view: "messages", filter: "dm" }),
      },
      {
        id: "nav:messages-channels",
        label: "Go to Chat — Shared",
        action: () => navigate({ view: "messages", filter: "channel" }),
      },
      {
        id: "nav:sessions",
        label: "Open Sessions",
        action: () => navigate({ view: "sessions" }),
      },
      {
        id: "nav:search",
        label: "Go to Search",
        action: () => navigate({ view: "search" }),
        shortcut: "Cmd+4",
      },
      {
        id: "nav:activity",
        label: "Open Activity",
        action: () => navigate({ view: "activity" }),
      },
      {
        id: "nav:mesh",
        label: "Open Mesh",
        action: () => navigate({ view: "mesh" }),
      },
      {
        id: "nav:dispatch",
        label: "Open Dispatch",
        action: () => navigate({ view: "broker" }),
      },
      {
        id: "nav:harnesses",
        label: "Open Providers",
        action: () => navigate({ view: "harnesses" }),
      },
      ...(opsEnabled ? [{
        id: "nav:ops",
        label: "Go to Ops",
        action: () => navigate({ view: "ops" }),
        shortcut: "Cmd+5",
      }, {
        id: "nav:ops-atop",
        label: "Open Runtime",
        action: () => navigate({ view: "ops", mode: "atop" }),
      }, {
        id: "nav:ops-lanes",
        label: "Open Agent Lanes",
        action: () => navigate({ view: "ops", mode: "lanes" }),
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
      ...(scoutbotEnabled ? [{
        id: "scoutbot:open",
        label: "Open Scout",
        action: () => applyScoutbotUiAction({ type: "open-scoutbot", mode: "ask" }),
      }, {
        id: "scoutbot:state",
        label: "Ask Scout for State",
        action: () => askScoutbotForState(),
      }, {
        id: "scoutbot:ops-tail",
        label: "Scout: Open Ops Tail",
        action: () => applyScoutbotUiAction({ type: "navigate", route: { view: "ops", mode: "tail" } }),
      }] : []),
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
        action: () => navigate({ view: "agents", agentId: agent.id }),
      });
      commands.push({
        id: `scout:message:${agent.id}`,
        label: `Message ${agent.name}`,
        action: () =>
          navigate({
            view: "conversation",
            conversationId: conversationForAgent(agent.id),
          }),
      });
    }

    return commands;
  }, [agents, applyScoutbotUiAction, askScoutbotForState, navigate, opsEnabled, scoutbotEnabled, reload, openSettings]);
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
export function useScoutNavCenter(): ReactNode | null {
  const { route, navigate } = useScout();
  const opsEnabled = useOptionalFlag("ops.control", true);
  const cleanNav = useOptionalFlag("nav.clean", false);
  const activeKey = topNavKeyForRoute(route, opsEnabled, cleanNav);
  const breadcrumb = topNavBreadcrumbForRoute(route);

  return createElement("div", { className: "scout-nav-tabs" },
    topNavItems(opsEnabled, cleanNav).map(({ key, label, route: tabRoute }) =>
      createElement("button", {
        key,
        className: `scout-nav-tab${activeKey === key ? " active" : ""}`,
        onClick: () => navigate(tabRoute),
      }, label),
    ),
    breadcrumb && createElement("span", { className: "scout-nav-slash" }, "/"),
    breadcrumb && createElement("span", { className: "scout-nav-crumb" }, breadcrumb),
  );
}

/* ── useNavActions ─────────────────────────────────────────────────────── */
export function useScoutNavActions(): ReactNode | null {
  const { openSettings } = useScout();
  // Lean view puts the machines away — the scope selector is power chrome.
  const cleanNav = useOptionalFlag("nav.clean", false);
  return createElement("div", { className: "scout-nav-actions" },
    !cleanNav && createElement(MachineScopeControl, { variant: "nav" }),
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
