import type {
  DeliveryAttempt,
  DeliveryIntent,
  FlightRecord,
  InvocationRequest,
  ScoutInvocationLifecycle,
} from "@openscout/protocol";
import { projectInvocationLifecycle } from "@openscout/protocol";

import type { RuntimeRegistrySnapshot } from "./registry.js";

export type InvocationLifecycleReadJournal = {
  listDeliveries: (options?: {
    transport?: DeliveryIntent["transport"];
    status?: DeliveryIntent["status"];
    limit?: number;
  }) => DeliveryIntent[];
  listDeliveryAttempts: (deliveryId: string) => DeliveryAttempt[];
};

export type ReadInvocationLifecycleInput = {
  snapshot: RuntimeRegistrySnapshot;
  journal: InvocationLifecycleReadJournal;
  invocationId: string;
  now?: number;
  deliveryLimit?: number;
};

export function readInvocationLifecycle(
  input: ReadInvocationLifecycleInput,
): ScoutInvocationLifecycle | null {
  const invocationId = input.invocationId.trim();
  if (!invocationId) {
    return null;
  }

  const invocation = input.snapshot.invocations[invocationId];
  if (!invocation) {
    return null;
  }

  const deliveries = input.journal
    .listDeliveries({ limit: input.deliveryLimit ?? 5000 })
    .filter((delivery) => deliveryMatchesInvocation(delivery, invocation));
  const deliveryAttempts = Object.fromEntries(
    deliveries.map((delivery) => [
      delivery.id,
      input.journal.listDeliveryAttempts(delivery.id),
    ]),
  );

  return projectInvocationLifecycle({
    invocation,
    flight: latestFlightForInvocation(input.snapshot, invocationId),
    deliveries,
    deliveryAttempts,
    now: input.now ?? Date.now(),
  });
}

function latestFlightForInvocation(
  snapshot: RuntimeRegistrySnapshot,
  invocationId: string,
): FlightRecord | undefined {
  let latest: FlightRecord | undefined;
  for (const flight of Object.values(snapshot.flights)) {
    if (flight.invocationId !== invocationId) {
      continue;
    }
    if (!latest || flightSortTimestamp(flight) > flightSortTimestamp(latest)) {
      latest = flight;
    }
  }
  return latest;
}

function flightSortTimestamp(flight: FlightRecord): number {
  return flight.completedAt ?? flight.startedAt ?? 0;
}

function deliveryMatchesInvocation(
  delivery: DeliveryIntent,
  invocation: InvocationRequest,
): boolean {
  return delivery.invocationId === invocation.id
    || Boolean(invocation.messageId && delivery.messageId === invocation.messageId)
    || metadataString(delivery.metadata, "invocationId") === invocation.id;
}

function metadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
