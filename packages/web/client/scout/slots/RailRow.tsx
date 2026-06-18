import { type ReactNode } from "react";
import "./rail-row.css";
import { stateColor } from "../../lib/colors.ts";
import { agentStateCssToken, type AgentDisplayState } from "../../lib/agent-state.ts";
import { PresenceDot, type AvatarKind } from "../../components/Avatar.tsx";
import { AgentAvatar } from "../../components/AgentAvatar.tsx";

type Tone = AgentDisplayState | "channel" | "dm" | "neutral";

type RailRowProps = {
  name: string;
  /** Right-side meta string (typically timeAgo). */
  meta?: string;
  /** Sub-line beneath the name. Use sparingly; row becomes 2-line. */
  sub?: string;
  /** Dot tone — agent state, neutral, or a channel/dm hint. */
  tone?: Tone;
  /** Avatar name. When set, renders an Avatar in the leading slot. */
  avatarName?: string;
  /** Avatar kind — "channel" renders "#" instead of an initial. */
  avatarKind?: AvatarKind;
  /** Slot for a left-edge icon (e.g., "#" for channels). Replaces the dot. */
  leadingIcon?: ReactNode;
  /** Caret to show this is expandable; "▾" if open, "▸" if closed. */
  caret?: "open" | "closed";
  /** True if this row is the current navigation target. */
  active?: boolean;
  /** True if this row is part of a multi-selection (distinct from active). */
  selected?: boolean;
  /** True for unread style (bolder name + brighter ink). */
  unread?: boolean;
  /** Optional indentation level (0/1) for child rows beneath a group. */
  depth?: 0 | 1;
  /** Detail content rendered below the row when expanded. */
  detail?: ReactNode;
  /** Whether detail is visible. */
  expanded?: boolean;
  /** A compact live-work label shown under the subtitle. */
  activityLabel?: string;
  /** Visual tone for the compact live-work label. */
  activityTone?: "pending" | "working" | "attention";
  onClick?: (event: React.MouseEvent) => void;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  onPointerEnter?: (event: React.PointerEvent) => void;
  onPointerLeave?: (event: React.PointerEvent) => void;
  title?: string;
  tabIndex?: 0 | -1;
};

export function RailRow({
  name,
  meta,
  sub,
  tone = "neutral",
  avatarName,
  avatarKind = "user",
  leadingIcon,
  caret,
  active,
  selected,
  unread,
  depth = 0,
  detail,
  expanded,
  activityLabel,
  activityTone = "working",
  onClick,
  onKeyDown,
  onPointerEnter,
  onPointerLeave,
  title,
  tabIndex,
}: RailRowProps) {
  const ariaExpanded = caret
    ? caret === "open"
    : detail !== undefined
      ? Boolean(expanded)
      : undefined;
  const classes = [
    "rr-row",
    depth === 1 && "rr-row--child",
    active && "rr-row--active",
    selected && "rr-row--selected",
    unread && "rr-row--unread",
    expanded && "rr-row--expanded",
    activityLabel && "rr-row--motion",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes}>
      <button
        type="button"
        className="rr-row-head"
        onClick={onClick}
        onKeyDown={onKeyDown}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        title={title}
        tabIndex={tabIndex}
        aria-expanded={ariaExpanded}
      >
        <RowLeading
          icon={leadingIcon}
          tone={tone}
          caret={caret}
          avatarName={avatarName}
          avatarKind={avatarKind}
        />
        <span className="rr-row-body">
          <span className="rr-row-name">{name}</span>
          {sub && <span className="rr-row-sub">{sub}</span>}
          {activityLabel && (
            <span className={`rr-row-activity rr-row-activity--${activityTone}`}>
              <span className="rr-row-activity-bars" aria-hidden>
                <span />
                <span />
                <span />
                <span />
              </span>
              <span className="rr-row-activity-label">{activityLabel}</span>
            </span>
          )}
        </span>
        {meta && <span className="rr-row-meta">{meta}</span>}
      </button>
      {expanded && detail && <div className="rr-row-detail">{detail}</div>}
    </div>
  );
}

function RowLeading({
  icon,
  tone,
  caret,
  avatarName,
  avatarKind,
}: {
  icon: ReactNode | undefined;
  tone: Tone;
  caret: "open" | "closed" | undefined;
  avatarName: string | undefined;
  avatarKind: AvatarKind;
}) {
  if (caret) {
    return (
      <span
        className={`rr-row-caret rr-row-caret--leading rr-row-caret--${caret}`}
        aria-hidden
      >
        <Chevron open={caret === "open"} />
      </span>
    );
  }
  if (avatarName) {
    if (avatarKind === "channel") {
      return (
        <AgentAvatar
          kind="channel"
          name={avatarName}
          channelClassName="rr-row-hash"
        />
      );
    }
    const normalized = normalizeAgentTone(tone);
    const showPresence = normalized === "working" || normalized === "available";
    return (
      <span className="rr-row-avatar-wrap" aria-hidden>
        <AgentAvatar name={avatarName} placement="roster" className="rr-row-avatar" />
        {showPresence && (
          <PresenceDot
            state={normalized}
            className={`rr-row-presence rr-row-presence--${normalized}`}
          />
        )}
      </span>
    );
  }
  if (icon) {
    return <span className="rr-row-icon" aria-hidden>{icon}</span>;
  }
  const normalized = normalizeAgentTone(tone);
  return (
    <span
      className={`rr-row-dot rr-row-dot--${normalized}`}
      style={normalized === "working" || normalized === "available"
        ? { background: stateColor(normalized) }
        : undefined}
      aria-hidden
    />
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`rr-chevron${open ? " rr-chevron--open" : ""}`}
      viewBox="0 0 12 12"
      width="12"
      height="12"
      fill="none"
      aria-hidden
    >
      <path
        d="M4.25 3L7.75 6L4.25 9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function normalizeAgentTone(tone: Tone): string {
  if (tone === "channel" || tone === "dm" || tone === "neutral") return tone;
  return agentStateCssToken(tone);
}
