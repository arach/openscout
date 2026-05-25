import "./ctx-panel.css";
import "./plan-archive-left.css";

import {
  PLAN_AUTHORS,
  PLAN_OUTCOMES,
  PLAN_TIME_BUCKETS,
  setPlanAuthorFilter,
  setPlanOutcomeFilter,
  setPlanProjectFilter,
  setPlanQuery,
  setPlanTimeFilter,
  usePlanArchiveStore,
} from "../../lib/plan-archive-store.ts";

export function ScoutPlanArchiveLeftPanel() {
  const store = usePlanArchiveStore();
  const counts = store.counts;

  return (
    <div className="ctx-panel pa-panel">
      <div className="ctx-panel-search">
        <input
          type="text"
          className="ctx-panel-search-input"
          placeholder="Search records…"
          value={store.query}
          onChange={(e) => setPlanQuery(e.target.value)}
        />
      </div>

      <FacetGroup title="Author">
        {PLAN_AUTHORS.map((a) => (
          <FacetRow
            key={a.id}
            label={a.label}
            count={counts.byAuthor[a.id] ?? 0}
            active={store.authorFilter === a.id}
            onClick={() => setPlanAuthorFilter(a.id)}
          />
        ))}
      </FacetGroup>

      <FacetGroup title="Outcome">
        {PLAN_OUTCOMES.map((o) => (
          <FacetRow
            key={o.id}
            label={o.label}
            count={counts.byOutcome[o.id] ?? 0}
            active={store.outcomeFilter === o.id}
            onClick={() => setPlanOutcomeFilter(o.id)}
          />
        ))}
      </FacetGroup>

      <FacetGroup title="Time">
        <div className="pa-chips">
          {PLAN_TIME_BUCKETS.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`pa-chip${store.timeFilter === b.id ? " pa-chip--active" : ""}`}
              onClick={() => setPlanTimeFilter(b.id)}
            >
              {b.label}
            </button>
          ))}
        </div>
      </FacetGroup>

      {counts.byProject.length > 1 && (
        <FacetGroup title="Project">
          <FacetRow
            label="All"
            count={counts.total}
            active={store.projectFilter === "all"}
            onClick={() => setPlanProjectFilter("all")}
          />
          {counts.byProject.slice(0, 12).map((p) => (
            <FacetRow
              key={p.id}
              label={p.id}
              count={p.count}
              active={store.projectFilter === p.id}
              onClick={() => setPlanProjectFilter(p.id)}
            />
          ))}
        </FacetGroup>
      )}
    </div>
  );
}

function FacetGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pa-group">
      <div className="pa-group-title">{title}</div>
      {children}
    </div>
  );
}

function FacetRow({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`pa-row${active ? " pa-row--active" : ""}`}
      onClick={onClick}
    >
      <span className="pa-row-label">{label}</span>
      <span className="pa-row-count">{count}</span>
    </button>
  );
}
