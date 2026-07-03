import { describe, expect, test } from "bun:test";

import type { ActorIdentity, AgentEndpoint } from "@openscout/protocol";

import type { RuntimeSnapshot } from "./scout-dispatcher.js";
import {
  formatSessionAliasPointer,
  formatSessionSid,
  isCardlessSessionActor,
  projectPrefixedSessionAlias,
  sessionActorAlias,
  sessionActorSid,
  sessionAliasAckSummary,
  sessionHandoffAckSummary,
} from "./session-alias.js";

function makeSnapshot(input: {
  actors?: Record<string, ActorIdentity>;
  endpoints?: Record<string, AgentEndpoint>;
}): RuntimeSnapshot {
  return {
    agents: {},
    endpoints: input.endpoints ?? {},
    actors: input.actors ?? {},
    nodes: {},
    conversations: {},
    bindings: {},
    flights: {},
    messages: [],
    deliveries: [],
    collaborations: {},
    collaborationEvents: [],
  } as unknown as RuntimeSnapshot;
}

describe("session-alias", () => {
  test("sessionActorAlias prefers actor handle then metadata", () => {
    const snapshot = makeSnapshot({
      actors: {
        "session-abc": {
          id: "session-abc",
          kind: "session",
          displayName: "scope:session",
          handle: "project-chopin",
        },
      },
    });
    expect(sessionActorAlias(snapshot, "session-abc")).toBe("project-chopin");
  });

  test("sessionActorSid reads actor and endpoint metadata", () => {
    const snapshot = makeSnapshot({
      actors: {
        "session-abc": {
          id: "session-abc",
          kind: "session",
          displayName: "scope:session",
          metadata: { sid: "0123456789abcdef" },
        },
      },
    });
    expect(sessionActorSid(snapshot, "session-abc")).toBe("0123456789abcdef");

    const endpointOnly = makeSnapshot({
      actors: {
        "session-def": {
          id: "session-def",
          kind: "session",
          displayName: "scope:session",
        },
      },
      endpoints: {
        "endpoint-1": {
          id: "endpoint-1",
          agentId: "session-def",
          nodeId: "node.local",
          harness: "codex",
          transport: "codex_app_server",
          state: "idle",
          metadata: { sid: "sid:feedfacecafebeef" },
        },
      },
    });
    expect(sessionActorSid(endpointOnly, "session-def")).toBe("feedfacecafebeef");
  });

  test("isCardlessSessionActor reads actor and endpoint metadata", () => {
    const snapshot = makeSnapshot({
      actors: {
        "session-abc": {
          id: "session-abc",
          kind: "session",
          displayName: "scope:session",
          metadata: { cardless: true },
        },
      },
      endpoints: {
        "endpoint-1": {
          id: "endpoint-1",
          agentId: "session-abc",
          nodeId: "node.local",
          harness: "codex",
          transport: "codex_app_server",
          state: "idle",
        },
      },
    });
    expect(isCardlessSessionActor(snapshot, "session-abc")).toBe(true);
  });

  test("formatSessionAliasPointer renders pointer-forward copy", () => {
    expect(formatSessionAliasPointer({
      alias: "project-chopin",
      sessionId: "session-mqvw7fgy-ineuic-extra",
      projectRoot: "/Users/art/dev/scope",
      harness: "codex",
    })).toBe("alias project-chopin → session-mqvw…-extra (scope, codex)");
  });

  test("formatSessionSid renders the routable sid token", () => {
    expect(formatSessionSid("0123456789abcdef")).toBe("sid:0123456789abcdef");
    expect(formatSessionSid("sid:0123456789abcdef")).toBe("sid:0123456789abcdef");
  });

  test("sessionAliasAckSummary returns empty for non-cardless actors", () => {
    const snapshot = makeSnapshot({
      actors: {
        "scope.main": {
          id: "scope.main",
          kind: "agent",
          displayName: "Scope",
        },
      },
    });
    expect(sessionAliasAckSummary({
      snapshot,
      actorId: "scope.main",
      strategy: "spawn",
    })).toBe("");
  });

  test("sessionAliasAckSummary returns pointer copy for cardless sessions", () => {
    const snapshot = makeSnapshot({
      actors: {
        "session-mqvw7fgy-ineuic-extra": {
          id: "session-mqvw7fgy-ineuic-extra",
          kind: "session",
          displayName: "Project Chopin",
          handle: "project-chopin",
          metadata: { cardless: true, handle: "project-chopin" },
        },
      },
      endpoints: {
        "endpoint-1": {
          id: "endpoint-1",
          agentId: "session-mqvw7fgy-ineuic-extra",
          nodeId: "node.local",
          harness: "codex",
          transport: "codex_app_server",
          state: "idle",
          projectRoot: "/Users/art/dev/scope",
          cwd: "/Users/art/dev/scope",
          metadata: { cardless: true, handle: "project-chopin" },
        },
      },
    });
    expect(sessionAliasAckSummary({
      snapshot,
      actorId: "session-mqvw7fgy-ineuic-extra",
      strategy: "spawn",
    })).toBe(
      "alias project-chopin → session-mqvw…-extra (scope, codex) acknowledged via spawn.",
    );
  });

  test("sessionHandoffAckSummary prefers quiet sid copy", () => {
    const snapshot = makeSnapshot({
      actors: {
        "session-mqvw7fgy-ineuic-extra": {
          id: "session-mqvw7fgy-ineuic-extra",
          kind: "session",
          displayName: "Project Chopin",
          handle: "project-chopin",
          metadata: { cardless: true, handle: "project-chopin", sid: "0123456789abcdef" },
        },
      },
      endpoints: {
        "endpoint-1": {
          id: "endpoint-1",
          agentId: "session-mqvw7fgy-ineuic-extra",
          nodeId: "node.local",
          harness: "codex",
          transport: "codex_app_server",
          state: "idle",
          projectRoot: "/Users/art/dev/scope",
          cwd: "/Users/art/dev/scope",
          metadata: { cardless: true, handle: "project-chopin", sid: "0123456789abcdef" },
        },
      },
    });

    expect(sessionHandoffAckSummary({
      snapshot,
      actorId: "session-mqvw7fgy-ineuic-extra",
      strategy: "spawn",
    })).toBe("sid:0123456789abcdef acknowledged via spawn.");
  });

  test("projectPrefixedSessionAlias adds project- prefix when missing", () => {
    expect(projectPrefixedSessionAlias("chopin")).toBe("project-chopin");
    expect(projectPrefixedSessionAlias("project-chopin")).toBe("project-chopin");
    expect(projectPrefixedSessionAlias("@chopin")).toBe("project-chopin");
  });
});
