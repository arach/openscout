import type {
  ActorIdentity,
  ConversationDefinition,
  ControlEvent,
  NodeDefinition,
} from "@openscout/protocol";

import { FileBackedBrokerJournal, type BrokerJournalEntry } from "./broker-journal.js";
import { SQLiteControlPlaneStore, type ActivityItem } from "./sqlite-store.js";

type ActivityQuery = Parameters<SQLiteControlPlaneStore["listActivityItems"]>[0];

function normalizeEntries(
  entriesInput: BrokerJournalEntry | BrokerJournalEntry[],
): BrokerJournalEntry[] {
  return Array.isArray(entriesInput) ? entriesInput : [entriesInput];
}

/**
 * Dependency tier for journal entry kinds.  Lower tiers must be applied first
 * so that FK references (messages → conversations → actors → nodes) are
 * satisfied.  Within the same tier the original journal order is preserved.
 */
const REPLAY_TIER: Record<string, number> = {
  "node.upsert": 0,
  "actor.upsert": 1,
  "agent.upsert": 1,
  "agent.endpoint.upsert": 2,
  "conversation.upsert": 2,
  "binding.upsert": 3,
  "message.record": 4,
  "invocation.record": 4,
  "flight.record": 4,
  "collaboration.record": 4,
  "collaboration.event.record": 5,
  "deliveries.record": 5,
  "delivery.attempt.record": 6,
  "delivery.status.update": 6,
  "scout.dispatch.record": 5,
};

function replayTier(entry: BrokerJournalEntry): number {
  return REPLAY_TIER[entry.kind] ?? 9;
}

/**
 * Scan journal entries for FK target IDs that are referenced but never
 * provided by an upsert entry.  Insert minimal stub rows so the main
 * replay doesn't hit FK constraint failures on old/incomplete journals.
 */
function insertStubsForOrphanedFkTargets(
  store: SQLiteControlPlaneStore,
  entries: BrokerJournalEntry[],
): void {
  const providedNodes = new Set<string>();
  const providedActors = new Set<string>();
  const providedConversations = new Set<string>();

  const referencedNodes = new Set<string>();
  const referencedActors = new Set<string>();
  const referencedConversations = new Set<string>();

  for (const entry of entries) {
    switch (entry.kind) {
      case "node.upsert":
        providedNodes.add(entry.node.id);
        break;
      case "actor.upsert":
        providedActors.add(entry.actor.id);
        break;
      case "agent.upsert":
        providedActors.add(entry.agent.id);
        referencedNodes.add(entry.agent.homeNodeId);
        referencedNodes.add(entry.agent.authorityNodeId);
        break;
      case "agent.endpoint.upsert":
        referencedNodes.add(entry.endpoint.nodeId);
        break;
      case "conversation.upsert":
        providedConversations.add(entry.conversation.id);
        referencedNodes.add(entry.conversation.authorityNodeId);
        break;
      case "message.record":
        referencedNodes.add(entry.message.originNodeId);
        referencedActors.add(entry.message.actorId);
        referencedConversations.add(entry.message.conversationId);
        if (entry.message.threadConversationId) {
          referencedConversations.add(entry.message.threadConversationId);
        }
        break;
      case "invocation.record":
        referencedActors.add(entry.invocation.requesterId);
        referencedNodes.add(entry.invocation.requesterNodeId);
        if (entry.invocation.targetNodeId) {
          referencedNodes.add(entry.invocation.targetNodeId);
        }
        break;
      case "flight.record":
        referencedActors.add(entry.flight.requesterId);
        break;
      case "collaboration.record":
        referencedActors.add(entry.record.createdById);
        if (entry.record.ownerId) referencedActors.add(entry.record.ownerId);
        if (entry.record.nextMoveOwnerId) referencedActors.add(entry.record.nextMoveOwnerId);
        if (entry.record.conversationId) referencedConversations.add(entry.record.conversationId);
        break;
      case "collaboration.event.record":
        referencedActors.add(entry.event.actorId);
        break;
      case "deliveries.record":
        for (const d of entry.deliveries) {
          if (d.targetNodeId) referencedNodes.add(d.targetNodeId);
        }
        break;
      default:
        break;
    }
  }

  const now = Date.now();

  // Stub missing nodes (tier 0 — must come first)
  for (const id of referencedNodes) {
    if (!providedNodes.has(id)) {
      store.upsertNode({
        id,
        meshId: "unknown",
        name: id,
        advertiseScope: "local",
        registeredAt: now,
      } as NodeDefinition);
    }
  }

  // Stub missing actors (tier 1)
  for (const id of referencedActors) {
    if (!providedActors.has(id)) {
      store.upsertActor({ id, kind: "agent", displayName: id } as ActorIdentity);
    }
  }

  // Stub missing conversations (tier 2)
  const anyNodeId =
    providedNodes.values().next().value ??
    referencedNodes.values().next().value ??
    "unknown";
  for (const id of referencedConversations) {
    if (!providedConversations.has(id)) {
      store.upsertConversation({
        id,
        kind: "direct",
        title: id,
        visibility: "private",
        shareMode: "local",
        authorityNodeId: anyNodeId,
        participantIds: [],
      } as ConversationDefinition);
    }
  }
}

function applyJournalEntryToStore(
  store: SQLiteControlPlaneStore,
  entry: BrokerJournalEntry,
): void {
  switch (entry.kind) {
    case "node.upsert":
      store.upsertNode(entry.node);
      return;
    case "actor.upsert":
      store.upsertActor(entry.actor);
      return;
    case "agent.upsert":
      store.upsertAgent(entry.agent);
      return;
    case "agent.endpoint.upsert":
      store.upsertEndpoint(entry.endpoint);
      return;
    case "conversation.upsert":
      store.upsertConversation(entry.conversation);
      return;
    case "binding.upsert":
      store.upsertBinding(entry.binding);
      return;
    case "message.record":
      store.recordMessage(entry.message);
      return;
    case "invocation.record":
      store.recordInvocation(entry.invocation);
      return;
    case "flight.record":
      store.recordFlight(entry.flight);
      return;
    case "collaboration.record":
      store.recordCollaborationRecord(entry.record);
      return;
    case "collaboration.event.record":
      store.recordCollaborationEvent(entry.event);
      return;
    case "deliveries.record":
      store.recordDeliveries(entry.deliveries);
      return;
    case "delivery.attempt.record":
      store.recordDeliveryAttempt(entry.attempt);
      return;
    case "delivery.status.update":
      store.updateDeliveryStatus(entry.deliveryId, entry.status, {
        metadata: entry.metadata,
        leaseOwner: entry.leaseOwner,
        leaseExpiresAt: entry.leaseExpiresAt,
      });
      return;
    case "scout.dispatch.record":
      store.recordScoutDispatch(entry.dispatch);
      return;
    default: {
      const exhaustive: never = entry;
      return exhaustive;
    }
  }
}

function applyJournalEntriesToStore(
  store: SQLiteControlPlaneStore,
  entriesInput: BrokerJournalEntry | BrokerJournalEntry[],
): void {
  for (const entry of normalizeEntries(entriesInput)) {
    applyJournalEntryToStore(store, entry);
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class RecoverableSQLiteProjection {
  private store: SQLiteControlPlaneStore | null = null;

  private queue: Promise<void> = Promise.resolve();

  private closed = false;

  private lastUnavailableReason: string | null = null;

  constructor(
    private readonly dbPath: string,
    private readonly journal: FileBackedBrokerJournal,
    private readonly options: { disabled?: boolean } = {},
  ) {}

  warm(): void {
    this.enqueue(async () => {
      await this.ensureStore();
    });
  }

  enqueueEntries(entriesInput: BrokerJournalEntry | BrokerJournalEntry[]): void {
    const entries = normalizeEntries(entriesInput);
    if (entries.length === 0 || this.options.disabled || this.closed) {
      return;
    }

    this.enqueue(async () => {
      const store = await this.ensureStore();
      if (!store) {
        return;
      }

      try {
        applyJournalEntriesToStore(store, entries);
      } catch (error) {
        this.invalidateStore(error);
      }
    });
  }

  enqueueEvent(event: ControlEvent): void {
    if (this.options.disabled || this.closed) {
      return;
    }

    this.enqueue(async () => {
      const store = await this.ensureStore();
      if (!store) {
        return;
      }

      try {
        store.recordEvent(event);
      } catch (error) {
        this.invalidateStore(error);
      }
    });
  }

  async listActivityItems(options: ActivityQuery = {}): Promise<ActivityItem[]> {
    if (this.options.disabled || this.closed) {
      return [];
    }

    await this.flush();
    const store = await this.ensureStore();
    if (!store) {
      return [];
    }

    try {
      return store.listActivityItems(options);
    } catch (error) {
      this.invalidateStore(error);
      return [];
    }
  }

  async flush(): Promise<void> {
    await this.queue.catch(() => {});
  }

  close(): void {
    this.closed = true;
    const current = this.store;
    this.store = null;
    current?.close();
  }

  private enqueue(task: () => Promise<void>): void {
    if (this.closed) {
      return;
    }

    this.queue = this.queue
      .catch(() => {})
      .then(task);
  }

  private async ensureStore(): Promise<SQLiteControlPlaneStore | null> {
    if (this.options.disabled || this.closed) {
      return null;
    }
    if (this.store) {
      return this.store;
    }

    try {
      const store = new SQLiteControlPlaneStore(this.dbPath);
      // Collect all entries and sort by dependency tier so parent rows
      // (nodes, actors, conversations) are inserted before children
      // (messages, deliveries).  Stable sort preserves journal order
      // within each tier.
      const entries: BrokerJournalEntry[] = [];
      await this.journal.replay((entry) => { entries.push(entry); });
      entries.sort((a, b) => replayTier(a) - replayTier(b));
      insertStubsForOrphanedFkTargets(store, entries);
      for (const entry of entries) {
        applyJournalEntryToStore(store, entry);
      }
      this.store = store;
      this.lastUnavailableReason = null;
      return store;
    } catch (error) {
      this.invalidateStore(error);
      return null;
    }
  }

  private invalidateStore(error: unknown): void {
    const reason = formatError(error);
    if (this.lastUnavailableReason !== reason) {
      console.warn(`[broker] sqlite projection unavailable (degraded): ${reason}`);
      this.lastUnavailableReason = reason;
    }

    const current = this.store;
    this.store = null;
    current?.close();
  }
}
