import { useState } from "react";
import { createVantageHandoff } from "../lib/vantage.ts";

type HandoffState =
  | { state: "idle" }
  | { state: "opening" }
  | { state: "opened"; detail: string }
  | { state: "failed"; error: string };

export function VantageHandoffButton({
  agentId,
  agentIds,
  nativeSessionIds,
  className,
  statusClassName,
  label = "Vantage",
  openingLabel = "Opening",
  title = "Open this session context in the native Vantage canvas",
  disabled = false,
}: {
  agentId?: string | null;
  agentIds?: readonly string[];
  nativeSessionIds?: readonly string[];
  className?: string;
  statusClassName?: string;
  label?: string;
  openingLabel?: string;
  title?: string;
  disabled?: boolean;
}) {
  const [handoffState, setHandoffState] = useState<HandoffState>({ state: "idle" });

  const openInVantage = () => {
    setHandoffState({ state: "opening" });
    void createVantageHandoff({ agentId: agentId ?? null, agentIds, nativeSessionIds, launch: true })
      .then((handoff) => {
        const nodeCount = handoff.plan.manifest.nodes.length;
        if (!handoff.launch.ok && handoff.launch.error) {
          setHandoffState({
            state: "failed",
            error: handoff.launch.error,
          });
          return;
        }
        const launchDetail = handoff.launch.ok ? "launch requested" : "handoff written";
        setHandoffState({
          state: "opened",
          detail: `${nodeCount} node${nodeCount === 1 ? "" : "s"} - ${launchDetail}`,
        });
      })
      .catch((error) => {
        setHandoffState({
          state: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      });
  };

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={openInVantage}
        disabled={disabled || handoffState.state === "opening"}
        title={title}
      >
        {handoffState.state === "opening" ? openingLabel : label}
      </button>
      {handoffState.state === "opened" && statusClassName && (
        <span className={`${statusClassName} ${statusClassName}--ok`}>{handoffState.detail}</span>
      )}
      {handoffState.state === "failed" && statusClassName && (
        <span className={`${statusClassName} ${statusClassName}--error`}>{handoffState.error}</span>
      )}
    </>
  );
}
