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

  test("maps XAI_API_KEY credentials for Grok launches", () => {
    const sources = {
      env: {
        XAI_API_KEY: "xai-key",
      },
      readSecret: () => undefined,
    };

    expect(buildPiRpcCredentialEnv({ model: "grok-4.3" }, sources)).toEqual({
      XAI_API_KEY: "xai-key",
    });
    expect(buildPiRpcCredentialEnv({ provider: "grok" }, sources)).toEqual({
      XAI_API_KEY: "xai-key",
    });
  });

  test("resolves Pi RPC credential aliases from env before secrets", () => {
    expect(
      buildPiRpcCredentialEnv(
        { provider: "minimax" },
        {
          env: {
            MINIMAX_TOKEN: "minimax-env-token",
          },
          readSecret: () => "minimax-secret-key",
        },
      ),
    ).toEqual({
      MINIMAX_API_KEY: "minimax-env-token",
    });

    expect(
      buildPiRpcCredentialEnv(
        { model: "grok-4.3" },
        {
          env: {},
          readSecret: (name) => name === "XAI_API_KEY" ? "xai-secret" : undefined,
        },
      ),
    ).toEqual({
      XAI_API_KEY: "xai-secret",
    });
  });
});
