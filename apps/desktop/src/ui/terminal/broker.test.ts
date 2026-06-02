import { describe, expect, test } from "bun:test";

import type { ScoutWhoEntry } from "../../core/broker/service.ts";
import {
  renderScoutActivityList,
  renderScoutAgentList,
  renderScoutMessagePostResult,
} from "./broker.ts";

function makeWhoEntry(overrides: Partial<ScoutWhoEntry>): ScoutWhoEntry {
  return {
    agentId: "openscout.main.mini",
    displayName: null,
    handle: null,
    selector: null,
    defaultSelector: null,
    projectName: null,
    projectRoot: null,
    harness: null,
    transport: null,
    sessionId: null,
    state: "offline",
    messages: 0,
    lastSeen: null,
    registrationKind: "broker",
    ...overrides,
  };
}

describe("renderScoutMessagePostResult", () => {
  test("renders durable handles for normal sends", () => {
    expect(renderScoutMessagePostResult({
      message: "hello",
      senderId: "lattices.codex-event-tap-thread.mini",
      conversationId: "dm.operator.hudson.main.mini",
      messageId: "msg-1",
      invokedTargets: ["hudson.main.mini"],
      unresolvedTargets: [],
      routeKind: "dm",
    })).toBe("Sent.\nConversation: dm.operator.hudson.main.mini\nMessage: msg-1");
  });

  test("renders the local product target as Scout", () => {
    expect(renderScoutMessagePostResult({
      message: "hello",
      conversationId: "channel.shared",
      invokedTargets: ["scout"],
      unresolvedTargets: [],
      routeKind: "broadcast",
    })).toBe("Sent to Scout.\nConversation: channel.shared");
  });

  test("renders wake flight ids when a send queued work", () => {
    expect(renderScoutMessagePostResult({
      message: "hello",
      conversationId: "dm.operator.hudson",
      flightId: "flt-1",
      invokedTargets: ["hudson.main"],
      unresolvedTargets: [],
      routeKind: "dm",
    })).toBe("Sent.\nConversation: dm.operator.hudson\nDelivery flight: flt-1\nNext: scout wait flt-1 --timeout 600");
  });
});

describe("renderScoutActivityList", () => {
  test("handles empty activity", () => {
    expect(renderScoutActivityList([])).toBe("No Scout activity yet.");
  });

  test("renders recent ask activity with participants", () => {
    const rendered = renderScoutActivityList([
      {
        id: "activity:1",
        kind: "ask_opened",
        ts: 1_700_000_000,
        actorId: "operator",
        counterpartId: "vox",
        title: "Review the latest web server change",
      },
    ]);

    expect(rendered).toContain("asked");
    expect(rendered).toContain("operator -> vox");
    expect(rendered).toContain("Review the latest web server change");
  });
});

describe("renderScoutAgentList", () => {
  test("groups agents by project and preserves concrete agent details", () => {
    const output = renderScoutAgentList([
      makeWhoEntry({
        agentId: "talkie.codex.mini",
        displayName: "Talkie Codex",
        defaultSelector: "@talkie#codex",
        projectName: "Talkie",
        projectRoot: "/Users/arach/dev/talkie",
        harness: "codex",
        transport: "codex_app_server",
        state: "active",
        messages: 2,
      }),
      makeWhoEntry({
        agentId: "openscout.claude.mini",
        displayName: "OpenScout Claude",
        projectName: "OpenScout",
        projectRoot: "/Users/arach/dev/openscout",
        harness: "claude",
        transport: "tmux",
        state: "discovered",
        registrationKind: "discovered",
      }),
      makeWhoEntry({
        agentId: "talkie.claude.mini",
        displayName: "Talkie Claude",
        projectName: "Talkie",
        projectRoot: "/Users/arach/dev/talkie",
        harness: "claude",
        transport: "tmux",
        state: "idle",
        messages: 1,
      }),
    ]);

    expect(output).toContain("OpenScout (/Users/arach/dev/openscout)");
    expect(output).toContain("Talkie (/Users/arach/dev/talkie)");
    expect(output).toContain("Talkie Codex (talkie.codex.mini) · @talkie#codex");
    expect(output).toContain("codex/codex_app_server · active · 2 messages · not seen yet");
    expect(output).toContain("claude/tmux · idle · 1 message · not seen yet");
    expect(output).toContain("discovered · 0 messages · not seen yet · auto-discovered");
  });
});
