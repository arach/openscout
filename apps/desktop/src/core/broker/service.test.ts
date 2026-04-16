import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeOpenScoutSettings } from "@openscout/runtime/setup";

import { askScoutQuestion } from "./service.ts";

const originalHome = process.env.HOME;
const originalSupportDirectory = process.env.OPENSCOUT_SUPPORT_DIRECTORY;
const originalControlHome = process.env.OPENSCOUT_CONTROL_HOME;
const originalRelayHub = process.env.OPENSCOUT_RELAY_HUB;
const originalBrokerUrl = process.env.OPENSCOUT_BROKER_URL;
const originalSkipUserProjectHints = process.env.OPENSCOUT_SKIP_USER_PROJECT_HINTS;
const originalFetch = globalThis.fetch;
const testDirectories = new Set<string>();

afterEach(() => {
  process.env.HOME = originalHome;
  if (originalSupportDirectory === undefined) {
    delete process.env.OPENSCOUT_SUPPORT_DIRECTORY;
  } else {
    process.env.OPENSCOUT_SUPPORT_DIRECTORY = originalSupportDirectory;
  }
  if (originalControlHome === undefined) {
    delete process.env.OPENSCOUT_CONTROL_HOME;
  } else {
    process.env.OPENSCOUT_CONTROL_HOME = originalControlHome;
  }
  if (originalRelayHub === undefined) {
    delete process.env.OPENSCOUT_RELAY_HUB;
  } else {
    process.env.OPENSCOUT_RELAY_HUB = originalRelayHub;
  }
  if (originalBrokerUrl === undefined) {
    delete process.env.OPENSCOUT_BROKER_URL;
  } else {
    process.env.OPENSCOUT_BROKER_URL = originalBrokerUrl;
  }
  if (originalSkipUserProjectHints === undefined) {
    delete process.env.OPENSCOUT_SKIP_USER_PROJECT_HINTS;
  } else {
    process.env.OPENSCOUT_SKIP_USER_PROJECT_HINTS = originalSkipUserProjectHints;
  }
  globalThis.fetch = originalFetch;
  for (const directory of testDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  testDirectories.clear();
});

function useIsolatedOpenScoutHome(): string {
  const home = mkdtempSync(join(tmpdir(), "openscout-desktop-broker-"));
  testDirectories.add(home);
  process.env.HOME = home;
  process.env.OPENSCOUT_SUPPORT_DIRECTORY = join(home, "Library", "Application Support", "OpenScout");
  process.env.OPENSCOUT_CONTROL_HOME = join(home, ".openscout", "control-plane");
  process.env.OPENSCOUT_RELAY_HUB = join(home, ".openscout", "relay");
  process.env.OPENSCOUT_BROKER_URL = "http://broker.test";
  process.env.OPENSCOUT_SKIP_USER_PROJECT_HINTS = "1";
  return home;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

describe("askScoutQuestion", () => {
  test("registers discovered targets and lets the broker wake them on demand", async () => {
    const home = useIsolatedOpenScoutHome();
    const workspaceRoot = join(home, "dev");
    const talkieRoot = join(workspaceRoot, "talkie");

    mkdirSync(join(talkieRoot, ".git"), { recursive: true });
    writeFileSync(join(talkieRoot, "AGENTS.md"), "# talkie\n", "utf8");

    await writeOpenScoutSettings({
      discovery: {
        workspaceRoots: [workspaceRoot],
        includeCurrentRepo: false,
      },
    });

    const requests: Array<{ method: string; path: string }> = [];
    globalThis.fetch = (async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      requests.push({ method: request.method, path: url.pathname });

      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse({ ok: true, nodeId: "node-1", meshId: "mesh-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/node") {
        return jsonResponse({ id: "node-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/snapshot") {
        return jsonResponse({
          actors: {},
          agents: {},
          endpoints: {},
          conversations: {},
          messages: {},
          flights: {},
        });
      }
      if (request.method === "POST" && url.pathname === "/v1/actors") {
        return jsonResponse({ ok: true });
      }
      if (request.method === "POST" && url.pathname === "/v1/agents") {
        return jsonResponse({ ok: true });
      }
      if (request.method === "POST" && url.pathname === "/v1/messages") {
        return jsonResponse({ ok: true });
      }
      if (request.method === "POST" && url.pathname === "/v1/conversations") {
        return jsonResponse({ ok: true });
      }
      if (request.method === "POST" && url.pathname === "/v1/invocations") {
        const body = await request.json() as { id: string; requesterId: string; targetAgentId: string };
        return jsonResponse({
          ok: true,
          flight: {
            id: "flt-1",
            invocationId: body.id,
            requesterId: body.requesterId,
            targetAgentId: body.targetAgentId,
            state: "waking",
            summary: "Talkie waking.",
            startedAt: Date.now(),
          },
        });
      }

      return jsonResponse({ error: "not found" }, 404);
    }) as typeof fetch;

    const result = await askScoutQuestion({
      senderId: "operator",
      targetLabel: "talkie",
      body: "build it for me",
      currentDirectory: workspaceRoot,
    });

    expect(result.usedBroker).toBe(true);
    expect(result.flight?.id).toBe("flt-1");
    expect(result.flight?.state).toBe("waking");
    expect(result.unresolvedTarget).toBeUndefined();
    expect(result.targetDiagnostic).toBeUndefined();
    expect(requests.some((request) => request.path === "/v1/agents")).toBe(true);
    expect(requests.some((request) => request.path === "/v1/messages")).toBe(true);
    expect(requests.some((request) => request.path === "/v1/invocations")).toBe(true);
    expect(requests.some((request) => request.path === "/v1/endpoints")).toBe(false);
  }, 15000);

  test("returns an ambiguous diagnostic when @name matches multiple agents", async () => {
    useIsolatedOpenScoutHome();

    const voxCodexAgent = {
      id: "vox.mini.codex",
      kind: "agent",
      definitionId: "vox",
      displayName: "Vox (codex)",
      handle: "vox",
      agentClass: "general",
      capabilities: ["chat"],
      wakePolicy: "on_demand",
      homeNodeId: "node-1",
      authorityNodeId: "node-1",
      advertiseScope: "local",
      metadata: {
        definitionId: "vox",
        nodeQualifier: "mini",
      },
    };
    const voxClaudeAgent = {
      id: "vox.mini.claude",
      kind: "agent",
      definitionId: "vox",
      displayName: "Vox (claude)",
      handle: "vox",
      agentClass: "general",
      capabilities: ["chat"],
      wakePolicy: "on_demand",
      homeNodeId: "node-1",
      authorityNodeId: "node-1",
      advertiseScope: "local",
      metadata: {
        definitionId: "vox",
        nodeQualifier: "mini",
      },
    };
    const voxCodexEndpoint = {
      id: "ep-vox-codex",
      agentId: "vox.mini.codex",
      nodeId: "node-1",
      harness: "codex",
      transport: "local_socket",
      state: "active",
    };
    const voxClaudeEndpoint = {
      id: "ep-vox-claude",
      agentId: "vox.mini.claude",
      nodeId: "node-1",
      harness: "claude",
      transport: "local_socket",
      state: "active",
    };

    globalThis.fetch = (async (input, init) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse({ ok: true, nodeId: "node-1", meshId: "mesh-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/node") {
        return jsonResponse({ id: "node-1" });
      }
      if (request.method === "GET" && url.pathname === "/v1/snapshot") {
        return jsonResponse({
          actors: {},
          agents: {
            [voxCodexAgent.id]: voxCodexAgent,
            [voxClaudeAgent.id]: voxClaudeAgent,
          },
          endpoints: {
            [voxCodexEndpoint.id]: voxCodexEndpoint,
            [voxClaudeEndpoint.id]: voxClaudeEndpoint,
          },
          conversations: {},
          messages: {},
          flights: {},
        });
      }
      if (request.method === "POST") {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ error: "not found" }, 404);
    }) as typeof fetch;

    const result = await askScoutQuestion({
      senderId: "operator",
      targetLabel: "vox",
      body: "are you there?",
      currentDirectory: process.cwd(),
    });

    expect(result.usedBroker).toBe(true);
    expect(result.flight).toBeUndefined();
    expect(result.unresolvedTarget).toBe("vox");
    expect(result.targetDiagnostic?.state).toBe("ambiguous");
    if (result.targetDiagnostic?.state === "ambiguous") {
      const ids = result.targetDiagnostic.candidates.map((candidate) => candidate.agentId).sort();
      expect(ids).toEqual(["vox.mini.claude", "vox.mini.codex"]);
      const labels = result.targetDiagnostic.candidates.map((candidate) => candidate.label).sort();
      expect(labels).toEqual(["@vox.harness:claude", "@vox.harness:codex"]);
    }
  }, 15000);
});
