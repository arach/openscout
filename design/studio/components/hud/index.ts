/**
 * Shared HUD component library — used by both the interactive
 * playground at `/studies/hud` and the locked per-size study pages
 * (`/studies/hud-compact`, `/studies/hud-medium`, `/studies/hud-large`).
 */

export { HudActivityPulse } from "./HudActivityPulse";
export { HudFleet } from "./HudFleet";
export { HudMasthead } from "./HudMasthead";
export { HudMessageDock } from "./HudMessageDock";
export { HudObserve } from "./HudObserve";
export { HudPanel } from "./HudPanel";
export { HudScoutLink } from "./HudScoutLink";
export { HudSectionHeader } from "./HudSectionHeader";
export { HudSessions } from "./HudSessions";
export { HudSizeToggle } from "./HudSizeToggle";
export { HudTail } from "./HudTail";

export {
  FIREHOSE,
  FIREHOSE_KIND_LABEL,
  FLEET,
  OBSERVE,
  OBSERVE_KIND_LABEL,
  SESSIONS,
} from "./mock";
export {
  OBSERVE_GRID,
  PANEL_DIMS,
  PANEL_PAD_X,
  PULSE_CFG,
  SESSION_PANE_LINES,
  SESSION_PANE_LINES_ENGAGED,
} from "./tokens";
export type {
  EngageState,
  FirehoseEvent,
  FirehoseKind,
  FleetAgent,
  HudSize,
  HudTab,
  ObserveBucket,
  ObserveEvent,
  ObserveKind,
  ScoutLinkKind,
  ScoutSession,
  SessionKind,
} from "./types";
