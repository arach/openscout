import { describe, expect, test } from "bun:test";

import {
  constructiveScope,
  parseConstructiveCommandArgs,
  positiveInteger,
} from "./constructive-context.ts";

describe("constructive context CLI parsing", () => {
  test("parses value flags without treating memory text as history", () => {
    expect(parseConstructiveCommandArgs([
      "--scope=workspace",
      "--scope-id",
      "/repo",
      "Keep",
      "the",
      "decision",
    ])).toEqual({
      flags: new Map([
        ["--scope", "workspace"],
        ["--scope-id", "/repo"],
      ]),
      switches: new Set(),
      positionals: ["Keep", "the", "decision"],
    });
  });

  test("defaults constructive state to workspace scope", () => {
    expect(constructiveScope({ defaultWorkspace: "/repo" })).toEqual({
      kind: "workspace",
      id: "/repo",
    });
    expect(constructiveScope({
      scopeKind: "global",
      defaultWorkspace: "/repo",
    })).toEqual({ kind: "global" });
  });

  test("requires positive context budgets", () => {
    expect(positiveInteger("4000", 100)).toBe(4000);
    expect(() => positiveInteger("0", 100)).toThrow("expected a positive integer");
  });
});
