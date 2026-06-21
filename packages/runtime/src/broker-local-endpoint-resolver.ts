import type {
  ActorIdentity,
  AgentDefinition,
  AgentEndpoint,
  AgentHarness,
  InvocationRequest,
} from "@openscout/protocol";

import { isA2AHttpEndpoint } from "./a2a-http-endpoint.js";
import {
  compareLocalEndpointPreference,
  endpointMatchesTargetSession,
} from "./broker-endpoint-selection.js";
import { isManagedLocalSessionMetadata } from "./broker-managed-session-helpers.js";
import {
  invocationTargetSessionId,
  staleLocalEndpointReason,
} from "./broker-local-invocation-helpers.js";
import { isBrokerRunnableLocalAgentTransport } from "./local-agent-transports.js";
import {
  clearEndpointFailureMetadata,
  type LocalAgentBinding,
} from "./local-agents.js";

type LocalEndpointRuntime = {
  endpointsForAgent(
    agentId: string,
    options?: {
      includeOffline?: boolean;
      nodeId?: string;
      harness?: AgentEndpoint["harness"];
    },
  ): AgentEndpoint[];
};

export type BrokerLocalEndpointResolverOptions = {
  nodeId: string;
  runtime: LocalEndpointRuntime;
  isLocalAgentEndpointAlive: (endpoint: AgentEndpoint) => boolean;
  ensureLocalSessionEndpointOnline: (endpoint: AgentEndpoint) => Promise<{
    externalSessionId?: string | null;
    metadata?: Record<string, unknown>;
  }>;
  ensureLocalAgentBindingOnline: (
    agentId: string,
    nodeId: string,
    options: {
      includeDiscovered?: boolean;
      harness?: AgentHarness;
    },
  ) => Promise<LocalAgentBinding | null>;
  upsertActor: (actor: ActorIdentity) => Promise<void>;
  upsertAgent: (agent: AgentDefinition) => Promise<void>;
  persistEndpoint: (endpoint: AgentEndpoint) => Promise<void>;
  now?: () => number;
};

export class BrokerLocalEndpointResolver {
  constructor(private readonly options: BrokerLocalEndpointResolverOptions) {}

  activeLocalEndpointForAgent(
    agentId: string,
    harness?: AgentEndpoint["harness"],
    targetSessionId?: string,
    options: { includeWakeable?: boolean } = {},
  ): AgentEndpoint | undefined {
    const candidates = this.options.runtime.endpointsForAgent(agentId, {
      nodeId: this.options.nodeId,
      harness,
    }).filter((endpoint) => {
      if (endpoint.metadata?.staleLocalRegistration === true) {
        return false;
      }
      return targetSessionId ? endpointMatchesTargetSession(endpoint, targetSessionId) : true;
    });
    const orderedCandidates = targetSessionId
      ? candidates
      : [...candidates].sort(compareLocalEndpointPreference);
    return orderedCandidates.find((endpoint) => (
      isA2AHttpEndpoint(endpoint)
        ? true
        : endpoint.transport === "pairing_bridge"
        ? endpoint.state !== "offline"
        : (options.includeWakeable && isWakeableSessionBackedEndpoint(endpoint))
          || this.options.isLocalAgentEndpointAlive(endpoint)
    ));
  }

  async resolveLocalEndpointForInvocation(invocation: InvocationRequest): Promise<AgentEndpoint | undefined> {
    const requestedHarness = invocation.execution?.harness;
    const targetSessionId = invocationTargetSessionId(invocation);
    const sessionPreference = invocation.execution?.session ?? "new";
    const shouldUseExistingSession = Boolean(targetSessionId);
    const existing = this.activeLocalEndpointForAgent(
      invocation.targetAgentId,
      requestedHarness,
      targetSessionId,
      { includeWakeable: invocation.ensureAwake },
    );
    if (
      existing
      && (
        shouldUseExistingSession
        || existing.transport === "pairing_bridge"
        || isA2AHttpEndpoint(existing)
        || isBrokerRunnableLocalAgentTransport(existing.transport)
      )
    ) {
      return existing;
    }

    if (!shouldUseExistingSession && sessionPreference === "existing") {
      return undefined;
    }

    const staleEndpoints = shouldUseExistingSession
      ? this.options.runtime.endpointsForAgent(invocation.targetAgentId, {
          nodeId: this.options.nodeId,
          harness: requestedHarness,
        }).filter((endpoint) =>
          endpoint.id !== existing?.id
          && endpointMatchesTargetSession(endpoint, targetSessionId!)
        )
      : [];
    const staleLocalReason = staleEndpoints
      .map((endpoint) => staleLocalEndpointReason(endpoint))
      .find((reason): reason is string => Boolean(reason));
    if (staleLocalReason) {
      throw new Error(staleLocalReason);
    }

    if (invocation.ensureAwake && shouldUseExistingSession) {
      for (const endpoint of staleEndpoints) {
        try {
          const revived = await this.reviveManagedLocalSessionEndpoint(endpoint);
          if (revived) return revived;
        } catch (error) {
          await this.options.persistEndpoint({
            ...endpoint,
            state: "offline",
            metadata: {
              ...(endpoint.metadata ?? {}),
              lastError: error instanceof Error ? error.message : String(error),
              lastFailedAt: this.now(),
            },
          });
        }
      }
    }

    for (const endpoint of staleEndpoints) {
      await this.options.persistEndpoint({
        ...endpoint,
        state: "offline",
        metadata: {
          ...(endpoint.metadata ?? {}),
          lastError: endpoint.transport === "tmux"
            ? `tmux session missing: ${endpoint.sessionId ?? endpoint.id}`
            : `${endpoint.transport} session unavailable: ${endpoint.sessionId ?? endpoint.id}`,
          lastFailedAt: this.now(),
        },
      });
    }

    if (!invocation.ensureAwake) {
      return undefined;
    }

    if (targetSessionId) {
      return undefined;
    }

    const binding = await this.options.ensureLocalAgentBindingOnline(invocation.targetAgentId, this.options.nodeId, {
      includeDiscovered: true,
      harness: requestedHarness,
    });
    if (!binding) {
      return undefined;
    }

    if (binding.actor.id !== binding.agent.id) {
      await this.options.upsertActor(binding.actor);
    }
    await this.options.upsertAgent(binding.agent);
    await this.options.persistEndpoint(binding.endpoint);
    return binding.endpoint;
  }

  private async reviveManagedLocalSessionEndpoint(endpoint: AgentEndpoint): Promise<AgentEndpoint | null> {
    if (!isManagedLocalSessionMetadata(endpoint.metadata)) {
      return null;
    }

    const sessionResult = await this.options.ensureLocalSessionEndpointOnline(endpoint);
    const externalSessionId = sessionResult.externalSessionId?.trim();
    const baseMetadata = clearEndpointFailureMetadata(endpoint.metadata);
    const revivedEndpoint: AgentEndpoint = {
      ...endpoint,
      state: "idle",
      metadata: {
        ...baseMetadata,
        ...(sessionResult.metadata ?? {}),
        lastResumedAt: this.now(),
        ...(externalSessionId ? {
          externalSessionId,
          ...(endpoint.transport === "codex_app_server" ? { threadId: externalSessionId } : {}),
        } : {}),
      },
    };
    await this.options.persistEndpoint(revivedEndpoint);
    return revivedEndpoint;
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }
}

function isWakeableSessionBackedEndpoint(endpoint: AgentEndpoint): boolean {
  return endpoint.metadata?.sessionBacked === true
    && endpoint.state !== "offline"
    && isBrokerRunnableLocalAgentTransport(endpoint.transport);
}
