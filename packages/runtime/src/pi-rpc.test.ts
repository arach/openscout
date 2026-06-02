import { describe, expect, test } from "bun:test";

import { parsePiRpcLaunchArgs } from "./pi-rpc";

describe("Pi RPC launch args", () => {
  test("extracts modeled Pi options and preserves unknown passthrough args", () => {
    const parsed = parsePiRpcLaunchArgs(
      [
        "--model",
        "MiniMax-M3",
        "--provider=minimax",
        "--thinking",
        "low",
        "--extension",
        "/dev/pi-scout",
        "--append-system-prompt",
        "managed prompt",
        "--custom-flag",
        "custom-value",
      ],
      {
        runtimeDirectory: "/runtime/pi-agent",
        includeDefaultScoutExtension: false,
      },
    );

    expect(parsed).toEqual({
      model: "MiniMax-M3",
      provider: "minimax",
      thinking: "low",
      sessionDir: "/runtime/pi-agent/pi-sessions",
      extensions: ["/dev/pi-scout"],
      extraArgs: ["--custom-flag", "custom-value"],
    });
  });
});
