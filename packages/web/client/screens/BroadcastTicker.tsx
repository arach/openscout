import "./broadcast-ticker.css";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { api } from "../lib/api.ts";
import { useBroadcastEvents } from "../lib/broadcast-events.ts";
import type { Broadcast, BroadcastTier } from "../lib/types.ts";

const HISTORY_LIMIT = 50;
const VISIBLE_LIFETIME_MS = 30_000;
const SILENT_PLACEHOLDER_MS = 5 * 60_000;
const MUTE_KEY = "openscout.broadcast.mute";
const MUTE_30M_MS = 30 * 60_000;

type MuteFilter = "all" | "warn-plus" | "errors-only";

type MuteState = {
  filter: MuteFilter;
  goDark: boolean;
  muteUntil: number;
};

const DEFAULT_MUTE: MuteState = {
  filter: "all",
  goDark: false,
  muteUntil: 0,
};

function readMuteState(): MuteState {
  if (typeof window === "undefined") return DEFAULT_MUTE;
  try {
    const raw = window.localStorage.getItem(MUTE_KEY);
    if (!raw) return DEFAULT_MUTE;
    const parsed = JSON.parse(raw) as Partial<MuteState>;
    return {
      filter: parsed.filter === "warn-plus" || parsed.filter === "errors-only" ? parsed.filter : "all",
      goDark: parsed.goDark === true,
      muteUntil: typeof parsed.muteUntil === "number" ? parsed.muteUntil : 0,
    };
  } catch {
    return DEFAULT_MUTE;
  }
}

function writeMuteState(state: MuteState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MUTE_KEY, JSON.stringify(state));
  } catch {
    /* swallow */
  }
}

function tierAllowed(tier: BroadcastTier, filter: MuteFilter): boolean {
  if (filter === "all") return true;
  if (filter === "warn-plus") return tier !== "info";
  return tier === "error";
}

function isFullyMuted(state: MuteState, now: number): boolean {
  if (state.goDark) return true;
  if (state.muteUntil > now) return true;
  return false;
}

function shouldDisplay(broadcast: Broadcast, state: MuteState, now: number): boolean {
  if (isFullyMuted(state, now)) return false;
  return tierAllowed(broadcast.tier, state.filter);
}

function formatHms(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function dotClass(tier: BroadcastTier): string {
  return `s-broadcast-ticker-dot s-broadcast-ticker-dot--${tier}`;
}

export function BroadcastTicker() {
  const [history, setHistory] = useState<Broadcast[]>([]);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [muteState, setMuteState] = useState<MuteState>(() => readMuteState());
  const [now, setNow] = useState<number>(() => Date.now());

  const handleBroadcast = useCallback((broadcast: Broadcast) => {
    setHistory((prev) => {
      const exists = prev.some((b) => b.id === broadcast.id);
      if (exists) return prev;
      const next = [...prev, broadcast];
      if (next.length > HISTORY_LIMIT) {
        return next.slice(next.length - HISTORY_LIMIT);
      }
      return next;
    });
  }, []);

  useBroadcastEvents(handleBroadcast);

  // Seed from /recent on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await api<{ broadcasts: Broadcast[] }>(
          `/api/broadcast/recent?limit=${HISTORY_LIMIT}`,
        );
        if (cancelled) return;
        const incoming = result.broadcasts ?? [];
        setHistory((prev) => {
          const seen = new Set(prev.map((b) => b.id));
          const merged = [...prev];
          for (const b of incoming) {
            if (!seen.has(b.id)) merged.push(b);
          }
          merged.sort((a, b) => a.ts - b.ts);
          return merged.length > HISTORY_LIMIT
            ? merged.slice(merged.length - HISTORY_LIMIT)
            : merged;
        });
      } catch {
        /* swallow */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Tick the clock so we can fade items, expire mute timer, and show
  // the silent placeholder.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  // Auto-clear expired mute timer.
  useEffect(() => {
    if (muteState.muteUntil > 0 && muteState.muteUntil <= now) {
      const next = { ...muteState, muteUntil: 0 };
      setMuteState(next);
      writeMuteState(next);
    }
  }, [muteState, now]);

  const filteredHistory = useMemo(
    () => history.filter((b) => shouldDisplay(b, muteState, now)),
    [history, muteState, now],
  );

  const visible = useMemo<Broadcast | null>(() => {
    if (filteredHistory.length === 0) return null;
    const last = filteredHistory[filteredHistory.length - 1]!;
    if (now - last.ts <= VISIBLE_LIFETIME_MS) return last;
    if (filteredHistory.length >= 2) {
      const prior = filteredHistory[filteredHistory.length - 2]!;
      if (now - prior.ts <= SILENT_PLACEHOLDER_MS) return prior;
    }
    if (now - last.ts <= SILENT_PLACEHOLDER_MS) return last;
    return null;
  }, [filteredHistory, now]);

  const moreCount = Math.max(0, filteredHistory.length - 1);

  const updateMute = useCallback((next: MuteState) => {
    setMuteState(next);
    writeMuteState(next);
  }, []);

  const muteCountdown = useMemo(() => {
    if (muteState.muteUntil <= now) return null;
    const remaining = Math.max(0, muteState.muteUntil - now);
    const mins = Math.ceil(remaining / 60_000);
    return `mute ${mins}m`;
  }, [muteState.muteUntil, now]);

  const muted = isFullyMuted(muteState, now);

  return (
    <>
      <div className="s-broadcast-ticker" role="status" aria-live="polite">
        <span
          className={dotClass(visible?.tier ?? "info")}
          aria-hidden="true"
        />
        <span className="s-broadcast-ticker-time">
          {visible ? formatHms(visible.ts) : "--:--:--"}
        </span>
        {visible ? (
          <button
            type="button"
            className="s-broadcast-ticker-text"
            onClick={() => setPopoverOpen(true)}
            title="View recent broadcasts"
          >
            {visible.text}
          </button>
        ) : (
          <button
            type="button"
            className="s-broadcast-ticker-text s-broadcast-ticker-text--placeholder"
            onClick={() => setPopoverOpen(true)}
          >
            {muted ? "(broadcasts muted)" : "(no recent activity)"}
          </button>
        )}
        {muteCountdown && (
          <span className="s-broadcast-ticker-mute-chip" title="Mute timer">
            {muteCountdown}
          </span>
        )}
        {moreCount > 0 && (
          <button
            type="button"
            className="s-broadcast-ticker-more"
            onClick={() => setPopoverOpen(true)}
            title="Open recent broadcasts"
          >
            {moreCount} more
          </button>
        )}
      </div>
      {popoverOpen && (
        <BroadcastPopover
          history={history}
          muteState={muteState}
          onUpdateMute={updateMute}
          onClose={() => setPopoverOpen(false)}
          now={now}
        />
      )}
    </>
  );
}

function BroadcastPopover({
  history,
  muteState,
  onUpdateMute,
  onClose,
  now,
}: {
  history: Broadcast[];
  muteState: MuteState;
  onUpdateMute: (next: MuteState) => void;
  onClose: () => void;
  now: number;
}) {
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const recent = useMemo(
    () => history
      .filter((broadcast) => tierAllowed(broadcast.tier, muteState.filter))
      .slice(-20)
      .slice()
      .reverse(),
    [history, muteState.filter],
  );

  const setFilter = (filter: MuteFilter) => {
    onUpdateMute({ ...muteState, filter, goDark: false });
  };

  const toggleMute30m = () => {
    if (muteState.muteUntil > now) {
      onUpdateMute({ ...muteState, muteUntil: 0 });
    } else {
      onUpdateMute({ ...muteState, muteUntil: now + MUTE_30M_MS, goDark: false });
    }
  };

  const toggleGoDark = () => {
    onUpdateMute({ ...muteState, goDark: !muteState.goDark });
  };

  const muteCountdown = muteState.muteUntil > now
    ? `${Math.ceil((muteState.muteUntil - now) / 60_000)}m left`
    : null;

  return (
    <>
      <div
        className="s-broadcast-popover-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={popoverRef}
        className="s-broadcast-popover"
        role="dialog"
        aria-label="Broadcasts"
      >
        <div className="s-broadcast-popover-head">
          <span className="s-broadcast-popover-title">Broadcasts</span>
          <span className="s-broadcast-popover-title" style={{ flex: "0 0 auto" }}>
            {history.length} buffered
          </span>
        </div>
        <div className="s-broadcast-mute-row">
          <button
            type="button"
            className={`s-broadcast-mute-btn${
              muteState.filter === "all" && !muteState.goDark ? " s-broadcast-mute-btn--active" : ""
            }`}
            onClick={() => setFilter("all")}
            aria-pressed={muteState.filter === "all" && !muteState.goDark}
          >
            All
          </button>
          <button
            type="button"
            className={`s-broadcast-mute-btn${
              muteState.filter === "warn-plus" && !muteState.goDark ? " s-broadcast-mute-btn--active" : ""
            }`}
            onClick={() => setFilter("warn-plus")}
            aria-pressed={muteState.filter === "warn-plus" && !muteState.goDark}
          >
            Warn+
          </button>
          <button
            type="button"
            className={`s-broadcast-mute-btn${
              muteState.filter === "errors-only" && !muteState.goDark ? " s-broadcast-mute-btn--active" : ""
            }`}
            onClick={() => setFilter("errors-only")}
            aria-pressed={muteState.filter === "errors-only" && !muteState.goDark}
          >
            Errors
          </button>
          <button
            type="button"
            className={`s-broadcast-mute-btn${
              muteState.muteUntil > now ? " s-broadcast-mute-btn--active" : ""
            }`}
            onClick={toggleMute30m}
            title={muteCountdown ?? "Suppress for 30 minutes"}
            aria-pressed={muteState.muteUntil > now}
          >
            {muteCountdown ? `Mute ${muteCountdown}` : "Mute 30m"}
          </button>
          <button
            type="button"
            className={`s-broadcast-mute-btn${
              muteState.goDark ? " s-broadcast-mute-btn--active" : ""
            }`}
            onClick={toggleGoDark}
            title="Suppress until toggled off"
            aria-pressed={muteState.goDark}
          >
            Go dark
          </button>
        </div>
        <div className="s-broadcast-popover-list">
          {recent.length === 0 ? (
            <div className="s-broadcast-popover-empty">
              {history.length === 0 ? "No broadcasts yet." : "No broadcasts match this filter."}
            </div>
          ) : (
            recent.map((broadcast) => (
              <div key={broadcast.id} className="s-broadcast-popover-row">
                <span className={dotClass(broadcast.tier)} aria-hidden="true" />
                <span className="s-broadcast-popover-row-time">
                  {formatHms(broadcast.ts)}
                </span>
                <span
                  className="s-broadcast-popover-row-text"
                  title={broadcast.text}
                >
                  {broadcast.text}
                </span>
              </div>
            ))
          )}
        </div>
        <div className="s-broadcast-popover-foot">
          Showing {Math.min(recent.length, 20)} of {history.length} buffered broadcast{history.length === 1 ? "" : "s"}.
          Filtering applies live.
        </div>
      </div>
    </>
  );
}
