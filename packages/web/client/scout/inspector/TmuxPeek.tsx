import { useEffect, useState, type CSSProperties } from "react";
import { api } from "../../lib/api.ts";
import { timeAgo } from "../../lib/time.ts";
import type { TmuxPeekPayload } from "../../lib/types.ts";

const TMUX_PEEK_LINES = 44;
const TMUX_PEEK_COLUMNS = 132;
const TMUX_PEEK_POLL_MS = 3_500;
const TMUX_PEEK_IDLE_POLL_MS = 7_000;

function samePeek(left: TmuxPeekPayload | null, right: TmuxPeekPayload): boolean {
  return Boolean(
    left &&
    left.available === right.available &&
    left.sessionId === right.sessionId &&
    left.body === right.body &&
    left.lineCount === right.lineCount &&
    left.columnCount === right.columnCount &&
    left.truncated === right.truncated &&
    left.reason === right.reason,
  );
}

export function TmuxPeekPanel({
  agentId,
  enabled = true,
  lines = TMUX_PEEK_LINES,
  columns = TMUX_PEEK_COLUMNS,
  className,
}: {
  agentId: string | null | undefined;
  enabled?: boolean;
  lines?: number;
  columns?: number;
  className?: string;
}) {
  const [peek, setPeek] = useState<TmuxPeekPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPeek(null);
    setError(null);
    if (!enabled || !agentId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    let timeoutId: number | undefined;
    let firstLoad = true;

    const schedule = (delay: number) => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        void load();
      }, delay);
    };

    const load = async () => {
      if (cancelled) return;
      if (document.visibilityState !== "visible") {
        schedule(TMUX_PEEK_IDLE_POLL_MS);
        return;
      }

      if (firstLoad) setLoading(true);
      let nextDelay = TMUX_PEEK_POLL_MS;
      try {
        const params = new URLSearchParams({
          lines: String(lines),
          cols: String(columns),
        });
        const next = await api<TmuxPeekPayload>(
          `/api/agents/${encodeURIComponent(agentId)}/tmux-peek?${params.toString()}`,
        );
        if (cancelled) return;
        setError(null);
        setPeek((previous) => samePeek(previous, next) ? previous : next);
        nextDelay = next.available ? TMUX_PEEK_POLL_MS : TMUX_PEEK_IDLE_POLL_MS;
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        nextDelay = TMUX_PEEK_IDLE_POLL_MS;
      } finally {
        if (!cancelled) {
          firstLoad = false;
          setLoading(false);
          schedule(nextDelay);
        }
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        window.clearTimeout(timeoutId);
        void load();
      }
    };

    void load();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [agentId, columns, enabled, lines]);

  if (!enabled || !agentId) return null;

  const body = peek?.body ?? "";
  const lineCount = peek?.lineCount ?? lines;
  const columnCount = peek?.columnCount ?? columns;
  const fontSizePx = 6;
  const lineHeight = 1.32;
  const gridStyle = {
    "--tmux-peek-columns": String(columnCount),
    "--tmux-peek-rows": String(lineCount),
    "--tmux-peek-font-size": `${fontSizePx}px`,
    "--tmux-peek-line-height": String(lineHeight),
    "--tmux-peek-height": `${Math.ceil((lineCount * fontSizePx * lineHeight) + 18)}px`,
  } as CSSProperties;
  const hasScreen = Boolean(peek?.available && body);
  const status = error
    ? error
    : loading && !peek
      ? "Sampling tmux..."
      : peek?.available === false
        ? peek.reason ?? "No tmux pane is available."
        : hasScreen
          ? null
          : peek?.available
            ? "Pane is empty."
            : "Sampling tmux...";

  return (
    <div
      className={`ctx-panel-tmux-peek${className ? ` ${className}` : ""}`}
      style={gridStyle}
    >
      <div className="ctx-panel-tmux-peek-head">
        <span>Terminal sample</span>
        <span className="ctx-panel-tmux-peek-grid">
          {columnCount}x{lineCount}
        </span>
        {peek?.sessionId && (
          <span className="ctx-panel-tmux-peek-session" title={peek.sessionId}>
            {peek.sessionId.length > 12 ? peek.sessionId.slice(0, 10) : peek.sessionId}
          </span>
        )}
        {peek?.capturedAt && (
          <time dateTime={new Date(peek.capturedAt).toISOString()}>
            {timeAgo(peek.capturedAt)}
          </time>
        )}
      </div>
      {hasScreen ? (
        <pre className="ctx-panel-tmux-peek-screen" aria-live="polite">
          {body}
        </pre>
      ) : (
        <div className="ctx-panel-tmux-peek-empty" aria-live="polite">
          {status}
        </div>
      )}
      {peek?.truncated && body && (
        <div className="ctx-panel-tmux-peek-foot">
          Last {lineCount} rows from live tmux pane
        </div>
      )}
    </div>
  );
}
