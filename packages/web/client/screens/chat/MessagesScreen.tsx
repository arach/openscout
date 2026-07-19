import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";

import { api } from "../../lib/api.ts";
import {
  conversationDisplayTitle,
  isGroupConversation,
} from "../../lib/conversations.ts";
import {
  filterSessionsByMachineScope,
  machineScopedAgentIds,
} from "../../lib/machine-scope.ts";
import { routeMachineId } from "../../lib/router.ts";
import {
  isUnread,
  loadLastViewedMap,
  saveLastViewed,
  type LastViewedMap,
} from "../../lib/sessionRead.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { timeAgo } from "../../lib/time.ts";
import type { Route, SessionEntry } from "../../lib/types.ts";
import { useScout } from "../../scout/Provider.tsx";
import { ChatSubnav } from "./ChatSubnav.tsx";
import { ConversationScreen } from "./ConversationScreen.tsx";
import "./conversation-screen.css";

const RECENT_LIMIT = 6;

export function MessagesScreen({
  conversationId,
  navigate,
}: {
  conversationId?: string;
  navigate: (route: Route) => void;
}) {
  const { route } = useScout();
  const content = !conversationId ? (
    <MessagesEmptyState navigate={navigate} />
  ) : (
    <ConversationScreen
      conversationId={conversationId}
      navigate={navigate}
      showBackNav={false}
    />
  );

  return (
    <div className="s-secondary-nav-shell">
      <div className="s-secondary-nav-bar">
        <ChatSubnav activeRoute={route} navigate={navigate} />
      </div>
      <div className="s-secondary-nav-body">{content}</div>
    </div>
  );
}

function MessagesEmptyState({
  navigate,
}: {
  navigate: (route: Route) => void;
}) {
  const { onlineCount, apiConnection, reload, route, agents, openContextCapture } = useScout();
  const [conversations, setConversations] = useState<SessionEntry[]>([]);
  const [lastViewed, setLastViewed] = useState<LastViewedMap>(() => loadLastViewedMap());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const apiOffline = apiConnection.status === "offline";
  const machineId = routeMachineId(route);
  const scopedAgentIds = useMemo(
    () => machineScopedAgentIds(agents, machineId),
    [agents, machineId],
  );

  const load = useCallback(async () => {
    try {
      const data = await api<SessionEntry[]>("/api/conversations");
      setConversations(data);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useBrokerEvents((event) => {
    if (
      event.kind === "message.posted"
      || event.kind === "conversation.upserted"
      || event.kind === "agent.endpoint.upserted"
    ) {
      void load();
    }
  });

  const scopedConversations = useMemo(() => {
    return [...filterSessionsByMachineScope(conversations, scopedAgentIds, machineId)]
      .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
  }, [conversations, scopedAgentIds, machineId]);

  const { unreadConversations, recentConversations } = useMemo(() => {
    const unread = scopedConversations.filter((s) =>
      isUnread(s.lastMessageAt, s.id, lastViewed),
    );
    const unreadIds = new Set(unread.map((s) => s.id));
    const recent = scopedConversations
      .filter((s) => !unreadIds.has(s.id))
      .slice(0, RECENT_LIMIT);
    return { unreadConversations: unread, recentConversations: recent };
  }, [scopedConversations, lastViewed]);

  const openConversation = (conversation: SessionEntry) => {
    setLastViewed(saveLastViewed(conversation.id));
    if (isGroupConversation(conversation)) {
      navigate({ view: "channels", channelId: conversation.id });
      return;
    }
    navigate({
      view: "messages",
      conversationId: conversation.id,
      ...(route.view === "messages" && route.filter ? { filter: route.filter } : {}),
      ...(route.view === "messages" && route.sort ? { sort: route.sort } : {}),
    });
  };

  const focusRailFilter = () => {
    const input = document.querySelector<HTMLInputElement>(".ctx-panel-search-input");
    if (!input) return;
    input.focus();
    input.select();
  };

  if (!apiOffline && !error && scopedConversations.length > 0) {
    return (
      <div className="s-conv-board">
        <div className="s-conv-board-shortcuts">
          <button
            type="button"
            className="s-conv-board-shortcut"
            onClick={() => openContextCapture()}
          >
            ＋ new chat
          </button>
          <button
            type="button"
            className="s-conv-board-shortcut"
            onClick={focusRailFilter}
          >
            ⌕ search conversations
          </button>
          <button
            type="button"
            className="s-conv-board-shortcut"
            onClick={() => navigate({ view: "channels" })}
          >
            ＃ browse channels
          </button>
        </div>

        {unreadConversations.length > 0 && (
          <section className="s-conv-board-section" aria-label="Unread">
            <div className="s-conv-board-section-head">
              <span>Unread</span>
              <span className="s-conv-board-count">{unreadConversations.length}</span>
            </div>
            {unreadConversations.map((conversation) => (
              <EditorialRow
                key={conversation.id}
                conversation={conversation}
                unread
                onOpen={() => openConversation(conversation)}
              />
            ))}
          </section>
        )}

        <section className="s-conv-board-section" aria-label="Recent">
          <div className="s-conv-board-section-head">
            <span>Recent</span>
            <span className="s-conv-board-count">{recentConversations.length}</span>
          </div>
          {recentConversations.map((conversation) => (
            <EditorialRow
              key={conversation.id}
              conversation={conversation}
              onOpen={() => openConversation(conversation)}
            />
          ))}
        </section>

        <p className="s-conv-board-note">
          the rail owns the full list — filters and grouping live there
        </p>
      </div>
    );
  }

  return (
    <div className={`s-conv-empty${apiOffline ? " s-conv-empty--offline" : ""}`}>
      <div className="s-conv-empty-inner">
        <EmptyMesh />
        <div className="s-conv-empty-eyebrow">
          {apiOffline ? "Connection" : "Conversations"}
        </div>
        <p className="s-conv-empty-title">
          {apiOffline
            ? "Scout server offline"
            : loading
              ? "Loading chats"
              : error
                ? "Chats unavailable"
                : "Nothing open yet"}
        </p>
        <p className="s-conv-empty-detail">
          {apiOffline
            ? "Start or restart Scout services. Chats and context will appear when the server responds."
            : loading
              ? "Fetching your recent conversations."
              : error
                ? error
                : "Start a chat by choosing an agent and sending the first message."}
        </p>

        {apiOffline || error ? (
          <button
            type="button"
            className="s-conv-empty-action"
            onClick={() => {
              if (apiOffline) void reload();
              else {
                setLoading(true);
                void load();
              }
            }}
          >
            Retry connection
          </button>
        ) : (
          <button
            type="button"
            className="s-conv-empty-new"
            onClick={() => openContextCapture()}
          >
            <Plus size={16} aria-hidden="true" />
            New chat
          </button>
        )}

        <div className="s-conv-empty-ambient">
          <span className="s-conv-empty-ambient-dot" aria-hidden="true" />
          {apiOffline
            ? "waiting for server"
            : `${onlineCount} ${onlineCount === 1 ? "agent" : "agents"} active`}
        </div>
      </div>
    </div>
  );
}

function EditorialRow({
  conversation,
  unread,
  onOpen,
}: {
  conversation: SessionEntry;
  unread?: boolean;
  onOpen: () => void;
}) {
  const title = conversationDisplayTitle(conversation);
  const preview = conversation.preview?.trim() || "";
  const ago = conversation.lastMessageAt ? timeAgo(conversation.lastMessageAt) : "";

  return (
    <button type="button" className="s-conv-board-row" onClick={onOpen}>
      <span className="s-conv-board-row-main">
        <span className="s-conv-board-row-title">{title}</span>
        {preview ? <span className="s-conv-board-preview">{preview}</span> : null}
      </span>
      <span className="s-conv-board-meta">
        {unread ? <em className="s-conv-board-new">new</em> : null}
        {ago ? <time>{ago}</time> : null}
        {!unread ? <span className="s-conv-board-arrow" aria-hidden="true">↗</span> : null}
      </span>
    </button>
  );
}

/** Quiet constellation echo of the brand mesh motif — six nodes, thin links,
 *  one node lit in the single accent. Decorative only. */
function EmptyMesh() {
  return (
    <svg
      className="s-conv-empty-mesh"
      viewBox="0 0 72 72"
      fill="none"
      aria-hidden="true"
    >
      <line className="s-conv-empty-mesh-link" x1="14" y1="20" x2="36" y2="12" />
      <line className="s-conv-empty-mesh-link" x1="36" y1="12" x2="58" y2="24" />
      <line className="s-conv-empty-mesh-link" x1="14" y1="20" x2="24" y2="46" />
      <line className="s-conv-empty-mesh-link" x1="24" y1="46" x2="36" y2="12" />
      <line className="s-conv-empty-mesh-link" x1="24" y1="46" x2="50" y2="54" />
      <line className="s-conv-empty-mesh-link" x1="50" y1="54" x2="58" y2="24" />
      <line className="s-conv-empty-mesh-link" x1="36" y1="12" x2="50" y2="54" />
      <circle className="s-conv-empty-mesh-node" cx="14" cy="20" r="2.5" />
      <circle className="s-conv-empty-mesh-node" cx="58" cy="24" r="2.5" />
      <circle className="s-conv-empty-mesh-node" cx="24" cy="46" r="2.5" />
      <circle className="s-conv-empty-mesh-node" cx="50" cy="54" r="2.5" />
      <circle
        className="s-conv-empty-mesh-node s-conv-empty-mesh-node--accent"
        cx="36"
        cy="12"
        r="3.5"
      />
    </svg>
  );
}
