import "./agent-lanes.css";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTailFeed } from "../../lib/use-tail-feed.ts";
import { useObservePolling } from "../../lib/observe.ts";
import type { Agent, Route } from "../../lib/types.ts";
import { AgentAvatar } from "../../components/AgentAvatar.tsx";
import { SessionObserve } from "../sessions/SessionObserve.tsx";
import { AgentLaneCard } from "./AgentLaneCard.tsx";
import { agentLaneToCardModel } from "./agent-lane-card-model.ts";
import { AgentLaneDetailSheet } from "./AgentLaneDetailSheet.tsx";
import { AgentLaneSummaryCard } from "./AgentLaneSummaryCard.tsx";
import {
  AgentLaneSummaryResizeHandle,
  readStoredLaneSummaryHeight,
  useLaneSummaryResize,
} from "./AgentLaneSummaryResize.tsx";
import {
  AGENT_LANE_HORIZON_OPTIONS,
  agentLaneHorizonLabel,
  agentLaneHorizonWindowMs,
  agentLaneTailRecentLimit,
  buildAgentLanes,
  createStableLaneOrder,
  DEFAULT_AGENT_LANE_HORIZON,
  isAgentLaneLive,
  lanePrimaryLabel,
  rosterIssuesFromTailDiscovery,
  shouldPollAgentForLaneObserve,
  sortLanesWithStableOrder,
  type AgentLane,
  type AgentLaneHorizonKey,
  type AgentLaneRosterIssue,
} from "./agent-lanes-model.ts";

const LANE_HORIZON_STORAGE_KEY = "openscout:agent-lanes-horizon";

function readStoredHorizon(): AgentLaneHorizonKey {
  try {
    const stored = sessionStorage.getItem(LANE_HORIZON_STORAGE_KEY);
    if (stored && AGENT_LANE_HORIZON_OPTIONS.some((option) => option.key === stored)) {
      return stored as AgentLaneHorizonKey;
    }
  } catch {
    // ignore storage failures
  }
  return DEFAULT_AGENT_LANE_HORIZON;
}

function AgentLaneIssueRow({ issue }: { issue: AgentLaneRosterIssue }) {
  const agents = issue.agentNames?.length
    ? issue.agentNames.join(", ")
    : issue.agentIds?.join(", ");
  const paths = issue.transcriptPaths?.join(" · ");
  const detail = [agents, paths].filter(Boolean).join(" · ");
  return (
    <li className="s-agent-lanes-issues-item">
      <span className="s-agent-lanes-issues-kind">{issue.kind.replaceAll("_", " ")}</span>
      <span className="s-agent-lanes-issues-message">{issue.message}</span>
      {detail ? <span className="s-agent-lanes-issues-detail">{detail}</span> : null}
    </li>
  );
}

function AgentLaneColumn({
  lane,
  isNew,
  nowMs,
  traceWindowMs,
  traceWindowLabel,
  summaryHeight,
  onSummaryResizeStart,
  onSummaryResizeReset,
  summaryResizing,
  onInspect,
}: {
  lane: AgentLane;
  isNew?: boolean;
  nowMs: number;
  traceWindowMs: number;
  traceWindowLabel: string;
  summaryHeight: number | null;
  onSummaryResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  onSummaryResizeReset: () => void;
  summaryResizing?: boolean;
  onInspect: (lane: AgentLane) => void;
}) {
  const { agent, observe, source } = lane;
  const isLive = isAgentLaneLive(observe);
  const hasTrace = Boolean(observe && observe.events.length > 0);
  const liveClass = isLive ? " s-agent-lane--live" : "";
  const newClass = isNew ? " s-agent-lane--new" : "";
  const [collapsed, setCollapsed] = useState(false);

  // The proven lane trace (distinguished per-kind rows, enter animations,
  // auto-scroll, hidden scrollbars). Rendered fresh per call so it can sit in
  // both the current column and the new card without sharing an element.
  const renderTrace = () => (
    <section className="s-agent-lane-trace" aria-label={`${lanePrimaryLabel(agent, source)} trace`}>
      <div className="s-agent-lane-body">
        {hasTrace ? (
          <SessionObserve
            data={observe ?? undefined}
            agentId={lane.source === "scout" ? agent.id : undefined}
            sessionId={agent.harnessSessionId}
            showRail={false}
            variant="lane"
            nowMs={nowMs}
            traceWindowMs={traceWindowMs}
            traceWindowLabel={traceWindowLabel}
          />
        ) : (
          <div className="s-agent-lane-empty">Waiting for trace activity…</div>
        )}
      </div>
    </section>
  );

  // Temporary A/B: the current lane column and the new studio-design card,
  // side by side on the same page, driven by the same live lane data. The new
  // card brings a fresh identity header + dark status box, then hosts the SAME
  // SessionObserve trace as the current column.
  return (
    <div className="s-agent-lane-compare">
      <div className="s-agent-lane-compare-cell">
        <span className="s-agent-lane-compare-tag">current</span>
        <article className={`s-agent-lane s-agent-lane--split${liveClass}${newClass}`}>
          <AgentLaneSummaryCard lane={lane} isLive={isLive} onOpen={() => onInspect(lane)} />
          {renderTrace()}
        </article>
      </div>
      <div className="s-agent-lane-compare-cell">
        <span className="s-agent-lane-compare-tag s-agent-lane-compare-tag--new">new</span>
        <article className={`s-agent-lane s-agent-lane--split${liveClass}${newClass}`}>
          <AgentLaneCard
            model={agentLaneToCardModel(lane, { isLive, nowMs })}
            avatar={<AgentAvatar agent={agent} placement="row" size={44} presence={false} tile={false} />}
            collapsed={collapsed}
            cockpitHeight={collapsed ? undefined : summaryHeight}
            onToggleCollapsed={() => setCollapsed((value) => !value)}
            onOpen={() => onInspect(lane)}
          />
          {!collapsed && (
            <AgentLaneSummaryResizeHandle
              onResizeStart={onSummaryResizeStart}
              onReset={onSummaryResizeReset}
              active={summaryResizing}
            />
          )}
          {renderTrace()}
        </article>
      </div>
    </div>
  );
}

export function AgentLanesView({
  navigate,
  agents: scoutAgents,
}: {
  navigate: (route: Route) => void;
  agents: Agent[];
}) {
  const [now, setNow] = useState(Date.now());
  const [horizon, setHorizon] = useState<AgentLaneHorizonKey>(readStoredHorizon);
  const [summaryHeight, setSummaryHeight] = useState<number | null>(readStoredLaneSummaryHeight);
  const { beginResize, resetSummaryHeight, resizing: summaryResizing } = useLaneSummaryResize(setSummaryHeight);
  const handleSummaryResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => beginResize(event, summaryHeight),
    [beginResize, summaryHeight],
  );
  const tailRecentLimit = agentLaneTailRecentLimit(horizon);
  const traceWindowMs = agentLaneHorizonWindowMs(horizon);
  const { discovery, events: tailEvents } = useTailFeed({
    // Replay transcript history from disk (like TailView) so the horizon can
    // reach into the past. Without this the broker returns only its live
    // in-memory ring buffer, so widening to 4h/24h reveals nothing older than
    // what's streamed in since the broker started. buildAgentLanes still trims
    // everything to the selected windowMs.
    includeTranscriptReplay: true,
    recentLimit: tailRecentLimit,
  });
  const returnRoute: Route = { view: "ops", mode: "lanes" };
  const horizonLabel = agentLaneHorizonLabel(horizon);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(LANE_HORIZON_STORAGE_KEY, horizon);
    } catch {
      // ignore storage failures
    }
  }, [horizon]);

  const laneOrderRef = useRef(createStableLaneOrder());
  const [newLaneIds, setNewLaneIds] = useState<Set<string>>(() => new Set());
  const [inspectedLaneId, setInspectedLaneId] = useState<string | null>(null);
  const observeAgents = useMemo(
    () => scoutAgents.filter((agent) => shouldPollAgentForLaneObserve(agent, now, horizon)),
    [scoutAgents, now, horizon],
  );
  const observeCache = useObservePolling(observeAgents);
  const tailLoading = discovery === null && tailEvents.length === 0;

  useEffect(() => {
    if (newLaneIds.size === 0) return;
    const timer = setTimeout(() => setNewLaneIds(new Set()), 900);
    return () => clearTimeout(timer);
  }, [newLaneIds]);

  const { lanes, issues, freshLaneIds } = useMemo(() => {
    const built = buildAgentLanes({
      transcripts: discovery?.transcripts ?? [],
      tailEvents,
      processes: discovery?.processes ?? [],
      scoutAgents,
      observeCache,
      now,
      workingOnly: true,
      horizon,
    });
    const result = sortLanesWithStableOrder(built.lanes, laneOrderRef.current);
    const rosterIssues = [
      ...rosterIssuesFromTailDiscovery(discovery),
      ...built.issues,
    ];
    return {
      lanes: result.lanes,
      issues: rosterIssues,
      freshLaneIds: result.newLaneIds,
    };
  }, [discovery, tailEvents, scoutAgents, observeCache, now, horizon]);

  useEffect(() => {
    if (issues.length === 0) return;
    for (const issue of issues) {
      console.warn(`[agent-lanes] ${issue.message}`, issue);
    }
  }, [issues]);

  useEffect(() => {
    if (freshLaneIds.length === 0) return;
    setNewLaneIds((previous) => {
      const next = new Set(previous);
      for (const id of freshLaneIds) next.add(id);
      return next;
    });
  }, [freshLaneIds.join("\0")]);

  const inspectedLane = useMemo(
    () => lanes.find((lane) => lane.id === inspectedLaneId) ?? null,
    [inspectedLaneId, lanes],
  );

  return (
    <div className="s-agent-lanes">
      <div className="s-agent-lanes-bar">
        <div className="s-agent-lanes-bar-main">
          <div className="s-agent-lanes-title">Agent Lanes</div>
          <div className="s-agent-lanes-meta">
            {lanes.length} active · trace {horizonLabel}
          </div>
        </div>
        <div className="s-agent-lanes-horizons" role="group" aria-label="Activity window">
          {AGENT_LANE_HORIZON_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={`s-agent-lanes-horizon${horizon === option.key ? " s-agent-lanes-horizon--on" : ""}`}
              aria-pressed={horizon === option.key}
              onClick={() => setHorizon(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {issues.length > 0 ? (
        <div className="s-agent-lanes-issues" role="status" aria-live="polite">
          <div className="s-agent-lanes-issues-head">
            <span className="s-agent-lanes-issues-badge">Roster issues</span>
            <span className="s-agent-lanes-issues-meta">
              {issues.length} fleet/transcript warning{issues.length === 1 ? "" : "s"} — lanes follow tail, not agent registry
            </span>
          </div>
          <ul className="s-agent-lanes-issues-list">
            {issues.map((issue) => (
              <AgentLaneIssueRow key={issue.id} issue={issue} />
            ))}
          </ul>
        </div>
      ) : null}
      {lanes.length === 0 ? (
        <div className="s-agent-lanes-empty">
          {tailLoading
            ? "Loading tail stream…"
            : `No agents with recent work in the last ${horizonLabel}. Lanes follow the tail stream — they appear when harness transcripts update or emit tool calls inside the selected window.`}
        </div>
      ) : (
        <div className="s-agent-lanes-scroll">
          {lanes.map((lane) => (
            <AgentLaneColumn
              key={lane.id}
              lane={lane}
              isNew={newLaneIds.has(lane.id)}
              nowMs={now}
              traceWindowMs={traceWindowMs}
              traceWindowLabel={horizonLabel}
              summaryHeight={summaryHeight}
              onSummaryResizeStart={handleSummaryResizeStart}
              onSummaryResizeReset={resetSummaryHeight}
              summaryResizing={summaryResizing}
              onInspect={(target) => setInspectedLaneId(target.id)}
            />
          ))}
        </div>
      )}
      {inspectedLane && (
        <AgentLaneDetailSheet
          lane={inspectedLane}
          navigate={navigate}
          returnRoute={returnRoute}
          onClose={() => setInspectedLaneId(null)}
        />
      )}
    </div>
  );
}
