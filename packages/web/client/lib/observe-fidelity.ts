export type ObserveEvidenceSource = "history" | "live" | "unavailable" | "broker";
export type ObserveEvidenceFidelity = "timestamped" | "synthetic";

export type ObserveEvidencePresentation = {
  label: string;
  detail: string;
  tone: "live" | "recorded" | "reconstructed" | "unavailable";
  replayable: boolean;
};

export function describeObserveEvidence(input: {
  source?: ObserveEvidenceSource;
  fidelity?: ObserveEvidenceFidelity;
  live?: boolean;
  eventCount: number;
}): ObserveEvidencePresentation {
  if (input.source === "unavailable") {
    return {
      label: "Trace unavailable",
      detail: "The session is known to the broker, but no readable event trace was captured.",
      tone: "unavailable",
      replayable: false,
    };
  }

  if (input.fidelity === "timestamped" && input.source === "live" && input.live) {
    return {
      label: "Live observed events",
      detail: "New timestamped events will appear here while the session runs.",
      tone: "live",
      replayable: input.eventCount > 1,
    };
  }

  if (input.fidelity === "timestamped") {
    return {
      label: "Recorded event history",
      detail: "This timeline is replayed from timestamped session history.",
      tone: "recorded",
      replayable: input.eventCount > 1,
    };
  }

  return {
    label: "Reconstructed session evidence",
    detail: "Lifecycle and session attachment are available; fine-grained activity may be missing.",
    tone: "reconstructed",
    replayable: false,
  };
}
