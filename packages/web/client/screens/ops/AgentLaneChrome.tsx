import type { PointerEvent as ReactPointerEvent } from "react";
import { MessageCircle, Wrench } from "lucide-react";

import type { AgentLaneWidthTier } from "./lane-deck.ts";

const WIDTH_OPTIONS: AgentLaneWidthTier[] = ["sm", "md", "lg"];

export function AgentLaneChrome({
  title,
  width,
  defaultWidth,
  pinned,
  collapseTechnicalEvents,
  onTogglePin,
  onToggleTechnicalRollup,
  onWidthChange,
  onResizeStart,
  resizing,
}: {
  title: string;
  width: AgentLaneWidthTier | number | undefined;
  defaultWidth: AgentLaneWidthTier;
  pinned: boolean;
  collapseTechnicalEvents: boolean;
  onTogglePin: () => void;
  onToggleTechnicalRollup: (enabled: boolean) => void;
  onWidthChange: (width: AgentLaneWidthTier) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  resizing?: boolean;
}) {
  const activeTier = typeof width === "string" ? width : defaultWidth;
  const traceModeLabel = collapseTechnicalEvents ? "Talk" : "Work";
  const traceModeTitle = collapseTechnicalEvents
    ? "Switch to Work mode for this lane"
    : "Switch to Talk mode for this lane";
  const TraceModeIcon = collapseTechnicalEvents ? MessageCircle : Wrench;

  return (
    <div className={`s-agent-lane-chrome${resizing ? " s-agent-lane-chrome--resizing" : ""}`}>
      <div className="s-agent-lane-chrome-body">
        <div className="s-agent-lane-chrome-top">
          <button
            type="button"
            className={`s-agent-lane-chrome-pin${pinned ? " s-agent-lane-chrome-pin--on" : ""}`}
            aria-pressed={pinned}
            title={pinned ? "Unpin lane" : "Pin lane"}
            onClick={onTogglePin}
          >
            <PinIcon filled={pinned} />
          </button>
          <span className="s-agent-lane-chrome-title" title={title}>{title}</span>
        </div>
        <div className="s-agent-lane-chrome-widths" role="group" aria-label="Lane width">
          {WIDTH_OPTIONS.map((tier) => (
            <button
              key={tier}
              type="button"
              className={`s-agent-lane-chrome-width-btn${
                activeTier === tier ? " s-agent-lane-chrome-width-btn--on" : ""
              }`}
              aria-pressed={activeTier === tier}
              title={`${tier.toUpperCase()} width`}
              onClick={() => onWidthChange(tier)}
            >
              {tier.toUpperCase()}
            </button>
          ))}
        </div>
        <label
          className={`s-agent-lane-chrome-tech-toggle${
            collapseTechnicalEvents ? " s-agent-lane-chrome-tech-toggle--talk" : " s-agent-lane-chrome-tech-toggle--work"
          }`}
          title={traceModeTitle}
        >
          <input
            type="checkbox"
            checked={collapseTechnicalEvents}
            onChange={(event) => onToggleTechnicalRollup(event.currentTarget.checked)}
            aria-label={traceModeTitle}
          />
          <TraceModeIcon className="s-agent-lane-chrome-tech-icon" size={12} strokeWidth={1.8} aria-hidden="true" />
          <span className="s-agent-lane-chrome-tech-label">
            {traceModeLabel}
          </span>
        </label>
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize lane width"
        title="Drag to resize lane"
        className={`s-agent-lane-width-handle${resizing ? " s-agent-lane-width-handle--active" : ""}`}
        onPointerDown={onResizeStart}
      />
    </div>
  );
}

function PinIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      <path
        d="M4.2 1.8h3.6l.5 1.8 1.9.8-.2 1.1-1.7.4-.8 3.1H4.3l-.8-3.1-1.7-.4-.2-1.1 1.9-.8.5-1.8Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
    </svg>
  );
}
