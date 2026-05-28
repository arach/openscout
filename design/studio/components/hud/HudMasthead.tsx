/**
 * Masthead — tiny lime mark + `1 agents · 2 activity · 3 tail · 4 sessions`
 * nav, with the right cluster: attention pip + scout-home link + tier
 * stepper, all integrated inline per [[feedback_integrate_not_stack_chrome]].
 *
 * Standardized across all four tabs:
 *   · Height: 30px content row + 10px padding (2.5 top + 2 bottom).
 *   · Horizontal padding: PANEL_PAD_X[size] (px-4 / px-4 / px-5).
 *   · Mark: 14×14 lime triskele, vertically aligned with tab baseline.
 *   · Tab label: sans 12 (mono num 9). Underline 1.5px lime on active.
 *   · Right cluster reads pip → scout-link → stepper, right-to-left
 *     priority (stepper anchors the corner because it's the only true
 *     control; scout-link sits beside it; pip floats further left).
 *
 * Tabs are clickable when `onTabChange` is provided; tier stepper is
 * functional when `onSizeChange` is provided; both fall back to static
 * labels on the locked study pages.
 */

import { RobotGlyph } from "./HudAssistant";
import { PANEL_PAD_X } from "./tokens";
import type { HudSize, HudTab } from "./types";

interface TabSpec {
  key: HudTab;
  num: string;
  label: string;
  /** Optional sigil rendered to the left of the number. Used by the
   *  assistant tab to carry the robot-head identity per
   *  feedback_meta_agent_naming_neutral — neutral text label, brand
   *  sits in the glyph. */
  sigil?: "robot";
}

const TABS: TabSpec[] = [
  { key: "agents", num: "1", label: "agents" },
  { key: "activity", num: "2", label: "activity" },
  { key: "tail", num: "3", label: "tail" },
  { key: "sessions", num: "4", label: "sessions" },
  { key: "assistant", num: "5", label: "assistant", sigil: "robot" },
];

const SIZE_ORDER: HudSize[] = ["compact", "medium", "large"];

export function HudMasthead({
  size,
  tab,
  onTabChange,
  onSizeChange,
  attentionCount = 0,
}: {
  size: HudSize;
  tab: HudTab;
  onTabChange?: (t: HudTab) => void;
  onSizeChange?: (s: HudSize) => void;
  /** When > 0, renders the right-side `on you` pip with this count. */
  attentionCount?: number;
}) {
  return (
    <header
      className={`border-b border-studio-edge ${PANEL_PAD_X[size]} pt-2.5 pb-2`}
    >
      <div className="flex items-end gap-0">
        <MastheadMark />
        <span className="mx-3 self-end pb-[3px]" />
        {TABS.map((spec, i) => (
          <span key={spec.key} className="flex items-end">
            {i > 0 ? <TabSeparator /> : null}
            <TabLink
              keyLabel={spec.num}
              label={spec.label}
              active={tab === spec.key}
              sigil={spec.sigil}
              onClick={onTabChange ? () => onTabChange(spec.key) : undefined}
            />
          </span>
        ))}
        <span className="ml-auto flex items-center gap-3 self-end pb-[2px]">
          {attentionCount > 0 ? (
            <AttentionPip count={attentionCount} />
          ) : null}
          <SizePills size={size} onChange={onSizeChange} />
        </span>
      </div>
    </header>
  );
}

function MastheadMark() {
  return (
    <span
      aria-hidden
      className="relative inline-block h-3.5 w-3.5 shrink-0 translate-y-[-1px] self-end rounded-full border border-studio-edge-strong"
    >
      {[0, 1, 2].map((i) => {
        const angle = i * 120 - 90;
        return (
          <span
            key={i}
            className="absolute left-1/2 top-1/2 block h-px w-[5px] origin-left"
            style={{
              background: "var(--scout-accent)",
              transform: `rotate(${angle}deg) translateY(-0.5px)`,
            }}
          />
        );
      })}
      <span
        className="absolute left-1/2 top-1/2 block h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full border"
        style={{
          background: "var(--studio-canvas)",
          borderColor: "var(--scout-accent)",
        }}
      />
    </span>
  );
}

function AttentionPip({ count }: { count: number }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span
        className="relative inline-block h-[5px] w-[5px] translate-y-[-1px] rounded-full"
        style={{ background: "var(--scout-accent)" }}
      >
        <span
          aria-hidden
          className="absolute inset-[-3px] rounded-full"
          style={{
            border:
              "1px solid color-mix(in oklab, var(--scout-accent) 60%, transparent)",
          }}
        />
      </span>
      <span className="font-mono text-[11px] font-semibold tabular-nums text-studio-ink">
        {count}
      </span>
      <span
        className="font-mono text-[10px] font-bold uppercase tracking-eyebrow"
        style={{ color: "var(--scout-accent)" }}
      >
        on you
      </span>
    </span>
  );
}

function TabLink({
  keyLabel,
  label,
  active,
  sigil,
  onClick,
}: {
  keyLabel: string;
  label: string;
  active?: boolean;
  sigil?: "robot";
  onClick?: () => void;
}) {
  const inner = (
    <>
      <span className="flex items-baseline gap-1">
        {sigil === "robot" ? (
          <span
            className="grid translate-y-[1px] place-items-center"
            style={{
              color: active ? "var(--scout-accent)" : "var(--studio-ink-faint)",
            }}
          >
            <RobotGlyph size={11} />
          </span>
        ) : null}
        <span
          className="font-mono text-[10px] font-bold"
          style={{
            color: active ? "var(--scout-accent)" : "var(--studio-ink-faint)",
          }}
        >
          {keyLabel}
        </span>
        <span
          className={
            active
              ? "font-sans text-[12px] font-semibold lowercase text-studio-ink"
              : onClick
                ? "font-sans text-[12px] lowercase text-studio-ink-faint group-hover:text-studio-ink"
                : "font-sans text-[12px] lowercase text-studio-ink-faint"
          }
        >
          {label}
        </span>
      </span>
      <span
        aria-hidden
        className="mt-[2px] block h-[1.5px] w-full"
        style={{ background: active ? "var(--scout-accent)" : "transparent" }}
      />
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="group flex flex-col items-start"
      >
        {inner}
      </button>
    );
  }
  return <span className="flex flex-col items-start">{inner}</span>;
}

function TabSeparator() {
  return (
    <span className="mx-2 self-end pb-[3px] font-mono text-[10px] text-studio-ink-faint">
      ·
    </span>
  );
}

/**
 * Size pills — three-position segmented S · M · L. Mirrors Swift's
 * HUDSizeToggle. Selected = lime accent on canvasAlt fill; idle =
 * inkFaint, transparent fill. The stepper variant was tried and
 * rejected (math felt non-intuitive; letters map spatially). Single
 * letters keep the compact-tier masthead from line-wrapping.
 */
function SizePills({
  size,
  onChange,
}: {
  size: HudSize;
  onChange?: (s: HudSize) => void;
}) {
  return (
    <span className="inline-flex rounded-[4px] border border-studio-edge p-[2px]">
      {SIZE_ORDER.map((s) => {
        const active = s === size;
        return (
          <button
            key={s}
            type="button"
            onClick={onChange ? () => onChange(s) : undefined}
            disabled={!onChange}
            aria-pressed={active}
            className={[
              "inline-flex h-[16px] w-[18px] items-center justify-center",
              "rounded-[2.5px] transition-colors",
              "font-mono text-[9px] font-bold tracking-[0.5px]",
              active
                ? "bg-studio-canvas-alt text-scout-accent"
                : "text-studio-ink-faint hover:text-studio-ink",
            ].join(" ")}
          >
            {s === "compact" ? "S" : s === "medium" ? "M" : "L"}
          </button>
        );
      })}
    </span>
  );
}
