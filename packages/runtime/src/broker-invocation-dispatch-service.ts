import {
  type AgentDefinition,
  type FlightRecord,
  type InvocationRequest,
  type NodeDefinition,
  type ScoutDispatchEnvelope,
  type ScoutDispatchRecord,
  type ScoutDispatchUnavailableTarget,
} from "@openscout/protocol";

import type { BrokerJournalEntry } from "./broker-journal.js";
import {
  createInvocationDispatchJob,
  isTerminalInvocationDispatchJobState,
  type BrokerInvocationDispatchJob,
} from "./broker-dispatch-job.js";
import type { InvocationResolution } from "./broker-delivery-routing.js";
import {
  askedLabelForRouteTarget,
  buildDispatchEnvelope,
  type BrokerRouteTargetInput,
  type RuntimeSnapshot,
} from "./scout-dispatcher.js";
import { homeEndpointForAgent } from "./broker-endpoint-selection.js";

export type BrokerInvocationDispatchRuntime = {
  snapshot(): RuntimeSnapshot;
  agent(agentId: string): AgentDefinition | undefined;
  node(nodeId: string): NodeDefinition | undefined;
  flightForInvocation(invocationId: string): FlightRecord | undefined;
};

export type BrokerInvocationDispatchServiceDeps = {
  nodeId: string;
  runtime: BrokerInvocationDispatchRuntime;
  createId: (prefix: string) => string;
  syncRegisteredLocalAgentsIfChanged: (reason: string) => Promise<void>;
  resolveInvocationTarget: (
    payload: InvocationRequest & BrokerRouteTargetInput,
  ) => Promise<InvocationResolution>;
  recordScoutDispatch: (
    envelope: ScoutDispatchEnvelope,
    options?: {
      invocationId?: string;
      conversationId?: string;
      requesterId?: string;
    },
  ) => Promise<{ record: ScoutDispatchRecord }>;
  recordInvocation: (
    invocation: InvocationRequest,
    options?: {
      createDispatchJob?: (flight: FlightRecord) => BrokerInvocationDispatchJob;
      enqueueProjection?: boolean;
    },
  ) => Promise<{ flight: FlightRecord; dispatchJob?: BrokerInvocationDispatchJob; entries: BrokerJournalEntry[] }>;
  recordInvocationDispatchJob: (
    job: BrokerInvocationDispatchJob,
    options?: { enqueueProjection?: boolean },
  ) => Promise<BrokerJournalEntry[]>;
  applyProjectedEntries: (entries: BrokerJournalEntry | BrokerJournalEntry[]) => Promise<void>;
  recordFlight: (flight: FlightRecord) => Promise<void>;
  postInvocationStatusMessage: (invocation: InvocationRequest, flight: {
    id?: string;
    summary?: string;
    error?: string;
  }) => Promise<void>;
  describeRemoteAuthorityIssue: (
    agent: AgentDefinition,
    authorityNode: NodeDefinition | undefined,
  ) => ScoutDispatchUnavailableTarget | null;
  describeUnavailableInvocationTarget?: (
    snapshot: RuntimeSnapshot,
    agent: AgentDefinition,
    targetSessionId?: string,
  ) => ScoutDispatchUnavailableTarget | null;
  buildUnavailableDispatchEnvelope?: (
    askedLabel: string,
    unavailable: ScoutDispatchUnavailableTarget,
  ) => ScoutDispatchEnvelope;
  enqueuePeerInvocation: (invocation: InvocationRequest, authorityNode: NodeDefinition) => Promise<void>;
  launchLocalInvocation: (invocation: InvocationRequest, flight: FlightRecord) => void;
  log?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string, detail: unknown) => void;
  now?: () => number;
};

const DISPATCH_JOB_LEASE_MS = 30_000;

export class BrokerInvocationDispatchService {
  constructor(private readonly deps: BrokerInvocationDispatchServiceDeps) {}

  readonly acceptInvocation = async (
    invocation: InvocationRequest,
  ): Promise<{ flight: FlightRecord; dispatchJob: BrokerInvocationDispatchJob }> => {
    const { flight, dispatchJob, entries } = await this.deps.recordInvocation(invocation, {
      createDispatchJob: (nextFlight) => createInvocationDispatchJob(
        invocation,
        nextFlight,
        currentTime(this.deps),
      ),
      enqueueProjection: false,
    });
    await this.deps.applyProjectedEntries(entries);
    if (!dispatchJob) {
      throw new Error(`dispatch job was not recorded for invocation ${invocation.id}`);
    }
    return { flight, dispatchJob };
  };

  readonly acceptAndDispatch = async (
    invocation: InvocationRequest,
    options: { includeOk?: boolean; logAccepted?: boolean } = {},
  ): Promise<{
    ok?: true;
    accepted: true;
    invocationId: string;
    flightId: string;
    targetAgentId: string;
    state: FlightRecord["state"];
    flight: FlightRecord;
  }> => {
    const { flight, dispatchJob } = await this.acceptInvocation(invocation);
    if (options.logAccepted) {
      this.deps.log?.(
        `[openscout-runtime] invocation ${invocation.id} accepted for ${invocation.targetAgentId} (state=${flight.state})`,
      );
    }
    this.runDispatchJob(dispatchJob, invocation).catch((error) => {
      this.deps.error?.(
        `[openscout-runtime] background dispatch job failed for invocation ${invocation.id}:`,
        error,
      );
    });
    return {
      ...(options.includeOk ? { ok: true as const } : {}),
      accepted: true,
      invocationId: invocation.id,
      flightId: flight.id,
      targetAgentId: invocation.targetAgentId,
      state: flight.state,
      flight,
    };
  };

  readonly handleInvocationRequest = async (
    payload: InvocationRequest & BrokerRouteTargetInput,
  ): Promise<{
    accepted: true;
    invocationId: string;
    dispatch?: ScoutDispatchRecord;
    flightId?: string;
    targetAgentId?: string;
    state?: FlightRecord["state"];
    flight?: FlightRecord;
  }> => {
    await this.deps.syncRegisteredLocalAgentsIfChanged("invocation");
    const resolved = await this.deps.resolveInvocationTarget(payload);
    if (resolved.kind !== "resolved") {
      const envelope = buildDispatchEnvelope(
        resolved,
        askedLabelForRouteTarget(payload),
        this.deps.nodeId,
        this.deps.runtime.snapshot(),
        { homeEndpointFor: homeEndpointForAgent },
      );
      const { record } = await this.deps.recordScoutDispatch(envelope, {
        invocationId: payload.id,
        conversationId: payload.conversationId,
        requesterId: payload.requesterId,
      });
      return {
        accepted: true,
        invocationId: payload.id,
        dispatch: record,
      };
    }

    const invocation: InvocationRequest = {
      ...payload,
      targetAgentId: resolved.agent.id,
    };

    const targetSessionId = targetSessionIdForInvocation(invocation);
    const unavailable = targetSessionId
      ? null
      : this.deps.describeUnavailableInvocationTarget?.(
          this.deps.runtime.snapshot(),
          resolved.agent,
          targetSessionId,
        );
    if (unavailable && this.deps.buildUnavailableDispatchEnvelope) {
      const envelope = this.deps.buildUnavailableDispatchEnvelope(
        askedLabelForRouteTarget(payload),
        unavailable,
      );
      const { record } = await this.deps.recordScoutDispatch(envelope, {
        invocationId: payload.id,
        conversationId: payload.conversationId,
        requesterId: payload.requesterId,
      });
      return {
        accepted: true,
        invocationId: payload.id,
        dispatch: record,
      };
    }

    return await this.acceptAndDispatch(invocation);
  };

  readonly runDispatchJob = async (
    job: BrokerInvocationDispatchJob,
    invocation?: InvocationRequest,
  ): Promise<void> => {
    if (isTerminalInvocationDispatchJobState(job.state)) {
      return;
    }

    const dispatchInvocation = invocation ?? this.deps.runtime.snapshot().invocations[job.invocationId];
    if (!dispatchInvocation) {
      const failedAt = currentTime(this.deps);
      await this.recordDispatchJob({
        ...job,
        state: "failed",
        updatedAt: failedAt,
        completedAt: failedAt,
        lastError: `missing invocation ${job.invocationId}`,
      });
      return;
    }

    const startedAt = currentTime(this.deps);
    const runningJob: BrokerInvocationDispatchJob = {
      ...job,
      state: "running",
      attempts: job.attempts + 1,
      updatedAt: startedAt,
      leaseOwner: `broker:${this.deps.nodeId}`,
      leaseExpiresAt: startedAt + DISPATCH_JOB_LEASE_MS,
      lastError: undefined,
      completedAt: undefined,
    };
    await this.recordDispatchJob(runningJob);

    try {
      await this.dispatchAcceptedInvocation(dispatchInvocation);
      const completedAt = currentTime(this.deps);
      await this.recordDispatchJob({
        ...runningJob,
        state: "completed",
        updatedAt: completedAt,
        completedAt,
        leaseExpiresAt: undefined,
      });
    } catch (error) {
      const failedAt = currentTime(this.deps);
      const message = error instanceof Error ? error.message : String(error);
      await this.recordDispatchJob({
        ...runningJob,
        state: "failed",
        updatedAt: failedAt,
        completedAt: failedAt,
        leaseExpiresAt: undefined,
        lastError: message,
      });
      throw error;
    }
  };

  readonly dispatchAcceptedInvocation = async (invocation: InvocationRequest): Promise<void> => {
    const targetAgent = this.deps.runtime.agent(invocation.targetAgentId);
    if (!targetAgent) {
      await this.failAcceptedInvocation(invocation, `unknown agent ${invocation.targetAgentId}`);
      return;
    }

    const flight = this.deps.runtime.flightForInvocation(invocation.id);
    if (!flight) {
      this.deps.warn?.(`[openscout-runtime] dispatch skipped - flight missing for invocation ${invocation.id}`);
      return;
    }

    if (targetAgent.authorityNodeId && targetAgent.authorityNodeId !== this.deps.nodeId) {
      const authorityNode = this.deps.runtime.node(targetAgent.authorityNodeId);
      const authorityIssue = this.deps.describeRemoteAuthorityIssue(targetAgent, authorityNode);
      if (authorityIssue) {
        await this.failAcceptedInvocation(invocation, authorityIssue.detail);
        return;
      }
      await this.deps.enqueuePeerInvocation(invocation, authorityNode!);
      return;
    }

    if (flight.state === "failed") {
      await this.deps.postInvocationStatusMessage(invocation, flight);
    } else {
      this.deps.launchLocalInvocation(invocation, flight);
    }
  };

  readonly failAcceptedInvocation = async (
    invocation: InvocationRequest,
    detail: string,
  ): Promise<void> => {
    const now = currentTime(this.deps);
    const existing = this.deps.runtime.flightForInvocation(invocation.id);
    const failed: FlightRecord = {
      id: existing?.id ?? this.deps.createId("flt"),
      invocationId: invocation.id,
      requesterId: invocation.requesterId,
      targetAgentId: invocation.targetAgentId,
      state: "failed",
      startedAt: existing?.startedAt ?? now,
      completedAt: now,
      summary: detail,
      error: detail,
      metadata: invocation.metadata,
    };
    await this.deps.recordFlight(failed);
    await this.deps.postInvocationStatusMessage(invocation, failed);
  };

  private async recordDispatchJob(job: BrokerInvocationDispatchJob): Promise<void> {
    const entries = await this.deps.recordInvocationDispatchJob(job, {
      enqueueProjection: false,
    });
    await this.deps.applyProjectedEntries(entries);
  }
}

function currentTime(deps: Pick<BrokerInvocationDispatchServiceDeps, "now">): number {
  return deps.now?.() ?? Date.now();
}

function targetSessionIdForInvocation(invocation: InvocationRequest): string | undefined {
  const executionTarget = invocation.execution?.targetSessionId?.trim();
  if (executionTarget) {
    return executionTarget;
  }
  const metadataTarget = typeof invocation.metadata?.targetSessionId === "string"
    ? invocation.metadata.targetSessionId.trim()
    : "";
  return metadataTarget || undefined;
}
