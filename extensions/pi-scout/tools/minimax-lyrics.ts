const MINIMAX_API_BASE_URL = "https://api.minimax.io";
const MINIMAX_LYRICS_GENERATION_PATH = "/v1/lyrics_generation";
const MAX_PROMPT_LENGTH = 2_000;
const MAX_LYRICS_LENGTH = 3_500;

export type MiniMaxLyricsMode = "write_full_song" | "edit";

export interface MiniMaxLyricsInput {
  mode: MiniMaxLyricsMode;
  prompt?: string;
  lyrics?: string;
  title?: string;
}

export interface MiniMaxLyricsPayload {
  mode: MiniMaxLyricsMode;
  prompt: string;
  lyrics?: string;
  title?: string;
}

export interface MiniMaxLyricsBaseResponse {
  status_code: number;
  status_msg: string;
}

export interface MiniMaxLyricsApiResponse {
  song_title?: string;
  style_tags?: string;
  lyrics?: string;
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
  trace_id?: string;
}

export interface MiniMaxLyricsResult {
  mode: MiniMaxLyricsMode;
  title: string | null;
  styleTagsText: string;
  styleTags: string[];
  lyrics: string;
  baseResp: MiniMaxLyricsBaseResponse | null;
  traceId: string | null;
  raw: MiniMaxLyricsApiResponse;
}

type MiniMaxFetch = typeof fetch;

export class MiniMaxLyricsError extends Error {
  readonly details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "MiniMaxLyricsError";
    this.details = details;
  }
}

export function resolveMiniMaxApiKey(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const direct = normalizeOptionalString(env.MINIMAX_API_KEY);
  if (direct) return direct;
  return normalizeOptionalString(env.MINIMAX_TOKEN);
}

export function buildMiniMaxLyricsPayload(input: MiniMaxLyricsInput): MiniMaxLyricsPayload {
  const mode = input.mode;
  if (mode !== "write_full_song" && mode !== "edit") {
    throw new MiniMaxLyricsError("MiniMax lyrics mode must be write_full_song or edit.", {
      mode,
    });
  }

  const prompt = input.prompt ?? "";
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new MiniMaxLyricsError(
      `MiniMax lyrics prompts must be ${MAX_PROMPT_LENGTH} characters or fewer.`,
      { maxLength: MAX_PROMPT_LENGTH, actualLength: prompt.length },
    );
  }

  const lyrics = input.lyrics;
  if (lyrics && lyrics.length > MAX_LYRICS_LENGTH) {
    throw new MiniMaxLyricsError(
      `MiniMax edit lyrics must be ${MAX_LYRICS_LENGTH} characters or fewer.`,
      { maxLength: MAX_LYRICS_LENGTH, actualLength: lyrics.length },
    );
  }

  if (mode === "edit" && !normalizeOptionalString(lyrics)) {
    throw new MiniMaxLyricsError(
      "MiniMax lyrics edit mode requires existing lyrics to continue or revise.",
    );
  }

  const payload: MiniMaxLyricsPayload = { mode, prompt };
  if (mode === "edit" && lyrics) {
    payload.lyrics = lyrics;
  }

  const title = normalizeOptionalString(input.title);
  if (title) {
    payload.title = title;
  }

  return payload;
}

export function normalizeMiniMaxLyricsError(error: unknown): {
  message: string;
  details?: Record<string, unknown>;
} {
  if (error instanceof MiniMaxLyricsError) {
    return {
      message: error.message,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return { message: error.message };
  }

  return { message: String(error) };
}

export function summarizeMiniMaxLyricsResult(result: MiniMaxLyricsResult): string {
  const lines: string[] = [];

  if (result.title) {
    lines.push(`Title: ${result.title}`);
  }

  if (result.styleTagsText) {
    lines.push(`Style tags: ${result.styleTagsText}`);
  }

  if (result.baseResp) {
    lines.push(`MiniMax status: ${result.baseResp.status_code} (${result.baseResp.status_msg})`);
  }

  if (result.traceId) {
    lines.push(`Trace ID: ${result.traceId}`);
  }

  if (result.lyrics) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(result.lyrics);
  }

  return lines.join("\n").trim() || "MiniMax returned an empty lyrics payload.";
}

export function createMiniMaxLyricsClient(options?: {
  apiKey?: string;
  baseUrl?: string;
  fetchFn?: MiniMaxFetch;
}) {
  const baseUrl = options?.baseUrl ?? MINIMAX_API_BASE_URL;
  const fetchFn = options?.fetchFn ?? fetch;

  return {
    async generateLyrics(
      input: MiniMaxLyricsInput,
      requestOptions?: { signal?: AbortSignal },
    ): Promise<MiniMaxLyricsResult> {
      const apiKey = options?.apiKey ?? resolveMiniMaxApiKey();
      if (!apiKey) {
        throw new MiniMaxLyricsError(
          "MiniMax lyrics generation is unavailable because no MiniMax API key is available in the Pi process environment.",
        );
      }

      const payload = buildMiniMaxLyricsPayload(input);
      const response = await fetchFn(new URL(MINIMAX_LYRICS_GENERATION_PATH, `${baseUrl}/`), {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: requestOptions?.signal,
      });

      const rawText = await response.text();
      if (!response.ok) {
        throw new MiniMaxLyricsError(
          `MiniMax lyrics generation failed with HTTP ${response.status}.`,
          {
            status: response.status,
            bodyPreview: rawText.slice(0, 200),
          },
        );
      }

      const raw = parseMiniMaxLyricsResponse(rawText, response.status);
      return normalizeMiniMaxLyricsResult(payload.mode, raw);
    },
  };
}

function normalizeMiniMaxLyricsResult(
  mode: MiniMaxLyricsMode,
  raw: MiniMaxLyricsApiResponse,
): MiniMaxLyricsResult {
  return {
    mode,
    title: normalizeOptionalString(raw.song_title),
    styleTagsText: normalizeOptionalString(raw.style_tags) ?? "",
    styleTags: splitStyleTags(raw.style_tags),
    lyrics: typeof raw.lyrics === "string" ? raw.lyrics : "",
    baseResp: normalizeBaseResp(raw.base_resp),
    traceId: normalizeOptionalString(raw.trace_id),
    raw,
  };
}

function normalizeBaseResp(
  value: MiniMaxLyricsApiResponse["base_resp"],
): MiniMaxLyricsBaseResponse | null {
  const statusCode = value?.status_code;
  const statusMsg = value?.status_msg;

  if (typeof statusCode !== "number" || typeof statusMsg !== "string") {
    return null;
  }

  return {
    status_code: statusCode,
    status_msg: statusMsg,
  };
}

function parseMiniMaxLyricsResponse(
  bodyText: string,
  status: number,
): MiniMaxLyricsApiResponse {
  try {
    return bodyText.length > 0 ? JSON.parse(bodyText) as MiniMaxLyricsApiResponse : {};
  } catch (error) {
    throw new MiniMaxLyricsError(
      `MiniMax lyrics generation returned invalid JSON for HTTP ${status}.`,
      {
        cause: error instanceof Error ? error.message : String(error),
        bodyPreview: bodyText.slice(0, 200),
      },
    );
  }
}

function splitStyleTags(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function normalizeOptionalString(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
