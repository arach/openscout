import { useCallback, useEffect, useMemo, useState } from "react";
import "./ctx-panel.css";
import { api } from "../../lib/api.ts";
import { actorColor } from "../../lib/colors.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { timeAgo } from "../../lib/time.ts";
import {
  isUnread,
  loadLastViewedMap,
  saveLastViewed,
  type LastViewedMap,
} from "../../lib/sessionRead.ts";
import { useScout } from "../Provider.tsx";
import type { SessionEntry } from "../../lib/types.ts";

type Filter = "all" | "dm" | "channel";

function isDm(s: SessionEntry): boolean {
  return s.kind === "direct";
}

function isChannel(s: SessionEntry): boolean {
  return s.kind === "channel" || s.id.startsWith("channel.");
}

function deriveTitle(s: SessionEntry): string {
  if (s.title && s.title !== s.id) return s.title;
  if (isChannel(s)) return s.id.replace(/^channel\./, "");
  return s.agentName ?? s.id;
}

export function ScoutConversationLeftPanel() {
  const { route, navigate } = useScout();
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [lastViewed, setLastViewed] = useState<LastViewedMap>(() => loadLastViewedMap());
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const activeId =
    route.view === "conversation" ? route.conversationId :
    route.view === "agent-info" ? route.conversationId :
    route.view === "agents" ? route.conversationId :
    undefined;

  const load = useCallback(async () => {
    const data = await api<SessionEntry[]>("/api/sessions").catch(() => [] as SessionEntry[]);
    setSessions(data);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useBrokerEvents((event) => {
    if (event.kind === "message.posted" || event.kind === "conversation.upserted") {
      void load();
    }
  });

  const filtered = useMemo(() => {
    let list = sessions;
    if (filter === "dm") list = list.filter(isDm);
    else if (filter === "channel") list = list.filter(isChannel);
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((s) => deriveTitle(s).toLowerCase().includes(q) || s.id.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
  }, [sessions, filter, query]);

  const onSelect = (s: SessionEntry) => {
    setLastViewed(saveLastViewed(s.id));
    if (isChannel(s)) {
      navigate({ view: "channels", channelId: s.id });
    } else {
      navigate({ view: "conversation", conversationId: s.id });
    }
  };

  return (
    <div className="ctx-panel">
      <div className="ctx-panel-tabs">
        {(["all", "dm", "channel"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            className={["ctx-panel-tab", filter === f && "ctx-panel-tab--active"].filter(Boolean).join(" ")}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : f === "dm" ? "DMs" : "Channels"}
          </button>
        ))}
      </div>

      <div className="ctx-panel-search">
        <input
          type="text"
          className="ctx-panel-search-input"
          placeholder="Filter…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="ctx-panel-list ctx-panel-list--scroll">
        {filtered.length === 0 ? (
          <div className="ctx-panel-empty">{query ? "No match" : "Nothing yet"}</div>
        ) : (
          filtered.map((s) => {
            const active = s.id === activeId;
            const unread = isUnread(s.lastMessageAt, s.id, lastViewed);
            const title = deriveTitle(s);
            const channel = isChannel(s);
            return (
              <button
                key={s.id}
                type="button"
                className={[
                  "ctx-panel-item",
                  active && "ctx-panel-item--active",
                  unread && "ctx-panel-item--unread",
                ].filter(Boolean).join(" ")}
                onClick={() => onSelect(s)}
              >
                {channel ? (
                  <div className="ctx-panel-hash">#</div>
                ) : (
                  <div
                    className="ctx-panel-avatar"
                    style={{ background: actorColor(s.agentName ?? title) }}
                  >
                    {title[0]?.toUpperCase() ?? "?"}
                  </div>
                )}
                <div className="ctx-panel-body">
                  <span className="ctx-panel-name">{title}</span>
                  {s.preview && <span className="ctx-panel-preview">{s.preview}</span>}
                </div>
                <div className="ctx-panel-trailing">
                  {s.lastMessageAt && <span className="ctx-panel-time">{timeAgo(s.lastMessageAt)}</span>}
                  {unread && <span className="ctx-panel-dot" />}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
