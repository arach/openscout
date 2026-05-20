import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Bot, Loader2, MoreHorizontal } from "lucide-react";
import { useContextMenu, type MenuItem } from "../../components/ContextMenu.tsx";
import {
  useRangerState,
  type RangerActivity,
  type RangerPublicState,
} from "./RangerStateContext.tsx";

const BRIEF_FRESH_WINDOW_MS = 5 * 60_000;
const TICK_MS = 15_000;
const REMINDER_BODY_MAX_LEN = 48;

type IndicatorTone = "active" | "fresh" | "attention-amber" | "attention-red";

type Indicator = {
  dot?: { className: string };
  spinner?: boolean;
  label: string;
  tone: IndicatorTone;
};

function formatFreshness(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return "now";
  return `${minutes}m`;
}

function truncateBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length <= REMINDER_BODY_MAX_LEN) return trimmed;
  return `${trimmed.slice(0, REMINDER_BODY_MAX_LEN - 1).trimEnd()}…`;
}

function activityIndicator(activity: RangerActivity): Indicator | null {
  switch (activity) {
    case "listening":
      return { dot: { className: "bg-lime-300 animate-pulse" }, label: "listening", tone: "active" };
    case "thinking":
      return { spinner: true, label: "thinking", tone: "active" };
    case "speaking":
      return { dot: { className: "bg-lime-300 animate-pulse" }, label: "speaking", tone: "active" };
    case "briefing":
      return { spinner: true, label: "briefing", tone: "active" };
    case "idle":
    default:
      return null;
  }
}

function resolveIndicator(state: RangerPublicState, now: number): Indicator | null {
  if (state.error) {
    return { dot: { className: "bg-red-400" }, label: "error", tone: "attention-red" };
  }

  const reminderCount = state.reminders.dueCount;
  if (reminderCount > 0) {
    return {
      dot: { className: "bg-amber-300 animate-pulse" },
      label: `${reminderCount} due`,
      tone: "attention-amber",
    };
  }

  const active = activityIndicator(state.activity);
  if (active) return active;

  const briefAge = state.brief.lastDeliveredAt
    ? Math.max(0, now - state.brief.lastDeliveredAt)
    : null;
  if (briefAge !== null && briefAge <= BRIEF_FRESH_WINDOW_MS) {
    return { label: formatFreshness(briefAge), tone: "fresh" };
  }

  if (state.voice.setupBlocked) {
    return { label: "voice setup", tone: "attention-amber" };
  }

  return null;
}

function toneClass(tone: IndicatorTone): string {
  switch (tone) {
    case "active":
      return "text-lime-200";
    case "attention-amber":
      return "text-amber-200";
    case "attention-red":
      return "text-red-200";
    case "fresh":
    default:
      return "text-neutral-500";
  }
}

function containerClass(tone: IndicatorTone | null): string {
  switch (tone) {
    case "attention-amber":
      return "border-amber-400/40 bg-amber-400/[0.08] text-amber-100";
    case "attention-red":
      return "border-red-400/40 bg-red-400/[0.08] text-red-100";
    case "active":
    case "fresh":
    case null:
    default:
      return "border-transparent text-neutral-400 hover:border-neutral-700 hover:bg-neutral-800/40 hover:text-neutral-100";
  }
}

export function RangerStatusPill() {
  const { state, actions } = useRangerState();
  const showContextMenu = useContextMenu();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(interval);
  }, []);

  const indicator = resolveIndicator(state, now);

  const tooltip = state.error
    ? state.error
    : state.session.title
      ? state.session.title
      : "Open chat";

  const openMenu = (event: ReactMouseEvent) => {
    const items: MenuItem[] = [];

    if (state.reminders.due.length > 0) {
      for (const reminder of state.reminders.due) {
        const label = truncateBody(reminder.body);
        items.push({
          kind: "action",
          label: `Ask: ${label}`,
          onSelect: () => actions.askReminderStatus({ id: reminder.id, body: reminder.body }),
        });
      }
      for (const reminder of state.reminders.due) {
        items.push({
          kind: "action",
          label: `Dismiss: ${truncateBody(reminder.body)}`,
          onSelect: () => actions.dismissReminder(reminder.id),
        });
      }
      items.push({ kind: "separator" });
    }

    items.push({
      kind: "action",
      label: "Brief me now",
      onSelect: () => actions.triggerBrief(),
    });
    items.push({
      kind: "action",
      label: "Ask state",
      onSelect: () => actions.triggerAskState(),
    });
    items.push({ kind: "separator" });
    items.push({
      kind: "action",
      label: "Settings",
      onSelect: () => actions.openRangerSettings(),
    });

    showContextMenu(event, items);
  };

  return (
    <div
      className={`flex shrink-0 items-center rounded border text-[11px] transition-colors ${containerClass(indicator?.tone ?? null)}`}
      onContextMenu={openMenu}
    >
      <button
        type="button"
        title={tooltip}
        aria-label="Open chat"
        onClick={() => actions.focusRanger()}
        className="flex items-center gap-1.5 px-2 py-0.5 font-mono"
      >
        <Bot size={12} className="shrink-0 text-lime-300" />
        {indicator && (
          <>
            {indicator.dot && (
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${indicator.dot.className}`}
                aria-hidden="true"
              />
            )}
            {indicator.spinner && (
              <Loader2 size={10} className="animate-spin text-lime-300" aria-hidden="true" />
            )}
            <span className={toneClass(indicator.tone)}>{indicator.label}</span>
          </>
        )}
      </button>
      <button
        type="button"
        title="More actions"
        aria-label="Open menu"
        onClick={openMenu}
        className="flex items-center justify-center border-l border-neutral-700/60 px-1.5 py-0.5 opacity-60 transition-opacity hover:opacity-100"
      >
        <MoreHorizontal size={12} />
      </button>
    </div>
  );
}
