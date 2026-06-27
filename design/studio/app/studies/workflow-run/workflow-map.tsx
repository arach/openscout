"use client";

import { useMemo, useState } from "react";

type WorkerTrace = {
  totalEvents: number;
  firstAt: number | null;
  typeCounts: Record<string, number>;
  toolCounts: Record<string, number>;
  finalText: string | null;
};

type WorkerMapNode = {
  id: string;
  shortId: string;
  label: string;
  kind: "review" | "verification" | "synthesis" | "worker";
  status: "completed" | "running" | "observed";
  score: number | null;
  findingCount: number;
  eventCount: number;
  sizeKb: number;
  model: string | null;
  latestAt: number | null;
  startedIndex: number | null;
  resultIndex: number | null;
  prompt: string | null;
  output: string[];
  trace: WorkerTrace;
};

type WorkflowMapModel = {
  candidate: {
    parentSessionId: string;
  };
  workers: WorkerMapNode[];
  resultCount: number;
  startedCount: number;
  runningCount: number;
};

type RoleKind = WorkerMapNode["kind"];

type RoleGroup = {
  kind: RoleKind;
  title: string;
  deck: string;
  workers: WorkerMapNode[];
};

type RoleStackLayout = {
  group: RoleGroup;
  x: number;
  y: number;
  w: number;
  h: number;
  visibleLimit: number;
};

const MAX_WORKERS_IN_GRID = 48;
const MAP_WIDTH = 1160;
const MAP_HEIGHT = 760;
const STACK_X = 220;
const STACK_TOP = 32;
const STACK_W = 300;
const STACK_GAP = 14;
const DETAIL_X = 552;
const DETAIL_Y = 32;
const DETAIL_W = 584;
const DETAIL_H = 692;
const PARENT = { x: 24, y: 80, w: 160, h: 104 };
const LEDGER = { x: 24, y: 576, w: 160, h: 104 };
const ROLE_ORDER: RoleKind[] = ["review", "verification", "worker", "synthesis"];
const ROLE_COPY: Record<RoleKind, { title: string; deck: string }> = {
  review: {
    title: "Review",
    deck: "Critique and finding scouts",
  },
  verification: {
    title: "Verification",
    deck: "Reality checks and refinements",
  },
  worker: {
    title: "Worker",
    deck: "General-purpose subagents",
  },
  synthesis: {
    title: "Synthesis",
    deck: "Aggregation and final shape",
  },
};

function shortId(value: string | null | undefined, size = 8): string {
  if (!value) return "-";
  return value.length > size ? value.slice(0, size) : value;
}

function truncate(value: string, max: number): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 3)}...` : cleaned;
}

function formatTime(ms: number | null): string {
  if (!ms) return "--:--:--";
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

function workerAccentVar(worker: WorkerMapNode): string {
  if (worker.status === "completed") return "var(--scout-accent)";
  if (worker.status === "running") return "var(--status-warn-fg)";
  return "var(--studio-edge-strong)";
}

function roleAccentVar(kind: RoleKind): string {
  if (kind === "verification") return "var(--status-info-fg)";
  if (kind === "synthesis") return "var(--status-warn-fg)";
  if (kind === "worker") return "var(--studio-edge-strong)";
  return "var(--scout-accent)";
}

function workerJournalSpan(worker: WorkerMapNode): string {
  if (worker.startedIndex === null && worker.resultIndex === null) return "not in journal";
  const start = worker.startedIndex !== null ? `#${String(worker.startedIndex + 1).padStart(2, "0")}` : "--";
  const result = worker.resultIndex !== null ? `#${String(worker.resultIndex + 1).padStart(2, "0")}` : "--";
  return `${start} -> ${result}`;
}

function topToolEntries(worker: WorkerMapNode, limit = 4): Array<[string, number]> {
  return Object.entries(worker.trace.toolCounts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit);
}

function aggregateToolEntries(workers: WorkerMapNode[], limit = 3): Array<[string, number]> {
  const counts: Record<string, number> = {};
  for (const worker of workers) {
    for (const [tool, count] of Object.entries(worker.trace.toolCounts)) {
      counts[tool] = (counts[tool] ?? 0) + count;
    }
  }
  return Object.entries(counts)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit);
}

function nodeValue(worker: WorkerMapNode): string {
  if (worker.score !== null) return `score ${worker.score}`;
  if (worker.findingCount > 0) return `${worker.findingCount} items`;
  return `${worker.eventCount} events`;
}

function resultText(worker: WorkerMapNode): string {
  return worker.output[0] ?? worker.prompt ?? worker.trace.finalText ?? "No promoted result captured for this subagent.";
}

function buildRoleGroups(workers: WorkerMapNode[]): RoleGroup[] {
  return ROLE_ORDER.map((kind) => ({
    kind,
    ...ROLE_COPY[kind],
    workers: workers.filter((worker) => worker.kind === kind),
  })).filter((group) => group.workers.length > 0);
}

function buildRoleLayouts(groups: RoleGroup[]): RoleStackLayout[] {
  const available = MAP_HEIGHT - STACK_TOP * 2;
  const stackH = Math.min(
    324,
    Math.floor((available - Math.max(0, groups.length - 1) * STACK_GAP) / Math.max(1, groups.length)),
  );
  const visibleLimit = stackH >= 240 ? 3 : 2;
  return groups.map((group, index) => ({
    group,
    x: STACK_X,
    y: STACK_TOP + index * (stackH + STACK_GAP),
    w: STACK_W,
    h: stackH,
    visibleLimit,
  }));
}

function findWorker(workers: WorkerMapNode[], id: string | null): WorkerMapNode | null {
  return id ? workers.find((worker) => worker.id === id) ?? null : null;
}

export function WorkflowMap({ model }: { model: WorkflowMapModel }) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const workers = model.workers.slice(0, MAX_WORKERS_IN_GRID);
  const groups = useMemo(() => buildRoleGroups(workers), [workers]);
  const stackLayouts = useMemo(() => buildRoleLayouts(groups), [groups]);
  const defaultWorker = groups[0]?.workers[0] ?? workers[0] ?? null;
  const hoveredWorker = findWorker(workers, hoveredId);
  const pinnedWorker = findWorker(workers, pinnedId);
  const activeWorker = pinnedWorker ?? hoveredWorker ?? defaultWorker;
  const activeGroup = activeWorker
    ? groups.find((group) => group.kind === activeWorker.kind) ?? null
    : groups[0] ?? null;

  function togglePin(worker: WorkerMapNode) {
    setPinnedId((current) => (current === worker.id ? null : worker.id));
  }

  return (
    <section className="mt-6 rounded-md border border-studio-edge bg-studio-surface p-5">
      <SectionHead title="Fan-out map" meta="role stacks + detail bay" />
      <div className="mt-5 overflow-x-auto rounded border border-studio-edge bg-studio-canvas-alt">
        <div
          role="img"
          aria-label="Claude workflow fan-out graph"
          className="relative"
          style={{ width: MAP_WIDTH, height: MAP_HEIGHT }}
          onMouseLeave={() => setHoveredId(null)}
        >
          <ConnectorBackdrop layouts={stackLayouts} activeKind={activeGroup?.kind ?? null} />
          <EndpointCard
            x={PARENT.x}
            y={PARENT.y}
            w={PARENT.w}
            h={PARENT.h}
            title="Parent session"
            detail={shortId(model.candidate.parentSessionId, 12)}
            tone="lead"
          />
          <EndpointCard
            x={LEDGER.x}
            y={LEDGER.y}
            w={LEDGER.w}
            h={LEDGER.h}
            title="Result ledger"
            detail={`${model.resultCount}/${model.startedCount} done`}
            tone={model.runningCount > 0 ? "running" : "done"}
          />

          {stackLayouts.map((layout) => {
            return (
              <RoleStack
                key={layout.group.kind}
                group={layout.group}
                x={layout.x}
                y={layout.y}
                w={layout.w}
                h={layout.h}
                visibleLimit={layout.visibleLimit}
                activeId={activeWorker?.id ?? null}
                pinnedId={pinnedId}
                onPreview={(worker) => setHoveredId(worker.id)}
                onTogglePin={togglePin}
              />
            );
          })}

          {activeWorker && activeGroup ? (
            <AgentDetailBay
              worker={activeWorker}
              group={activeGroup}
              pinned={pinnedId === activeWorker.id}
              onPreview={(worker) => setHoveredId(worker.id)}
              onTogglePin={togglePin}
            />
          ) : (
            <EmptyDetailBay />
          )}

          {model.workers.length > workers.length ? (
            <div
              className="absolute font-mono text-[10px] uppercase tracking-ch text-studio-ink-faint"
              style={{ left: 238, bottom: 22 }}
            >
              +{model.workers.length - workers.length} more workers hidden from this compact map
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ConnectorBackdrop({
  layouts,
  activeKind,
}: {
  layouts: RoleStackLayout[];
  activeKind: RoleKind | null;
}) {
  const activeStroke = activeKind ? roleAccentVar(activeKind) : "var(--scout-accent)";
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} aria-hidden="true">
      <defs>
        <linearGradient id="workflow-role-edge" x1="0" x2="1">
          <stop offset="0%" stopColor="var(--studio-edge-strong)" />
          <stop offset="100%" stopColor="var(--scout-accent)" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width={MAP_WIDTH} height={MAP_HEIGHT} fill="var(--studio-canvas-alt)" />
      {layouts.map((layout) => {
        const group = layout.group;
        const x1 = PARENT.x + PARENT.w;
        const y1 = PARENT.y + PARENT.h / 2;
        const x2 = layout.x;
        const y2 = layout.y + layout.h / 2;
        const active = group.kind === activeKind;
        return (
          <path
            key={`parent-${group.kind}`}
            d={`M ${x1} ${y1} C ${x1 + 60} ${y1}, ${x2 - 80} ${y2}, ${x2} ${y2}`}
            fill="none"
            stroke={active ? activeStroke : "url(#workflow-role-edge)"}
            strokeOpacity={active ? 0.48 : 0.18}
            strokeWidth={active ? 1.4 : 1}
          />
        );
      })}
      {layouts.map((layout) => {
        const group = layout.group;
        const x1 = layout.x + layout.w;
        const y1 = layout.y + layout.h / 2;
        const x2 = DETAIL_X;
        const y2 = DETAIL_Y + DETAIL_H / 2;
        const active = group.kind === activeKind;
        return (
          <path
            key={`detail-${group.kind}`}
            d={`M ${x1} ${y1} C ${x1 + 80} ${y1}, ${x2 - 80} ${y2}, ${x2} ${y2}`}
            fill="none"
            stroke={active ? activeStroke : "var(--studio-edge-strong)"}
            strokeOpacity={active ? 0.52 : 0.12}
            strokeWidth={active ? 1.5 : 1}
          />
        );
      })}
      <path
        d={`M ${LEDGER.x + LEDGER.w} ${LEDGER.y + LEDGER.h / 2} C ${LEDGER.x + LEDGER.w + 68} ${LEDGER.y + LEDGER.h / 2}, ${DETAIL_X - 86} ${DETAIL_Y + DETAIL_H / 2}, ${DETAIL_X} ${DETAIL_Y + DETAIL_H / 2}`}
        fill="none"
        stroke={activeStroke}
        strokeOpacity="0.34"
        strokeWidth="1.3"
      />
    </svg>
  );
}

function EndpointCard({
  x,
  y,
  w,
  h,
  title,
  detail,
  tone,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  detail: string;
  tone: "lead" | "done" | "running";
}) {
  const stroke = tone === "done" ? "var(--scout-accent)" : tone === "running" ? "var(--status-warn-fg)" : "var(--studio-edge-strong)";
  return (
    <div
      className="absolute rounded-md border bg-studio-surface px-4 py-4 shadow-sm"
      style={{ left: x, top: y, width: w, height: h, borderColor: stroke }}
    >
      <div className="font-display text-[15px] font-medium text-studio-ink">{title}</div>
      <div className="mt-4 truncate font-mono text-[10px] text-studio-ink-faint">{detail}</div>
    </div>
  );
}

function RoleStack({
  group,
  x,
  y,
  w,
  h,
  visibleLimit,
  activeId,
  pinnedId,
  onPreview,
  onTogglePin,
}: {
  group: RoleGroup;
  x: number;
  y: number;
  w: number;
  h: number;
  visibleLimit: number;
  activeId: string | null;
  pinnedId: string | null;
  onPreview: (worker: WorkerMapNode) => void;
  onTogglePin: (worker: WorkerMapNode) => void;
}) {
  const accent = roleAccentVar(group.kind);
  const visibleWorkers = group.workers.slice(0, visibleLimit);
  const hiddenCount = Math.max(0, group.workers.length - visibleWorkers.length);
  const completed = group.workers.filter((worker) => worker.status === "completed").length;
  const totalEvents = group.workers.reduce((sum, worker) => sum + worker.trace.totalEvents, 0);
  const tools = aggregateToolEntries(group.workers, 3);

  return (
    <div
      className="absolute"
      style={{ left: x, top: y, width: w, height: h }}
      onMouseEnter={() => onPreview(group.workers[0])}
    >
      <div className="absolute inset-x-3 top-2 h-full rounded-md border border-studio-edge bg-studio-canvas/40" />
      <div className="absolute inset-x-1 top-1 h-full rounded-md border border-studio-edge bg-studio-canvas/60" />
      <div className="relative h-full rounded-md border border-studio-edge bg-studio-surface p-3 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-ch text-studio-ink-faint">
              <span className="h-1.5 w-1.5 rounded-sm" style={{ background: accent }} />
              <span>{group.title}</span>
            </div>
            <div className="mt-1 truncate text-[12px] text-studio-ink-muted">{group.deck}</div>
          </div>
          <div className="shrink-0 rounded-sm border border-studio-edge bg-studio-canvas px-2 py-1 text-right font-mono text-[9px] text-studio-ink-faint">
            {group.workers.length} agents
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <MiniMetric label="done" value={`${completed}/${group.workers.length}`} />
          <MiniMetric label="events" value={String(totalEvents)} />
          <MiniMetric label="tools" value={tools.length ? String(tools.length) : "-"} />
        </div>

        <div className="mt-3 grid gap-2">
          {visibleWorkers.map((worker, index) => (
            <StackWorkerButton
              key={worker.id}
              worker={worker}
              index={index}
              active={activeId === worker.id}
              pinned={pinnedId === worker.id}
              onPreview={() => onPreview(worker)}
              onTogglePin={() => onTogglePin(worker)}
            />
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-studio-edge pt-2">
          <div className="flex min-w-0 gap-1 overflow-hidden">
            {tools.map(([tool, count]) => (
              <span key={tool} className="truncate rounded-sm bg-studio-canvas px-1.5 py-0.5 font-mono text-[8px] text-studio-ink-faint">
                {tool} {count}
              </span>
            ))}
          </div>
          {hiddenCount > 0 ? (
            <span className="shrink-0 font-mono text-[9px] text-studio-ink-muted">
              +{hiddenCount} stacked
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StackWorkerButton({
  worker,
  index,
  active,
  pinned,
  onPreview,
  onTogglePin,
}: {
  worker: WorkerMapNode;
  index: number;
  active: boolean;
  pinned: boolean;
  onPreview: () => void;
  onTogglePin: () => void;
}) {
  const accent = workerAccentVar(worker);
  return (
    <button
      type="button"
      onMouseEnter={onPreview}
      onFocus={onPreview}
      onClick={onTogglePin}
      className={`grid grid-cols-[18px_minmax(0,1fr)_52px] items-center gap-2 rounded border px-2 py-2 text-left transition ${
        active
          ? "border-scout-accent/70 bg-scout-accent-soft text-studio-ink"
          : "border-studio-edge bg-studio-canvas text-studio-ink-faint hover:border-studio-edge-strong hover:text-studio-ink"
      }`}
      style={{ borderColor: active ? accent : undefined }}
      aria-label={`${pinned ? "Unpin" : "Pin"} ${worker.label}`}
    >
      <span className="font-mono text-[9px] text-studio-ink-muted">{String(index + 1).padStart(2, "0")}</span>
      <span className="min-w-0">
        <span className="block truncate font-display text-[12px] font-medium text-studio-ink">
          {worker.label}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[9px] text-studio-ink-faint">
          {worker.shortId} / {nodeValue(worker)}
        </span>
      </span>
      <span className="rounded-sm border border-studio-edge bg-studio-canvas-alt px-1.5 py-1 text-center font-mono text-[8px] uppercase tracking-ch text-studio-ink-faint">
        {pinned ? "pinned" : "pin"}
      </span>
    </button>
  );
}

function AgentDetailBay({
  worker,
  group,
  pinned,
  onPreview,
  onTogglePin,
}: {
  worker: WorkerMapNode;
  group: RoleGroup;
  pinned: boolean;
  onPreview: (worker: WorkerMapNode) => void;
  onTogglePin: (worker: WorkerMapNode) => void;
}) {
  const accent = workerAccentVar(worker);
  const topTools = topToolEntries(worker, 5);
  const maxTool = topTools.reduce((max, [, count]) => Math.max(max, count), 0);
  const model = worker.model ? worker.model.replace(/^claude-/, "") : "-";
  const siblingWorkers = group.workers.slice(0, 8);
  const pinnedCopy = pinned ? "unpin" : "pin";

  return (
    <div
      className="absolute rounded-md border bg-studio-surface p-4 text-studio-ink shadow-2xl"
      style={{
        left: DETAIL_X,
        top: DETAIL_Y,
        width: DETAIL_W,
        height: DETAIL_H,
        borderColor: accent,
      }}
      onMouseEnter={() => onPreview(worker)}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 font-mono text-[9px] uppercase tracking-ch text-studio-ink-faint">
            <span className="h-1.5 w-1.5 rounded-sm" style={{ background: accent }} />
            <span>{group.title}</span>
            <span>/</span>
            <span>{worker.shortId}</span>
            <span>/</span>
            <span>{worker.status}</span>
          </div>
          <h3 className="mt-2 truncate font-display text-[22px] font-medium text-studio-ink">
            {worker.label}
          </h3>
          <p className="mt-1 truncate text-[12px] text-studio-ink-faint">{group.deck}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <a
            href={`#trace-${worker.shortId}`}
            className="rounded-sm border border-studio-edge bg-studio-canvas px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-ch text-studio-ink-faint transition hover:border-scout-accent/50 hover:text-studio-ink"
          >
            trace down
          </a>
          <button
            type="button"
            onClick={() => onTogglePin(worker)}
            className="rounded-sm border border-studio-edge bg-studio-canvas px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-ch text-studio-ink-faint transition hover:border-scout-accent/50 hover:text-studio-ink"
          >
            {pinnedCopy}
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2">
        <MiniMetric label="journal" value={workerJournalSpan(worker)} />
        <MiniMetric label="model" value={model} />
        <MiniMetric label="window" value={`${formatTime(worker.trace.firstAt)}-${formatTime(worker.latestAt)}`} />
        <MiniMetric label="events" value={`${worker.trace.totalEvents}/${worker.sizeKb}KB`} />
      </div>

      <div className="mt-4 grid grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)] gap-3">
        <div className="grid gap-3">
          <DetailLane title="Result lane">
            <div className="grid gap-2">
              {(worker.output.length > 0 ? worker.output : [resultText(worker)]).slice(0, 3).map((line) => (
                <p key={line} className="rounded border border-studio-edge bg-studio-canvas px-3 py-2 text-[12px] leading-relaxed text-studio-ink">
                  {truncate(line, 185)}
                </p>
              ))}
            </div>
          </DetailLane>
          <DetailLane title="Task lane">
            <p className="max-h-[88px] overflow-hidden text-[12px] leading-relaxed text-studio-ink-faint">
              {worker.prompt ? truncate(worker.prompt, 360) : "No prompt excerpt captured."}
            </p>
          </DetailLane>
          <DetailLane title="Final lane">
            <p className="max-h-[70px] overflow-hidden text-[12px] leading-relaxed text-studio-ink-faint">
              {worker.trace.finalText ? truncate(worker.trace.finalText, 300) : "No final assistant message captured."}
            </p>
          </DetailLane>
        </div>

        <div className="grid gap-3">
          <DetailLane title="Execution lane">
            <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-studio-ink-faint">
              {Object.entries(worker.trace.typeCounts).map(([type, count]) => (
                <span key={type}>
                  {type} <span className="text-studio-ink">{count}</span>
                </span>
              ))}
            </div>
            {topTools.length > 0 ? (
              <div className="mt-3 grid gap-1.5">
                {topTools.map(([tool, count]) => (
                  <div key={tool} className="grid grid-cols-[86px_minmax(0,1fr)_26px] items-center gap-2">
                    <span className="truncate font-mono text-[10px] text-studio-ink" title={tool}>
                      {tool}
                    </span>
                    <span className="h-1.5 overflow-hidden rounded-sm bg-studio-canvas-alt">
                      <span
                        className="block h-full rounded-sm bg-scout-accent/70"
                        style={{ width: `${maxTool ? Math.max(8, Math.round((count / maxTool) * 100)) : 0}%` }}
                      />
                    </span>
                    <span className="text-right font-mono text-[10px] text-studio-ink-faint">{count}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 font-mono text-[10px] text-studio-ink-muted">no tool calls recorded</div>
            )}
          </DetailLane>

          <DetailLane title={`${group.title} stack`}>
            <div className="grid max-h-[172px] gap-1.5 overflow-auto pr-1">
              {siblingWorkers.map((sibling) => (
                <button
                  key={sibling.id}
                  type="button"
                  onMouseEnter={() => onPreview(sibling)}
                  onFocus={() => onPreview(sibling)}
                  onClick={() => onTogglePin(sibling)}
                  className={`grid grid-cols-[minmax(0,1fr)_50px] items-center gap-2 rounded border px-2 py-1.5 text-left ${
                    sibling.id === worker.id
                      ? "border-scout-accent/60 bg-scout-accent-soft text-studio-ink"
                      : "border-studio-edge bg-studio-canvas text-studio-ink-faint hover:border-studio-edge-strong hover:text-studio-ink"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] text-studio-ink">{sibling.label}</span>
                    <span className="block truncate font-mono text-[8.5px] text-studio-ink-faint">
                      {sibling.shortId} / {nodeValue(sibling)}
                    </span>
                  </span>
                  <span className="text-right font-mono text-[8px] uppercase tracking-ch text-studio-ink-muted">
                    {sibling.id === worker.id && pinned ? "pinned" : "view"}
                  </span>
                </button>
              ))}
            </div>
          </DetailLane>
        </div>
      </div>
    </div>
  );
}

function EmptyDetailBay() {
  return (
    <div
      className="absolute grid place-items-center rounded-md border border-studio-edge bg-studio-surface text-center"
      style={{ left: DETAIL_X, top: DETAIL_Y, width: DETAIL_W, height: DETAIL_H }}
    >
      <div>
        <div className="font-display text-[20px] font-medium text-studio-ink">No agent selected</div>
        <div className="mt-2 font-mono text-[10px] uppercase tracking-ch text-studio-ink-faint">
          detail bay
        </div>
      </div>
    </div>
  );
}

function DetailLane({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded border border-studio-edge bg-studio-canvas px-3 py-2.5">
      <div className="font-mono text-[9px] uppercase tracking-ch text-studio-ink-faint">{title}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded border border-studio-edge bg-studio-canvas px-2 py-1.5">
      <div className="truncate font-mono text-[8px] uppercase tracking-ch text-studio-ink-faint">{label}</div>
      <div className="mt-0.5 truncate font-mono text-[9px] text-studio-ink">{value}</div>
    </div>
  );
}

function SectionHead({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="font-display text-[20px] font-medium tracking-tight text-studio-ink">
        {title}
      </h2>
      {meta ? (
        <span className="text-right font-mono text-[10px] text-studio-ink-faint">
          {meta}
        </span>
      ) : null}
    </div>
  );
}
