/**
 * Minimized chat side-rail: pinned then recent conversation chips.
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
import {
  chipInitial,
  CollapsedChip,
  CollapsedStrip,
} from "../../scout/sidebar/CollapsedStrip.tsx";

const RECENT_LIMIT = 10;

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
      // best-effort
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

    return [
      ...pinned.map((s) => ({ session: s, pinned: true })),
      ...recent.map((s) => ({ session: s, pinned: false })),
    ];
  }, [sessions, scopedAgentIds, machineId, prefs, lastViewed]);

  const open = (s: SessionEntry) => {
    setLastViewed(saveLastViewed(s.id));
    if (isGroupConversation(s)) {
      navigate({ view: "channels", channelId: s.id });
      return;
    }
    navigate({ view: "messages", conversationId: s.id } satisfies Route);
  };

  return (
    <CollapsedStrip label="Chat" emptyMark="#">
      {chips.map(({ session: s, pinned }) => {
        const title = conversationDisplayTitle(s);
        const channel = isGroupConversation(s);
        const unread = isUnread(s.lastMessageAt, s.id, lastViewed);
        return (
          <CollapsedChip
            key={s.id}
            title={pinned ? `${title} · pinned` : title}
            active={s.id === activeId}
            tone={channel ? "channel" : unread ? "unread" : "default"}
            ava={channel ? undefined : chipInitial(s.agentName ?? title)}
            avaColor={channel ? undefined : actorColor(s.agentName ?? title)}
            glyph={channel ? "#" : undefined}
            dot={unread ? "unread" : null}
            pinned={pinned}
            onClick={() => open(s)}
          />
        );
      })}
    </CollapsedStrip>
  );
}
