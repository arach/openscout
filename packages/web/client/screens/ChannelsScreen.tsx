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
import { isSameCalendarDay, formatThreadDayLabel } from "../lib/thread-days.ts";
import { MessageMarkup } from "../lib/message-markup.tsx";
import { saveLastViewed } from "../lib/sessionRead.ts";
import { AgentPicker, AgentMentionTextarea } from "../lib/agent-autocomplete.tsx";
import {
  filterAgentsByMachineScope,
  filterSessionsByMachineScope,
  machineScopedAgentIds,
} from "../lib/machine-scope.ts";
import { routeMachineId } from "../lib/router.ts";
import { useScout } from "../scout/Provider.tsx";
import { DictationMic } from "../components/DictationMic.tsx";
import { MessageEmbeds } from "../components/MessageEmbeds.tsx";
import { useAgentHovercard } from "../components/AgentHoverCard.tsx";
import type { Agent, Message, Route, SessionEntry } from "../lib/types.ts";
import "./conversation-screen.css";
import "./channel-screen.css";

/* ── Helpers ── */

type ChannelActor = { id: string; name: string };

function sortMessages(msgs: Message[]): Message[] {
  return [...msgs].sort((a, b) => a.createdAt - b.createdAt);
}

function resolveMessageAgent(message: Message, agents: Agent[]): Agent | null {
  if (message.actorId) {
    const exact = agents.find((agent) => agent.id === message.actorId);
    if (exact) return exact;
  }
  if (!message.actorName) return null;
  const named = agents.filter((agent) => agent.name === message.actorName);
  return named.length === 1 ? named[0]! : null;
}

function actorsEqual(left: ChannelActor[], right: ChannelActor[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i]!.id !== right[i]!.id || left[i]!.name !== right[i]!.name) return false;
  }
  return true;
}

/* ── Header members control ── */

type RosterMember = {
  id: string;
  name: string;
  handle: string;
  state: ReturnType<typeof normalizeAgentState>;
  isMember: boolean;
  agent: Agent | null;
};

function MembersHeaderControl({
  channel,
  agents,
  extraActors,
}: {
  channel: SessionEntry;
  agents: Agent[];
  extraActors: ChannelActor[];
}) {
  const formalMemberIds = useMemo(
    () => channel.participantIds.filter((pid) => pid !== "operator"),
    [channel.participantIds],
  );

  const members = useMemo<RosterMember[]>(() => {
    const collected = new Map<string, RosterMember>();
    const formalSet = new Set(formalMemberIds);

    const add = (id: string, fallbackName: string, isMember: boolean) => {
      if (collected.has(id)) return;
      const agent = agents.find((a) => a.id === id) ?? null;
      collected.set(id, agent
        ? {
            id: agent.id,
            name: agent.name,
            handle: agent.handle ?? agent.id,
            state: normalizeAgentState(agent.state),
            isMember,
            agent,
          }
        : {
            id,
            name: fallbackName,
            handle: id,
            state: normalizeAgentState(null),
            isMember,
            agent: null,
          });
    };

    for (const pid of formalMemberIds) add(pid, pid, true);
    for (const actor of extraActors) {
      if (actor.id === "operator") continue;
      add(actor.id, actor.name, formalSet.has(actor.id));
    }
    return Array.from(collected.values());
  }, [formalMemberIds, extraActors, agents]);

  const onlineCount = members.filter((m) => m.state !== "offline").length;
  const guestCount = members.filter((m) => !m.isMember).length;

  const [rosterOpen, setRosterOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingActorId, setPendingActorId] = useState<string | null>(null);
  const rosterRef = useRef<HTMLDivElement>(null);
  const rosterTriggerRef = useRef<HTMLButtonElement>(null);
  const addTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!rosterOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rosterRef.current?.contains(target)) return;
      if (rosterTriggerRef.current?.contains(target)) return;
      setRosterOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRosterOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [rosterOpen]);

  const addMember = async (actorId: string) => {
    setPendingActorId(actorId);
    try {
      await api(`/api/conversations/${encodeURIComponent(channel.id)}/members`, {
        method: "POST",
        body: JSON.stringify({ actorId }),
      });
      setPickerOpen(false);
    } finally {
      setPendingActorId(null);
    }
  };

  const removeMember = async (actorId: string) => {
    setPendingActorId(actorId);
    try {
      await api(
        `/api/conversations/${encodeURIComponent(channel.id)}/members/${encodeURIComponent(actorId)}`,
        { method: "DELETE" },
      );
    } finally {
      setPendingActorId(null);
    }
  };

  return (
    <div className="ch-members-control">
      <button
        ref={rosterTriggerRef}
        type="button"
        className="ch-members-trigger"
        onClick={() => setRosterOpen((v) => !v)}
        aria-label={`${members.length} members${onlineCount ? `, ${onlineCount} online` : ""}`}
        aria-expanded={rosterOpen}
        title="View members"
      >
        <div className="ch-members-stack">
          {members.slice(0, 4).map((m) => (
            <div
              key={m.id}
              className="ch-members-pip"
              style={{ background: actorColor(m.name) }}
            >
              {m.name[0]?.toUpperCase() ?? "?"}
            </div>
          ))}
          {members.length > 4 && (
            <span className="ch-members-overflow">+{members.length - 4}</span>
          )}
        </div>
        <span className="ch-members-count">
          {members.length}
          {onlineCount > 0 && (
            <span className="ch-members-online-dot" aria-hidden />
          )}
        </span>
      </button>

      {rosterOpen && (
        <div ref={rosterRef} className="ch-members-roster" role="dialog" aria-label="Members">
          <div className="ch-members-roster-header">
            <span className="ch-members-roster-title">
              {members.length} member{members.length !== 1 ? "s" : ""}
            </span>
            {onlineCount > 0 && (
              <span className="ch-members-roster-online">{onlineCount} online</span>
            )}
          </div>
          <div className="ch-members-roster-list">
            {members.length === 0 ? (
              <div className="ch-members-roster-empty">No agents in this channel yet.</div>
            ) : (
              members.map((m) => (
                <RosterRow
                  key={m.id}
                  member={m}
                  removeBusy={pendingActorId === m.id}
                  onRemove={() => void removeMember(m.id)}
                />
              ))
            )}
          </div>
          {guestCount > 0 && (
            <div className="ch-members-roster-footnote">
              {guestCount} {guestCount === 1 ? "guest is" : "guests are"} posting without
              being formally added.
            </div>
          )}
        </div>
      )}

      <button
        ref={addTriggerRef}
        type="button"
        className="ch-members-add"
        onClick={() => setPickerOpen((v) => !v)}
        aria-label="Add member"
        aria-expanded={pickerOpen}
      >
        +
      </button>
      <AgentPicker
        agents={agents}
        excludeIds={formalMemberIds}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(agent) => void addMember(agent.id)}
        pendingId={pendingActorId}
        emptyHint="All agents already in channel."
        triggerRef={addTriggerRef}
      />
    </div>
  );
}

/* ── Roster row ── */

function RosterRow({
  member,
  removeBusy,
  onRemove,
}: {
  member: RosterMember;
  removeBusy: boolean;
  onRemove: () => void;
}) {
  const { triggerProps, popover } = useAgentHovercard<HTMLButtonElement>({ agent: member.agent });
  const initial = member.name[0]?.toUpperCase() ?? "?";

  return (
    <>
      <div className="ch-members-roster-row" data-guest={member.isMember ? undefined : "true"}>
        <button
          type="button"
          className="ch-members-roster-trigger"
          {...triggerProps}
          aria-label={`Open ${member.name} profile`}
        >
          <div className="ch-members-roster-avatar-wrap">
            <div
              className="ch-members-roster-avatar"
              style={{ background: actorColor(member.name) }}
            >
              {initial}
            </div>
            <span
              className="ch-members-roster-dot"
              style={{ background: stateColor(member.state) }}
            />
          </div>
          <div className="ch-members-roster-info">
            <span className="ch-members-roster-name">{member.name}</span>
            <span className="ch-members-roster-handle">
              @{member.handle}
              {!member.isMember && <span className="ch-members-roster-guest-tag">guest</span>}
            </span>
          </div>
          {member.state === "working" && (
            <span className="ch-members-roster-state">working</span>
          )}
        </button>
        {member.isMember && (
          <button
            type="button"
            className="ch-members-roster-remove"
            onClick={onRemove}
            disabled={removeBusy}
            aria-label={`Remove ${member.name}`}
            title={`Remove ${member.name}`}
          >
            ×
          </button>
        )}
      </div>
      {popover}
    </>
  );
}

/* ── Message row ── */

function ChannelMessageRow({
  message,
  agent,
  isYou,
  operatorName,
  showAvatar,
  showDay,
}: {
  message: Message;
  agent: Agent | null;
  isYou: boolean;
  operatorName: string;
  showAvatar: boolean;
  showDay: boolean;
}) {
  const { triggerProps, popover } = useAgentHovercard<HTMLButtonElement>({
    agent: !isYou ? agent : null,
  });

  const abs = fullTimestamp(message.createdAt);
  const displayName = isYou ? operatorName : (message.actorName ?? "?");
  const initial = (isYou ? operatorName[0] : message.actorName?.[0] ?? "?").toUpperCase();
  const color = actorColor(isYou ? operatorName : (message.actorName ?? "?"));
  const handle = isYou ? operatorName.toLowerCase() : (agent?.handle ?? null);
  const triggerable = !isYou && agent !== null;

  return (
    <div className="ch-msg-group">
      {showDay && (
        <div className="s-thread-day-divider">
          <span className="s-thread-day-line" />
          <span className="s-thread-day-label">{formatThreadDayLabel(message.createdAt)}</span>
          <span className="s-thread-day-line" />
        </div>
      )}
      <article
        id={`msg-${message.id}`}
        className={["ch-msg", showAvatar && "ch-msg--with-meta"].filter(Boolean).join(" ")}
      >
        <div className="ch-msg-meta">
          {showAvatar ? (
            <>
              {triggerable ? (
                <button
                  type="button"
                  className="ch-msg-meta-top ch-msg-meta-top--trigger"
                  {...triggerProps}
                  aria-label={`Open ${displayName} profile`}
                >
                  <div className="ch-msg-avatar" style={{ background: color }}>
                    {initial}
                  </div>
                  <span className="ch-msg-author" style={{ color }}>
                    {displayName}
                  </span>
                </button>
              ) : (
                <div className="ch-msg-meta-top">
                  <div className="ch-msg-avatar" style={{ background: color }}>
                    {initial}
                  </div>
                  <span className="ch-msg-author" style={{ color }}>
                    {displayName}
                  </span>
                </div>
              )}
              <div className="ch-msg-meta-detail">
                {handle && <span className="ch-msg-handle">@{handle}</span>}
                <span className="ch-msg-time" title={abs}>
                  {timeAgo(message.createdAt)}
                </span>
              </div>
            </>
          ) : (
            <span className="ch-msg-inline-time" title={abs}>
              {timeAgo(message.createdAt)}
            </span>
          )}
        </div>
        <div className="ch-msg-body-col">
          <div className="ch-msg-body">
            <MessageMarkup text={message.body} />
          </div>
          <MessageEmbeds message={message} />
        </div>
      </article>
      {popover}
    </div>
  );
}

/* ── Message feed + compose ── */

function ChannelFeed({
  channelId,
  channelName,
  agents,
  operatorName,
  onMessageCountChange,
  onSeenActorsChange,
}: {
  channelId: string;
  channelName: string;
  agents: Agent[];
  operatorName: string;
  onMessageCountChange: (count: number) => void;
  onSeenActorsChange?: (actors: ChannelActor[]) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
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
      const lastMessage = sorted.at(-1);
      if (lastMessage) {
        void api(`/api/conversations/${encodeURIComponent(channelId)}/read-cursor`, {
          method: "POST",
          body: JSON.stringify({ lastReadMessageId: lastMessage.id }),
        }).catch(() => {});
      }
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
      const payload = event.payload as { message?: { conversationId?: string } } | undefined;
      if (payload?.message?.conversationId === channelId) void load();
    }
  });

  useEffect(() => {
    if (messages.length === 0) return;
    const behavior = initialScrollDoneRef.current ? "smooth" : "instant";
    bottomRef.current?.scrollIntoView({ behavior });
    initialScrollDoneRef.current = true;
  }, [messages.length]);

  const seenActorsRef = useRef<ChannelActor[]>([]);
  useEffect(() => {
    if (!onSeenActorsChange) return;
    const seen = new Map<string, string>();
    for (const m of messages) {
      if (!m.actorId || m.actorId === "operator") continue;
      if (!seen.has(m.actorId)) seen.set(m.actorId, m.actorName);
    }
    const next: ChannelActor[] = Array.from(seen, ([id, name]) => ({ id, name }))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (!actorsEqual(seenActorsRef.current, next)) {
      seenActorsRef.current = next;
      onSeenActorsChange(next);
    }
  }, [messages, onSeenActorsChange]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft("");
    setError(null);
    const optimistic: Message = {
      id: `optimistic-${Date.now()}`,
      conversationId: channelId,
      actorId: "operator",
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
          const showDay = i === 0 || !isSameCalendarDay(messages[i - 1]?.createdAt, msg.createdAt);
          const showAvatar = i === 0 || messages[i - 1]?.actorName !== msg.actorName || showDay;
          const msgAgent = !isYou ? resolveMessageAgent(msg, agents) : null;
          return (
            <ChannelMessageRow
              key={msg.id}
              message={msg}
              agent={msgAgent}
              isYou={isYou}
              operatorName={operatorName}
              showAvatar={showAvatar}
              showDay={showDay}
            />
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
          <AgentMentionTextarea
            agents={agents}
            value={draft}
            onChange={setDraft}
            onSubmit={() => void send()}
            placeholder={`Message #${channelName}…`}
            rows={1}
            disabled={sending}
            textareaClassName="ch-compose-input"
          />
          <DictationMic
            onAppend={(text) =>
              setDraft((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text))
            }
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
  const { agents, route } = useScout();
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [operatorName, setOperatorName] = useState("operator");
  const machineId = routeMachineId(route);
  const scopedAgentIds = useMemo(
    () => machineScopedAgentIds(agents, machineId),
    [agents, machineId],
  );
  const scopedAgents = useMemo(
    () => filterAgentsByMachineScope(agents, machineId),
    [agents, machineId],
  );

  const channels = useMemo(
    () => filterSessionsByMachineScope(sessions, scopedAgentIds, machineId).filter(isGroupConversation),
    [sessions, scopedAgentIds, machineId],
  );

  const selectedChannel = channelId
    ? (channels.find((c) => c.id === channelId) ?? null)
    : null;

  const [seenActors, setSeenActors] = useState<ChannelActor[]>([]);
  useEffect(() => {
    setSeenActors([]);
  }, [channelId]);

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
              <MembersHeaderControl
                channel={selectedChannel}
                agents={scopedAgents}
                extraActors={seenActors}
              />
            </div>
          </div>

          <div className="ch-body">
            <ChannelFeed
              key={channelId}
              channelId={channelId!}
              channelName={conversationDisplayTitle(selectedChannel)}
              agents={scopedAgents}
              operatorName={operatorName}
              onMessageCountChange={() => { /* noop — message count no longer surfaced */ }}
              onSeenActorsChange={setSeenActors}
            />
          </div>
        </>
      ) : (
        <NoChannelSelected count={channels.length} />
      )}
    </div>
  );
}
