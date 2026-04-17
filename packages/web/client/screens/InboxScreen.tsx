import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { timeAgo } from "../lib/time.ts";
import { actorColor, stateColor } from "../lib/colors.ts";
import { isAgentOnline } from "../lib/agent-state.ts";
import type { Agent, InboxEntry, Route, SessionEntry } from "../lib/types.ts";

function deriveInbox(agents: Agent[], sessions: SessionEntry[]): InboxEntry[] {
  const entries: InboxEntry[] = [];
  for (const session of sessions) {
    if (session.kind !== "direct" || !session.agentId) {
      continue;
    }
    const agent = agents.find((candidate) => candidate.id === session.agentId);
    if (!agent) {
      continue;
    }
    entries.push({
      agent,
      conversationId: session.id,
      preview: session.preview,
      previewActor: null,
      messageCount: session.messageCount,
      lastMessageAt: session.lastMessageAt,
    });
  }

  return entries
    .sort((a, b) => {
    const aOnline = isAgentOnline(a.agent.state) ? 0 : 1;
    const bOnline = isAgentOnline(b.agent.state) ? 0 : 1;
    if (aOnline !== bOnline) return aOnline - bOnline;
    const aT = a.lastMessageAt ?? 0;
    const bT = b.lastMessageAt ?? 0;
    return bT - aT;
  });
}

export function InboxScreen({ navigate }: { navigate: (r: Route) => void }) {
  const [entries, setEntries] = useState<InboxEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [agents, sessions] = await Promise.all([
        api<Agent[]>("/api/agents"),
        api<SessionEntry[]>("/api/sessions"),
      ]);
      setEntries(deriveInbox(agents, sessions));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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

  return (
    <div>
      {error && <p className="s-error">{error}</p>}

      {entries.length === 0 ? (
        <div className="s-empty">
          <p>No agents</p>
          <p>Agents appear here when they connect to the broker</p>
        </div>
      ) : (
        <div className="s-inbox">
          {entries.map((entry) => (
            <div
              key={entry.agent.id}
              className="s-inbox-row"
              onClick={() => navigate({ view: "conversation", conversationId: entry.conversationId })}
            >
              <div
                className="s-avatar"
                style={{ background: actorColor(entry.agent.name) }}
              >
                {entry.agent.name[0].toUpperCase()}
              </div>
              <div className="s-inbox-body">
                <div className="s-inbox-header">
                  <span className="s-inbox-name">{entry.agent.name}</span>
                  {entry.agent.harness && (
                    <span className="s-badge">{entry.agent.harness}</span>
                  )}
                  <span className="s-spacer" />
                  <span
                    className="s-dot"
                    style={{ background: stateColor(entry.agent.state) }}
                  />
                  {entry.lastMessageAt && (
                    <span className="s-time">{timeAgo(entry.lastMessageAt)}</span>
                  )}
                </div>
                {entry.preview ? (
                  <p className="s-inbox-preview">{entry.preview}</p>
                ) : (
                  <p className="s-inbox-preview s-inbox-preview-empty">No messages yet</p>
                )}
              </div>
              <span className="s-chevron" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
