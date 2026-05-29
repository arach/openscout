import { describe, expect, mock, test } from "bun:test";

mock.module("react", () => ({
  useCallback: <T extends (...args: unknown[]) => unknown>(value: T) => value,
  useEffect: () => {},
  useRef: <T>(value: T) => ({ current: value }),
  useState: <T>(value: T) => [value, () => {}] as const,
}));

const { clearRouteMachineScope, routeFromUrl, routePath, setRouteMachineScope } = await import("./router.ts");

describe("agents route parsing", () => {
  test("conversations routes round-trip", () => {
    expect(routeFromUrl("http://127.0.0.1:3200/conversations")).toEqual({
      view: "conversations",
    });
    expect(routePath({ view: "conversations" })).toBe("/conversations");
  });

  test("direct agent conversation routes default to the message tab", () => {
    const route = routeFromUrl("http://127.0.0.1:3200/agents/openscout-6.main.mini/c/dm.operator.openscout-6.main.mini");

    expect(route).toEqual({
      view: "agents",
      agentId: "openscout-6.main.mini",
      conversationId: "dm.operator.openscout-6.main.mini",
      tab: "message",
    });
    expect(routePath(route)).toBe("/agents/openscout-6.main.mini?tab=message");
  });

  test("machine-scoped routes round-trip through URLs", () => {
    expect(routeFromUrl("http://127.0.0.1:3200/fleet?machineId=node-b")).toEqual({
      view: "fleet",
      machineId: "node-b",
    });
    expect(routePath({ view: "fleet", machineId: "node-b" })).toBe("/fleet?machineId=node-b");

    expect(routeFromUrl("http://127.0.0.1:3200/mesh?machineId=node-b")).toEqual({
      view: "mesh",
      machineId: "node-b",
    });
    expect(routePath({ view: "mesh", machineId: "node-b" })).toBe("/mesh?machineId=node-b");

    expect(routeFromUrl("http://127.0.0.1:3200/work/work-1?machineId=node-b")).toEqual({
      view: "work",
      workId: "work-1",
      machineId: "node-b",
    });
    expect(routePath({ view: "work", workId: "work-1", machineId: "node-b" })).toBe(
      "/work/work-1?machineId=node-b",
    );
  });

  test("machine scope composes with existing route query params", () => {
    const agentRoute = routeFromUrl("http://127.0.0.1:3200/agents/hudson.main?tab=observe&machineId=node-b");
    expect(agentRoute).toEqual({
      view: "agents",
      agentId: "hudson.main",
      tab: "observe",
      machineId: "node-b",
    });
    expect(routePath(agentRoute)).toBe("/agents/hudson.main?tab=observe&machineId=node-b");

    const conversationRoute = routeFromUrl("http://127.0.0.1:3200/c/dm.operator.hudson?compose=ask&machineId=node-b");
    expect(conversationRoute).toEqual({
      view: "conversation",
      conversationId: "dm.operator.hudson",
      composeMode: "ask",
      machineId: "node-b",
    });
    expect(routePath(conversationRoute)).toBe("/c/dm.operator.hudson?compose=ask&machineId=node-b");

    const messagesRoute = routeFromUrl(
      "http://127.0.0.1:3200/messages/channel.font-studio?filter=channel&sort=unread&machineId=node-b",
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
    const route = routeFromUrl("http://127.0.0.1:3200/agents/openscout-6.main.mini/c/dm.operator.openscout-6.main.mini?tab=observe");

    expect(route).toEqual({
      view: "agents",
      agentId: "openscout-6.main.mini",
      conversationId: "dm.operator.openscout-6.main.mini",
      tab: "observe",
    });
    expect(routePath(route)).toBe("/agents/openscout-6.main.mini?tab=observe");
  });

  test("follow routes preserve Scout ids and preferred view", () => {
    const route = routeFromUrl(
      "http://127.0.0.1:3200/follow?view=tail&flightId=flight-1&invocationId=inv-1&conversationId=dm.operator.hudson&workId=work-1&targetAgentId=hudson.main",
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
    const route = routeFromUrl("http://127.0.0.1:3200/ops/tail?q=019ddb1b-test-thread");

    expect(route).toEqual({
      view: "ops",
      mode: "tail",
      tailQuery: "019ddb1b-test-thread",
    });
    expect(routePath(route)).toBe("/ops/tail?q=019ddb1b-test-thread");
  });

  test("terminal routes tolerate trailing punctuation on mode deep links", () => {
    expect(routeFromUrl("http://127.0.0.1:3200/terminal/hero.master?mode=takeover.")).toEqual({
      view: "terminal",
      agentId: "hero.master",
      mode: "takeover",
    });
  });

  test("ops issues route accepts error-oriented aliases", () => {
    expect(routeFromUrl("http://127.0.0.1:3200/ops/plan")).toEqual({
      view: "ops",
      mode: "plan",
    });
    expect(routeFromUrl("http://127.0.0.1:3200/ops/issues")).toEqual({
      view: "ops",
      mode: "issues",
    });
    expect(routeFromUrl("http://127.0.0.1:3200/ops/errors")).toEqual({
      view: "ops",
      mode: "issues",
    });
    expect(routePath({ view: "ops", mode: "issues" })).toBe("/ops/issues");
  });

  test("messages index route round-trips", () => {
    expect(routeFromUrl("http://127.0.0.1:3200/messages")).toEqual({
      view: "messages",
    });
    expect(routePath({ view: "messages" })).toBe("/messages");
  });

  test("messages route preserves conversationId, filter, and sort", () => {
    const route = routeFromUrl(
      "http://127.0.0.1:3200/messages/channel.font-studio?filter=channel&sort=unread",
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
    expect(routeFromUrl("http://127.0.0.1:3200/settings/agents")).toEqual({
      view: "settings",
      section: "agents",
    });
    expect(routePath({ view: "settings", section: "agents" })).toBe("/settings/agents");

    const detailRoute = routeFromUrl("http://127.0.0.1:3200/settings/agents/openscout-6.main.mini");
    expect(detailRoute).toEqual({
      view: "settings",
      section: "agents",
      agentId: "openscout-6.main.mini",
    });
    expect(routePath(detailRoute)).toBe("/settings/agents/openscout-6.main.mini");
  });
});
