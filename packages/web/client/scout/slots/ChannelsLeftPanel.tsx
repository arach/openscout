import { useCallback, useEffect, useMemo, useState } from "react";
import "./ctx-panel.css";
import { api } from "../../lib/api.ts";
import {
  conversationDisplayTitle,
  isGroupConversation,
} from "../../lib/conversations.ts";
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

export function ScoutChannelsLeftPanel() {
  const { route, navigate } = useScout();
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [lastViewed, setLastViewed] = useState<LastViewedMap>(() => loadLastViewedMap());
  const [query, setQuery] = useState("");

  const activeId = route.view === "channels" ? route.channelId : undefined;

  const loadSessions = useCallback(async () => {
    const data = await api<SessionEntry[]>("/api/conversations").catch(() => [] as SessionEntry[]);
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
      .filter(isGroupConversation)
      .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)),
    [sessions],
  );

  const filtered = query
    ? channels.filter((c) => conversationDisplayTitle(c).toLowerCase().includes(query.toLowerCase()))
    : channels;

  const onSelect = (id: string) => {
    setLastViewed(saveLastViewed(id));
    navigate({ view: "channels", channelId: id });
  };

  return (
    <div className="ctx-panel">
      <div className="ctx-panel-search">
        <input
          type="text"
          className="ctx-panel-search-input"
          placeholder="Filter channels…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="ctx-panel-list ctx-panel-list--scroll">
        {filtered.length === 0 ? (
          <div className="ctx-panel-empty">
            {query ? "No match" : channels.length === 0 ? "No channels yet" : "No channels"}
          </div>
        ) : (
          filtered.map((ch) => {
            const active = ch.id === activeId;
            const unread = isUnread(ch.lastMessageAt, ch.id, lastViewed);
            const name = conversationDisplayTitle(ch);
            return (
              <button
                key={ch.id}
                type="button"
                className={[
                  "ctx-panel-item",
                  active && "ctx-panel-item--active",
                  unread && "ctx-panel-item--unread",
                ].filter(Boolean).join(" ")}
                onClick={() => onSelect(ch.id)}
              >
                <div className="ctx-panel-hash">#</div>
                <div className="ctx-panel-body">
                  <span className="ctx-panel-name">{name}</span>
                  {ch.preview && (
                    <span className="ctx-panel-preview">{ch.preview}</span>
                  )}
                </div>
                <div className="ctx-panel-trailing">
                  {ch.lastMessageAt && (
                    <span className="ctx-panel-time">{timeAgo(ch.lastMessageAt)}</span>
                  )}
                  {unread && <span className="ctx-panel-dot" />}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
