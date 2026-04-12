import { useCallback, useEffect, useState } from "react";
import { useRouter } from "./lib/router.ts";
import { api } from "./lib/api.ts";
import { useBrokerEvents } from "./lib/sse.ts";
import { timeAgo } from "./lib/time.ts";
import { actorColor, stateColor } from "./lib/colors.ts";
import { conversationForAgent } from "./lib/router.ts";
import { ConversationScreen } from "./screens/ConversationScreen.tsx";
import { AgentInfoScreen } from "./screens/AgentInfoScreen.tsx";
import { SettingsScreen } from "./screens/SettingsScreen.tsx";
import type { Agent, Message, InboxEntry, Route } from "./lib/types.ts";

/* ── Derive inbox from agents + messages ── */

function deriveInbox(agents: Agent[], messages: Message[]): InboxEntry[] {
  const byConv = new Map<string, Message[]>();
  for (const m of messages) {
    let arr = byConv.get(m.conversationId);
    if (!arr) { arr = []; byConv.set(m.conversationId, arr); }
    arr.push(m);
  }

  return agents.map((agent) => {
    const cid = conversationForAgent(agent.id);
    const msgs = byConv.get(cid);
    let preview: string | null = null;
    let previewActor: string | null = null;
    let lastMessageAt: number | null = null;
    let messageCount = 0;

    if (msgs && msgs.length > 0) {
      msgs.sort((a, b) => b.createdAt - a.createdAt);
      preview = msgs[0].body.slice(0, 120);
      previewActor = msgs[0].actorName;
      lastMessageAt = msgs[0].createdAt;
      messageCount = msgs.length;
    }

    return { agent, conversationId: cid, preview, previewActor, messageCount, lastMessageAt };
  }).sort((a, b) => {
    const aActive = a.agent.state === "active" ? 0 : 1;
    const bActive = b.agent.state === "active" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    const aT = a.lastMessageAt ?? 0;
    const bT = b.lastMessageAt ?? 0;
    return bT - aT;
  });
}

/* ── Gear icon SVG ── */

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/* ── Main content panel ── */

function MainPanel({ route, navigate }: { route: Route; navigate: (r: Route) => void }) {
  switch (route.view) {
    case "conversation":
      return <ConversationScreen conversationId={route.conversationId} navigate={navigate} />;
    case "agent-info":
      return <AgentInfoScreen conversationId={route.conversationId} navigate={navigate} />;
    case "settings":
      return <SettingsScreen navigate={navigate} />;
    default:
      return (
        <div className="s-welcome">
          <div className="s-welcome-inner">
            <h2>Scout</h2>
            <p>Select an agent to start a conversation</p>
          </div>
        </div>
      );
  }
}

/* ── App ── */

export function App() {
  const { route, navigate } = useRouter();

  const [entries, setEntries] = useState<InboxEntry[]>([]);

  const load = useCallback(async () => {
    try {
      const [agents, messages] = await Promise.all([
        api<Agent[]>("/api/agents"),
        api<Message[]>("/api/messages"),
      ]);
      setEntries(deriveInbox(agents, messages));
    } catch {
      // sidebar just stays empty on error
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useBrokerEvents(load);

  // Tick for fresh timestamps
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  // Which conversation is selected (for highlighting sidebar row)
  const selectedConversation =
    route.view === "conversation" || route.view === "agent-info"
      ? route.conversationId
      : null;

  // On mobile, sidebar hides when a conversation/settings is open
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

        <div className="s-sidebar-label">Agents</div>

        <div className="s-sidebar-list">
          {entries.length === 0 ? (
            <div className="s-sidebar-empty">No agents connected</div>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.agent.id}
                className={`s-sidebar-row${
                  selectedConversation === entry.conversationId ? " s-sidebar-row-active" : ""
                }`}
                onClick={() => navigate({ view: "conversation", conversationId: entry.conversationId })}
              >
                <div
                  className="s-avatar s-avatar-sm"
                  style={{ background: actorColor(entry.agent.name) }}
                >
                  {entry.agent.name[0].toUpperCase()}
                </div>
                <div className="s-sidebar-row-body">
                  <div className="s-sidebar-row-header">
                    <span className="s-sidebar-row-name">{entry.agent.name}</span>
                    <span
                      className="s-dot"
                      style={{ background: stateColor(entry.agent.state) }}
                    />
                  </div>
                  {entry.preview ? (
                    <p className="s-sidebar-row-preview">{entry.preview}</p>
                  ) : (
                    <p className="s-sidebar-row-preview s-sidebar-row-preview-empty">No messages yet</p>
                  )}
                </div>
                {entry.lastMessageAt && (
                  <span className="s-sidebar-row-time">{timeAgo(entry.lastMessageAt)}</span>
                )}
              </div>
            ))
          )}
        </div>

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
        <MainPanel route={route} navigate={navigate} />
      </main>

      {/* ── Mobile back overlay (tap to go back to sidebar) ── */}
    </div>
  );
}
