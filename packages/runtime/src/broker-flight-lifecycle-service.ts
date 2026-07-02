import type {
  DeliveryIntent,
  DeliveryStatus,
  FlightRecord,
  InvocationRequest,
  AgentDefinition,
  AgentEndpoint,
} from "@openscout/protocol";

import type { BrokerJournalEntry } from "./broker-journal.js";
import {
  endpointCandidateState,
  endpointLifecycleAt,
  endpointStartedAt,
} from "./broker-endpoint-selection.js";
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
  /**
   * Tear down the Scout-created isolation workspace for a settled flight's
   * target agent (COW clone or git worktree under `.scout-worktrees/`). Fixes
   * the historical workspace leak. Optional; a no-op when unwired. The
   * implementation is expected to no-op safely if the agent has no workspace
   * or it is already gone.
   */
  teardownAgentWorkspace?: (agentId: string, flight: FlightRecord) => Promise<void>;
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

  const unavailableEndpoints = endpoints
    .map((endpoint) => ({
      endpoint,
      reason: localEndpointUnavailableReason(endpoint),
    }));
  if (unavailableEndpoints.some((entry) => entry.reason === null)) {
    return null;
  }

  const rankedUnavailable = unavailableEndpoints
    .sort((left, right) => endpointLifecycleAt(right.endpoint) - endpointLifecycleAt(left.endpoint));
  const transportMatch = rankedUnavailable.find((entry) => entry.endpoint.transport === delivery.transport);
  return (transportMatch ?? rankedUnavailable[0] ?? null)?.reason ?? null;
}

function localEndpointUnavailableReason(endpoint: AgentEndpoint): string | null {
  const staleReason = staleLocalEndpointReason(endpoint);
  if (staleReason) {
    return staleReason;
  }

  if (endpointCandidateState(endpoint.state) === "offline") {
    return `endpoint ${endpoint.id} is ${endpoint.state}`;
  }

  return null;
}

function normalizeRecordedFlight(
  flight: FlightRecord,
  invocation: InvocationRequest | undefined,
  now: number,
): FlightRecord {
  if (
    invocation?.action !== "consult"
    || flight.state !== "completed"
    || flight.output?.trim()
  ) {
    return flight;
  }

  const error = `Consult flight ${flight.id} completed without broker-visible output.`;
  return {
    ...flight,
    state: "failed",
    output: undefined,
    summary: flight.summary?.trim()
      ? `${flight.summary.trim()} No broker-visible reply was posted.`
      : "The target completed without a broker-visible reply.",
    error,
    completedAt: flight.completedAt ?? now,
    metadata: {
      ...(flight.metadata ?? {}),
      failureStage: "empty_completed_output",
    },
  };
}

export class BrokerFlightLifecycleService {
  constructor(private readonly options: BrokerFlightLifecycleServiceOptions) {}

  readonly recordFlight = async (flight: FlightRecord): Promise<void> => {
    const invocation = this.options.invocationFor(flight.invocationId)
      ?? this.options.runtime.snapshot().invocations[flight.invocationId];
    const flightToRecord = normalizeRecordedFlight(flight, invocation, this.now());
    let didRecordFlight = false;
    await this.options.durableStore.runWrite(async () => {
      const previous = this.options.runtime.snapshot().flights[flightToRecord.id];
      if (previous && shouldIgnoreFlightUpdate(previous, flightToRecord)) {
        this.options.warn?.(
          `[openscout-runtime] ignored stale flight update ${flightToRecord.id}: ${previous.state} -> ${flightToRecord.state}`,
        );
        return;
      }

      const entries = await this.options.durableStore.commitEntries(
        { kind: "flight.record", flight: flightToRecord },
        async () => {
          await this.options.runtime.upsertFlight(flightToRecord);
        },
        { enqueueProjection: false },
      );
      await this.options.durableStore.applyProjectedEntries(entries);
      didRecordFlight = true;
    });
    if (!didRecordFlight) return;

    await this.reconcileMessageDeliveriesForFlight(flightToRecord, invocation);
    if (invocation && isTerminalFlightState(flightToRecord.state)) {
      try {
        await this.options.promoteInvocationFlightToWork(
          invocation,
          flightToRecord,
          flightToRecord.output ?? flightToRecord.error ?? flightToRecord.summary,
        );
      } catch (error) {
        this.options.warn?.(
          `[openscout-runtime] failed to update work item for flight ${flightToRecord.id}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    // Tear down the agent's isolation workspace once the flight settles. This
    // is independent of the invocation lookup — a leaked workspace should be
    // reclaimed even if the originating invocation has been forgotten.
    if (this.options.teardownAgentWorkspace && isTerminalFlightState(flightToRecord.state)) {
      try {
        await this.options.teardownAgentWorkspace(flightToRecord.targetAgentId, flightToRecord);
      } catch (error) {
        this.options.warn?.(
          `[openscout-runtime] failed to tear down workspace for flight ${flightToRecord.id}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    try {
      await this.options.maybeForwardFlightToAuthority(flightToRecord);
    } catch (error) {
      this.options.warn?.(
        `[openscout-runtime] failed to forward flight ${flightToRecord.id} to conversation authority:`,
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
