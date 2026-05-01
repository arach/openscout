import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { timeAgo } from "../../lib/time.ts";
import {
  isUnread,
  loadLastViewedMap,
  saveLastViewed,
  type LastViewedMap,
} from "../../lib/sessionRead.ts";
import { useScout } from "../Provider.tsx";
import type { SessionEntry } from "../../lib/types.ts";

function isChannelSession(s: SessionEntry): boolean {
  return s.kind === "channel" || s.id.startsWith("channel.");
}

function channelDisplayName(session: SessionEntry): string {
  if (session.title && session.title !== session.id) return session.title;
  return session.id.replace(/^channel\./, "");
}

export function ScoutChannelsLeftPanel() {
  const { route, navigate } = useScout();
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [lastViewed, setLastViewed] = useState<LastViewedMap>(() => loadLastViewedMap());
  const [query, setQuery] = useState("");

  const activeId = route.view === "channels" ? route.channelId : undefined;

  const loadSessions = useCallback(async () => {
    const data = await api<SessionEntry[]>("/api/sessions").catch(() => [] as SessionEntry[]);
    setSessions(data);
  }, []);

  useEffect(() => { void loadSessions(); }, [loadSessions]);

  useBrokerEvents((event) => {
    if (event.kind === "message.posted" || event.kind === "conversation.upserted") {
      void loadSessions();
    }
  });

  const channels = useMemo(
    () => sessions
      .filter(isChannelSession)
      .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)),
    [sessions],
  );

  const filtered = query
    ? channels.filter((c) => channelDisplayName(c).toLowerCase().includes(query.toLowerCase()))
    : channels;

  const onSelect = (id: string) => {
    setLastViewed(saveLastViewed(id));
    navigate({ view: "channels", channelId: id });
  };

  return (
    <div className="ch-left-panel">
      <div className="ch-left-panel-search">
        <input
          type="text"
          className="ch-left-panel-search-input"
          placeholder="Filter channels…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="ch-left-panel-list">
        {filtered.length === 0 ? (
          <div className="ch-left-panel-empty">
            {query ? "No match" : channels.length === 0 ? "No channels yet" : "No channels"}
          </div>
        ) : (
          filtered.map((ch) => {
            const active = ch.id === activeId;
            const unread = isUnread(ch.lastMessageAt, ch.id, lastViewed);
            const name = channelDisplayName(ch);
            return (
              <button
                key={ch.id}
                type="button"
                className={[
                  "ch-left-panel-item",
                  active && "ch-left-panel-item--active",
                  unread && "ch-left-panel-item--unread",
                ].filter(Boolean).join(" ")}
                onClick={() => onSelect(ch.id)}
              >
                <div className="ch-left-panel-hash">#</div>
                <div className="ch-left-panel-body">
                  <span className="ch-left-panel-name">{name}</span>
                  {ch.preview && (
                    <span className="ch-left-panel-preview">{ch.preview}</span>
                  )}
                </div>
                <div className="ch-left-panel-trailing">
                  {ch.lastMessageAt && (
                    <span className="ch-left-panel-time">{timeAgo(ch.lastMessageAt)}</span>
                  )}
                  {unread && <span className="ch-left-panel-dot" />}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
