import {
  readRelayMessages,
  readRelayMessagesSync,
  type ReadRelayMessagesOptions,
} from "../store/jsonl-store.js";
import { decorateRelayMessageBody } from "../compat/channel-log.js";
import type { RelayMessageClass, RelayStoredMessage } from "../protocol/events.js";

export interface ProjectedRelayMessage {
  id: number;
  eventId: string;
  timestamp: number;
  from: string;
  type: "MSG" | "SYS";
  body: string;
  rawBody: string;
  messageClass?: RelayMessageClass;
  speechText?: string;
  tags: string[];
  to?: string[];
  channel?: string;
}

export function projectRelayMessages(messages: RelayStoredMessage[]): ProjectedRelayMessage[] {
  return messages.map((message, index) => ({
    id: index + 1,
    eventId: message.id,
    timestamp: message.ts,
    from: message.from,
    type: message.type,
    body: decorateRelayMessageBody(message),
    rawBody: message.body,
    messageClass: message.class,
    speechText: message.speech?.text,
    tags: message.tags ?? [],
    to: message.to,
    channel: message.channel,
  }));
}

export async function readProjectedRelayMessages(
  hub: string,
  opts?: ReadRelayMessagesOptions,
): Promise<ProjectedRelayMessage[]> {
  const messages = await readRelayMessages(hub, opts);
  return projectRelayMessages(messages);
}

export function readProjectedRelayMessagesSync(
  hub: string,
  opts?: ReadRelayMessagesOptions,
): ProjectedRelayMessage[] {
  const messages = readRelayMessagesSync(hub, opts);
  return projectRelayMessages(messages);
}
