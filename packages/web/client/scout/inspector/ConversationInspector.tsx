import { ScrollText } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useScout } from "../Provider.tsx";
import { openContent } from "../slots/openContent.ts";
import { api } from "../../lib/api.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { useTailEvents } from "../../lib/tail-events.ts";
import { agentStateLabel, normalizeAgentState } from "../../lib/agent-state.ts";
import { stateColor } from "../../lib/colors.ts";
import { AgentLiveActions } from "../../components/AgentLiveActions.tsx";
import {
  compactAgentId,
  minimalAgentDisplayName,
  minimalAgentHandle,
} from "../../lib/agent-labels.ts";
import { formatAbsoluteTimestamp, timeAgo } from "../../lib/time.ts";
import { agentIdFromConversation } from "../../lib/router.ts";
import { isActiveConversationFlight } from "../../lib/conversations.ts";
import {
  buildTailRouteQuery,
  buildTailPreviewContext,
  compactSessionId,
  mergeTailPreviewEvents,
  tailEventMatchesContext,
  tailKindLabel,
  tailSummary,
} from "../../lib/tail-preview.ts";
import { TmuxPeekPanel } from "./TmuxPeek.tsx";
import type {
  Flight,
  Message,
  SessionCatalogWithResume,
  SessionEntry,
  TailEvent,
} from "../../lib/types.ts";

const KIND_LABELS: Record<string, string> = {
  direct: "Conversation",
  channel: "Conversation",
  group_direct: "Conversation",
  thread: "Thread",
};

const TAIL_PREVIEW_INITIAL_FRAME_SIZE = 6;
const TAIL_PREVIEW_PLAYBACK_BATCH_SIZE = 3;
const TAIL_PREVIEW_PLAYBACK_MS = 420;

function pathLeaf(path: string | null | undefined): string | null {
  if (!path) return null;
  const normalized = path.replace(/[\\/]+$/, "");
  if (!normalized) return null;
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? normalized;
}

function flightStateLabel(state: string): string {
  switch (state) {
    case "queued": return "Queued";
    case "waking": return "Waking";
    case "waiting": return "Thinking";
    case "running": return "Working";
    default: return state.replace(/_/g, " ");
  }
}

export function ConversationInspector() {
  const { route, agents, navigate } = useScout();
  const conversationId =
    route.view === "conversation" ? route.conversationId : null;

  const [meta, setMeta] = useState<SessionEntry | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [latestMessage, setLatestMessage] = useState<Message | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!conversationId) {
      setMeta(null);
      setFlights([]);
      setLatestMessage(null);
      setLoaded(true);
      return;
    }
    try {
      const [sessionMeta, activeFlights, recentMessages] = await Promise.all([
        api<SessionEntry>(
          `/api/session/${encodeURIComponent(conversationId)}`,
        ).catch(() => null),
        api<Flight[]>(
          `/api/flights?conversationId=${encodeURIComponent(conversationId)}`,
        ).catch(() => [] as Flight[]),
        api<Message[]>(
          `/api/messages?conversationId=${encodeURIComponent(conversationId)}&limit=1`,
        ).catch(() => [] as Message[]),
      ]);
      setMeta(sessionMeta);
      setFlights(activeFlights ?? []);
      setLatestMessage(recentMessages?.[recentMessages.length - 1] ?? null);
      setLoaded(true);
    } catch {
      setLoaded(true);
    }
  }, [conversationId]);

  useEffect(() => {
    setLoaded(false);
    void load();
  }, [load]);

  useBrokerEvents((event) => {
    if (!conversationId) return;
    if (event.kind === "message.posted") {
      const payload = event.payload as
        | { message?: { conversationId?: string } }
        | undefined;
      if (payload?.message?.conversationId === conversationId) void load();
      return;
    }
    if (
      event.kind === "flight.updated" ||
      event.kind === "invocation.requested"
    ) {
      void load();
    }
  });

  const agentId = meta?.agentId ?? agentIdFromConversation(conversationId ?? "");
  const agent = useMemo(
    () => (agentId ? agents.find((a) => a.id === agentId) ?? null : null),
    [agents, agentId],
  );
  const [catalog, setCatalog] = useState<SessionCatalogWithResume | null>(null);
  const [tailPreviewEvents, setTailPreviewEvents] = useState<TailEvent[]>([]);
  const [visibleTailPreviewEvents, setVisibleTailPreviewEvents] = useState<TailEvent[]>([]);
  const visibleTailPreviewEventsRef = useRef<TailEvent[]>([]);
  const tailPlaybackPendingRef = useRef<TailEvent[]>([]);
  const tailPlaybackTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setCatalog(null);
    if (!agentId) return;
    let cancelled = false;
    api<SessionCatalogWithResume>(`/api/agents/${encodeURIComponent(agentId)}/session-catalog`)
      .then((result) => {
        if (!cancelled) setCatalog(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const agentName = minimalAgentDisplayName({
    name: agent?.name,
    agentName: meta?.agentName,
    id: agentId,
    title: meta?.title,
  });
  const agentHandle = agent
    ? minimalAgentHandle(agent) ?? compactAgentId(agent.id) ?? agent.id
    : agentId
      ? compactAgentId(agentId) ?? agentId
      : null;
  const activeFlight = useMemo(
    () =>
      flights
        .filter(isActiveConversationFlight)
        .sort((l, r) => (r.startedAt ?? 0) - (l.startedAt ?? 0))[0] ?? null,
    [flights],
  );
  const activeSessionId = catalog?.activeSessionId ?? agent?.harnessSessionId ?? meta?.harnessSessionId ?? null;
  const tailPreviewContext = useMemo(
    () => buildTailPreviewContext({ activeSessionId, agent, sessionMeta: meta }),
    [activeSessionId, agent, meta],
  );
  const tailPreviewScopeKey = JSON.stringify({
    sessionIds: tailPreviewContext.sessionIds,
    paths: tailPreviewContext.paths,
    projects: tailPreviewContext.projects,
  });
  const hasTailPreviewScope =
    tailPreviewContext.sessionIds.length > 0 ||
    tailPreviewContext.paths.length > 0 ||
    tailPreviewContext.projects.length > 0;

  const stopTailPlayback = useCallback(() => {
    if (tailPlaybackTimerRef.current !== null) {
      window.clearInterval(tailPlaybackTimerRef.current);
      tailPlaybackTimerRef.current = null;
    }
    tailPlaybackPendingRef.current = [];
  }, []);

  const scheduleTailPlayback = useCallback(() => {
    if (tailPlaybackTimerRef.current !== null) return;
    tailPlaybackTimerRef.current = window.setInterval(() => {
      const nextBatch = tailPlaybackPendingRef.current.slice(0, TAIL_PREVIEW_PLAYBACK_BATCH_SIZE);
      tailPlaybackPendingRef.current = tailPlaybackPendingRef.current.slice(TAIL_PREVIEW_PLAYBACK_BATCH_SIZE);
      if (nextBatch.length === 0) {
        stopTailPlayback();
        return;
      }
      setVisibleTailPreviewEvents((previous) => mergeTailPreviewEvents(previous, nextBatch));
    }, TAIL_PREVIEW_PLAYBACK_MS);
  }, [stopTailPlayback]);

  useEffect(() => {
    visibleTailPreviewEventsRef.current = visibleTailPreviewEvents;
  }, [visibleTailPreviewEvents]);

  useEffect(() => stopTailPlayback, [stopTailPlayback]);

  useEffect(() => {
    stopTailPlayback();
    setTailPreviewEvents([]);
    setVisibleTailPreviewEvents([]);
  }, [stopTailPlayback, tailPreviewScopeKey]);

  useEffect(() => {
    if (!hasTailPreviewScope) return;
    let cancelled = false;
    const params = new URLSearchParams({ limit: "180", transcripts: "true" });
    api<{ events: TailEvent[] }>(`/api/tail/recent?${params.toString()}`)
      .then((result) => {
        if (cancelled) return;
        const matched = (result.events ?? []).filter((event) =>
          tailEventMatchesContext(event, tailPreviewContext),
        );
        setTailPreviewEvents(mergeTailPreviewEvents([], matched));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [hasTailPreviewScope, tailPreviewScopeKey]);

  useTailEvents(
    useCallback(
      (event) => {
        if (!hasTailPreviewScope) return;
        if (!tailEventMatchesContext(event, tailPreviewContext)) return;
        setTailPreviewEvents((previous) => mergeTailPreviewEvents(previous, [event]));
      },
      [hasTailPreviewScope, tailPreviewScopeKey],
    ),
  );

  useEffect(() => {
    if (tailPreviewEvents.length === 0) {
      stopTailPlayback();
      setVisibleTailPreviewEvents([]);
      return;
    }

    const visible = visibleTailPreviewEventsRef.current;
    const knownIds = new Set([
      ...visible.map((event) => event.id),
      ...tailPlaybackPendingRef.current.map((event) => event.id),
    ]);
    const incoming = tailPreviewEvents.filter((event) => !knownIds.has(event.id));
    if (incoming.length === 0) return;

    if (visible.length === 0) {
      const immediate = incoming.slice(0, TAIL_PREVIEW_INITIAL_FRAME_SIZE);
      const deferred = incoming.slice(TAIL_PREVIEW_INITIAL_FRAME_SIZE);
      setVisibleTailPreviewEvents(mergeTailPreviewEvents([], immediate));
      tailPlaybackPendingRef.current = mergeTailPreviewEvents(
        tailPlaybackPendingRef.current,
        deferred,
      );
    } else {
      tailPlaybackPendingRef.current = mergeTailPreviewEvents(
        tailPlaybackPendingRef.current,
        incoming,
      );
    }

    if (tailPlaybackPendingRef.current.length > 0) {
      scheduleTailPlayback();
    }
  }, [scheduleTailPlayback, stopTailPlayback, tailPreviewEvents]);

  if (!conversationId) return null;

  if (!loaded) {
    return (
      <div className="ctx-panel ctx-panel--conversation">
        <div className="ctx-panel-empty-state">
          <div className="ctx-panel-empty-hint">Loading conversation…</div>
        </div>
      </div>
    );
  }

  const kindLabel = meta?.kind ? KIND_LABELS[meta.kind] ?? meta.kind : "Conversation";
  const workspaceName = pathLeaf(meta?.workspaceRoot ?? null);
  const branch = meta?.currentBranch ?? null;
  const harness = agent?.harness ?? meta?.harness ?? null;
  const lastAt = meta?.lastMessageAt ?? latestMessage?.createdAt ?? null;
  const messageCount = meta?.messageCount ?? null;
  const participantCount = meta
    ? meta.participantIds.filter((id) => id !== "operator").length + 1
    : null;
  const agentState = agent?.state ?? null;
  const agentStateNormalized = normalizeAgentState(agentState);
  const preview =
    latestMessage?.body?.trim() || meta?.preview?.trim() || null;
  const previewActor = latestMessage?.actorName ?? null;
  const liveSessionLabel = compactSessionId(activeSessionId);
  const showTmuxPeek = Boolean(agent && agent.transport === "tmux");
  const liveSummary = activeFlight?.summary?.trim()
    ?? (activeSessionId && !showTmuxPeek
      ? "Terminal session is live."
      : visibleTailPreviewEvents.length > 0 && !showTmuxPeek
        ? "Streaming matching Tail events."
        : null);
  const tailRouteQuery = buildTailRouteQuery(tailPreviewContext, tailPreviewEvents);
  const showLiveActivity = Boolean(agent && (activeFlight || activeSessionId || tailPreviewEvents.length > 0 || showTmuxPeek));
  const showTailStream = visibleTailPreviewEvents.length > 0 || !showTmuxPeek;

  const goToAgentProfile = () => {
    if (!agentId) return;
    openContent(
      navigate,
      { view: "agent-info", conversationId },
      { returnTo: route },
    );
  };

  const goToTail = () => {
    openContent(
      navigate,
      {
        view: "ops",
        mode: "tail",
        ...(tailRouteQuery ? { tailQuery: tailRouteQuery } : {}),
      },
      { returnTo: route },
    );
  };

  return (
    <div className="ctx-panel ctx-panel--conversation">
      <section className="ctx-panel-section ctx-panel-conversation-summary">
        <div className="ctx-panel-section-label">{kindLabel}</div>
        <div className="ctx-panel-conversation-card">
          <div className="ctx-panel-conversation-title">
            {agentName}
          </div>
          {agentHandle && (
            <div className="ctx-panel-conversation-handle">@{agentHandle}</div>
          )}
          <div className="ctx-panel-conversation-state">
            <span
              className="ctx-panel-conversation-state-dot"
              style={{ background: stateColor(agentState) }}
            />
            <span>{agentStateLabel(agentState)}</span>
          </div>
        </div>
      </section>

      {activeFlight && (
        <section className="ctx-panel-section">
          <div className="ctx-panel-section-label">Now</div>
          <div className="ctx-panel-conversation-flight">
            <div className="ctx-panel-conversation-flight-row">
              <span className="ctx-panel-conversation-flight-label">
                {flightStateLabel(activeFlight.state)}
              </span>
              {activeFlight.startedAt && (
                <span className="ctx-panel-conversation-flight-time">
                  {timeAgo(activeFlight.startedAt)}
                </span>
              )}
            </div>
            {activeFlight.summary && (
              <div className="ctx-panel-conversation-flight-summary">
                {activeFlight.summary}
              </div>
            )}
          </div>
        </section>
      )}

      <section className="ctx-panel-section">
        <div className="ctx-panel-section-label">Workspace</div>
        <div className="ctx-panel-conversation-rows">
          {workspaceName && (
            <Row
              label="Project"
              value={workspaceName}
              title={meta?.workspaceRoot ?? undefined}
            />
          )}
          {branch && <Row label="Branch" value={branch} />}
          {harness && <Row label="Harness" value={harness} />}
          {!workspaceName && !branch && !harness && (
            <div className="ctx-panel-empty">No workspace metadata yet</div>
          )}
        </div>
      </section>

      <section className="ctx-panel-section">
        <div className="ctx-panel-section-label">Activity</div>
        <div className="ctx-panel-conversation-rows">
          {typeof messageCount === "number" && (
            <Row label="Messages" value={`${messageCount}`} />
          )}
          {typeof participantCount === "number" && (
            <Row label="In conversation" value={`${participantCount}`} />
          )}
          {lastAt && (
            <Row
              label="Last"
              value={timeAgo(lastAt) ?? ""}
              title={formatAbsoluteTimestamp(lastAt)}
            />
          )}
          {agentStateNormalized && (
            <Row label="Agent" value={agentStateLabel(agentState)} />
          )}
        </div>
      </section>

      {preview && (
        <section className="ctx-panel-section ctx-panel-conversation-preview">
          <div className="ctx-panel-section-label">
            {previewActor ? `Latest · ${previewActor}` : "Latest"}
          </div>
          <div className="ctx-panel-conversation-preview-body">{preview}</div>
        </section>
      )}

      {showLiveActivity && agent && (
        <section className="ctx-panel-section ctx-panel-conversation-live-section">
          <div className="ctx-panel-section-label">
            <span>Live activity</span>
            {liveSessionLabel && (
              <span className="ctx-panel-live-session" title={activeSessionId ?? undefined}>
                {liveSessionLabel}
              </span>
            )}
          </div>
          <div className="ctx-panel-live-card">
            <AgentLiveActions
              agent={agent}
              catalog={catalog}
              navigate={navigate}
              returnTo={route}
              variant="compact"
              className="ctx-panel-live-actions"
            />
            {liveSummary && (
              <div className="ctx-panel-live-summary">{liveSummary}</div>
            )}
            {showTmuxPeek && (
              <TmuxPeekPanel agentId={agent.id} lines={44} columns={132} />
            )}
            {showTailStream && (
              <div className="ctx-panel-live-stream" aria-live="polite">
                {visibleTailPreviewEvents.length > 0 ? (
                  <ol className="ctx-panel-live-events">
                    {visibleTailPreviewEvents.map((event) => (
                      <li key={event.id} className="ctx-panel-live-event">
                        <span className="ctx-panel-live-event-kind">
                          {tailKindLabel(event.kind)}
                        </span>
                        <span className="ctx-panel-live-event-summary">
                          {tailSummary(event.summary)}
                        </span>
                        <span
                          className="ctx-panel-live-event-time"
                          title={formatAbsoluteTimestamp(event.ts)}
                        >
                          {timeAgo(event.ts)}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <div className="ctx-panel-live-stream-empty">
                    Waiting for matching Tail events
                  </div>
                )}
              </div>
            )}
            {hasTailPreviewScope && (
              <button
                type="button"
                className="ctx-panel-live-tail-button"
                onClick={goToTail}
                title={tailRouteQuery ? `Tail filter: ${tailRouteQuery}` : "Open Tail"}
              >
                <ScrollText size={13} strokeWidth={1.9} aria-hidden="true" />
                <span>Tail</span>
              </button>
            )}
          </div>
        </section>
      )}

      {agentId && (
        <section className="ctx-panel-section ctx-panel-conversation-profile-section">
          <button
            type="button"
            className="ctx-panel-roster-button ctx-panel-conversation-profile-button"
            onClick={goToAgentProfile}
          >
            <span className="ctx-panel-roster-label">Open agent profile</span>
            <span className="ctx-panel-roster-count">
              <span>→</span>
            </span>
          </button>
        </section>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string;
}) {
  return (
    <div className="ctx-panel-conversation-row" title={title}>
      <span className="ctx-panel-conversation-row-label">{label}</span>
      <span className="ctx-panel-conversation-row-value">{value}</span>
    </div>
  );
}
