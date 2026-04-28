import { describe, expect } from "bun:test";

import type { DeliveryIntent, MessageRecord } from "@openscout/protocol";
import {
  RuntimeScenarioHarness,
  runtimeScenario,
} from "./test-helpers/runtime-scenario-harness.test";

function deliverySummary(delivery: DeliveryIntent) {
  return {
    messageId: delivery.messageId ?? null,
    targetId: delivery.targetId,
    transport: delivery.transport,
    reason: delivery.reason,
  };
}

function sortSummaries(values: Array<Record<string, string | null>>) {
  return [...values].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

describe("runtime scenario suite", () => {
  runtimeScenario(
    "wakes a docs reviewer from a collaboration record and hands findings to an editor",
    async (scenario) => {
      const broker = await scenario.startBroker();
      await scenario.seedOperator(broker);

      await scenario.registerAgent(broker, {
        id: "docs.review.claude",
        definitionId: "docs-review",
        displayName: "Docs Review",
        handle: "docs-review",
        selector: "@docs-review",
        harness: "claude",
        transport: "claude_stream_json",
        endpointId: "endpoint.docs.review",
        sessionId: "docs-review-session",
        branch: "release/docs-pass",
        projectRoot: "/tmp/product-docs",
        cwd: "/tmp/product-docs",
      });
      await scenario.registerAgent(broker, {
        id: "docs.edit.codex",
        definitionId: "docs-edit",
        displayName: "Docs Edit",
        handle: "docs-edit",
        selector: "@docs-edit",
        harness: "codex",
        transport: "codex_app_server",
        endpointId: "endpoint.docs.edit",
        sessionId: "docs-edit-session",
        branch: "release/docs-fixes",
        projectRoot: "/tmp/product-docs",
        cwd: "/tmp/product-docs",
      });

      const conversation = await scenario.ensureDirectConversation(broker, {
        sourceId: "docs.review.claude",
        targetId: "docs.edit.codex",
        title: "Docs Review Handoff",
      });

      const now = Date.now();
      await scenario.post(broker, "/v1/collaboration/records", {
        id: "work.docs.review.1",
        kind: "work_item",
        state: "waiting",
        acceptanceState: "none",
        title: "Review the quickstart docs",
        summary: "Check the quickstart for missing setup steps and confusing language before release.",
        createdById: "operator",
        ownerId: "docs.review.claude",
        nextMoveOwnerId: "docs.review.claude",
        requestedById: "operator",
        waitingOn: {
          kind: "actor",
          label: "docs review",
          targetId: "docs.review.claude",
        },
        conversationId: conversation.id,
        createdAt: now,
        updatedAt: now,
      });

      const wake = await scenario.post<{
        ok: boolean;
        recordId: string;
        targetAgentId: string;
        wakeReason: string;
        invocation: {
          targetAgentId: string;
          metadata?: {
            collaborationRecordId?: string;
            wakeReason?: string;
          };
          context?: {
            collaboration?: {
              recordId?: string;
              nextMoveOwnerId?: string;
              waitingOn?: { targetId?: string };
            };
          };
        };
        flight: {
          targetAgentId: string;
          state: string;
        };
      }>(broker, "/v1/collaboration/records/work.docs.review.1/invoke", {
        requesterId: "operator",
      });

      expect(wake.ok).toBe(true);
      expect(wake.recordId).toBe("work.docs.review.1");
      expect(wake.targetAgentId).toBe("docs.review.claude");
      expect(wake.wakeReason).toBe("next_move_owner");
      expect(wake.invocation.targetAgentId).toBe("docs.review.claude");
      expect(wake.invocation.metadata?.collaborationRecordId).toBe("work.docs.review.1");
      expect(wake.invocation.metadata?.wakeReason).toBe("next_move_owner");
      expect(wake.invocation.context?.collaboration?.recordId).toBe("work.docs.review.1");
      expect(wake.invocation.context?.collaboration?.nextMoveOwnerId).toBe("docs.review.claude");
      expect(wake.invocation.context?.collaboration?.waitingOn?.targetId).toBe("docs.review.claude");
      expect(wake.flight.targetAgentId).toBe("docs.review.claude");
      expect(wake.flight.state).toBe("queued");

      await scenario.postMessage(broker, {
        id: "msg-docs-review-1",
        conversationId: conversation.id,
        actorId: "docs.review.claude",
        body: "The quickstart needs a prerequisites section and a clearer API key setup step.",
      });
      await scenario.postMessage(broker, {
        id: "msg-docs-review-2",
        conversationId: conversation.id,
        actorId: "docs.edit.codex",
        body: "Updated. I added prerequisites and split the API key setup into its own numbered step.",
      });

      const messages = await scenario.listMessages(broker, conversation.id);
      expect(messages.map((message) => message.body)).toEqual([
        "The quickstart needs a prerequisites section and a clearer API key setup step.",
        "Updated. I added prerequisites and split the API key setup into its own numbered step.",
      ]);

      const deliveries = (await scenario.listDeliveries(broker))
        .filter((delivery) => new Set(["msg-docs-review-1", "msg-docs-review-2"]).has(delivery.messageId ?? ""));
      expect(deliveries).toHaveLength(2);

      const reviewToEdit = deliveries.find((delivery) => delivery.messageId === "msg-docs-review-1");
      expect(deliverySummary(reviewToEdit!)).toEqual({
        messageId: "msg-docs-review-1",
        targetId: "docs.edit.codex",
        transport: "codex_app_server",
        reason: "direct_message",
      });

      const editToReview = deliveries.find((delivery) => delivery.messageId === "msg-docs-review-2");
      expect(editToReview).toEqual(expect.objectContaining({
        messageId: "msg-docs-review-2",
        targetId: "docs.review.claude",
        reason: "direct_message",
      }));
      expect(["claude_stream_json", "local_socket"]).toContain(editToReview?.transport);
    },
  );

  runtimeScenario(
    "scripts a multi-turn direct conversation across Codex and Claude branches",
    async (scenario) => {
      const broker = await scenario.startBroker();

      await scenario.registerAgent(broker, {
        id: "lattices.main.codex",
        definitionId: "lattices",
        displayName: "Lattices",
        handle: "lattices",
        selector: "@lattices",
        harness: "codex",
        transport: "codex_app_server",
        endpointId: "endpoint.lattices.codex",
        sessionId: "lattices-codex",
        branch: "main",
        projectRoot: "/tmp/lattices",
        cwd: "/tmp/lattices",
      });
      await scenario.registerAgent(broker, {
        id: "vox.feature-qa.claude",
        definitionId: "vox",
        displayName: "Vox",
        handle: "vox",
        selector: "@vox",
        harness: "claude",
        transport: "claude_stream_json",
        endpointId: "endpoint.vox.claude",
        sessionId: "vox-claude",
        branch: "feature/qa-followups",
        projectRoot: "/tmp/vox/.scout-worktrees/qa-followups",
        cwd: "/tmp/vox/.scout-worktrees/qa-followups",
      });

      const conversation = await scenario.ensureDirectConversation(broker, {
        sourceId: "lattices.main.codex",
        targetId: "vox.feature-qa.claude",
        title: "Lattices <> Vox",
      });

      await scenario.postMessage(broker, {
        id: "msg-dm-1",
        conversationId: conversation.id,
        actorId: "lattices.main.codex",
        body: "Can you sanity-check the handoff before I merge?",
      });
      await scenario.postMessage(broker, {
        id: "msg-dm-2",
        conversationId: conversation.id,
        actorId: "vox.feature-qa.claude",
        body: "Yes. I want one more follow-up on the timeout path.",
      });
      await scenario.postMessage(broker, {
        id: "msg-dm-3",
        conversationId: conversation.id,
        actorId: "lattices.main.codex",
        body: "Done. I tightened the timeout handling and reran the scenario.",
      });

      const messages = await scenario.listMessages(broker, conversation.id);
      expect(messages.map((message) => message.body)).toEqual([
        "Can you sanity-check the handoff before I merge?",
        "Yes. I want one more follow-up on the timeout path.",
        "Done. I tightened the timeout handling and reran the scenario.",
      ]);

      const deliveries = (await scenario.listDeliveries(broker))
        .filter((delivery) => new Set(["msg-dm-1", "msg-dm-2", "msg-dm-3"]).has(delivery.messageId ?? ""));
      expect(sortSummaries(deliveries.map(deliverySummary))).toEqual(sortSummaries([
        {
          messageId: "msg-dm-1",
          targetId: "vox.feature-qa.claude",
          transport: "claude_stream_json",
          reason: "direct_message",
        },
        {
          messageId: "msg-dm-2",
          targetId: "lattices.main.codex",
          transport: "codex_app_server",
          reason: "direct_message",
        },
        {
          messageId: "msg-dm-3",
          targetId: "vox.feature-qa.claude",
          transport: "claude_stream_json",
          reason: "direct_message",
        },
      ]));

      const snapshot = await scenario.snapshot<{
        endpoints: Record<string, { harness: string; transport: string; metadata?: Record<string, unknown> }>;
      }>(broker);
      expect(snapshot.endpoints["endpoint.lattices.codex"]).toMatchObject({
        harness: "codex",
        transport: "codex_app_server",
        metadata: expect.objectContaining({
          branch: "main",
        }),
      });
      expect(snapshot.endpoints["endpoint.vox.claude"]).toMatchObject({
        harness: "claude",
        transport: "claude_stream_json",
        metadata: expect.objectContaining({
          branch: "feature/qa-followups",
        }),
      });
    },
  );

  runtimeScenario(
    "scripts a three-agent group_direct conversation and verifies direct fan-out",
    async (scenario) => {
      const broker = await scenario.startBroker();

      await scenario.registerAgent(broker, {
        id: "vox.review",
        definitionId: "vox",
        displayName: "Vox",
        handle: "vox",
        selector: "@vox",
        harness: "claude",
        transport: "claude_stream_json",
        endpointId: "endpoint.vox.review",
      });
      await scenario.registerAgent(broker, {
        id: "lattices.review",
        definitionId: "lattices",
        displayName: "Lattices",
        handle: "lattices",
        selector: "@lattices",
        harness: "codex",
        transport: "codex_app_server",
        endpointId: "endpoint.lattices.review",
      });
      await scenario.registerAgent(broker, {
        id: "newell.review",
        definitionId: "newell",
        displayName: "Newell",
        handle: "newell",
        selector: "@newell",
        harness: "codex",
        transport: "codex_app_server",
        endpointId: "endpoint.newell.review",
      });

      const conversation = await scenario.registerConversation(broker, {
        id: "group.release.review",
        kind: "group_direct",
        title: "Release Review",
        participantIds: ["vox.review", "lattices.review", "newell.review"],
      });

      await scenario.postMessage(broker, {
        id: "msg-group-1",
        conversationId: conversation.id,
        actorId: "vox.review",
        body: "I am checking the timeout semantics.",
      });
      await scenario.postMessage(broker, {
        id: "msg-group-2",
        conversationId: conversation.id,
        actorId: "lattices.review",
        body: "I am taking the branch and worktree path.",
      });
      await scenario.postMessage(broker, {
        id: "msg-group-3",
        conversationId: conversation.id,
        actorId: "newell.review",
        body: "I will verify the pairing-session attach flow.",
      });

      const messages = await scenario.listMessages(broker, conversation.id);
      expect(messages.map((message) => message.body)).toEqual([
        "I am checking the timeout semantics.",
        "I am taking the branch and worktree path.",
        "I will verify the pairing-session attach flow.",
      ]);

      const deliveries = (await scenario.listDeliveries(broker))
        .filter((delivery) => new Set(["msg-group-1", "msg-group-2", "msg-group-3"]).has(delivery.messageId ?? ""));
      expect(sortSummaries(deliveries.map(deliverySummary))).toEqual(sortSummaries([
        {
          messageId: "msg-group-1",
          targetId: "lattices.review",
          transport: "codex_app_server",
          reason: "direct_message",
        },
        {
          messageId: "msg-group-1",
          targetId: "newell.review",
          transport: "codex_app_server",
          reason: "direct_message",
        },
        {
          messageId: "msg-group-2",
          targetId: "newell.review",
          transport: "codex_app_server",
          reason: "direct_message",
        },
        {
          messageId: "msg-group-2",
          targetId: "vox.review",
          transport: "claude_stream_json",
          reason: "direct_message",
        },
        {
          messageId: "msg-group-3",
          targetId: "lattices.review",
          transport: "codex_app_server",
          reason: "direct_message",
        },
        {
          messageId: "msg-group-3",
          targetId: "vox.review",
          transport: "claude_stream_json",
          reason: "direct_message",
        },
      ]));
    },
  );

  runtimeScenario(
    "keeps authority-owned history canonical when a remote broker writes into the thread",
    async (scenario) => {
      const authority = await scenario.startBroker();
      const remote = await scenario.startBroker();

      await scenario.registerNode(remote, {
        id: authority.nodeId,
        name: "Authority",
        brokerUrl: authority.baseUrl,
      });

      await scenario.registerAgent(authority, {
        id: "remote-agent",
        definitionId: "remote-agent",
        displayName: "Remote Agent",
        handle: "remote-agent",
        selector: "@remote-agent",
        homeNodeId: remote.nodeId,
        authorityNodeId: remote.nodeId,
      });
      await scenario.registerAgent(remote, {
        id: "remote-agent",
        definitionId: "remote-agent",
        displayName: "Remote Agent",
        handle: "remote-agent",
        selector: "@remote-agent",
        homeNodeId: remote.nodeId,
        authorityNodeId: remote.nodeId,
      });

      const conversation = {
        id: "channel.shared.remote-runtime-scenario",
        kind: "channel" as const,
        title: "shared remote runtime scenario",
        visibility: "workspace" as const,
        shareMode: "shared" as const,
        authorityNodeId: authority.nodeId,
        participantIds: ["remote-agent"],
        metadata: { surface: "scenario" },
      };
      await scenario.registerConversation(authority, conversation);
      await scenario.registerConversation(remote, conversation);

      const response = await scenario.post<{
        ok: boolean;
        mesh?: { forwarded?: boolean; authorityNodeId?: string };
      }>(remote, "/v1/messages", {
        id: "msg-remote-authority-1",
        conversationId: conversation.id,
        actorId: "remote-agent",
        originNodeId: remote.nodeId,
        class: "agent",
        body: "remote-authority handoff message",
        visibility: "workspace",
        policy: "durable",
        createdAt: Date.now(),
      });
      expect(response.ok).toBe(true);
      expect(response.mesh).toEqual(expect.objectContaining({
        forwarded: true,
        authorityNodeId: authority.nodeId,
      }));

      const authorityMessages = await scenario.waitFor(
        () => scenario.listMessages(authority, conversation.id),
        (messages) => messages.some((message) => message.id === "msg-remote-authority-1"),
      );
      expect(authorityMessages.map((message) => message.body)).toContain("remote-authority handoff message");

      const remoteSnapshot = await scenario.snapshot<{
        messages: Record<string, MessageRecord>;
      }>(remote);
      expect(remoteSnapshot.messages["msg-remote-authority-1"]).toBeUndefined();
    },
  );

  runtimeScenario(
    "attaches a Codex local session and routes direct messages through pairing_bridge",
    async (scenario) => {
      const pairing = scenario.startPairingBridgeServer({ sessions: [] });
      const home = scenario.configurePairingHome(pairing.port);
      const broker = await scenario.startBroker({
        env: {
          HOME: home,
        },
      });

      await scenario.seedOperator(broker);

      const attached = await scenario.post<{
        ok: boolean;
        agentId: string;
        selector: string;
        endpointId: string;
        sessionId: string;
      }>(broker, "/v1/local-sessions/attach", {
        externalSessionId: "019d9762-19f7-7792-8962-90d924ce7faa",
        transport: "codex_app_server",
        cwd: "/tmp/codex-here",
        alias: "@codex-here",
        displayName: "Codex Here",
      });

      expect(attached.ok).toBe(true);
      expect(attached.selector).toBe("@codex-here");
      expect(attached.sessionId).toBe("pairing-019d9762");

      const conversation = await scenario.ensureDirectConversation(broker, {
        sourceId: "operator",
        targetId: attached.agentId,
        title: "Operator <> Codex Here",
      });

      await scenario.postMessage(broker, {
        id: "msg-local-session-1",
        conversationId: conversation.id,
        actorId: "operator",
        body: "Please take a second pass on the runtime harness.",
      });

      const deliveries = (await scenario.listDeliveries(broker))
        .filter((delivery) => delivery.messageId === "msg-local-session-1");
      expect(deliveries.map(deliverySummary)).toEqual([
        {
          messageId: "msg-local-session-1",
          targetId: attached.agentId,
          transport: "pairing_bridge",
          reason: "direct_message",
        },
      ]);

      const snapshot = await scenario.snapshot<{
        agents: Record<string, { selector?: string; displayName: string }>;
        endpoints: Record<string, {
          transport: string;
          sessionId?: string;
          metadata?: Record<string, unknown>;
        }>;
      }>(broker);
      expect(snapshot.agents[attached.agentId]).toEqual(expect.objectContaining({
        displayName: "Codex Here",
        selector: "@codex-here",
      }));
      expect(snapshot.endpoints[attached.endpointId]).toEqual(expect.objectContaining({
        transport: "pairing_bridge",
        sessionId: "pairing-019d9762",
        metadata: expect.objectContaining({
          externalSessionId: "019d9762-19f7-7792-8962-90d924ce7faa",
          threadId: "019d9762-19f7-7792-8962-90d924ce7faa",
        }),
      }));
    },
  );
});
