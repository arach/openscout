import { describe, expect, test } from "bun:test";

import {
  parseScoutComposerRoute,
  parseScoutComposerRouteTarget,
  SCOUT_COMPOSER_ROUTE_OPERATOR,
} from "./scout-composer.js";

describe("Scout composer route operator", () => {
  test("exports the route operator token", () => {
    expect(SCOUT_COMPOSER_ROUTE_OPERATOR).toBe(">>");
  });

  test("parses a leading agent route", () => {
    const result = parseScoutComposerRoute(">> hudson review the docs");

    expect(result.diagnostics).toEqual([]);
    expect(result.body).toBe("review the docs");
    expect(result.route?.target).toEqual({
      kind: "agent_label",
      label: "hudson",
      value: "hudson",
    });
  });

  test("parses an inline no-space agent route", () => {
    const result = parseScoutComposerRoute("please >>hudson#codex?5.5 take this");

    expect(result.body).toBe("please take this");
    expect(result.route?.token).toBe("hudson#codex?5.5");
    expect(result.route?.target).toEqual({
      kind: "agent_label",
      label: "hudson#codex?5.5",
      value: "hudson#codex?5.5",
    });
  });

  test("parses prefixed target kinds", () => {
    expect(parseScoutComposerRouteTarget("agent:hudson")).toEqual({
      kind: "agent_label",
      label: "hudson",
      value: "hudson",
    });
    expect(parseScoutComposerRouteTarget("ref:8kj4pd")).toEqual({
      kind: "binding_ref",
      ref: "8kj4pd",
      value: "ref:8kj4pd",
    });
    expect(parseScoutComposerRouteTarget("id:agent-123")).toEqual({
      kind: "agent_id",
      agentId: "agent-123",
      value: "id:agent-123",
    });
    expect(parseScoutComposerRouteTarget("channel:ops")).toEqual({
      kind: "channel",
      channel: "ops",
      value: "channel:ops",
    });
    expect(parseScoutComposerRouteTarget("broadcast")).toEqual({
      kind: "broadcast",
      value: "broadcast",
    });
  });

  test("ignores non-standalone operators", () => {
    const result = parseScoutComposerRoute("a>>b is payload");

    expect(result.route).toBeNull();
    expect(result.body).toBe("a>>b is payload");
    expect(result.diagnostics).toEqual([]);
  });

  test("returns diagnostics for malformed route operators", () => {
    expect(parseScoutComposerRoute("please >>").diagnostics).toEqual([{
      code: "missing_target",
      message: "route operator requires a target after >>",
      start: 7,
      end: 9,
    }]);

    expect(parseScoutComposerRoute(">> @ please").diagnostics).toEqual([{
      code: "invalid_target",
      message: "invalid route target: @",
      start: 3,
      end: 4,
    }]);
  });
});
