import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { timeAgo } from "../lib/time.ts";
import { actorColor } from "../lib/colors.ts";
import { plainPreview } from "../lib/preview.ts";
import {
  loadLastViewedMap,
  saveLastViewed,
  isUnread,
  type LastViewedMap,
} from "../lib/sessionRead.ts";
import { navigateUnlessSelected } from "../lib/selection.ts";
import { useContextMenu, type MenuItem } from "../components/ContextMenu.tsx";
import type { SessionEntry, Route } from "../lib/types.ts";
import "./inbox-thread-redesign.css";

const KIND_LABELS: Record<string, string> = {
  direct: "DM",
  channel: "Channel",
  group_direct: "Group",
  thread: "Thread",
};

type KindFilter = "all" | "direct" | "channel" | "group_direct" | "thread";

const VALID_KINDS = new Set<KindFilter>(["all", "direct", "channel", "group_direct", "thread"]);

function readParam(name: string): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get(name) ?? "";
}

function writeParams(updates: Record<string, string | null>) {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(updates)) {
    if (v === null || v === "") p.delete(k);
    else p.set(k, v);
  }
  const qs = p.toString();
  window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
}

function readKindFilter(): KindFilter {
  const v = readParam("view");
  return VALID_KINDS.has(v as KindFilter) ? (v as KindFilter) : "all";
}

function deriveDisplayTitle(session: SessionEntry): string {
  if (session.kind === "direct" && session.agentName) return session.agentName;
  return session.title.replace(/\s*<>\s*/g, " · ");
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}

function sessionSearchFields(session: SessionEntry): string[] {
  return [
    session.id,
    session.title,
    session.preview ?? "",
    session.agentName ?? "",
    session.harness ?? "",
    session.harnessSessionId ?? "",
    session.harnessLogPath ?? "",
    ...session.participantIds,
  ];
}

function matchedHarnessSessionId(session: SessionEntry, query: string): string | null {
  if (!query) {
    return null;
  }
  const harnessSessionId = session.harnessSessionId?.trim();
  if (!harnessSessionId) {
    return null;
  }
  return harnessSessionId.toLowerCase().includes(query) ? harnessSessionId : null;
}

function pathLeaf(path: string | null | undefined): string | null {
  if (!path) return null;
  const normalized = path.replace(/[\\/]+$/, "");
  if (!normalized) return null;
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? normalized;
}

function formatAbsoluteTimestamp(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "";
  const normalized = value < 1e12 ? value * 1000 : value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(normalized);
}

export function SessionsScreen({ navigate }: { navigate: (r: Route) => void }) {
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [filter, setFilter] = useState<KindFilter>(() => readKindFilter());
  const [query, setQuery] = useState<string>(() => readParam("q"));
  const [unreadOnly, setUnreadOnly] = useState<boolean>(() => readParam("unread") === "1");
  const [lastViewed, setLastViewed] = useState<LastViewedMap>(() => loadLastViewedMap());
  const [selectedIdx, setSelectedIdx] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const showContextMenu = useContextMenu();

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api<SessionEntry[]>("/api/sessions");
      setSessions(data.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useBrokerEvents(() => {
    void load();
  });

  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    writeParams({
      view: filter === "all" ? null : filter,
      q: query.trim() || null,
      unread: unreadOnly ? "1" : null,
    });
  }, [filter, query, unreadOnly]);

  const kinds = useMemo(
    () => Array.from(new Set(sessions.map((s) => s.kind))),
    [sessions],
  );

  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = { all: sessions.length };
    for (const s of sessions) counts[s.kind] = (counts[s.kind] ?? 0) + 1;
    return counts;
  }, [sessions]);

  const normalizedQuery = useMemo(() => normalizeQuery(query), [query]);

  const unreadCount = useMemo(
    () => sessions.filter((s) => isUnread(s.lastMessageAt, s.id, lastViewed)).length,
    [sessions, lastViewed],
  );

  const filtered = useMemo(() => {
    return sessions.filter((s) => {
      if (filter !== "all" && s.kind !== filter) return false;
      if (unreadOnly && !isUnread(s.lastMessageAt, s.id, lastViewed)) return false;
      if (normalizedQuery) {
        const matches = sessionSearchFields(s).some((field) =>
          field.toLowerCase().includes(normalizedQuery)
        );
        if (!matches) return false;
      }
      return true;
    });
  }, [sessions, filter, unreadOnly, lastViewed, normalizedQuery]);

  useEffect(() => {
    if (selectedIdx >= filtered.length) setSelectedIdx(Math.max(0, filtered.length - 1));
  }, [filtered.length, selectedIdx]);

  const openSession = useCallback(
    (session: SessionEntry, options: { observe?: boolean } = {}) => {
      setLastViewed(saveLastViewed(session.id));
      if (options.observe && session.agentId) {
        navigate({
          view: "agents",
          agentId: session.agentId,
          conversationId: session.id,
          tab: "observe",
        });
        return;
      }
      navigate({ view: "conversation", conversationId: session.id });
    },
    [navigate],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tgt = e.target;
      const inInput =
        tgt instanceof HTMLInputElement ||
        tgt instanceof HTMLTextAreaElement ||
        (tgt instanceof HTMLElement && tgt.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (inInput) {
        if (e.key === "Escape" && tgt === searchRef.current) {
          searchRef.current?.blur();
        }
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(filtered.length - 1, i + 1));
        return;
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === "Enter" || e.key === "o") {
        const session = filtered[selectedIdx];
        if (session) {
          e.preventDefault();
          openSession(session, {
            observe: Boolean(matchedHarnessSessionId(session, normalizedQuery)),
          });
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, selectedIdx, openSession, normalizedQuery]);

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selectedIdx}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  const showKindFilter = kinds.length > 1;
  const activeKindLabel = filter === "all" ? "All sessions" : (KIND_LABELS[filter] ?? filter);
  const scopeSummary = unreadOnly
    ? (unreadCount > 0 ? `${unreadCount} unread threads need attention.` : "No unread threads right now.")
    : (filtered.length === sessions.length
      ? "Recent activity across every conversation."
      : `${filtered.length} conversations match the current filters.`);

  return (
    <div className="s-sessions-screen s-inbox-thread-redesign">
      <section className="s-thread-overview">
        <div className="s-thread-overview-copy">
          <div className="s-sessions-header s-thread-overview-heading">
            <h2 className="s-page-title">Sessions</h2>
            <span className="s-meta s-tabular">{filtered.length} of {sessions.length}</span>
          </div>
          <p className="s-thread-overview-summary">{scopeSummary}</p>
        </div>
      </section>

      <section className="s-thread-panel s-thread-panel-list">

        <div className="s-sessions-toolbar">
          {showKindFilter && (
            <div className="s-seg" role="tablist" aria-label="Session kind">
              <SegBtn
                label="All"
                count={kindCounts.all}
                pressed={filter === "all"}
                onClick={() => setFilter("all")}
              />
              {kinds.map((k) => (
                <SegBtn
                  key={k}
                  label={KIND_LABELS[k] ?? k}
                  count={kindCounts[k] ?? 0}
                  pressed={filter === k}
                  onClick={() => setFilter(k as KindFilter)}
                />
              ))}
            </div>
          )}

          <button
            type="button"
            className={`s-seg-standalone${unreadOnly ? " is-on" : ""}`}
            onClick={() => setUnreadOnly((v) => !v)}
            aria-pressed={unreadOnly}
            title="Show unread only"
          >
            <span className="s-dot s-dot-sm" aria-hidden="true" />
            <span>Unread</span>
            {unreadCount > 0 && <span className="s-seg-count">{unreadCount}</span>}
          </button>

          <div className="s-search">
            <input
              ref={searchRef}
              type="text"
              className="s-search-input"
              placeholder="Search conversations or session IDs…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  if (query) {
                    setQuery("");
                  } else {
                    (e.target as HTMLInputElement).blur();
                  }
                }
              }}
            />
            <kbd className="s-search-kbd">⌘K</kbd>
          </div>
        </div>

        {error && <p className="s-error">{error}</p>}

        {filtered.length === 0 ? (
          <div className="s-empty s-thread-empty-state">
            <p>{query || unreadOnly ? "No matches" : "No conversations"}</p>
            <p>
              {query
                ? "Try a different search term."
                : unreadOnly
                  ? "You're all caught up."
                  : "Conversations appear here when agents communicate."}
            </p>
          </div>
        ) : (
          <div className="s-inbox" ref={listRef} role="listbox" aria-label="Sessions">
            {filtered.map((session, idx) => {
              const displayTitle = deriveDisplayTitle(session);
              const initial =
                (session.agentName ?? displayTitle)[0]?.toUpperCase() ?? "?";
              const unread = isUnread(session.lastMessageAt, session.id, lastViewed);
              const selected = idx === selectedIdx;
              const preview = plainPreview(session.preview, 160);
              const kindLabel = KIND_LABELS[session.kind] ?? session.kind;
              const workspaceName = pathLeaf(session.workspaceRoot);
              const sessionIdMatch = matchedHarnessSessionId(session, normalizedQuery);

              return (
                <div
                  key={session.id}
                  data-idx={idx}
                  data-unread={unread ? "true" : "false"}
                  data-selected={selected ? "true" : "false"}
                  className="s-inbox-row"
                  role="option"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => {
                    navigateUnlessSelected(() => {
                      setSelectedIdx(idx);
                      openSession(session, {
                        observe: Boolean(sessionIdMatch),
                      });
                    });
                  }}
                  onMouseEnter={() => setSelectedIdx(idx)}
                  onContextMenu={(e) => {
                    const sel = window.getSelection()?.toString().trim();
                    const items: MenuItem[] = [];
                    if (sel) {
                      items.push({ kind: "action", label: "Copy Selection", shortcut: "⌘C", onSelect: () => navigator.clipboard.writeText(sel) });
                      items.push({ kind: "separator" });
                    }
                    items.push({ kind: "action", label: "Open Conversation", onSelect: () => openSession(session) });
                    if (session.agentId) {
                      items.push({
                        kind: "action",
                        label: "Open Observe",
                        onSelect: () => openSession(session, { observe: true }),
                      });
                    }
                    items.push({ kind: "action", label: "Copy Title", onSelect: () => navigator.clipboard.writeText(displayTitle) });
                    if (session.id) {
                      items.push({ kind: "action", label: "Copy Conversation ID", onSelect: () => navigator.clipboard.writeText(session.id) });
                    }
                    const harnessSessionId = session.harnessSessionId;
                    if (harnessSessionId) {
                      items.push({
                        kind: "action",
                        label: "Copy Harness Session ID",
                        onSelect: () => navigator.clipboard.writeText(harnessSessionId),
                      });
                    }
                    showContextMenu(e, items);
                  }}
                >
                  <div className="s-session-avatar-wrap">
                    <div
                      className="s-avatar"
                      style={{ background: actorColor(session.agentName ?? displayTitle) }}
                      aria-hidden="true"
                    >
                      {initial}
                    </div>
                    {unread && <span className="s-session-unread-dot" aria-hidden="true" />}
                  </div>

                  <div className="s-inbox-body">
                    <div className="s-inbox-header">
                      <div className="s-session-heading">
                        <span className="s-inbox-name" title={displayTitle}>
                          {displayTitle}
                        </span>
                      </div>

                      <div className="s-session-trailing">
                        {session.lastMessageAt && (
                          <span
                            className="s-inbox-time s-tabular"
                            title={formatAbsoluteTimestamp(session.lastMessageAt)}
                          >
                            {timeAgo(session.lastMessageAt)}
                          </span>
                        )}
                      </div>
                    </div>

                    {preview ? (
                      <p className="s-inbox-preview">{preview}</p>
                    ) : (
                      <p className="s-inbox-preview s-inbox-preview-empty">No messages yet</p>
                    )}

                    <div className="s-session-meta-row" aria-label="Conversation details">
                      <span className="s-session-pill">{kindLabel}</span>
                      {sessionIdMatch && (
                        <span
                          className="s-session-pill"
                          title={sessionIdMatch}
                        >
                          session · {sessionIdMatch}
                        </span>
                      )}
                      {workspaceName && (
                        <span
                          className="s-session-pill"
                          title={session.workspaceRoot ?? undefined}
                        >
                          {workspaceName}
                        </span>
                      )}
                      {session.currentBranch && (
                        <span className="s-session-pill" title={session.currentBranch}>
                          {session.currentBranch}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function SegBtn({
  label,
  count,
  pressed,
  onClick,
}: {
  label: string;
  count: number;
  pressed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="s-seg-btn"
      aria-pressed={pressed}
      onClick={onClick}
    >
      <span>{label}</span>
      <span className="s-seg-count">{count}</span>
    </button>
  );
}
