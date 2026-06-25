import { describe, expect, mock, test } from "bun:test";
import type * as ReactModule from "react";

// @ts-expect-error -- the relative .js path keeps bun's runtime resolution to the real react
// module; a bare "react" specifier would be hijacked by tsconfig `paths` to the .d.ts. The cast
// restores the proper types that the path import otherwise loses.
const React = (await import("../../node_modules/react/index.js")) as typeof ReactModule;

mock.module("react", () => React);

const { clearRouteMachineScope, routeFromUrl, routePath, setRouteMachineScope } = await import("./router.ts");
const { normalizeRoute } = await import("./synthetic-agent-routing.ts");
const { resolveRoutedSessionId, resolveSelectedSessionId, sortSessionsByRecency } = await import("./session-catalog.ts");

describe("agents route parsing", () => {
  test("conversations routes round-trip", () => {
    expect(routeFromUrl("http://127.0.0.1:43120/conversations")).toEqual({
      view: "conversations",
    });
    expect(routePath({ view: "conversations" })).toBe("/conversations");
  });

  test("agent chat routes preserve opaque chat ids", () => {
    const route = routeFromUrl("http://127.0.0.1:43120/agents/openscout-6.main.mini/c/c.openscout-chat");

    expect(route).toEqual({
      view: "agents-v2",
      agentId: "openscout-6.main.mini",
      conversationId: "c.openscout-chat",
      tab: "message",
    });
    expect(routePath(route)).toBe("/agents/openscout-6.main.mini/c/c.openscout-chat");
  });

  test("project agent session resource routes preserve session focus", () => {
    const route = routeFromUrl(
      "http://127.0.0.1:43120/projects/scope/agents/scope.main.arts-mac-mini-local/sessions/019efa89-4392-72f1-af6c-860951059bcb",
    );

    expect(route).toEqual({
      view: "agents-v2",
      agentId: "scope.main.arts-mac-mini-local",
      projectSlug: "scope",
      sessionId: "019efa89-4392-72f1-af6c-860951059bcb",
    });
    expect(routePath(route)).toBe(
      "/projects/scope/agents/scope.main.arts-mac-mini-local/sessions/019efa89-4392-72f1-af6c-860951059bcb",
    );
  });

  test("deprecated agents-v2 message hash routes open the message tab and serialize canonically", () => {
    const route = routeFromUrl(
      "http://127.0.0.1:43120/agents-v2/scope.main.arts-mac-mini-local#msg-msg-mqtjmvqd-n734dq",
    );

    expect(route).toEqual({
      view: "agents-v2",
      agentId: "scope.main.arts-mac-mini-local",
      tab: "message",
    });
    expect(routePath(route)).toBe(
      "/agents/scope.main.arts-mac-mini-local?tab=message",
    );
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
      view: "agents-v2",
      agentId: "hudson.main",
      tab: "observe",
      machineId: "node-b",
    });
    expect(routePath(agentRoute)).toBe("/agents/hudson.main?tab=observe&machineId=node-b");

    const conversationRoute = routeFromUrl("http://127.0.0.1:43120/c/c.hudson-chat?compose=ask&machineId=node-b");
    expect(conversationRoute).toEqual({
      view: "conversation",
      conversationId: "c.hudson-chat",
      composeMode: "ask",
      machineId: "node-b",
    });
    expect(routePath(conversationRoute)).toBe("/c/c.hudson-chat?compose=ask&machineId=node-b");

    const messagesRoute = routeFromUrl(
      "http://127.0.0.1:43120/messages/c.font-studio?filter=channel&sort=unread&machineId=node-b",
    );
    expect(messagesRoute).toEqual({
      view: "messages",
      conversationId: "c.font-studio",
      filter: "channel",
      sort: "unread",
      machineId: "node-b",
    });
    expect(routePath(messagesRoute)).toBe(
      "/messages/c.font-studio?filter=channel&sort=unread&machineId=node-b",
    );
  });

  test("machine scope helpers set and explicitly clear scoped routes", () => {
    expect(setRouteMachineScope({ view: "agents" }, "node-b")).toEqual({
      view: "agents",
      machineId: "node-b",
    });
    expect(routePath(clearRouteMachineScope({ view: "agents", machineId: "node-b" }))).toBe("/agents.deprecated");
    expect(routePath(clearRouteMachineScope({ view: "agents-v2", machineId: "node-b" }))).toBe("/projects");
    expect(setRouteMachineScope({ view: "settings" }, "node-b")).toEqual({ view: "settings" });
  });

  test("observe deep links preserve the explicit observe tab", () => {
    const route = routeFromUrl("http://127.0.0.1:43120/agents/openscout-6.main.mini/c/c.openscout-chat?tab=observe");

    expect(route).toEqual({
      view: "agents-v2",
      agentId: "openscout-6.main.mini",
      conversationId: "c.openscout-chat",
      tab: "observe",
    });
    expect(routePath(route)).toBe("/agents/openscout-6.main.mini/c/c.openscout-chat?tab=observe");
  });

  test("synthetic agent observe links normalize to session observe", () => {
    const route = normalizeRoute(
      routeFromUrl(
        "http://127.0.0.1:43120/agents/native%3Aclaude%3A1e753cef-92ae-4e22-a365-0f5d23a07652?tab=observe",
      ),
    );

    expect(route).toEqual({
      view: "sessions",
      sessionId: "1e753cef-92ae-4e22-a365-0f5d23a07652",
    });
    expect(routePath(route)).toBe(
      "/sessions/1e753cef-92ae-4e22-a365-0f5d23a07652",
    );
  });


  test("agent-scoped session routes round-trip", () => {
    const route = routeFromUrl("http://127.0.0.1:43120/agents/hudson.main/sessions/codex-thread-1");

    expect(route).toEqual({
      view: "agents-v2",
      agentId: "hudson.main",
      sessionId: "codex-thread-1",
    });
    expect(routePath(route)).toBe("/agents/hudson.main/sessions/codex-thread-1");
  });

  test("follow routes preserve Scout ids and preferred view", () => {
    const route = routeFromUrl(
      "http://127.0.0.1:43120/follow?view=tail&flightId=flight-1&invocationId=inv-1&conversationId=c.hudson-chat&workId=work-1&targetAgentId=hudson.main",
    );

    expect(route).toEqual({
      view: "follow",
      preferredView: "tail",
      flightId: "flight-1",
      invocationId: "inv-1",
      conversationId: "c.hudson-chat",
      workId: "work-1",
      targetAgentId: "hudson.main",
    });
    expect(routePath(route)).toBe(
      "/follow?view=tail&flightId=flight-1&invocationId=inv-1&conversationId=c.hudson-chat&workId=work-1&targetAgentId=hudson.main",
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
      "http://127.0.0.1:43120/messages/c.font-studio?filter=channel&sort=unread",
    );
    expect(route).toEqual({
      view: "messages",
      conversationId: "c.font-studio",
      filter: "channel",
      sort: "unread",
    });
    expect(routePath(route)).toBe(
      "/messages/c.font-studio?filter=channel&sort=unread",
    );
  });

  test("messages defaults (all + recent) stay out of the URL", () => {
    expect(
      routePath({ view: "messages", conversationId: "c.foo", filter: "all", sort: "recent" }),
    ).toBe("/messages/c.foo");
  });

  test("project registry routes round-trip and old agents-v2 input serializes canonically", () => {
    expect(routeFromUrl("http://127.0.0.1:43120/agents-v2")).toEqual({
      view: "agents-v2",
    });
    expect(routePath({ view: "agents-v2" })).toBe("/projects");

    const scoped = routeFromUrl(
      "http://127.0.0.1:43120/projects/lattices/sessions?state=needs",
    );
    expect(scoped).toEqual({
      view: "agents-v2",
      projectSlug: "lattices",
      stateFilter: "needs",
      indexView: "sessions",
    });
    expect(routeFromUrl(`http://127.0.0.1:43120${routePath(scoped)}`)).toEqual(scoped);

    const agent = routeFromUrl("http://127.0.0.1:43120/projects/lattices/agents/lattices.main/sessions/c.foo");
    expect(agent).toEqual({
      view: "agents-v2",
      agentId: "lattices.main",
      projectSlug: "lattices",
      sessionId: "c.foo",
    });
    expect(routePath(agent)).toBe("/projects/lattices/agents/lattices.main/sessions/c.foo");

    const session = routeFromUrl("http://127.0.0.1:43120/projects/lattices/sessions/c.foo");
    expect(session).toEqual({
      view: "agents-v2",
      projectSlug: "lattices",
      indexView: "sessions",
      sessionId: "c.foo",
    });
    expect(routePath(session)).toBe("/projects/lattices/sessions/c.foo");

    const selected = routeFromUrl(
      "http://127.0.0.1:43120/projects/hudson?select=grok.main",
    );
    expect(selected).toEqual({
      view: "agents-v2",
      projectSlug: "hudson",
      selectedAgentId: "grok.main",
    });
    expect(routePath(selected)).toBe("/projects/hudson?select=grok.main");
  });

  test("agent config tab routes round-trip and legacy definitions alias", () => {
    const configRoute = routeFromUrl("http://127.0.0.1:43120/agents/codex.main?tab=config");
    expect(configRoute).toEqual({
      view: "agents-v2",
      agentId: "codex.main",
      tab: "config",
    });
    expect(routePath(configRoute)).toBe("/agents/codex.main?tab=config");

    const legacyRoute = routeFromUrl("http://127.0.0.1:43120/agents.deprecated/hudson.main?tab=definitions");
    expect(legacyRoute).toEqual({
      view: "agents",
      agentId: "hudson.main",
      tab: "config",
    });
    expect(routePath(legacyRoute)).toBe("/agents.deprecated/hudson.main?tab=config");
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

describe("session catalog selection", () => {
  const sessions = [
    {
      id: "active-session",
      startedAt: 300,
      cwd: "/repo",
    },
    {
      id: "routed-session",
      startedAt: 200,
      cwd: "/repo",
      surfaceSessionId: "tmux:routed",
    },
    {
      id: "scope-catalog-session",
      startedAt: 150,
      cwd: "/Users/art/dev/scope",
      harness: "codex",
      surfaceSessionId: "relay-scope-live-arts-mac-mini-local-codex",
      harnessSessionId: "relay-scope-codex",
      runtimeSessionId: "runtime-scope-codex",
    },
    {
      id: "scope-claude-session",
      startedAt: 125,
      cwd: "/Users/art/dev/scope",
      harness: "claude",
      surfaceSessionId: "relay-scope-live-arts-mac-mini-local-claude",
    },
    {
      id: "focused-session",
      startedAt: 100,
      cwd: "/repo",
    },
  ];

  test("normalizes routed surface ids to catalog session ids", () => {
    expect(resolveRoutedSessionId("tmux:routed", sessions)).toBe("routed-session");
    expect(resolveRoutedSessionId("missing-session", sessions)).toBeNull();
  });

  test("normalizes routed stable aliases to catalog session ids", () => {
    expect(resolveRoutedSessionId("relay-scope-codex", sessions)).toBe("scope-catalog-session");
    expect(resolveRoutedSessionId("runtime-scope-codex", sessions)).toBe("scope-catalog-session");
  });

  test("normalizes compact relay refs to matching harness surfaces", () => {
    expect(resolveRoutedSessionId("relay-scope-claude", sessions)).toBe("scope-claude-session");
    expect(resolveRoutedSessionId("relay-scope-codex", sessions)).toBe("scope-catalog-session");
  });

  test("prefers a valid routed session over stale focused and active sessions", () => {
    const sorted = sortSessionsByRecency(sessions, "active-session");

    expect(
      resolveSelectedSessionId(
        "agent-1",
        { agentId: "agent-1", sessionId: "focused-session" },
        "active-session",
        sorted,
        "relay-scope-codex",
      ),
    ).toBe("scope-catalog-session");
  });

  test("falls back to focused session when routed session is invalid", () => {
    const sorted = sortSessionsByRecency(sessions, "active-session");

    expect(
      resolveSelectedSessionId(
        "agent-1",
        { agentId: "agent-1", sessionId: "focused-session" },
        "active-session",
        sorted,
        "missing-session",
      ),
    ).toBe("focused-session");
  });
});
