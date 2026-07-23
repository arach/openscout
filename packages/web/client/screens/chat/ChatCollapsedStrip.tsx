/**
 * Minimized chat side-rail content: a vertical stack of conversation chips
 * (pinned first, then recent live rooms) so collapse isn't an empty strip.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api.ts";
import {
  conversationDisplayTitle,
  isGroupConversation,
} from "../../lib/conversations.ts";
import {
  isArchived,
  isPinned,
  loadConversationPrefs,
  pinRank,
  type ConversationPrefs,
} from "../../lib/conversation-prefs.ts";
import {
  filterSessionsByMachineScope,
  machineScopedAgentIds,
} from "../../lib/machine-scope.ts";
import { routeMachineId } from "../../lib/router.ts";
import {
  isUnread,
  loadLastViewedMap,
  saveLastViewed,
  type LastViewedMap,
} from "../../lib/sessionRead.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { useScout } from "../../scout/Provider.tsx";
import type { Route, SessionEntry } from "../../lib/types.ts";
import { actorColor } from "../../lib/colors.ts";
import "./chat-collapsed-strip.css";

/** How many non-pinned chips fit in the strip before we stop. */
const RECENT_LIMIT = 10;

/** Prefer a distinguishing letter when many rooms share an agent/project name. */
function chipInitial(title: string, agentName: string | null, channel: boolean): string {
  if (channel) return "#";
  const base = (agentName ?? title).trim();
  const parts = base.split(/[\s/_-]+/).filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1]!;
    if (/^\d+$/.test(last) && parts.length >= 3) {
      return (parts[parts.length - 2]![0] ?? "?").toUpperCase();
    }
    return (last[0] ?? "?").toUpperCase();
  }
  return (base[0] ?? "?").toUpperCase();
}

export function ChatCollapsedStrip() {
  const { route, navigate, agents } = useScout();
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [prefs, setPrefs] = useState<ConversationPrefs>(() => loadConversationPrefs());
  const [lastViewed, setLastViewed] = useState<LastViewedMap>(() => loadLastViewedMap());
  const machineId = routeMachineId(route);
  const scopedAgentIds = useMemo(
    () => machineScopedAgentIds(agents, machineId),
    [agents, machineId],
  );

  const activeId =
    route.view === "messages" ? route.conversationId :
    route.view === "conversation" ? route.conversationId :
    route.view === "channels" ? route.channelId :
    undefined;

  const load = useCallback(async () => {
    try {
      const data = await api<SessionEntry[]>("/api/conversations");
      setSessions(data);
    } catch {
      // Collapsed strip is best-effort; leave last good snapshot.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useBrokerEvents((event) => {
    if (event.kind === "message.posted" || event.kind === "conversation.upserted") {
      void load();
    }
  });

  // Prefs can change while the expanded rail is open; re-read when strip mounts.
  useEffect(() => {
    setPrefs(loadConversationPrefs());
    setLastViewed(loadLastViewedMap());
  }, []);

  const chips = useMemo(() => {
    const scoped = filterSessionsByMachineScope(sessions, scopedAgentIds, machineId)
      .filter((s) => !isArchived(s.id, prefs));

    const pinned = scoped
      .filter((s) => isPinned(s.id, prefs))
      .sort((a, b) => pinRank(b.id, prefs) - pinRank(a.id, prefs) || (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));

    const pinnedIds = new Set(pinned.map((s) => s.id));
    const recent = scoped
      .filter((s) => !pinnedIds.has(s.id))
      .sort((a, b) => {
        const ua = isUnread(a.lastMessageAt, a.id, lastViewed) ? 0 : 1;
        const ub = isUnread(b.lastMessageAt, b.id, lastViewed) ? 0 : 1;
        if (ua !== ub) return ua - ub;
        return (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0);
      })
      .slice(0, RECENT_LIMIT);

    return [...pinned.map((s) => ({ session: s, pinned: true })), ...recent.map((s) => ({ session: s, pinned: false }))];
  }, [sessions, scopedAgentIds, machineId, prefs, lastViewed]);

  const open = (s: SessionEntry) => {
    setLastViewed(saveLastViewed(s.id));
    if (isGroupConversation(s)) {
      navigate({ view: "channels", channelId: s.id });
      return;
    }
    navigate({ view: "messages", conversationId: s.id } satisfies Route);
  };

  if (chips.length === 0) {
    return (
      <div className="chat-collapsed-strip chat-collapsed-strip--empty" aria-hidden>
        <span className="chat-collapsed-empty-mark">#</span>
      </div>
    );
  }

  return (
    <div className="chat-collapsed-strip" role="list" aria-label="Recent chats">
      {chips.map(({ session: s, pinned }) => {
        const title = conversationDisplayTitle(s);
        const channel = isGroupConversation(s);
        const unread = isUnread(s.lastMessageAt, s.id, lastViewed);
        const active = s.id === activeId;
        const initial = chipInitial(title, s.agentName, channel);
        return (
          <button
            key={s.id}
            type="button"
            role="listitem"
            className={[
              "chat-collapsed-chip",
              channel && "chat-collapsed-chip--channel",
              active && "chat-collapsed-chip--active",
              unread && "chat-collapsed-chip--unread",
              pinned && "chat-collapsed-chip--pinned",
            ]
              .filter(Boolean)
              .join(" ")}
            title={pinned ? `${title} · pinned` : title}
            aria-label={pinned ? `${title}, pinned` : title}
            aria-current={active ? "page" : undefined}
            onClick={() => open(s)}
          >
            {channel ? (
              <span className="chat-collapsed-hash">#</span>
            ) : (
              <span
                className="chat-collapsed-ava"
                style={{ background: actorColor(s.agentName ?? title) }}
              >
                {initial}
              </span>
            )}
            {unread ? <span className="chat-collapsed-dot" aria-hidden /> : null}
            {pinned ? <span className="chat-collapsed-pin" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}
