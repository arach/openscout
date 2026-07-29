import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getScoutMobileRuntimeCapabilities, sendScoutMobileComms } from "./service.ts";

const originalEnvironment = {
  HOME: process.env.HOME,
  OPENSCOUT_HOME: process.env.OPENSCOUT_HOME,
  OPENSCOUT_SUPPORT_DIRECTORY: process.env.OPENSCOUT_SUPPORT_DIRECTORY,
  OPENSCOUT_CONTROL_HOME: process.env.OPENSCOUT_CONTROL_HOME,
  OPENSCOUT_BROKER_URL: process.env.OPENSCOUT_BROKER_URL,
  OPENSCOUT_BROKER_SOCKET_PATH: process.env.OPENSCOUT_BROKER_SOCKET_PATH,
};
const originalFetch = globalThis.fetch;
const testDirectories = new Set<string>();

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = originalFetch;
  for (const directory of testDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  testDirectories.clear();
});

function useIsolatedBroker(): void {
  const home = mkdtempSync(join(tmpdir(), "openscout-mobile-delivery-"));
  testDirectories.add(home);
  process.env.HOME = home;
  process.env.OPENSCOUT_HOME = join(home, ".openscout");
  process.env.OPENSCOUT_SUPPORT_DIRECTORY = join(home, "Library", "Application Support", "OpenScout");
  process.env.OPENSCOUT_CONTROL_HOME = join(home, ".openscout", "control-plane");
  process.env.OPENSCOUT_BROKER_URL = "http://broker.test";
  process.env.OPENSCOUT_BROKER_SOCKET_PATH = join(home, "broker.sock");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("sendScoutMobileComms", () => {
  test("persists a draft and returns structured recovery when an exact session ended", async () => {
    useIsolatedBroker();
    const conversationId = "chn-ended-session";
    const targetAgentId = "session-ended";
    const clientMessageId = "ios-draft-1";
    const requests: Array<{ path: string; body: Record<string, unknown> | null }> = [];

    globalThis.fetch = (async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      const body = request.method === "POST"
        ? await request.json() as Record<string, unknown>
        : null;
      requests.push({ path: url.pathname, body });

      if (url.pathname === "/health") {
        return jsonResponse({ ok: true, nodeId: "node-1", meshId: "mesh-1" });
      }
      if (url.pathname === "/v1/node") {
        return jsonResponse({ id: "node-1" });
      }
      if (url.pathname === "/v1/snapshot") {
        return jsonResponse({
          actors: {
            operator: { id: "operator", kind: "person", displayName: "You" },
            [targetAgentId]: { id: targetAgentId, kind: "agent", displayName: "Ended session" },
          },
          agents: {
            [targetAgentId]: { id: targetAgentId, kind: "agent", displayName: "Ended session" },
          },
          endpoints: {
            "endpoint-ended": {
              id: "endpoint-ended",
              agentId: targetAgentId,
              nodeId: "node-1",
              harness: "kimi",
              transport: "kimi_acp",
              state: "offline",
            },
          },
          conversations: {
            [conversationId]: {
              id: conversationId,
              kind: "direct",
              title: "Ended session",
              visibility: "private",
              shareMode: "local",
              authorityNodeId: "node-1",
              participantIds: ["operator", targetAgentId],
            },
          },
          messages: {},
          flights: {},
        });
      }
      if (url.pathname === "/v1/deliver") {
        return jsonResponse({
          kind: "question",
          accepted: false,
          question: {
            detail: "Session session-ended is no longer attachable (endpoint offline).",
          },
          remediation: {
            kind: "session_reference_not_attachable",
            detail: "Start a replacement session.",
          },
        }, 409);
      }
      if (url.pathname === "/v1/messages") {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ error: "unexpected request" }, 404);
    }) as unknown as typeof fetch;

    const result = await sendScoutMobileComms({
      conversationId,
      body: "What happened?",
      clientMessageId,
    });

    expect(result).toMatchObject({
      conversationId,
      targetAgentId,
      lifecycleState: "failed",
      error: null,
      delivery: {
        state: "recoverable",
        reason: "session_ended",
        action: "start_replacement",
      },
    });
    expect(result.delivery?.detail).not.toContain(targetAgentId);
    expect(requests.find((request) => request.path === "/v1/messages")?.body)
      .toMatchObject({
        conversationId,
        actorId: "operator",
        body: "What happened?",
        metadata: expect.objectContaining({ clientMessageId }),
      });
  });
});

test("mobile runtime capabilities expose the versioned legal tuple catalog", async () => {
  const catalog = await getScoutMobileRuntimeCapabilities();
  expect(catalog.schemaVersion).toBe("openscout.runtime-capabilities.v1");
  expect(catalog.harnesses.map((harness) => harness.id)).toContain("codex");
  expect(catalog.models.some((model) => (
    model.id === "gpt-5.6-sol" && model.harnesses.includes("codex")
  ))).toBe(true);
  expect(catalog.efforts.find((effort) => effort.id === "ultra")?.harnesses).toEqual(["codex"]);
});
