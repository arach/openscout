import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./ctx-panel.css";
import { api } from "../../lib/api.ts";
import { useListArrowNav, makeSearchHandoff, useSlashToFocus, rovingTabIndex } from "../../lib/keyboard-nav.ts";
import { actorColor } from "../../lib/colors.ts";
import {
  conversationDisplayTitle,
  isDirectConversation,
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
import type { MessagesFilter, MessagesSort, SessionEntry } from "../../lib/types.ts";

const FILTERS: MessagesFilter[] = ["all", "dm", "channel"];
const FILTER_LABEL: Record<MessagesFilter, string> = {
  all: "All",
  dm: "DMs",
  channel: "Channels",
};

const SORTS: MessagesSort[] = ["recent", "name", "unread"];
const SORT_LABEL: Record<MessagesSort, string> = {
  recent: "Recent",
  name: "Name",
  unread: "Unread",
};

export function ScoutMessagesLeftPanel() {
  const { route, navigate } = useScout();
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [lastViewed, setLastViewed] = useState<LastViewedMap>(() => loadLastViewedMap());
  const [query, setQuery] = useState("");

  const activeRouteFilter: MessagesFilter =
    route.view === "messages" && route.filter ? route.filter : "all";
  const activeRouteSort: MessagesSort =
    route.view === "messages" && route.sort ? route.sort : "recent";

  const activeId =
    route.view === "messages" ? route.conversationId :
    route.view === "conversation" ? route.conversationId :
    route.view === "channels" ? route.channelId :
    route.view === "agent-info" ? route.conversationId :
    route.view === "agents" ? route.conversationId :
    undefined;

  const load = useCallback(async () => {
    const data = await api<SessionEntry[]>("/api/conversations").catch(
      () => [] as SessionEntry[],
    );
    setSessions(data);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useBrokerEvents((event) => {
    if (event.kind === "message.posted" || event.kind === "conversation.upserted") {
      void load();
    }
  });

  const filtered = useMemo(() => {
    let list = sessions;
    if (activeRouteFilter === "dm") list = list.filter(isDirectConversation);
    else if (activeRouteFilter === "channel") list = list.filter(isGroupConversation);

    if (query) {
      const q = query.toLowerCase();
      list = list.filter((s) =>
        conversationDisplayTitle(s).toLowerCase().includes(q)
        || s.id.toLowerCase().includes(q)
        || (s.preview ?? "").toLowerCase().includes(q),
      );
    }

    const sorted = [...list];
    switch (activeRouteSort) {
      case "name":
        sorted.sort((a, b) =>
          conversationDisplayTitle(a)
            .toLowerCase()
            .localeCompare(conversationDisplayTitle(b).toLowerCase()),
        );
        break;
      case "unread": {
        const unreadScore = (s: SessionEntry) =>
          isUnread(s.lastMessageAt, s.id, lastViewed) ? 0 : 1;
        sorted.sort((a, b) => {
          const ua = unreadScore(a);
          const ub = unreadScore(b);
          if (ua !== ub) return ua - ub;
          return (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0);
        });
        break;
      }
      case "recent":
      default:
        sorted.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
        break;
    }
    return sorted;
  }, [sessions, activeRouteFilter, activeRouteSort, query, lastViewed]);

  const setFilter = (filter: MessagesFilter) => {
    navigate({
      view: "messages",
      ...(activeId ? { conversationId: activeId } : {}),
      ...(filter !== "all" ? { filter } : {}),
      ...(activeRouteSort !== "recent" ? { sort: activeRouteSort } : {}),
    });
  };

  const setSort = (sort: MessagesSort) => {
    navigate({
      view: "messages",
      ...(activeId ? { conversationId: activeId } : {}),
      ...(activeRouteFilter !== "all" ? { filter: activeRouteFilter } : {}),
      ...(sort !== "recent" ? { sort } : {}),
    });
  };

  const onSelect = (s: SessionEntry) => {
    setLastViewed(saveLastViewed(s.id));
    navigate({
      view: "messages",
      conversationId: s.id,
      ...(activeRouteFilter !== "all" ? { filter: activeRouteFilter } : {}),
      ...(activeRouteSort !== "recent" ? { sort: activeRouteSort } : {}),
    });
  };

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const onListKeyDown = useListArrowNav();
  const onSearchKeyDown = makeSearchHandoff(() => listRef.current);
  useSlashToFocus(useCallback(() => inputRef.current, []));

  return (
    <div className="ctx-panel">
      <div className="ctx-panel-tabs">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={[
              "ctx-panel-tab",
              activeRouteFilter === f && "ctx-panel-tab--active",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => setFilter(f)}
          >
            {FILTER_LABEL[f]}
          </button>
        ))}
      </div>

      <div className="ctx-panel-toolbar">
        <input
          ref={inputRef}
          type="text"
          className="ctx-panel-search-input"
          placeholder="Filter…  (/)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKeyDown}
        />
        <div className="ctx-panel-sort" role="group" aria-label="Sort">
          {SORTS.map((s) => (
            <button
              key={s}
              type="button"
              title={`Sort by ${SORT_LABEL[s].toLowerCase()}`}
              className={[
                "ctx-panel-sort-option",
                activeRouteSort === s && "ctx-panel-sort-option--active",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => setSort(s)}
            >
              {SORT_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={listRef}
        className="ctx-panel-list ctx-panel-list--scroll"
        onKeyDown={onListKeyDown}
      >
        {filtered.length === 0 ? (
          <div className="ctx-panel-empty">{query ? "No match" : "Nothing yet"}</div>
        ) : (
          filtered.map((s, idx) => {
            const active = s.id === activeId;
            const unread = isUnread(s.lastMessageAt, s.id, lastViewed);
            const title = conversationDisplayTitle(s);
            const channel = isGroupConversation(s);
            const hasAnyActive = filtered.some((x) => x.id === activeId);
            return (
              <button
                key={s.id}
                type="button"
                tabIndex={rovingTabIndex(active, hasAnyActive, idx === 0)}
                className={[
                  "ctx-panel-item",
                  active && "ctx-panel-item--active",
                  unread && "ctx-panel-item--unread",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => onSelect(s)}
              >
                {channel ? (
                  <div className="ctx-panel-hash">#</div>
                ) : (
                  <div
                    className="ctx-panel-avatar"
                    style={{ background: actorColor(s.agentName ?? title) }}
                  >
                    {title[0]?.toUpperCase() ?? "?"}
                  </div>
                )}
                <div className="ctx-panel-body">
                  <span className="ctx-panel-name">{title}</span>
                  {s.preview && <span className="ctx-panel-preview">{s.preview}</span>}
                </div>
                <div className="ctx-panel-trailing">
                  {s.lastMessageAt && (
                    <span className="ctx-panel-time">{timeAgo(s.lastMessageAt)}</span>
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
