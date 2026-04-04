import { describe, expect, test } from "bun:test";

import type { LocalAgentBinding } from "./local-agents";
import { buildRelayAgentCard } from "./relay-agent-cards";

describe("buildRelayAgentCard", () => {
  test("builds a usable card from a local agent binding", () => {
    const binding: LocalAgentBinding = {
      actor: {
        id: "dewey.node.workspace",
        kind: "agent",
        displayName: "Dewey",
        handle: "dewey",
        metadata: {
          project: "Dewey",
        },
      },
      agent: {
        id: "dewey.node.workspace",
        kind: "agent",
        definitionId: "dewey",
        displayName: "Dewey",
        handle: "dewey",
        selector: "@dewey.node.workspace",
        defaultSelector: "@dewey",
        agentClass: "general",
        capabilities: ["chat", "invoke", "deliver"],
        wakePolicy: "on_demand",
        homeNodeId: "node-1",
        authorityNodeId: "node-1",
        advertiseScope: "local",
        metadata: {
          project: "Dewey",
          projectRoot: "/Users/arach/dev/dewey",
          branch: "main",
        },
      },
      endpoint: {
        id: "endpoint.dewey",
        agentId: "dewey.node.workspace",
        nodeId: "node-1",
        harness: "claude",
        transport: "claude_stream_json",
        state: "idle",
        cwd: "/Users/arach/dev/dewey",
        projectRoot: "/Users/arach/dev/dewey",
        sessionId: "relay-dewey-claude",
      },
    };

    const card = buildRelayAgentCard(binding, {
      currentDirectory: "/Users/arach/dev/dewey/worktrees/feature-x",
      createdById: "arc.node.workspace",
      brokerRegistered: true,
      inboxConversationId: "dm.arc.node.workspace.dewey.node.workspace",
    });

    expect(card.agentId).toBe("dewey.node.workspace");
    expect(card.handle).toBe("dewey");
    expect(card.currentDirectory).toBe("/Users/arach/dev/dewey/worktrees/feature-x");
    expect(card.inboxConversationId).toBe("dm.arc.node.workspace.dewey.node.workspace");
    expect(card.returnAddress.selector).toBe("@dewey.node.workspace");
    expect(card.returnAddress.conversationId).toBe("dm.arc.node.workspace.dewey.node.workspace");
    expect(card.brokerRegistered).toBe(true);
  });
});
