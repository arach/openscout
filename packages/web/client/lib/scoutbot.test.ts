import { describe, expect, test } from "bun:test";

import type { Agent } from "./types.ts";
import {
  extractScoutbotUiActions,
  resolveScoutbotAgentId,
  stripScoutbotUiFences,
} from "./scoutbot.ts";

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

describe("extractScoutbotUiActions + stripScoutbotUiFences", () => {
  test("handles a scout-ui fence (strips + extracts)", () => {
    const body = [
      "Here you go.",
      "```scout-ui",
      '{"type":"navigate","route":{"view":"mesh"}}',
      "```",
    ].join("\n");

    expect(extractScoutbotUiActions(body)).toEqual([
      { type: "navigate", route: { view: "mesh" } },
    ]);
    expect(stripScoutbotUiFences(body)).toBe("Here you go.");
  });

  test("handles a json fence that carries a known action shape", () => {
    const body = [
      "Opening Scoutbot.",
      "```json",
      '{"action":"open-scoutbot"}',
      "```",
    ].join("\n");

    expect(extractScoutbotUiActions(body)).toEqual([{ type: "open-scoutbot" }]);
    expect(stripScoutbotUiFences(body)).toBe("Opening Scoutbot.");
  });

  test("leaves unrelated json fences in place", () => {
    const body = [
      "Sample payload:",
      "```json",
      '{"foo":"bar"}',
      "```",
    ].join("\n");

    expect(extractScoutbotUiActions(body)).toEqual([]);
    expect(stripScoutbotUiFences(body)).toBe(body.trim());
  });

  test("leaves non-json code fences alone", () => {
    const body = [
      "Quick example:",
      "```python",
      'print("hi")',
      "```",
    ].join("\n");

    expect(extractScoutbotUiActions(body)).toEqual([]);
    expect(stripScoutbotUiFences(body)).toBe(body.trim());
  });

  test("strips bare fences when payload is a recognized action", () => {
    const body = [
      "Refreshing.",
      "```",
      '{"action":"refresh"}',
      "```",
    ].join("\n");

    expect(extractScoutbotUiActions(body)).toEqual([{ type: "refresh" }]);
    expect(stripScoutbotUiFences(body)).toBe("Refreshing.");
  });

  test("handles two leaking action fences in one body", () => {
    const body = [
      "```json",
      '{"action":"open-scoutbot"}',
      "```",
      "Reply text.",
      "```json",
      '{"action":"navigate","view":"mesh"}',
      "```",
    ].join("\n");

    expect(extractScoutbotUiActions(body)).toEqual([
      { type: "open-scoutbot" },
      { type: "navigate", route: { view: "mesh" } },
    ]);
    expect(stripScoutbotUiFences(body)).toBe("Reply text.");
  });
});

describe("resolveScoutbotAgentId", () => {
  test("prefers an available Scoutbot over the stale default id", () => {
    const resolved = resolveScoutbotAgentId([
      agent({
        id: "scoutbot.main.mini",
        handle: "scoutbot",
        selector: "@scoutbot",
        state: "offline",
        updatedAt: 10,
      }),
      agent({
        id: "scoutbot.codex-vox-getting-started.mini",
        handle: "scoutbot",
        selector: "@scoutbot",
        state: "available",
        updatedAt: 20,
      }),
    ]);

    expect(resolved).toBe("scoutbot.codex-vox-getting-started.mini");
  });
});

describe("extractScoutbotUiActions", () => {
  test("normalizes ask-agent actions", () => {
    const actions = extractScoutbotUiActions([
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
