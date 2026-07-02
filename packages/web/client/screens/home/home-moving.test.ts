import { describe, expect, test } from "bun:test";

import type { Agent, FleetAsk, TailEvent } from "../../lib/types.ts";
import {
  agentHasRecentTailActivity,
  buildHomeNativeMovingLanes,
  harnessTailSource,
  HOME_MOVING_CARD_LIMIT,
  HOME_MOVING_WINDOW_MS,
  homeMovingDisplayCounts,
  isHomeAgentMoving,
  isHomeObserveCandidate,
} from "./home-moving.ts";

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    name: "codex.main",
    state: "available",
    harness: "codex",
    project: "openscout",
    cwd: "/Users/dev/openscout",
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("harnessTailSource", () => {
  test("maps grok harness variants to grok tail source", () => {
    expect(harnessTailSource("grok-acp")).toBe("grok");
    expect(harnessTailSource("pi")).toBe("grok");
    expect(harnessTailSource("codex")).toBe("codex");
  });
});

describe("homeMovingDisplayCounts", () => {
  test("caps the rendered home cards across all moving buckets", () => {
    expect(
      homeMovingDisplayCounts({
        working: 2,
        native: 6,
        observed: 6,
      }),
    ).toEqual({
      working: 2,
      native: 6,
      observed: 1,
      cardCount: HOME_MOVING_CARD_LIMIT,
      totalCount: 14,
    });
  });

  test("prioritizes managed working agents over native and observed actors", () => {
    expect(
      homeMovingDisplayCounts({
        working: 12,
        native: 8,
        observed: 3,
        movingAsks: 2,
      }),
    ).toEqual({
      working: HOME_MOVING_CARD_LIMIT,
      native: 0,
      observed: 0,
      cardCount: HOME_MOVING_CARD_LIMIT,
      totalCount: 25,
    });
  });

  test("counts moving ask rows even when there are no moving cards", () => {
    expect(homeMovingDisplayCounts({ working: 0, native: 0, observed: 0, movingAsks: 2 }))
      .toEqual({
        working: 0,
        native: 0,
        observed: 0,
        cardCount: 0,
        totalCount: 2,
      });
  });
});

describe("isHomeObserveCandidate", () => {
  test("includes agents with harness sessions", () => {
    expect(
      isHomeObserveCandidate(
        agent({ harnessSessionId: "session-abc.jsonl" }),
        Date.now(),
        false,
      ),
    ).toBe(true);
  });

  test("includes agents with moving asks", () => {
    expect(isHomeObserveCandidate(agent(), Date.now(), true)).toBe(true);
  });

  test("includes grok-acp agents with recent grok tail activity", () => {
    const nowMs = Date.parse("2026-06-30T12:00:00.000Z");
    const tailEvents: TailEvent[] = [{
      id: "tail-grok",
      ts: nowMs - 20_000,
      kind: "tool",
      source: "grok",
      harness: "unattributed",
      project: "openscout",
      cwd: "/Users/dev/openscout",
      sessionId: "sess-grok",
      summary: "Grep · home-moving",
    }];

    expect(
      isHomeObserveCandidate(
        agent({ harness: "grok-acp", harnessSessionId: "sess-grok" }),
        nowMs,
        false,
        tailEvents,
      ),
    ).toBe(true);
  });
});

describe("isHomeAgentMoving", () => {
  const nowMs = Date.parse("2026-06-30T12:00:00.000Z");

  test("shows agents with live observe work even when broker state is callable", () => {
    expect(
      isHomeAgentMoving({
        agent: agent({ state: "available" }),
        observeEntry: {
          source: "live",
          fidelity: "timestamped",
          historyPath: null,
          sessionId: "sess-1",
          updatedAt: nowMs,
          data: {
            live: true,
            events: [{
              id: "evt-1",
              t: 0,
              kind: "tool",
              text: "read file",
              live: true,
            }],
          },
        },
        tailEvents: [],
        nowMs,
      }),
    ).toBe(true);
  });

  test("shows agents with recent tail activity for their workspace", () => {
    const tailEvents: TailEvent[] = [{
      id: "tail-1",
      ts: nowMs - 60_000,
      kind: "tool-call",
      source: "codex",
      harness: "codex",
      project: "openscout",
      cwd: "/Users/dev/openscout",
      sessionId: "sess-1",
      summary: "grep home-moving",
    }];

    expect(
      isHomeAgentMoving({
        agent: agent({ state: "available" }),
        tailEvents,
        nowMs,
      }),
    ).toBe(true);
  });

  test("hides idle callable agents without observe or tail signal", () => {
    expect(
      isHomeAgentMoving({
        agent: agent({
          state: "available",
          updatedAt: nowMs - HOME_MOVING_WINDOW_MS - 1,
        }),
        tailEvents: [],
        nowMs,
      }),
    ).toBe(false);
  });

  test("shows agents with fresh moving asks", () => {
    const movingAsk: FleetAsk = {
      invocationId: "inv-1",
      agentId: "agent-1",
      status: "working",
      updatedAt: nowMs - 5_000,
    };

    expect(
      isHomeAgentMoving({
        agent: agent({ state: "available" }),
        tailEvents: [],
        nowMs,
        movingAsk,
      }),
    ).toBe(true);
  });
});

describe("agentHasRecentTailActivity", () => {
  test("matches project and cwd context for the same harness family", () => {
    const nowMs = Date.parse("2026-06-30T12:00:00.000Z");
    const events: TailEvent[] = [{
      id: "tail-1",
      ts: nowMs - 30_000,
      kind: "message",
      source: "codex",
      harness: "codex",
      project: "openscout",
      cwd: "/Users/dev/openscout",
      sessionId: "other-session",
      summary: "working",
    }];

    expect(
      agentHasRecentTailActivity(agent({ harness: "codex" }), events, nowMs),
    ).toBe(true);
  });

  test("ignores tail events when the agent harness is unknown", () => {
    const nowMs = Date.parse("2026-06-30T12:00:00.000Z");
    const events: TailEvent[] = [{
      id: "tail-grok",
      ts: nowMs - 20_000,
      kind: "tool",
      source: "grok",
      harness: "unattributed",
      project: "openscout",
      cwd: "/Users/dev/openscout",
      sessionId: "sess-grok",
      summary: "Shell · curl",
    }];

    expect(agentHasRecentTailActivity(agent({ harness: null }), events, nowMs)).toBe(false);
  });

  test("does not match unrelated harnesses sharing the same workspace", () => {
    const nowMs = Date.parse("2026-06-30T12:00:00.000Z");
    const events: TailEvent[] = [{
      id: "tail-grok",
      ts: nowMs - 20_000,
      kind: "tool",
      source: "grok",
      harness: "unattributed",
      project: "openscout",
      cwd: "/Users/dev/openscout",
      sessionId: "sess-grok",
      summary: "Shell · curl",
    }];

    expect(
      agentHasRecentTailActivity(agent({ harness: "claude" }), events, nowMs),
    ).toBe(false);
  });

  test("matches grok tail events to grok-acp scout agents by session id", () => {
    const nowMs = Date.parse("2026-06-30T12:00:00.000Z");
    const events: TailEvent[] = [{
      id: "tail-grok",
      ts: nowMs - 15_000,
      kind: "tool",
      source: "grok",
      harness: "scout-managed",
      project: "openscout",
      cwd: "/Users/dev/openscout",
      sessionId: "sess-grok",
      summary: "Read · home-moving.ts",
    }];

    expect(
      agentHasRecentTailActivity(
        agent({ harness: "grok-acp", harnessSessionId: "sess-grok" }),
        events,
        nowMs,
      ),
    ).toBe(true);
  });
});

describe("buildHomeNativeMovingLanes", () => {
  const nowMs = Date.parse("2026-06-30T12:00:00.000Z");

  test("includes native grok sessions with substantive tool activity", () => {
    const lanes = buildHomeNativeMovingLanes({
      agents: [],
      tailEvents: [{
        id: "tail-grok",
        ts: nowMs - 10_000,
        kind: "tool",
        source: "grok",
        harness: "unattributed",
        project: "openscout",
        cwd: "/Users/dev/openscout",
        sessionId: "sess-grok",
        summary: "Grep · pattern",
      }],
      transcripts: [{
        source: "grok",
        transcriptPath: "/Users/art/.grok/sessions/openscout/sess-grok/events.jsonl",
        sessionId: "sess-grok",
        cwd: "/Users/dev/openscout",
        project: "openscout",
        harness: "unattributed",
        mtimeMs: nowMs - 20_000,
        size: 1200,
      }],
      nowMs,
    });

    expect(lanes).toHaveLength(1);
    expect(lanes[0]?.agent.harness).toBe("grok");
    expect(lanes[0]?.source).toBe("native");
  });

  test("excludes native grok sessions with only streaming phase noise", () => {
    const lanes = buildHomeNativeMovingLanes({
      agents: [],
      tailEvents: [{
        id: "tail-grok-noise",
        ts: nowMs - 10_000,
        kind: "system",
        source: "grok",
        harness: "unattributed",
        project: "openscout",
        cwd: "/Users/dev/openscout",
        sessionId: "sess-grok",
        summary: "phase · streaming_reasoning",
      }],
      transcripts: [{
        source: "grok",
        transcriptPath: "/Users/art/.grok/sessions/openscout/sess-grok/events.jsonl",
        sessionId: "sess-grok",
        cwd: "/Users/dev/openscout",
        project: "openscout",
        harness: "unattributed",
        mtimeMs: nowMs - 20_000,
        size: 1200,
      }],
      nowMs,
    });

    expect(lanes).toHaveLength(0);
  });
});
