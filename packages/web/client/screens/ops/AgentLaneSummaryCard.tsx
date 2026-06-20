import { useEffect, useRef, useState } from "react";

import { timeAgo } from "../../lib/time.ts";
import { AgentAvatar } from "../../components/AgentAvatar.tsx";
import { HarnessMark } from "../../components/HarnessMark.tsx";
import { isAgentBusy } from "../../lib/agent-state.ts";
import { buildAgentLanePreview, filePreviewLabel, hasMeaningfulText } from "./agent-lane-preview.ts";
import type { AgentLane } from "./agent-lanes-model.ts";
import {
  laneContextLabel,
  lanePrimaryLabel,
} from "./agent-lanes-model.ts";

const FILE_STATE_LABEL: Record<string, string> = {
  created: "new",
  modified: "mod",
  read: "read",
};

// How many file rows the (fixed-height) files region reserves. When there are
// more, the last slot becomes a "+N more" tally so the block never grows past
// FILE_CAP rows — keeping every lane's summary the same height so the traces
// below all start on the same line.
const FILE_CAP = 5;

/** A small folder mark for the cwd field — the glyph treatment mirrors the
 *  branch's ⎇, so cwd / branch read as a labelled pair without written labels. */
const FOLDER_GLYPH = (
  <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
    <path
      d="M2 4.2c0-.4.3-.7.7-.7h2.1l1 1h3.5c.4 0 .7.3.7.7V9c0 .4-.3.7-.7.7H2.7c-.4 0-.7-.3-.7-.7V4.2Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  </svg>
);

/** Compact a working directory to its last two path segments (full path stays
 *  on the title tooltip). "/Users/art/dev/openscout/packages/web" → "packages/web". */
function formatCwd(path: string): string {
  const parts = path.replace(/\/+$/, "").split(/[\\/]/).filter(Boolean);
  if (parts.length === 0) return path;
  return parts.slice(-2).join("/");
}

const COLLAPSE_STORAGE_KEY = "openscout:agent-lane-summary-collapsed";

function readCollapsedSet(): Set<string> {
  try {
    const raw = sessionStorage.getItem(COLLAPSE_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((id): id is string => typeof id === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function writeCollapsed(id: string, collapsed: boolean) {
  try {
    const set = readCollapsedSet();
    if (collapsed) set.add(id);
    else set.delete(id);
    sessionStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify([...set]));
  } catch {
    // ignore storage failures
  }
}

export function AgentLaneSummaryCard({
  lane,
  isLive,
  onOpen,
}: {
  lane: AgentLane;
  isLive: boolean;
  onOpen: () => void;
}) {
  const { agent, observe, source, lastActiveAt } = lane;
  const primaryLabel = lanePrimaryLabel(agent, source);
  const contextLabel = laneContextLabel(agent, source);
  const preview = buildAgentLanePreview(observe, agent, { isLive });
  const facts = lane.facts;

  // The runtime the session runs on — shown as a brand mark on the avatar
  // (replacing the written-out harness name).
  const harness = agent.harness ?? preview?.harness ?? null;

  // "Working" = the agent is mid-turn / in flight right now. Drives the subtle
  // avatar motion + accent tint. We no longer surface a "Live" pill: you are
  // watching the lane, so the work itself (motion) is the signal.
  const working = isAgentBusy(agent.state ?? null, agent);

  // Context fields kept distinct (not pre-joined) so each can carry its own
  // visual weight in the grouped one-line meta row. cwd + branch are the real
  // "where is this running" facts — shown with glyphs rather than written labels.
  const model = facts?.model ?? preview?.model ?? null;
  const effort = facts?.effort ?? null;
  const branch = facts?.branch ?? preview?.branch ?? agent.branch ?? null;
  const cwd = facts?.cwd ?? agent.cwd ?? agent.projectRoot ?? null;
  const hasConfig = Boolean(model || effort || branch || cwd);

  const statChips = preview
    ? [
        preview.stats.tools > 0 ? `${preview.stats.tools} tools` : null,
        preview.stats.edits > 0 ? `${preview.stats.edits} edits` : null,
        preview.stats.reads > 0 ? `${preview.stats.reads} reads` : null,
        preview.stats.thinks > 0 ? `${preview.stats.thinks} thinks` : null,
        preview.stats.files > 0 ? `${preview.stats.files} files` : null,
      ].filter((chip): chip is string => Boolean(chip))
    : [];

  // Files: lead with what the agent CHANGED (new/mod) and collapse the reads —
  // which usually dominate — into a single tally. The signal is what moved, not
  // what was looked at.
  const allFiles = (facts?.touchedFiles.length ? facts.touchedFiles : preview?.files ?? [])
    .filter((file) => hasMeaningfulText(filePreviewLabel(file)));
  const changedFiles = allFiles.filter((file) => file.state !== "read");
  const readCount = allFiles.length - changedFiles.length;
  const changedCap = readCount > 0 ? FILE_CAP - 1 : FILE_CAP;
  const visibleFiles = changedFiles.slice(0, changedCap);
  const extraChanged = changedFiles.length - visibleFiles.length;

  const summaryPrimedRef = useRef(false);
  const prevHeadlineRef = useRef<string | null>(null);
  const [focusEntering, setFocusEntering] = useState(false);
  const [collapsed, setCollapsed] = useState(() => readCollapsedSet().has(lane.id));

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      writeCollapsed(lane.id, next);
      return next;
    });
  };

  useEffect(() => {
    const headline = preview?.headline ?? null;
    if (!summaryPrimedRef.current) {
      summaryPrimedRef.current = true;
      prevHeadlineRef.current = headline;
      return;
    }
    if (!headline || headline === prevHeadlineRef.current) return;

    prevHeadlineRef.current = headline;
    setFocusEntering(true);
    const timer = window.setTimeout(() => setFocusEntering(false), 420);
    return () => window.clearTimeout(timer);
  }, [preview?.headline]);

  return (
    <section
      className={`s-agent-lane-summary${working ? " s-agent-lane-summary--working" : ""}${collapsed ? " s-agent-lane-summary--collapsed" : ""}`}
      aria-label={`${primaryLabel} summary`}
    >
      <button
        type="button"
        className="s-agent-lane-summary-hit"
        onClick={onOpen}
        aria-label={`Inspect ${primaryLabel}`}
      />
      <div className="s-agent-lane-summary-head">
        <AgentAvatar
          agent={agent}
          placement="row"
          size={36}
          presence={false}
          className="s-agent-lane-avatar"
        />
        <div className="s-agent-lane-summary-identity">
          <div className="s-agent-lane-summary-title">{primaryLabel}</div>
          <div className="s-agent-lane-summary-meta">
            {/* Left: where it runs — path, branch. */}
            <span className="s-agent-lane-meta-where">
              {cwd && (
                <span className="s-agent-lane-meta-cwd" title={cwd}>
                  <span className="s-agent-lane-meta-glyph s-agent-lane-meta-glyph--folder" aria-hidden="true">
                    {FOLDER_GLYPH}
                  </span>
                  {formatCwd(cwd)}
                </span>
              )}
              {branch && (
                <span className="s-agent-lane-meta-branch" title={branch}>
                  <span className="s-agent-lane-meta-glyph" aria-hidden="true">⎇</span>
                  {branch}
                </span>
              )}
              {!hasConfig && (
                <span className="s-agent-lane-meta-fallback">{contextLabel}</span>
              )}
            </span>
            {/* Right: what it is — harness logo anchors model + effort, the way
                the avatar anchors the identity on the left. */}
            <span className="s-agent-lane-meta-what">
              {harness && (
                <HarnessMark
                  harness={harness}
                  size={20}
                  className="s-agent-lane-meta-harness-mark"
                />
              )}
              {model && <span className="s-agent-lane-meta-model">{model}</span>}
              {effort && <span className="s-agent-lane-meta-effort">{effort}</span>}
              {lastActiveAt && (
                <span className="s-agent-lane-meta-time">{timeAgo(lastActiveAt)}</span>
              )}
            </span>
          </div>
        </div>
        <div className="s-agent-lane-summary-aside">
          <button
            type="button"
            className="s-agent-lane-summary-collapse"
            aria-label={collapsed ? "Show summary" : "Hide summary"}
            aria-expanded={!collapsed}
            onClick={(event) => {
              event.stopPropagation();
              toggleCollapsed();
            }}
          >
            <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
              <path
                d="M2 3.5 L5 6.5 L8 3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="s-agent-lane-summary-body">
          <div className="s-agent-lane-summary-panel">
            <div className={`s-agent-lane-summary-current${focusEntering ? " s-agent-lane-summary-current--enter" : ""}`}>
              <span className="s-agent-lane-current-line">
                {preview?.headlineFrom && (
                  <span
                    className={`s-agent-lane-current-dir s-agent-lane-current-dir--${preview.headlineFrom}`}
                    aria-label={preview.headlineFrom === "user" ? "from you" : "to you"}
                  >
                    {preview.headlineFrom === "user" ? "←" : "→"}
                  </span>
                )}
                {preview?.headline ?? "Waiting for trace activity…"}
              </span>
              {preview?.detail && (
                <span className="s-agent-lane-current-pop" role="tooltip">{preview.detail}</span>
              )}
            </div>

            <div className="s-agent-lane-summary-stats">
              {statChips.length > 0 ? (
                statChips.map((chip) => (
                  <span key={chip} className="s-agent-lane-stat">{chip}</span>
                ))
              ) : (
                <span className="s-agent-lane-stat s-agent-lane-stat--ghost">no tool activity yet</span>
              )}
            </div>

            <div className="s-agent-lane-summary-files">
              {allFiles.length > 0 ? (
                <>
                  {visibleFiles.map((file, index) => (
                    <div
                      key={file.path?.trim() || `file-${index}`}
                      className="s-agent-lane-summary-file"
                      title={file.path?.trim() || undefined}
                    >
                      <span className={`s-agent-lane-preview-file-state s-agent-lane-preview-file-state--${file.state}`}>
                        {FILE_STATE_LABEL[file.state] ?? file.state}
                      </span>
                      <span className="s-agent-lane-preview-file-path">{filePreviewLabel(file)}</span>
                    </div>
                  ))}
                  {extraChanged > 0 && (
                    <div className="s-agent-lane-summary-file-more">+{extraChanged} more changed</div>
                  )}
                  {readCount > 0 && (
                    <div className="s-agent-lane-summary-file-reads">
                      {readCount} read{readCount === 1 ? "" : "s"}
                    </div>
                  )}
                </>
              ) : (
                <div className="s-agent-lane-summary-file-ghost">no files touched yet</div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
