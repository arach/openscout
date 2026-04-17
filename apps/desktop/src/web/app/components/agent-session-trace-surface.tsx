"use client";

import React from "react";
import {
  createTraceTimelineViewModel,
  type SessionSnapshot,
  type TraceBlockViewModel,
  type TraceIntent,
  type TraceTimelineViewModel,
  type TraceViewModelOptions,
} from "@openscout/session-trace";
import { TraceTurn } from "@openscout/session-trace-react";

type AgentSessionTraceSurfaceProps = {
  snapshot: SessionSnapshot;
  onIntent?: (intent: TraceIntent) => void;
  className?: string;
  emptyLabel?: string;
  options?: TraceViewModelOptions;
};

function blockKey(block: TraceBlockViewModel): string {
  return `${block.sessionId}:${block.turnId}:${block.id}`;
}

function applyCollapsedState(
  timeline: TraceTimelineViewModel,
  collapsedByBlockId: Record<string, boolean>,
): TraceTimelineViewModel {
  return {
    ...timeline,
    turns: timeline.turns.map((turn) => ({
      ...turn,
      blocks: turn.blocks.map((block) => {
        const collapsed = collapsedByBlockId[blockKey(block)];
        return collapsed === undefined ? block : { ...block, collapsed };
      }),
    })),
  };
}

export function AgentSessionTraceSurface({
  snapshot,
  onIntent,
  className,
  emptyLabel = "No trace events yet.",
  options = {},
}: AgentSessionTraceSurfaceProps) {
  const [collapsedByBlockId, setCollapsedByBlockId] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    const activeBlockKeys = new Set<string>();
    const timeline = createTraceTimelineViewModel(snapshot, options);
    for (const turn of timeline.turns) {
      for (const block of turn.blocks) {
        activeBlockKeys.add(blockKey(block));
      }
    }

    setCollapsedByBlockId((current) => {
      let changed = false;
      const next: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(current)) {
        if (activeBlockKeys.has(key)) {
          next[key] = value;
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [options, snapshot]);

  const timeline = React.useMemo(
    () => applyCollapsedState(createTraceTimelineViewModel(snapshot, options), collapsedByBlockId),
    [collapsedByBlockId, options, snapshot],
  );

  const handleIntent = React.useCallback((intent: TraceIntent) => {
    if (intent.type === "collapse") {
      const key = `${intent.sessionId}:${intent.turnId}:${intent.blockId}`;
      setCollapsedByBlockId((current) => ({
        ...current,
        [key]: intent.collapsed,
      }));
      return;
    }

    onIntent?.(intent);
  }, [onIntent]);

  const rootClassName = ["os-agent-session-trace", className].filter(Boolean).join(" ");

  if (timeline.turns.length === 0) {
    return <div className={rootClassName} data-trace-empty>{emptyLabel}</div>;
  }

  return (
    <div className={rootClassName} data-trace-timeline>
      {timeline.turns.map((turn) => (
        <TraceTurn key={turn.id} turn={turn} onIntent={handleIntent} />
      ))}
    </div>
  );
}
