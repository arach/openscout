import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import { actorColor, stateColor } from "../lib/colors.ts";
import {
  conversationDisplayTitle,
  conversationShortLabel,
  isGroupConversation,
} from "../lib/conversations.ts";
import { normalizeAgentState } from "../lib/agent-state.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { timeAgo, fullTimestamp } from "../lib/time.ts";
import { MessageMarkup } from "../lib/message-markup.tsx";
import { saveLastViewed } from "../lib/sessionRead.ts";
import { useScout } from "../scout/Provider.tsx";
import type { Agent, Message, Route, SessionEntry } from "../lib/types.ts";
import "./conversation-screen.css";
import "./channel-screen.css";

/* ── Helpers ── */

function sortMessages(msgs: Message[]): Message[] {
  return [...msgs].sort((a, b) => a.createdAt - b.createdAt);
}

function isSameDay(a?: number, b?: number): boolean {
  if (!a || !b) return false;
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate();
}

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((today - target) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/* ── Right sidebar ── */

function ChannelSidebar({
  channel,
  agents,
  messageCount,
}: {
  channel: SessionEntry;
  agents: Agent[];
  messageCount: number;
}) {
  const members = useMemo(() => {
    return channel.participantIds.map((pid) => {
      if (pid === "operator") {
        return { id: "operator", name: "You", handle: "operator", state: "available" as const };
      }
      const agent = agents.find((a) => a.id === pid);
      return agent
        ? { id: agent.id, name: agent.name, handle: agent.handle ?? agent.id, state: normalizeAgentState(agent.state) }
        : { id: pid, name: pid, handle: pid, state: "offline" as const };
    });
  }, [channel.participantIds, agents]);

  const online = members.filter((m) => m.state !== "offline");
  const offline = members.filter((m) => m.state === "offline");

  return (
    <aside className="ch-sidebar">
      <section className="ch-sidebar-section">
        <div className="ch-sidebar-section-label">Channel</div>
        <div className="ch-sidebar-info">
          <div className="ch-sidebar-info-name">
            <span className="ch-sidebar-info-hash">#</span>
            <span className="ch-sidebar-info-title">{conversationDisplayTitle(channel)}</span>
          </div>
          <div className="ch-sidebar-info-id">{channel.id}</div>
          <div className="ch-sidebar-stats">
            <span className="ch-sidebar-stat">
              <span className="ch-sidebar-stat-value">{messageCount}</span>
              <span className="ch-sidebar-stat-label">messages</span>
            </span>
            <span className="ch-sidebar-stat">
              <span className="ch-sidebar-stat-value">{members.length}</span>
              <span className="ch-sidebar-stat-label">members</span>
            </span>
          </div>
        </div>
      </section>

      <section className="ch-sidebar-section">
        <div className="ch-sidebar-section-label">
          Members
          {online.length > 0 && (
            <span className="ch-sidebar-online-badge">{online.length} online</span>
          )}
        </div>
        <div className="ch-sidebar-members">
          {[...online, ...offline].map((m) => (
            <div key={m.id} className="ch-sidebar-member">
              <div className="ch-sidebar-member-avatar-wrap">
                <div
                  className="ch-sidebar-member-avatar"
                  style={{ background: actorColor(m.name) }}
                >
                  {m.name[0]?.toUpperCase() ?? "?"}
                </div>
                <span
                  className="ch-sidebar-member-dot"
                  style={{ background: stateColor(m.state) }}
                />
              </div>
              <div className="ch-sidebar-member-info">
                <span className="ch-sidebar-member-name">{m.name}</span>
                <span className="ch-sidebar-member-handle">@{m.handle}</span>
              </div>
              {m.state === "working" && (
                <span className="ch-sidebar-member-state">working</span>
              )}
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}

/* ── Message feed + compose ── */

function ChannelFeed({
  channelId,
  channelName,
  agents,
  operatorName,
  onMessageCountChange,
}: {
  channelId: string;
  channelName: string;
  agents: Agent[];
  operatorName: string;
  onMessageCountChange: (count: number) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const composeRef = useRef<HTMLTextAreaElement>(null);
  const prevCountRef = useRef(0);
  const initialScrollDoneRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const msgs = await api<Message[]>(
        `/api/messages?conversationId=${encodeURIComponent(channelId)}&limit=300`,
      );
      const sorted = sortMessages(msgs);
      setMessages(sorted);
      saveLastViewed(channelId);
      if (sorted.length !== prevCountRef.current) {
        prevCountRef.current = sorted.length;
        onMessageCountChange(sorted.length);
      }
    } catch {
      // ignore
    }
  }, [channelId, onMessageCountChange]);

  useEffect(() => { void load(); }, [load]);

  useBrokerEvents((event) => {
    if (event.kind === "message.posted") {
      const payload = event.payload as { conversationId?: string } | undefined;
      if (payload?.conversationId === channelId) void load();
    }
  });

  useEffect(() => {
    if (messages.length === 0) return;
    const behavior = initialScrollDoneRef.current ? "smooth" : "instant";
    bottomRef.current?.scrollIntoView({ behavior });
    initialScrollDoneRef.current = true;
  }, [messages.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft("");
    setError(null);
    const optimistic: Message = {
      id: `optimistic-${Date.now()}`,
      conversationId: channelId,
      actorName: operatorName,
      body: text,
      createdAt: Date.now(),
      class: "operator",
    };
    setMessages((prev) => sortMessages([...prev, optimistic]));
    try {
      await api("/api/send", {
        method: "POST",
        body: JSON.stringify({ body: text, conversationId: channelId }),
      });
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="ch-feed-shell">
      <div className="ch-feed">
        <div className="ch-feed-spacer" />

        {messages.length === 0 && (
          <div className="ch-empty-feed">
            <div className="ch-empty-feed-hash">#</div>
            <p className="ch-empty-feed-title">Welcome to #{channelName}</p>
            <p className="ch-empty-feed-sub">
              This is the beginning of the channel. Be the first to post.
            </p>
          </div>
        )}

        {messages.map((msg, i) => {
          const isYou = msg.actorName === operatorName || msg.class === "operator";
          const showDay = i === 0 || !isSameDay(messages[i - 1]?.createdAt, msg.createdAt);
          const showAvatar = i === 0 || messages[i - 1]?.actorName !== msg.actorName || showDay;
          const abs = fullTimestamp(msg.createdAt);
          const msgAgent = !isYou && msg.actorName
            ? agents.find((a) => a.name === msg.actorName) ?? null
            : null;
          const handle = isYou ? operatorName.toLowerCase() : (msgAgent?.handle ?? null);
          const color = actorColor(isYou ? operatorName : (msg.actorName ?? "?"));

          return (
            <div key={msg.id} className="ch-msg-group">
              {showDay && (
                <div className="s-thread-day-divider">
                  <span className="s-thread-day-line" />
                  <span className="s-thread-day-label">{dayLabel(msg.createdAt)}</span>
                  <span className="s-thread-day-line" />
                </div>
              )}
              <article
                id={`msg-${msg.id}`}
                className={["ch-msg", showAvatar && "ch-msg--with-avatar"].filter(Boolean).join(" ")}
              >
                {showAvatar ? (
                  <div className="ch-msg-avatar" style={{ background: color }}>
                    {(isYou ? operatorName[0] : msg.actorName?.[0] ?? "?").toUpperCase()}
                  </div>
                ) : (
                  <div className="ch-msg-avatar-gap">
                    <span className="ch-msg-inline-time" title={abs}>{timeAgo(msg.createdAt)}</span>
                  </div>
                )}
                <div className="ch-msg-content">
                  {showAvatar && (
                    <div className="ch-msg-header">
                      <span className="ch-msg-author" style={{ color }}>
                        {isYou ? operatorName : msg.actorName}
                      </span>
                      {handle && (
                        <span className="ch-msg-handle">@{handle}</span>
                      )}
                      <span className="ch-msg-time" title={abs}>
                        {timeAgo(msg.createdAt)}
                      </span>
                    </div>
                  )}
                  <div className="ch-msg-body">
                    <MessageMarkup text={msg.body} />
                  </div>
                </div>
              </article>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {error && <div className="ch-compose-error">{error}</div>}

      <div className="ch-compose-wrap">
        <form
          className="ch-compose"
          onSubmit={(e) => { e.preventDefault(); void send(); }}
        >
          <textarea
            ref={composeRef}
            className="ch-compose-input"
            placeholder={`Message #${channelName}…`}
            value={draft}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={sending}
          />
          <button
            type="submit"
            className="ch-compose-send"
            disabled={!draft.trim() || sending}
            aria-label="Send message"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="2" y1="8" x2="14" y2="8" />
              <polyline points="8 2 14 8 8 14" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
}

/* ── No selection empty state ── */

const CHANNEL_EXAMPLES = [
  {
    slug: "releases",
    description: "Coordinate deploys across agents working different repos.",
  },
  {
    slug: "triage",
    description: "Route incoming issues to the right agent automatically.",
  },
  {
    slug: "reviews",
    description: "All PR feedback and review requests in one thread.",
  },
];

function NoChannelSelected({ count }: { count: number }) {
  return (
    <div className="ch-overview">
      <div className="ch-overview-header">
        <div className="ch-overview-hash">#</div>
        <div className="ch-overview-heading">
          <h2 className="ch-overview-title">Channels</h2>
          <p className="ch-overview-tagline">
            Shared spaces where agents and operators coordinate over a common thread.
          </p>
        </div>
      </div>

      <div className="ch-overview-body">
        <div className="ch-overview-block">
          <div className="ch-overview-block-label">How it works</div>
          <p className="ch-overview-block-text">
            A channel is a broker-backed conversation anyone on the mesh can join.
            Send a message to any <code className="ch-overview-code">channel.*</code> address
            and the broker creates it automatically. Agents, bridges, and operators
            all share the same thread.
          </p>
        </div>

        <div className="ch-overview-block">
          <div className="ch-overview-block-label">
            {count === 0 ? "Start your first channel" : `${count} channel${count !== 1 ? "s" : ""} — pick one from the left`}
          </div>
          <div className="ch-overview-examples">
            {CHANNEL_EXAMPLES.map((ex) => (
              <div key={ex.slug} className="ch-overview-example">
                <span className="ch-overview-example-name">
                  <span className="ch-overview-example-hash">#</span>
                  {ex.slug}
                </span>
                <span className="ch-overview-example-desc">{ex.description}</span>
              </div>
            ))}
          </div>
          {count === 0 && (
            <div className="ch-overview-hint">
              From any agent: <code className="ch-overview-code">send --to channel.releases "deploy ready"</code>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Main screen ── */

export function ChannelsScreen({
  channelId,
  navigate: _navigate,
}: {
  channelId?: string;
  navigate: (r: Route) => void;
}) {
  const { agents } = useScout();
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [operatorName, setOperatorName] = useState("operator");
  const [messageCount, setMessageCount] = useState(0);

  const channels = useMemo(
    () => sessions.filter(isGroupConversation),
    [sessions],
  );

  const selectedChannel = channelId
    ? (channels.find((c) => c.id === channelId) ?? null)
    : null;

  const loadSessions = useCallback(async () => {
    const data = await api<SessionEntry[]>("/api/conversations").catch(() => [] as SessionEntry[]);
    setSessions(data);
  }, []);

  useEffect(() => { void loadSessions(); }, [loadSessions]);

  useEffect(() => {
    api<{ name?: string }>("/api/user")
      .then((u) => { if (u?.name) setOperatorName(u.name); })
      .catch(() => {});
  }, []);

  useBrokerEvents((event) => {
    if (event.kind === "message.posted" || event.kind === "conversation.upserted") {
      void loadSessions();
    }
  });

  return (
    <div className="ch-screen">
      {selectedChannel ? (
        <>
          <div className="ch-center-header">
            <div className="ch-center-header-left">
              <span className="ch-center-hash">#</span>
              <span className="ch-center-title">{conversationDisplayTitle(selectedChannel)}</span>
              <span className="ch-center-slug">{conversationShortLabel(selectedChannel)}</span>
            </div>
            <div className="ch-center-header-right">
              {selectedChannel.participantIds.length > 0 && (
                <div className="ch-center-member-stack">
                  {selectedChannel.participantIds.slice(0, 4).map((pid) => {
                    const agent = agents.find((a) => a.id === pid);
                    const name = agent?.name ?? pid;
                    return (
                      <div
                        key={pid}
                        className="ch-center-member-pip"
                        style={{ background: actorColor(name) }}
                        title={name}
                      >
                        {name[0]?.toUpperCase() ?? "?"}
                      </div>
                    );
                  })}
                  {selectedChannel.participantIds.length > 4 && (
                    <span className="ch-center-member-overflow">
                      +{selectedChannel.participantIds.length - 4}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="ch-body">
            <ChannelFeed
              key={channelId}
              channelId={channelId!}
              channelName={conversationDisplayTitle(selectedChannel)}
              agents={agents}
              operatorName={operatorName}
              onMessageCountChange={setMessageCount}
            />
            <ChannelSidebar
              channel={selectedChannel}
              agents={agents}
              messageCount={messageCount}
            />
          </div>
        </>
      ) : (
        <NoChannelSelected count={channels.length} />
      )}
    </div>
  );
}
