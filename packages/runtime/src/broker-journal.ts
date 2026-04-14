import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  ActorIdentity,
  AgentDefinition,
  AgentEndpoint,
  CollaborationEvent,
  CollaborationRecord,
  ConversationBinding,
  ConversationDefinition,
  DeliveryAttempt,
  DeliveryIntent,
  FlightRecord,
  InvocationRequest,
  MessageRecord,
  NodeDefinition,
  ScoutDispatchRecord,
} from "@openscout/protocol";

import {
  createRuntimeRegistrySnapshot,
  type RuntimeRegistrySnapshot,
} from "./registry.js";

export type BrokerJournalEntry =
  | { kind: "node.upsert"; node: NodeDefinition }
  | { kind: "actor.upsert"; actor: ActorIdentity }
  | { kind: "agent.upsert"; agent: AgentDefinition }
  | { kind: "agent.endpoint.upsert"; endpoint: AgentEndpoint }
  | { kind: "conversation.upsert"; conversation: ConversationDefinition }
  | { kind: "binding.upsert"; binding: ConversationBinding }
  | { kind: "message.record"; message: MessageRecord }
  | { kind: "invocation.record"; invocation: InvocationRequest }
  | { kind: "flight.record"; flight: FlightRecord }
  | { kind: "collaboration.record"; record: CollaborationRecord }
  | { kind: "collaboration.event.record"; event: CollaborationEvent }
  | { kind: "deliveries.record"; deliveries: DeliveryIntent[] }
  | { kind: "delivery.attempt.record"; attempt: DeliveryAttempt }
  | {
      kind: "delivery.status.update";
      deliveryId: string;
      status: DeliveryIntent["status"];
      metadata?: Record<string, unknown>;
      leaseOwner?: string | null;
      leaseExpiresAt?: number | null;
    }
  | { kind: "scout.dispatch.record"; dispatch: ScoutDispatchRecord };

type JournalSnapshotState = {
  snapshot: RuntimeRegistrySnapshot;
  collaborationEvents: CollaborationEvent[];
  deliveries: Map<string, DeliveryIntent>;
  deliveryAttempts: Map<string, DeliveryAttempt[]>;
  scoutDispatches: ScoutDispatchRecord[];
};

type DedupableJournalEntry =
  | BrokerJournalEntry & { kind: "node.upsert" }
  | BrokerJournalEntry & { kind: "actor.upsert" }
  | BrokerJournalEntry & { kind: "agent.upsert" }
  | BrokerJournalEntry & { kind: "agent.endpoint.upsert" }
  | BrokerJournalEntry & { kind: "conversation.upsert" }
  | BrokerJournalEntry & { kind: "binding.upsert" };

function cloneSnapshot(snapshot: RuntimeRegistrySnapshot): RuntimeRegistrySnapshot {
  return createRuntimeRegistrySnapshot({
    nodes: { ...snapshot.nodes },
    actors: { ...snapshot.actors },
    agents: { ...snapshot.agents },
    endpoints: { ...snapshot.endpoints },
    conversations: { ...snapshot.conversations },
    bindings: { ...snapshot.bindings },
    messages: { ...snapshot.messages },
    flights: { ...snapshot.flights },
    collaborationRecords: { ...snapshot.collaborationRecords },
  });
}

function mergeMetadata(
  current: Record<string, unknown> | undefined,
  patch: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!patch) {
    return current;
  }

  return {
    ...(current ?? {}),
    ...patch,
  };
}

function parseEntry(rawLine: string): BrokerJournalEntry | null {
  const line = rawLine.trim();
  if (!line) {
    return null;
  }

  try {
    return JSON.parse(line) as BrokerJournalEntry;
  } catch {
    return null;
  }
}

function normalizeComparableValue(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeComparableValue(entry));
  }

  if (value && typeof value === "object") {
    const normalizedEntries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalizeComparableValue(entry)] as const);
    return Object.fromEntries(normalizedEntries);
  }

  return value;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(normalizeComparableValue(left))
    === JSON.stringify(normalizeComparableValue(right));
}

function dedupeKey(entry: BrokerJournalEntry): string | null {
  switch (entry.kind) {
    case "node.upsert":
      return `${entry.kind}:${entry.node.id}`;
    case "actor.upsert":
      return `${entry.kind}:${entry.actor.id}`;
    case "agent.upsert":
      return `${entry.kind}:${entry.agent.id}`;
    case "agent.endpoint.upsert":
      return `${entry.kind}:${entry.endpoint.id}`;
    case "conversation.upsert":
      return `${entry.kind}:${entry.conversation.id}`;
    case "binding.upsert":
      return `${entry.kind}:${entry.binding.id}`;
    default:
      return null;
  }
}

function isDedupableEntry(entry: BrokerJournalEntry): entry is DedupableJournalEntry {
  return dedupeKey(entry) !== null;
}

function compactRedundantEntries(entries: BrokerJournalEntry[]): BrokerJournalEntry[] {
  const latestIndexByKey = new Map<string, number>();
  for (const [index, entry] of entries.entries()) {
    const key = dedupeKey(entry);
    if (!key) {
      continue;
    }
    latestIndexByKey.set(key, index);
  }

  return entries.filter((entry, index) => {
    const key = dedupeKey(entry);
    return !key || latestIndexByKey.get(key) === index;
  });
}

export class FileBackedBrokerJournal {
  private readonly filePath: string;

  private readonly state: JournalSnapshotState = {
    snapshot: createRuntimeRegistrySnapshot(),
    collaborationEvents: [],
    deliveries: new Map<string, DeliveryIntent>(),
    deliveryAttempts: new Map<string, DeliveryAttempt[]>(),
    scoutDispatches: [],
  };

  private loaded = false;

  private writeQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }

    const entries = await this.readEntries();
    for (const entry of entries) {
      this.apply(entry);
    }

    const compacted = compactRedundantEntries(entries);
    if (compacted.length < entries.length) {
      await this.rewriteEntries(compacted);
    }

    this.loaded = true;
  }

  async readEntries(): Promise<BrokerJournalEntry[]> {
    let body: string;
    try {
      body = await readFile(this.filePath, "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/ENOENT/.test(message)) {
        return [];
      }
      throw error;
    }

    const entries: BrokerJournalEntry[] = [];
    for (const rawLine of body.split(/\r?\n/)) {
      const entry = parseEntry(rawLine);
      if (entry) {
        entries.push(entry);
      }
    }

    return entries;
  }

  async replay(visitor: (entry: BrokerJournalEntry) => void | Promise<void>): Promise<void> {
    for (const entry of await this.readEntries()) {
      await visitor(entry);
    }
  }

  snapshot(): RuntimeRegistrySnapshot {
    return cloneSnapshot(this.state.snapshot);
  }

  async appendEntries(entriesInput: BrokerJournalEntry | BrokerJournalEntry[]): Promise<BrokerJournalEntry[]> {
    const entries = Array.isArray(entriesInput) ? entriesInput : [entriesInput];
    if (entries.length === 0) {
      return [];
    }

    const retained = this.selectEntriesToAppend(entries);
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      if (retained.length === 0) {
        return;
      }
      const payload = retained.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
      await appendFile(this.filePath, payload, "utf8");
      for (const entry of retained) {
        this.apply(entry);
      }
    });

    await this.writeQueue;
    return retained;
  }

  listCollaborationRecords(options: {
    limit?: number;
    kind?: CollaborationRecord["kind"];
    state?: string;
    ownerId?: string;
    nextMoveOwnerId?: string;
  } = {}): CollaborationRecord[] {
    const limit = options.limit ?? 200;
    return Object.values(this.state.snapshot.collaborationRecords)
      .filter((record) => !options.kind || record.kind === options.kind)
      .filter((record) => !options.state || record.state === options.state)
      .filter((record) => !options.ownerId || record.ownerId === options.ownerId)
      .filter((record) => !options.nextMoveOwnerId || record.nextMoveOwnerId === options.nextMoveOwnerId)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, limit);
  }

  listCollaborationEvents(options: { limit?: number; recordId?: string } = {}): CollaborationEvent[] {
    const limit = options.limit ?? 200;
    return [...this.state.collaborationEvents]
      .filter((event) => !options.recordId || event.recordId === options.recordId)
      .sort((left, right) => right.at - left.at)
      .slice(0, limit);
  }

  listDeliveries(options: {
    transport?: DeliveryIntent["transport"];
    status?: DeliveryIntent["status"];
    limit?: number;
  } = {}): DeliveryIntent[] {
    const limit = options.limit ?? 200;
    return [...this.state.deliveries.values()]
      .filter((delivery) => !options.transport || delivery.transport === options.transport)
      .filter((delivery) => !options.status || delivery.status === options.status)
      .slice(0, limit);
  }

  listDeliveryAttempts(deliveryId: string): DeliveryAttempt[] {
    return [...(this.state.deliveryAttempts.get(deliveryId) ?? [])]
      .sort((left, right) => (
        left.attempt === right.attempt
          ? left.createdAt - right.createdAt
          : left.attempt - right.attempt
      ));
  }

  private async rewriteEntries(entries: BrokerJournalEntry[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const payload = entries.length > 0
      ? `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`
      : "";
    await writeFile(this.filePath, payload, "utf8");
  }

  private selectEntriesToAppend(entries: BrokerJournalEntry[]): BrokerJournalEntry[] {
    const nextSnapshot = cloneSnapshot(this.state.snapshot);
    const retained: BrokerJournalEntry[] = [];

    for (const entry of entries) {
      if (!this.shouldAppendEntry(entry, nextSnapshot)) {
        continue;
      }
      retained.push(entry);
      this.applyToSnapshot(nextSnapshot, entry);
    }

    return retained;
  }

  private shouldAppendEntry(
    entry: BrokerJournalEntry,
    snapshot: RuntimeRegistrySnapshot,
  ): boolean {
    if (!isDedupableEntry(entry)) {
      return true;
    }

    switch (entry.kind) {
      case "node.upsert":
        return !sameValue(snapshot.nodes[entry.node.id], entry.node);
      case "actor.upsert":
        return !sameValue(snapshot.actors[entry.actor.id], entry.actor);
      case "agent.upsert":
        return !sameValue(snapshot.agents[entry.agent.id], entry.agent);
      case "agent.endpoint.upsert":
        return !sameValue(snapshot.endpoints[entry.endpoint.id], entry.endpoint);
      case "conversation.upsert":
        return !sameValue(snapshot.conversations[entry.conversation.id], entry.conversation);
      case "binding.upsert":
        return !sameValue(snapshot.bindings[entry.binding.id], entry.binding);
      default:
        return true;
    }
  }

  private applyToSnapshot(snapshot: RuntimeRegistrySnapshot, entry: BrokerJournalEntry): void {
    switch (entry.kind) {
      case "node.upsert":
        snapshot.nodes[entry.node.id] = entry.node;
        return;
      case "actor.upsert":
        snapshot.actors[entry.actor.id] = entry.actor;
        return;
      case "agent.upsert":
        snapshot.agents[entry.agent.id] = entry.agent;
        if (!snapshot.actors[entry.agent.id]) {
          snapshot.actors[entry.agent.id] = {
            id: entry.agent.id,
            kind: entry.agent.kind,
            displayName: entry.agent.displayName,
            handle: entry.agent.handle,
            labels: entry.agent.labels,
            metadata: entry.agent.metadata,
          };
        }
        return;
      case "agent.endpoint.upsert":
        snapshot.endpoints[entry.endpoint.id] = entry.endpoint;
        return;
      case "conversation.upsert":
        snapshot.conversations[entry.conversation.id] = entry.conversation;
        return;
      case "binding.upsert":
        snapshot.bindings[entry.binding.id] = entry.binding;
        return;
      default:
        return;
    }
  }

  private apply(entry: BrokerJournalEntry): void {
    switch (entry.kind) {
      case "node.upsert":
        this.state.snapshot.nodes[entry.node.id] = entry.node;
        return;
      case "actor.upsert":
        this.state.snapshot.actors[entry.actor.id] = entry.actor;
        return;
      case "agent.upsert":
        this.state.snapshot.agents[entry.agent.id] = entry.agent;
        if (!this.state.snapshot.actors[entry.agent.id]) {
          this.state.snapshot.actors[entry.agent.id] = {
            id: entry.agent.id,
            kind: entry.agent.kind,
            displayName: entry.agent.displayName,
            handle: entry.agent.handle,
            labels: entry.agent.labels,
            metadata: entry.agent.metadata,
          };
        }
        return;
      case "agent.endpoint.upsert":
        this.state.snapshot.endpoints[entry.endpoint.id] = entry.endpoint;
        return;
      case "conversation.upsert":
        this.state.snapshot.conversations[entry.conversation.id] = entry.conversation;
        return;
      case "binding.upsert":
        this.state.snapshot.bindings[entry.binding.id] = entry.binding;
        return;
      case "message.record":
        this.state.snapshot.messages[entry.message.id] = entry.message;
        return;
      case "invocation.record":
        return;
      case "flight.record":
        this.state.snapshot.flights[entry.flight.id] = entry.flight;
        return;
      case "collaboration.record":
        this.state.snapshot.collaborationRecords[entry.record.id] = entry.record;
        return;
      case "collaboration.event.record":
        this.state.collaborationEvents.push(entry.event);
        return;
      case "deliveries.record":
        for (const delivery of entry.deliveries) {
          this.state.deliveries.set(delivery.id, delivery);
        }
        return;
      case "delivery.attempt.record": {
        const attempts = this.state.deliveryAttempts.get(entry.attempt.deliveryId) ?? [];
        attempts.push(entry.attempt);
        this.state.deliveryAttempts.set(entry.attempt.deliveryId, attempts);
        return;
      }
      case "delivery.status.update": {
        const current = this.state.deliveries.get(entry.deliveryId);
        if (!current) {
          return;
        }

        this.state.deliveries.set(entry.deliveryId, {
          ...current,
          status: entry.status,
          leaseOwner: entry.leaseOwner ?? undefined,
          leaseExpiresAt: entry.leaseExpiresAt ?? undefined,
          metadata: mergeMetadata(current.metadata, entry.metadata),
        });
        return;
      }
      case "scout.dispatch.record":
        this.state.scoutDispatches.push(entry.dispatch);
        return;
      default: {
        const exhaustive: never = entry;
        return exhaustive;
      }
    }
  }

  listScoutDispatches(options: { limit?: number; askedLabel?: string } = {}): ScoutDispatchRecord[] {
    const limit = options.limit ?? 200;
    return [...this.state.scoutDispatches]
      .filter((record) => !options.askedLabel || record.askedLabel === options.askedLabel)
      .sort((left, right) => right.dispatchedAt - left.dispatchedAt)
      .slice(0, limit);
  }
}
