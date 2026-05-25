import "./plan-archive.css";
import "./mission-control.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { useFocusTrap } from "../lib/keyboard-nav.ts";
import { timeAgo } from "../lib/time.ts";
import { statusOnHover } from "../lib/page-status.ts";
import {
  PLAN_TIME_BUCKETS,
  setPlanFacetCounts,
  setPlanFocusedId,
  setPlanQuery,
  usePlanArchiveStore,
  type PlanAuthor,
  type PlanOutcome,
} from "../lib/plan-archive-store.ts";
import { TextDocumentSurface, createTextDocument } from "../components/TextDocumentSurface.tsx";
import { useScout } from "../scout/Provider.tsx";
import { openContent } from "../scout/slots/openContent.ts";
import type { Agent, AgentRun, Route, WorkDetail, WorkItem, WorkMaterial, WorkMaterialContent, WorkTimelineItem } from "../lib/types.ts";

type PlanRecord = {
  id: string;
  source: "work" | "run";
  title: string;
  summary: string | null;
  author: PlanAuthor;
  authorLabel: string;
  ownerId: string | null;
  project: string;
  state: string;
  outcome: PlanOutcome;
  route: Route;
  taskText: string | null;
  createdAt: number;
  updatedAt: number;
  lastMeaningfulAt: number;
  parentId: string | null;
  parentTitle: string | null;
};

const ACTIVE_STATES = new Set(["open", "working", "waiting"]);
const REVIEW_STATES = new Set(["review"]);
const COMPLETED_STATES = new Set(["completed", "done", "shipped"]);

function classifyOutcome(state: string): PlanOutcome {
  const s = state.toLowerCase();
  if (ACTIVE_STATES.has(s)) return "running";
  if (REVIEW_STATES.has(s)) return "review";
  if (COMPLETED_STATES.has(s)) return "completed";
  return "abandoned";
}

function classifyAuthor(work: WorkItem): { author: PlanAuthor; label: string } {
  const ownerId = work.ownerId ?? "";
  const isOperator = ownerId === "operator" || ownerId === "" || ownerId.startsWith("operator.");
  return {
    author: isOperator ? "operator" : "agent",
    label: work.ownerName ?? ownerId ?? (isOperator ? "operator" : "agent"),
  };
}

function projectFromWork(work: WorkItem): string {
  if (work.parentTitle) {
    const m = work.parentTitle.match(/^([a-z0-9_-]+)/i);
    if (m) return m[1];
  }
  return "—";
}

function buildPlanRecord(work: WorkItem): PlanRecord {
  const { author, label } = classifyAuthor(work);
  return {
    id: work.id,
    source: "work",
    title: work.title,
    summary: work.summary ?? work.lastMeaningfulSummary ?? null,
    author,
    authorLabel: label,
    ownerId: work.ownerId,
    project: projectFromWork(work),
    state: work.state,
    outcome: classifyOutcome(work.state),
    route: { view: "work", workId: work.id },
    taskText: null,
    createdAt: work.createdAt,
    updatedAt: work.updatedAt,
    lastMeaningfulAt: work.lastMeaningfulAt,
    parentId: work.parentId,
    parentTitle: work.parentTitle,
  };
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function compactText(value: string, max = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? value.trim();
}

function runTask(run: AgentRun): string | null {
  return textValue(run.input?.["task"]);
}

function runOutputSummary(run: AgentRun): string | null {
  return textValue(run.output?.["summary"]) ?? textValue(run.output?.["text"]);
}

function metadataObject(value: unknown, key: string): Record<string, unknown> | null {
  const child = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : null;
  return child && typeof child === "object" && !Array.isArray(child)
    ? child as Record<string, unknown>
    : null;
}

function projectFromRun(run: AgentRun): string {
  const invocationMeta = metadataObject(run.metadata, "invocationMetadata") ?? run.metadata ?? null;
  const returnAddress = metadataObject(invocationMeta, "returnAddress");
  const root = textValue(returnAddress?.["projectRoot"]);
  if (root) {
    const parts = root.split("/").filter(Boolean);
    return parts[parts.length - 1] ?? root;
  }
  const conversation = run.conversationId ?? "";
  const match = conversation.match(/dm\.[^.]+\.([a-z0-9_-]+)/i);
  return match?.[1] ?? "—";
}

function runOutcome(run: AgentRun): PlanOutcome {
  switch (run.state) {
    case "queued":
    case "waking":
    case "running":
    case "waiting":
      return "running";
    case "review":
      return "review";
    case "completed":
      return "completed";
    default:
      return "abandoned";
  }
}

const PLAN_LIKE_TERMS = [
  "acceptance",
  "artifact",
  "blocker",
  "checkpoint",
  "component",
  "deliverable",
  "divide-and-conquer",
  "execution",
  "implementation",
  "milestone",
  "next move",
  "parallel",
  "phase",
  "plan",
  "proceed",
  "roadmap",
  "scope",
  "ship",
  "spec",
  "task",
  "todo",
];

function isPlanLikeRun(run: AgentRun, workIds: Set<string>): boolean {
  if (run.workId && workIds.has(run.workId)) return false;
  if (run.collaborationRecordId && workIds.has(run.collaborationRecordId)) return false;

  const task = runTask(run);
  if (!task) return false;

  const normalized = task.toLowerCase();
  const hasListShape = /(^|\n)\s*(?:\d+\.|[-*]\s|\[[ x]\])/m.test(task);
  const keywordHits = PLAN_LIKE_TERMS.filter((term) => normalized.includes(term)).length;
  const isActive = run.state === "queued" || run.state === "waking" || run.state === "running" || run.state === "waiting" || run.state === "review";

  if (isActive && task.length >= 80) return true;
  if (hasListShape && keywordHits >= 1) return true;
  if (task.length >= 360 && keywordHits >= 2) return true;
  return false;
}

function buildRunPlanRecord(run: AgentRun, agentsById: Record<string, Agent>): PlanRecord | null {
  const task = runTask(run);
  if (!task) return null;

  const agent = agentsById[run.agentId];
  const agentName = run.agentName ?? agent?.name ?? run.agentId;
  const title = `${agentName}: ${compactText(firstLine(task), 120)}`;
  const summary = runOutputSummary(run) ?? compactText(task);
  return {
    id: run.id,
    source: "run",
    title,
    summary,
    author: "agent",
    authorLabel: agentName,
    ownerId: run.agentId,
    project: projectFromRun(run),
    state: run.state,
    outcome: runOutcome(run),
    route: run.conversationId ? { view: "conversation", conversationId: run.conversationId } : { view: "agents", agentId: run.agentId },
    taskText: task,
    createdAt: run.createdAt ?? run.startedAt ?? run.updatedAt,
    updatedAt: run.updatedAt,
    lastMeaningfulAt: run.updatedAt,
    parentId: null,
    parentTitle: null,
  };
}

function recordSourceLabel(record: Pick<PlanRecord, "source">): string {
  return record.source === "work" ? "work item" : "agent run";
}

function statusRouteForRecord(record: PlanRecord): string {
  if (record.route.view === "work") return `/work/${record.route.workId}`;
  if (record.route.view === "conversation") return `/messages/${record.route.conversationId}`;
  if (record.route.view === "agents" && record.route.agentId) return `/agents/${record.route.agentId}`;
  return "/ops/plan";
}

function mergeWorks(active: WorkItem[], recent: WorkItem[]): WorkItem[] {
  const seen = new Map<string, WorkItem>();
  for (const w of [...active, ...recent]) {
    if (!seen.has(w.id)) seen.set(w.id, w);
  }
  return [...seen.values()];
}

export function PlanArchiveView({
  navigate,
  agents,
}: {
  navigate: (r: Route) => void;
  agents: Agent[];
}) {
  const { route } = useScout();
  const store = usePlanArchiveStore();

  const [works, setWorks] = useState<WorkItem[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestRef.current;
    try {
      const [active, recent, runItems] = await Promise.all([
        api<WorkItem[]>("/api/work?limit=250"),
        api<WorkItem[]>("/api/work?active=false&limit=250"),
        api<AgentRun[]>("/api/runs?active=false&limit=500"),
      ]);
      if (seq !== requestRef.current) return;
      setWorks(mergeWorks(active, recent));
      setRuns(runItems);
      setError(null);
      setLastLoadedAt(Date.now());
    } catch (e) {
      if (seq !== requestRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useBrokerEvents(() => { void load(); });

  const agentsById = useMemo(
    () => Object.fromEntries(agents.map((agent) => [agent.id, agent])),
    [agents],
  );

  const records = useMemo(() => {
    const workRecords = works.map(buildPlanRecord);
    const workIds = new Set(works.map((work) => work.id));
    const runRecords = runs
      .filter((run) => isPlanLikeRun(run, workIds))
      .map((run) => buildRunPlanRecord(run, agentsById))
      .filter((record): record is PlanRecord => record !== null);
    return [...workRecords, ...runRecords];
  }, [agentsById, runs, works]);
  const sourceCounts = useMemo(() => {
    const work = records.filter((record) => record.source === "work").length;
    return { work, run: records.length - work };
  }, [records]);

  useEffect(() => {
    const byAuthor: Record<PlanAuthor | "all", number> = {
      all: records.length,
      operator: records.filter((r) => r.author === "operator").length,
      agent: records.filter((r) => r.author === "agent").length,
    };
    const byOutcome: Record<PlanOutcome | "all", number> = {
      all: records.length,
      running: records.filter((r) => r.outcome === "running").length,
      review: records.filter((r) => r.outcome === "review").length,
      completed: records.filter((r) => r.outcome === "completed").length,
      abandoned: records.filter((r) => r.outcome === "abandoned").length,
    };
    const projCounts = new Map<string, number>();
    for (const r of records) projCounts.set(r.project, (projCounts.get(r.project) ?? 0) + 1);
    const byProject = [...projCounts.entries()]
      .sort(([, a], [, b]) => b - a)
      .map(([id, count]) => ({ id, count }));
    setPlanFacetCounts({ total: records.length, byAuthor, byOutcome, byProject });
  }, [records]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const window = PLAN_TIME_BUCKETS.find((b) => b.id === store.timeFilter)?.ms ?? null;
    const q = store.query.trim().toLowerCase();
    return records
      .filter((r) => store.authorFilter === "all" || r.author === store.authorFilter)
      .filter((r) => store.outcomeFilter === "all" || r.outcome === store.outcomeFilter)
      .filter((r) => store.projectFilter === "all" || r.project === store.projectFilter)
      .filter((r) => window === null || now - r.lastMeaningfulAt <= window)
      .filter((r) => {
        if (!q) return true;
        return (
          r.title.toLowerCase().includes(q)
          || (r.summary?.toLowerCase().includes(q) ?? false)
          || r.project.toLowerCase().includes(q)
          || r.authorLabel.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.lastMeaningfulAt - a.lastMeaningfulAt);
  }, [records, store.authorFilter, store.outcomeFilter, store.projectFilter, store.timeFilter, store.query]);

  const indexedLabel = lastLoadedAt
    ? `${records.length} records · ${sourceCounts.work} work items · ${sourceCounts.run} runs · indexed ${timeAgo(lastLoadedAt)}`
    : loading
      ? "Indexing…"
      : "0 records";

  return (
    <section className="s-plan-main">
      <header className="s-plan-head">
        <div className="s-plan-head-left">
          <span className="s-plan-eyebrow">Work archive</span>
          <span className="s-plan-stat">{indexedLabel}</span>
        </div>
        <div className="s-plan-head-right">
          <input
            type="search"
            className="s-plan-search"
            placeholder="Search records, titles, projects…"
            value={store.query}
            onChange={(e) => setPlanQuery(e.target.value)}
            spellCheck={false}
          />
          <button
            type="button"
            className="s-plan-refresh"
            onClick={() => { setLoading(true); void load(); }}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {error && <div className="s-plan-error">Error loading records: {error}</div>}

      <div className="s-plan-table" role="table">
        <div className="s-plan-table-head" role="row">
          <span role="columnheader">Created</span>
          <span role="columnheader">Author</span>
          <span role="columnheader">Record</span>
          <span role="columnheader">Project</span>
          <span role="columnheader">Lifecycle</span>
          <span role="columnheader">Outcome</span>
        </div>

        {filtered.length === 0 ? (
          <div className="s-plan-empty">
            {records.length === 0 ? "No records yet." : "No records match these filters."}
          </div>
        ) : (
          filtered.map((r) => (
            <PlanRow key={r.id} record={r} onOpen={() => setPlanFocusedId(r.id)} />
          ))
        )}
      </div>

      {store.focusedPlanId && (
        <PlanFocusOverlay
          planId={store.focusedPlanId}
          record={records.find((r) => r.id === store.focusedPlanId) ?? null}
          onClose={() => setPlanFocusedId(null)}
          onOpenFullPage={() => {
            const id = store.focusedPlanId;
            const focused = records.find((r) => r.id === id) ?? null;
            setPlanFocusedId(null);
            if (focused) openContent(navigate, focused.route, { returnTo: route });
          }}
        />
      )}
    </section>
  );
}

function PlanRow({ record, onOpen }: { record: PlanRecord; onOpen: () => void }) {
  const created = timeAgo(record.createdAt);
  const lastActive = timeAgo(record.lastMeaningfulAt);
  return (
    <button
      type="button"
      role="row"
      className={`s-plan-row s-plan-row--${record.outcome}`}
      onClick={onOpen}
      {...statusOnHover({
        label: `Open ${record.title}`,
        route: statusRouteForRecord(record),
      })}
    >
      <span className="s-plan-cell s-plan-cell--time" role="cell">{created}</span>
      <span className="s-plan-cell s-plan-cell--author" role="cell">
        <span className={`s-plan-author s-plan-author--${record.author}`}>
          {record.author === "operator" ? "you" : record.authorLabel}
        </span>
      </span>
      <span className="s-plan-cell s-plan-cell--plan" role="cell">
        <span className="s-plan-row-title-line">
          <span className="s-plan-row-title">{record.title}</span>
          <span className={`s-plan-source s-plan-source--${record.source}`}>{recordSourceLabel(record)}</span>
        </span>
        {record.summary && <span className="s-plan-row-summary">{record.summary}</span>}
      </span>
      <span className="s-plan-cell s-plan-cell--project" role="cell">{record.project}</span>
      <span className="s-plan-cell s-plan-cell--life" role="cell">
        <LifecycleStrip record={record} />
      </span>
      <span className="s-plan-cell s-plan-cell--outcome" role="cell">
        <span className={`s-plan-outcome s-plan-outcome--${record.outcome}`}>
          {record.outcome === "running" ? `running · ${lastActive}` : record.outcome}
        </span>
      </span>
    </button>
  );
}

type PlanTab = "profile" | "planning" | "execution" | "activity";

function PlanFocusOverlay({
  planId,
  record,
  onClose,
  onOpenFullPage,
}: {
  planId: string;
  record: PlanRecord | null;
  onClose: () => void;
  onOpenFullPage: () => void;
}) {
  const { ref: dialogRef, onKeyDown: onTrapKeyDown } = useFocusTrap<HTMLDivElement>();
  const [tab, setTab] = useState<PlanTab>("profile");
  const [detail, setDetail] = useState<WorkDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (record?.source !== "work") {
      setDetail(null);
      setLoading(false);
      setError(null);
      return () => { cancelled = true; };
    }
    setLoading(true);
    setError(null);
    void api<WorkDetail>(`/api/work/${encodeURIComponent(planId)}`)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [planId, record?.source]);
  useEffect(() => {
    setTab("profile");
  }, [planId, record?.source]);

  const onKey = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    onTrapKeyDown(e);
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "1") { setTab("profile"); return; }
    if (record?.source === "run") return;
    if (e.key === "2") { setTab("planning"); return; }
    if (e.key === "3") { setTab("execution"); return; }
    if (e.key === "4") { setTab("activity"); return; }
  }, [onClose, onTrapKeyDown, record?.source]);

  const title = record?.title ?? detail?.title ?? "Record";
  const authorLabel = record?.authorLabel ?? "—";
  const author = record?.author ?? "operator";

  const allMaterials = detail?.inventory?.materials ?? [];
  const planningMaterials = useMemo(
    () => allMaterials.filter((m) => PLANNING_KINDS.has(m.kind)),
    [allMaterials],
  );
  const executionMaterials = useMemo(
    () => allMaterials.filter((m) => !PLANNING_KINDS.has(m.kind)),
    [allMaterials],
  );
  const planningCount = planningMaterials.length;
  const executionCount = executionMaterials.length;
  const activityCount = detail?.timeline.length ?? 0;
  const isStandaloneRun = record?.source === "run";

  const planningEmpty = {
    title: "No plan, spec, or doc files detected.",
    detail: "Scout has a work record here, but did not find attached planning documents in the material inventory.",
  };
  const executionEmpty = {
    title: "No changed files detected.",
    detail: "Scout has a work record here, but did not infer code, tests, config, assets, or other execution files.",
  };

  return (
    <div className="s-mission-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="s-mission-overlay-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Record ${title}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKey}
        tabIndex={-1}
      >
        <header className="s-mission-overlay-header">
          <div className="s-mission-overlay-identity">
            <span className="s-mission-overlay-handle">{title}</span>
            <span className="s-mission-overlay-sub">
              {record && (
                <span className={`s-plan-source s-plan-source--${record.source}`}>{recordSourceLabel(record)}</span>
              )}
              <span className={`s-plan-author s-plan-author--${author}`}>
                {author === "operator" ? "you" : authorLabel}
              </span>
              {record?.project && record.project !== "—" && (
                <>
                  <span className="s-mission-overlay-sep">·</span>
                  <span>{record.project}</span>
                </>
              )}
              {record && (
                <>
                  <span className="s-mission-overlay-sep">·</span>
                  <span className={`s-plan-outcome s-plan-outcome--${record.outcome}`}>
                    {record.outcome}
                  </span>
                </>
              )}
            </span>
          </div>
          <button type="button" className="s-mission-overlay-close" onClick={onClose} aria-label="Close (Esc)">×</button>
        </header>

        <div className="s-mission-overlay-tabs" role="tablist">
          <div className="s-mission-overlay-tabs-group">
            {isStandaloneRun ? (
              <PlanOverlayTabButton
                label="Run"
                active
                onClick={() => setTab("profile")}
              />
            ) : (
              <>
                <PlanOverlayTabButton
                  label="Profile"
                  active={tab === "profile"}
                  onClick={() => setTab("profile")}
                />
                <PlanOverlayTabButton
                  label="Plans/docs"
                  count={planningCount}
                  active={tab === "planning"}
                  onClick={() => setTab("planning")}
                />
                <PlanOverlayTabButton
                  label="Files"
                  count={executionCount}
                  active={tab === "execution"}
                  onClick={() => setTab("execution")}
                />
                <PlanOverlayTabButton
                  label="Timeline"
                  count={activityCount}
                  active={tab === "activity"}
                  onClick={() => setTab("activity")}
                />
              </>
            )}
          </div>
          <div className="s-mission-overlay-tabs-action">
            <button
              type="button"
              className="s-mission-overlay-jump"
              onClick={onOpenFullPage}
              {...statusOnHover({
                label: record?.source === "run" ? `Open conversation · ${title}` : `Open work page · ${title}`,
                route: record ? statusRouteForRecord(record) : `/work/${planId}`,
              })}
            >
              {record?.source === "run" ? "Open conversation ↗" : "Open work page ↗"}
            </button>
          </div>
        </div>

        <div className="s-mission-overlay-body">
          {loading && !detail ? (
            <div className="s-plan-overlay-loading">Loading record…</div>
          ) : (
            <>
              {error && <div className="s-plan-error">Error loading record: {error}</div>}
              {isStandaloneRun ? (
                <PlanProfileTab record={record} detail={detail} />
              ) : (
                <>
                  {tab === "profile" && <PlanProfileTab record={record} detail={detail} />}
                  {tab === "planning" && (
                    <PlanMaterialsList workId={planId} materials={planningMaterials} empty={planningEmpty} />
                  )}
                  {tab === "execution" && (
                    <PlanMaterialsList workId={planId} materials={executionMaterials} empty={executionEmpty} />
                  )}
                  {tab === "activity" && <PlanActivityTab record={record} detail={detail} />}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PlanOverlayTabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`s-mission-overlay-tab${active ? " s-mission-overlay-tab--active" : ""}`}
      onClick={onClick}
    >
      {label}
      {typeof count === "number" && (
        <>
          {" "}
          <span className={`s-mission-overlay-tab-count${count === 0 ? " s-mission-overlay-tab-count--empty" : ""}`}>
            {count}
          </span>
        </>
      )}
    </button>
  );
}

function PlanProfileTab({ record, detail }: { record: PlanRecord | null; detail: WorkDetail | null }) {
  const rows: Array<[string, string]> = [
    ["TITLE", record?.title ?? detail?.title ?? "—"],
    ["TYPE", record ? recordSourceLabel(record) : detail ? "work item" : "—"],
    ["AUTHOR", record?.authorLabel ?? detail?.ownerName ?? "—"],
    ["PROJECT", record?.project ?? "—"],
    ["STATE", record?.state ?? detail?.state ?? "—"],
    ["OUTCOME", record?.outcome ?? "—"],
    ["CREATED", record?.createdAt ? timeAgo(record.createdAt) : detail?.createdAt ? timeAgo(detail.createdAt) : "—"],
    ["LAST ACTION", record?.lastMeaningfulAt ? timeAgo(record.lastMeaningfulAt) : "—"],
  ];
  const summary = record?.summary ?? detail?.summary ?? detail?.lastMeaningfulSummary ?? null;
  const parent = record?.parentTitle ?? detail?.parentTitle ?? null;
  return (
    <div className="s-focus-tab">
      {summary && <p className="s-plan-overlay-summary">{summary}</p>}
      {record?.taskText && record.taskText !== summary && (
        <p className="s-plan-overlay-summary">{compactText(record.taskText, 900)}</p>
      )}
      <dl className="s-focus-spec">
        {rows.map(([k, v]) => (
          <div key={k} className="s-focus-spec-row">
            <dt className="s-focus-spec-label">{k}</dt>
            <dd className="s-focus-spec-value" title={v}>{v}</dd>
          </div>
        ))}
        {parent && (
          <div className="s-focus-spec-row">
            <dt className="s-focus-spec-label">PARENT</dt>
            <dd className="s-focus-spec-value" title={parent}>{parent}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

const PLANNING_KINDS = new Set(["plan", "spec", "doc"]);

const JUNK_PATH_SEGMENTS = ["node_modules/", "dist/", "build/", ".git/", "vendor/", ".next/", ".cache/"];

function isJunkPath(path: string): boolean {
  const lower = path.toLowerCase();
  return JUNK_PATH_SEGMENTS.some((seg) => lower.includes(seg));
}

function PlanMaterialsList({
  workId,
  materials,
  empty,
}: {
  workId: string;
  materials: WorkMaterial[];
  empty: { title: string; detail: string };
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const filtered = useMemo(() => materials.filter((m) => !isJunkPath(m.path)), [materials]);
  const hiddenJunk = materials.length - filtered.length;

  if (filtered.length === 0 && materials.length === 0) {
    return <PlanOverlayEmpty title={empty.title} detail={empty.detail} />;
  }

  // Reader view
  if (selectedId) {
    const selected = filtered.find((m) => m.id === selectedId);
    if (!selected) {
      // Selection no longer in filtered set — bail back to table
      setTimeout(() => setSelectedId(null), 0);
      return null;
    }
    return (
      <div className="s-plan-materials-reader-pane">
        <header className="s-plan-materials-back-bar">
          <button
            type="button"
            className="s-plan-materials-back"
            onClick={() => setSelectedId(null)}
          >
            ← Back to {filtered.length} files
          </button>
          <span className="s-plan-materials-back-path" title={selected.path}>{selected.path}</span>
        </header>
        <MaterialReader workId={workId} material={selected} />
      </div>
    );
  }

  // Table view
  return (
    <div className="s-plan-materials-table-wrap">
      <div className="s-plan-materials-table" role="table">
        <div className="s-plan-materials-table-head" role="row">
          <span role="columnheader">Kind</span>
          <span role="columnheader">Path</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">Diff</span>
        </div>
        {filtered.map((m) => (
          <button
            key={m.id}
            type="button"
            role="row"
            className="s-plan-materials-table-row"
            onClick={() => setSelectedId(m.id)}
            title={m.path}
          >
            <span className={`s-plan-materials-kind s-plan-materials-kind--${m.kind}`} role="cell">{m.kind}</span>
            <span className="s-plan-materials-path" role="cell">{m.path}</span>
            <span className={`s-plan-materials-status s-plan-materials-status--${m.status}`} role="cell">{m.status}</span>
            <span className="s-plan-materials-diff" role="cell">
              {m.diffStat && (m.diffStat.additions > 0 || m.diffStat.deletions > 0) ? (
                <>
                  <span className="s-plan-overlay-material-diff-add">+{m.diffStat.additions}</span>
                  <span className="s-plan-overlay-material-diff-del">−{m.diffStat.deletions}</span>
                </>
              ) : (
                <span className="s-plan-materials-diff-none">—</span>
              )}
            </span>
          </button>
        ))}
      </div>
      {hiddenJunk > 0 && (
        <div className="s-plan-materials-hidden-note">
          {hiddenJunk} path{hiddenJunk === 1 ? "" : "s"} hidden (node_modules, dist, build, .git, vendor)
        </div>
      )}
    </div>
  );
}

function MaterialReader({ workId, material }: { workId: string; material: WorkMaterial }) {
  const [content, setContent] = useState<WorkMaterialContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setContent(null);
    setError(null);
    void api<WorkMaterialContent>(
      `/api/work/${encodeURIComponent(workId)}/material?materialId=${encodeURIComponent(material.id)}`,
    )
      .then((c) => { if (!cancelled) setContent(c); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [workId, material.id]);

  if (loading && !content) return <div className="s-plan-overlay-empty">Loading {material.path.split("/").pop()}…</div>;
  if (error) return <div className="s-plan-error">Error loading file: {error}</div>;
  if (!content) return <div className="s-plan-overlay-empty">No content.</div>;

  const doc = createTextDocument({
    id: content.materialId,
    title: content.title,
    uri: content.uri,
    mediaType: content.mediaType,
    value: content.content,
  });

  return (
    <div className="s-plan-materials-reader-inner">
      <header className="s-plan-materials-reader-head">
        <span className="s-plan-materials-reader-title">{content.title}</span>
        <span className="s-plan-materials-reader-meta">
          {content.mediaType}
          {content.truncated && " · truncated"}
        </span>
      </header>
      <div className="s-plan-materials-reader-body">
        <TextDocumentSurface document={doc} mode="preview" />
      </div>
    </div>
  );
}

function PlanOverlayEmpty({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="s-plan-overlay-empty">
      <div className="s-plan-overlay-empty-title">{title}</div>
      {detail && <div className="s-plan-overlay-empty-detail">{detail}</div>}
    </div>
  );
}

function PlanActivityTab({ record, detail }: { record: PlanRecord | null; detail: WorkDetail | null }) {
  const timeline = detail?.timeline ?? [];
  if (timeline.length === 0) {
    return (
      <PlanOverlayEmpty
        title="No timeline events recorded."
        detail={record?.source === "run"
          ? "This row is an archived agent run. Open the conversation to inspect the run's surrounding messages."
          : "Scout only has the current record state and summary for this work item."}
      />
    );
  }
  return (
    <ul className="s-plan-overlay-timeline">
      {timeline.slice(-20).reverse().map((event) => <TimelineRow key={event.id} event={event} />)}
    </ul>
  );
}

function TimelineRow({ event }: { event: WorkTimelineItem }) {
  return (
    <li className={`s-plan-overlay-timeline-row s-plan-overlay-timeline-row--${event.kind}`}>
      <span className="s-plan-overlay-timeline-time">{timeAgo(event.at)}</span>
      <span className="s-plan-overlay-timeline-kind">{event.detailKind ?? event.kind}</span>
      <span className="s-plan-overlay-timeline-text">
        {event.title || event.summary || event.actorName || event.kind}
      </span>
    </li>
  );
}

function LifecycleStrip({ record }: { record: PlanRecord }) {
  const created = record.createdAt;
  const last = record.lastMeaningfulAt;
  const span = Math.max(1, last - created);
  const hours = Math.round(span / (60 * 60 * 1000));
  const days = Math.round(span / (24 * 60 * 60 * 1000));
  const spanLabel = days >= 2 ? `${days}d` : hours >= 1 ? `${hours}h` : "<1h";

  return (
    <span className={`s-plan-life s-plan-life--${record.outcome}`} aria-label={`Span ${spanLabel}`}>
      <span className="s-plan-life-dot s-plan-life-dot--start" />
      <span className="s-plan-life-bar" />
      <span
        className={`s-plan-life-dot s-plan-life-dot--end s-plan-life-dot--${record.outcome}`}
      />
      <span className="s-plan-life-span">{spanLabel}</span>
    </span>
  );
}
