import { describe, expect, test } from "bun:test";

import { buildRelayReturnAddress } from "./scout-agent-card";

describe("buildRelayReturnAddress", () => {
  test("keeps only meaningful optional fields", () => {
    const address = buildRelayReturnAddress({
      actorId: "dewey.node.workspace",
      handle: "dewey",
      displayName: "Dewey",
      selector: "@dewey.node.workspace",
      defaultSelector: "@dewey",
      conversationId: "dm.dewey.arc",
      replyToMessageId: "msg-1",
      nodeId: "node-1",
      projectRoot: "/Users/arach/dev/dewey",
      sessionId: "relay-dewey-claude",
      metadata: {
        surface: "scout-card",
      },
    });

    expect(address).toEqual({
      actorId: "dewey.node.workspace",
      handle: "dewey",
      displayName: "Dewey",
      selector: "@dewey.node.workspace",
      defaultSelector: "@dewey",
      conversationId: "dm.dewey.arc",
      replyToMessageId: "msg-1",
      nodeId: "node-1",
      projectRoot: "/Users/arach/dev/dewey",
      sessionId: "relay-dewey-claude",
      metadata: {
        surface: "scout-card",
      },
    });
  });

  test("drops empty optional fields", () => {
    const address = buildRelayReturnAddress({
      actorId: "arc",
      handle: "arc",
      displayName: "  ",
      selector: " ",
      metadata: {},
    });

    expect(address).toEqual({
      actorId: "arc",
      handle: "arc",
    });
  });
});
