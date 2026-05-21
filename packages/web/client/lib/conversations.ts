import type { ConversationEntry, Flight, SessionEntry } from "./types.ts";
import { normalizeTimestampMs } from "./time.ts";

type ConversationLike = ConversationEntry | SessionEntry;

export const CONVERSATION_WORKING_TURN_ACTIVE_WINDOW_MS = 30 * 60_000;

export function isDirectConversation(conversation: ConversationLike): boolean {
  return conversation.kind === "direct";
}

export function isGroupConversation(conversation: ConversationLike): boolean {
  return (
    conversation.kind === "channel"
    || conversation.kind === "group_direct"
    || conversation.id.startsWith("channel.")
  );
}

export function conversationDisplayTitle(conversation: ConversationLike): string {
  if (conversation.title && conversation.title !== conversation.id) {
    return conversation.title;
  }
  if (conversation.id.startsWith("channel.")) {
    return conversation.id.replace(/^channel\./, "");
  }
  return conversation.agentName ?? conversation.id;
}

export function conversationShortLabel(conversation: ConversationLike): string {
  if (conversation.id.startsWith("channel.")) {
    return conversation.id.replace(/^channel\./, "");
  }
  return conversationDisplayTitle(conversation);
}

export const TERMINAL_CONVERSATION_FLIGHT_STATES = new Set([
  "completed",
  "failed",
  "cancelled",
]);

export function isActiveConversationFlight(
  flight: Pick<Flight, "state"> | null | undefined,
): boolean {
  return Boolean(
    flight && !TERMINAL_CONVERSATION_FLIGHT_STATES.has(flight.state),
  );
}

export function shouldShowConversationWorkingTurn(
  flight: Pick<Flight, "state"> | null | undefined,
): boolean {
  return isActiveConversationFlight(flight);
}

export function isStaleConversationWorkingTurn(
  flight: Pick<Flight, "state" | "startedAt"> | null | undefined,
  nowMs = Date.now(),
  activeWindowMs = CONVERSATION_WORKING_TURN_ACTIVE_WINDOW_MS,
): boolean {
  if (!isActiveConversationFlight(flight)) {
    return false;
  }
  const startedAt = normalizeTimestampMs(flight?.startedAt);
  return startedAt !== null && nowMs - startedAt > activeWindowMs;
}

export function shouldClearConversationWorkingStateForAgentMessage(
  flight: Pick<Flight, "state"> | null | undefined,
): boolean {
  return !isActiveConversationFlight(flight);
}
