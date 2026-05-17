import { BookOpen, Code2, FileText, MessageSquare } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { DocumentFocusViewer, type DocumentFocusKind } from "../components/DocumentFocusViewer.tsx";
import { StatusPill } from "../components/StatusPill.tsx";
import { createTextDocument } from "../components/TextDocumentSurface.tsx";
import { renderWithMentions } from "../lib/mentions.tsx";
import { api } from "../lib/api.ts";
import { useBrokerEvents } from "../lib/sse.ts";
import { workChildTone, workTone } from "../lib/status-tone.ts";
import { fullTimestamp, timeAgo } from "../lib/time.ts";
import { useScout } from "../scout/Provider.tsx";
import { BackToPicker } from "../scout/slots/BackToPicker.tsx";
import { openContent } from "../scout/slots/openContent.ts";
import type { Route, WorkDetail, WorkMaterial, WorkMaterialContent, WorkMaterialsInventory, WorkTimelineItem } from "../lib/types.ts";

type Fact = {
  label: string;
  value: ReactNode;
};

type ActionCue = {
  eyebrow: string;
  title: string;
  body: string;
  tone: "attention" | "blocked" | "active" | "quiet";
};

function stateLabel(state: string): string {
  switch (state) {
    case "review":
      return "In review";
    case "waiting":
      return "Waiting";
    case "working":
      return "Working";
    case "done":
      return "Done";
    default:
      return state.replace(/_/g, " ");
  }
}

function signalLabel(attention: WorkDetail["attention"]): string | null {
  switch (attention) {
    case "badge":
      return "Noteworthy";
    case "interrupt":
      return "Blocked signal";
    default:
      return null;
  }
}

function buildActionCue({
  detail,
  signal,
  ownerLabel,
  nextMoveLabel,
}: {
  detail: WorkDetail;
  signal: string | null;
  ownerLabel: string;
  nextMoveLabel: string;
}): ActionCue {
  const accountableLabel = nextMoveLabel === "—" ? ownerLabel : nextMoveLabel;

  if (detail.attention === "interrupt") {
    return {
      eyebrow: "Network signal",
      title: `Blocker surfaced for ${accountableLabel}`,
      body: detail.conversationId
        ? "Open the thread if you want the blocking context."
        : "No thread is attached; the record and timeline hold the current context.",
      tone: "blocked",
    };
  }

  if (signal) {
    return {
      eyebrow: "Network signal",
      title: `Plan activity from ${accountableLabel}`,
      body: detail.conversationId
        ? "A plan or spec discussion is active in the agent network. Open the thread only if you want context."
        : "A plan or spec discussion is active in the agent network, but no thread is attached yet.",
      tone: "attention",
    };
  }

  if (detail.activeFlights.length > 0 || detail.state === "working") {
    return {
      eyebrow: "Next move",
      title: `${ownerLabel} is working`,
      body: detail.conversationId
        ? "The thread has the freshest working context."
        : "Watch the flight list and timeline for the next update.",
      tone: "active",
    };
  }

  if (detail.state === "waiting" || detail.state === "review") {
    return {
      eyebrow: "Next move",
      title: `Waiting on ${nextMoveLabel}`,
      body: detail.conversationId
        ? "The thread has the current unblock context."
        : "No thread is attached; ownership and timeline are the best context.",
      tone: "quiet",
    };
  }

  if (detail.state === "done") {
    return {
      eyebrow: "Outcome",
      title: "Work is done",
      body: detail.conversationId
        ? "The thread keeps the handoff and final context."
        : "The record and timeline are preserved here.",
      tone: "quiet",
    };
  }

  return {
    eyebrow: "Next move",
    title: nextMoveLabel === "—" ? "No next owner set" : `Next move: ${nextMoveLabel}`,
    body: detail.conversationId
      ? "The thread has the latest context."
      : "Use the record and timeline to decide where this should go next.",
    tone: "quiet",
  };
}

function timelineKindLabel(item: WorkTimelineItem): string {
  switch (item.kind) {
    case "flight_started":
      return "flight started";
    case "flight_completed":
      return item.detailKind ? `flight ${item.detailKind}` : "flight ended";
    case "message":
      return "message";
    case "collaboration_event":
    default:
      return item.title ?? item.detailKind ?? "event";
  }
}

function timelineTone(item: WorkTimelineItem): "message" | "flight" | "done" | "alert" | "system" {
  if (item.kind === "message") {
    return "message";
  }
  if (item.kind === "flight_started") {
    return "flight";
  }
  if (item.kind === "flight_completed") {
    return item.detailKind?.includes("fail") ? "alert" : "done";
  }
  if (item.detailKind?.includes("interrupt") || item.detailKind?.includes("block")) {
    return "alert";
  }
  return "system";
}

function FactCard({
  title,
  items,
}: {
  title: string;
  items: Fact[];
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="s-work-fact-card">
      <div className="s-work-fact-card-header">
        <div className="s-work-fact-card-title">{title}</div>
      </div>
      <div className="s-work-fact-card-body">
        {items.map((item) => (
          <div key={item.label} className="s-work-fact-row">
            <span className="s-work-fact-label">{item.label}</span>
            <span className="s-work-fact-value">{item.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ActionRow({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="s-work-action-row" onClick={onClick}>
      <span className="s-work-action-row-label">{label}</span>
      <span className="s-work-action-row-value">{value}</span>
    </button>
  );
}

function WorkActionButton({
  children,
  icon,
  onClick,
  primary = false,
  disabled = false,
}: {
  children: ReactNode;
  icon: ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`s-work-action-button${primary ? " s-work-action-button-primary" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

function WorkMaterials({
  detail,
  navigate,
}: {
  detail: WorkDetail;
  navigate: (r: Route) => void;
}) {
  const hasThread = Boolean(detail.conversationId);
  const inventory = detail.inventory ?? fallbackInventory(detail);
  const planMaterials = inventory.materials.filter((material) =>
    material.kind === "plan" || material.kind === "spec"
  );
  const docMaterials = inventory.materials.filter((material) => material.kind === "doc");
  const codeMaterials = inventory.materials.filter((material) =>
    material.kind === "code"
    || material.kind === "test"
    || material.kind === "config"
    || material.kind === "asset"
    || material.kind === "other"
  );
  const hasPlanMaterials = planMaterials.length > 0;
  const briefSummary = initialWorkBriefSummary(detail);
  const primarySummary = planMaterials[0]
    ? materialSummary(planMaterials[0])
    : briefSummary ?? "No plan or spec file detected yet.";
  const viewableMaterials = [...planMaterials, ...docMaterials, ...codeMaterials]
    .filter((material) => material.status !== "deleted");
  const [briefOpen, setBriefOpen] = useState(false);
  const [selectedMaterialId, setSelectedMaterialId] = useState<string | null>(null);
  const [materialContent, setMaterialContent] = useState<WorkMaterialContent | null>(null);
  const [materialError, setMaterialError] = useState<string | null>(null);
  const [loadingMaterialId, setLoadingMaterialId] = useState<string | null>(null);

  const openMaterial = useCallback((materialId: string) => {
    setBriefOpen(false);
    setSelectedMaterialId(materialId);
  }, []);

  const openBrief = useCallback(() => {
    setSelectedMaterialId(null);
    setBriefOpen(true);
  }, []);

  useEffect(() => {
    if (selectedMaterialId && !viewableMaterials.some((material) => material.id === selectedMaterialId)) {
      setSelectedMaterialId(null);
    }
  }, [selectedMaterialId, viewableMaterials]);

  useEffect(() => {
    if (!selectedMaterialId) {
      setMaterialContent(null);
      setMaterialError(null);
      setLoadingMaterialId(null);
      return;
    }
    let cancelled = false;
    setLoadingMaterialId(selectedMaterialId);
    setMaterialError(null);
    void api<WorkMaterialContent>(
      `/api/work/${encodeURIComponent(detail.id)}/material?materialId=${encodeURIComponent(selectedMaterialId)}`,
    )
      .then((content) => {
        if (!cancelled) {
          setMaterialContent(content);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setMaterialContent(null);
          setMaterialError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingMaterialId(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [detail.id, selectedMaterialId]);

  return (
    <section className="s-work-casefile-section s-work-materials-section">
      <div className="s-agent-section-heading">
        <div>
          <h2 className="s-agent-section-title">Work materials</h2>
          <p className="s-work-section-note">
            {inventoryModeLabel(inventory.mode)} · {inventory.source} evidence · {inventory.confidence} confidence
          </p>
        </div>
        <div className="s-work-inventory-meta" aria-label="Inventory totals">
          <span>{inventory.totals.materials} files</span>
          <span>{inventory.totals.agents} agents</span>
          <span>{inventory.totals.sessions} sessions</span>
        </div>
      </div>
      <div className="s-work-material-grid">
        <article className="s-work-material-card s-work-material-card-primary">
          <div className="s-work-material-head">
            <span className="s-work-material-icon" aria-hidden="true">
              <FileText size={15} strokeWidth={1.8} />
            </span>
            <div>
              <div className="s-work-material-kicker">{hasPlanMaterials ? "Plans & specs" : "Brief"}</div>
              <div className="s-work-material-title">
                {hasPlanMaterials ? `${planMaterials.length} surfaced` : briefSummary ? "Original ask" : "No plan file yet"}
              </div>
            </div>
          </div>
          <p className="s-work-material-copy">{primarySummary}</p>
          <WorkMaterialList
            materials={planMaterials.slice(0, 3)}
            empty="No plan or spec files detected yet."
            selectedId={selectedMaterialId}
            onOpen={openMaterial}
          />
          {briefSummary && (
            <button
              type="button"
              className={`s-work-material-link${briefOpen ? " s-work-material-link-active" : ""}`}
              onClick={openBrief}
            >
              <FileText aria-hidden="true" size={13} strokeWidth={1.8} />
              View ask
            </button>
          )}
        </article>

        <article className="s-work-material-card">
          <div className="s-work-material-head">
            <span className="s-work-material-icon" aria-hidden="true">
              <BookOpen size={15} strokeWidth={1.8} />
            </span>
            <div>
              <div className="s-work-material-kicker">Docs</div>
              <div className="s-work-material-title">
                {docMaterials.length > 0 ? `${docMaterials.length} documents` : "No docs yet"}
              </div>
            </div>
          </div>
          <WorkMaterialList
            materials={docMaterials.slice(0, 4)}
            empty="Docs from git or trace evidence will appear here."
            selectedId={selectedMaterialId}
            onOpen={openMaterial}
          />
        </article>

        <article className="s-work-material-card">
          <div className="s-work-material-head">
            <span className="s-work-material-icon" aria-hidden="true">
              <Code2 size={15} strokeWidth={1.8} />
            </span>
            <div>
              <div className="s-work-material-kicker">Code</div>
              <div className="s-work-material-title">
                {codeMaterials.length > 0 ? `${codeMaterials.length} related files` : "No code yet"}
              </div>
            </div>
          </div>
          <WorkMaterialList
            materials={codeMaterials.slice(0, 5)}
            empty="Changed code from git or session traces will appear here."
            selectedId={selectedMaterialId}
            onOpen={openMaterial}
          />
        </article>
      </div>
      <WorkBriefViewer
        detail={detail}
        summary={briefSummary}
        open={briefOpen}
        hasThread={hasThread}
        navigate={navigate}
        onClose={() => setBriefOpen(false)}
      />
      <WorkMaterialViewer
        material={viewableMaterials.find((material) => material.id === selectedMaterialId) ?? null}
        content={materialContent}
        loading={Boolean(loadingMaterialId)}
        error={materialError}
        onClose={() => setSelectedMaterialId(null)}
      />
      {inventory.limitations.length > 0 && (
        <div className="s-work-inventory-note">{inventory.limitations[0]}</div>
      )}
    </section>
  );
}

function WorkBriefViewer({
  detail,
  summary,
  open,
  hasThread,
  navigate,
  onClose,
}: {
  detail: WorkDetail;
  summary: string | null;
  open: boolean;
  hasThread: boolean;
  navigate: (r: Route) => void;
  onClose: () => void;
}) {
  const { route } = useScout();
  if (!open || !summary) {
    return null;
  }

  const document = createTextDocument({
    id: `${detail.id}:brief`,
    title: "Original ask",
    uri: `scout://work/${detail.id}/brief`,
    mediaType: "text/markdown",
    value: `# Original ask\n\n${summary}`,
    readOnly: true,
  });

  return (
    <DocumentFocusViewer
      kind="ask"
      document={document}
      title="Original ask"
      eyebrow="Brief"
      subtitle={detail.title}
      meta={["ask", hasThread ? "thread linked" : "threadless"]}
      mode="preview"
      actions={hasThread && detail.conversationId
        ? [{
            label: "Thread",
            icon: <MessageSquare aria-hidden="true" size={13} strokeWidth={1.8} />,
            onClick: () => openContent(navigate, { view: "conversation", conversationId: detail.conversationId! }, { returnTo: route }),
            title: "Open source thread",
          }]
        : []}
      onClose={onClose}
    />
  );
}

function initialWorkBriefSummary(detail: WorkDetail): string | null {
  const oldestFirst = [...detail.timeline].sort((a, b) => a.at - b.at);
  const createdEvent = oldestFirst.find((item) =>
    item.kind === "collaboration_event"
    && item.detailKind === "created"
    && item.summary
  );
  const openingMessage = oldestFirst.find((item) => item.kind === "message" && item.summary);
  return createdEvent?.summary ?? openingMessage?.summary ?? null;
}

function fallbackInventory(detail: WorkDetail): WorkMaterialsInventory {
  return {
    workId: detail.id,
    generatedAt: Date.now(),
    mode: "trace-only",
    source: "broker",
    confidence: "low",
    agents: [],
    sessions: [],
    materials: [],
    totals: {
      materials: 0,
      plans: 0,
      specs: 0,
      docs: 0,
      code: 0,
      tests: 0,
      config: 0,
      assets: 0,
      agents: 0,
      sessions: 0,
    },
    limitations: ["Inventory is not available from this server yet."],
  };
}

function inventoryModeLabel(mode: WorkMaterialsInventory["mode"]): string {
  switch (mode) {
    case "isolated-git-worktree":
      return "Isolated git worktree";
    case "shared-git-repo":
      return "Shared git repo";
    case "explicit-artifacts":
      return "Explicit artifacts";
    case "trace-only":
    default:
      return "Trace-only";
  }
}

function materialSummary(material: WorkMaterial): string {
  const stats = material.diffStat
    ? `+${material.diffStat.additions} / -${material.diffStat.deletions}`
    : material.status;
  return `${material.path} · ${stats} · ${material.confidence} confidence`;
}

function WorkMaterialList({
  materials,
  empty,
  selectedId,
  onOpen,
}: {
  materials: WorkMaterial[];
  empty: string;
  selectedId?: string | null;
  onOpen?: (materialId: string) => void;
}) {
  if (materials.length === 0) {
    return <div className="s-work-material-empty">{empty}</div>;
  }

  return (
    <div className="s-work-material-list">
      {materials.map((material) => (
        <button
          key={material.id}
          type="button"
          className={`s-work-material-row${selectedId === material.id ? " s-work-material-row-active" : ""}`}
          title={material.path}
          onClick={() => onOpen?.(material.id)}
          disabled={!onOpen || material.status === "deleted"}
        >
          <div className="s-work-material-path">{material.path}</div>
          <div className="s-work-material-row-meta">
            <span>{material.status}</span>
            {material.diffStat && (
              <span>+{material.diffStat.additions} -{material.diffStat.deletions}</span>
            )}
            <span>{material.confidence}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function WorkMaterialViewer({
  material,
  content,
  loading,
  error,
  onClose,
}: {
  material: WorkMaterial | null;
  content: WorkMaterialContent | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  if (!material) {
    return null;
  }

  const document = content
    ? createTextDocument({
        id: content.materialId,
        title: content.title,
        uri: content.uri,
        mediaType: content.mediaType,
        value: content.content,
        readOnly: true,
      })
    : null;

  return (
    <DocumentFocusViewer
      kind={documentFocusKindForMaterial(material)}
      document={document}
      title={material.path}
      eyebrow={material.kind === "spec" ? "Spec" : material.kind}
      subtitle={content?.uri ?? material.worktreeRoot ?? undefined}
      meta={[
        material.status,
        material.confidence,
        ...(content ? [formatBytes(content.sizeBytes)] : []),
      ]}
      mode={document?.kind === "markdown" ? "preview" : "read"}
      state={loading || (!content && !error) ? "Loading file..." : null}
      error={!loading ? error : null}
      notice={content?.truncated ? `Preview truncated at ${formatBytes(content.content.length)}.` : null}
      onClose={onClose}
    />
  );
}

function documentFocusKindForMaterial(material: WorkMaterial): DocumentFocusKind {
  if (material.kind === "plan" || material.kind === "spec") {
    return "plan";
  }
  if (material.kind === "doc") {
    return "doc";
  }
  return "code";
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024)} KB`;
  }
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function compactId(id: string): string {
  const parts = id.split(".");
  return parts[parts.length - 1] || id;
}

export function WorkDetailScreen({
  workId,
  navigate,
}: {
  workId: string;
  navigate: (r: Route) => void;
}) {
  const { route } = useScout();
  const [detail, setDetail] = useState<WorkDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const next = await api<WorkDetail>(`/api/work/${encodeURIComponent(workId)}`);
      setDetail(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDetail(null);
    } finally {
      setLoaded(true);
    }
  }, [workId]);

  useEffect(() => {
    setLoaded(false);
    void load();
  }, [load]);
  useBrokerEvents(() => {
    void load();
  });

  if (!loaded) {
    return (
      <div>
        <BackToPicker slot="work" fallback={{ view: "inbox" }} navigate={navigate} />
        <div className="s-empty"><p>Loading…</p></div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="s-work-not-found">
        <BackToPicker slot="work" fallback={{ view: "inbox" }} navigate={navigate} />
        <div className="s-work-not-found-body">
          <div className="s-work-not-found-glyph" aria-hidden="true">&#x25A1;</div>
          <h2 className="s-work-not-found-title">Work item not found</h2>
          <p className="s-work-not-found-sub">
            This work item may have been removed or does not exist on this broker.
          </p>
          {error && (
            <p className="s-work-not-found-detail">{error}</p>
          )}
        </div>
      </div>
    );
  }

  const signal = signalLabel(detail.attention);
  const ownerLabel = detail.ownerName ?? detail.ownerId ?? "Unassigned";
  const nextMoveLabel = detail.nextMoveOwnerName ?? detail.nextMoveOwnerId ?? "—";
  const statusFacts: Fact[] = [
    { label: "State", value: stateLabel(detail.state) },
    { label: "Acceptance", value: detail.acceptanceState.replace(/_/g, " ") },
    { label: "Phase", value: detail.currentPhase },
    ...(signal ? [{ label: "Signal", value: signal }] : []),
  ];
  const assignmentFacts: Fact[] = [
    { label: "Owner", value: ownerLabel },
    { label: "Next move", value: nextMoveLabel },
    ...(detail.priority ? [{ label: "Priority", value: detail.priority }] : []),
    { label: "Conversation", value: detail.conversationId ? "Attached" : "None" },
  ];
  const recordFacts: Fact[] = [
    { label: "Case ID", value: detail.id },
    { label: "Created", value: fullTimestamp(detail.createdAt) },
    { label: "Updated", value: fullTimestamp(detail.updatedAt) },
    { label: "Last activity", value: fullTimestamp(detail.lastMeaningfulAt) },
  ];
  const actionCue = buildActionCue({
    detail,
    signal,
    ownerLabel,
    nextMoveLabel,
  });

  return (
    <div className="s-work-detail s-work-casefile">
      <div className="s-work-casefile-topbar">
        <BackToPicker slot="work" fallback={{ view: "inbox" }} navigate={navigate} />
        <span className="s-work-casefile-record">Case {compactId(detail.id)}</span>
      </div>

      {error && <p className="s-error">{error}</p>}

      <section className="s-work-casefile-hero">
        <div className="s-work-casefile-hero-main">
          <div className="s-work-casefile-title-row">
            <h1 className="s-work-casefile-title">{detail.title}</h1>
            <StatusPill tone={workTone(detail)} variant="pill">{detail.currentPhase}</StatusPill>
          </div>
          {detail.lastMeaningfulSummary && (
            <div className="s-work-casefile-summary">
              {renderWithMentions(detail.lastMeaningfulSummary)}
            </div>
          )}
          <div className="s-work-casefile-meta">
            <span>Updated {timeAgo(detail.updatedAt)}</span>
            <span>{ownerLabel}</span>
            <span>{stateLabel(detail.state)}</span>
            {signal && <span>{signal}</span>}
            {detail.priority && <span>Priority {detail.priority}</span>}
          </div>
        </div>

        <aside className={`s-work-next-move s-work-next-move-${actionCue.tone}`}>
          <div className="s-work-next-move-kicker">{actionCue.eyebrow}</div>
          <div className="s-work-next-move-title">{actionCue.title}</div>
          <p className="s-work-next-move-copy">{actionCue.body}</p>
          <div className="s-work-next-move-actions">
            {detail.conversationId && (
              <WorkActionButton
                primary
                icon={<MessageSquare aria-hidden="true" size={14} strokeWidth={1.8} />}
                onClick={() => openContent(navigate, { view: "conversation", conversationId: detail.conversationId! }, { returnTo: route })}
              >
                Open thread
              </WorkActionButton>
            )}
          </div>
        </aside>
      </section>

      <div className="s-work-casefile-layout">
        <div className="s-work-casefile-main">
          <WorkMaterials detail={detail} navigate={navigate} />

          <section className="s-work-casefile-section">
            <div className="s-agent-section-heading">
              <h2 className="s-agent-section-title">Case facts</h2>
            </div>
            <div className="s-work-fact-grid">
              <FactCard
                title="Status"
                items={statusFacts}
              />
              <FactCard
                title="Assignment"
                items={assignmentFacts}
              />
            </div>
          </section>

          {detail.activeFlights.length > 0 && (
            <section className="s-work-casefile-section">
              <div className="s-agent-section-heading">
                <h2 className="s-agent-section-title">Flights</h2>
              </div>
              <div className="s-work-flight-list">
                {detail.activeFlights.map((flight) => (
                  <button
                    key={flight.id}
                    type="button"
                    className="s-work-flight-card"
                    onClick={
                      flight.conversationId
                        ? () => openContent(navigate, { view: "conversation", conversationId: flight.conversationId! }, { returnTo: route })
                        : undefined
                    }
                    disabled={!flight.conversationId}
                  >
                    <div className="s-work-flight-card-header">
                      <span className="s-work-flight-card-title">{flight.agentName ?? flight.agentId}</span>
                      <StatusPill tone="working" variant="pill">{flight.state}</StatusPill>
                    </div>
                    <div className="s-work-flight-card-meta">
                      <span>{flight.startedAt ? `Started ${timeAgo(flight.startedAt)}` : "Start time unavailable"}</span>
                      {flight.completedAt && <span>Completed {timeAgo(flight.completedAt)}</span>}
                    </div>
                    {flight.summary && <div className="s-work-flight-card-copy">{flight.summary}</div>}
                  </button>
                ))}
              </div>
            </section>
          )}

          {detail.childWork.length > 0 && (
            <section className="s-work-casefile-section">
              <div className="s-agent-section-heading">
                <h2 className="s-agent-section-title">Child work</h2>
              </div>
              <div className="s-work-related-list">
                {detail.childWork.map((child) => (
                  <button
                    key={child.id}
                    type="button"
                    className="s-work-related-card"
                    onClick={() => openContent(navigate, { view: "work", workId: child.id }, { returnTo: route })}
                  >
                    <div className="s-work-related-card-header">
                      <span className="s-work-related-card-title">{child.title}</span>
                      <StatusPill tone={workChildTone(child)} variant="pill">
                        {child.currentPhase}
                      </StatusPill>
                    </div>
                    <div className="s-work-related-card-meta">
                      <span>{child.ownerName ?? child.ownerId ?? "Unassigned"}</span>
                      <span>{stateLabel(child.state)}</span>
                      <span>{timeAgo(child.lastMeaningfulAt)}</span>
                    </div>
                    {child.lastMeaningfulSummary && (
                      <div className="s-work-related-card-copy">
                        {renderWithMentions(child.lastMeaningfulSummary)}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="s-work-casefile-section">
            <div className="s-agent-section-heading">
              <h2 className="s-agent-section-title">Timeline</h2>
            </div>
            {detail.timeline.length === 0 ? (
              <div className="s-empty">
                <p>No activity yet.</p>
                <p>Timeline events will appear once the case receives messages or coordination updates.</p>
              </div>
            ) : (
              <div className="s-work-timeline">
                {detail.timeline.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`s-work-timeline-entry${item.conversationId ? " s-work-timeline-entry-clickable" : ""}`}
                    onClick={
                      item.conversationId
                        ? () => openContent(navigate, { view: "conversation", conversationId: item.conversationId! }, { returnTo: route })
                        : undefined
                    }
                    disabled={!item.conversationId}
                  >
                    <span className={`s-work-timeline-marker s-work-timeline-marker-${timelineTone(item)}`} />
                    <div className="s-work-timeline-content">
                      <div className="s-work-timeline-header">
                        <span className="s-work-timeline-time">{timeAgo(item.at)}</span>
                        <span className={`s-work-timeline-kind s-work-timeline-kind-${timelineTone(item)}`}>
                          {timelineKindLabel(item)}
                        </span>
                      </div>
                      <div className="s-work-timeline-actor">{item.actorName ?? "system"}</div>
                      {item.title && <div className="s-work-timeline-title">{item.title}</div>}
                      {item.summary && (
                        <div className="s-work-timeline-summary">{renderWithMentions(item.summary)}</div>
                      )}
                      <div className="s-work-timeline-stamp">{fullTimestamp(item.at)}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="s-work-casefile-side">
          <FactCard
            title="Record"
            items={recordFacts}
          />

          <section className="s-work-fact-card">
            <div className="s-work-fact-card-header">
              <div className="s-work-fact-card-title">Links</div>
            </div>
            <div className="s-work-action-list">
              {detail.conversationId ? (
                <ActionRow
                  label="Conversation"
                  value="Open thread"
                  onClick={() => openContent(navigate, { view: "conversation", conversationId: detail.conversationId! }, { returnTo: route })}
                />
              ) : (
                <div className="s-work-action-list-empty">No conversation attached.</div>
              )}
              {detail.parentId && detail.parentTitle ? (
                <ActionRow
                  label="Parent"
                  value={detail.parentTitle}
                  onClick={() => openContent(navigate, { view: "work", workId: detail.parentId! }, { returnTo: route })}
                />
              ) : (
                <div className="s-work-action-list-empty">No parent work item.</div>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
