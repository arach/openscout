import { createElement } from "react";
import { Compass } from "lucide-react";
import type { HudsonApp, AppIntent } from "@hudson/sdk";
import { ScoutProvider } from "./Provider.tsx";
import { ScoutContent } from "./slots/Content.tsx";
import { ScoutInspector } from "./slots/Inspector.tsx";
import { ScoutLeftFooter } from "./slots/LeftFooter.tsx";
import { ScoutLeftPanel } from "./slots/LeftPanel.tsx";
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
    title: "Go to Fleet",
    description: "Navigate to the fleet overview with agent status summary",
    category: "navigation",
    keywords: ["fleet", "overview", "status"],
    shortcut: "Cmd+3",
  },
  {
    commandId: "nav:sessions",
    title: "Go to Sessions",
    description:
      "Navigate to the sessions list showing all active conversations",
    category: "navigation",
    keywords: ["sessions", "conversations", "threads"],
    shortcut: "Cmd+4",
  },
  {
    commandId: "nav:activity",
    title: "Go to Activity",
    description: "Navigate to the activity feed showing recent events",
    category: "navigation",
    keywords: ["activity", "feed", "events", "log"],
    shortcut: "Cmd+5",
  },
  {
    commandId: "nav:mesh",
    title: "Go to Mesh",
    description: "Navigate to the mesh network view showing nodes and topology",
    category: "navigation",
    keywords: ["mesh", "network", "nodes", "peers", "topology"],
    shortcut: "Cmd+6",
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

    Provider: ({ children }) =>
      createElement(ScoutProvider, { initialTheme }, children),

    leftPanel: {
      title: "Agents",
    },

    rightPanel: {
      title: "Context",
    },

    slots: {
      Content: ScoutContent,
      LeftPanel: ScoutLeftPanel,
      LeftFooter: ScoutLeftFooter,
      Inspector: ScoutInspector,
      Takeover: OnboardingTakeover,
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
