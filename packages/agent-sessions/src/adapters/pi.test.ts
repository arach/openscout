import { describe, expect, test } from "bun:test";

import { buildPiProcessEnv } from "./pi.ts";

describe("buildPiProcessEnv", () => {
  test("passes only MiniMax API key credentials for the MiniMax provider", () => {
    const env = buildPiProcessEnv(
      {
        env: {
          PATH: "/custom/bin",
          GITHUB_TOKEN: "do-not-forward",
          MINIMAX_API_KEY: "adapter-key",
          OPENAI_API_KEY: "do-not-forward",
        },
        options: {
          provider: "minimax",
          model: "MiniMax-M2.7",
        },
      },
      {
        HOME: "/Users/tester",
        PATH: "/usr/bin",
        SSH_AUTH_SOCK: "/tmp/agent.sock",
        MINIMAX_TOKEN: "source-token",
        ANTHROPIC_API_KEY: "do-not-forward",
      },
    );

    expect(env.PATH).toBe("/custom/bin");
    expect(env.HOME).toBe("/Users/tester");
    expect(env.MINIMAX_API_KEY).toBe("adapter-key");
    expect(env).not.toHaveProperty("MINIMAX_TOKEN");
    expect(env).not.toHaveProperty("GITHUB_TOKEN");
    expect(env).not.toHaveProperty("OPENAI_API_KEY");
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(env).not.toHaveProperty("SSH_AUTH_SOCK");
  });

  test("maps MINIMAX_TOKEN to MINIMAX_API_KEY without forwarding the alias", () => {
    const env = buildPiProcessEnv(
      {
        env: {
          MINIMAX_TOKEN: "adapter-token",
        },
        options: {
          provider: "minimax",
        },
      },
      {
        MINIMAX_API_KEY: "source-key",
      },
    );

    expect(env.MINIMAX_API_KEY).toBe("adapter-token");
    expect(env).not.toHaveProperty("MINIMAX_TOKEN");
  });

  test("does not forward provider credentials when no provider can be inferred", () => {
    const env = buildPiProcessEnv(
      {
        env: {
          MINIMAX_API_KEY: "do-not-forward",
        },
        options: {
          model: "unknown-model",
        },
      },
      {
        OPENAI_API_KEY: "do-not-forward",
      },
    );

    expect(env).not.toHaveProperty("MINIMAX_API_KEY");
    expect(env).not.toHaveProperty("OPENAI_API_KEY");
  });
});
