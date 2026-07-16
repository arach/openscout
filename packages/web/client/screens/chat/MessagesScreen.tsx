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
import { useBrokerEvents } from "../../lib/sse.ts";
import { timeAgo } from "../../lib/time.ts";
import type { Route, SessionEntry } from "../../lib/types.ts";
import { useScout } from "../../scout/Provider.tsx";
import { ChatSubnav } from "./ChatSubnav.tsx";
import { ConversationScreen } from "./ConversationScreen.tsx";
import "./conversation-screen.css";

type ConversationGridCardSize = "compact" | "medium" | "chat";

const CONVERSATION_GRID_SIZE_STORAGE_KEY = "openscout:conversation-grid-card-sizes:v1";
const CONVERSATION_GRID_SIZE_OPTIONS: Array<{
  value: ConversationGridCardSize;
  label: string;
  title: string;
}> = [
  { value: "compact", label: "1", title: "Compact card" },
  { value: "medium", label: "2", title: "Medium card" },
  { value: "chat", label: "4", title: "2×2 chat panel" },
];

function loadConversationGridCardSizes(): Record<string, ConversationGridCardSize> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CONVERSATION_GRID_SIZE_STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object") return {};
    const next: Record<string, ConversationGridCardSize> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value === "compact" || value === "medium" || value === "chat") {
        next[key] = value;
      }
    }
    return next;
  } catch {
    return {};
  }
}

function saveConversationGridCardSizes(sizes: Record<string, ConversationGridCardSize>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CONVERSATION_GRID_SIZE_STORAGE_KEY, JSON.stringify(sizes));
  } catch {
    // Best-effort layout persistence.
  }
}

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
  const [cardSizes, setCardSizes] = useState<Record<string, ConversationGridCardSize>>(() =>
    loadConversationGridCardSizes()
  );
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

  const recentConversations = useMemo(() => {
    return [...filterSessionsByMachineScope(conversations, scopedAgentIds, machineId)]
      .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
  }, [conversations, scopedAgentIds, machineId]);

  const openConversation = (conversationId: string) => {
    navigate({
      view: "messages",
      conversationId,
      ...(route.view === "messages" && route.filter ? { filter: route.filter } : {}),
      ...(route.view === "messages" && route.sort ? { sort: route.sort } : {}),
    });
  };

  const setConversationCardSize = useCallback((conversationId: string, size: ConversationGridCardSize) => {
    setCardSizes((current) => {
      const next = { ...current };
      if (size === "compact") delete next[conversationId];
      else next[conversationId] = size;
      saveConversationGridCardSizes(next);
      return next;
    });
  }, []);

  if (!apiOffline && !error && recentConversations.length > 0) {
    return (
      <div className="s-conv-grid-shell">
        <div className="s-conv-grid-head">
          <div>
            <div className="s-conv-grid-eyebrow">Conversations</div>
            <h1>Recent chats</h1>
            <p>All chats sorted by latest message. Promote any card into a medium tile or a 2×2 live chat panel.</p>
          </div>
          <div className="s-conv-grid-actions">
            <button
              type="button"
              className="s-conv-grid-new"
              onClick={() => openContextCapture()}
            >
              <Plus size={16} aria-hidden="true" />
              New chat
            </button>
            <div className="s-conv-grid-count">
              <strong>{recentConversations.length}</strong>
              <span>{recentConversations.length === 1 ? "chat" : "chats"}</span>
            </div>
          </div>
        </div>
        <div className="s-conv-grid" aria-label="Recent conversations">
          {recentConversations.map((conversation) => (
            <ConversationGridCard
              key={conversation.id}
              conversation={conversation}
              navigate={navigate}
              size={cardSizes[conversation.id] ?? "compact"}
              onOpen={() => openConversation(conversation.id)}
              onSizeChange={(size) => setConversationCardSize(conversation.id, size)}
            />
          ))}
        </div>
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
              ? "Fetching your recent conversation grid."
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

function ConversationGridCard({
  conversation,
  navigate,
  size,
  onOpen,
  onSizeChange,
}: {
  conversation: SessionEntry;
  navigate: (route: Route) => void;
  size: ConversationGridCardSize;
  onOpen: () => void;
  onSizeChange: (size: ConversationGridCardSize) => void;
}) {
  const title = conversationDisplayTitle(conversation);
  const kind = conversation.kind.replace(/_/g, " ");
  const subline = conversationGridSubline(conversation);
  const lastMessage = conversation.lastMessageAt ? timeAgo(conversation.lastMessageAt) : "No messages";
  const preview = conversation.preview?.trim() || "No preview yet";
  const isChatPanel = size === "chat";

  return (
    <article
      className={`s-conv-grid-card s-conv-grid-card--${conversation.kind.replace(/_/g, "-")} s-conv-grid-card--size-${size}`}
    >
      <div className="s-conv-grid-card-top">
        <span className="s-conv-grid-card-kind">{kind}</span>
        <span className="s-conv-grid-card-time">{lastMessage}</span>
      </div>
      <div className="s-conv-grid-card-heading">
        <button
          type="button"
          className="s-conv-grid-card-title"
          title={title}
          onClick={onOpen}
        >
          {title}
        </button>
        <div className="s-conv-grid-size-controls" aria-label={`Tile size for ${title}`}>
          {CONVERSATION_GRID_SIZE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`s-conv-grid-size-option${size === option.value ? " s-conv-grid-size-option--active" : ""}`}
              title={option.title}
              aria-pressed={size === option.value}
              onClick={() => onSizeChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {isChatPanel ? (
        <div className="s-conv-grid-card-chat">
          <ConversationScreen
            conversationId={conversation.id}
            navigate={navigate}
            embedded
            showBackNav={false}
          />
        </div>
      ) : (
        <>
          <span className="s-conv-grid-card-sub" title={subline}>{subline}</span>
          <span className="s-conv-grid-card-preview">{preview}</span>
          <span className="s-conv-grid-card-foot">
            <span>{conversation.messageCount} {conversation.messageCount === 1 ? "msg" : "msgs"}</span>
            {isGroupConversation(conversation) ? (
              <span>{conversation.participantIds.length} participants</span>
            ) : null}
          </span>
        </>
      )}
    </article>
  );
}

function conversationGridSubline(conversation: SessionEntry): string {
  const bits = [
    conversation.agentName,
    conversation.currentBranch,
    conversation.workspaceRoot,
  ].filter((value): value is string => Boolean(value));
  if (bits.length > 0) return bits.join(" · ");
  return `${conversation.participantIds.length} participant${conversation.participantIds.length === 1 ? "" : "s"}`;
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
