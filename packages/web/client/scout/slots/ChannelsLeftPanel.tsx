import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./ctx-panel.css";
import { api } from "../../lib/api.ts";
import { useListArrowNav, makeSearchHandoff, useSlashToFocus, rovingTabIndex } from "../../lib/keyboard-nav.ts";
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

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const onListKeyDown = useListArrowNav();
  const onSearchKeyDown = makeSearchHandoff(() => listRef.current);
  useSlashToFocus(useCallback(() => inputRef.current, []));

  return (
    <div className="ctx-panel">
      <div className="ctx-panel-search">
        <input
          ref={inputRef}
          type="text"
          className="ctx-panel-search-input"
          placeholder="Filter channels…  (press /)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKeyDown}
        />
      </div>
      <div
        ref={listRef}
        className="ctx-panel-list ctx-panel-list--scroll"
        onKeyDown={onListKeyDown}
      >
        {filtered.length === 0 ? (
          <div className="ctx-panel-empty">
            {query ? "No match" : channels.length === 0 ? "No channels yet" : "No channels"}
          </div>
        ) : (
          filtered.map((ch, idx) => {
            const active = ch.id === activeId;
            const unread = isUnread(ch.lastMessageAt, ch.id, lastViewed);
            const name = conversationDisplayTitle(ch);
            const hasAnyActive = filtered.some((c) => c.id === activeId);
            return (
              <button
                key={ch.id}
                type="button"
                tabIndex={rovingTabIndex(active, hasAnyActive, idx === 0)}
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
