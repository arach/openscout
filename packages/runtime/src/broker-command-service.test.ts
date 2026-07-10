import { describe, expect, test } from "bun:test";

import {
  type ActorIdentity,
  type CollaborationEvent,
  type CollaborationRecord,
  type ContextBlock,
  type ContextPack,
  type DeliveryIntent,
  type InvocationRequest,
  type MessageRecord,
} from "@openscout/protocol";

import type { BrokerJournalEntry } from "./broker-journal.js";
import { BrokerCommandService, type BrokerCommandMesh } from "./broker-command-service.js";

function actor(input: Partial<ActorIdentity> = {}): ActorIdentity {
  return {
    id: "operator",
    kind: "person",
    displayName: "Operator",
    handle: "operator",
    labels: [],
    metadata: {},
    ...input,
  };
}

function workItem(input: Partial<CollaborationRecord> = {}): CollaborationRecord {
  return {
    id: "work-1",
    kind: "work_item",
    state: "working",
    acceptanceState: "none",
    title: "Investigate dispatch",
    createdById: "operator",
    ownerId: "agent-1",
    nextMoveOwnerId: "agent-1",
    requestedById: "operator",
    createdAt: 100,
    updatedAt: 100,
    ...input,
  } as CollaborationRecord;
}

function collaborationEvent(input: Partial<CollaborationEvent> = {}): CollaborationEvent {
  return {
    id: "event-1",
    recordId: "work-1",
    recordKind: "work_item",
    kind: "progressed",
    actorId: "agent-1",
    at: 120,
    ...input,
  };
}

function message(input: Partial<MessageRecord> = {}): MessageRecord {
  return {
    id: "msg-1",
    conversationId: "conversation-1",
    actorId: "operator",
    originNodeId: "node-local",
    class: "agent",
    body: "hello",
    visibility: "workspace",
    policy: "durable",
    createdAt: 100,
    ...input,
  };
}

function delivery(input: Partial<DeliveryIntent> = {}): DeliveryIntent {
  return {
    id: "delivery-1",
    messageId: "msg-1",
    targetId: "agent-1",
    targetNodeId: "node-local",
    targetKind: "agent",
    transport: "local_socket",
    reason: "direct_message",
    policy: "durable",
    status: "pending",
    ...input,
  };
}

function invocation(input: Partial<InvocationRequest> = {}): InvocationRequest {
  return {
    id: "invocation-1",
    requesterId: "operator",
    requesterNodeId: "node-local",
    targetAgentId: "agent-1",
    action: "consult",
    task: "work",
    ensureAwake: true,
    stream: false,
    createdAt: 100,
    ...input,
  };
}

function contextBlock(): ContextBlock {
  return {
    schemaVersion: "openscout.context-block.v1",
    id: "memory-1",
    kind: "memory",
    memoryKind: "decision",
    title: "Keep provenance",
    body: "Keep observed session material as cited evidence.",
    scope: { kind: "workspace", id: "/repo" },
    projectionMode: "inline",
    mutability: "broker_writable",
    state: "active",
    createdById: "operator",
    sourceRefs: [{ kind: "operator", ref: "operator:decision" }],
    version: 1,
    contentHash: "memory-hash",
    createdAt: 100,
    updatedAt: 100,
  };
}

function contextPack(): ContextPack {
  return {
    schemaVersion: "openscout.context-pack.v1",
    id: "pack-1",
    title: "Continue work",
    purpose: "Continue work",
    target: { projectPath: "/repo", sessionPolicy: "fork" },
    sections: [{
      id: "task",
      kind: "task_frame",
      title: "Task",
      body: "Continue work",
      estimatedTokens: 3,
    }],
    contextBlockIds: ["memory-1"],
    sourceRefs: [{ kind: "context_block", ref: "memory-1" }],
    budget: { maxTokens: 100, estimatedTokens: 3, truncated: false },
    limitations: [],
    contentHash: "pack-hash",
    createdById: "operator",
    createdAt: 110,
  };
}

function createHarness(input: {
  authorityConversationIds?: Set<string>;
  collaborationRecords?: Record<string, CollaborationRecord>;
  mesh?: Partial<BrokerCommandMesh>;
} = {}) {
  const collaborationRecords = input.collaborationRecords ?? {};
  const upsertedActors: ActorIdentity[] = [];
  const recordedCollaborations: Array<{
    record: CollaborationRecord;
    options?: { enqueueProjection?: boolean };
  }> = [];
  const appendedEvents: Array<{
    event: CollaborationEvent;
    options?: { enqueueProjection?: boolean };
  }> = [];
  const recordedMessages: Array<{
    message: MessageRecord;
    options?: { enqueueProjection?: boolean };
  }> = [];
  const recordedContextBlocks: ContextBlock[] = [];
  const recordedContextPacks: ContextPack[] = [];
  const appliedEntries: BrokerJournalEntry[][] = [];
  const peerMessageForwards: Array<{ message: MessageRecord; deliveries: DeliveryIntent[] }> = [];
  const acceptedInvocations: Array<{ invocation: InvocationRequest; options: { includeOk: true; logAccepted: true } }> = [];
  const runtimeCommands: string[] = [];
  const logs: string[] = [];
  let reconcileCount = 0;

  const mesh: BrokerCommandMesh = {
    authorityNodeForConversation: (conversationId) =>
      input.authorityConversationIds?.has(conversationId) ? { id: "node-peer" } : null,
    async forwardCollaborationRecordToAuthority() {
      return { forwarded: true, authorityNodeId: "node-peer" };
    },
    async forwardPeerBrokerCollaborationRecord() {
      return { forwarded: ["node-peer"], failed: [] };
    },
    async forwardCollaborationEventToAuthority() {
      return { forwarded: true, authorityNodeId: "node-peer" };
    },
    async forwardPeerBrokerCollaborationEvent() {
      return { forwarded: ["node-peer"], failed: [] };
    },
    async forwardConversationMessageToAuthority() {
      return { forwarded: true, authorityNodeId: "node-peer" };
    },
    async forwardPeerBrokerDeliveries(nextMessage, deliveries) {
      peerMessageForwards.push({ message: nextMessage, deliveries });
      return { forwarded: ["node-peer"], failed: [] };
    },
    ...input.mesh,
  };

  const service = new BrokerCommandService({
    runtime: {
      collaborationRecord: (recordId) => collaborationRecords[recordId],
      async dispatch(command) {
        runtimeCommands.push(command.kind);
      },
    },
    mesh,
    upsertNode: async () => {},
    async upsertActor(nextActor) {
      upsertedActors.push(nextActor);
    },
    upsertAgent: async () => {},
    persistEndpoint: async () => {},
    upsertConversation: async () => {},
    upsertBinding: async () => {},
    async recordCollaboration(record, options) {
      recordedCollaborations.push({ record, options });
      return [{ kind: "collaboration.record", record }];
    },
    async appendCollaborationEvent(event, options) {
      appendedEvents.push({ event, options });
      return [{ kind: "collaboration.event.record", event }];
    },
    async recordContextBlock(block) {
      recordedContextBlocks.push(block);
      return [{ kind: "context.block.record", block }];
    },
    contextBlock: (blockId) => recordedContextBlocks.find((block) => block.id === blockId) ?? null,
    async recordContextPack(pack) {
      recordedContextPacks.push(pack);
      return [{ kind: "context.pack.record", pack }];
    },
    contextPack: (packId) => recordedContextPacks.find((pack) => pack.id === packId) ?? null,
    async recordMessage(nextMessage, options) {
      recordedMessages.push({ message: nextMessage, options });
      return {
        deliveries: [delivery({ messageId: nextMessage.id })],
        entries: [{ kind: "message.record", message: nextMessage }],
      };
    },
    async applyProjectedEntries(entries) {
      appliedEntries.push(entries);
    },
    async reconcileStaleLocalDeliveries() {
      reconcileCount += 1;
    },
    async acceptAndDispatchInvocation(nextInvocation, options) {
      acceptedInvocations.push({ invocation: nextInvocation, options });
      return {
        ok: true,
        accepted: true,
        invocationId: nextInvocation.id,
      };
    },
    log: (line) => logs.push(line),
  });

  return {
    acceptedInvocations,
    appendedEvents,
    appliedEntries,
    logs,
    peerMessageForwards,
    reconcileCount: () => reconcileCount,
    recordedCollaborations,
    recordedContextBlocks,
    recordedContextPacks,
    recordedMessages,
    runtimeCommands,
    service,
    upsertedActors,
  };
}

describe("BrokerCommandService", () => {
  test("delegates simple upsert commands", async () => {
    const harness = createHarness();
    const nextActor = actor();

    await expect(harness.service.execute({
      kind: "actor.upsert",
      actor: nextActor,
    })).resolves.toEqual({ ok: true });

    expect(harness.upsertedActors).toEqual([nextActor]);
  });

  test("records constructive context through the durable projection path", async () => {
    const harness = createHarness();
    const block = contextBlock();
    const pack = contextPack();

    await expect(harness.service.execute({
      kind: "context.block.upsert",
      block,
    })).resolves.toEqual({ ok: true, contextBlockId: block.id });
    await expect(harness.service.execute({
      kind: "context.pack.record",
      pack,
    })).resolves.toEqual({ ok: true, contextPackId: pack.id });

    expect(harness.recordedContextBlocks).toEqual([block]);
    expect(harness.recordedContextPacks).toEqual([pack]);
    expect(harness.appliedEntries.map((entries) => entries[0]?.kind)).toEqual([
      "context.block.record",
      "context.pack.record",
    ]);
  });

  test("enforces monotonic memory updates and immutable context packs", async () => {
    const harness = createHarness();
    const block = contextBlock();
    const pack = contextPack();

    await harness.service.execute({ kind: "context.block.upsert", block });
    await harness.service.execute({ kind: "context.pack.record", pack });
    await harness.service.execute({ kind: "context.block.upsert", block });
    await harness.service.execute({ kind: "context.pack.record", pack });
    expect(harness.recordedContextBlocks).toHaveLength(1);
    expect(harness.recordedContextPacks).toHaveLength(1);

    await expect(harness.service.execute({
      kind: "context.block.upsert",
      block: { ...block, state: "archived" },
    })).rejects.toThrow("must advance version 1 to 2");

    await expect(harness.service.execute({
      kind: "context.block.upsert",
      block: { ...block, state: "archived", version: 2, updatedAt: 120 },
    })).resolves.toEqual({ ok: true, contextBlockId: block.id });

    await expect(harness.service.execute({
      kind: "context.pack.record",
      pack: { ...pack, contentHash: "different" },
    })).rejects.toThrow("is immutable");
  });

  test("records local collaboration records and forwards unscoped records to peers", async () => {
    const harness = createHarness();
    const record = workItem({ conversationId: undefined });

    await expect(harness.service.execute({
      kind: "collaboration.upsert",
      record,
    })).resolves.toEqual({
      ok: true,
      recordId: record.id,
      mesh: { forwarded: ["node-peer"], failed: [] },
    });

    expect(harness.recordedCollaborations).toEqual([
      { record, options: { enqueueProjection: false } },
    ]);
    expect(harness.appliedEntries).toEqual([
      [expect.objectContaining({ kind: "collaboration.record" })],
    ]);
  });

  test("forwards authority-owned collaboration records without local writes", async () => {
    const harness = createHarness({
      authorityConversationIds: new Set(["conversation-remote"]),
    });
    const record = workItem({ conversationId: "conversation-remote" });

    await expect(harness.service.execute({
      kind: "collaboration.upsert",
      record,
    })).resolves.toEqual({
      ok: true,
      recordId: record.id,
      mesh: { forwarded: true, authorityNodeId: "node-peer" },
    });

    expect(harness.recordedCollaborations).toEqual([]);
    expect(harness.appliedEntries).toEqual([]);
  });

  test("appends collaboration events using their record authority", async () => {
    const record = workItem({ conversationId: "conversation-local" });
    const event = collaborationEvent({ recordId: record.id });
    const harness = createHarness({
      collaborationRecords: { [record.id]: record },
    });

    await expect(harness.service.execute({
      kind: "collaboration.event.append",
      event,
    })).resolves.toEqual({
      ok: true,
      eventId: event.id,
      mesh: { forwarded: [], failed: [] },
    });

    expect(harness.appendedEvents).toEqual([
      { event, options: { enqueueProjection: false } },
    ]);
  });

  test("records local conversation posts, fans deliveries, projects entries, and reconciles", async () => {
    const harness = createHarness();
    const nextMessage = message();

    await expect(harness.service.execute({
      kind: "conversation.post",
      message: nextMessage,
    })).resolves.toEqual({
      ok: true,
      message: nextMessage,
      deliveries: [expect.objectContaining({ id: "delivery-1", messageId: "msg-1" })],
      mesh: { forwarded: ["node-peer"], failed: [] },
    });

    expect(harness.recordedMessages).toEqual([
      { message: nextMessage, options: { enqueueProjection: false } },
    ]);
    expect(harness.peerMessageForwards).toEqual([
      {
        message: nextMessage,
        deliveries: [expect.objectContaining({ id: "delivery-1" })],
      },
    ]);
    expect(harness.reconcileCount()).toBe(1);
    expect(harness.logs).toEqual([
      "[openscout-runtime] message msg-1 posted by operator to conversation-1 with 1 deliveries",
    ]);
  });

  test("delegates agent invocation commands with command response options", async () => {
    const harness = createHarness();
    const nextInvocation = invocation();

    await expect(harness.service.execute({
      kind: "agent.invoke",
      invocation: nextInvocation,
    })).resolves.toEqual({
      ok: true,
      accepted: true,
      invocationId: nextInvocation.id,
    });

    expect(harness.acceptedInvocations).toEqual([
      {
        invocation: nextInvocation,
        options: { includeOk: true, logAccepted: true },
      },
    ]);
  });
});
