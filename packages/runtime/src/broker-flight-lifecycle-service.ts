import type {
  DeliveryIntent,
  DeliveryStatus,
  FlightRecord,
  InvocationRequest,
  AgentDefinition,
} from "@openscout/protocol";

import type { BrokerJournalEntry } from "./broker-journal.js";
import { endpointStartedAt } from "./broker-endpoint-selection.js";
import {
  isTerminalFlightState,
  staleLocalEndpointReason,
  staleWorkingFlightReason,
} from "./broker-local-invocation-helpers.js";
import type { RuntimeSnapshot } from "./scout-dispatcher.js";

type FlightLifecycleRuntime = {
  snapshot(): RuntimeSnapshot;
  upsertFlight(flight: FlightRecord): Promise<void>;
};

type FlightLifecycleJournal = {
  listDeliveries(options?: {
    limit?: number;
    transport?: DeliveryIntent["transport"];
    status?: DeliveryIntent["status"];
  }): DeliveryIntent[];
};

type DurableStore = {
  runWrite<T>(work: () => Promise<T>): Promise<T>;
  commitEntries(
    entries: BrokerJournalEntry | BrokerJournalEntry[],
    applyRuntime: (entries: BrokerJournalEntry[]) => Promise<void>,
    options?: { enqueueProjection?: boolean },
  ): Promise<BrokerJournalEntry[]>;
  applyProjectedEntries(entries: BrokerJournalEntry | BrokerJournalEntry[]): Promise<void>;
};

export type BrokerFlightLifecycleServiceOptions = {
  runtime: FlightLifecycleRuntime;
  journal: FlightLifecycleJournal;
  durableStore: DurableStore;
  invocationFor: (invocationId: string) => InvocationRequest | undefined;
  updateDeliveryStatus: (input: {
    deliveryId: string;
    status: DeliveryIntent["status"];
    metadata?: Record<string, unknown>;
    leaseOwner?: string | null;
    leaseExpiresAt?: number | null;
  }) => Promise<unknown>;
  promoteInvocationFlightToWork: (
    invocation: InvocationRequest,
    flight: FlightRecord,
    output: string | undefined,
  ) => Promise<void>;
  maybeForwardFlightToAuthority: (flight: FlightRecord) => Promise<void>;
  isInvocationActive: (invocationId: string) => boolean;
  warn?: (message: string, detail?: unknown) => void;
  now?: () => number;
};

export function shouldIgnoreFlightUpdate(previous: FlightRecord, next: FlightRecord): boolean {
  return isTerminalFlightState(previous.state) && !isTerminalFlightState(next.state);
}

const terminalDeliveryStatuses = new Set<DeliveryStatus>(["completed", "failed", "cancelled"]);
const staleReconcileableDeliveryStatuses = new Set<DeliveryStatus>([
  "accepted",
  "deferred",
  "leased",
  "pending",
  "running",
  "sent",
]);

export function deliveryStatusForFlight(flight: FlightRecord): DeliveryStatus | null {
  if (flight.state === "running" || flight.state === "waiting") {
    return "running";
  }
  if (flight.state === "completed") {
    return "completed";
  }
  if (flight.state === "failed") {
    return "failed";
  }
  if (flight.state === "cancelled") {
    return "cancelled";
  }
  return null;
}

export function staleLocalDeliveryReason(
  snapshot: RuntimeSnapshot,
  delivery: DeliveryIntent,
): string | null {
  if (delivery.targetKind !== "agent" || !staleReconcileableDeliveryStatuses.has(delivery.status)) {
    return null;
  }

  const endpoints = Object.values(snapshot.endpoints)
    .filter((endpoint) => endpoint.agentId === delivery.targetId);
  if (endpoints.length === 0) {
    return null;
  }
  if (endpoints.some((endpoint) => staleLocalEndpointReason(endpoint) === null)) {
    return null;
  }

  const staleEndpoints = endpoints
    .filter((endpoint) => staleLocalEndpointReason(endpoint) !== null)
    .sort((left, right) => endpointStartedAt(right) - endpointStartedAt(left));
  const transportMatch = staleEndpoints.find((endpoint) => endpoint.transport === delivery.transport);
  return staleLocalEndpointReason(transportMatch ?? staleEndpoints[0] ?? null);
}

export class BrokerFlightLifecycleService {
  constructor(private readonly options: BrokerFlightLifecycleServiceOptions) {}

  readonly recordFlight = async (flight: FlightRecord): Promise<void> => {
    let recordedFlight: FlightRecord | null = null;
    await this.options.durableStore.runWrite(async () => {
      const previous = this.options.runtime.snapshot().flights[flight.id];
      if (previous && shouldIgnoreFlightUpdate(previous, flight)) {
        this.options.warn?.(
          `[openscout-runtime] ignored stale flight update ${flight.id}: ${previous.state} -> ${flight.state}`,
        );
        return;
      }

      const entries = await this.options.durableStore.commitEntries(
        { kind: "flight.record", flight },
        async () => {
          await this.options.runtime.upsertFlight(flight);
        },
        { enqueueProjection: false },
      );
      await this.options.durableStore.applyProjectedEntries(entries);
      recordedFlight = flight;
    });
    if (!recordedFlight) return;

    const invocation = this.options.invocationFor(flight.invocationId)
      ?? this.options.runtime.snapshot().invocations[flight.invocationId];
    await this.reconcileMessageDeliveriesForFlight(flight, invocation);
    if (invocation && isTerminalFlightState(flight.state)) {
      try {
        await this.options.promoteInvocationFlightToWork(
          invocation,
          flight,
          flight.output ?? flight.error ?? flight.summary,
        );
      } catch (error) {
        this.options.warn?.(
          `[openscout-runtime] failed to update work item for flight ${flight.id}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    try {
      await this.options.maybeForwardFlightToAuthority(flight);
    } catch (error) {
      this.options.warn?.(
        `[openscout-runtime] failed to forward flight ${flight.id} to conversation authority:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  readonly reconcileStaleLocalDeliveries = async (): Promise<void> => {
    const snapshot = this.options.runtime.snapshot();
    const now = this.now();

    for (const delivery of this.options.journal.listDeliveries({ limit: 5000 })) {
      const reason = staleLocalDeliveryReason(snapshot, delivery);
      if (!reason) {
        continue;
      }

      await this.options.updateDeliveryStatus({
        deliveryId: delivery.id,
        status: "failed",
        metadata: {
          failureReason: "agent_offline",
          failureDetail: `Stale local delivery reconciled: ${reason}`,
          staleLocalRegistration: true,
          reconciledStaleDelivery: true,
          reconciledReason: reason,
          reconciledAt: now,
        },
        leaseOwner: null,
        leaseExpiresAt: null,
      });
      this.options.warn?.(`[openscout-runtime] reconciled stale local delivery ${delivery.id}: ${reason}`);
    }
  };

  readonly reconcileStaleWorkingFlights = async (): Promise<void> => {
    const snapshot = this.options.runtime.snapshot();
    const now = this.now();

    for (const flight of Object.values(snapshot.flights)) {
      const reason = staleWorkingFlightReason(snapshot, flight, {
        isInvocationActive: this.options.isInvocationActive,
      });
      if (!reason) {
        continue;
      }

      const agent = snapshot.agents[flight.targetAgentId] as AgentDefinition | undefined;
      const reconciledFlight: FlightRecord = {
        ...flight,
        state: "failed",
        summary: `${agent?.displayName ?? flight.targetAgentId} did not finish cleanly.`,
        error: `Stale running flight reconciled: ${reason}`,
        completedAt: now,
        metadata: {
          ...(flight.metadata ?? {}),
          reconciledStaleFlight: true,
          reconciledReason: reason,
          reconciledAt: now,
        },
      };
      await this.recordFlight(reconciledFlight);
      this.options.warn?.(`[openscout-runtime] reconciled stale running flight ${flight.id}: ${reason}`);
    }
  };

  private async reconcileMessageDeliveriesForFlight(
    flight: FlightRecord,
    invocation: InvocationRequest | undefined,
  ): Promise<void> {
    const status = deliveryStatusForFlight(flight);
    if (!status || !invocation?.messageId) {
      return;
    }

    const updatedAt = flight.completedAt ?? this.now();
    const deliveries = this.options.journal
      .listDeliveries({ limit: 5000 })
      .filter((delivery) => (
        delivery.messageId === invocation.messageId
        && delivery.targetId === flight.targetAgentId
        && delivery.status !== status
        && !terminalDeliveryStatuses.has(delivery.status)
      ));

    for (const delivery of deliveries) {
      await this.options.updateDeliveryStatus({
        deliveryId: delivery.id,
        status,
        metadata: {
          invocationId: flight.invocationId,
          flightId: flight.id,
          flightState: flight.state,
          flightStatusUpdatedAt: updatedAt,
          ...(flight.error ? { failureDetail: flight.error } : {}),
        },
        leaseOwner: null,
        leaseExpiresAt: null,
      });
    }
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }
}
