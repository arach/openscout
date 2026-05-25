/**
 * HudPanel — framed container that composes masthead → tab content →
 * bottom dock. Takes `size` + `tab`, with optional `onTabChange` /
 * `onSizeChange` for the interactive playground. When `onTabChange` is
 * omitted (the locked study pages) the tab labels render as static
 * text rather than buttons.
 *
 * Four tabs:
 *   fleet    → HudFleet
 *   observe  → HudObserve   (structured, time-bucketed)
 *   tail     → HudTail      (firehose, dense log-line)
 *   sessions → HudSessions
 *
 * The bottom slot is the universal `HudMessageDock` (mic + input +
 * send), which replaced the old `HudFooter` byline strip.
 */

import { HudFleet } from "./HudFleet";
import { HudMasthead } from "./HudMasthead";
import { HudMessageDock } from "./HudMessageDock";
import { HudObserve } from "./HudObserve";
import { HudSessions } from "./HudSessions";
import { HudTail } from "./HudTail";
import { FLEET } from "./mock";
import { PANEL_DIMS } from "./tokens";
import type { HudSize, HudTab } from "./types";

export function HudPanel({
  size,
  tab,
  onTabChange,
  /**
   * Currently only consumed indirectly via `HudSizeToggle`. Accepted
   * here so callers can hand the panel a size setter alongside the
   * tab setter for parity, but the panel itself doesn't render any
   * resize affordance — that lives in `HudSizeToggle` above it.
   */
  onSizeChange: _onSizeChange,
}: {
  size: HudSize;
  tab: HudTab;
  onTabChange?: (t: HudTab) => void;
  onSizeChange?: (s: HudSize) => void;
}) {
  const { w, h } = PANEL_DIMS[size];
  const attention = FLEET.filter((a) => a.state === "needs-attention").length;

  return (
    <div
      className="relative flex flex-col overflow-hidden rounded-[10px] border border-studio-edge bg-studio-canvas shadow-[0_18px_40px_-12px_rgba(0,0,0,0.55)]"
      style={{ width: w, height: h }}
    >
      <HudMasthead
        size={size}
        tab={tab}
        onTabChange={onTabChange}
        attentionCount={attention}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "fleet" ? <HudFleet size={size} /> : null}
        {tab === "observe" ? <HudObserve size={size} /> : null}
        {tab === "tail" ? <HudTail size={size} /> : null}
        {tab === "sessions" ? <HudSessions size={size} /> : null}
      </div>
      <HudMessageDock size={size} />
    </div>
  );
}
