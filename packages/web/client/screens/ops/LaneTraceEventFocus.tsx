import { useMemo } from "react";

import { isStrReplaceTool, laneDisplayPath } from "../../lib/lane-edit-display.ts";
import { buildLaneToolDetailModel, fmtLaneSessionOffset } from "../../lib/lane-tool-detail.ts";
import type { ObserveEvent } from "../../lib/types.ts";

const PRIMARY_SECTIONS = new Set(["detail", "output", "result", "diff", "change"]);

function CopyButton({
  text,
  label,
}: {
  text: string;
  label: string;
}) {
  return (
    <button
      type="button"
      className="s-lane-trace-focus-copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
      }}
      title={label}
      aria-label={label}
    >
      Copy
    </button>
  );
}

export function LaneTraceEventFocus({
  event,
  wallLabel,
  wallTitle,
  variant = "sheet",
}: {
  event: ObserveEvent;
  wallLabel?: string;
  wallTitle?: string;
  /** `inline` renders attached to the highlighted timeline row. */
  variant?: "sheet" | "inline";
}) {
  const model = useMemo(
    () => buildLaneToolDetailModel(event, {
      wallLabel,
      wallTitle,
      sessionOffset: `${fmtLaneSessionOffset(event.t)} from start`,
    }),
    [event, wallLabel, wallTitle],
  );

  const { primarySection, secondarySections } = useMemo(() => {
    if (!model) {
      return { primarySection: null, secondarySections: [] };
    }
    const primary = model.sections.find((section) => PRIMARY_SECTIONS.has(section.title))
      ?? model.sections[0]
      ?? null;
    const secondary = primary
      ? model.sections.filter((section) => section !== primary)
      : model.sections;
    return { primarySection: primary, secondarySections: secondary };
  }, [model]);

  if (!model) return null;

  return (
    <section
      className={`s-lane-trace-focus${variant === "inline" ? " s-lane-trace-focus--inline" : ""}`}
      aria-label="Selected trace event"
    >
      <div className="s-lane-trace-focus-eyebrow">
        <span className="s-lane-trace-focus-eyebrow-dot" aria-hidden />
        {variant === "inline" ? "Expanded at this step" : "Selected command"}
      </div>

      <div className="s-lane-trace-focus-head">
        <div className="s-lane-trace-focus-head-copy">
          <div className="s-lane-trace-focus-cmd">{model.command}</div>
          {isStrReplaceTool(event.tool) && event.arg?.trim() && (() => {
            const full = laneDisplayPath(event.arg.trim());
            const base = full.split("/").pop() ?? full;
            if (full === base) return null;
            return (
              <div className="s-lane-trace-focus-path" title={event.arg.trim()}>
                {full}
              </div>
            );
          })()}
        </div>
        <CopyButton text={model.copyText} label="Copy event detail" />
      </div>

      {model.hoverFields.length > 0 && (
        <dl className="s-lane-trace-focus-meta">
          {model.hoverFields.map((field) => (
            <div key={field.label} className="s-lane-trace-focus-meta-row">
              <dt>{field.label}</dt>
              <dd title={field.value}>{field.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {primarySection && (
        <div className="s-lane-trace-focus-section s-lane-trace-focus-section--primary">
          <div className="s-lane-trace-focus-section-title">{primarySection.title}</div>
          <pre className="s-lane-trace-focus-section-body">{primarySection.content}</pre>
        </div>
      )}

      {secondarySections.map((section) => (
        <div key={section.title} className="s-lane-trace-focus-section">
          <div className="s-lane-trace-focus-section-title">{section.title}</div>
          <pre className="s-lane-trace-focus-section-body">{section.content}</pre>
        </div>
      ))}
    </section>
  );
}