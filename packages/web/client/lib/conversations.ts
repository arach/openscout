import type { ConversationEntry, SessionEntry } from "./types.ts";

type ConversationLike = ConversationEntry | SessionEntry;

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
