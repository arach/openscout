import { useCallback, useEffect, useState } from "react";
import { useRouter } from "./lib/router.ts";
import { api } from "./lib/api.ts";
import { useBrokerEvents } from "./lib/sse.ts";
import { ConversationScreen } from "./screens/ConversationScreen.tsx";
import { SettingsScreen } from "./screens/SettingsScreen.tsx";
import { ActivityScreen } from "./screens/ActivityScreen.tsx";
import { AgentInfoScreen } from "./screens/AgentInfoScreen.tsx";
import { AgentsScreen } from "./screens/AgentsScreen.tsx";
import { FleetScreen } from "./screens/FleetScreen.tsx";
import { SessionsScreen } from "./screens/SessionsScreen.tsx";
import { MeshScreen } from "./screens/MeshScreen.tsx";
import { HomeScreen } from "./screens/HomeScreen.tsx";
import { WorkDetailScreen } from "./screens/WorkDetailScreen.tsx";
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

function FleetIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="4" r="2" />
      <circle cx="4" cy="12" r="2" />
      <circle cx="20" cy="12" r="2" />
      <circle cx="12" cy="20" r="2" />
      <path d="M12 6v3" />
      <path d="M6 12h3" />
      <path d="M15 12h3" />
      <path d="M12 15v3" />
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

function SessionsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function MeshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
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
    case "agent-info":
      return <AgentInfoScreen conversationId={route.conversationId} navigate={navigate} />;
    case "settings":
      return <SettingsScreen navigate={navigate} />;
    case "agents":
      return <AgentsScreen navigate={navigate} selectedAgentId={route.agentId} />;
    case "fleet":
      return <FleetScreen navigate={navigate} />;
    case "sessions":
      if (route.sessionId) {
        return <ConversationScreen conversationId={route.sessionId} navigate={navigate} />;
      }
      return <SessionsScreen navigate={navigate} />;
    case "mesh":
      return <MeshScreen navigate={navigate} />;
    case "activity":
      return <ActivityScreen navigate={navigate} />;
    case "work":
      return <WorkDetailScreen workId={route.workId} navigate={navigate} />;
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
    const [agentsResult, messagesResult] = await Promise.allSettled([
      api<Agent[]>("/api/agents"),
      api<Message[]>("/api/messages"),
    ]);

    if (agentsResult.status === "fulfilled") {
      setAgents(agentsResult.value);
    }
    if (messagesResult.status === "fulfilled") {
      setMessages(messagesResult.value);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useBrokerEvents(load);

  // On mobile, sidebar hides when a content view is open
  const showingContent = route.view !== "inbox" && route.view !== "sessions" && route.view !== "mesh";

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
            className={`s-nav-item${route.view === "fleet" ? " s-nav-item-active" : ""}`}
            onClick={() => navigate({ view: "fleet" })}
          >
            <FleetIcon />
            <span>Fleet</span>
          </button>
          <button
            type="button"
            className={`s-nav-item${route.view === "sessions" ? " s-nav-item-active" : ""}`}
            onClick={() => navigate({ view: "sessions" })}
          >
            <SessionsIcon />
            <span>Sessions</span>
          </button>
          <button
            type="button"
            className={`s-nav-item${route.view === "activity" ? " s-nav-item-active" : ""}`}
            onClick={() => navigate({ view: "activity" })}
          >
            <ActivityIcon />
            <span>Activity</span>
          </button>
          <button
            type="button"
            className={`s-nav-item${route.view === "mesh" ? " s-nav-item-active" : ""}`}
            onClick={() => navigate({ view: "mesh" })}
          >
            <MeshIcon />
            <span>Mesh</span>
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
