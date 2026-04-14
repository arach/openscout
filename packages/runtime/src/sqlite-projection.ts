import type { ControlEvent } from "@openscout/protocol";

import { FileBackedBrokerJournal, type BrokerJournalEntry } from "./broker-journal.js";
import { SQLiteControlPlaneStore, type ActivityItem } from "./sqlite-store.js";

type ActivityQuery = Parameters<SQLiteControlPlaneStore["listActivityItems"]>[0];

function normalizeEntries(
  entriesInput: BrokerJournalEntry | BrokerJournalEntry[],
): BrokerJournalEntry[] {
  return Array.isArray(entriesInput) ? entriesInput : [entriesInput];
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
      // Disable FK checks during journal replay — entries may arrive out of
      // order (e.g. message before its conversation) and FK violations would
      // permanently degrade the projection.
      store.setForeignKeys(false);
      await this.journal.replay((entry) => {
        applyJournalEntryToStore(store, entry);
      });
      store.setForeignKeys(true);
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
