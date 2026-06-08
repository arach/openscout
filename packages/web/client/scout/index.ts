import { createElement, type ReactNode } from "react";
import { Compass } from "lucide-react";
import type { HudsonApp, AppIntent } from "@hudsonkit";
import { ScoutProvider } from "./Provider.tsx";
import { ScoutContent } from "./slots/Content.tsx";
import { ScoutInspector } from "./slots/Inspector.tsx";
import { ScoutLeftPanel } from "./slots/LeftPanel.tsx";
import { ScoutTerminal } from "./slots/Terminal.tsx";
import { OnboardingTakeover } from "./takeover/OnboardingTakeover.tsx";
import {
  useScoutCommands,
  useScoutStatus,
  useScoutNavCenter,
  useScoutNavActions,
  useScoutLayoutMode,
  useScoutTakeover,
} from "./hooks.ts";
import type { ScoutTheme } from "../lib/theme.ts";

const intents: AppIntent[] = [
  {
    commandId: "nav:home",
    title: "Go to Home",
    description: "Navigate to the home overview showing queue, threads, signal, and activity",
    category: "navigation",
    keywords: ["home", "inbox", "dashboard"],
    shortcut: "Cmd+1",
  },
  {
    commandId: "nav:agents",
    title: "Go to Agents",
    description: "Navigate to the agents roster showing all registered agents",
    category: "navigation",
    keywords: ["agents", "roster", "list"],
    shortcut: "Cmd+2",
  },
  {
    commandId: "nav:fleet",
    title: "Open Home Overview",
    description: "Navigate to the home overview with agent status summary",
    category: "navigation",
    keywords: ["home", "fleet", "overview", "status"],
  },
  {
    commandId: "nav:messages",
    title: "Go to Chat",
    description:
      "Navigate to the unified chat surface backed by the normalized conversations service",
    category: "navigation",
    keywords: ["conversations", "comms", "chat", "threads"],
    shortcut: "Cmd+3",
  },
  {
    commandId: "nav:sessions",
    title: "Open Sessions",
    description:
      "Navigate to the sessions list showing all active conversations",
    category: "navigation",
    keywords: ["sessions", "conversations", "threads"],
  },
  {
    commandId: "nav:search",
    title: "Go to Search",
    description:
      "Navigate to the session knowledge search surface for extraction, search, and raw-log drilldown planning",
    category: "navigation",
    keywords: ["search", "knowledge", "qmd", "history"],
    shortcut: "Cmd+4",
  },
  {
    commandId: "nav:messages-channels",
    title: "Go to Chat - Shared",
    description: "Navigate to the shared-channel chat browser",
    category: "navigation",
    keywords: ["channels", "channel", "group", "broadcast"],
  },
  {
    commandId: "nav:activity",
    title: "Open Activity",
    description: "Navigate to the activity feed showing recent events",
    category: "navigation",
    keywords: ["activity", "feed", "events", "log"],
  },
  {
    commandId: "nav:mesh",
    title: "Open Mesh",
    description: "Navigate to the mesh network view showing nodes and topology",
    category: "navigation",
    keywords: ["mesh", "network", "nodes", "peers", "topology"],
  },
  {
    commandId: "nav:dispatch",
    title: "Open Dispatch",
    description: "Navigate to the dispatch ledger for routing, delivery attempts, and failed queries",
    category: "navigation",
    keywords: ["dispatch", "broker", "routing", "delivery", "messages"],
  },
  {
    commandId: "nav:harnesses",
    title: "Open Harnesses",
    description: "Open the central view for registered harnesses, observed topology, and budget feeds",
    category: "navigation",
    keywords: ["harness", "harnesses", "providers", "claude", "codex", "budget", "usage", "topology"],
  },
  {
    commandId: "nav:ops",
    title: "Go to Ops",
    description: "Navigate to the operator workspace for dispatch, mesh, tail, runtime, alerts, and agent operations",
    category: "navigation",
    keywords: ["ops", "operator", "control", "tail", "runtime", "services", "atop", "dispatch", "mesh"],
    shortcut: "Cmd+5",
  },
  {
    commandId: "nav:ops-atop",
    title: "Open Runtime",
    description: "Open the live agent/process view with observed harness families",
    category: "navigation",
    keywords: ["runtime", "services", "atop", "process", "session", "agent", "topology"],
  },
  {
    commandId: "nav:workflow-topology",
    title: "Open Workflow Topology",
    description: "Open the observed Claude workflow hierarchy and worker topology",
    category: "navigation",
    keywords: ["workflow", "workflows", "topology", "subagents", "claude"],
  },
  {
    commandId: "nav:settings",
    title: "Open Settings",
    description:
      "Open the settings screen for pairing, identity, and relay config",
    category: "settings",
    keywords: ["settings", "preferences", "config", "pair"],
    shortcut: "Cmd+,",
  },
  {
    commandId: "nav:agent-config",
    title: "Open Agent Configuration",
    description:
      "Open the unified agent configuration surface for runtimes, agents, tools, delivery, and broker state",
    category: "settings",
    keywords: ["agent config", "runtimes", "providers", "mcp", "tools"],
  },
  {
    commandId: "nav:pair",
    title: "Pair Device",
    description: "Open the device pairing flow to connect a mobile device",
    category: "settings",
    keywords: ["pair", "qr", "device", "phone", "mobile"],
  },
  {
    commandId: "scout:reload",
    title: "Reload Agents",
    description: "Refresh the agent list and message state from the broker",
    category: "workspace",
    keywords: ["reload", "refresh", "sync"],
  },
  {
    commandId: "scout:open:*",
    title: "Open Agent Conversation",
    description:
      "Open the DM lane for one specific agent. One agent maps to a DM; group work belongs in an explicit channel and broadcasts belong in the shared channel.",
    category: "navigation",
    keywords: ["open", "chat", "conversation", "dm", "message"],
    params: [
      {
        name: "agentId",
        description: "The agent identifier to open",
        type: "string",
      },
    ],
  },
  {
    commandId: "scout:send:*",
    title: "Tell Agent",
    description:
      "Open or compose the DM tell/update path for one specific agent. Use Tell for heads-up, replies, status, and steering an active turn inside the same DM.",
    category: "workspace",
    keywords: ["tell", "message", "update", "dm", "reply", "steer"],
    params: [
      {
        name: "agentId",
        description: "The agent identifier to tell",
        type: "string",
      },
      {
        name: "message",
        description: "The message body to send",
        type: "string",
      },
    ],
  },
  {
    commandId: "scout:ask:*",
    title: "Ask Agent",
    description:
      "Open the DM ask path for one specific agent. Use Ask when the meaning is 'own this work and get back to me' and keep follow-up in the same DM.",
    category: "workspace",
    keywords: ["ask", "assign", "task", "dm", "work", "reply"],
    params: [
      {
        name: "agentId",
        description: "The agent identifier to ask",
        type: "string",
      },
      {
        name: "message",
        description: "The message body to send",
        type: "string",
      },
    ],
  },
  {
    commandId: "scout:interrupt:*",
    title: "Interrupt Agent",
    description:
      "Send Ctrl-C to interrupt a working agent. The commandId is scout:interrupt:{agentId}.",
    category: "workspace",
    keywords: ["stop", "interrupt", "cancel", "halt", "kill"],
    dangerous: true,
    params: [
      {
        name: "agentId",
        description: "The agent identifier to interrupt",
        type: "string",
      },
    ],
  },
];

export function createScoutApp(options: { initialTheme?: ScoutTheme } = {}): HudsonApp {
  const { initialTheme = "dark" } = options;

  return {
    id: "openscout",
    name: "Scout",
    description:
      "All your agents, one message away. Scout is a control plane for managing coding agents: one agent means a DM, group work means an explicit channel, Tell stays conversational, Ask is owned work with a reply path, and shared updates mean broadcast.",
    mode: "panel",
    icon: createElement(Compass, { size: 14, strokeWidth: 1.2 }),

    Provider: ({ children }: { children: ReactNode }) =>
      createElement(ScoutProvider, { initialTheme, children }),

    leftPanel: {
      title: "Navigation",
    },

    rightPanel: {
      title: "Context",
    },

    slots: {
      Content: ScoutContent,
      LeftPanel: ScoutLeftPanel,
      Inspector: ScoutInspector,
      Takeover: OnboardingTakeover,
      Terminal: ScoutTerminal,
    },

    intents,

    hooks: {
      useCommands: useScoutCommands,
      useStatus: useScoutStatus,
      useNavCenter: useScoutNavCenter,
      useNavActions: useScoutNavActions,
      useLayoutMode: useScoutLayoutMode,
      useTakeover: useScoutTakeover,
    },
  };
}

export const scoutApp: HudsonApp = createScoutApp();
