// Pure Echo normalizer for SCO-042 conformance self-tests.
// No process, filesystem, network, or environment access.

import type {
  Action,
  AgentSessionStreamEvent,
  Block,
  Session,
  Turn,
} from "../../protocol/primitives.js";
import type {
  AdapterReplayRecord,
  HarnessEventNormalizer,
  HarnessEventNormalizerContext,
} from "../../protocol/normalizer.js";
import { snapshotNormalizedValue } from "../../protocol/normalizer.js";

export type EchoNormalizerOptions = {
  sessionName?: string;
  requireApproval?: boolean;
};

type EchoHarnessPayload =
  | { type: "prompt"; text: string; requireApproval?: boolean }
  | { type: "approval_decision"; decision: "approve" | "deny"; blockId?: string }
  | { type: "interrupt" }
  | { type: "unknown"; [key: string]: unknown };

/**
 * Deterministic Echo normalizer. Records drive the turn lifecycle without timers.
 * Live EchoAdapter still owns delays and async approval waits; it feeds the same
 * record shapes into this normalizer.
 */
export class EchoEventNormalizer implements HarnessEventNormalizer {
  private readonly context: HarnessEventNormalizerContext;
  private readonly session: Session;
  private turnOpenFlag = false;
  private currentTurnId: string | null = null;
  private pendingApprovalBlockId: string | null = null;
  private interrupted = false;
  private requireApproval: boolean;

  constructor(context: HarnessEventNormalizerContext, options: EchoNormalizerOptions = {}) {
    this.context = context;
    this.requireApproval = options.requireApproval === true;
    this.session = {
      id: context.sessionId,
      name: options.sessionName ?? "echo",
      adapterType: "echo",
      status: "active",
    };
  }

  get turnOpen(): boolean {
    return this.turnOpenFlag;
  }

  ingest(record: AdapterReplayRecord): readonly AgentSessionStreamEvent[] {
    if (record.source === "adapter_control") {
      return this.ingestControl(record);
    }
    return this.ingestHarness(record.payload);
  }

  finishReplay(): readonly AgentSessionStreamEvent[] {
    // Do not invent a successful turn:end on EOF.
    return [];
  }

  private ingestControl(
    record: Extract<AdapterReplayRecord, { source: "adapter_control" }>,
  ): readonly AgentSessionStreamEvent[] {
    switch (record.event) {
      case "interrupt":
        this.interrupted = true;
        if (this.turnOpenFlag && this.currentTurnId) {
          return this.endTurn(this.currentTurnId, "stopped");
        }
        return [];
      case "prompt_accepted": {
        const text = typeof record.payload === "object" && record.payload !== null
          && typeof (record.payload as { text?: unknown }).text === "string"
          ? (record.payload as { text: string }).text
          : "";
        return this.runCompletedTurn(text);
      }
      default:
        return [];
    }
  }

  private ingestHarness(payload: unknown): readonly AgentSessionStreamEvent[] {
    const record = (payload ?? {}) as EchoHarnessPayload;
    if (!record || typeof record !== "object") {
      return [];
    }

    switch (record.type) {
      case "prompt":
        if (typeof record.requireApproval === "boolean") {
          this.requireApproval = record.requireApproval;
        }
        return this.runCompletedTurn(typeof record.text === "string" ? record.text : "");
      case "approval_decision":
        return this.handleApproval(record.decision, record.blockId);
      case "interrupt":
        this.interrupted = true;
        if (this.turnOpenFlag && this.currentTurnId) {
          return this.endTurn(this.currentTurnId, "stopped");
        }
        return [];
      default:
        // Unknown source records do not terminate replay (SCO-042-C007).
        return [];
    }
  }

  private runCompletedTurn(text: string): readonly AgentSessionStreamEvent[] {
    this.interrupted = false;
    const events: AgentSessionStreamEvent[] = [];
    const turnId = this.context.nextId("turn");
    const sessionId = this.context.sessionId;
    let blockIndex = 0;

    const turn: Turn = {
      id: turnId,
      sessionId,
      status: "started",
      startedAt: this.context.now(),
      blocks: [],
    };
    this.currentTurnId = turnId;
    this.turnOpenFlag = true;
    events.push({ event: "turn:start", sessionId, turn });

    if (this.interrupted) {
      events.push(...this.endTurn(turnId, "stopped"));
      return events;
    }

    // Reasoning
    const reasoningId = this.context.nextId("block");
    const reasoningText = `Thinking about: ${text}`;
    events.push(this.blockStart(sessionId, turnId, {
      id: reasoningId,
      turnId,
      type: "reasoning",
      text: "",
      status: "streaming",
      index: blockIndex++,
    }));
    events.push({
      event: "block:delta",
      sessionId,
      turnId,
      blockId: reasoningId,
      text: reasoningText,
    });
    events.push(this.blockEnd(sessionId, turnId, reasoningId, "completed"));

    // Text
    const textId = this.context.nextId("block");
    const echoText = `Echo: ${text}`;
    events.push(this.blockStart(sessionId, turnId, {
      id: textId,
      turnId,
      type: "text",
      text: "",
      status: "streaming",
      index: blockIndex++,
    }));
    events.push({
      event: "block:delta",
      sessionId,
      turnId,
      blockId: textId,
      text: echoText,
    });
    events.push(this.blockEnd(sessionId, turnId, textId, "completed"));

    // Action
    const actionId = this.context.nextId("block");
    const toolCallId = this.context.nextId("event");
    const initialStatus = this.requireApproval ? "awaiting_approval" as const : "running" as const;
    const action: Action = {
      kind: "tool_call",
      toolName: "echo",
      toolCallId,
      status: initialStatus,
      output: "",
      ...(this.requireApproval
        ? {
            approval: {
              version: 1,
              description: `Run echo tool with: ${text}`,
              risk: "low" as const,
            },
          }
        : {}),
    };

    events.push(this.blockStart(sessionId, turnId, {
      id: actionId,
      turnId,
      type: "action",
      status: "streaming",
      index: blockIndex++,
      action,
    }));

    if (this.requireApproval) {
      events.push({
        event: "block:action:approval",
        sessionId,
        turnId,
        blockId: actionId,
        approval: {
          version: 1,
          description: `Run echo tool with: ${text}`,
          risk: "low",
        },
      });
      this.pendingApprovalBlockId = actionId;
      // Leave turn open for a later approval_decision record.
      return events;
    }

    events.push({
      event: "block:action:output",
      sessionId,
      turnId,
      blockId: actionId,
      output: text,
    });
    events.push({
      event: "block:action:status",
      sessionId,
      turnId,
      blockId: actionId,
      status: "completed",
    });
    events.push(this.blockEnd(sessionId, turnId, actionId, "completed"));
    events.push(...this.endTurn(turnId, "completed"));
    return events;
  }

  private handleApproval(
    decision: "approve" | "deny",
    blockId?: string,
  ): readonly AgentSessionStreamEvent[] {
    const turnId = this.currentTurnId;
    const actionId = blockId ?? this.pendingApprovalBlockId;
    if (!turnId || !actionId || !this.turnOpenFlag) {
      return [];
    }

    const sessionId = this.context.sessionId;
    const events: AgentSessionStreamEvent[] = [];

    if (decision === "deny") {
      events.push({
        event: "block:action:status",
        sessionId,
        turnId,
        blockId: actionId,
        status: "failed",
      });
      events.push(this.blockEnd(sessionId, turnId, actionId, "failed"));
      events.push(...this.endTurn(turnId, "completed"));
      this.pendingApprovalBlockId = null;
      return events;
    }

    events.push({
      event: "block:action:status",
      sessionId,
      turnId,
      blockId: actionId,
      status: "running",
    });
    events.push({
      event: "block:action:output",
      sessionId,
      turnId,
      blockId: actionId,
      output: "",
    });
    events.push({
      event: "block:action:status",
      sessionId,
      turnId,
      blockId: actionId,
      status: "completed",
    });
    events.push(this.blockEnd(sessionId, turnId, actionId, "completed"));
    events.push(...this.endTurn(turnId, "completed"));
    this.pendingApprovalBlockId = null;
    return events;
  }

  private endTurn(
    turnId: string,
    status: "completed" | "stopped" | "failed",
  ): AgentSessionStreamEvent[] {
    this.turnOpenFlag = false;
    this.currentTurnId = null;
    this.pendingApprovalBlockId = null;
    return [{
      event: "turn:end",
      sessionId: this.context.sessionId,
      turnId,
      status,
    }];
  }

  private blockStart(
    sessionId: string,
    turnId: string,
    block: Block,
  ): AgentSessionStreamEvent {
    return {
      event: "block:start",
      sessionId,
      turnId,
      block: snapshotNormalizedValue(block),
    };
  }

  private blockEnd(
    sessionId: string,
    turnId: string,
    blockId: string,
    status: "completed" | "failed",
  ): AgentSessionStreamEvent {
    return { event: "block:end", sessionId, turnId, blockId, status };
  }
}

export function createEchoEventNormalizer(
  context: HarnessEventNormalizerContext,
  options?: EchoNormalizerOptions,
): EchoEventNormalizer {
  return new EchoEventNormalizer(context, options);
}
