import { describe, expect, test } from "bun:test";

import { createMiniMaxLyricsTool } from "./lyrics.ts";
import {
  buildMiniMaxLyricsPayload,
  createMiniMaxLyricsClient,
  resolveMiniMaxApiKey,
} from "./minimax-lyrics.ts";

describe("MiniMax lyrics support", () => {
  test("maps MINIMAX_TOKEN fallback without exposing the alias name", () => {
    expect(resolveMiniMaxApiKey({ MINIMAX_TOKEN: "fallback-key" })).toBe("fallback-key");
    expect(resolveMiniMaxApiKey({ MINIMAX_API_KEY: "direct-key", MINIMAX_TOKEN: "fallback-key" })).toBe("direct-key");
  });

  test("requires existing lyrics for edit mode", () => {
    expect(() =>
      buildMiniMaxLyricsPayload({
        mode: "edit",
        prompt: "Continue with a new bridge",
      })
    ).toThrow("MiniMax lyrics edit mode requires existing lyrics");
  });

  test("posts MiniMax lyrics requests and normalizes the response", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;

    const client = createMiniMaxLyricsClient({
      apiKey: "test-key",
      fetchFn: async (input, init) => {
        requestUrl = String(input);
        requestInit = init;
        return new Response(JSON.stringify({
          song_title: "Rain Song",
          style_tags: "Indie Folk, Melancholic, Coffeehouse",
          lyrics: "[Verse]\nStreetlights flicker in the rain",
          trace_id: "trace-123",
          base_resp: {
            status_code: 0,
            status_msg: "success",
          },
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    const result = await client.generateLyrics({
      mode: "write_full_song",
      prompt: "An indie folk song about a rainy night walk",
    });

    expect(requestUrl).toBe("https://api.minimax.io/v1/lyrics_generation");
    expect(new Headers(requestInit?.headers).get("authorization")).toBe("Bearer test-key");
    expect(new Headers(requestInit?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      mode: "write_full_song",
      prompt: "An indie folk song about a rainy night walk",
    });

    expect(result).toMatchObject({
      mode: "write_full_song",
      title: "Rain Song",
      styleTagsText: "Indie Folk, Melancholic, Coffeehouse",
      styleTags: ["Indie Folk", "Melancholic", "Coffeehouse"],
      lyrics: "[Verse]\nStreetlights flicker in the rain",
      traceId: "trace-123",
      baseResp: {
        status_code: 0,
        status_msg: "success",
      },
    });
  });

  test("tool execution returns structured lyrics output", async () => {
    const tool = createMiniMaxLyricsTool(
      {
        ensureEngaged: async () => {},
        noteContext: () => {},
        dispose: () => {},
      },
      {
        generateLyrics: async () => ({
          mode: "edit" as const,
          title: "Night Train",
          styleTagsText: "Synth Pop, Neon",
          styleTags: ["Synth Pop", "Neon"],
          lyrics: "[Chorus]\nTake me where the city glows",
          baseResp: {
            status_code: 0,
            status_msg: "success",
          },
          traceId: null,
          raw: {
            song_title: "Night Train",
            style_tags: "Synth Pop, Neon",
            lyrics: "[Chorus]\nTake me where the city glows",
            base_resp: {
              status_code: 0,
              status_msg: "success",
            },
          },
        }),
      },
    );

    const response = await tool.execute(
      "tool-call-1",
      {
        mode: "edit",
        prompt: "Add a bigger chorus",
        lyrics: "[Verse]\nMidnight on the platform",
      },
      new AbortController().signal,
      () => {},
      {} as never,
    );

    expect(response.details).toMatchObject({
      title: "Night Train",
      styleTags: ["Synth Pop", "Neon"],
      lyrics: "[Chorus]\nTake me where the city glows",
      baseResp: {
        status_code: 0,
        status_msg: "success",
      },
    });
    expect(response.content[0]?.text).toContain("Title: Night Train");
    expect(response.content[0]?.text).toContain("[Chorus]");
  });
});
