import { ScrollText } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  const hasTailPreviewScope =
    tailPreviewContext.sessionIds.length > 0 ||
    tailPreviewContext.paths.length > 0 ||
    tailPreviewContext.projects.length > 0;

  useEffect(() => {
    setTailPreviewEvents([]);
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
  }, [hasTailPreviewScope, tailPreviewContext]);

  useTailEvents(
    useCallback(
      (event) => {
        if (!hasTailPreviewScope) return;
        if (!tailEventMatchesContext(event, tailPreviewContext)) return;
        setTailPreviewEvents((previous) => mergeTailPreviewEvents(previous, [event]));
      },
      [hasTailPreviewScope, tailPreviewContext],
    ),
  );

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
  const liveSummary = activeFlight?.summary?.trim()
    ?? (activeSessionId
      ? "Terminal session is live."
      : tailPreviewEvents.length > 0
        ? "Streaming matching Tail events."
        : null);
  const tailRouteQuery = buildTailRouteQuery(tailPreviewContext, tailPreviewEvents);
  const showLiveActivity = Boolean(agent && (activeFlight || activeSessionId || tailPreviewEvents.length > 0));

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
            <div className="ctx-panel-live-stream" aria-live="polite">
              {tailPreviewEvents.length > 0 ? (
                <ol className="ctx-panel-live-events">
                  {tailPreviewEvents.map((event) => (
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
