import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./ctx-panel.css";
import { api } from "../../lib/api.ts";
import { useListArrowNav, makeSearchHandoff, useSlashToFocus, rovingTabIndex } from "../../lib/keyboard-nav.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { timeAgo } from "../../lib/time.ts";
import {
  loadLastViewedMap,
  saveLastViewed,
  type LastViewedMap,
} from "../../lib/sessionRead.ts";
import { useScout } from "../Provider.tsx";
import { routeMachineId } from "../../lib/router.ts";
import { RailRow } from "./RailRow.tsx";
import type {
  ListGroup,
  MessagesFilter,
  MessagesLeftRailGroupMeta,
  MessagesLeftRailList,
  MessagesLeftRailRow,
  MessagesSort,
} from "../../lib/types.ts";

const FILTERS: MessagesFilter[] = ["all", "dm", "channel"];
const FILTER_LABEL: Record<MessagesFilter, string> = {
  all: "All",
  dm: "Private",
  channel: "Shared",
};

const SORTS: MessagesSort[] = ["recent", "name", "unread"];
const SORT_LABEL: Record<MessagesSort, string> = {
  recent: "Recent",
  name: "Name",
  unread: "Unread",
};

export function ScoutMessagesLeftPanel() {
  const { route, navigate } = useScout();
  const [list, setList] = useState<MessagesLeftRailList | null>(null);
  const [lastViewed, setLastViewed] = useState<LastViewedMap>(() => loadLastViewedMap());
  const [query, setQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const machineId = routeMachineId(route);

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
    const data = await api<MessagesLeftRailList>("/api/view-lists/messages-left-rail", {
      method: "POST",
      body: JSON.stringify({
        filter: activeRouteFilter,
        sort: activeRouteSort,
        query,
        machineId,
        lastViewed,
      }),
    }).catch(() => null);
    setList(data);
  }, [activeRouteFilter, activeRouteSort, query, machineId, lastViewed]);

  useEffect(() => { void load(); }, [load]);

  useBrokerEvents((event) => {
    if (event.kind === "message.posted" || event.kind === "conversation.upserted") {
      void load();
    }
  });

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

  const onSelect = (row: MessagesLeftRailRow) => {
    setLastViewed(saveLastViewed(row.conversationId));
    if (isGroupConversationRow(row) && route.view === "channels") {
      navigate({ view: "channels", channelId: row.conversationId });
      return;
    }
    navigate({
      view: "messages",
      conversationId: row.conversationId,
      ...(activeRouteFilter !== "all" ? { filter: activeRouteFilter } : {}),
      ...(activeRouteSort !== "recent" ? { sort: activeRouteSort } : {}),
    });
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const groups = list?.groups ?? [];
  const flatRows = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  const firstConversationId = flatRows[0]?.conversationId;
  const hasAnyActive = activeId != null && flatRows.some((row) => row.conversationId === activeId);

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
          placeholder="Filter...  (/)"
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
        {groups.length === 0 ? (
          <div className="ctx-panel-empty">{query ? "No match" : "Nothing yet"}</div>
        ) : (
          groups.map((group) => (
            <MessagesGroup
              key={group.key}
              group={group}
              query={query}
              activeId={activeId}
              expanded={expandedGroups.has(group.key)}
              hasAnyActive={hasAnyActive}
              firstConversationId={firstConversationId}
              onToggle={() => toggleGroup(group.key)}
              onSelect={onSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}

function MessagesGroup({
  group,
  query,
  activeId,
  expanded,
  hasAnyActive,
  firstConversationId,
  onToggle,
  onSelect,
}: {
  group: ListGroup<MessagesLeftRailRow, MessagesLeftRailGroupMeta>;
  query: string;
  activeId: string | undefined;
  expanded: boolean;
  hasAnyActive: boolean;
  firstConversationId: string | undefined;
  onToggle: () => void;
  onSelect: (row: MessagesLeftRailRow) => void;
}) {
  const isSingle = group.rows.length === 1;
  const isOpen = Boolean(query) || expanded;
  const anyActive = group.rows.some((row) => row.conversationId === activeId);

  if (isSingle) {
    const row = group.rows[0]!;
    const active = row.conversationId === activeId;
    return (
      <RailRow
        key={row.conversationId}
        name={row.title}
        sub={row.sub ?? undefined}
        meta={row.lastMessageAt ? timeAgo(row.lastMessageAt) : undefined}
        tone={railTone(row.tone)}
        avatarName={row.avatarName}
        avatarKind={isGroupConversationRow(row) ? "channel" : "user"}
        active={active}
        unread={row.unread}
        tabIndex={rovingTabIndex(active, hasAnyActive, row.conversationId === firstConversationId)}
        onClick={() => onSelect(row)}
      />
    );
  }

  return (
    <div>
      <RailRow
        name={group.label}
        meta={messagesGroupMeta(group)}
        tone={railTone(group.meta.tone)}
        caret={isOpen ? "open" : "closed"}
        active={anyActive && !isOpen}
        unread={group.meta.unreadCount > 0 && !isOpen}
        onClick={onToggle}
      />
      {isOpen &&
        group.rows.map((row) => {
          const active = row.conversationId === activeId;
          return (
            <RailRow
              key={row.conversationId}
              depth={1}
              name={row.name}
              sub={row.sub ?? undefined}
              meta={row.lastMessageAt ? timeAgo(row.lastMessageAt) : undefined}
              tone={railTone(row.tone)}
              avatarName={row.avatarName}
              avatarKind={isGroupConversationRow(row) ? "channel" : "user"}
              active={active}
              unread={row.unread}
              title={rowTooltip(row)}
              tabIndex={rovingTabIndex(active, hasAnyActive, row.conversationId === firstConversationId)}
              onClick={() => onSelect(row)}
            />
          );
        })}
    </div>
  );
}

function isGroupConversationRow(row: MessagesLeftRailRow): boolean {
  const conversation = row.refs.conversation;
  return Boolean(
    conversation
      && (
        conversation.kind === "channel"
        || conversation.kind === "group_direct"
        || conversation.id.startsWith("channel.")
      ),
  );
}

function railTone(
  tone: MessagesLeftRailRow["tone"] | MessagesLeftRailGroupMeta["tone"],
): "working" | "available" | "offline" | "channel" | "dm" | "neutral" {
  return tone === "unknown" ? "neutral" : tone;
}

function rowTooltip(row: MessagesLeftRailRow): string | undefined {
  const parts: string[] = [];
  if (row.refs.agent?.harness) parts.push(`harness: ${row.refs.agent.harness}`);
  if (row.refs.project?.root) parts.push(`project: ${row.refs.project.root}`);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function messagesGroupMeta(group: ListGroup<MessagesLeftRailRow, MessagesLeftRailGroupMeta>): string {
  const time = group.meta.latestAt ? timeAgo(group.meta.latestAt) : "";
  const count = group.meta.unreadCount > 0
    ? `${group.meta.unreadCount}/${group.meta.totalCount}`
    : `${group.meta.totalCount}`;
  return time ? `${count} · ${time}` : count;
}
