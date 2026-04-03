import type {
  CollaborationWaitingOn,
  InvocationRequest,
} from "@openscout/protocol";

function metadataValue(
  metadata: Record<string, unknown> | undefined,
  key: string,
): unknown {
  return metadata?.[key];
}

function stringValue(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadataValue(metadata, key);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function recordFromInvocation(invocation: InvocationRequest, key: string): unknown {
  const contextRecord = metadataValue(invocation.context, key);
  if (typeof contextRecord !== "undefined") {
    return contextRecord;
  }

  const nestedContext = metadataValue(invocation.context, "collaboration");
  if (nestedContext && typeof nestedContext === "object" && !Array.isArray(nestedContext)) {
    const nestedValue = metadataValue(nestedContext as Record<string, unknown>, key);
    if (typeof nestedValue !== "undefined") {
      return nestedValue;
    }
  }

  const metadataRecord = metadataValue(invocation.metadata, key);
  if (typeof metadataRecord !== "undefined") {
    return metadataRecord;
  }

  const nestedMetadata = metadataValue(invocation.metadata, "collaboration");
  if (nestedMetadata && typeof nestedMetadata === "object" && !Array.isArray(nestedMetadata)) {
    return metadataValue(nestedMetadata as Record<string, unknown>, key);
  }

  return undefined;
}

function stringFromInvocation(invocation: InvocationRequest, key: string): string | undefined {
  const value = recordFromInvocation(invocation, key);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function waitingOnLabel(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const waitingOn = value as CollaborationWaitingOn;
  const kind = typeof waitingOn.kind === "string" ? waitingOn.kind : undefined;
  const label = typeof waitingOn.label === "string" ? waitingOn.label.trim() : "";
  const targetId = typeof waitingOn.targetId === "string" ? waitingOn.targetId.trim() : "";
  const parts = [label || kind, targetId || undefined].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function buildCollaborationContractPrompt(agentId: string): string {
  return [
    "Collaboration contract:",
    `  - Identity: act as the stable OpenScout agent "${agentId}" for this turn`,
    "  - Treat information-seeking requests as questions and durable execution as work",
    "  - Use collaboration verbs intentionally: answer, delegate, wait, review, complete",
    "  - @mention another agent only when handing off real work or requesting a concrete answer",
    "  - Do not broadcast ordinary delegation or wake agents who do not own the next move",
    "  - If you can answer safely, answer directly",
    "  - If more work is required, make the next responsible agent explicit",
    "  - If blocked, say what you are waiting on and who owns the next move",
    "  - If asking for review, say exactly what needs review and who should review it",
    "  - If complete, return the final answer without waking additional agents",
  ].join("\n");
}

export function buildInvocationCollaborationContextPrompt(
  invocation: InvocationRequest,
): string | undefined {
  const recordId = stringFromInvocation(invocation, "recordId")
    ?? stringFromInvocation(invocation, "collaborationRecordId");
  const kind = stringFromInvocation(invocation, "kind")
    ?? stringFromInvocation(invocation, "collaborationKind");
  const state = stringFromInvocation(invocation, "state")
    ?? stringFromInvocation(invocation, "collaborationState");
  const ownerId = stringFromInvocation(invocation, "ownerId");
  const nextMoveOwnerId = stringFromInvocation(invocation, "nextMoveOwnerId");
  const wakeReason = stringFromInvocation(invocation, "wakeReason");
  const targetAgentId = stringFromInvocation(invocation, "targetAgentId");
  const waitingOn = waitingOnLabel(
    recordFromInvocation(invocation, "waitingOn")
      ?? recordFromInvocation(invocation, "waiting_on"),
  );
  const acceptanceState = stringFromInvocation(invocation, "acceptanceState");
  const requestedById = stringFromInvocation(invocation, "requestedById");
  const askedById = stringFromInvocation(invocation, "askedById");
  const askedOfId = stringFromInvocation(invocation, "askedOfId");

  const lines = [
    recordId ? `  - Record: ${kind ? `${kind} ` : ""}${recordId}` : undefined,
    state ? `  - State: ${state}` : undefined,
    ownerId ? `  - Owner: ${ownerId}` : undefined,
    nextMoveOwnerId ? `  - Next move owner: ${nextMoveOwnerId}` : undefined,
    wakeReason ? `  - Wake reason: ${wakeReason}` : undefined,
    targetAgentId ? `  - Wake target: ${targetAgentId}` : undefined,
    waitingOn ? `  - Waiting on: ${waitingOn}` : undefined,
    acceptanceState ? `  - Acceptance: ${acceptanceState}` : undefined,
    requestedById ? `  - Requested by: ${requestedById}` : undefined,
    askedById ? `  - Asked by: ${askedById}` : undefined,
    askedOfId ? `  - Asked of: ${askedOfId}` : undefined,
  ].filter((value): value is string => Boolean(value));

  if (lines.length === 0) {
    return undefined;
  }

  return ["Collaboration context:", ...lines].join("\n");
}
