import { describe, expect, test } from "bun:test";

import { routeFromUrl, routePath } from "./router.ts";

describe("agents route parsing", () => {
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
});
