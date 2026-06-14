import { describe, expect, test } from "bun:test";

import { createRuntimeRegistrySnapshot } from "@openscout/runtime/registry";

import { listScoutChannelMemberships } from "./service.ts";

describe("listScoutChannelMemberships", () => {
  test("returns channel memberships for conversations the agent participates in", () => {
    const memberships = listScoutChannelMemberships(
      createRuntimeRegistrySnapshot({
        conversations: {
          "channel.triage": {
            id: "channel.triage",
            kind: "channel",
            title: "triage",
            visibility: "workspace",
            shareMode: "local",
            authorityNodeId: "node-1",
            participantIds: ["arach", "operator"],
            metadata: { channel: "triage" },
          },
          "dm.operator.arach": {
            id: "dm.operator.arach",
            kind: "direct",
            title: "operator ↔ arach",
            visibility: "private",
            shareMode: "local",
            authorityNodeId: "node-1",
            participantIds: ["arach", "operator"],
          },
        },
        agents: {
          arach: {
            id: "arach",
            kind: "agent",
            displayName: "Arach",
            definitionId: "arach",
            handle: "arach",
            selector: "@arach",
            defaultSelector: "@arach",
            agentClass: "general",
            capabilities: ["chat"],
            wakePolicy: "on_demand",
            homeNodeId: "node-1",
            authorityNodeId: "node-1",
            advertiseScope: "local",
          },
        },
      }),
      "arach",
    );

    expect(memberships).toEqual([
      {
        channel: "shared",
        conversationId: "channel.shared",
        title: "shared-channel",
        visibility: "workspace",
        shareMode: "shared",
        participantCount: 0,
      },
      {
        channel: "triage",
        conversationId: "channel.triage",
        title: "triage",
        visibility: "workspace",
        shareMode: "local",
        participantCount: 2,
      },
    ]);
  });
});
