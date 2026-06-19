import { useEffect, useRef, useState } from "react";

import { timeAgo } from "../../lib/time.ts";
import { AgentAvatar } from "../../components/AgentAvatar.tsx";
import { buildAgentLanePreview, filePreviewLabel } from "./agent-lane-preview.ts";
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
  const statusLabel = laneStatusLabel(agent, source);
  const contextLabel = laneContextLabel(agent, source);
  const preview = buildAgentLanePreview(observe, agent, { isLive });
  const facts = lane.facts;
  const specRow = [
    facts?.model ?? preview?.model,
    facts?.effort,
    preview?.harness ?? agent.harness,
    facts?.attribution,
    facts?.branch ?? preview?.branch,
  ].filter(Boolean);
  const recentFiles = (facts?.touchedFiles.length ? facts.touchedFiles : preview?.files ?? []).slice(0, 5);
  const summaryPrimedRef = useRef(false);
  const prevHeadlineRef = useRef<string | null>(null);
  const [focusEntering, setFocusEntering] = useState(false);

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
      className={`s-agent-lane-summary${isLive ? " s-agent-lane-summary--live" : ""}`}
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
          size={28}
          presence={false}
          className="s-agent-lane-avatar"
        />
        <div className="s-agent-lane-summary-identity">
          <div className="s-agent-lane-summary-title">{primaryLabel}</div>
          <div className="s-agent-lane-summary-sub">
            {contextLabel} · {lastActiveAt ? timeAgo(lastActiveAt) : "idle"}
          </div>
        </div>
        <span className="s-agent-lane-summary-status">
          {isLive && <span className="s-agent-lane-summary-live">Live</span>}
          <span className="s-agent-lane-summary-badge">{statusLabel}</span>
        </span>
      </div>

      <div className="s-agent-lane-summary-body">
        <div className="s-agent-lane-summary-panel">
          {specRow.length > 0 && (
            <div className="s-agent-lane-summary-meta">{specRow.join(" · ")}</div>
          )}

          <div className={`s-agent-lane-summary-focus${focusEntering ? " s-agent-lane-summary-focus--enter" : ""}`}>
            {preview ? (
              <>
                <div className="s-agent-lane-summary-headline">{preview.headline}</div>
                {preview.detail && (
                  <div className="s-agent-lane-summary-detail">{preview.detail}</div>
                )}
              </>
            ) : (
              <div className="s-agent-lane-summary-placeholder">
                Waiting for trace activity…
              </div>
            )}
          </div>

          {preview && (
            <div className="s-agent-lane-summary-foot">
              <div className="s-agent-lane-summary-stats">
                {preview.stats.tools > 0 && (
                  <span className="s-agent-lane-stat">{preview.stats.tools} tools</span>
                )}
                {preview.stats.edits > 0 && (
                  <span className="s-agent-lane-stat">{preview.stats.edits} edits</span>
                )}
                {preview.stats.reads > 0 && (
                  <span className="s-agent-lane-stat">{preview.stats.reads} reads</span>
                )}
                {preview.stats.thinks > 0 && (
                  <span className="s-agent-lane-stat">{preview.stats.thinks} thinks</span>
                )}
                {preview.stats.files > 0 && (
                  <span className="s-agent-lane-stat">{preview.stats.files} files</span>
                )}
              </div>

              {recentFiles.length > 0 && (
                <div className="s-agent-lane-summary-files">
                  {recentFiles.map((file, index) => (
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
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
