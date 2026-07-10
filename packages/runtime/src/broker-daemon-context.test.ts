import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ContextBlock, ContextPack } from "@openscout/protocol";

import { createBrokerDaemonTestHarness } from "./test-helpers/broker-daemon-harness.test";

const broker = createBrokerDaemonTestHarness();

function contextBlock(): ContextBlock {
  return {
    schemaVersion: "openscout.context-block.v1",
    id: "memory-context-route-1",
    kind: "memory",
    memoryKind: "decision",
    title: "Preserve observation ownership",
    body: "Harness sessions remain observed evidence rather than Scout messages.",
    scope: { kind: "workspace", id: "/repo" },
    projectionMode: "inline",
    mutability: "broker_writable",
    state: "active",
    createdById: "operator",
    sourceRefs: [{
      kind: "session_observation",
      ref: "session:codex:thread-1",
      digest: "sha256:source",
      observedAt: 100,
    }],
    confidence: 0.95,
    version: 1,
    contentHash: "memory-content-hash",
    createdAt: 100,
    updatedAt: 100,
  };
}

function contextPack(): ContextPack {
  return {
    schemaVersion: "openscout.context-pack.v1",
    id: "context-pack-route-1",
    title: "Continue implementation",
    purpose: "Continue implementation",
    target: { projectPath: "/repo", harness: "codex", sessionPolicy: "fork" },
    sections: [{
      id: "task-frame",
      kind: "task_frame",
      title: "Task",
      body: "Continue implementation",
      estimatedTokens: 4,
    }],
    contextBlockIds: ["memory-context-route-1"],
    sourceRefs: [{ kind: "context_block", ref: "memory-context-route-1" }],
    budget: { maxTokens: 100, estimatedTokens: 4, truncated: false },
    limitations: [],
    contentHash: "pack-content-hash",
    createdById: "operator",
    createdAt: 110,
  };
}

describe("broker daemon context routes", () => {
  test("journals, projects, filters, and replays constructive context", async () => {
    const controlHome = mkdtempSync(join(tmpdir(), "openscout-runtime-test-"));
    const first = await broker.startBroker({ controlHome });
    const block = contextBlock();
    const pack = contextPack();

    await expect(broker.postJson(first.baseUrl, "/v1/context/blocks", block))
      .resolves.toEqual({ ok: true, contextBlockId: block.id });
    await expect(broker.postJson(first.baseUrl, "/v1/context/packs", pack))
      .resolves.toEqual({ ok: true, contextPackId: pack.id });

    expect(await broker.getJson<ContextBlock[]>(
      first.baseUrl,
      "/v1/context/blocks?state=active&scopeKind=workspace&scopeId=%2Frepo",
    )).toEqual([block]);
    expect(await broker.getJson<ContextPack[]>(
      first.baseUrl,
      "/v1/context/packs?harness=codex",
    )).toEqual([pack]);

    const projection = new Database(join(controlHome, "control-plane.sqlite"), { readonly: true });
    expect(projection.query("SELECT COUNT(*) AS count FROM context_blocks").get())
      .toEqual({ count: 1 });
    expect(projection.query("SELECT COUNT(*) AS count FROM context_packs").get())
      .toEqual({ count: 1 });
    projection.close();

    first.child.kill();
    await first.child.exited.catch(() => {});
    broker.harnesses.delete(first);

    const restarted = await broker.startBroker({ controlHome });
    expect(await broker.getJson<ContextBlock[]>(
      restarted.baseUrl,
      "/v1/context/blocks?state=active",
    )).toEqual([block]);
    expect(await broker.getJson<ContextPack[]>(
      restarted.baseUrl,
      "/v1/context/packs?projectPath=%2Frepo",
    )).toEqual([pack]);
  }, 15_000);
});
