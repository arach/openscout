import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ScoutRuntime } from "../runtime.ts";
import {
  createMiniMaxLyricsClient,
  normalizeMiniMaxLyricsError,
  summarizeMiniMaxLyricsResult,
  type MiniMaxLyricsInput,
} from "./minimax-lyrics.ts";

export function createMiniMaxLyricsTool(
  runtime: ScoutRuntime,
  client = createMiniMaxLyricsClient(),
) {
  return {
    name: "minimax_generate_lyrics",
    label: "MiniMax Lyrics",
    description:
      "Generate or edit structured song lyrics with the MiniMax Lyrics Generation API. " +
      "Use write_full_song for a new song or edit to continue/revise existing lyrics.",

    parameters: {
      mode: {
        type: "string" as const,
        description: "Generation mode: write_full_song or edit",
      },
      prompt: {
        type: "string" as const,
        description: "Theme, style, or editing instruction. Leave empty for a random song.",
        required: false as const,
      },
      lyrics: {
        type: "string" as const,
        description: "Existing lyrics to continue or revise. Required for edit mode.",
        required: false as const,
      },
      title: {
        type: "string" as const,
        description: "Optional song title to preserve unchanged.",
        required: false as const,
      },
    },

    async execute(
      _id: string,
      params: MiniMaxLyricsInput,
      _signal: AbortSignal,
      _onUpdate: (update: unknown) => void,
      ctx: ExtensionContext,
    ) {
      await runtime.ensureEngaged(ctx);

      try {
        const result = await client.generateLyrics(params, { signal: _signal });
        return {
          content: [{ type: "text" as const, text: summarizeMiniMaxLyricsResult(result) }],
          details: result,
        };
      } catch (error) {
        const failure = normalizeMiniMaxLyricsError(error);
        return {
          content: [{ type: "text" as const, text: failure.message }],
          details: {
            error: failure,
          },
        };
      }
    },
  };
}
