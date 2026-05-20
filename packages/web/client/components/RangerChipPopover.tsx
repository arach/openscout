import { useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  Bell,
  Bot,
  CheckCircle2,
  ListChecks,
  Loader2,
  Radio,
  Settings,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

import {
  DEFAULT_MUTE,
  dismissPromotedBroadcast,
  selectActiveBroadcast,
  shouldDisplayBroadcast,
  tierAllowed,
  toggleRanger,
  updateMute,
  useRangerBroadcastStore,
  type MuteFilter,
  type MuteState,
} from "../lib/ranger-broadcast-store.ts";
import {
  useRangerState,
  type RangerActivity,
} from "../scout/ranger/RangerStateContext.tsx";
import type { Broadcast, BroadcastTier } from "../lib/types.ts";

import "./ranger-chip-popover.css";

const MUTE_30M_MS = 30 * 60_000;
const HISTORY_RENDER_LIMIT = 10;

function activityLabel(activity: RangerActivity): string {
  switch (activity) {
    case "listening":
      return "Listening";
    case "thinking":
      return "Thinking";
    case "speaking":
      return "Speaking";
    case "briefing":
      return "Briefing";
    case "idle":
    default:
      return "Idle";
  }
}

function formatHms(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function tierDotClass(tier: BroadcastTier): string {
  return `s-ranger-popover-dot s-ranger-popover-dot--${tier}`;
}

function Section({
  title,
  trailing,
  children,
}: {
  title: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="s-ranger-popover-section">
      <header className="s-ranger-popover-section-head">
        <span>{title}</span>
        {trailing}
      </header>
      <div className="s-ranger-popover-section-body">{children}</div>
    </section>
  );
}

function MuteButton({
  label,
  active,
  title,
  onClick,
}: {
  label: string;
  active: boolean;
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`s-ranger-popover-mute-btn${active ? " s-ranger-popover-mute-btn--active" : ""}`}
      onClick={onClick}
      title={title}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

export function RangerChipPopover({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { state, actions } = useRangerState();
  const snap = useRangerBroadcastStore();
  const active = selectActiveBroadcast(snap);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const recentBroadcasts = useMemo<Broadcast[]>(() => {
    return [...snap.history]
      .reverse()
      .filter((b) => tierAllowed(b.tier, snap.mute.filter))
      .slice(0, HISTORY_RENDER_LIMIT);
  }, [snap.history, snap.mute.filter]);

  if (!open) return null;

  const mute: MuteState = snap.mute ?? DEFAULT_MUTE;
  const muteCountdownMs = mute.muteUntil > snap.now ? mute.muteUntil - snap.now : 0;
  const muteCountdownLabel = muteCountdownMs > 0
    ? `${Math.ceil(muteCountdownMs / 60_000)}m left`
    : null;

  const setFilter = (filter: MuteFilter) => {
    updateMute({ ...mute, filter, goDark: false });
  };
  const toggleMute30m = () => {
    if (mute.muteUntil > snap.now) {
      updateMute({ ...mute, muteUntil: 0 });
    } else {
      updateMute({ ...mute, muteUntil: snap.now + MUTE_30M_MS, goDark: false });
    }
  };
  const toggleGoDark = () => {
    updateMute({ ...mute, goDark: !mute.goDark });
  };

  const handleOpenChat = () => {
    toggleRanger(active ?? null);
    onClose();
  };

  const handleAction = (fn: () => void) => () => {
    fn();
    onClose();
  };

  const dueReminders = state.reminders.due;
  const hasError = Boolean(state.error);
  const showBriefFresh =
    state.brief.lastDeliveredAt !== null &&
    snap.now - state.brief.lastDeliveredAt <= 5 * 60_000;

  return (
    <>
      <div
        className="s-ranger-popover-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={ref}
        className="s-ranger-popover"
        role="dialog"
        aria-label="Ranger"
      >
        <header className="s-ranger-popover-head">
          <Bot size={14} className="s-ranger-popover-head-icon" aria-hidden="true" />
          <span className="s-ranger-popover-head-title">
            {state.session.title ?? "Ranger"}
          </span>
          <button
            type="button"
            className="s-ranger-popover-close"
            onClick={onClose}
            aria-label="Close"
            title="Close"
          >
            <X size={12} />
          </button>
        </header>

        <Section title="Now">
          {hasError ? (
            <div className="s-ranger-popover-now s-ranger-popover-now--error">
              <span className="s-ranger-popover-dot s-ranger-popover-dot--error" />
              <span>{state.error}</span>
            </div>
          ) : state.activity !== "idle" ? (
            <div className="s-ranger-popover-now s-ranger-popover-now--activity">
              <span className="s-ranger-popover-dot s-ranger-popover-dot--pulse" />
              <span>{activityLabel(state.activity)}</span>
            </div>
          ) : active ? (
            <div className="s-ranger-popover-now">
              <span className={tierDotClass(active.tier)} />
              <span className="s-ranger-popover-now-text">{active.text}</span>
              <span className="s-ranger-popover-now-time">{formatHms(active.ts)}</span>
              <button
                type="button"
                className="s-ranger-popover-now-dismiss"
                onClick={dismissPromotedBroadcast}
                title="Dismiss"
                aria-label="Dismiss"
              >
                <X size={11} />
              </button>
            </div>
          ) : showBriefFresh && state.brief.lastDeliveredAt ? (
            <div className="s-ranger-popover-now">
              <span className="s-ranger-popover-dot s-ranger-popover-dot--info" />
              <span>
                Brief delivered {Math.max(1, Math.floor((snap.now - state.brief.lastDeliveredAt) / 60_000))}m ago
              </span>
            </div>
          ) : (
            <div className="s-ranger-popover-empty-line">No active signal.</div>
          )}
        </Section>

        {dueReminders.length > 0 && (
          <Section
            title="Reminders"
            trailing={<span className="s-ranger-popover-count">{dueReminders.length}</span>}
          >
            {dueReminders.map((reminder) => (
              <div key={reminder.id} className="s-ranger-popover-reminder">
                <Bell size={11} className="s-ranger-popover-reminder-icon" aria-hidden="true" />
                <span className="s-ranger-popover-reminder-body" title={reminder.body}>
                  {reminder.body}
                </span>
                <button
                  type="button"
                  className="s-ranger-popover-icon-btn"
                  onClick={handleAction(() => actions.askReminderStatus({ id: reminder.id, body: reminder.body }))}
                  title="Ask status"
                  aria-label="Ask status"
                >
                  <Radio size={11} />
                </button>
                <button
                  type="button"
                  className="s-ranger-popover-icon-btn"
                  onClick={() => actions.dismissReminder(reminder.id)}
                  title="Dismiss"
                  aria-label="Dismiss"
                >
                  <CheckCircle2 size={11} />
                </button>
              </div>
            ))}
          </Section>
        )}

        <Section
          title="Recent broadcasts"
          trailing={<span className="s-ranger-popover-count">{snap.history.length}</span>}
        >
          {recentBroadcasts.length === 0 ? (
            <div className="s-ranger-popover-empty-line">No broadcasts.</div>
          ) : (
            <div className="s-ranger-popover-history">
              {recentBroadcasts.map((b) => {
                const dimmed = !shouldDisplayBroadcast(b, mute, snap.now);
                return (
                  <div
                    key={b.id}
                    className={`s-ranger-popover-history-row${dimmed ? " s-ranger-popover-history-row--muted" : ""}`}
                    title={b.text}
                  >
                    <span className={tierDotClass(b.tier)} aria-hidden="true" />
                    <span className="s-ranger-popover-history-time">{formatHms(b.ts)}</span>
                    <span className="s-ranger-popover-history-text">{b.text}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        <Section title="Actions">
          <div className="s-ranger-popover-actions">
            <button
              type="button"
              className="s-ranger-popover-action"
              onClick={handleAction(actions.triggerBrief)}
            >
              <ListChecks size={11} />
              <span>Brief me now</span>
            </button>
            <button
              type="button"
              className="s-ranger-popover-action"
              onClick={handleAction(actions.triggerAskState)}
            >
              <Radio size={11} />
              <span>Ask state</span>
            </button>
            <button
              type="button"
              className="s-ranger-popover-action"
              onClick={actions.toggleVoiceReplies}
              aria-pressed={state.voice.replies}
            >
              {state.voice.replies ? <Volume2 size={11} /> : <VolumeX size={11} />}
              <span>{state.voice.replies ? "Voice on" : "Voice off"}</span>
            </button>
            <button
              type="button"
              className="s-ranger-popover-action"
              onClick={handleAction(actions.openRangerSettings)}
            >
              <Settings size={11} />
              <span>Settings</span>
            </button>
            <button
              type="button"
              className="s-ranger-popover-action s-ranger-popover-action--primary"
              onClick={handleOpenChat}
            >
              <Bot size={11} />
              <span>Open chat</span>
            </button>
          </div>
        </Section>

        <footer className="s-ranger-popover-alerts">
          <span className="s-ranger-popover-alerts-label">Alerts</span>
          <MuteButton
            label="All"
            active={mute.filter === "all" && !mute.goDark}
            onClick={() => setFilter("all")}
          />
          <MuteButton
            label="Warn+"
            active={mute.filter === "warn-plus" && !mute.goDark}
            onClick={() => setFilter("warn-plus")}
          />
          <MuteButton
            label="Errors"
            active={mute.filter === "errors-only" && !mute.goDark}
            onClick={() => setFilter("errors-only")}
          />
          <MuteButton
            label={muteCountdownLabel ? `Mute ${muteCountdownLabel}` : "Mute 30m"}
            active={muteCountdownMs > 0}
            title={muteCountdownLabel ?? "Suppress for 30 minutes"}
            onClick={toggleMute30m}
          />
          <MuteButton
            label="Go dark"
            active={mute.goDark}
            title="Suppress until toggled off"
            onClick={toggleGoDark}
          />
        </footer>
      </div>
    </>
  );
}
