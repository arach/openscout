import type { Route } from "../../lib/types.ts";
import { useScout } from "../../scout/Provider.tsx";
import { ChatSubnav } from "./ChatSubnav.tsx";
import { ConversationScreen } from "./ConversationScreen.tsx";
import "./conversation-screen.css";

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
  const { onlineCount, apiConnection, reload } = useScout();
  const apiOffline = apiConnection.status === "offline";

  return (
    <div className={`s-conv-empty${apiOffline ? " s-conv-empty--offline" : ""}`}>
      <div className="s-conv-empty-inner">
        <EmptyMesh />
        <div className="s-conv-empty-eyebrow">
          {apiOffline ? "Connection" : "Conversations"}
        </div>
        <p className="s-conv-empty-title">
          {apiOffline ? "Scout server offline" : "Nothing open yet"}
        </p>
        <p className="s-conv-empty-detail">
          {apiOffline
            ? "Start or restart Scout services. Chats and context will appear when the server responds."
            : "Pick a conversation from the rail to follow the thread, or filter to find the one you want."}
        </p>

        {apiOffline ? (
          <button
            type="button"
            className="s-conv-empty-action"
            onClick={() => void reload()}
          >
            Retry connection
          </button>
        ) : (
          <div className="s-conv-empty-hints">
            <span className="s-conv-empty-hint">
              <kbd className="s-conv-empty-kbd">/</kbd>
              filter the rail
            </span>
            <span className="s-conv-empty-hint">
              <kbd className="s-conv-empty-kbd">⌘K</kbd>
              command palette
            </span>
          </div>
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
