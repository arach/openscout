import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";

import { SlidePanel } from "../../components/SlidePanel/SlidePanel.tsx";
import { api } from "../../lib/api.ts";
import { AgentAvatar } from "../../components/AgentAvatar.tsx";
import { timeAgo } from "../../lib/time.ts";
import { tailAttributionLabel } from "../../lib/tail-display.ts";
import { isAgentBusy } from "../../lib/agent-state.ts";
import { copyTextToClipboard } from "../../lib/clipboard.ts";
import { useScout } from "../../scout/Provider.tsx";
import type { ObserveData, ObserveEvent, ObserveFile, PlanDocument, PlanDocumentStepStatus, PlanDocumentsResponse, Route } from "../../lib/types.ts";
import { bashDisplaySpans, splitCdPrefix, tildeShortenPath } from "../../lib/bash-format.ts";
import { openAgent } from "../../scout/slots/openAgent.ts";
import { buildAgentLanePreview, filePreviewLabel } from "./agent-lane-preview.ts";
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

/** Tool names that are a shell command across both harness idioms (mirrors
 *  SessionObserve's bash family list so the Commands panel reads the same set). */
const BASH_TOOL_NAMES = new Set([
  "bash", "shell", "terminal", "exec", "run", "command",
  "exec_command", "shell_command", "local_shell", "container_exec", "container.exec",
]);

/** A recent shell command pulled from the trace, with its one-line outcome. */
type LaneCommand = { id: string; command: string; outcome: string | null };

/** Pull the command string out of a bash tool arg — usually a plain string, but
 *  some harnesses wrap it as `{"command":"…"}` JSON. */
function decodeBashArg(arg: string | undefined): string {
  const raw = arg?.trim();
  if (!raw) return "";
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const key of ["command", "cmd", "script", "input", "code"]) {
        const value = parsed[key];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
    } catch {
      // fall through to the raw string
    }
  }
  return raw;
}

/** A short, single-token outcome for a command row (exit/match/commit count). */
function commandOutcome(event: ObserveEvent): string | null {
  const result = event.result;
  if (result) {
    for (const key of ["status", "exit", "matches", "result", "summary"]) {
      const value = result[key];
      if (value != null && `${value}`.trim()) return `${value}`.trim().slice(0, 24);
    }
  }
  return null;
}

/** The recent shell commands run this session, newest last (trace order). */
function laneRecentCommands(observe: ObserveData | null | undefined, limit = 12): LaneCommand[] {
  if (!observe) return [];
  const commands: LaneCommand[] = [];
  for (const event of observe.events) {
    if (event.kind !== "tool") continue;
    if (!BASH_TOOL_NAMES.has((event.tool ?? "").trim().toLowerCase())) continue;
    const decoded = decodeBashArg(event.arg);
    if (!decoded || decoded === "started" || decoded === "completed" || decoded.startsWith("[")) continue;
    commands.push({ id: event.id, command: decoded, outcome: commandOutcome(event) });
  }
  return commands.slice(-limit);
}

/** A touched file enriched with the aggregate +adds / −dels from the trace's
 *  tool diffs, since ObserveFile carries no per-file diff stat of its own. */
type LaneFileEntry = ObserveFile & { add: number; del: number };

/** Sum the per-event diff add/del onto each touched file, keyed by basename so
 *  a relative tool arg and an absolute file path still line up. */
function laneFilesWithDiff(
  files: ObserveFile[],
  observe: ObserveData | null | undefined,
): LaneFileEntry[] {
  const diffByLeaf = new Map<string, { add: number; del: number }>();
  for (const event of observe?.events ?? []) {
    if (event.kind !== "tool" || !event.diff || !event.arg) continue;
    const leaf = event.arg.trim().split(/[\\/]/).filter(Boolean).pop();
    if (!leaf) continue;
    const acc = diffByLeaf.get(leaf) ?? { add: 0, del: 0 };
    acc.add += event.diff.add ?? 0;
    acc.del += event.diff.del ?? 0;
    diffByLeaf.set(leaf, acc);
  }
  return files.map((file) => {
    const leaf = file.path.split(/[\\/]/).filter(Boolean).pop() ?? file.path;
    const diff = diffByLeaf.get(leaf);
    return { ...file, add: diff?.add ?? 0, del: diff?.del ?? 0 };
  });
}

function fmtPath(value: string | null | undefined, max = 48): string {
  if (!value) return "—";
  if (value.length <= max) return value;
  return `…${value.slice(-(max - 1))}`;
}

/** POST a reveal request so the OS file browser jumps to a local path. */
async function revealLocalPath(input: {
  path: string;
  basePath?: string | null;
  agentId?: string | null;
  sessionId?: string | null;
}) {
  await api<{ ok: true; path: string }>("/api/local-path/reveal", {
    method: "POST",
    body: JSON.stringify({
      path: input.path,
      ...(input.basePath ? { basePath: input.basePath } : {}),
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    }),
  });
}

/** Resolve a (possibly relative) path against the session cwd, the same way the
 *  observe trace does, so open/reveal target the real file on disk. */
function resolveLanePath(path: string, basePath: string | null | undefined): string {
  if (path.startsWith("/") || path.startsWith("~/")) return path;
  return basePath ? `${basePath.replace(/\/$/u, "")}/${path}` : path;
}

/** A small hover-revealed copy target — copies the FULL value even when the row
 *  shows a truncation, flashes a check. Mirrors the lane card's CopyDot so copy
 *  reads the same everywhere. */
function SheetCopy({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);
  const onCopy = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      void copyTextToClipboard(value).then((ok) => {
        if (!ok) return;
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 1100);
      });
    },
    [value],
  );
  return (
    <button
      type="button"
      className={`s-lane-sheet-copy${copied ? " s-lane-sheet-copy--done" : ""}`}
      onClick={onCopy}
      title={copied ? "Copied" : `Copy ${label}`}
      aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
    >
      {copied ? (
        <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
          <path d="M2.5 6.2 4.8 8.5 9.5 3.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
          <rect x="3.4" y="3.4" width="5.8" height="5.8" rx="1.3" fill="none" stroke="currentColor" strokeWidth="1" />
          <path d="M2.4 7.2V2.8c0-.4.3-.7.7-.7h4" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

/** Reveal-in-OS button for a local path (same affordance as the observe trace). */
function RevealButton({
  path,
  basePath,
  agentId,
  sessionId,
  label,
}: {
  path: string;
  basePath?: string | null;
  agentId?: string | null;
  sessionId?: string | null;
  label: string;
}) {
  return (
    <button
      type="button"
      className="s-lane-sheet-reveal"
      title={`Reveal ${label} in OS`}
      aria-label={`Reveal ${label} in OS`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void revealLocalPath({ path, basePath, agentId, sessionId }).catch((error) =>
          console.warn("Failed to reveal local path", error),
        );
      }}
    >
      <ExternalLink size={11} strokeWidth={1.6} />
    </button>
  );
}

/** One runtime fact: label · value (ellipsised) · hover copy/reveal targets. The
 *  display can be truncated while copy/reveal carry the full value. */
function SheetFact({
  label,
  value,
  title,
  copy,
  reveal,
}: {
  label: string;
  value: string;
  title?: string;
  copy?: string | null;
  reveal?: { path: string; basePath?: string | null; agentId?: string | null; sessionId?: string | null };
}) {
  return (
    <div className="s-lane-sheet-meta-row">
      <dt>{label}</dt>
      <dd className="s-lane-sheet-fact">
        <span className="s-lane-sheet-fact-val" title={title ?? value}>{value}</span>
        {reveal && <RevealButton {...reveal} label={label} />}
        {copy && <SheetCopy value={copy} label={label} />}
      </dd>
    </div>
  );
}

/** A touched-file row that JUMPS (open in Scout · reveal in OS) and COPIES its
 *  full path — turning the dead inventory list into an actionable one. */
function SheetFileRow({
  file,
  basePath,
  agentId,
  sessionId,
  onOpen,
}: {
  file: LaneFileEntry;
  basePath: string | null;
  agentId?: string | null;
  sessionId?: string | null;
  onOpen: (path: string) => void;
}) {
  const label = filePreviewLabel(file);
  const full = file.path;
  const resolved = resolveLanePath(full, basePath);
  const hasDiff = file.add > 0 || file.del > 0;
  return (
    <article className="s-lane-sheet-file" title={full}>
      <div className="s-lane-sheet-file-head">
        <span className={`s-lane-sheet-file-state s-lane-sheet-file-state--${file.state}`}>
          {FILE_STATE_LABEL[file.state] ?? file.state}
        </span>
        <button
          type="button"
          className="s-lane-sheet-file-open"
          title={`Preview ${label} in Scout`}
          onClick={() => onOpen(resolved)}
        >
          {label}
        </button>
        <span className="s-lane-sheet-file-actions">
          {hasDiff ? (
            <span className="s-lane-sheet-file-diff">
              {file.add > 0 && <span className="s-lane-sheet-file-add">+{file.add}</span>}
              {file.del > 0 && <span className="s-lane-sheet-file-del">−{file.del}</span>}
            </span>
          ) : (
            <span className="s-lane-sheet-file-meta">×{file.touches}</span>
          )}
          <RevealButton path={full} basePath={basePath} agentId={agentId} sessionId={sessionId} label={label} />
          <SheetCopy value={full} label="file path" />
        </span>
      </div>
    </article>
  );
}

/** One recent shell command, tiered the same way the observe trace reads it
 *  (program · args · plumbing), with hover copy of the full command. */
function LaneCommandRow({ entry }: { entry: LaneCommand }) {
  const { dir, rest } = splitCdPrefix(tildeShortenPath(entry.command));
  const spans = bashDisplaySpans(rest || entry.command);
  return (
    <div className="s-lane-sheet-cmd" title={entry.command}>
      <span className="s-lane-sheet-cmd-prompt" aria-hidden="true">❯</span>
      <span className="s-lane-sheet-cmd-text">
        {dir && <span className="s-lane-sheet-bash-dir">{dir}/</span>}
        {spans.map((span, index) => (
          <span
            key={index}
            className={`s-lane-sheet-bash-${span.tier}${span.known ? " s-lane-sheet-bash-prog--known" : ""}${span.flag ? " s-lane-sheet-bash-flag" : ""}`}
          >
            {index > 0 ? " " : ""}{span.text}
          </span>
        ))}
      </span>
      {entry.outcome && <span className="s-lane-sheet-cmd-outcome">{entry.outcome}</span>}
      <span className="s-lane-sheet-cmd-actions">
        <SheetCopy value={entry.command} label="command" />
      </span>
    </div>
  );
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
  const { openFilePreview } = useScout();
  const working = useMemo(() => isAgentBusy(agent.state ?? null, agent), [agent]);
  const preview = useMemo(
    () => buildAgentLanePreview(observe, agent, { isLive: working }),
    [observe, agent, working],
  );
  const [documentsLoaded, setDocumentsLoaded] = useState(false);
  const [plans, setPlans] = useState<PlanDocument[]>([]);
  const [docs, setDocs] = useState<PlanDocument[]>([]);
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
  const [readOpen, setReadOpen] = useState(false);
  const [changedCopied, setChangedCopied] = useState(false);
  const changedCopyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (changedCopyTimer.current) clearTimeout(changedCopyTimer.current);
  }, []);

  const primaryLabel = lanePrimaryLabel(agent, source);
  const statusLabel = laneStatusLabel(agent, source);
  const contextLabel = laneContextLabel(agent, source);
  const stats = useMemo(() => buildLaneSessionStats(lane), [lane]);
  const facts = lane.facts;

  // The complete touched-file inventory (no arbitrary cap) enriched with the
  // per-file +adds/−dels summed from the trace's tool diffs, then split into the
  // changed (created/modified) and read groups the studio inventory shows.
  const fileGroups = useMemo(() => {
    const source = facts?.touchedFiles.length ? facts.touchedFiles : buildLaneTouchedFiles(observe, Infinity);
    const enriched = laneFilesWithDiff(source, observe);
    const created = enriched.filter((file) => file.state === "created");
    const modified = enriched.filter((file) => file.state === "modified");
    const read = enriched.filter((file) => file.state === "read");
    const changed = [...created, ...modified];
    return {
      created,
      modified,
      read,
      changed,
      totalAdd: changed.reduce((sum, file) => sum + file.add, 0),
      totalDel: changed.reduce((sum, file) => sum + file.del, 0),
    };
  }, [facts, observe]);
  const touchedCount = fileGroups.changed.length + fileGroups.read.length;

  const commands = useMemo(() => laneRecentCommands(observe), [observe]);

  // Bulk-action payloads: every changed path, and the diff target for "open all".
  const changedPaths = useMemo(
    () => fileGroups.changed.map((file) => resolveLanePath(file.path, stats.cwd)).join("\n"),
    [fileGroups.changed, stats.cwd],
  );

  const openAllInDiff = useCallback(() => {
    for (const file of fileGroups.changed) {
      openFilePreview(resolveLanePath(file.path, stats.cwd));
    }
  }, [fileGroups.changed, stats.cwd, openFilePreview]);

  const copyChanged = useCallback(() => {
    if (!changedPaths) return;
    void copyTextToClipboard(changedPaths).then((ok) => {
      if (!ok) return;
      setChangedCopied(true);
      if (changedCopyTimer.current) clearTimeout(changedCopyTimer.current);
      changedCopyTimer.current = setTimeout(() => setChangedCopied(false), 1100);
    });
  }, [changedPaths]);

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

      <nav className="s-lane-sheet-anchors" aria-label="Jump to section">
        {preview && (
          <a href="#s-lane-sheet-now" className="s-lane-sheet-anchor">Now</a>
        )}
        <a href="#s-lane-sheet-runtime" className="s-lane-sheet-anchor">Runtime</a>
        {usageCards.length > 0 && (
          <a href="#s-lane-sheet-usage" className="s-lane-sheet-anchor">Usage</a>
        )}
        <a href="#s-lane-sheet-files" className="s-lane-sheet-anchor">
          Files{touchedCount > 0 && <span className="s-lane-sheet-anchor-n">{touchedCount}</span>}
        </a>
        {commands.length > 0 && (
          <a href="#s-lane-sheet-commands" className="s-lane-sheet-anchor">
            Commands<span className="s-lane-sheet-anchor-n">{commands.length}</span>
          </a>
        )}
        <a href="#s-lane-sheet-plans" className="s-lane-sheet-anchor">Plans</a>
        <a href="#s-lane-sheet-docs" className="s-lane-sheet-anchor">Docs</a>
      </nav>

      <div className="s-slide-body s-lane-sheet-body">
        {preview && (
          <section id="s-lane-sheet-now" className="s-lane-sheet-section s-lane-sheet-now">
            <h3 className="s-lane-sheet-h">Now</h3>
            <div className={`s-lane-sheet-now-line${preview.headlineFrom ? "" : " s-lane-sheet-now-line--console"}`}>
              {preview.headlineFrom === "user" ? (
                <span className="s-lane-sheet-now-mark" aria-hidden="true">←</span>
              ) : preview.headlineFrom === "agent" ? (
                <span className="s-lane-sheet-now-mark" aria-hidden="true">→</span>
              ) : (
                <span className="s-lane-sheet-now-mark s-lane-sheet-now-prompt" aria-hidden="true">❯</span>
              )}
              <span className="s-lane-sheet-now-text" title={preview.headFull}>{preview.headline}</span>
              {preview.headFull && preview.headFull !== preview.headline && (
                <SheetCopy value={preview.headFull} label="current action" />
              )}
            </div>
            <div className="s-lane-sheet-now-foot">
              {facts?.turn && (
                <span className="s-lane-sheet-now-turn">
                  turn · {facts.turn.phase}{facts.turn.index ? ` · #${facts.turn.index}` : ""}
                </span>
              )}
              <button type="button" className="s-lane-sheet-now-jump" onClick={openSession}>
                Open trace →
              </button>
            </div>
          </section>
        )}

        <section id="s-lane-sheet-runtime" className="s-lane-sheet-section">
          <h3 className="s-lane-sheet-h">Runtime</h3>
          <dl className="s-lane-sheet-meta">
            <SheetFact label="Model" value={facts?.model ?? stats.model ?? "—"} copy={facts?.model ?? stats.model ?? null} />
            <SheetFact label="Effort" value={facts?.effort ?? "—"} />
            <SheetFact label="Harness" value={agent.harness ?? stats.harness ?? "—"} copy={agent.harness ?? stats.harness ?? null} />
            <SheetFact label="Branch" value={facts?.branch ?? stats.branch ?? "—"} copy={facts?.branch ?? stats.branch ?? null} />
            <SheetFact
              label="Working dir"
              value={fmtPath(stats.cwd)}
              title={stats.cwd ?? undefined}
              copy={stats.cwd ?? null}
              reveal={stats.cwd ? { path: stats.cwd, basePath: stats.cwd, agentId: agent.id, sessionId: stats.sessionId } : undefined}
            />
            <SheetFact
              label="Session"
              value={fmtPath(stats.sessionId, 36)}
              title={stats.sessionId ?? undefined}
              copy={stats.sessionId ?? null}
            />
            {agent.harnessLogPath && (
              <SheetFact
                label="Transcript"
                value={fmtPath(agent.harnessLogPath, 36)}
                title={agent.harnessLogPath}
                copy={agent.harnessLogPath}
                reveal={{ path: agent.harnessLogPath, basePath: stats.cwd, agentId: agent.id, sessionId: stats.sessionId }}
              />
            )}
            <SheetFact label="Origin" value={facts?.originator ?? "—"} copy={facts?.originator ?? null} />
            <SheetFact
              label="Attribution"
              value={facts?.attribution ? tailAttributionLabel(facts.attribution) : "—"}
            />
            {facts?.currentTask && (
              <SheetFact label="Task" value={facts.currentTask} title={facts.currentTask} copy={facts.currentTask} />
            )}
          </dl>
        </section>

        {usageCards.length > 0 && (
          <section id="s-lane-sheet-usage" className="s-lane-sheet-section">
            <h3 className="s-lane-sheet-h">Usage</h3>
            <div className="s-lane-sheet-usage">
              {usageCards.map((entry) => (
                <div key={entry.label} className="s-lane-sheet-usage-card">
                  <span className="s-lane-sheet-usage-value">{fmtCount(entry.value)}</span>
                  <span className="s-lane-sheet-usage-label">{entry.label}</span>
                </div>
              ))}
            </div>
          </section>
        )}

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
        </section>

        <section id="s-lane-sheet-files" className="s-lane-sheet-section">
          <h3 className="s-lane-sheet-h">
            Files
            {touchedCount > 0 && (
              <span className="s-lane-sheet-h-count">
                {fileGroups.changed.length} changed · {fileGroups.read.length} read
              </span>
            )}
            {fileGroups.changed.length > 0 && (
              <span className="s-lane-sheet-files-tools">
                {(fileGroups.totalAdd > 0 || fileGroups.totalDel > 0) && (
                  <span className="s-lane-sheet-file-diff" aria-hidden="true">
                    {fileGroups.totalAdd > 0 && <span className="s-lane-sheet-file-add">+{fileGroups.totalAdd}</span>}
                    {fileGroups.totalDel > 0 && <span className="s-lane-sheet-file-del">−{fileGroups.totalDel}</span>}
                  </span>
                )}
                <button
                  type="button"
                  className={`s-lane-sheet-bulk${changedCopied ? " s-lane-sheet-bulk--done" : ""}`}
                  onClick={copyChanged}
                >
                  {changedCopied ? "Copied" : "Copy changed"}
                </button>
                <button type="button" className="s-lane-sheet-bulk" onClick={openAllInDiff}>
                  Open all → diff
                </button>
              </span>
            )}
          </h3>
          {touchedCount === 0 ? (
            <div className="s-lane-sheet-empty">No files touched in this session yet.</div>
          ) : (
            <div className="s-lane-sheet-filegroups">
              {fileGroups.created.length > 0 && (
                <div className="s-lane-sheet-filegroup">
                  <div className="s-lane-sheet-fglabel">
                    <span className="s-lane-sheet-fgmark s-lane-sheet-fgmark--created" aria-hidden="true" />
                    new
                    <span className="s-lane-sheet-fgcount">{fileGroups.created.length}</span>
                  </div>
                  <div className="s-lane-sheet-files">
                    {fileGroups.created.map((file) => (
                      <SheetFileRow
                        key={file.path}
                        file={file}
                        basePath={stats.cwd}
                        agentId={agent.id}
                        sessionId={stats.sessionId}
                        onOpen={openFilePreview}
                      />
                    ))}
                  </div>
                </div>
              )}
              {fileGroups.modified.length > 0 && (
                <div className="s-lane-sheet-filegroup">
                  <div className="s-lane-sheet-fglabel">
                    <span className="s-lane-sheet-fgmark s-lane-sheet-fgmark--modified" aria-hidden="true" />
                    modified
                    <span className="s-lane-sheet-fgcount">{fileGroups.modified.length}</span>
                  </div>
                  <div className="s-lane-sheet-files">
                    {fileGroups.modified.map((file) => (
                      <SheetFileRow
                        key={file.path}
                        file={file}
                        basePath={stats.cwd}
                        agentId={agent.id}
                        sessionId={stats.sessionId}
                        onOpen={openFilePreview}
                      />
                    ))}
                  </div>
                </div>
              )}
              {fileGroups.read.length > 0 && (
                <div className="s-lane-sheet-filegroup">
                  <button
                    type="button"
                    className="s-lane-sheet-fglabel s-lane-sheet-fglabel--btn"
                    aria-expanded={readOpen}
                    onClick={() => setReadOpen((open) => !open)}
                  >
                    <span className={`s-lane-sheet-fgcaret${readOpen ? " s-lane-sheet-fgcaret--open" : ""}`} aria-hidden="true">›</span>
                    <span className="s-lane-sheet-fgmark s-lane-sheet-fgmark--read" aria-hidden="true" />
                    read
                    <span className="s-lane-sheet-fgcount">{fileGroups.read.length}</span>
                    {!readOpen && <span className="s-lane-sheet-fghint">collapsed</span>}
                  </button>
                  {readOpen && (
                    <div className="s-lane-sheet-files">
                      {fileGroups.read.map((file) => (
                        <SheetFileRow
                          key={file.path}
                          file={file}
                          basePath={stats.cwd}
                          agentId={agent.id}
                          sessionId={stats.sessionId}
                          onOpen={openFilePreview}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {commands.length > 0 && (
          <section id="s-lane-sheet-commands" className="s-lane-sheet-section">
            <h3 className="s-lane-sheet-h">
              Commands
              <span className="s-lane-sheet-h-count">recent</span>
            </h3>
            <div className="s-lane-sheet-cmds">
              {commands.map((entry) => (
                <LaneCommandRow key={entry.id} entry={entry} />
              ))}
            </div>
          </section>
        )}

        <section id="s-lane-sheet-plans" className="s-lane-sheet-section">
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

        <section id="s-lane-sheet-docs" className="s-lane-sheet-section">
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
      </div>
    </SlidePanel>
  );
}
