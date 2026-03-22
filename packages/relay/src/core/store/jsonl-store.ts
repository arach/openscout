import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  isRelayEvent,
  isRelayMessagePostedEvent,
  isRelayStoredMessage,
  relayEventToStoredMessage,
  relayStoredMessageToEvent,
  type RelayEvent,
  type RelayStoredMessage,
} from "../protocol/events.js";
import { formatRelayLogLine, parseRelayLogLine } from "../compat/channel-log.js";

export interface ReadRelayMessagesOptions {
  since?: number;
  last?: number;
  id?: string;
}

export interface ReadRelayEventsOptions {
  since?: number;
  last?: number;
  id?: string;
  kinds?: RelayEvent["kind"][];
}

export function getRelayEventsPath(hub: string): string {
  return join(hub, "channel.jsonl");
}

export function getRelayLogPath(hub: string): string {
  return join(hub, "channel.log");
}

export function createRelayMessageId(): string {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createRelayEventId(prefix = "e"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function parseRelayEventLine(line: string): RelayEvent | null {
  try {
    const parsed = JSON.parse(line);

    if (isRelayEvent(parsed)) {
      return parsed;
    }

    if (isRelayMessagePostedEvent(parsed)) {
      return parsed;
    }

    if (isRelayStoredMessage(parsed)) {
      return relayStoredMessageToEvent(parsed);
    }
  } catch {
    return null;
  }

  return null;
}

function filterRelayEvents(
  events: RelayEvent[],
  opts?: ReadRelayEventsOptions,
): RelayEvent[] {
  if (!opts) return events;

  if (opts.id) {
    const match = events.find((event) => event.id === opts.id);
    return match ? [match] : [];
  }

  let filtered = events;

  if (opts.since) {
    filtered = filtered.filter((event) => event.ts > opts.since!);
  }

  if (opts.kinds?.length) {
    const kindSet = new Set(opts.kinds);
    filtered = filtered.filter((event) => kindSet.has(event.kind));
  }

  if (opts.last) {
    filtered = filtered.slice(-opts.last);
  }

  return filtered;
}

function filterRelayMessages(
  messages: RelayStoredMessage[],
  opts?: ReadRelayMessagesOptions,
): RelayStoredMessage[] {
  if (!opts) return messages;

  if (opts.id) {
    const match = messages.find((message) => message.id === opts.id);
    return match ? [match] : [];
  }

  let filtered = messages;

  if (opts.since) {
    filtered = filtered.filter((message) => message.ts > opts.since!);
  }

  if (opts.last) {
    filtered = filtered.slice(-opts.last);
  }

  return filtered;
}

function parseRelayEventsContent(content: string): RelayStoredMessage[] {
  if (!content.trim()) return [];

  return content
    .split("\n")
    .filter(Boolean)
    .map(parseRelayEventLine)
    .filter((event): event is RelayEvent => event !== null)
    .map(relayEventToStoredMessage)
    .filter((message): message is RelayStoredMessage => message !== null);
}

function parseRelayEventRecordsContent(content: string): RelayEvent[] {
  if (!content.trim()) return [];

  return content
    .split("\n")
    .filter(Boolean)
    .map(parseRelayEventLine)
    .filter((event): event is RelayEvent => event !== null);
}

function parseRelayLogContent(content: string): RelayStoredMessage[] {
  if (!content.trim()) return [];

  return content
    .split("\n")
    .filter(Boolean)
    .map((line, index) => parseRelayLogLine(line, index + 1))
    .filter((message): message is RelayStoredMessage => message !== null);
}

export async function ensureRelayFiles(hub: string): Promise<void> {
  await mkdir(hub, { recursive: true });

  const eventsPath = getRelayEventsPath(hub);
  if (!existsSync(eventsPath)) {
    await writeFile(eventsPath, "");
  }

  const logPath = getRelayLogPath(hub);
  if (!existsSync(logPath)) {
    await writeFile(logPath, "");
  }
}

export async function appendRelayEvent(
  hub: string,
  event: RelayEvent,
): Promise<RelayEvent> {
  await ensureRelayFiles(hub);

  await appendFile(getRelayEventsPath(hub), JSON.stringify(event) + "\n");

  const message = relayEventToStoredMessage(event);
  if (message) {
    await appendFile(getRelayLogPath(hub), formatRelayLogLine(message));
  }

  return event;
}

export async function appendRelayMessage(
  hub: string,
  message: Omit<RelayStoredMessage, "id">,
): Promise<RelayStoredMessage> {
  await ensureRelayFiles(hub);

  const stored: RelayStoredMessage = {
    id: createRelayMessageId(),
    ...message,
  };

  const event = relayStoredMessageToEvent(stored);
  await appendRelayEvent(hub, event);

  return stored;
}

export async function readRelayEvents(
  hub: string,
  opts?: ReadRelayEventsOptions,
): Promise<RelayEvent[]> {
  try {
    const content = await readFile(getRelayEventsPath(hub), "utf8");
    const events = parseRelayEventRecordsContent(content);
    if (events.length > 0) {
      return filterRelayEvents(events, opts);
    }
  } catch {
    // fall through to compat log
  }

  try {
    const content = await readFile(getRelayLogPath(hub), "utf8");
    const events = parseRelayLogContent(content).map(relayStoredMessageToEvent);
    return filterRelayEvents(events, opts);
  } catch {
    return [];
  }
}

export async function readRelayMessages(
  hub: string,
  opts?: ReadRelayMessagesOptions,
): Promise<RelayStoredMessage[]> {
  const events = await readRelayEvents(hub);
  const messages = events
    .map(relayEventToStoredMessage)
    .filter((message): message is RelayStoredMessage => message !== null);
  return filterRelayMessages(messages, opts);
}

export function readRelayEventsSync(
  hub: string,
  opts?: ReadRelayEventsOptions,
): RelayEvent[] {
  try {
    const content = readFileSync(getRelayEventsPath(hub), "utf8");
    const events = parseRelayEventRecordsContent(content);
    if (events.length > 0) {
      return filterRelayEvents(events, opts);
    }
  } catch {
    // fall through to compat log
  }

  try {
    const content = readFileSync(getRelayLogPath(hub), "utf8");
    const events = parseRelayLogContent(content).map(relayStoredMessageToEvent);
    return filterRelayEvents(events, opts);
  } catch {
    return [];
  }
}

export function readRelayMessagesSync(
  hub: string,
  opts?: ReadRelayMessagesOptions,
): RelayStoredMessage[] {
  const events = readRelayEventsSync(hub);
  const messages = events
    .map(relayEventToStoredMessage)
    .filter((message): message is RelayStoredMessage => message !== null);
  return filterRelayMessages(messages, opts);
}
