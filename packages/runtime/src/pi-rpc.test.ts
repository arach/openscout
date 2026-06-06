import { describe, expect, test } from "bun:test";

import { buildPiRpcCredentialEnv, parsePiRpcLaunchArgs } from "./pi-rpc";

describe("Pi RPC launch args", () => {
  test("extracts modeled Pi options and preserves unknown passthrough args", () => {
    const parsed = parsePiRpcLaunchArgs(
      [
        "--model",
        "MiniMax-M3",
        "--provider=minimax",
        "--thinking",
        "low",
        "--session-id",
        "review-pi",
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
      sessionId: "review-pi",
      sessionDir: "/runtime/pi-agent/pi-sessions",
      extensions: ["/dev/pi-scout"],
      extraArgs: ["--custom-flag", "custom-value"],
    });
  });
});

describe("Pi RPC credentials", () => {
  test("maps SCOUT_XAI_API_KEY to XAI_API_KEY for xAI launches", () => {
    const originalXaiKey = process.env.XAI_API_KEY;
    const originalScoutXaiKey = process.env.SCOUT_XAI_API_KEY;
    try {
      delete process.env.XAI_API_KEY;
      process.env.SCOUT_XAI_API_KEY = "scout-xai-key";

      expect(buildPiRpcCredentialEnv({ provider: "xai" })).toEqual({
        XAI_API_KEY: "scout-xai-key",
      });
    } finally {
      if (originalXaiKey === undefined) {
        delete process.env.XAI_API_KEY;
      } else {
        process.env.XAI_API_KEY = originalXaiKey;
      }
      if (originalScoutXaiKey === undefined) {
        delete process.env.SCOUT_XAI_API_KEY;
      } else {
        process.env.SCOUT_XAI_API_KEY = originalScoutXaiKey;
      }
    }
  });

  test("infers xAI provider from Grok model names", () => {
    const originalXaiKey = process.env.XAI_API_KEY;
    const originalScoutXaiKey = process.env.SCOUT_XAI_API_KEY;
    try {
      process.env.XAI_API_KEY = "xai-key";
      delete process.env.SCOUT_XAI_API_KEY;

      expect(buildPiRpcCredentialEnv({ model: "grok-4.3" })).toEqual({
        XAI_API_KEY: "xai-key",
      });
    } finally {
      if (originalXaiKey === undefined) {
        delete process.env.XAI_API_KEY;
      } else {
        process.env.XAI_API_KEY = originalXaiKey;
      }
      if (originalScoutXaiKey === undefined) {
        delete process.env.SCOUT_XAI_API_KEY;
      } else {
        process.env.SCOUT_XAI_API_KEY = originalScoutXaiKey;
      }
    }
  });
});
