import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { isGroupConversation } from "../lib/conversations.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import type { Route, SessionEntry } from "../lib/types.ts";
import { ChannelsScreen } from "./ChannelsScreen.tsx";
import { ConversationScreen } from "./ConversationScreen.tsx";

export function MessagesScreen({
  conversationId,
  navigate,
}: {
  conversationId?: string;
  navigate: (route: Route) => void;
}) {
  const [entry, setEntry] = useState<SessionEntry | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!conversationId) {
      setEntry(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api<SessionEntry>(`/api/session/${encodeURIComponent(conversationId)}`)
      .then((data) => {
        if (!cancelled) setEntry(data);
      })
      .catch(() => {
        if (!cancelled) setEntry(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [conversationId]);

  useBrokerEvents((event) => {
    if (!conversationId) return;
    if (event.kind === "conversation.upserted") {
      api<SessionEntry>(`/api/session/${encodeURIComponent(conversationId)}`)
        .then((data) => setEntry(data))
        .catch(() => {});
    }
  });

  if (!conversationId) {
    return <MessagesEmptyState />;
  }

  if (loading && !entry) {
    return <MessagesLoadingState />;
  }

  if (entry && isGroupConversation(entry)) {
    return (
      <ChannelsScreen channelId={conversationId} navigate={navigate} />
    );
  }

  return (
    <ConversationScreen
      conversationId={conversationId}
      navigate={navigate}
    />
  );
}

function MessagesEmptyState() {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        color: "var(--muted)",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        letterSpacing: "0.04em",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 360 }}>
        <div
          style={{
            textTransform: "uppercase",
            letterSpacing: "0.18em",
            fontSize: 10,
            color: "color-mix(in srgb, var(--accent) 70%, var(--muted))",
            marginBottom: 8,
          }}
        >
          Messages
        </div>
        <p style={{ lineHeight: 1.6, margin: 0 }}>
          Pick a DM or channel from the left rail. Use the filter chips to
          switch scopes and the sort selector to reorder.
        </p>
      </div>
    </div>
  );
}

function MessagesLoadingState() {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--muted)",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
      }}
    >
      Loading conversation…
    </div>
  );
}
