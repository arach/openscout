import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Bot, Loader2 } from "lucide-react";

import {
  selectChipBroadcast,
  useRangerBroadcastStore,
} from "../lib/ranger-broadcast-store.ts";
import {
  useRangerState,
  type RangerActivity,
  type RangerPublicState,
} from "../scout/ranger/RangerStateContext.tsx";
import type { BroadcastTier } from "../lib/types.ts";

import { RangerChipPopover } from "./RangerChipPopover.tsx";
import "./ranger-broadcast-chip.css";

const BRIEF_FRESH_WINDOW_MS = 5 * 60_000;
const TICK_MS = 15_000;

type ChipSurface =
  | { kind: "activity"; activity: RangerActivity; label: string }
  | { kind: "broadcast"; tier: BroadcastTier; text: string; clickTarget: ReturnType<typeof selectChipBroadcast> }
  | { kind: "brief-fresh"; label: string }
  | { kind: "idle" };

function tierClass(tier: BroadcastTier): string {
  return `s-ranger-chip-dot s-ranger-chip-dot--${tier}`;
}

function activityLabel(activity: RangerActivity): string {
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

function activityShowsSpinner(activity: RangerActivity): boolean {
  return activity === "thinking" || activity === "briefing";
}

function formatFreshness(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "now";
  return `${minutes}m`;
}

function resolveSurface(
  state: RangerPublicState,
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

function buildTitle(surface: ChipSurface, state: RangerPublicState): string {
  const session = state.session.title ?? null;
  const lines: string[] = [];
  switch (surface.kind) {
    case "activity":
      lines.push(`Ranger · ${surface.label}`);
      break;
    case "broadcast":
      lines.push(surface.text);
      break;
    case "brief-fresh":
      lines.push(`Brief delivered ${surface.label} ago`);
      break;
    case "idle":
    default:
      lines.push("Toggle Ranger");
      break;
  }
  if (session) lines.push(session);
  if (state.error && surface.kind !== "broadcast") {
    lines.push(state.error);
  }
  return lines.join("\n");
}

export function RangerBroadcastChip() {
  const snap = useRangerBroadcastStore();
  const broadcast = selectChipBroadcast(snap);
  const { state } = useRangerState();
  const [now, setNow] = useState(() => Date.now());
  const [popoverOpen, setPopoverOpen] = useState(false);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(interval);
  }, []);

  const surface = resolveSurface(state, broadcast, now);
  const title = buildTitle(surface, state);

  const variantClass = (() => {
    switch (surface.kind) {
      case "activity":
        return "s-ranger-chip--activity";
      case "broadcast":
        return "s-ranger-chip--active";
      case "brief-fresh":
        return "s-ranger-chip--fresh";
      case "idle":
      default:
        return "s-ranger-chip--idle";
    }
  })();

  const openPopover = (event: ReactMouseEvent) => {
    event.preventDefault();
    setPopoverOpen(true);
  };

  return (
    <>
      <button
        type="button"
        className={`s-ranger-chip ${variantClass}`}
        onClick={openPopover}
        onContextMenu={openPopover}
        title={title}
        aria-expanded={popoverOpen}
        aria-haspopup="dialog"
      >
        <Bot size={14} className="s-ranger-chip-icon" aria-hidden="true" />
        {surface.kind === "activity" && (
          <>
            {activityShowsSpinner(surface.activity) ? (
              <Loader2 size={10} className="s-ranger-chip-spinner" aria-hidden="true" />
            ) : (
              <span className="s-ranger-chip-dot s-ranger-chip-dot--pulse" aria-hidden="true" />
            )}
            <span className="s-ranger-chip-text">{surface.label}</span>
          </>
        )}
        {surface.kind === "broadcast" && (
          <>
            <span className={tierClass(surface.tier)} aria-hidden="true" />
            <span className="s-ranger-chip-text">{surface.text}</span>
          </>
        )}
        {surface.kind === "brief-fresh" && (
          <span className="s-ranger-chip-text">{surface.label}</span>
        )}
      </button>
      <RangerChipPopover open={popoverOpen} onClose={() => setPopoverOpen(false)} />
    </>
  );
}
