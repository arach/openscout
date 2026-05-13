import { describe, expect, test } from "bun:test";
import {
  createRangerAssistantService,
  RangerAssistantError,
} from "./ranger-assistant.ts";

function makeService(options: { activeLimit?: number } = {}) {
  let responseCount = 0;
  return createRangerAssistantService({
    currentDirectory: "/tmp/openscout",
    loadContext: () => ({ ok: true }),
    env: {
      OPENAI_API_KEY: "sk-test",
      ...(options.activeLimit ? { OPENSCOUT_RANGER_ACTIVE_SESSION_LIMIT: String(options.activeLimit) } : {}),
    } as NodeJS.ProcessEnv,
    fetchImpl: async () =>
      new Response(JSON.stringify({
        id: `resp_${responseCount += 1}`,
        output_text: `reply ${responseCount}`,
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
}

describe("createRangerAssistantService", () => {
  test("carries only the trailing active Ranger sessions by default", () => {
    const ranger = makeService({ activeLimit: 3 });

    for (let index = 0; index < 6; index += 1) {
      ranger.resetSession();
    }

    const state = ranger.getSessionState();
    expect(state.sessions).toHaveLength(3);
    expect(state.retention).toEqual({
      activeLimit: 3,
      archivedCount: 3,
      totalCount: 6,
    });
    expect(state.sessions.map((session) => session.id)).toContain(state.session.id);
  });

  test("archives a Ranger session on demand and removes it from the default list", () => {
    const ranger = makeService({ activeLimit: 4 });
    const first = ranger.resetSession().session.id;
    const second = ranger.resetSession().session.id;

    const state = ranger.archiveSession(first);

    expect(state.session.id).toBe(second);
    expect(state.sessions.map((session) => session.id)).not.toContain(first);
    expect(state.retention.archivedCount).toBe(1);
    expect(() => ranger.switchSession(first)).toThrow(RangerAssistantError);
  });

  test("keeps the active Ranger session when retention is enforced", async () => {
    const ranger = makeService({ activeLimit: 2 });
    const oldest = ranger.resetSession().session.id;
    ranger.resetSession();
    ranger.resetSession();

    expect(() => ranger.switchSession(oldest)).toThrow(RangerAssistantError);

    await ranger.respond({ body: "current status" });
    const state = ranger.getSessionState();

    expect(state.sessions).toHaveLength(2);
    expect(state.sessions.map((session) => session.id)).toContain(state.session.id);
  });
});
