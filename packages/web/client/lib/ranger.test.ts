import { describe, expect, test } from "bun:test";

import type { Agent } from "./types.ts";
import { resolveRangerAgentId } from "./ranger.ts";

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
  };
}

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
