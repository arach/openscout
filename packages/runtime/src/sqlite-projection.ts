import type {
  ActorIdentity,
  ConversationDefinition,
  ControlEvent,
  NodeDefinition,
  ThreadEventEnvelope,
  ThreadSnapshot,
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

  // Older / partial journal entries occasionally lack fields like
  // `homeNodeId` or `originNodeId`. Don't propagate those undefineds
  // into the stub upserts — they'd fail NOT NULL on stub creation
  // and abort the whole replay.
  const addRef = (set: Set<string>, value: string | null | undefined): void => {
    if (typeof value === "string" && value.length > 0) set.add(value);
  };

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
        addRef(referencedNodes, entry.agent.homeNodeId);
        addRef(referencedNodes, entry.agent.authorityNodeId);
        break;
      case "agent.endpoint.upsert":
        addRef(referencedNodes, entry.endpoint.nodeId);
        break;
      case "conversation.upsert":
        providedConversations.add(entry.conversation.id);
        addRef(referencedNodes, entry.conversation.authorityNodeId);
        break;
      case "message.record":
        addRef(referencedNodes, entry.message.originNodeId);
        addRef(referencedActors, entry.message.actorId);
        addRef(referencedConversations, entry.message.conversationId);
        addRef(referencedConversations, entry.message.threadConversationId);
        break;
      case "invocation.record":
        addRef(referencedActors, entry.invocation.requesterId);
        addRef(referencedNodes, entry.invocation.requesterNodeId);
        addRef(referencedNodes, entry.invocation.targetNodeId);
        break;
      case "flight.record":
        addRef(referencedActors, entry.flight.requesterId);
        break;
      case "collaboration.record":
        addRef(referencedActors, entry.record.createdById);
        addRef(referencedActors, entry.record.ownerId);
        addRef(referencedActors, entry.record.nextMoveOwnerId);
        addRef(referencedConversations, entry.record.conversationId);
        break;
      case "collaboration.event.record":
        addRef(referencedActors, entry.event.actorId);
        break;
      case "deliveries.record":
        for (const d of entry.deliveries) {
          addRef(referencedNodes, d.targetNodeId);
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
): ThreadEventEnvelope[] {
  switch (entry.kind) {
    case "node.upsert":
      store.upsertNode(entry.node);
      return [];
    case "actor.upsert":
      store.upsertActor(entry.actor);
      return [];
    case "agent.upsert":
      store.upsertAgent(entry.agent);
      return [];
    case "agent.endpoint.upsert":
      store.upsertEndpoint(entry.endpoint);
      return [];
    case "conversation.upsert":
      store.upsertConversation(entry.conversation);
      return [];
    case "binding.upsert":
      store.upsertBinding(entry.binding);
      return [];
    case "message.record":
      return store.recordMessage(entry.message);
    case "invocation.record":
      store.recordInvocation(entry.invocation);
      return [];
    case "flight.record":
      return store.recordFlight(entry.flight);
    case "collaboration.record":
      return store.recordCollaborationRecord(entry.record);
    case "collaboration.event.record":
      return store.recordCollaborationEvent(entry.event);
    case "deliveries.record":
      store.recordDeliveries(entry.deliveries);
      return [];
    case "delivery.attempt.record":
      store.recordDeliveryAttempt(entry.attempt);
      return [];
    case "delivery.status.update":
      store.updateDeliveryStatus(entry.deliveryId, entry.status, {
        metadata: entry.metadata,
        leaseOwner: entry.leaseOwner,
        leaseExpiresAt: entry.leaseExpiresAt,
      });
      return [];
    case "scout.dispatch.record":
      store.recordScoutDispatch(entry.dispatch);
      return [];
    default: {
      const exhaustive: never = entry;
      return exhaustive;
    }
  }
}

/**
 * Apply each entry independently. A single bad entry (NOT NULL / FK
 * violation from a malformed historical journal record) must not be
 * allowed to abort the batch — otherwise the caller invalidates the
 * whole store and the next write triggers a full re-replay that hits
 * the same entry again, degrading the projection forever.
 */
function applyJournalEntriesToStore(
  store: SQLiteControlPlaneStore,
  entriesInput: BrokerJournalEntry | BrokerJournalEntry[],
  onSkip?: (entry: BrokerJournalEntry, error: unknown) => void,
): ThreadEventEnvelope[] {
  const threadEvents: ThreadEventEnvelope[] = [];
  for (const entry of normalizeEntries(entriesInput)) {
    try {
      threadEvents.push(...applyJournalEntryToStore(store, entry));
    } catch (error) {
      onSkip?.(entry, error);
    }
  }
  return threadEvents;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const skippedEntryReasons = new Set<string>();

function reportSkippedEntry(entry: BrokerJournalEntry, error: unknown): void {
  const reason = formatError(error);
  const key = `${entry.kind}:${reason}`;
  if (skippedEntryReasons.has(key)) return;
  skippedEntryReasons.add(key);
  console.warn(
    `[broker] sqlite projection skipped malformed ${entry.kind} entry: ${reason}`,
  );
}

/**
 * Errors that mean the store itself is unusable (closed db, disk full,
 * locked db, schema mismatch). These must invalidate the store so the
 * next call rebuilds it. Per-entry constraint violations are NOT in
 * this set — those are skipped.
 */
function isFatalStoreError(error: unknown): boolean {
  const msg = formatError(error).toLowerCase();
  if (msg.includes("disk i/o")) return true;
  if (msg.includes("database is locked")) return true;
  if (msg.includes("database disk image is malformed")) return true;
  if (msg.includes("no such table")) return true;
  if (msg.includes("readonly database")) return true;
  return false;
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
        applyJournalEntriesToStore(store, entries, reportSkippedEntry);
      } catch (error) {
        if (isFatalStoreError(error)) {
          this.invalidateStore(error);
        } else {
          reportSkippedEntry({ kind: "unknown" } as never, error);
        }
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

  async applyEntries(entriesInput: BrokerJournalEntry | BrokerJournalEntry[]): Promise<ThreadEventEnvelope[]> {
    const entries = normalizeEntries(entriesInput);
    if (entries.length === 0 || this.options.disabled || this.closed) {
      return [];
    }

    return this.enqueueResult(async () => {
      const store = await this.ensureStore();
      if (!store) {
        return [];
      }

      try {
        return applyJournalEntriesToStore(store, entries, reportSkippedEntry);
      } catch (error) {
        if (isFatalStoreError(error)) {
          this.invalidateStore(error);
        } else {
          reportSkippedEntry({ kind: "unknown" } as never, error);
        }
        return [];
      }
    });
  }

  async latestThreadSeq(conversationId: string): Promise<number> {
    if (this.options.disabled || this.closed) {
      return 0;
    }

    await this.flush();
    const store = await this.ensureStore();
    return store ? store.latestThreadSeq(conversationId) : 0;
  }

  async oldestThreadSeq(conversationId: string): Promise<number> {
    if (this.options.disabled || this.closed) {
      return 0;
    }

    await this.flush();
    const store = await this.ensureStore();
    return store ? store.oldestThreadSeq(conversationId) : 0;
  }

  async listThreadEvents(options: {
    conversationId: string;
    afterSeq?: number;
    limit?: number;
  }): Promise<ThreadEventEnvelope[]> {
    if (this.options.disabled || this.closed) {
      return [];
    }

    await this.flush();
    const store = await this.ensureStore();
    return store ? store.listThreadEvents(options) : [];
  }

  async getThreadSnapshot(conversationId: string): Promise<ThreadSnapshot | null> {
    if (this.options.disabled || this.closed) {
      return null;
    }

    await this.flush();
    const store = await this.ensureStore();
    return store ? store.getThreadSnapshot(conversationId) : null;
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

  private enqueueResult<T>(task: () => Promise<T>): Promise<T> {
    if (this.closed) {
      return Promise.resolve(undefined as T);
    }

    const next = this.queue
      .catch(() => {})
      .then(task);
    this.queue = next.then(() => {}, () => {});
    return next;
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
        try {
          applyJournalEntryToStore(store, entry);
        } catch (error) {
          if (isFatalStoreError(error)) {
            throw error;
          }
          reportSkippedEntry(entry, error);
        }
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
