/**
 * HudPanel — framed container that composes masthead → tab content →
 * bottom dock. Takes `size` + `tab`, with optional `onTabChange` /
 * `onSizeChange` for the interactive playground. When `onTabChange` is
 * omitted (the locked study pages) the tab labels render as static
 * text rather than buttons.
 *
 * Four tabs:
 *   agents   → HudAgents    (roster of broker agents)
 *   activity → HudActivity  (structured ledger, time-bucketed)
 *   tail     → HudTail      (firehose, dense mono single-line stream)
 *   sessions → HudSessions  (agent run sessions; not tmux)
 *
 * The bottom slot is the universal `HudMessageDock` (mic + input +
 * send), which replaced the old `HudFooter` byline strip.
 */

import { HudActivity } from "./HudActivity";
import { HudAgents } from "./HudAgents";
import { HudAssistant } from "./HudAssistant";
import { HudMasthead } from "./HudMasthead";
import { HudMessageDock } from "./HudMessageDock";
import { HudSessions } from "./HudSessions";
import { HudTail } from "./HudTail";
import { AGENTS } from "./mock";
import { PANEL_DIMS } from "./tokens";
import type { HudSize, HudTab } from "./types";

export function HudPanel({
  size,
  tab,
  onTabChange,
  onSizeChange,
}: {
  size: HudSize;
  tab: HudTab;
  onTabChange?: (t: HudTab) => void;
  /** Threaded through to HudMasthead's inline tier stepper. The
   *  playground's external HudSizeToggle still works independently. */
  onSizeChange?: (s: HudSize) => void;
}) {
  const { w, h } = PANEL_DIMS[size];
  const attention = AGENTS.filter((a) => a.state === "needs-attention").length;

  return (
    <div
      className="relative flex flex-col overflow-hidden rounded-[10px] border border-studio-edge bg-studio-canvas shadow-[0_18px_40px_-12px_rgba(0,0,0,0.55)]"
      style={{
        width: w,
        height: h,
        // Mirrors the native HUD's panel resize (NSAnimationContext 0.22s
        // easeInEaseOut). The interactive playground swaps tiers via the
        // size toggle; without a transition the panel jumps and the body
        // reflow reads as breakage. Width + height are the only two
        // animated properties — content beneath snaps to its new layout.
        transition:
          "width 220ms cubic-bezier(0.42, 0, 0.58, 1), height 220ms cubic-bezier(0.42, 0, 0.58, 1)",
      }}
    >
      <HudMasthead
        size={size}
        tab={tab}
        onTabChange={onTabChange}
        onSizeChange={onSizeChange}
        attentionCount={attention}
      />
      <div
        key={`${tab}-${size}`}
        className="min-h-0 flex-1 overflow-y-auto"
        style={{ animation: "hud-fade-in 180ms ease-out both" }}
      >
        {tab === "agents" ? <HudAgents size={size} /> : null}
        {tab === "activity" ? <HudActivity size={size} /> : null}
        {tab === "tail" ? <HudTail size={size} /> : null}
        {tab === "sessions" ? <HudSessions size={size} /> : null}
        {tab === "assistant" ? <HudAssistant size={size} /> : null}
      </div>
      <HudMessageDock size={size} />
    </div>
  );
}
