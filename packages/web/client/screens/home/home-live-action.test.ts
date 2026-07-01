import { describe, expect, test } from "bun:test";

import type { Agent, ObserveData } from "../../lib/types.ts";
import {
  homeCardPeekEnabled,
  homeCardRoute,
  liveActionSummary,
} from "./home-live-action.ts";

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

describe("liveActionSummary", () => {
  test("prefers checkpoint over observe events", () => {
    const observeData: ObserveData = {
      events: [{ kind: "tool", tool: "Read", arg: "content.tsx" }],
      files: [],
    };
    expect(
      liveActionSummary({
        checkpoint: "Indexing home surface",
        observeData,
      }),
    ).toBe("Indexing home surface");
  });

  test("uses latest meaningful observe event", () => {
    const observeData: ObserveData = {
      events: [
        { kind: "system", text: "session started" },
        { kind: "tool", tool: "Grep", arg: "home-moving" },
      ],
      files: [],
    };
    expect(liveActionSummary({ observeData })).toBe("Grep · home-moving");
  });

  test("falls back to task when live", () => {
    expect(
      liveActionSummary({
        fallbackTask: "Home layout pass",
        observeLive: true,
      }),
    ).toBe("Home layout pass");
  });
});

describe("homeCardRoute", () => {
  test("routes managed agents to profile, observe, and peek", () => {
    const managed = agent({ id: "managed-1" });
    expect(homeCardRoute(managed, "profile")).toEqual({
      view: "agents-v2",
      agentId: "managed-1",
      tab: "profile",
    });
    expect(homeCardRoute(managed, "observe")).toEqual({
      view: "agents-v2",
      agentId: "managed-1",
      tab: "observe",
    });
    expect(homeCardRoute(managed, "peek")).toEqual({
      view: "agents-v2",
      selectedAgentId: "managed-1",
    });
  });

  test("routes synthetic agents to sessions when possible", () => {
    const synthetic = agent({
      id: "native:grok:019f1b71-e561-7c62-a028-c3f977c41b25",
      harnessSessionId: "019f1b71-e561-7c62-a028-c3f977c41b25",
    });
    expect(homeCardRoute(synthetic, "observe")).toEqual({
      view: "sessions",
      sessionId: "019f1b71-e561-7c62-a028-c3f977c41b25",
    });
  });
});

describe("homeCardPeekEnabled", () => {
  test("enabled when tmux surface or harness session exists", () => {
    expect(
      homeCardPeekEnabled(agent({
        terminalSurface: { backend: "tmux", sessionId: "scout-1" },
      })),
    ).toBe(true);
    expect(homeCardPeekEnabled(agent({ harnessSessionId: "sess-1" }))).toBe(true);
    expect(homeCardPeekEnabled(agent())).toBe(false);
  });
});