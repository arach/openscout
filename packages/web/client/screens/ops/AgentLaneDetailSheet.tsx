import { useCallback, useEffect, useMemo, useState } from "react";

import { SlidePanel } from "../../components/SlidePanel/SlidePanel.tsx";
import { api } from "../../lib/api.ts";
import { AgentAvatar } from "../../components/AgentAvatar.tsx";
import { timeAgo } from "../../lib/time.ts";
import { tailAttributionLabel } from "../../lib/tail-display.ts";
import type { PlanDocument, PlanDocumentStepStatus, PlanDocumentsResponse, Route } from "../../lib/types.ts";
import { openAgent } from "../../scout/slots/openAgent.ts";
import { filePreviewLabel } from "./agent-lane-preview.ts";
import {
  buildLaneSessionStats,
  buildLaneTouchedFiles,
  docExcerpt,
  relatedLaneSessionDocuments,
} from "./agent-lane-detail.ts";
import type { AgentLane } from "./agent-lanes-model.ts";
import {
  laneContextLabel,
  lanePrimaryLabel,
  laneStatusLabel,
} from "./agent-lanes-model.ts";

const FILE_STATE_LABEL: Record<string, string> = {
  created: "new",
  modified: "mod",
  read: "read",
};

const PLAN_STEP_LABELS: Record<PlanDocumentStepStatus, string> = {
  blocked: "blocked",
  completed: "done",
  in_progress: "active",
  pending: "todo",
  unknown: "step",
};

function fmtCount(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toLocaleString();
}

function fmtPath(value: string | null | undefined, max = 48): string {
  if (!value) return "—";
  if (value.length <= max) return value;
  return `…${value.slice(-(max - 1))}`;
}

function SessionDocumentCard({
  document,
  expanded,
  onToggle,
  onOpen,
}: {
  document: PlanDocument;
  expanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const excerpt = docExcerpt(document);
  const isPlan = document.steps.length > 0;

  return (
    <article className={`s-lane-sheet-doc${isPlan ? " s-lane-sheet-doc--plan" : ""}`}>
      <button
        type="button"
        className="s-lane-sheet-doc-head"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className="s-lane-sheet-doc-title">{document.title}</span>
        <span className="s-lane-sheet-doc-meta">
          {isPlan ? `${document.steps.length} steps` : filePreviewLabel(document.path)} · {timeAgo(document.updatedAt)}
        </span>
        {!expanded && excerpt && <span className="s-lane-sheet-doc-excerpt">{excerpt}</span>}
      </button>
      {expanded && (
        <div className="s-lane-sheet-doc-body">
          {document.summary && <p className="s-lane-sheet-doc-summary">{document.summary}</p>}
          {isPlan && document.steps.length > 0 && (
            <ol className="s-lane-sheet-plan-steps">
              {document.steps.map((step) => (
                <li
                  key={step.id}
                  className={`s-lane-sheet-plan-step s-lane-sheet-plan-step--${step.status}`}
                >
                  <span className="s-lane-sheet-plan-step-state">
                    {PLAN_STEP_LABELS[step.status]}
                  </span>
                  <span className="s-lane-sheet-plan-step-text">{step.text}</span>
                </li>
              ))}
            </ol>
          )}
          {(document.body || document.rawText) && (
            <pre className="s-lane-sheet-plan-doc">{document.body || document.rawText}</pre>
          )}
          <button type="button" className="s-lane-sheet-plan-open" onClick={onOpen}>
            Open in Plans
          </button>
        </div>
      )}
    </article>
  );
}

export function AgentLaneDetailSheet({
  lane,
  navigate,
  returnRoute,
  onClose,
}: {
  lane: AgentLane;
  navigate: (route: Route) => void;
  returnRoute: Route;
  onClose: () => void;
}) {
  const { agent, observe, source, lastActiveAt } = lane;
  const [documentsLoaded, setDocumentsLoaded] = useState(false);
  const [plans, setPlans] = useState<PlanDocument[]>([]);
  const [docs, setDocs] = useState<PlanDocument[]>([]);
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);

  const primaryLabel = lanePrimaryLabel(agent, source);
  const statusLabel = laneStatusLabel(agent, source);
  const contextLabel = laneContextLabel(agent, source);
  const stats = useMemo(() => buildLaneSessionStats(lane), [lane]);
  const facts = lane.facts;
  const touchedFiles = useMemo(
    () => (facts?.touchedFiles.length ? facts.touchedFiles.slice(0, 10) : buildLaneTouchedFiles(observe)),
    [facts, observe],
  );
  const usage = facts?.usage ?? stats.usage;

  const usageCards = useMemo(() => {
    if (!usage) return [];
    return [
      { label: "Input", value: usage.inputTokens },
      { label: "Output", value: usage.outputTokens },
      { label: "Cache read", value: usage.cacheReadInputTokens },
      { label: "Cache write", value: usage.cacheCreationInputTokens },
      { label: "Total", value: usage.totalTokens },
      { label: "Reasoning", value: usage.reasoningOutputTokens },
    ].filter((entry) => typeof entry.value === "number");
  }, [usage]);

  const openSession = useCallback(() => {
    if (source === "scout" || agent.agentClass !== "organic") {
      openAgent(navigate, agent, { returnTo: returnRoute, observe: true });
      return;
    }
    navigate({ view: "ops", mode: "tail", tailQuery: agent.harnessSessionId ?? agent.harness ?? agent.name });
  }, [agent, navigate, returnRoute, source]);

  const openDocument = useCallback(
    (documentId: string) => {
      navigate({ view: "ops", mode: "plan", planDocumentId: documentId });
      onClose();
    },
    [navigate, onClose],
  );

  useEffect(() => {
    let cancelled = false;
    setDocumentsLoaded(false);
    void api<PlanDocumentsResponse>("/api/plan-documents")
      .then((inventory) => {
        if (cancelled) return;
        const related = relatedLaneSessionDocuments(inventory.documents, lane);
        setPlans(related.plans);
        setDocs(related.docs);
        setDocumentsLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setPlans([]);
        setDocs([]);
        setDocumentsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [lane.id]);

  return (
    <SlidePanel
      open
      onClose={onClose}
      side="right"
      owner="openscout.agent-lane"
      resizable
      defaultSize={720}
      minSize={420}
      maxSize={960}
      scrollLock
      ariaLabel={`${primaryLabel} lane detail`}
      className="s-lane-sheet"
    >
      <div className="s-slide-header s-lane-sheet-header">
        <AgentAvatar
          agent={agent}
          placement="row"
          size={28}
          presence={false}
          className="s-agent-lane-avatar"
        />
        <div className="s-lane-sheet-header-copy">
          <div className="s-lane-sheet-title">{primaryLabel}</div>
          <div className="s-lane-sheet-sub">
            {contextLabel} · {lastActiveAt ? timeAgo(lastActiveAt) : "idle"}
          </div>
        </div>
        <span className="s-lane-sheet-status">
          <span className="s-agent-lane-summary-badge">{statusLabel}</span>
        </span>
        <span className="s-slide-spacer" />
        <button type="button" className="s-slide-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="s-lane-sheet-actions">
        <button type="button" className="s-lane-sheet-action s-lane-sheet-action--primary" onClick={openSession}>
          Open session
        </button>
        <button
          type="button"
          className="s-lane-sheet-action"
          onClick={() => navigate({ view: "ops", mode: "plan" })}
        >
          All plans
        </button>
      </div>

      <div className="s-slide-body s-lane-sheet-body">
        <section className="s-lane-sheet-section">
          <h3 className="s-lane-sheet-h">Lane facts</h3>
          <dl className="s-lane-sheet-meta">
            <div className="s-lane-sheet-meta-row">
              <dt>Model</dt>
              <dd title={facts?.model ?? stats.model ?? undefined}>{facts?.model ?? stats.model ?? "—"}</dd>
            </div>
            <div className="s-lane-sheet-meta-row">
              <dt>Effort</dt>
              <dd>{facts?.effort ?? "—"}</dd>
            </div>
            <div className="s-lane-sheet-meta-row">
              <dt>Origin</dt>
              <dd title={facts?.originator}>{facts?.originator ?? "—"}</dd>
            </div>
            <div className="s-lane-sheet-meta-row">
              <dt>Attribution</dt>
              <dd>{facts?.attribution ? tailAttributionLabel(facts.attribution) : "—"}</dd>
            </div>
            <div className="s-lane-sheet-meta-row">
              <dt>Turn</dt>
              <dd>
                {facts?.turn
                  ? `${facts.turn.phase}${facts.turn.index ? ` · #${facts.turn.index}` : ""}`
                  : "—"}
              </dd>
            </div>
            <div className="s-lane-sheet-meta-row">
              <dt>Branch</dt>
              <dd title={facts?.branch ?? stats.branch ?? undefined}>{facts?.branch ?? stats.branch ?? "—"}</dd>
            </div>
            <div className="s-lane-sheet-meta-row">
              <dt>Working dir</dt>
              <dd title={stats.cwd ?? undefined}>{fmtPath(stats.cwd)}</dd>
            </div>
            <div className="s-lane-sheet-meta-row">
              <dt>Session</dt>
              <dd title={stats.sessionId ?? undefined}>{fmtPath(stats.sessionId, 36)}</dd>
            </div>
            {facts?.currentTask && (
              <div className="s-lane-sheet-meta-row">
                <dt>Task</dt>
                <dd title={facts.currentTask}>{facts.currentTask}</dd>
              </div>
            )}
          </dl>
          {usageCards.length > 0 && (
            <div className="s-lane-sheet-usage">
              {usageCards.map((entry) => (
                <div key={entry.label} className="s-lane-sheet-usage-card">
                  <span className="s-lane-sheet-usage-value">{fmtCount(entry.value)}</span>
                  <span className="s-lane-sheet-usage-label">{entry.label}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="s-lane-sheet-section">
          <h3 className="s-lane-sheet-h">Session stats</h3>
          <div className="s-lane-sheet-stats">
            <div className="s-lane-sheet-stat">
              <span className="s-lane-sheet-stat-value">{fmtCount(stats.tools)}</span>
              <span className="s-lane-sheet-stat-label">tools</span>
            </div>
            <div className="s-lane-sheet-stat">
              <span className="s-lane-sheet-stat-value">{fmtCount(stats.edits)}</span>
              <span className="s-lane-sheet-stat-label">edits</span>
            </div>
            <div className="s-lane-sheet-stat">
              <span className="s-lane-sheet-stat-value">{fmtCount(stats.reads)}</span>
              <span className="s-lane-sheet-stat-label">reads</span>
            </div>
            <div className="s-lane-sheet-stat">
              <span className="s-lane-sheet-stat-value">{fmtCount(stats.thinks)}</span>
              <span className="s-lane-sheet-stat-label">thinks</span>
            </div>
            <div className="s-lane-sheet-stat">
              <span className="s-lane-sheet-stat-value">{fmtCount(stats.files)}</span>
              <span className="s-lane-sheet-stat-label">files</span>
            </div>
            <div className="s-lane-sheet-stat">
              <span className="s-lane-sheet-stat-value">{fmtCount(stats.events)}</span>
              <span className="s-lane-sheet-stat-label">events</span>
            </div>
          </div>
          <dl className="s-lane-sheet-meta">
            <div className="s-lane-sheet-meta-row">
              <dt>Model</dt>
              <dd title={stats.model ?? undefined}>{stats.model ?? "—"}</dd>
            </div>
            <div className="s-lane-sheet-meta-row">
              <dt>Harness</dt>
              <dd>{stats.harness ?? "—"}</dd>
            </div>
            <div className="s-lane-sheet-meta-row">
              <dt>Branch</dt>
              <dd title={stats.branch ?? undefined}>{stats.branch ?? "—"}</dd>
            </div>
            <div className="s-lane-sheet-meta-row">
              <dt>Working dir</dt>
              <dd title={stats.cwd ?? undefined}>{fmtPath(stats.cwd)}</dd>
            </div>
            <div className="s-lane-sheet-meta-row">
              <dt>Session</dt>
              <dd title={stats.sessionId ?? undefined}>{fmtPath(stats.sessionId, 36)}</dd>
            </div>
          </dl>
        </section>

        <section className="s-lane-sheet-section">
          <h3 className="s-lane-sheet-h">
            Plans
            {documentsLoaded && plans.length > 0 && (
              <span className="s-lane-sheet-h-count">{plans.length}</span>
            )}
          </h3>
          {!documentsLoaded ? (
            <div className="s-lane-sheet-empty">Indexing plan documents…</div>
          ) : plans.length === 0 ? (
            <div className="s-lane-sheet-empty">No plans matched this session yet.</div>
          ) : (
            <div className="s-lane-sheet-docs">
              {plans.map((plan) => (
                <SessionDocumentCard
                  key={plan.id}
                  document={plan}
                  expanded={expandedDocId === plan.id}
                  onToggle={() => setExpandedDocId((current) => (current === plan.id ? null : plan.id))}
                  onOpen={() => openDocument(plan.id)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="s-lane-sheet-section">
          <h3 className="s-lane-sheet-h">
            Docs
            {documentsLoaded && docs.length > 0 && (
              <span className="s-lane-sheet-h-count">{docs.length}</span>
            )}
          </h3>
          {!documentsLoaded ? (
            <div className="s-lane-sheet-empty">Indexing documents…</div>
          ) : docs.length === 0 ? (
            <div className="s-lane-sheet-empty">No related docs matched this session yet.</div>
          ) : (
            <div className="s-lane-sheet-docs">
              {docs.map((doc) => (
                <SessionDocumentCard
                  key={doc.id}
                  document={doc}
                  expanded={expandedDocId === doc.id}
                  onToggle={() => setExpandedDocId((current) => (current === doc.id ? null : doc.id))}
                  onOpen={() => openDocument(doc.id)}
                />
              ))}
            </div>
          )}
        </section>

        <section className="s-lane-sheet-section">
          <h3 className="s-lane-sheet-h">
            Touched files
            {touchedFiles.length > 0 && (
              <span className="s-lane-sheet-h-count">{touchedFiles.length}</span>
            )}
          </h3>
          {touchedFiles.length === 0 ? (
            <div className="s-lane-sheet-empty">No files touched in this session yet.</div>
          ) : (
            <div className="s-lane-sheet-files">
              {touchedFiles.map((file) => (
                <article key={file.path} className="s-lane-sheet-file" title={file.path}>
                  <div className="s-lane-sheet-file-head">
                    <span className={`s-lane-sheet-file-state s-lane-sheet-file-state--${file.state}`}>
                      {FILE_STATE_LABEL[file.state] ?? file.state}
                    </span>
                    <span className="s-lane-sheet-file-path">{filePreviewLabel(file)}</span>
                    <span className="s-lane-sheet-file-meta">×{file.touches}</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </SlidePanel>
  );
}
