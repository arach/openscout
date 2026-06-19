import {
  buildScoutReturnAddress,
  type AgentDefinition,
  type AgentEndpoint,
  type ConversationDefinition,
  type FlightRecord,
  type InvocationRequest,
  type MessageRecord,
} from "@openscout/protocol";

import {
  invokeA2AHttpEndpoint,
  isA2AHttpEndpoint,
  type A2AHttpInvocationResult,
} from "./a2a-http-endpoint.js";
import { latestEndpointForAgent } from "./broker-endpoint-selection.js";
import {
  dispatchAckStrategyForEndpoint,
  invocationTargetSessionId,
  isTerminalFlightState,
  staleLocalEndpointReason,
} from "./broker-local-invocation-helpers.js";
import { isBrokerRunnableLocalAgentTransport } from "./local-agent-transports.js";
import type { PairingInvocationResult } from "./pairing-session-agents.js";
import type { RuntimeSnapshot } from "./scout-dispatcher.js";
import { isRequesterWaitTimeoutError } from "./requester-timeout.js";
import { isDispatchStalledError } from "./dispatch-stalled.js";
import { isCodexAppServerExitError } from "./codex-app-server.js";

type LocalInvocationRuntime = {
  agent(agentId: string): AgentDefinition | undefined;
  conversation(conversationId: string): ConversationDefinition | undefined;
  flightForInvocation(invocationId: string): FlightRecord | undefined;
  snapshot(): RuntimeSnapshot;
};

type LocalInvocationEndpointResolver = {
  activeLocalEndpointForAgent(
    agentId: string,
    harness?: AgentEndpoint["harness"],
    targetSessionId?: string,
  ): AgentEndpoint | undefined;
  resolveLocalEndpointForInvocation(invocation: InvocationRequest): Promise<AgentEndpoint | undefined>;
};

type LocalAgentInvocationResult = {
  output: string;
  externalSessionId?: string | null;
  metadata?: Record<string, unknown>;
};

type InvocationExecutorResult =
  | PairingInvocationResult
  | A2AHttpInvocationResult
  | LocalAgentInvocationResult;

export type BrokerLocalInvocationServiceOptions = {
  nodeId: string;
  runtime: LocalInvocationRuntime;
  endpointResolver: LocalInvocationEndpointResolver;
  activeInvocationTasks: Map<string, Promise<void>>;
  createId: (prefix: string) => string;
  persistFlight: (flight: FlightRecord) => Promise<void>;
  persistEndpoint: (endpoint: AgentEndpoint) => Promise<void>;
  postInvocationStatusMessage: (
    invocation: InvocationRequest,
    flight: { id?: string; summary?: string; error?: string },
  ) => Promise<void>;
  postConversationMessage: (message: MessageRecord) => Promise<unknown>;
  existingBrokerReplyForInvocation: (
    invocation: InvocationRequest,
    agentId: string,
    sinceMs: number,
  ) => MessageRecord | null;
  completeInvocationForBrokerReply: (
    invocation: InvocationRequest,
    reply: MessageRecord,
  ) => Promise<boolean>;
  messageVisibilityForConversation: (conversation?: ConversationDefinition) => MessageRecord["visibility"];
  scoutbotReplyProvenanceMetadata: (invocation: InvocationRequest) => Record<string, unknown>;
  invokePairingSessionEndpoint: (
    endpoint: AgentEndpoint,
    invocation: InvocationRequest,
  ) => Promise<PairingInvocationResult>;
  invokeA2AHttpEndpoint?: (
    endpoint: AgentEndpoint,
    invocation: InvocationRequest,
  ) => Promise<A2AHttpInvocationResult>;
  invokeLocalAgentEndpoint: (
    endpoint: AgentEndpoint,
    invocation: InvocationRequest,
  ) => Promise<LocalAgentInvocationResult>;
  error?: (message: string, detail?: unknown) => void;
  warn?: (message: string) => void;
  now?: () => number;
};

export class BrokerLocalInvocationService {
  readonly #activeRouteTasks = new Map<string, Promise<void>>();

  constructor(private readonly options: BrokerLocalInvocationServiceOptions) {}

  hasActiveInvocation(invocationId: string): boolean {
    return this.options.activeInvocationTasks.has(invocationId);
  }

  launch(invocation: InvocationRequest, initialFlight: FlightRecord): void {
    if (this.options.activeInvocationTasks.has(invocation.id)) {
      return;
    }

    const routeKey = localInvocationRouteKey(invocation);
    const previousRouteTask = this.#activeRouteTasks.get(routeKey);
    const task = (previousRouteTask ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this.execute(invocation, initialFlight))
      .catch((error) => {
        this.options.error?.(`[openscout-runtime] local invocation ${invocation.id} crashed:`, error);
      })
      .finally(() => {
        this.options.activeInvocationTasks.delete(invocation.id);
        if (this.#activeRouteTasks.get(routeKey) === task) {
          this.#activeRouteTasks.delete(routeKey);
        }
      });
    this.options.activeInvocationTasks.set(invocation.id, task);
    this.#activeRouteTasks.set(routeKey, task);
  }

  async execute(invocation: InvocationRequest, initialFlight: FlightRecord): Promise<void> {
    const agent = this.options.runtime.agent(invocation.targetAgentId);
    let endpoint: AgentEndpoint | undefined;
    const previousEndpoint = this.options.endpointResolver.activeLocalEndpointForAgent(
      invocation.targetAgentId,
      invocation.execution?.harness,
      invocationTargetSessionId(invocation),
    );

    try {
      endpoint = await this.options.endpointResolver.resolveLocalEndpointForInvocation(invocation);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedFlight = {
        ...initialFlight,
        state: "failed" as const,
        summary: `${agent?.displayName ?? invocation.targetAgentId} could not be prepared.`,
        error: `Endpoint resolution failed before execution: ${message}`,
        completedAt: this.now(),
        metadata: {
          ...(initialFlight.metadata ?? {}),
          failureStage: "endpoint_resolution",
        },
      };
      await this.options.persistFlight(failedFlight);
      await this.options.postInvocationStatusMessage(invocation, failedFlight);
      return;
    }

    if (!agent || !endpoint) {
      const targetSessionId = invocationTargetSessionId(invocation);
      const staleEndpointReason = targetSessionId
        ? staleLocalEndpointReason(latestEndpointForAgent(this.options.runtime.snapshot(), invocation.targetAgentId))
        : null;
      if (staleEndpointReason) {
        const failedFlight = {
          ...initialFlight,
          state: "failed" as const,
          summary: `${agent?.displayName ?? invocation.targetAgentId} could not be prepared.`,
          error: `Endpoint resolution failed before execution: ${staleEndpointReason}`,
          completedAt: this.now(),
          metadata: {
            ...(initialFlight.metadata ?? {}),
            failureStage: "endpoint_resolution",
            staleLocalRegistration: true,
          },
        };
        await this.options.persistFlight(failedFlight);
        await this.options.postInvocationStatusMessage(invocation, failedFlight);
        return;
      }

      const queuedFlight = {
        ...initialFlight,
        state: "queued" as const,
        summary: `Message stored for ${agent?.displayName ?? invocation.targetAgentId}. Will deliver when online.`,
        metadata: {
          ...(initialFlight.metadata ?? {}),
          dispatchOutcome: {
            status: "queued_until_online",
            reason: "no_runnable_endpoint",
            checkedAt: this.now(),
          },
        },
      };
      await this.options.persistFlight(queuedFlight);
      return;
    }

    if (
      endpoint.transport !== "pairing_bridge"
      && !isA2AHttpEndpoint(endpoint)
      && !isBrokerRunnableLocalAgentTransport(endpoint.transport)
    ) {
      const failedFlight = {
        ...initialFlight,
        state: "failed" as const,
        summary: `${agent.displayName} has no supported local executor.`,
        error: `Endpoint transport ${endpoint.transport} is registered for ${agent.id}, but the broker only routes through direct local agent adapters or A2A HTTP endpoints.`,
        completedAt: this.now(),
      };
      await this.options.persistFlight(failedFlight);
      await this.options.postInvocationStatusMessage(invocation, failedFlight);
      return;
    }

    const runningEndpoint: AgentEndpoint = {
      ...endpoint,
      state: "active",
      metadata: {
        ...(endpoint.metadata ?? {}),
        lastInvocationId: invocation.id,
        lastStartedAt: this.now(),
      },
    };
    await this.options.persistEndpoint(runningEndpoint);

    const dispatchAck = {
      strategy: dispatchAckStrategyForEndpoint({
        invocation,
        endpoint: runningEndpoint,
        previousEndpoint,
        now: this.now(),
      }),
      endpointId: runningEndpoint.id,
      transport: runningEndpoint.transport,
      harness: runningEndpoint.harness,
      sessionId: runningEndpoint.sessionId ?? null,
      nodeId: runningEndpoint.nodeId,
      acknowledgedAt: this.now(),
    };
    const runningFlight = {
      ...initialFlight,
      state: "running" as const,
      summary: `${agent.displayName} acknowledged via ${dispatchAck.strategy}.`,
      error: undefined,
      completedAt: undefined,
      metadata: {
        ...(initialFlight.metadata ?? {}),
        dispatchAck,
      },
    };
    await this.options.persistFlight(runningFlight);

    try {
      const result = await this.invokeEndpoint(runningEndpoint, invocation);
      const completedEndpoint = this.completedEndpoint(runningEndpoint, result);

      if (invocation.action === "wake") {
        const completedFlight = {
          ...runningFlight,
          state: "completed" as const,
          summary: `${agent.displayName} received the message.`,
          output: result.output,
          completedAt: this.now(),
        };
        await this.options.persistFlight(completedFlight);

        await this.options.persistEndpoint({
          ...completedEndpoint,
          state: "idle",
        });
        return;
      }

      const currentFlight = this.options.runtime.flightForInvocation(invocation.id);
      if (currentFlight && isTerminalFlightState(currentFlight.state)) {
        await this.options.persistEndpoint({
          ...completedEndpoint,
          state: "idle",
        });
        return;
      }

      const postedReply = this.options.existingBrokerReplyForInvocation(
        invocation,
        agent.id,
        runningFlight.startedAt ?? this.now(),
      );
      const output = postedReply?.body || result.output;
      if (!output.trim()) {
        const failedFlight = {
          ...runningFlight,
          state: "failed" as const,
          summary: `${agent.displayName} returned an empty reply.`,
          error: `Local agent ${agent.id} completed without broker-visible output.`,
          completedAt: this.now(),
          metadata: {
            ...(runningFlight.metadata ?? {}),
            failureStage: "empty_reply",
          },
        };
        await this.options.persistFlight(failedFlight);

        await this.options.persistEndpoint({
          ...runningEndpoint,
          state: "idle",
          metadata: {
            ...(runningEndpoint.metadata ?? {}),
            lastFailedAt: this.now(),
            lastError: failedFlight.error,
          },
        });

        await this.options.postInvocationStatusMessage(invocation, failedFlight);
        return;
      }

      const completedFlight = {
        ...runningFlight,
        state: "completed" as const,
        summary: `${agent.displayName} replied.`,
        output,
        completedAt: this.now(),
      };
      await this.options.persistFlight(completedFlight);

      await this.options.persistEndpoint({
        ...completedEndpoint,
        state: "idle",
      });

      if (invocation.conversationId && !postedReply) {
        const conversation = this.options.runtime.conversation(invocation.conversationId);
        if (conversation) {
          await this.options.postConversationMessage({
            id: this.options.createId("msg"),
            conversationId: invocation.conversationId,
            actorId: agent.id,
            originNodeId: this.options.nodeId,
            class: "agent",
            body: output,
            replyToMessageId: invocation.messageId,
            audience: {
              notify: [invocation.requesterId],
            },
            visibility: this.options.messageVisibilityForConversation(conversation),
            policy: "durable",
            createdAt: this.now(),
            metadata: {
              invocationId: invocation.id,
              flightId: completedFlight.id,
              source: "broker",
              ...this.options.scoutbotReplyProvenanceMetadata(invocation),
              returnAddress: buildScoutReturnAddress({
                actorId: agent.id,
                handle: agent.handle?.trim() || agent.definitionId,
                displayName: agent.displayName,
                selector: agent.selector,
                defaultSelector: agent.defaultSelector,
                conversationId: invocation.conversationId,
                replyToMessageId: invocation.messageId,
                nodeId: completedEndpoint.nodeId,
                projectRoot: completedEndpoint.projectRoot ?? completedEndpoint.cwd,
                sessionId: completedEndpoint.sessionId,
              }),
              requestedReturnAddress: invocation.metadata?.["returnAddress"],
              responderHarness: completedEndpoint.harness,
              responderTransport: completedEndpoint.transport,
              responderSessionId: completedEndpoint.sessionId ?? "",
              responderCwd: completedEndpoint.cwd ?? "",
              responderProjectRoot: completedEndpoint.projectRoot ?? "",
              responderAgentName: String(completedEndpoint.metadata?.agentName ?? agent.id),
              responderStartedAt: String(completedEndpoint.metadata?.startedAt ?? ""),
              responderNodeId: completedEndpoint.nodeId,
            },
          });
        }
      }
    } catch (error) {
      await this.handleExecutionError({ error, invocation, agent, runningEndpoint, runningFlight });
    }
  }

  private async invokeEndpoint(
    endpoint: AgentEndpoint,
    invocation: InvocationRequest,
  ): Promise<InvocationExecutorResult> {
    if (endpoint.transport === "pairing_bridge") {
      return this.options.invokePairingSessionEndpoint(endpoint, invocation);
    }
    if (isA2AHttpEndpoint(endpoint)) {
      return (this.options.invokeA2AHttpEndpoint ?? invokeA2AHttpEndpoint)(endpoint, invocation);
    }
    return this.options.invokeLocalAgentEndpoint(endpoint, invocation);
  }

  private completedEndpoint(
    runningEndpoint: AgentEndpoint,
    result: InvocationExecutorResult,
  ): AgentEndpoint {
    const rawResultExternalSessionId = "externalSessionId" in result ? result.externalSessionId : undefined;
    const resultExternalSessionId = typeof rawResultExternalSessionId === "string" && rawResultExternalSessionId.trim()
      ? rawResultExternalSessionId.trim()
      : undefined;
    const resultMetadata = "metadata" in result && result.metadata && typeof result.metadata === "object" && !Array.isArray(result.metadata)
      ? result.metadata as Record<string, unknown>
      : {};

    return {
      ...runningEndpoint,
      metadata: {
        ...(runningEndpoint.metadata ?? {}),
        ...resultMetadata,
        lastCompletedAt: this.now(),
        ...(resultExternalSessionId ? {
          externalSessionId: resultExternalSessionId,
          ...(runningEndpoint.transport === "codex_app_server" ? { threadId: resultExternalSessionId } : {}),
        } : {}),
      },
    };
  }

  private async handleExecutionError(input: {
    error: unknown;
    invocation: InvocationRequest;
    agent: AgentDefinition;
    runningEndpoint: AgentEndpoint;
    runningFlight: FlightRecord;
  }): Promise<void> {
    const { error, invocation, agent, runningEndpoint, runningFlight } = input;
    const message = error instanceof Error ? error.message : String(error);
    if (isRequesterWaitTimeoutError(error)) {
      const currentFlight = this.options.runtime.flightForInvocation(invocation.id);
      if (currentFlight && isTerminalFlightState(currentFlight.state)) {
        return;
      }
      const postedReply = this.options.existingBrokerReplyForInvocation(
        invocation,
        agent.id,
        runningFlight.startedAt ?? this.now(),
      );
      if (postedReply && await this.options.completeInvocationForBrokerReply(invocation, postedReply)) {
        return;
      }

      const waitingFlight = {
        ...runningFlight,
        state: "waiting" as const,
        summary: `${agent.displayName} is still working; Scout stopped waiting for a synchronous result after ${error.timeoutMs}ms.`,
        error: undefined,
        completedAt: undefined,
        metadata: {
          ...(runningFlight.metadata ?? {}),
          requesterTimedOut: true,
          timeoutMs: error.timeoutMs,
          timeoutScope: "requester_wait",
        },
      };
      await this.options.persistFlight(waitingFlight);
      this.options.warn?.(`[openscout-runtime] ${waitingFlight.summary}`);
      return;
    }

    if (isDispatchStalledError(error)) {
      const stalledFlight = {
        ...runningFlight,
        state: "failed" as const,
        summary: `${agent.displayName} dispatch stalled — prompt left in composer after submit + retry.`,
        error: message,
        completedAt: this.now(),
        metadata: {
          ...(runningFlight.metadata ?? {}),
          failureStage: "dispatch_stalled",
          dispatchStalledSession: error.sessionName,
          dispatchStalledRetries: error.retries,
          dispatchStalledPaneTail: error.paneTail.slice(0, 1_000),
        },
      };
      await this.options.persistFlight(stalledFlight);

      await this.options.persistEndpoint({
        ...runningEndpoint,
        state: "offline",
        metadata: {
          ...(runningEndpoint.metadata ?? {}),
          lastError: message,
          lastFailedAt: this.now(),
          lastFailureStage: "dispatch_stalled",
        },
      });

      await this.options.postInvocationStatusMessage(invocation, stalledFlight);
      return;
    }

    if (isCodexAppServerExitError(error) && error.noteworthy) {
      const interruptedAt = this.now();
      const failureStage = error.exitKind === "proactive_shutdown"
        ? "codex_app_server_proactive_shutdown"
        : "codex_app_server_sigterm";
      const summary = error.exitKind === "proactive_shutdown"
        ? `${agent.displayName} was stopped by OpenScout before it could reply.`
        : `${agent.displayName} was interrupted by a local Codex app-server SIGTERM.`;
      const interruptedFlight = {
        ...runningFlight,
        state: "failed" as const,
        summary,
        error: undefined,
        completedAt: interruptedAt,
        metadata: {
          ...(runningFlight.metadata ?? {}),
          failureStage,
          failureSeverity: "noteworthy",
          noteworthy: true,
          exitKind: error.exitKind,
          exitSignal: error.signal,
          exitCode: error.exitCode,
          ...(error.reason ? { shutdownReason: error.reason } : {}),
        },
      };
      await this.options.persistFlight(interruptedFlight);

      await this.options.persistEndpoint({
        ...runningEndpoint,
        state: "offline",
        metadata: {
          ...(runningEndpoint.metadata ?? {}),
          lastNotice: message,
          lastInterruptedAt: interruptedAt,
          lastInterruptionStage: failureStage,
        },
      });

      await this.options.postInvocationStatusMessage(invocation, interruptedFlight);
      return;
    }

    const failedFlight = {
      ...runningFlight,
      state: "failed" as const,
      summary: `${agent.displayName} failed to respond.`,
      error: message,
      completedAt: this.now(),
    };
    await this.options.persistFlight(failedFlight);

    await this.options.persistEndpoint({
      ...runningEndpoint,
      state: "offline",
      metadata: {
        ...(runningEndpoint.metadata ?? {}),
        lastError: message,
        lastFailedAt: this.now(),
      },
    });

    await this.options.postInvocationStatusMessage(invocation, failedFlight);
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }
}

function localInvocationRouteKey(invocation: InvocationRequest): string {
  return [
    invocation.targetAgentId,
    invocation.execution?.harness ?? "*",
    invocationTargetSessionId(invocation) ?? "*",
  ].join("\u0000");
}
