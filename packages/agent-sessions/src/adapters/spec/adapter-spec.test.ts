import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  validateAdapterSpec,
  validateRepoAdapterSpecs,
} from "./tools/validate-adapter-specs.mjs";

const SPEC_ROOT = fileURLToPath(new URL("..", import.meta.url));

function readSpec(relativePath: string) {
  return JSON.parse(readFileSync(join(SPEC_ROOT, relativePath), "utf8")) as Record<string, unknown>;
}

describe("adapter spec v1", () => {
  test("validates all checked-in adapter specs", async () => {
    const results = await validateRepoAdapterSpecs();
    expect(results.every((result) => result.errors.length === 0)).toBe(true);
  });

  test("codex spec captures the stateful JSON-RPC shape", () => {
    const spec = readSpec("codex/adapter.spec.json");
    const errors = validateAdapterSpec(spec, "codex/adapter.spec.json");

    expect(errors).toEqual([]);
    expect(spec.adapterId).toBe("codex");
    expect(spec.upstream).toMatchObject({
      kind: "official_protocol",
      transport: "jsonrpc-stdio-jsonl",
    });
    expect(spec.sessionModel).toMatchObject({
      conversationScope: "thread",
      turnSteering: "native_same_turn",
    });
    expect(spec.nativeProtocol).toMatchObject({
      serverRequestStrategy: "reject_unsupported",
    });
  });

  test("claude-code spec captures the stream-json process shape", () => {
    const spec = readSpec("claude-code/adapter.spec.json");
    const errors = validateAdapterSpec(spec, "claude-code/adapter.spec.json");

    expect(errors).toEqual([]);
    expect(spec.adapterId).toBe("claude-code");
    expect(spec.upstream).toMatchObject({
      kind: "cli_protocol",
      transport: "stream-json-stdio",
    });
    expect(spec.capabilities).toMatchObject({
      interactive: {
        questions: "native",
        approvals: "none",
        serverRequests: "none",
      },
    });
  });
});
