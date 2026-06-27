import { describe, expect, test } from "bun:test";
import {
  mergeFollowTargets,
  routeForFollowTarget,
  tailQueryForFollowTarget,
} from "./follow-route.ts";

describe("follow route resolution", () => {
  test("keeps every follow handle in the tail query", () => {
    const target = {
      flightId: "flight-1",
      invocationId: "inv-1",
      conversationId: "conv-1",
      workId: "work-1",
      sessionId: "session-1",
      targetAgentId: "agent.main",
    };

    expect(tailQueryForFollowTarget(target)).toBe(
      "session-1|flight-1|inv-1|agent.main|conv-1|work-1",
    );
    expect(routeForFollowTarget(target, "tail")).toEqual({
      view: "ops",
      mode: "tail",
      tailQuery: "session-1|flight-1|inv-1|agent.main|conv-1|work-1",
      flightId: "flight-1",
      invocationId: "inv-1",
      conversationId: "conv-1",
      workId: "work-1",
      sessionId: "session-1",
      targetAgentId: "agent.main",
    });
  });

  test("dedupes and trims tail terms", () => {
    expect(tailQueryForFollowTarget({
      flightId: "flight-1",
      invocationId: " flight-1 ",
      conversationId: null,
      workId: null,
      sessionId: " ",
      targetAgentId: "agent.main",
    })).toBe("flight-1|agent.main");
  });

  test("defaults to observe when an agent is known", () => {
    expect(routeForFollowTarget({
      flightId: "flight-1",
      invocationId: "inv-1",
      conversationId: null,
      workId: null,
      sessionId: null,
      targetAgentId: "agent.main",
    }, undefined)).toEqual({
      view: "agents-v2",
      agentId: "agent.main",
      tab: "observe",
    });
  });

  test("defaults to concrete agent session observe when agent and session are known", () => {
    expect(routeForFollowTarget({
      flightId: "flight-1",
      invocationId: "inv-1",
      conversationId: null,
      workId: "work-1",
      sessionId: "session-1",
      targetAgentId: "agent.main",
    }, undefined)).toEqual({
      view: "sessions",
      agentId: "agent.main",
      sessionId: "session-1",
    });
  });

  test("falls back to a focused tail route when no primary surface exists", () => {
    expect(routeForFollowTarget({
      flightId: "flight-1",
      invocationId: "inv-1",
      conversationId: null,
      workId: null,
      sessionId: null,
      targetAgentId: null,
    }, undefined)).toEqual({
      view: "ops",
      mode: "tail",
      tailQuery: "flight-1|inv-1",
      flightId: "flight-1",
      invocationId: "inv-1",
    });
  });

  test("prefers concrete non-tail surfaces when requested", () => {
    const target = {
      flightId: "flight-1",
      invocationId: "inv-1",
      conversationId: "conv-1",
      workId: "work-1",
      sessionId: "session-1",
      targetAgentId: "agent.main",
    };

    expect(routeForFollowTarget(target, "session")).toEqual({
      view: "sessions",
      sessionId: "session-1",
    });
    expect(routeForFollowTarget(target, "chat")).toEqual({
      view: "conversation",
      conversationId: "conv-1",
    });
    expect(routeForFollowTarget(target, "work")).toEqual({
      view: "work",
      workId: "work-1",
    });
  });

  test("merges resolved follow context over route fallbacks", () => {
    expect(mergeFollowTargets({
      flightId: "flight-1",
      invocationId: null,
      conversationId: " ",
      workId: null,
      sessionId: "session-1",
      targetAgentId: null,
    }, {
      flightId: "fallback-flight",
      invocationId: "fallback-inv",
      conversationId: "fallback-conv",
      workId: "fallback-work",
      sessionId: "fallback-session",
      targetAgentId: "fallback-agent",
    })).toEqual({
      flightId: "flight-1",
      invocationId: "fallback-inv",
      conversationId: "fallback-conv",
      workId: "fallback-work",
      sessionId: "session-1",
      targetAgentId: "fallback-agent",
    });
  });
});
