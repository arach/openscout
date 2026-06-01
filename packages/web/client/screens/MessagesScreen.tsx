import type { Route } from "../lib/types.ts";
import { ConversationScreen } from "./ConversationScreen.tsx";

export function MessagesScreen({
  conversationId,
  navigate,
}: {
  conversationId?: string;
  navigate: (route: Route) => void;
}) {
  if (!conversationId) {
    return <MessagesEmptyState />;
  }

  return (
    <ConversationScreen
      conversationId={conversationId}
      navigate={navigate}
      showBackNav={false}
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
          Conversations
        </div>
        <p style={{ lineHeight: 1.6, margin: 0 }}>
          Select a conversation from the rail.
        </p>
      </div>
    </div>
  );
}
