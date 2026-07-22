import { afterEach, describe, expect, test } from "bun:test";

import type { Agent } from "./types.ts";
import {
  harnessFromAdapterType,
  invokeSession,
  resumeAgentSession,
  startAgentSession,
} from "./session-start.ts";

const agent = {
  id: "agent:openscout",
  name: "OpenScout",
  harness: "codex",
  model: "gpt-5",
  projectRoot: "/work/openscout",
  cwd: "/work/openscout",
} as Agent;

describe("startAgentSession", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("seeds a new session with its capture instead of sending to an unindexed chat", async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        path: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(JSON.stringify({
        conversationId: "chat:new",
        agentId: agent.id,
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await startAgentSession(agent, {
      instructions: "Inspect this screenshot",
      attachments: [{
        url: "http://localhost:43122/api/blobs/capture-1",
        mediaType: "image/png",
        fileName: "capture.png",
      }],
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      path: "/api/sessions",
      body: {
        target: {
          agentId: agent.id,
          projectPath: "/work/openscout",
        },
        execution: {
          session: "new",
          harness: "codex",
          model: "gpt-5",
        },
        seed: {
          instructions: "Inspect this screenshot",
          attachments: [{
            url: "http://localhost:43122/api/blobs/capture-1",
            mediaType: "image/png",
            fileName: "capture.png",
          }],
        },
      },
    });
  });

  test("resumes an observed harness session when no conversation is attached", async () => {
    let requestBody: unknown = null;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) : null;
      return new Response(JSON.stringify({
        conversationId: "chat:resumed",
        agentId: agent.id,
        sessionId: "harness-session-1",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const result = await resumeAgentSession({
      agentId: agent.id,
      sessionId: "harness-session-1",
      instructions: "Review PR 369 and merge it if it is ready.",
    });

    expect(requestBody).toEqual({
      target: { agentId: agent.id },
      execution: {
        session: "existing",
        targetSessionId: "harness-session-1",
      },
      seed: {
        instructions: "Review PR 369 and merge it if it is ready.",
      },
    });
    expect(result.conversationId).toBe("chat:resumed");
  });

  test("invokes a bare observed session using its own execution metadata", async () => {
    let requestBody: unknown = null;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) : null;
      return new Response(JSON.stringify({
        conversationId: "chat:invoked",
        agentId: "agent:minted",
        sessionId: "harness-session-1",
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    await invokeSession({
      projectPath: "/work/openscout",
      sessionId: "harness-session-1",
      harness: "claude",
      model: "opus",
      reasoningEffort: "high",
      instructions: "Continue the implementation.",
    });

    expect(requestBody).toEqual({
      target: { projectPath: "/work/openscout" },
      execution: {
        session: "existing",
        targetSessionId: "harness-session-1",
        harness: "claude",
        model: "opus",
        reasoningEffort: "high",
      },
      seed: { instructions: "Continue the implementation." },
    });
  });

  test("maps transcript adapter types only to known broker harnesses", () => {
    expect(harnessFromAdapterType("claude-code")).toBe("claude");
    expect(harnessFromAdapterType("CODEX_APP_SERVER")).toBe("codex");
    expect(harnessFromAdapterType("unknown-adapter")).toBeUndefined();
  });
});
