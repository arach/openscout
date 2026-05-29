import { describe, expect, test } from "bun:test";
import {
  createScoutbotAssistantService,
  ScoutbotAssistantError,
} from "./scoutbot-assistant.ts";

function makeService(options: { activeLimit?: number } = {}) {
  let responseCount = 0;
  return createScoutbotAssistantService({
    currentDirectory: "/tmp/openscout",
    loadContext: () => ({ ok: true }),
    env: {
      OPENAI_API_KEY: "sk-test",
      ...(options.activeLimit ? { OPENSCOUT_SCOUTBOT_ACTIVE_SESSION_LIMIT: String(options.activeLimit) } : {}),
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

describe("createScoutbotAssistantService", () => {
  test("carries only the trailing active Scoutbot sessions by default", () => {
    const scoutbot = makeService({ activeLimit: 3 });

    for (let index = 0; index < 6; index += 1) {
      scoutbot.resetSession();
    }

    const state = scoutbot.getSessionState();
    expect(state.sessions).toHaveLength(3);
    expect(state.retention).toEqual({
      activeLimit: 3,
      archivedCount: 3,
      totalCount: 6,
    });
    expect(state.sessions.map((session) => session.id)).toContain(state.session.id);
  });

  test("archives a Scoutbot session on demand and removes it from the default list", () => {
    const scoutbot = makeService({ activeLimit: 4 });
    const first = scoutbot.resetSession().session.id;
    const second = scoutbot.resetSession().session.id;

    const state = scoutbot.archiveSession(first);

    expect(state.session.id).toBe(second);
    expect(state.sessions.map((session) => session.id)).not.toContain(first);
    expect(state.retention.archivedCount).toBe(1);
    expect(() => scoutbot.switchSession(first)).toThrow(ScoutbotAssistantError);
  });

  test("keeps the active Scoutbot session when retention is enforced", async () => {
    const scoutbot = makeService({ activeLimit: 2 });
    const oldest = scoutbot.resetSession().session.id;
    scoutbot.resetSession();
    scoutbot.resetSession();

    expect(() => scoutbot.switchSession(oldest)).toThrow(ScoutbotAssistantError);

    await scoutbot.respond({ body: "current status" });
    const state = scoutbot.getSessionState();

    expect(state.sessions).toHaveLength(2);
    expect(state.sessions.map((session) => session.id)).toContain(state.session.id);
  });
});
