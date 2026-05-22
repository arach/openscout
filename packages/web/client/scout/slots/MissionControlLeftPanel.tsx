import { useCallback, useRef, useState } from "react";
import "./ctx-panel.css";
import "./mission-left.css";
import { normalizeAgentState } from "../../lib/agent-state.ts";
import {
  MISSION_RECENT_WINDOWS,
  clearMissionSelection,
  requestMissionCanvasFocus,
  setMissionActivityFilter,
  setMissionQuery,
  setMissionRecentWindow,
  setMissionSourceFilter,
  toggleMissionSelected,
  useMissionControlStore,
  type MissionVisibleAgent,
} from "../../lib/mission-control-store.ts";
import { useScout } from "../Provider.tsx";
import {
  makeSearchHandoff,
  rovingTabIndex,
  useListArrowNav,
  useSlashToFocus,
} from "../../lib/keyboard-nav.ts";
import { timeAgo } from "../../lib/time.ts";
import { statusOnHover } from "../../lib/page-status.ts";
import { RailRow } from "./RailRow.tsx";

export function ScoutMissionControlLeftPanel() {
  const { navigate } = useScout();
  const mc = useMissionControlStore();
  const visibleAgents = mc.visibleAgents;

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const onListKeyDown = useListArrowNav();
  const onSearchKeyDown = makeSearchHandoff(() => listRef.current);
  useSlashToFocus(useCallback(() => inputRef.current, []));

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const isRecent = mc.activityFilter === "recent";
  const selectedCount = mc.selectedIds.length;

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const openTailForSelection = () => {
    if (selectedCount === 0) return;
    const selectedAgents = visibleAgents.filter((a) => mc.selectedIds.includes(a.id));
    const query = selectedAgents
      .map((a) => a.handle ?? a.name)
      .filter(Boolean)
      .join("|");
    if (!query) return;
    navigate({ view: "ops", mode: "tail", tailQuery: query });
  };

  return (
    <div className="ctx-panel ml-panel">
      {/* Primary: source */}
      <div className="ml-section">
        <div className="ml-section-label">Source</div>
        <div className="ml-chips ml-chips--primary">
          {(["all", "scout", "native"] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={["ml-chip", mc.sourceFilter === f && "ml-chip--active"].filter(Boolean).join(" ")}
              onClick={() => setMissionSourceFilter(f)}
            >
              {f === "all" ? "All" : f === "scout" ? "Scout" : "Native"}
            </button>
          ))}
        </div>
      </div>

      {/* Search */}
      <div className="ctx-panel-search">
        <input
          ref={inputRef}
          type="text"
          className="ctx-panel-search-input"
          placeholder="Filter agents…  (press /)"
          value={mc.query}
          onChange={(e) => setMissionQuery(e.target.value)}
          onKeyDown={(e) => {
            onSearchKeyDown(e);
            if (e.key === "Escape" && mc.query) {
              setMissionQuery("");
            }
          }}
        />
      </div>

      {/* Secondary: activity + (conditional) time window — inline, smaller */}
      <div className="ml-section ml-section--secondary">
        <div className="ml-chips ml-chips--secondary">
          {(["all", "active", "recent"] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={["ml-chip ml-chip--ghost", mc.activityFilter === f && "ml-chip--ghost-active"].filter(Boolean).join(" ")}
              onClick={() => setMissionActivityFilter(f)}
            >
              {f === "all" ? "Any" : f === "active" ? "Active" : "Recent"}
            </button>
          ))}
          {isRecent && <span className="ml-divider" aria-hidden />}
          {isRecent && MISSION_RECENT_WINDOWS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={["ml-chip ml-chip--ghost", mc.recentWindowMs === opt.value && "ml-chip--ghost-active"].filter(Boolean).join(" ")}
              onClick={() => setMissionRecentWindow(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {selectedCount > 0 ? (
        <div className="ml-selection">
          <span className="ml-selection-label">{selectedCount} selected</span>
          <div className="ml-selection-actions">
            <button type="button" className="ml-selection-btn ml-selection-btn--primary" onClick={openTailForSelection}>
              Tail ↗
            </button>
            <button type="button" className="ml-selection-btn" onClick={clearMissionSelection}>
              Clear
            </button>
          </div>
        </div>
      ) : (
        <div className="ml-count">
          {visibleAgents.length} visible
          <span className="ml-count-hint">⌘-click · ⌘A all</span>
        </div>
      )}

      <div
        ref={listRef}
        className="ctx-panel-list ctx-panel-list--scroll"
        onKeyDown={onListKeyDown}
      >
        {visibleAgents.length === 0 ? (
          <div className="ctx-panel-empty">
            {mc.query ? "No match" : "Nothing visible"}
          </div>
        ) : (
          visibleAgents.map((agent, idx) => {
            const isExpanded = agent.id === expandedId;
            const hasExpanded = visibleAgents.some((a) => a.id === expandedId);
            const isSelected = mc.selectedIds.includes(agent.id);
            const state = normalizeAgentState(agent.state);
            return (
              <AgentRow
                key={agent.id}
                agent={agent}
                state={state}
                isExpanded={isExpanded}
                isSelected={isSelected}
                tabIndex={rovingTabIndex(isExpanded, hasExpanded, idx === 0)}
                onToggle={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey) {
                    toggleMissionSelected(agent.id);
                  } else {
                    toggleExpand(agent.id);
                  }
                }}
                onFocusOnCanvas={() => requestMissionCanvasFocus(agent.id)}
                onOpen={() => navigate({ view: "agents", agentId: agent.id })}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

function AgentRow({
  agent,
  state,
  isExpanded,
  isSelected,
  tabIndex,
  onToggle,
  onFocusOnCanvas,
  onOpen,
}: {
  agent: MissionVisibleAgent;
  state: ReturnType<typeof normalizeAgentState>;
  isExpanded: boolean;
  isSelected: boolean;
  tabIndex: 0 | -1;
  onToggle: (e: React.MouseEvent | React.KeyboardEvent) => void;
  onFocusOnCanvas: () => void;
  onOpen: () => void;
}) {
  const hoverHandlers = statusOnHover({
    label: `Focus ${agent.handle ?? agent.name}`,
    route: `/ops/control · ${agent.id}`,
  });
  const detail = (
    <>
      <dl className="rr-spec-list">
        <SpecLine label="MODEL" value={[agent.harness, agent.model].filter(Boolean).join("/") || "—"} />
        <SpecLine label="AT" value={[agent.project, agent.branch].filter(Boolean).join("/") || "—"} />
        <SpecLine label="STATE" value={state} />
        <SpecLine label="SOURCE" value={agent.source} />
      </dl>
      <div className="ml-detail-actions">
        <button type="button" className="ml-detail-btn" onClick={onFocusOnCanvas}>
          Focus on canvas
        </button>
        <button type="button" className="ml-detail-btn ml-detail-btn--primary" onClick={onOpen}>
          Open ↗
        </button>
      </div>
    </>
  );
  return (
    <RailRow
      name={agent.handle ?? agent.name}
      meta={agent.updatedAt ? timeAgo(agent.updatedAt) : undefined}
      tone={state}
      caret={isExpanded ? "open" : "closed"}
      selected={isSelected}
      expanded={isExpanded}
      detail={detail}
      tabIndex={tabIndex}
      onClick={(e) => onToggle(e)}
      onPointerEnter={hoverHandlers.onPointerEnter as (e: React.PointerEvent) => void}
      onPointerLeave={hoverHandlers.onPointerLeave as (e: React.PointerEvent) => void}
    />
  );
}

function SpecLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rr-spec">
      <dt className="rr-spec-label">{label}</dt>
      <dd className="rr-spec-value" title={value}>{value}</dd>
    </div>
  );
}
