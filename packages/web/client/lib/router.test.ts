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
    expect(routePath(route)).toBe("/agents/openscout-6.main.mini/c/dm.operator.openscout-6.main.mini");
  });

  test("observe deep links preserve the explicit observe tab", () => {
    const route = routeFromUrl("http://127.0.0.1:3200/agents/openscout-6.main.mini/c/dm.operator.openscout-6.main.mini?tab=observe");

    expect(route).toEqual({
      view: "agents",
      agentId: "openscout-6.main.mini",
      conversationId: "dm.operator.openscout-6.main.mini",
      tab: "observe",
    });
    expect(routePath(route)).toBe("/agents/openscout-6.main.mini/c/dm.operator.openscout-6.main.mini?tab=observe");
  });
});
