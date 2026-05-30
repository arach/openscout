import { getSecret } from "@/lib/secrets";

export interface MinimaxCallInput {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface MinimaxUsage {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface MinimaxCallResult {
  model: string;
  content: string;
  reasoning: string;
  usage: MinimaxUsage;
  latencyMs: number;
  finishReason: string;
  raw: unknown;
}

const ENDPOINT = "https://api.minimax.io/v1/text/chatcompletion_v2";

/**
 * Single chat completion against MiniMax. Returns content + reasoning + usage
 * so callers can show what the LLM "thought" alongside what it returned.
 */
export async function callMinimax(input: MinimaxCallInput): Promise<MinimaxCallResult> {
  const key = await getSecret("MINIMAX_API_KEY");
  const model = input.model ?? "MiniMax-M2";
  const body = {
    model,
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ],
    max_tokens: input.maxTokens ?? 4000,
    temperature: input.temperature ?? 0.2,
  };
  const start = Date.now();
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as MinimaxRawResponse;
  const latencyMs = Date.now() - start;
  if (json.base_resp && json.base_resp.status_code !== 0) {
    throw new Error(
      `MiniMax error ${json.base_resp.status_code}: ${json.base_resp.status_msg}`,
    );
  }
  const choice = json.choices?.[0];
  if (!choice) throw new Error("MiniMax returned no choices");
  const usage = json.usage ?? {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    completion_tokens_details: { reasoning_tokens: 0 },
  };
  return {
    model,
    content: choice.message?.content ?? "",
    reasoning: choice.message?.reasoning_content ?? "",
    usage: {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
      totalTokens: usage.total_tokens,
    },
    latencyMs,
    finishReason: choice.finish_reason ?? "unknown",
    raw: json,
  };
}

interface MinimaxRawResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string;
      reasoning_content?: string;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  base_resp?: { status_code: number; status_msg: string };
}
