import { useCallback, useEffect, useState } from "react";
import { useRouter } from "./lib/router.ts";
import { api } from "./lib/api.ts";
import { useBrokerEvents } from "./lib/sse.ts";
import { ConversationScreen } from "./screens/ConversationScreen.tsx";
import { SettingsScreen } from "./screens/SettingsScreen.tsx";
import { ActivityScreen } from "./screens/ActivityScreen.tsx";
import { AgentsScreen } from "./screens/AgentsScreen.tsx";
import { HomeScreen } from "./screens/HomeScreen.tsx";
import type { Agent, Message, Route } from "./lib/types.ts";

/* ── Icons ── */

function HomeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function AgentsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function ActivityIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/* ── Main content panel ── */

function MainPanel({
  route,
  navigate,
  agents,
  messages,
}: {
  route: Route;
  navigate: (r: Route) => void;
  agents: Agent[];
  messages: Message[];
}) {
  switch (route.view) {
    case "conversation":
      return <ConversationScreen conversationId={route.conversationId} navigate={navigate} />;
    case "settings":
      return <SettingsScreen navigate={navigate} />;
    case "agents":
      return <AgentsScreen navigate={navigate} selectedAgentId={route.agentId} />;
    case "activity":
      return <ActivityScreen navigate={navigate} />;
    default:
      return <HomeScreen agents={agents} messages={messages} navigate={navigate} />;
  }
}

/* ── App ── */

export function App() {
  const { route, navigate } = useRouter();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);

  const load = useCallback(async () => {
    try {
      const [a, m] = await Promise.all([
        api<Agent[]>("/api/agents"),
        api<Message[]>("/api/messages"),
      ]);
      setAgents(a);
      setMessages(m);
    } catch {
      // stay empty on error
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useBrokerEvents(load);

  // On mobile, sidebar hides when a content view is open
  const showingContent = route.view !== "inbox";

  return (
    <div className={`s-app${showingContent ? " s-app-content-open" : ""}`}>
      {/* ── Sidebar ── */}
      <aside className="s-sidebar">
        <div className="s-sidebar-header">
          <h1 className="s-logo" onClick={() => navigate({ view: "inbox" })}>
            Scout
          </h1>
        </div>

        <nav className="s-sidebar-nav">
          <button
            type="button"
            className={`s-nav-item${route.view === "inbox" ? " s-nav-item-active" : ""}`}
            onClick={() => navigate({ view: "inbox" })}
          >
            <HomeIcon />
            <span>Home</span>
          </button>
          <button
            type="button"
            className={`s-nav-item${route.view === "agents" ? " s-nav-item-active" : ""}`}
            onClick={() => navigate({ view: "agents" })}
          >
            <AgentsIcon />
            <span>Agents</span>
          </button>
          <button
            type="button"
            className={`s-nav-item${route.view === "activity" ? " s-nav-item-active" : ""}`}
            onClick={() => navigate({ view: "activity" })}
          >
            <ActivityIcon />
            <span>Activity</span>
          </button>
        </nav>

        <div className="s-spacer" />

        <nav className="s-sidebar-footer">
          <button
            type="button"
            className={`s-nav-item${route.view === "settings" ? " s-nav-item-active" : ""}`}
            onClick={() => navigate({ view: "settings" })}
          >
            <GearIcon />
            <span>Settings</span>
          </button>
        </nav>
      </aside>

      {/* ── Main content ── */}
      <main className="s-content">
        <MainPanel route={route} navigate={navigate} agents={agents} messages={messages} />
      </main>
    </div>
  );
}
