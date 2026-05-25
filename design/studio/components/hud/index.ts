/**
 * Shared HUD component library — used by both the interactive
 * playground at `/studies/hud` and the locked per-size study pages
 * (`/studies/hud-compact`, `/studies/hud-medium`, `/studies/hud-large`).
 */

export { HudActivity } from "./HudActivity";
export { HudActivityPulse } from "./HudActivityPulse";
export { HudAgents } from "./HudAgents";
export { HudMasthead } from "./HudMasthead";
export { HudMessageDock } from "./HudMessageDock";
export { HudPanel } from "./HudPanel";
export { HudScoutLink } from "./HudScoutLink";
export { HudSectionHeader } from "./HudSectionHeader";
export { HudSessions } from "./HudSessions";
export { HudSizeToggle } from "./HudSizeToggle";
export { HudTail } from "./HudTail";
export { useHudEngage } from "./useHudEngage";

export {
  ACTIVITY,
  ACTIVITY_CATEGORY_LABEL,
  ACTIVITY_KIND_LABEL,
  AGENTS,
  FIREHOSE,
  FIREHOSE_KIND_LABEL,
  SESSIONS,
} from "./mock";
export {
  ACTIVITY_GRID,
  PANEL_DIMS,
  PANEL_PAD_X,
  PULSE_CFG,
  TAIL_ROW_FONT_PX,
} from "./tokens";
export type {
  ActivityBucket,
  ActivityCategory,
  ActivityEvent,
  ActivityKind,
  AgentSession,
  EngageState,
  FirehoseEvent,
  FirehoseKind,
  FleetAgent,
  HudSize,
  HudTab,
  ScoutLinkKind,
  SessionHarness,
  SessionStatus,
} from "./types";
