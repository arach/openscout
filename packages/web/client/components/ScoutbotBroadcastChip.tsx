import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Bot, Loader2 } from "lucide-react";

import {
  selectChipBroadcast,
  toggleScoutbot,
  useScoutbotBroadcastStore,
} from "../lib/scoutbot-broadcast-store.ts";
import {
  useScoutbotState,
  type ScoutbotActivity,
  type ScoutbotPublicState,
} from "../scout/scoutbot/ScoutbotStateContext.tsx";
import { useContextMenu, type MenuItem } from "./ContextMenu.tsx";
import type { BroadcastTier } from "../lib/types.ts";

import "./scoutbot-broadcast-chip.css";

const BRIEF_FRESH_WINDOW_MS = 5 * 60_000;
const TICK_MS = 15_000;

type ChipSurface =
  | { kind: "activity"; activity: ScoutbotActivity; label: string }
  | { kind: "broadcast"; tier: BroadcastTier; text: string; clickTarget: ReturnType<typeof selectChipBroadcast> }
  | { kind: "brief-fresh"; label: string }
  | { kind: "idle" };

function tierClass(tier: BroadcastTier): string {
  return `s-scoutbot-chip-dot s-scoutbot-chip-dot--${tier}`;
}

function activityLabel(activity: ScoutbotActivity): string {
  switch (activity) {
    case "listening":
      return "listening";
    case "thinking":
      return "thinking";
    case "speaking":
      return "speaking";
    case "briefing":
      return "briefing";
    case "idle":
    default:
      return "";
  }
}

function activityShowsSpinner(activity: ScoutbotActivity): boolean {
  return activity === "thinking" || activity === "briefing";
}

function formatFreshness(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "now";
  return `${minutes}m`;
}

function resolveSurface(
  state: ScoutbotPublicState,
  broadcast: ReturnType<typeof selectChipBroadcast>,
  now: number,
): ChipSurface {
  if (state.activity !== "idle") {
    return {
      kind: "activity",
      activity: state.activity,
      label: activityLabel(state.activity),
    };
  }
  if (broadcast) {
    return {
      kind: "broadcast",
      tier: broadcast.tier,
      text: broadcast.text,
      clickTarget: broadcast,
    };
  }
  if (state.brief.lastDeliveredAt) {
    const age = Math.max(0, now - state.brief.lastDeliveredAt);
    if (age <= BRIEF_FRESH_WINDOW_MS) {
      return { kind: "brief-fresh", label: formatFreshness(age) };
    }
  }
  return { kind: "idle" };
}

function buildTitle(surface: ChipSurface, state: ScoutbotPublicState): string {
  const session = state.session.title ?? null;
  const lines: string[] = [];
  switch (surface.kind) {
    case "activity":
      lines.push(`Scout · ${surface.label}`);
      break;
    case "broadcast":
      lines.push(surface.text);
      break;
    case "brief-fresh":
      lines.push(`Brief delivered ${surface.label} ago`);
      break;
    case "idle":
    default:
      lines.push("Toggle Scout");
      break;
  }
  if (session) lines.push(session);
  if (state.error && surface.kind !== "broadcast") {
    lines.push(state.error);
  }
  return lines.join("\n");
}

export function ScoutbotBroadcastChip() {
  const snap = useScoutbotBroadcastStore();
  const broadcast = selectChipBroadcast(snap);
  const { state, actions } = useScoutbotState();
  const showContextMenu = useContextMenu();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(interval);
  }, []);

  const surface = resolveSurface(state, broadcast, now);
  const title = buildTitle(surface, state);

  const variantClass = (() => {
    switch (surface.kind) {
      case "activity":
        return "s-scoutbot-chip--activity";
      case "broadcast":
        return "s-scoutbot-chip--active";
      case "brief-fresh":
        return "s-scoutbot-chip--fresh";
      case "idle":
      default:
        return "s-scoutbot-chip--idle";
    }
  })();

  const handlePrimaryClick = () => {
    // Restore the pre-SCO-035 click behavior: one click toggles the Scoutbot
    // panel. The popover-on-click route (SCO-037) added a layout shift
    // operators perceived as broken — it positioned poorly inside the status
    // bar's stacking context and made the primary action a two-click flow.
    toggleScoutbot(broadcast ?? null);
  };

  const openQuickMenu = (event: ReactMouseEvent) => {
    const items: MenuItem[] = [
      { kind: "action", label: "Brief me now", onSelect: () => actions.triggerBrief() },
      { kind: "action", label: "Run state", onSelect: () => actions.triggerAskState() },
      { kind: "action", label: "New chat", onSelect: () => actions.startNewChat() },
      { kind: "separator" },
      { kind: "action", label: "Open chat", onSelect: () => actions.focusScoutbot() },
    ];
    showContextMenu(event, items);
  };

  return (
    <button
      type="button"
      className={`s-scoutbot-chip ${variantClass}`}
      onClick={handlePrimaryClick}
      onContextMenu={openQuickMenu}
      title={title}
    >
      <Bot size={14} className="s-scoutbot-chip-icon" aria-hidden="true" />
      {surface.kind === "activity" && (
        <>
          {activityShowsSpinner(surface.activity) ? (
            <Loader2 size={10} className="s-scoutbot-chip-spinner" aria-hidden="true" />
          ) : (
            <span className="s-scoutbot-chip-dot s-scoutbot-chip-dot--pulse" aria-hidden="true" />
          )}
          <span className="s-scoutbot-chip-text">{surface.label}</span>
        </>
      )}
      {surface.kind === "broadcast" && (
        <>
          <span className={tierClass(surface.tier)} aria-hidden="true" />
          <span className="s-scoutbot-chip-text">{surface.text}</span>
        </>
      )}
      {surface.kind === "brief-fresh" && (
        <span className="s-scoutbot-chip-text">{surface.label}</span>
      )}
    </button>
  );
}
