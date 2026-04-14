import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { timeAgo } from "../lib/time.ts";
import { actorColor } from "../lib/colors.ts";
import { agentIdFromConversation } from "../lib/router.ts";
import type { SessionEntry, Route } from "../lib/types.ts";

const KIND_LABELS: Record<string, string> = {
  direct: "DM",
  channel: "Channel",
  group_direct: "Group",
  thread: "Thread",
};

type KindFilter = "all" | "direct" | "channel" | "group_direct" | "thread";

export function SessionsScreen({ navigate }: { navigate: (r: Route) => void }) {
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [filter, setFilter] = useState<KindFilter>("all");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api<SessionEntry[]>("/api/sessions");
      setSessions(data.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useBrokerEvents(load);

  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const kinds = Array.from(new Set(sessions.map((s) => s.kind)));
  const filtered = filter === "all" ? sessions : sessions.filter((s) => s.kind === filter);

  return (
    <div className="s-sessions-screen">
      <div className="s-sessions-header">
        <h2 className="s-page-title">Sessions</h2>
        <span className="s-meta">{sessions.length} conversations</span>
      </div>

      {kinds.length > 1 && (
        <div className="s-filter-bar">
          <button
            type="button"
            className={`s-filter-chip${filter === "all" ? " s-filter-chip-active" : ""}`}
            onClick={() => setFilter("all")}
          >
            All
          </button>
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              className={`s-filter-chip${filter === k ? " s-filter-chip-active" : ""}`}
              onClick={() => setFilter(k as KindFilter)}
            >
              {KIND_LABELS[k] ?? k}
            </button>
          ))}
        </div>
      )}

      {error && <p className="s-error">{error}</p>}

      {filtered.length === 0 ? (
        <div className="s-empty" style={{ textAlign: "center" }}>
          <p>No conversations</p>
          <p>Conversations appear here when agents communicate</p>
        </div>
      ) : (
        <div className="s-inbox">
          {filtered.map((session) => {
            const agentId = agentIdFromConversation(session.id);
            const displayTitle = session.title || session.id;
            const initial = (session.agentName ?? displayTitle)[0]?.toUpperCase() ?? "?";

            return (
              <div
                key={session.id}
                className="s-inbox-row"
                onClick={() => {
                  if (agentId) {
                    navigate({ view: "agents", agentId });
                  } else {
                    navigate({ view: "sessions", sessionId: session.id });
                  }
                }}
              >
                <div
                  className="s-avatar"
                  style={{ background: actorColor(session.agentName ?? displayTitle) }}
                >
                  {initial}
                </div>
                <div className="s-inbox-body">
                  <div className="s-inbox-header">
                    <span className="s-inbox-name">{displayTitle}</span>
                    <span className="s-badge">{KIND_LABELS[session.kind] ?? session.kind}</span>
                    {session.harness && <span className="s-badge">{session.harness}</span>}
                    <span className="s-spacer" />
                    {session.lastMessageAt && (
                      <span className="s-time">{timeAgo(session.lastMessageAt)}</span>
                    )}
                  </div>
                  {session.preview ? (
                    <p className="s-inbox-preview">{session.preview}</p>
                  ) : (
                    <p className="s-inbox-preview s-inbox-preview-empty">No messages yet</p>
                  )}
                  {session.participantIds.length > 1 && (
                    <div className="s-session-participants">
                      {session.participantIds.slice(0, 4).join(", ")}
                      {session.participantIds.length > 4 && ` +${session.participantIds.length - 4}`}
                    </div>
                  )}
                </div>
                <span className="s-chevron" />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
