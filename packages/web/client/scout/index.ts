import { createElement } from "react";
import { Radio } from "lucide-react";
import type { HudsonApp } from "@hudson/sdk";
import { ScoutProvider } from "./Provider.tsx";
import { ScoutContent } from "./slots/Content.tsx";
import { ScoutInspector } from "./slots/Inspector.tsx";
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

export const scoutApp: HudsonApp = {
  id: "openscout",
  name: "Scout",
  description: "All your agents, one message away",
  mode: "panel",

  Provider: ScoutProvider,

  leftPanel: {
    title: "Scout",
    icon: createElement(Radio, { size: 12 }),
  },

  slots: {
    Content: ScoutContent,
    LeftPanel: ScoutLeftPanel,
    Inspector: ScoutInspector,
    Takeover: OnboardingTakeover,
  },

  hooks: {
    useCommands: useScoutCommands,
    useStatus: useScoutStatus,
    useNavCenter: useScoutNavCenter,
    useNavActions: useScoutNavActions,
    useLayoutMode: useScoutLayoutMode,
    useTakeover: useScoutTakeover,
  },
};
