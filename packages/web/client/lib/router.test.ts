import { describe, expect, mock, test } from "bun:test";

const React = await import("../../node_modules/react/index.js");

mock.module("react", () => React);

const { clearRouteMachineScope, routeFromUrl, routePath, setRouteMachineScope } = await import("./router.ts");

describe("agents route parsing", () => {
  test("conversations routes round-trip", () => {
    expect(routeFromUrl("http://127.0.0.1:43120/conversations")).toEqual({
      view: "conversations",
    });
    expect(routePath({ view: "conversations" })).toBe("/conversations");
  });

  test("direct agent conversation routes default to the message tab", () => {
    const route = routeFromUrl("http://127.0.0.1:43120/agents/openscout-6.main.mini/c/dm.operator.openscout-6.main.mini");

    expect(route).toEqual({
      view: "agents",
      agentId: "openscout-6.main.mini",
      conversationId: "dm.operator.openscout-6.main.mini",
      tab: "message",
    });
    expect(routePath(route)).toBe("/agents/openscout-6.main.mini?tab=message");
  });

  test("machine-scoped routes round-trip through URLs", () => {
    expect(routeFromUrl("http://127.0.0.1:43120/fleet?machineId=node-b")).toEqual({
      view: "fleet",
      machineId: "node-b",
    });
    expect(routePath({ view: "fleet", machineId: "node-b" })).toBe("/fleet?machineId=node-b");

    expect(routeFromUrl("http://127.0.0.1:43120/mesh?machineId=node-b")).toEqual({
      view: "mesh",
      machineId: "node-b",
    });
    expect(routePath({ view: "mesh", machineId: "node-b" })).toBe("/mesh?machineId=node-b");

    expect(routeFromUrl("http://127.0.0.1:43120/work/work-1?machineId=node-b")).toEqual({
      view: "work",
      workId: "work-1",
      machineId: "node-b",
    });
    expect(routePath({ view: "work", workId: "work-1", machineId: "node-b" })).toBe(
      "/work/work-1?machineId=node-b",
    );

    expect(routeFromUrl("http://127.0.0.1:43120/harnesses?machineId=node-b")).toEqual({
      view: "harnesses",
      machineId: "node-b",
    });
    expect(routePath({ view: "harnesses", machineId: "node-b" })).toBe("/harnesses?machineId=node-b");
  });

  test("machine scope composes with existing route query params", () => {
    const agentRoute = routeFromUrl("http://127.0.0.1:43120/agents/hudson.main?tab=observe&machineId=node-b");
    expect(agentRoute).toEqual({
      view: "agents",
      agentId: "hudson.main",
      tab: "observe",
      machineId: "node-b",
    });
    expect(routePath(agentRoute)).toBe("/agents/hudson.main?tab=observe&machineId=node-b");

    const conversationRoute = routeFromUrl("http://127.0.0.1:43120/c/dm.operator.hudson?compose=ask&machineId=node-b");
    expect(conversationRoute).toEqual({
      view: "conversation",
      conversationId: "dm.operator.hudson",
      composeMode: "ask",
      machineId: "node-b",
    });
    expect(routePath(conversationRoute)).toBe("/c/dm.operator.hudson?compose=ask&machineId=node-b");

    const messagesRoute = routeFromUrl(
      "http://127.0.0.1:43120/messages/channel.font-studio?filter=channel&sort=unread&machineId=node-b",
    );
    expect(messagesRoute).toEqual({
      view: "messages",
      conversationId: "channel.font-studio",
      filter: "channel",
      sort: "unread",
      machineId: "node-b",
    });
    expect(routePath(messagesRoute)).toBe(
      "/messages/channel.font-studio?filter=channel&sort=unread&machineId=node-b",
    );
  });

  test("machine scope helpers set and explicitly clear scoped routes", () => {
    expect(setRouteMachineScope({ view: "agents" }, "node-b")).toEqual({
      view: "agents",
      machineId: "node-b",
    });
    expect(routePath(clearRouteMachineScope({ view: "agents", machineId: "node-b" }))).toBe("/agents");
    expect(setRouteMachineScope({ view: "settings" }, "node-b")).toEqual({ view: "settings" });
  });

  test("observe deep links preserve the explicit observe tab", () => {
    const route = routeFromUrl("http://127.0.0.1:43120/agents/openscout-6.main.mini/c/dm.operator.openscout-6.main.mini?tab=observe");

    expect(route).toEqual({
      view: "agents",
      agentId: "openscout-6.main.mini",
      conversationId: "dm.operator.openscout-6.main.mini",
      tab: "observe",
    });
    expect(routePath(route)).toBe("/agents/openscout-6.main.mini?tab=observe");
  });


  test("agent-scoped session routes round-trip", () => {
    const route = routeFromUrl("http://127.0.0.1:43120/agents/hudson.main/sessions/codex-thread-1");

    expect(route).toEqual({
      view: "sessions",
      agentId: "hudson.main",
      sessionId: "codex-thread-1",
    });
    expect(routePath(route)).toBe("/agents/hudson.main/sessions/codex-thread-1");
  });

  test("follow routes preserve Scout ids and preferred view", () => {
    const route = routeFromUrl(
      "http://127.0.0.1:43120/follow?view=tail&flightId=flight-1&invocationId=inv-1&conversationId=dm.operator.hudson&workId=work-1&targetAgentId=hudson.main",
    );

    expect(route).toEqual({
      view: "follow",
      preferredView: "tail",
      flightId: "flight-1",
      invocationId: "inv-1",
      conversationId: "dm.operator.hudson",
      workId: "work-1",
      targetAgentId: "hudson.main",
    });
    expect(routePath(route)).toBe(
      "/follow?view=tail&flightId=flight-1&invocationId=inv-1&conversationId=dm.operator.hudson&workId=work-1&targetAgentId=hudson.main",
    );
  });

  test("tail routes preserve an optional focus query", () => {
    const route = routeFromUrl("http://127.0.0.1:43120/ops/tail?q=019ddb1b-test-thread");

    expect(route).toEqual({
      view: "ops",
      mode: "tail",
      tailQuery: "019ddb1b-test-thread",
    });
    expect(routePath(route)).toBe("/ops/tail?q=019ddb1b-test-thread");
  });

  test("terminal routes tolerate trailing punctuation on mode deep links", () => {
    expect(routeFromUrl("http://127.0.0.1:43120/terminal/hero.master?mode=takeover.")).toEqual({
      view: "terminal",
      agentId: "hero.master",
      mode: "takeover",
    });
  });

  test("terminal routes preserve registered session surface deep links", () => {
    const route = routeFromUrl("http://127.0.0.1:43120/terminal?session=ts.123&surface=zellij%3Ascout-zj&mode=observe");

    expect(route).toEqual({
      view: "terminal",
      terminalSessionId: "ts.123",
      terminalSurfaceKey: "zellij:scout-zj",
      mode: "observe",
    });
    expect(routePath(route)).toBe("/terminal/zellij/scout-zj?mode=observe");
  });

  test("terminal routes support backend/session path deep links", () => {
    const route = routeFromUrl(
      "http://127.0.0.1:43120/terminal/tmux/relay-atelier-card-w-eury8m-master-arts-mac-mini-local-claude?mode=takeover",
    );

    expect(route).toEqual({
      view: "terminal",
      terminalSurfaceKey: "tmux:relay-atelier-card-w-eury8m-master-arts-mac-mini-local-claude",
      mode: "takeover",
    });
    expect(routePath(route)).toBe(
      "/terminal/tmux/relay-atelier-card-w-eury8m-master-arts-mac-mini-local-claude?mode=takeover",
    );
  });

  test("ops issues route accepts error-oriented aliases", () => {
    expect(routeFromUrl("http://127.0.0.1:43120/ops/plan")).toEqual({
      view: "ops",
      mode: "plan",
    });
    expect(routeFromUrl("http://127.0.0.1:43120/ops/issues")).toEqual({
      view: "ops",
      mode: "issues",
    });
    expect(routeFromUrl("http://127.0.0.1:43120/ops/errors")).toEqual({
      view: "ops",
      mode: "issues",
    });
    expect(routePath({ view: "ops", mode: "issues" })).toBe("/ops/issues");
  });

  test("messages index route round-trips", () => {
    expect(routeFromUrl("http://127.0.0.1:43120/messages")).toEqual({
      view: "messages",
    });
    expect(routePath({ view: "messages" })).toBe("/messages");
  });

  test("search route round-trips", () => {
    expect(routeFromUrl("http://127.0.0.1:43120/search")).toEqual({
      view: "search",
    });
    expect(routePath({ view: "search" })).toBe("/search");
    expect(routeFromUrl("http://127.0.0.1:43120/search/knowledge")).toEqual({
      view: "search",
    });
    expect(routeFromUrl("http://127.0.0.1:43120/search/indexer")).toEqual({
      view: "search",
      mode: "indexer",
    });
    expect(routePath({ view: "search", mode: "knowledge" })).toBe("/search");
    expect(routePath({ view: "search", mode: "indexer" })).toBe("/search/indexer");
  });

  test("messages route preserves conversationId, filter, and sort", () => {
    const route = routeFromUrl(
      "http://127.0.0.1:43120/messages/channel.font-studio?filter=channel&sort=unread",
    );
    expect(route).toEqual({
      view: "messages",
      conversationId: "channel.font-studio",
      filter: "channel",
      sort: "unread",
    });
    expect(routePath(route)).toBe(
      "/messages/channel.font-studio?filter=channel&sort=unread",
    );
  });

  test("messages defaults (all + recent) stay out of the URL", () => {
    expect(
      routePath({ view: "messages", conversationId: "dm.operator.foo", filter: "all", sort: "recent" }),
    ).toBe("/messages/dm.operator.foo");
  });

  test("agent configuration settings routes round-trip", () => {
    expect(routeFromUrl("http://127.0.0.1:43120/settings/agents")).toEqual({
      view: "settings",
      section: "agents",
    });
    expect(routePath({ view: "settings", section: "agents" })).toBe("/settings/agents");

    const detailRoute = routeFromUrl("http://127.0.0.1:43120/settings/agents/openscout-6.main.mini");
    expect(detailRoute).toEqual({
      view: "settings",
      section: "agents",
      agentId: "openscout-6.main.mini",
    });
    expect(routePath(detailRoute)).toBe("/settings/agents/openscout-6.main.mini");
  });
});
