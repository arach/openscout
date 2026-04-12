import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { timeAgo } from "../lib/time.ts";
import { actorColor, stateColor } from "../lib/colors.ts";
import { conversationForAgent } from "../lib/router.ts";
import type { Agent, Message, InboxEntry, Route } from "../lib/types.ts";

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
    // Active agents first
    const aActive = a.agent.state === "active" ? 0 : 1;
    const bActive = b.agent.state === "active" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    // Then by last message time
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
      const [agents, messages] = await Promise.all([
        api<Agent[]>("/api/agents"),
        api<Message[]>("/api/messages"),
      ]);
      setEntries(deriveInbox(agents, messages));
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
