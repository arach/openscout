import { describe, expect, test } from "bun:test";
import { resolveConfigLayers } from "./config.ts";

describe("resolveConfigLayers", () => {
  test("preserves workspace and auto-start sessions from file config", () => {
    const resolved = resolveConfigLayers(
      {
        port: 9000,
        secure: true,
        relay: "wss://relay.example.com",
        workspace: { root: "~/dev" },
        sessions: [
          {
            adapter: "claude-code",
            name: "Dispatch",
            cwd: "/Users/arach/dev/dispatch",
          },
        ],
      },
      {},
    );

    expect(resolved.workspace).toEqual({ root: "~/dev" });
    expect(resolved.sessions).toEqual([
      {
        adapter: "claude-code",
        name: "Dispatch",
        cwd: "/Users/arach/dev/dispatch",
      },
    ]);
  });

  test("applies CLI overrides without dropping file-only fields", () => {
    const resolved = resolveConfigLayers(
      {
        port: 9000,
        secure: false,
        workspace: { root: "/tmp/workspace" },
        sessions: [
          {
            adapter: "codex",
            name: "Supervisor",
          },
        ],
      },
      {
        port: 7888,
        secure: true,
        pair: true,
      },
    );

    expect(resolved.port).toBe(7888);
    expect(resolved.secure).toBe(true);
    expect(resolved.pair).toBe(true);
    expect(resolved.workspace?.root).toBe("/tmp/workspace");
    expect(resolved.sessions).toHaveLength(1);
    expect(resolved.sessions?.[0]?.adapter).toBe("codex");
  });
});
