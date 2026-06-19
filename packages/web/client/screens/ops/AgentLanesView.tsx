import "./agent-lanes.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTailFeed } from "../../lib/use-tail-feed.ts";
import type { Agent, Route } from "../../lib/types.ts";
import { SessionObserve } from "../sessions/SessionObserve.tsx";
import { AgentLaneDetailSheet } from "./AgentLaneDetailSheet.tsx";
import { AgentLaneSummaryCard } from "./AgentLaneSummaryCard.tsx";
import {
  AGENT_LANE_HORIZON_OPTIONS,
  agentLaneHorizonLabel,
  buildAgentLanes,
  createStableLaneOrder,
  DEFAULT_AGENT_LANE_HORIZON,
  isAgentLaneLive,
  lanePrimaryLabel,
  sortLanesWithStableOrder,
  type AgentLane,
  type AgentLaneHorizonKey,
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

function AgentLaneColumn({
  lane,
  isNew,
  onInspect,
}: {
  lane: AgentLane;
  isNew?: boolean;
  onInspect: (lane: AgentLane) => void;
}) {
  const { agent, observe, source } = lane;
  const isLive = isAgentLaneLive(observe);
  const hasTrace = Boolean(observe && observe.events.length > 0);

  return (
    <article className={`s-agent-lane${isLive ? " s-agent-lane--live" : ""}${isNew ? " s-agent-lane--new" : ""}`}>
      <AgentLaneSummaryCard lane={lane} isLive={isLive} onOpen={() => onInspect(lane)} />
      <section className="s-agent-lane-trace" aria-label={`${lanePrimaryLabel(agent, source)} trace`}>
        <div className="s-agent-lane-trace-head">
          <span className="s-agent-lane-trace-label">Trace</span>
        </div>
        <div className="s-agent-lane-body">
          {hasTrace ? (
            <SessionObserve
              data={observe ?? undefined}
              agentId={lane.source === "scout" ? agent.id : undefined}
              sessionId={agent.harnessSessionId}
              showRail={false}
              variant="lane"
              traceLimit={22}
            />
          ) : (
            <div className="s-agent-lane-empty">Waiting for trace activity…</div>
          )}
        </div>
      </section>
    </article>
  );
}

export function AgentLanesView({
  navigate,
  agents: scoutAgents,
}: {
  navigate: (route: Route) => void;
  agents: Agent[];
}) {
  const { discovery, events: tailEvents } = useTailFeed({
    recentLimit: 500,
    includeTranscriptReplay: true,
  });
  const [now, setNow] = useState(Date.now());
  const [horizon, setHorizon] = useState<AgentLaneHorizonKey>(readStoredHorizon);
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

  useEffect(() => {
    if (newLaneIds.size === 0) return;
    const timer = setTimeout(() => setNewLaneIds(new Set()), 900);
    return () => clearTimeout(timer);
  }, [newLaneIds]);

  const { lanes, freshLaneIds } = useMemo(() => {
    const built = buildAgentLanes({
      transcripts: discovery?.transcripts ?? [],
      tailEvents,
      processes: discovery?.processes ?? [],
      scoutAgents,
      now,
      workingOnly: true,
      horizon,
    });
    const result = sortLanesWithStableOrder(built, laneOrderRef.current);
    return { lanes: result.lanes, freshLaneIds: result.newLaneIds };
  }, [discovery?.processes, discovery?.transcripts, tailEvents, scoutAgents, now, horizon]);

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
            {lanes.length} active · last {horizonLabel}
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
      {lanes.length === 0 ? (
        <div className="s-agent-lanes-empty">
          No agents with recent work in the last {horizonLabel}. Lanes follow the tail stream — they appear when harness transcripts update or emit tool calls inside the selected window.
        </div>
      ) : (
        <div className="s-agent-lanes-scroll">
          {lanes.map((lane) => (
            <AgentLaneColumn
              key={lane.id}
              lane={lane}
              isNew={newLaneIds.has(lane.id)}
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
