import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import "../../scout/slots/ctx-panel.css";
import { api } from "../../lib/api.ts";
import { friendlyApiError, isOfflineApiError } from "../../lib/api-errors.ts";
import { useListArrowNav, makeSearchHandoff, useSlashToFocus, rovingTabIndex } from "../../lib/keyboard-nav.ts";
import { normalizeAgentState, type AgentDisplayState } from "../../lib/agent-state.ts";
import {
  conversationDisplayTitle,
  conversationShortLabel,
  isChannelConversation,
  isObservedDirect,
  isOperatorDm,
} from "../../lib/conversations.ts";
import {
  isArchived,
  isPinned,
  loadConversationPrefs,
  pinRank,
  toggleArchive,
  togglePin,
  type ConversationPrefs,
} from "../../lib/conversation-prefs.ts";
import {
  buildConversationGroups,
  pathBasename,
  type ConversationGroup,
} from "../../lib/conversation-groups.ts";
import { useContextMenu, type MenuItem } from "../../components/ContextMenu.tsx";
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

/** How many observed groups show before "+N more" (keeps the rail scannable). */
const OBSERVED_PREVIEW_LIMIT = 12;

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

export function ChatLeft() {
  const { route, navigate, agents, apiConnection } = useScout();
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastViewed, setLastViewed] = useState<LastViewedMap>(() => loadLastViewedMap());
  const [prefs, setPrefs] = useState<ConversationPrefs>(() => loadConversationPrefs());
  const [query, setQuery] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [showAllObserved, setShowAllObserved] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
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
    route.view === "agents-v2" ? route.conversationId :
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

  // Reset observed expansion when filter/query changes so the section stays tight.
  useEffect(() => {
    setShowAllObserved(false);
  }, [activeRouteFilter, query]);

  const scoped = useMemo(() => {
    let list = filterSessionsByMachineScope(sessions, scopedAgentIds, machineId);
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((s) =>
        conversationDisplayTitle(s).toLowerCase().includes(q)
        || s.id.toLowerCase().includes(q)
        || (s.preview ?? "").toLowerCase().includes(q)
        || (s.agentName ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [sessions, scopedAgentIds, machineId, query]);

  const sections = useMemo(() => {
    const live = scoped.filter((s) => !isArchived(s.id, prefs));
    const archived = sortSessions(
      scoped.filter((s) => isArchived(s.id, prefs)),
      lastViewed,
      activeRouteSort,
    );

    // Pinned float above everything else (most recently pinned first).
    const pinned = live
      .filter((s) => isPinned(s.id, prefs))
      .sort((a, b) => pinRank(b.id, prefs) - pinRank(a.id, prefs) || (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));

    const unpinned = live.filter((s) => !isPinned(s.id, prefs));
    // Named #channels only — group_direct is a DM/observed room, not a channel.
    const channels = unpinned.filter(isChannelConversation);
    const dms = unpinned.filter(isOperatorDm);
    const observed = unpinned.filter(isObservedDirect);

    const sortList = (list: SessionEntry[]) => sortSessions(list, lastViewed, activeRouteSort);

    return {
      pinned,
      channels: sortList(channels),
      dms: buildConversationGroups(sortList(dms), agentById, lastViewed, activeRouteSort),
      observed: buildConversationGroups(sortList(observed), agentById, lastViewed, activeRouteSort),
      archived,
    };
  }, [scoped, agentById, lastViewed, activeRouteSort, prefs]);

  const visibleSections = useMemo(() => {
    if (activeRouteFilter === "channel") {
      return {
        pinned: sections.pinned.filter(isChannelConversation),
        channels: sections.channels,
        dms: [] as ConversationGroup[],
        observed: [] as ConversationGroup[],
        archived: sections.archived.filter(isChannelConversation),
      };
    }
    if (activeRouteFilter === "dm") {
      return {
        pinned: sections.pinned.filter((s) => !isChannelConversation(s)),
        channels: [] as SessionEntry[],
        dms: sections.dms,
        observed: [] as ConversationGroup[],
        archived: sections.archived.filter((s) => !isChannelConversation(s)),
      };
    }
    return sections;
  }, [activeRouteFilter, sections]);

  const showContextMenu = useContextMenu();

  const onTogglePin = useCallback((id: string) => {
    setPrefs((prev) => togglePin(id, prev));
  }, []);

  const onToggleArchive = useCallback((id: string) => {
    setPrefs((prev) => toggleArchive(id, prev));
  }, []);

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

  const onSelect = useCallback((s: SessionEntry) => {
    setLastViewed(saveLastViewed(s.id));
    // Named channels open the channel route; DMs + group DMs open messages.
    if (isChannelConversation(s)) {
      navigate({ view: "channels", channelId: s.id });
      return;
    }
    navigate({
      view: "messages",
      conversationId: s.id,
      ...(activeRouteFilter !== "all" ? { filter: activeRouteFilter } : {}),
      ...(activeRouteSort !== "recent" ? { sort: activeRouteSort } : {}),
    });
  }, [navigate, activeRouteFilter, activeRouteSort]);

  const openConversationMenu = useCallback(
    (event: MouseEvent, s: SessionEntry) => {
      const pinned = isPinned(s.id, prefs);
      const archived = isArchived(s.id, prefs);
      const title = conversationDisplayTitle(s);
      const items: MenuItem[] = [
        {
          kind: "action",
          label: "Open",
          onSelect: () => onSelect(s),
        },
        { kind: "separator" },
        {
          kind: "action",
          label: pinned ? "Unpin" : "Pin to top",
          onSelect: () => onTogglePin(s.id),
        },
        {
          kind: "action",
          label: archived ? "Unarchive" : "Archive",
          onSelect: () => onToggleArchive(s.id),
        },
        { kind: "separator" },
        {
          kind: "action",
          label: "Copy name",
          onSelect: () => {
            void navigator.clipboard?.writeText(title).catch(() => {});
          },
        },
      ];
      showContextMenu(event, items);
    },
    [prefs, onSelect, onTogglePin, onToggleArchive, showContextMenu],
  );

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const apiOffline =
    apiConnection.status === "offline" || isOfflineApiError(loadError);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const onListKeyDown = useListArrowNav();
  const onSearchKeyDown = makeSearchHandoff(() => listRef.current);
  useSlashToFocus(useCallback(() => inputRef.current, []));

  const pinnedCount = visibleSections.pinned.length;
  const channelCount = visibleSections.channels.length;
  const dmCount = visibleSections.dms.reduce((n, g) => n + g.conversations.length, 0);
  const observedCount = visibleSections.observed.reduce((n, g) => n + g.conversations.length, 0);
  const archivedCount = visibleSections.archived.length;
  const totalVisible = pinnedCount + channelCount + dmCount + observedCount + archivedCount;

  const flatConversations = useMemo(() => {
    const out: SessionEntry[] = [...visibleSections.pinned, ...visibleSections.channels];
    for (const g of visibleSections.dms) out.push(...g.conversations);
    for (const g of visibleSections.observed) out.push(...g.conversations);
    out.push(...visibleSections.archived);
    return out;
  }, [visibleSections]);
  const firstConversationId = flatConversations[0]?.id;
  const hasAnyActive = activeId != null && flatConversations.some((c) => c.id === activeId);

  const observedShown = showAllObserved || Boolean(query)
    ? visibleSections.observed
    : visibleSections.observed.slice(0, OBSERVED_PREVIEW_LIMIT);
  const observedHidden = Math.max(0, visibleSections.observed.length - observedShown.length);

  // Auto-open the group that holds the active conversation.
  const isGroupOpen = (group: ConversationGroup) => {
    if (query) return true;
    if (expandedGroups.has(group.key)) return true;
    if (activeId && group.conversations.some((c) => c.id === activeId)) return true;
    return false;
  };

  const rowActions = (s: SessionEntry) => (
    <ConversationActions
      pinned={isPinned(s.id, prefs)}
      archived={isArchived(s.id, prefs)}
      onTogglePin={() => onTogglePin(s.id)}
      onToggleArchive={() => onToggleArchive(s.id)}
    />
  );

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
          totalVisible === 0 && "ctx-panel-list--empty",
        ]
          .filter(Boolean)
          .join(" ")}
        onKeyDown={onListKeyDown}
      >
        {totalVisible === 0 ? (
          <ChatRailEmptyState
            query={query}
            loading={loading}
            error={loadError}
            apiOffline={apiOffline}
            filter={activeRouteFilter}
            onRetry={() => {
              setLoading(true);
              void load();
            }}
          />
        ) : (
          <>
            {pinnedCount > 0 && (
              <RailSection label="Pinned" count={pinnedCount} hint="Pinned channels and DMs">
                {visibleSections.pinned.map((s) => (
                  <SessionRailRow
                    key={`pin-${s.id}`}
                    session={s}
                    activeId={activeId}
                    lastViewed={lastViewed}
                    agentById={agentById}
                    asksByAgent={asksByAgent}
                    hasAnyActive={hasAnyActive}
                    firstConversationId={firstConversationId}
                    pinned
                    actions={rowActions(s)}
                    onSelect={onSelect}
                    onContextMenu={openConversationMenu}
                  />
                ))}
              </RailSection>
            )}

            {channelCount > 0 && (
              <RailSection label="Channels" count={channelCount}>
                {visibleSections.channels.map((s) => (
                  <SessionRailRow
                    key={s.id}
                    session={s}
                    activeId={activeId}
                    lastViewed={lastViewed}
                    agentById={agentById}
                    asksByAgent={asksByAgent}
                    hasAnyActive={hasAnyActive}
                    firstConversationId={firstConversationId}
                    actions={rowActions(s)}
                    onSelect={onSelect}
                    onContextMenu={openConversationMenu}
                  />
                ))}
              </RailSection>
            )}

            {dmCount > 0 && (
              <RailSection label="DMs" count={dmCount}>
                {visibleSections.dms.map((group) => (
                  <GroupOrRow
                    key={group.key}
                    group={group}
                    isOpen={isGroupOpen(group)}
                    activeId={activeId}
                    lastViewed={lastViewed}
                    agentById={agentById}
                    asksByAgent={asksByAgent}
                    hasAnyActive={hasAnyActive}
                    firstConversationId={firstConversationId}
                    prefs={prefs}
                    onToggle={() => toggleGroup(group.key)}
                    onSelect={onSelect}
                    onTogglePin={onTogglePin}
                    onToggleArchive={onToggleArchive}
                    onContextMenu={openConversationMenu}
                  />
                ))}
              </RailSection>
            )}

            {observedCount > 0 && (
              <RailSection
                label="Observed"
                count={observedCount}
                hint="Agent conversations you’re not in"
              >
                {observedShown.map((group) => (
                  <GroupOrRow
                    key={group.key}
                    group={group}
                    isOpen={isGroupOpen(group)}
                    activeId={activeId}
                    lastViewed={lastViewed}
                    agentById={agentById}
                    asksByAgent={asksByAgent}
                    hasAnyActive={hasAnyActive}
                    firstConversationId={firstConversationId}
                    prefs={prefs}
                    onToggle={() => toggleGroup(group.key)}
                    onSelect={onSelect}
                    onTogglePin={onTogglePin}
                    onToggleArchive={onToggleArchive}
                    onContextMenu={openConversationMenu}
                  />
                ))}
                {observedHidden > 0 ? (
                  <button
                    type="button"
                    className="ctx-panel-more"
                    onClick={() => setShowAllObserved(true)}
                  >
                    ＋ {observedHidden} more observed
                  </button>
                ) : null}
              </RailSection>
            )}

            {archivedCount > 0 && (
              <RailSection label="Archived" count={archivedCount} hint="Hidden from the main rail">
                <button
                  type="button"
                  className="ctx-panel-more"
                  onClick={() => setShowArchived((v) => !v)}
                >
                  {showArchived ? "▾ hide archived" : `› show ${archivedCount} archived`}
                </button>
                {showArchived
                  ? visibleSections.archived.map((s) => (
                      <SessionRailRow
                        key={`arch-${s.id}`}
                        session={s}
                        activeId={activeId}
                        lastViewed={lastViewed}
                        agentById={agentById}
                        asksByAgent={asksByAgent}
                        hasAnyActive={hasAnyActive}
                        firstConversationId={firstConversationId}
                        actions={rowActions(s)}
                        onSelect={onSelect}
                        onContextMenu={openConversationMenu}
                      />
                    ))
                  : null}
              </RailSection>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function RailSection({
  label,
  count,
  hint,
  children,
}: {
  label: string;
  count: number;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="ctx-panel-rail-section" aria-label={label}>
      <div className="ctx-panel-section-label" title={hint}>
        <span>{label}</span>
        <span className="ctx-panel-count">{count}</span>
      </div>
      <div className="ctx-panel-rail-section-body">{children}</div>
    </section>
  );
}

function ConversationActions({
  pinned,
  archived,
  onTogglePin,
  onToggleArchive,
}: {
  pinned: boolean;
  archived: boolean;
  onTogglePin: () => void;
  onToggleArchive: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className={["rr-row-action", pinned && "rr-row-action--on"].filter(Boolean).join(" ")}
        title={pinned ? "Unpin" : "Pin to top"}
        aria-label={pinned ? "Unpin" : "Pin"}
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin();
        }}
      >
        {pinned ? "Unpin" : "Pin"}
      </button>
      <button
        type="button"
        className={["rr-row-action", archived && "rr-row-action--on"].filter(Boolean).join(" ")}
        title={archived ? "Unarchive" : "Archive"}
        aria-label={archived ? "Unarchive" : "Archive"}
        onClick={(e) => {
          e.stopPropagation();
          onToggleArchive();
        }}
      >
        {archived ? "Restore" : "Archive"}
      </button>
    </>
  );
}

function SessionRailRow({
  session: s,
  activeId,
  lastViewed,
  agentById,
  asksByAgent,
  hasAnyActive,
  firstConversationId,
  pinned,
  depth,
  actions,
  worktreeLabel,
  onSelect,
  onContextMenu,
}: {
  session: SessionEntry;
  activeId: string | undefined;
  lastViewed: LastViewedMap;
  agentById: Map<string, Agent>;
  asksByAgent: Map<string, FleetAsk>;
  hasAnyActive: boolean;
  firstConversationId: string | undefined;
  pinned?: boolean;
  depth?: 0 | 1;
  actions?: ReactNode;
  /** Side-checkout name shown as a worktree glyph (merged repo groups). */
  worktreeLabel?: string | null;
  onSelect: (s: SessionEntry) => void;
  onContextMenu?: (event: MouseEvent, s: SessionEntry) => void;
}) {
  const active = s.id === activeId;
  const unread = isUnread(s.lastMessageAt, s.id, lastViewed);
  const title = conversationDisplayTitle(s);
  const channel = isChannelConversation(s);
  const agent = s.agentId ? agentById.get(s.agentId) : undefined;
  const ask = s.agentId ? asksByAgent.get(s.agentId) : undefined;
  const identifier = threadIdentifier(s, agent);
  const baseSub = channel
    ? `${s.participantIds.length} members`
    : identifier.toLowerCase() === title.toLowerCase()
      ? undefined
      : identifier;
  const sub = !channel && ask ? activeAskSubtitle(s, agent, ask) : baseSub;

  return (
    <RailRow
      depth={depth}
      name={depth === 1 ? conversationChildLabel(s, agent, ask) : title}
      sub={depth === 1 ? threadIdentifier(s, agent) : sub}
      meta={ask ? timeAgo(ask.updatedAt) : s.lastMessageAt ? timeAgo(s.lastMessageAt) : undefined}
      tone={
        channel
          ? "channel"
          : ask
            ? askRowTone(agent, ask)
            : agent
              ? normalizeAgentState(agent.state)
              : "dm"
      }
      avatarName={depth === 1 ? (agent?.name ?? conversationChildLabel(s, agent, ask)) : title}
      avatarKind={channel ? "channel" : "user"}
      active={active}
      unread={unread}
      pinned={pinned}
      activityLabel={ask ? askActivityLabel(ask) : undefined}
      activityTone={ask ? askActivityTone(ask) : undefined}
      worktreeLabel={worktreeLabel ?? undefined}
      title={depth === 1 ? conversationChildTooltip(s, agent, ask) : undefined}
      actions={actions}
      tabIndex={rovingTabIndex(active, hasAnyActive, s.id === firstConversationId)}
      onClick={() => onSelect(s)}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, s) : undefined}
    />
  );
}

function GroupOrRow({
  group,
  isOpen,
  activeId,
  lastViewed,
  agentById,
  asksByAgent,
  hasAnyActive,
  firstConversationId,
  prefs,
  onToggle,
  onSelect,
  onTogglePin,
  onToggleArchive,
  onContextMenu,
}: {
  group: ConversationGroup;
  isOpen: boolean;
  activeId: string | undefined;
  lastViewed: LastViewedMap;
  agentById: Map<string, Agent>;
  asksByAgent: Map<string, FleetAsk>;
  hasAnyActive: boolean;
  firstConversationId: string | undefined;
  prefs: ConversationPrefs;
  onToggle: () => void;
  onSelect: (s: SessionEntry) => void;
  onTogglePin: (id: string) => void;
  onToggleArchive: (id: string) => void;
  onContextMenu: (event: MouseEvent, s: SessionEntry) => void;
}) {
  if (group.conversations.length === 1) {
    const s = group.conversations[0]!;
    return (
      <SessionRailRow
        session={s}
        activeId={activeId}
        lastViewed={lastViewed}
        agentById={agentById}
        asksByAgent={asksByAgent}
        hasAnyActive={hasAnyActive}
        firstConversationId={firstConversationId}
        pinned={isPinned(s.id, prefs)}
        actions={
          <ConversationActions
            pinned={isPinned(s.id, prefs)}
            archived={isArchived(s.id, prefs)}
            onTogglePin={() => onTogglePin(s.id)}
            onToggleArchive={() => onToggleArchive(s.id)}
          />
        }
        onSelect={onSelect}
        onContextMenu={onContextMenu}
      />
    );
  }

  const groupAsks = group.conversations
    .map((candidate) => candidate.agentId ? asksByAgent.get(candidate.agentId) : undefined)
    .filter((ask): ask is FleetAsk => Boolean(ask));
  const activeAskCount = groupAsks.length;
  const workingAskCount = groupAsks.filter((ask) => ask.status === "working").length;
  const attentionAskCount = groupAsks.filter((ask) => ask.status === "needs_attention").length;
  const anyActive = group.conversations.some((c) => c.id === activeId);

  return (
    <div key={group.key}>
      <RailRow
        name={group.label}
        meta={activeAskCount > 0
          ? `${activeAskCount} active · ${messagesGroupMeta(group)}`
          : messagesGroupMeta(group)}
        tone={workingAskCount > 0 ? "in_turn" : group.bestState}
        caret={isOpen ? "open" : "closed"}
        active={anyActive && !isOpen}
        unread={group.unreadCount > 0 && !isOpen}
        activityLabel={activeAskCount > 0 ? `${activeAskCount} active` : undefined}
        activityTone={attentionAskCount > 0 ? "attention" : workingAskCount > 0 ? "working" : "pending"}
        onClick={onToggle}
      />
      {isOpen &&
        group.conversations.map((s) => {
          const childAgent = s.agentId ? agentById.get(s.agentId) : undefined;
          const worktreeLabel =
            group.canonicalRoot
            && childAgent?.projectRoot
            && childAgent.projectRoot !== group.canonicalRoot
              ? pathBasename(childAgent.projectRoot)
              : null;
          return (
          <SessionRailRow
            key={s.id}
            session={s}
            depth={1}
            activeId={activeId}
            lastViewed={lastViewed}
            agentById={agentById}
            asksByAgent={asksByAgent}
            hasAnyActive={hasAnyActive}
            firstConversationId={firstConversationId}
            pinned={isPinned(s.id, prefs)}
            worktreeLabel={worktreeLabel}
            actions={
              <ConversationActions
                pinned={isPinned(s.id, prefs)}
                archived={isArchived(s.id, prefs)}
                onTogglePin={() => onTogglePin(s.id)}
                onToggleArchive={() => onToggleArchive(s.id)}
              />
            }
            onSelect={onSelect}
            onContextMenu={onContextMenu}
          />
          );
        })}
    </div>
  );
}

function ChatRailEmptyState({
  query,
  loading,
  error,
  apiOffline,
  filter,
  onRetry,
}: {
  query: string;
  loading: boolean;
  error: string | null;
  apiOffline: boolean;
  filter: MessagesFilter;
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
          : filter === "channel"
            ? "No channels yet"
            : filter === "dm"
              ? "No DMs yet"
              : "No chats yet";
  const detail = loading
    ? "Checking the broker for channels, your DMs, and observed threads."
    : apiOffline
      ? "Start or restart Scout services, then retry."
      : error
        ? error
        : hasQuery
          ? "Try a broader filter or switch chat types."
          : filter === "channel"
            ? "Shared channels land here once created."
            : filter === "dm"
              ? "Start a DM with an agent to see it here."
              : "Channels, your DMs, and observed agent threads will show here.";

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

function sortSessions(
  list: SessionEntry[],
  lastViewed: LastViewedMap,
  sort: MessagesSort,
): SessionEntry[] {
  const sorted = [...list];
  switch (sort) {
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
  if (isChannelConversation(s)) {
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
