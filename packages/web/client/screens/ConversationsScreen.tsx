import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "../lib/api.ts";
import {
  filterSessionsByMachineScope,
  machineScopedAgentIds,
} from "../lib/machine-scope.ts";
import { routeMachineId } from "../lib/router.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { timeAgo } from "../lib/time.ts";
import { useScout } from "../scout/Provider.tsx";
import { openContent } from "../scout/slots/openContent.ts";
import type { ConversationEntry, Route } from "../lib/types.ts";
import "./conversations-screen.css";

type ConversationSection = {
  key: string;
  label: string;
  items: ConversationEntry[];
};

const SECTION_ORDER = [
  "direct",
  "channel",
  "group_direct",
  "thread",
  "system",
] as const;

const SECTION_LABELS: Record<string, string> = {
  direct: "Direct messages",
  channel: "Channels",
  group_direct: "Group DMs",
  thread: "Threads",
  system: "System",
};

function sectionRank(kind: string): number {
  const idx = SECTION_ORDER.indexOf(kind as typeof SECTION_ORDER[number]);
  return idx === -1 ? SECTION_ORDER.length : idx;
}

function conversationSubline(conversation: ConversationEntry): string {
  const bits = [
    conversation.agentName,
    conversation.currentBranch,
    conversation.workspaceRoot,
  ].filter(Boolean);
  if (bits.length > 0) {
    return bits.join(" · ");
  }
  return `${conversation.participantIds.length} participant${conversation.participantIds.length === 1 ? "" : "s"}`;
}

export function ConversationsScreen({
  navigate,
}: {
  navigate: (route: Route) => void;
}) {
  const { agents, route } = useScout();
  const [conversations, setConversations] = useState<ConversationEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const machineId = routeMachineId(route);
  const scopedAgentIds = useMemo(
    () => machineScopedAgentIds(agents, machineId),
    [agents, machineId],
  );

  const load = useCallback(async () => {
    try {
      const data = await api<ConversationEntry[]>("/api/conversations");
      setConversations(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversations");
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

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const scoped = filterSessionsByMachineScope(conversations, scopedAgentIds, machineId);
    if (!normalized) return scoped;
    return scoped.filter((conversation) => [
      conversation.title,
      conversation.kind,
      conversation.agentName ?? "",
      conversation.preview ?? "",
      conversation.workspaceRoot ?? "",
      ...conversation.participantIds,
    ].some((value) => value.toLowerCase().includes(normalized)));
  }, [conversations, scopedAgentIds, machineId, query]);

  const sections = useMemo<ConversationSection[]>(() => {
    const groups = new Map<string, ConversationEntry[]>();
    for (const conversation of filtered) {
      const list = groups.get(conversation.kind) ?? [];
      list.push(conversation);
      groups.set(conversation.kind, list);
    }
    return [...groups.entries()]
      .sort((left, right) => sectionRank(left[0]) - sectionRank(right[0]))
      .map(([key, items]) => ({
        key,
        label: SECTION_LABELS[key] ?? key,
        items,
      }));
  }, [filtered]);

  return (
    <div className="s-conversations">
      <div className="s-conversations__hero">
        <div>
          <div className="s-conversations__eyebrow">Playground</div>
          <h1>Conversations</h1>
          <p>
            Unified, normalized conversation summaries from the broker service — no direct web DB reads in this view.
          </p>
        </div>
        <button
          type="button"
          className="s-conversations__refresh"
          onClick={() => {
            setLoading(true);
            void load();
          }}
        >
          Refresh
        </button>
      </div>

      <div className="s-conversations__toolbar">
        <input
          type="text"
          className="s-conversations__search"
          placeholder="Filter conversations…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="s-conversations__meta">
          <span>{filtered.length} shown</span>
          <span>{conversations.length} total</span>
        </div>
      </div>

      {error ? <div className="s-conversations__state s-conversations__state--error">{error}</div> : null}
      {!error && loading ? <div className="s-conversations__state">Loading conversations…</div> : null}
      {!loading && !error && sections.length === 0 ? (
        <div className="s-conversations__state">No conversations yet.</div>
      ) : null}

      <div className="s-conversations__sections">
        {sections.map((section) => (
          <section key={section.key} className="s-conversations__section">
            <div className="s-conversations__section-header">
              <h2>{section.label}</h2>
              <span>{section.items.length}</span>
            </div>
            <div className="s-conversations__list">
              {section.items.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  className="s-conversations__row"
                  onClick={() => openContent(navigate, { view: "conversation", conversationId: conversation.id }, { returnTo: route })}
                >
                  <div className="s-conversations__row-main">
                    <div className="s-conversations__row-titleline">
                      <strong>{conversation.title}</strong>
                      <span className={`s-conversations__kind s-conversations__kind--${conversation.kind.replace(/_/g, "-")}`}>
                        {conversation.kind}
                      </span>
                    </div>
                    <div className="s-conversations__row-sub">{conversationSubline(conversation)}</div>
                    <div className="s-conversations__row-preview">
                      {conversation.preview?.trim() || "No preview yet"}
                    </div>
                  </div>
                  <div className="s-conversations__row-side">
                    <span>{conversation.messageCount} msg</span>
                    <span>{conversation.lastMessageAt ? timeAgo(conversation.lastMessageAt) : "—"}</span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
