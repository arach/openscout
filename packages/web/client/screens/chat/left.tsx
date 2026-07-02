import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../../scout/slots/ctx-panel.css";
import { api } from "../../lib/api.ts";
import { friendlyApiError, isOfflineApiError } from "../../lib/api-errors.ts";
import { useListArrowNav, makeSearchHandoff, useSlashToFocus, rovingTabIndex } from "../../lib/keyboard-nav.ts";
import { normalizeAgentState, type AgentDisplayState } from "../../lib/agent-state.ts";
import {
  conversationDisplayTitle,
  conversationShortLabel,
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
import { useFleetActiveAsks } from "../../lib/use-fleet-active-asks.ts";
import { useScout } from "../../scout/Provider.tsx";
import {
  filterSessionsByMachineScope,
  machineScopedAgentIds,
} from "../../lib/machine-scope.ts";
import { routeMachineId } from "../../lib/router.ts";
import { RailRow } from "../../scout/slots/RailRow.tsx";
import type { Agent, FleetAsk, MessagesFilter, MessagesSort, SessionEntry } from "../../lib/types.ts";

const STATE_RANK: Record<string, number> = { in_turn: 0, in_flight: 1, callable: 2, blocked: 3 };

type ConversationGroup = {
  key: string;
  label: string;
  kind: "channel" | "project" | "agent";
  isChannel: boolean;
  conversations: SessionEntry[];
  bestState: AgentDisplayState;
  latestUpdate: number;
  unreadCount: number;
};

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

export function ChatLeft() {
  const { route, navigate, agents, apiConnection } = useScout();
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastViewed, setLastViewed] = useState<LastViewedMap>(() => loadLastViewedMap());
  const [query, setQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const asksByAgent = useFleetActiveAsks();
  const loadedRef = useRef(false);
  const machineId = routeMachineId(route);
  const scopedAgentIds = useMemo(
    () => machineScopedAgentIds(agents, machineId),
    [agents, machineId],
  );

  const agentById = useMemo(() => {
    const map = new Map<string, Agent>();
    const scopedAgents = scopedAgentIds
      ? agents.filter((agent) => scopedAgentIds.has(agent.id))
      : agents;
    for (const agent of scopedAgents) {
      map.set(agent.id, agent);
    }
    return map;
  }, [agents, scopedAgentIds]);

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
    if (!loadedRef.current) setLoading(true);
    try {
      const data = await api<SessionEntry[]>("/api/conversations");
      setSessions(data);
      setLoadError(null);
    } catch (cause) {
      setLoadError(friendlyApiError(cause));
    } finally {
      loadedRef.current = true;
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useBrokerEvents((event) => {
    if (event.kind === "message.posted" || event.kind === "conversation.upserted") {
      void load();
    }
  });

  const filtered = useMemo(() => {
    let list = filterSessionsByMachineScope(sessions, scopedAgentIds, machineId);
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
  }, [sessions, scopedAgentIds, activeRouteFilter, activeRouteSort, query, lastViewed]);

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
    if (isGroupConversation(s) && route.view === "channels") {
      navigate({ view: "channels", channelId: s.id });
      return;
    }
    navigate({
      view: "messages",
      conversationId: s.id,
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

  const groups = useMemo(
    () => buildConversationGroups(filtered, agentById, lastViewed, activeRouteSort),
    [filtered, agentById, lastViewed, activeRouteSort],
  );
  const apiOffline =
    apiConnection.status === "offline" || isOfflineApiError(loadError);

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
        className={[
          "ctx-panel-list",
          "ctx-panel-list--scroll",
          groups.length === 0 && "ctx-panel-list--empty",
        ]
          .filter(Boolean)
          .join(" ")}
        onKeyDown={onListKeyDown}
      >
        {groups.length === 0 ? (
          <ChatRailEmptyState
            query={query}
            loading={loading}
            error={loadError}
            apiOffline={apiOffline}
            onRetry={() => {
              setLoading(true);
              void load();
            }}
          />
        ) : (() => {
          const flatConversations = groups.flatMap((g) => g.conversations);
          const firstConversationId = flatConversations[0]?.id;
          const hasAnyActive = activeId != null && flatConversations.some((c) => c.id === activeId);
          return groups.map((group) => {
            const isSingle = group.conversations.length === 1;
            const isOpen = Boolean(query) || expandedGroups.has(group.key);
            const anyActive = group.conversations.some((c) => c.id === activeId);

            if (isSingle) {
              const s = group.conversations[0]!;
              const active = s.id === activeId;
              const unread = isUnread(s.lastMessageAt, s.id, lastViewed);
              const title = conversationDisplayTitle(s);
              const channel = isGroupConversation(s);
              const agent = s.agentId ? agentById.get(s.agentId) : undefined;
              const ask = s.agentId ? asksByAgent.get(s.agentId) : undefined;
              const identifier = threadIdentifier(s, agent);
              const baseSub = conversationRailSub(s, group, agent, identifier, title);
              const sub = ask
                ? activeAskSubtitle(s, agent, ask)
                : baseSub;
              return (
                <RailRow
                  key={group.key}
                  name={title}
                  sub={sub}
                  meta={ask ? timeAgo(ask.updatedAt) : s.lastMessageAt ? timeAgo(s.lastMessageAt) : undefined}
                  tone={ask ? askRowTone(agent, ask) : channel ? "channel" : agent ? normalizeAgentState(agent.state) : "dm"}
                  avatarName={title}
                  active={active}
                  unread={unread}
                  activityLabel={ask ? askActivityLabel(ask) : undefined}
                  activityTone={ask ? askActivityTone(ask) : undefined}
                  tabIndex={rovingTabIndex(active, hasAnyActive, s.id === firstConversationId)}
                  onClick={() => onSelect(s)}
                />
              );
            }

            const groupAsks = group.conversations
              .map((candidate) => candidate.agentId ? asksByAgent.get(candidate.agentId) : undefined)
              .filter((ask): ask is FleetAsk => Boolean(ask));
            const activeAskCount = groupAsks.length;
            const workingAskCount = groupAsks.filter((ask) => ask.status === "working").length;
            const attentionAskCount = groupAsks.filter((ask) => ask.status === "needs_attention").length;

            return (
              <div key={group.key}>
                <RailRow
                  name={group.label}
                  sub={conversationGroupSub(group)}
                  meta={activeAskCount > 0
                    ? `${activeAskCount} active · ${messagesGroupMeta(group)}`
                    : messagesGroupMeta(group)}
                  tone={workingAskCount > 0 ? "in_turn" : group.bestState}
                  caret={isOpen ? "open" : "closed"}
                  active={anyActive && !isOpen}
                  unread={group.unreadCount > 0 && !isOpen}
                  activityLabel={activeAskCount > 0 ? `${activeAskCount} active` : undefined}
                  activityTone={attentionAskCount > 0 ? "attention" : workingAskCount > 0 ? "working" : "pending"}
                  onClick={() => toggleGroup(group.key)}
                />
                {isOpen &&
                  group.conversations.map((s) => {
                    const active = s.id === activeId;
                    const unread = isUnread(s.lastMessageAt, s.id, lastViewed);
                    const agent = s.agentId ? agentById.get(s.agentId) : undefined;
                    const ask = s.agentId ? asksByAgent.get(s.agentId) : undefined;
                    return (
                      <RailRow
                        key={s.id}
                        depth={1}
                        name={conversationChildLabel(s, agent, ask)}
                        sub={threadIdentifier(s, agent)}
                        meta={ask ? timeAgo(ask.updatedAt) : s.lastMessageAt ? timeAgo(s.lastMessageAt) : undefined}
                        tone={ask ? askRowTone(agent, ask) : agent ? normalizeAgentState(agent.state) : "dm"}
                        avatarName={agent?.name ?? conversationChildLabel(s, agent, ask)}
                        active={active}
                        unread={unread}
                        activityLabel={ask ? askActivityLabel(ask) : undefined}
                        activityTone={ask ? askActivityTone(ask) : undefined}
                        title={conversationChildTooltip(s, agent, ask)}
                        tabIndex={rovingTabIndex(active, hasAnyActive, s.id === firstConversationId)}
                        onClick={() => onSelect(s)}
                      />
                    );
                  })}
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
}

function ChatRailEmptyState({
  query,
  loading,
  error,
  apiOffline,
  onRetry,
}: {
  query: string;
  loading: boolean;
  error: string | null;
  apiOffline: boolean;
  onRetry: () => void;
}) {
  const hasQuery = query.trim().length > 0;
  const title = loading
    ? "Loading chats"
    : apiOffline
      ? "Scout server offline"
      : error
        ? "Couldn't load chats"
        : hasQuery
          ? "No matching chats"
          : "No chats yet";
  const detail = loading
    ? "Checking the broker for direct messages and shared channels."
    : apiOffline
      ? "Start or restart Scout services, then retry."
      : error
        ? error
        : hasQuery
          ? "Try a broader filter or switch chat types."
          : "Start a DM or shared channel to see it here.";

  return (
    <div className="ctx-panel-empty-card" data-tone={apiOffline || error ? "error" : "neutral"}>
      <div className="ctx-panel-empty-card-title">{title}</div>
      <div className="ctx-panel-empty-card-detail">{detail}</div>
      {(apiOffline || error) && (
        <button
          type="button"
          className="ctx-panel-empty-card-action"
          onClick={onRetry}
        >
          Retry
        </button>
      )}
    </div>
  );
}

function askActivityLabel(ask: FleetAsk): string {
  if (ask.status === "queued") return "Starting";
  if (ask.status === "working") return "Working";
  if (ask.status === "needs_attention") return "Needs you";
  return ask.statusLabel || ask.status;
}

function askActivityTone(ask: FleetAsk): "pending" | "working" | "attention" {
  if (ask.status === "queued") return "pending";
  if (ask.status === "needs_attention") return "attention";
  return "working";
}

function askRowTone(
  agent: Agent | undefined,
  ask: FleetAsk,
): AgentDisplayState | "dm" {
  if (ask.status === "working") return "in_turn";
  return agent ? normalizeAgentState(agent.state) : "dm";
}

function activeAskSubtitle(
  s: SessionEntry,
  agent: Agent | undefined,
  ask: FleetAsk,
): string {
  const status = askActivityLabel(ask);
  const task = trimPreview(ask.task)
    ?? trimPreview(ask.summary)
    ?? trimPreview(s.preview)
    ?? s.currentBranch
    ?? agent?.branch
    ?? "";
  return task ? `${status} · ${task}` : status;
}

function buildConversationGroups(
  sessions: SessionEntry[],
  agentById: Map<string, Agent>,
  lastViewed: LastViewedMap,
  sort: MessagesSort,
): ConversationGroup[] {
  const buckets = new Map<string, ConversationGroup>();

  for (const s of sessions) {
    const channel = isGroupConversation(s);
    let key: string;
    let label: string;
    if (channel) {
      key = `channel:${s.id}`;
      label = conversationDisplayTitle(s);
    } else {
      const agent = s.agentId ? agentById.get(s.agentId) : undefined;
      const project = agent?.project ?? null;
      if (project) {
        key = `project:${project.toLowerCase()}`;
        label = project;
      } else {
        // Fall back to grouping by agent name / display title so DMs that share
        // an agent collapse even when project metadata is missing.
        const groupName = (s.agentName ?? conversationDisplayTitle(s)).trim();
        if (groupName) {
          key = `name:${groupName.toLowerCase()}`;
          label = groupName;
        } else {
          key = `dm:${s.id}`;
          label = conversationDisplayTitle(s);
        }
      }
    }

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        key,
        label,
        kind: channel ? "channel" : key.startsWith("project:") ? "project" : "agent",
        isChannel: channel,
        conversations: [],
        bestState: "blocked",
        latestUpdate: 0,
        unreadCount: 0,
      };
      buckets.set(key, bucket);
    }
    bucket.conversations.push(s);
    bucket.latestUpdate = Math.max(bucket.latestUpdate, s.lastMessageAt ?? 0);
    if (isUnread(s.lastMessageAt, s.id, lastViewed)) {
      bucket.unreadCount += 1;
    }
    if (!channel) {
      const agent = s.agentId ? agentById.get(s.agentId) : undefined;
      if (agent) {
        const state = normalizeAgentState(agent.state);
        if ((STATE_RANK[state] ?? 9) < (STATE_RANK[bucket.bestState] ?? 9)) {
          bucket.bestState = state;
        }
      }
    }
  }

  for (const b of buckets.values()) {
    b.conversations.sort((a, c) => (c.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
  }

  const list = Array.from(buckets.values());
  switch (sort) {
    case "name":
      list.sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
      break;
    case "unread":
      list.sort((a, b) => {
        if ((a.unreadCount > 0) !== (b.unreadCount > 0)) return a.unreadCount > 0 ? -1 : 1;
        return b.latestUpdate - a.latestUpdate;
      });
      break;
    case "recent":
    default:
      list.sort((a, b) => b.latestUpdate - a.latestUpdate);
      break;
  }
  return list;
}

function conversationGroupSub(group: ConversationGroup): string {
  switch (group.kind) {
    case "channel":
      return "Shared channel";
    case "project":
      return "Project chats";
    case "agent":
    default:
      return "Agent chats";
  }
}

function conversationRailSub(
  s: SessionEntry,
  group: ConversationGroup,
  agent: Agent | undefined,
  identifier: string,
  title: string,
): string | undefined {
  if (group.kind === "channel") return "Shared channel";
  const handle = identifier.toLowerCase() === title.toLowerCase() ? null : identifier;
  const project = agent?.project || s.workspaceRoot?.split("/").filter(Boolean).at(-1);
  if (group.kind === "project") {
    return handle ? `Project · ${handle}` : "Project chat";
  }
  if (project && handle) return `Agent · ${project} · ${handle}`;
  if (handle) return `Agent · ${handle}`;
  return "Agent chat";
}

function conversationChildLabel(
  s: SessionEntry,
  agent: Agent | undefined,
  ask: FleetAsk | undefined,
): string {
  const subject = ask?.task ?? trimPreview(s.preview) ?? s.currentBranch ?? agent?.branch ?? "";
  const name = agent?.name ?? s.agentName ?? conversationDisplayTitle(s);
  return subject ? `${name} · ${subject}` : name;
}

function conversationChildTooltip(
  s: SessionEntry,
  agent: Agent | undefined,
  ask: FleetAsk | undefined,
): string | undefined {
  const parts: string[] = [];
  if (ask) parts.push(`task: ${ask.task}`);
  if (s.preview) parts.push(`preview: ${s.preview}`);
  if (s.currentBranch ?? agent?.branch) parts.push(`branch: ${s.currentBranch ?? agent?.branch}`);
  if (agent?.harness) parts.push(`harness: ${agent.harness}`);
  return parts.length > 0 ? parts.join("\n") : undefined;
}

function threadIdentifier(s: SessionEntry, agent: Agent | undefined): string {
  if (isGroupConversation(s)) {
    return conversationShortLabel(s);
  }
  const handle = agent?.handle?.trim().replace(/^@+/, "");
  if (handle) return handle;
  if (s.agentId) return s.agentId.split(".")[0] ?? s.agentId;
  return conversationDisplayTitle(s);
}

function trimPreview(preview: string | null): string | null {
  if (!preview) return null;
  const collapsed = preview.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  return collapsed.length > 60 ? `${collapsed.slice(0, 57)}…` : collapsed;
}

function messagesGroupMeta(group: ConversationGroup): string {
  const time = group.latestUpdate ? timeAgo(group.latestUpdate) : "";
  const count = group.unreadCount > 0
    ? `${group.unreadCount}/${group.conversations.length}`
    : `${group.conversations.length}`;
  return time ? `${count} · ${time}` : count;
}
