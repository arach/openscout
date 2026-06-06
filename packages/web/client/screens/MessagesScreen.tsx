import type { Route } from "../lib/types.ts";
import { useScout } from "../scout/Provider.tsx";
import { ChatSubnav } from "./ChatSubnav.tsx";
import { ConversationScreen } from "./ConversationScreen.tsx";

export function MessagesScreen({
  conversationId,
  navigate,
}: {
  conversationId?: string;
  navigate: (route: Route) => void;
}) {
  const { route } = useScout();
  const content = !conversationId ? (
    <MessagesEmptyState />
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
