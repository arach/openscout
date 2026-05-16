import { describe, expect, test } from "bun:test";

import type { Agent } from "./types.ts";
import {
  extractRangerUiActions,
  resolveRangerAgentId,
  stripRangerUiFences,
} from "./ranger.ts";

function agent(input: Partial<Agent> & { id: string }): Agent {
  return {
    id: input.id,
    name: input.name ?? input.id,
    handle: input.handle ?? null,
    agentClass: input.agentClass ?? "general",
    harness: input.harness ?? "codex",
    state: input.state ?? null,
    projectRoot: input.projectRoot ?? null,
    cwd: input.cwd ?? null,
    updatedAt: input.updatedAt ?? null,
    createdAt: input.createdAt ?? null,
    transport: input.transport ?? "codex_app_server",
    selector: input.selector ?? null,
    wakePolicy: input.wakePolicy ?? "on_demand",
    capabilities: input.capabilities ?? ["chat", "invoke", "deliver"],
    project: input.project ?? null,
    branch: input.branch ?? null,
    role: input.role ?? null,
    model: input.model ?? null,
    harnessSessionId: input.harnessSessionId ?? null,
    harnessLogPath: input.harnessLogPath ?? null,
    conversationId: input.conversationId ?? `dm.operator.${input.id}`,
    homeNodeId: input.homeNodeId ?? null,
    homeNodeName: input.homeNodeName ?? null,
    ownerId: input.ownerId ?? null,
    ownerName: input.ownerName ?? null,
    ownerHandle: input.ownerHandle ?? null,
  };
}

describe("extractRangerUiActions + stripRangerUiFences", () => {
  test("handles a scout-ui fence (strips + extracts)", () => {
    const body = [
      "Here you go.",
      "```scout-ui",
      '{"type":"navigate","route":{"view":"mesh"}}',
      "```",
    ].join("\n");

    expect(extractRangerUiActions(body)).toEqual([
      { type: "navigate", route: { view: "mesh" } },
    ]);
    expect(stripRangerUiFences(body)).toBe("Here you go.");
  });

  test("handles a json fence that carries a known action shape", () => {
    const body = [
      "Opening Ranger.",
      "```json",
      '{"action":"open-ranger"}',
      "```",
    ].join("\n");

    expect(extractRangerUiActions(body)).toEqual([{ type: "open-ranger" }]);
    expect(stripRangerUiFences(body)).toBe("Opening Ranger.");
  });

  test("leaves unrelated json fences in place", () => {
    const body = [
      "Sample payload:",
      "```json",
      '{"foo":"bar"}',
      "```",
    ].join("\n");

    expect(extractRangerUiActions(body)).toEqual([]);
    expect(stripRangerUiFences(body)).toBe(body.trim());
  });

  test("leaves non-json code fences alone", () => {
    const body = [
      "Quick example:",
      "```python",
      'print("hi")',
      "```",
    ].join("\n");

    expect(extractRangerUiActions(body)).toEqual([]);
    expect(stripRangerUiFences(body)).toBe(body.trim());
  });

  test("strips bare fences when payload is a recognized action", () => {
    const body = [
      "Refreshing.",
      "```",
      '{"action":"refresh"}',
      "```",
    ].join("\n");

    expect(extractRangerUiActions(body)).toEqual([{ type: "refresh" }]);
    expect(stripRangerUiFences(body)).toBe("Refreshing.");
  });

  test("handles two leaking action fences in one body", () => {
    const body = [
      "```json",
      '{"action":"open-ranger"}',
      "```",
      "Reply text.",
      "```json",
      '{"action":"navigate","view":"mesh"}',
      "```",
    ].join("\n");

    expect(extractRangerUiActions(body)).toEqual([
      { type: "open-ranger" },
      { type: "navigate", route: { view: "mesh" } },
    ]);
    expect(stripRangerUiFences(body)).toBe("Reply text.");
  });
});

describe("resolveRangerAgentId", () => {
  test("prefers an available Ranger over the stale default id", () => {
    const resolved = resolveRangerAgentId([
      agent({
        id: "ranger.main.mini",
        handle: "ranger",
        selector: "@ranger",
        state: "offline",
        updatedAt: 10,
      }),
      agent({
        id: "ranger.codex-vox-getting-started.mini",
        handle: "ranger",
        selector: "@ranger",
        state: "available",
        updatedAt: 20,
      }),
    ]);

    expect(resolved).toBe("ranger.codex-vox-getting-started.mini");
  });
});

describe("extractRangerUiActions", () => {
  test("normalizes ask-agent actions", () => {
    const actions = extractRangerUiActions([
      "I’ll ask Hudson.",
      "```scout-ui",
      JSON.stringify({
        type: "ask-agent",
        targetLabel: "hudson",
        body: "Can you inspect the broker handoff path?",
      }),
      "```",
    ].join("\n"));

    expect(actions).toEqual([
      {
        type: "ask-agent",
        targetLabel: "hudson",
        body: "Can you inspect the broker handoff path?",
      },
    ]);
  });
});
