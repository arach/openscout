import "./agent-lanes.css";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTailFeed } from "../../lib/use-tail-feed.ts";
import { useObservePolling } from "../../lib/observe.ts";
import { fetchTerminalSessions } from "../../lib/terminal-sessions.ts";
import type { Agent, Route } from "../../lib/types.ts";
import type { TerminalSessionRecord } from "@openscout/protocol";
import { AgentAvatar } from "../../components/AgentAvatar.tsx";
import { SessionObserve } from "../sessions/SessionObserve.tsx";
import { type AgentLaneSize, readAgentLaneSize } from "./agent-lane-size.ts";
import { AgentLaneChrome } from "./AgentLaneChrome.tsx";
import { AgentLaneCard } from "./AgentLaneCard.tsx";
import { agentLaneToCardModel } from "./agent-lane-card-model.ts";
import { AgentLaneDetailSheet } from "./AgentLaneDetailSheet.tsx";
import {
  AgentLaneSummaryResizeHandle,
  readStoredLaneSummaryHeight,
  useLaneSummaryResize,
} from "./AgentLaneSummaryResize.tsx";
import { useAgentLanesKeyboard } from "./useAgentLanesKeyboard.ts";
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
import {
  hasAttentionLane,
  hasHarnessLane,
  type ResolvedLaneColumn,
} from "./lane-deck-layout.ts";
import {
  readLaneDeckProfileId,
  snapLaneWidthPx,
  type AgentLaneWidthTier,
  type LaneDeckProfileId,
} from "./lane-deck.ts";
import { useLaneDeck } from "./useLaneDeck.ts";
import { useLaneWidthResize } from "./useLaneWidthResize.ts";

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
  widthPx,
  laneTitle,
  pinned,
  laneWidth,
  defaultWidth,
  isNew,
  nowMs,
  traceWindowMs,
  traceWindowLabel,
  summaryHeight,
  onSummaryResizeStart,
  onSummaryResizeReset,
  summaryResizing,
  onInspect,
  onTogglePin,
  onWidthChange,
  onWidthResizeStart,
  widthResizing,
  focusProps,
}: {
  lane: AgentLane;
  widthPx: number;
  laneTitle: string;
  pinned: boolean;
  laneWidth: AgentLaneWidthTier | number | undefined;
  defaultWidth: AgentLaneWidthTier;
  isNew?: boolean;
  nowMs: number;
  traceWindowMs: number;
  traceWindowLabel: string;
  summaryHeight: number | null;
  onSummaryResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  onSummaryResizeReset: () => void;
  summaryResizing?: boolean;
  onInspect: (lane: AgentLane) => void;
  onTogglePin: () => void;
  onWidthChange: (width: AgentLaneWidthTier) => void;
  onWidthResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  widthResizing?: boolean;
  focusProps?: {
    "data-cursor"?: boolean;
    tabIndex: 0 | -1;
    ref: (node: HTMLElement | null) => void;
    onFocus: () => void;
  };
}) {
  const { agent, observe, source } = lane;
  const isLive = isAgentLaneLive(observe);
  const hasTrace = Boolean(observe && observe.events.length > 0);
  const liveClass = isLive ? " s-agent-lane--live" : "";
  const newClass = isNew ? " s-agent-lane--new" : "";
  // Calm by default: the cockpit overlay starts collapsed (header + status
  // stay; the resizable pane and its handle reveal on expand), rather than
  // opening expanded.
  const [collapsed, setCollapsed] = useState(true);

  // The proven lane trace (distinguished per-kind rows, enter animations,
  // auto-scroll, hidden scrollbars). Rendered fresh per call so it can sit in
  // both the current column and the new card without sharing an element.
  const laneRef = focusProps?.ref;
  const laneFocusRest = focusProps
    ? {
        "data-cursor": focusProps["data-cursor"],
        tabIndex: focusProps.tabIndex,
        onFocus: focusProps.onFocus,
      }
    : undefined;

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

  // The agent lane: the studio-design card (identity header + resizable cockpit
  // overlay) above the live SessionObserve trace.
  return (
    <article
      ref={laneRef}
      data-lane-id={lane.id}
      className={`s-agent-lane${liveClass}${newClass}${pinned ? " s-agent-lane--pinned" : ""}${focusProps?.["data-cursor"] ? " s-agent-lane--cursor" : ""}`}
      style={{ "--lane-width": `${widthPx}px` } as CSSProperties}
      {...laneFocusRest}
    >
      <AgentLaneChrome
        title={laneTitle}
        width={laneWidth}
        defaultWidth={defaultWidth}
        pinned={pinned}
        onTogglePin={onTogglePin}
        onWidthChange={onWidthChange}
        onResizeStart={onWidthResizeStart}
        resizing={widthResizing}
      />
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
  );
}

export function AgentLanesView({
  navigate,
  agents: scoutAgents,
  embedded = false,
  laneSize = "lg",
  profileId: profileIdProp,
  harnessFilter,
  projectFilter,
}: {
  navigate: (route: Route) => void;
  agents: Agent[];
  embedded?: boolean;
  laneSize?: AgentLaneSize;
  profileId?: LaneDeckProfileId;
  harnessFilter?: string | null;
  projectFilter?: string | null;
}) {
  const profileId = profileIdProp ?? readLaneDeckProfileId();
  const defaultWidthTier = laneSize ?? readAgentLaneSize();
  const [now, setNow] = useState(Date.now());
  const [horizon, setHorizon] = useState<AgentLaneHorizonKey>(readStoredHorizon);
  const [summaryHeight, setSummaryHeight] = useState<number | null>(readStoredLaneSummaryHeight);
  const [terminalSessions, setTerminalSessions] = useState<TerminalSessionRecord[]>([]);
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
    discoveryIntervalMs: 5_000,
    recentLimit: tailRecentLimit,
  });
  const returnRoute: Route = { view: "ops", mode: "lanes" };
  const horizonLabel = agentLaneHorizonLabel(horizon);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const sessions = await fetchTerminalSessions({ includeDiscovered: false });
        if (!cancelled) setTerminalSessions(sessions);
      } catch {
        if (!cancelled) setTerminalSessions([]);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
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
      terminalSessions,
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
  }, [discovery, tailEvents, scoutAgents, terminalSessions, observeCache, now, horizon]);

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
  const filteredLanes = useMemo(
    () => lanes.filter((lane) => laneMatchesEmbedFilters(lane, { harnessFilter, projectFilter })),
    [lanes, harnessFilter, projectFilter],
  );
  const {
    deck,
    layout,
    pinLane,
    unpinLane,
    setLaneWidth,
    addHarnessLane,
    addAttentionLane,
    clearPins,
    isPinned,
  } = useLaneDeck(profileId, defaultWidthTier, filteredLanes);
  const { beginResize: beginWidthResize, resizingLaneId } = useLaneWidthResize(setLaneWidth);
  const activeFilterLabel = useMemo(
    () => embedFilterLabel({ harnessFilter, projectFilter }),
    [harnessFilter, projectFilter],
  );
  const visibleColumns = layout.flat;
  const pinnedCount = layout.pinnedLeft.length + layout.pinnedRight.length;
  const inspectLane = useCallback((lane: AgentLane) => {
    setInspectedLaneId(lane.id);
  }, []);
  const { getLaneFocusProps } = useAgentLanesKeyboard({
    lanes: visibleColumns.map((column) => column.lane),
    inspectedLaneId,
    onInspect: inspectLane,
    onHorizonChange: setHorizon,
  });
  const [deckMenuOpen, setDeckMenuOpen] = useState(false);
  const deckMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!deckMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!deckMenuRef.current?.contains(event.target as Node)) {
        setDeckMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [deckMenuOpen]);

  const renderLaneColumn = useCallback((column: ResolvedLaneColumn, index: number) => {
    const { lane } = column;
    const laneTitle = lanePrimaryLabel(lane.agent, lane.source);
    const laneWidth = deck.laneWidths[lane.id] ?? snapLaneWidthPx(column.widthPx).tier ?? column.widthPx;
    return (
      <AgentLaneColumn
        key={column.key}
        lane={lane}
        widthPx={column.widthPx}
        laneTitle={laneTitle}
        pinned={column.isPinned}
        laneWidth={laneWidth}
        defaultWidth={deck.defaultLaneWidth}
        isNew={newLaneIds.has(lane.id)}
        nowMs={now}
        traceWindowMs={traceWindowMs}
        traceWindowLabel={horizonLabel}
        summaryHeight={summaryHeight}
        onSummaryResizeStart={handleSummaryResizeStart}
        onSummaryResizeReset={resetSummaryHeight}
        summaryResizing={summaryResizing}
        onInspect={inspectLane}
        onTogglePin={() => {
          if (isPinned(lane.id)) unpinLane(lane.id);
          else pinLane(lane);
        }}
        onWidthChange={(width) => setLaneWidth(lane.id, width)}
        onWidthResizeStart={(event) => beginWidthResize(lane.id, event, column.widthPx)}
        widthResizing={resizingLaneId === lane.id}
        focusProps={getLaneFocusProps(index, lane.id)}
      />
    );
  }, [
    beginWidthResize,
    deck.defaultLaneWidth,
    deck.laneWidths,
    getLaneFocusProps,
    handleSummaryResizeStart,
    horizonLabel,
    inspectLane,
    isPinned,
    newLaneIds,
    now,
    pinLane,
    resetSummaryHeight,
    resizingLaneId,
    setLaneWidth,
    summaryHeight,
    summaryResizing,
    traceWindowMs,
    unpinLane,
  ]);

  return (
    <div
      className={`s-agent-lanes${embedded ? " s-agent-lanes--embedded" : ""}`}
      data-lane-profile={profileId}
      data-lanes-deck-version="1"
    >
      <div className="s-agent-lanes-bar">
        <div className="s-agent-lanes-bar-main">
          <div className="s-agent-lanes-title">Agent Lanes</div>
          <div className="s-agent-lanes-meta">
            deck v1 · {visibleColumns.length} visible · {pinnedCount} pinned · trace {horizonLabel}
            {activeFilterLabel ? ` · ${activeFilterLabel}` : ""}
            {` · ${profileId}`}
          </div>
        </div>
        <div className="s-agent-lanes-bar-actions">
          <div className="s-agent-lanes-deck-menu" ref={deckMenuRef}>
            <button
              type="button"
              className="s-agent-lanes-deck-btn"
              aria-expanded={deckMenuOpen}
              onClick={() => setDeckMenuOpen((open) => !open)}
            >
              + Lane
            </button>
            {deckMenuOpen ? (
              <div className="s-agent-lanes-deck-popover" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="s-agent-lanes-deck-item"
                  onClick={() => {
                    addAttentionLane();
                    setDeckMenuOpen(false);
                  }}
                  disabled={hasAttentionLane(deck)}
                >
                  Needs attention
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="s-agent-lanes-deck-item"
                  onClick={() => {
                    addHarnessLane("codex", "Codex sessions");
                    setDeckMenuOpen(false);
                  }}
                  disabled={hasHarnessLane(deck, "codex")}
                >
                  Codex sessions
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="s-agent-lanes-deck-item"
                  onClick={() => {
                    addHarnessLane("claude", "Claude sessions");
                    setDeckMenuOpen(false);
                  }}
                  disabled={hasHarnessLane(deck, "claude")}
                >
                  Claude sessions
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="s-agent-lanes-deck-item"
                  onClick={() => {
                    addHarnessLane("grok", "Grok sessions");
                    setDeckMenuOpen(false);
                  }}
                  disabled={hasHarnessLane(deck, "grok")}
                >
                  Grok sessions
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="s-agent-lanes-deck-item s-agent-lanes-deck-item--danger"
                  onClick={() => {
                    clearPins();
                    setDeckMenuOpen(false);
                  }}
                  disabled={pinnedCount === 0}
                >
                  Clear pinned lanes
                </button>
              </div>
            ) : null}
          </div>
          <div className="s-agent-lanes-horizons" role="group" aria-label="Activity window">
            {AGENT_LANE_HORIZON_OPTIONS.map((option, index) => (
              <button
                key={option.key}
                type="button"
                className={`s-agent-lanes-horizon${horizon === option.key ? " s-agent-lanes-horizon--on" : ""}`}
                aria-pressed={horizon === option.key}
                title={`${option.label} window (${index + 1})`}
                onClick={() => setHorizon(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
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
      {visibleColumns.length === 0 ? (
        <div className="s-agent-lanes-empty">
          {tailLoading
            ? "Loading tail stream…"
            : activeFilterLabel
              ? `No lanes match ${activeFilterLabel} in the last ${horizonLabel}.`
              : deck.showAutoLanes
                ? `No agents with recent work in the last ${horizonLabel}. Lanes appear when harness transcripts update, registered sessions launch, or tools emit inside the selected window.`
                : "No pinned lanes yet. Use + Lane or pin a session from its lane header."}
        </div>
      ) : (
        <div className="s-agent-lanes-body">
          {layout.pinnedLeft.length > 0 ? (
            <section className="s-agent-lanes-zone s-agent-lanes-zone--pinned-left" aria-label="Pinned lanes">
              <div className="s-agent-lanes-zone-label">Pinned</div>
              <div className="s-agent-lanes-scroll" role="listbox" aria-label="Pinned agent lanes">
                {layout.pinnedLeft.map((column, index) => renderLaneColumn(column, index))}
              </div>
            </section>
          ) : null}
          {layout.main.length > 0 ? (
            <section className="s-agent-lanes-zone s-agent-lanes-zone--main" aria-label="Active lanes">
              {layout.pinnedLeft.length > 0 ? <div className="s-agent-lanes-zone-label">Live</div> : null}
              <div className="s-agent-lanes-scroll" role="listbox" aria-label="Active agent lanes">
                {layout.main.map((column, index) => renderLaneColumn(column, layout.pinnedLeft.length + index))}
              </div>
            </section>
          ) : null}
          {layout.pinnedRight.length > 0 ? (
            <section className="s-agent-lanes-zone s-agent-lanes-zone--pinned-right" aria-label="Pinned right lanes">
              <div className="s-agent-lanes-zone-label">Pinned</div>
              <div className="s-agent-lanes-scroll" role="listbox" aria-label="Pinned right agent lanes">
                {layout.pinnedRight.map((column, index) => renderLaneColumn(
                  column,
                  layout.pinnedLeft.length + layout.main.length + index,
                ))}
              </div>
            </section>
          ) : null}
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

type AgentLaneEmbedFilters = {
  harnessFilter?: string | null;
  projectFilter?: string | null;
};

function normalizeEmbedFilter(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function slugValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['"]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function pathLeaf(value: string): string | null {
  const leaf = value.trim().replace(/\/+$/u, "").split(/[\\/]/u).filter(Boolean).pop();
  return leaf?.trim() || null;
}

function matchesAnyFilter(candidates: Array<string | null | undefined>, filter: string | null): boolean {
  if (!filter) return true;
  const filterSlug = slugValue(filter);
  return candidates.some((candidate) => {
    const raw = candidate?.trim();
    if (!raw) return false;
    const normalized = raw.toLowerCase();
    const leaf = pathLeaf(raw);
    return normalized === filter
      || slugValue(raw) === filterSlug
      || Boolean(leaf && (leaf.toLowerCase() === filter || slugValue(leaf) === filterSlug));
  });
}

function laneMatchesEmbedFilters(lane: AgentLane, filters: AgentLaneEmbedFilters): boolean {
  const harnessFilter = normalizeEmbedFilter(filters.harnessFilter);
  const projectFilter = normalizeEmbedFilter(filters.projectFilter);
  const { agent, facts, source } = lane;
  return matchesAnyFilter(
    [
      agent.harness,
      agent.definitionId,
      facts?.attribution,
      source,
    ],
    harnessFilter,
  ) && matchesAnyFilter(
    [
      agent.project,
      agent.projectRoot,
      agent.cwd,
      facts?.cwd,
      lanePrimaryLabel(agent, source),
    ],
    projectFilter,
  );
}

function embedFilterLabel(filters: AgentLaneEmbedFilters): string {
  const parts = [
    filters.harnessFilter?.trim() ? `harness ${filters.harnessFilter.trim()}` : "",
    filters.projectFilter?.trim() ? `project ${filters.projectFilter.trim()}` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}
