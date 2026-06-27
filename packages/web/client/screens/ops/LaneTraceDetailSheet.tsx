import { useMemo } from "react";
import { SlidePanel } from "../../components/SlidePanel/SlidePanel.tsx";
import { AgentAvatar } from "../../components/AgentAvatar.tsx";
import { HarnessMark } from "../../components/HarnessMark.tsx";
import { timeAgo } from "../../lib/time.ts";
import type { ObserveEvent } from "../../lib/types.ts";
import { SessionObserve } from "../sessions/SessionObserve.tsx";
import { buildLaneSessionStats } from "./agent-lane-detail.ts";
import type { AgentLane } from "./agent-lanes-model.ts";
import {
  laneContextLabel,
  lanePrimaryLabel,
} from "./agent-lanes-model.ts";

const EVENT_KIND_LABEL: Record<string, string> = {
  think: "Thought",
  tool: "Tool",
  ask: "Ask",
  message: "Message",
  note: "Note",
  system: "System",
  boot: "Boot",
};

export type LaneTraceSheetTarget = {
  lane: AgentLane;
  event: ObserveEvent;
};

export function LaneTraceDetailSheet({
  target,
  onClose,
}: {
  target: LaneTraceSheetTarget;
  onClose: () => void;
}) {
  const { lane, event } = target;
  const { agent, observe, source, lastActiveAt } = lane;
  const stats = useMemo(() => buildLaneSessionStats(lane), [lane]);
  const primaryLabel = lanePrimaryLabel(agent, source);
  const contextLabel = laneContextLabel(agent, source);
  const eventLabel = EVENT_KIND_LABEL[event.kind] ?? event.kind;

  return (
    <SlidePanel
      open
      onClose={onClose}
      side="right"
      owner="openscout.lane-trace"
      layer="elevated"
      resizable
      defaultSize={980}
      minSize={560}
      maxSize={1280}
      scrollLock
      ariaLabel={`${primaryLabel} session trace`}
      className="s-lane-trace-sheet"
    >
      <div className="s-slide-header s-lane-trace-sheet-header">
        <AgentAvatar
          agent={agent}
          placement="row"
          size={28}
          presence={false}
          className="s-agent-lane-avatar"
        />
        <div className="s-lane-trace-sheet-header-copy">
          <div className="s-lane-trace-sheet-title">{primaryLabel}</div>
          <div className="s-lane-trace-sheet-sub">
            {contextLabel} · {eventLabel}
            {lastActiveAt ? ` · ${timeAgo(lastActiveAt)}` : ""}
          </div>
        </div>
        <span className="s-slide-spacer" />
        <HarnessMark
          harness={agent.harness ?? stats.harness}
          size={18}
          className="s-lane-trace-sheet-hmark"
        />
        <button type="button" className="s-slide-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="s-slide-body s-lane-trace-sheet-body">
        <SessionObserve
          data={observe ?? undefined}
          agentId={source === "scout" ? agent.id : undefined}
          sessionId={agent.harnessSessionId ?? stats.sessionId}
          showRail
          variant="default"
          initialCursorT={event.t}
          focusEventId={event.id}
        />
      </div>
    </SlidePanel>
  );
}