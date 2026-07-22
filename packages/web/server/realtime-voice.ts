const OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const DEFAULT_REALTIME_MODEL = "gpt-realtime-2.1";
const DEFAULT_REALTIME_VOICE = "marin";
const MAX_SDP_BYTES = 64 * 1024;

const SCOUT_REALTIME_INSTRUCTIONS = [
  "You are Scoutbot Voice, the spoken front end for OpenScout's in-app control-plane assistant.",
  "Keep turns concise, practical, conversational, and suitable for audio.",
  "For any question about the operator's fleet, agents, projects, workspace, current work, coordination, navigation, or what to do next, call ask_scoutbot with the operator's full request before answering.",
  "Treat the ask_scoutbot result as the source of truth for live Scout state. Never invent fleet state or claim a Scout action completed unless the result says so.",
  "The result can include an OpenScout UI action that the app applies locally. Do not read JSON, fence markup, or implementation details aloud.",
  "You may handle a simple greeting directly, but use ask_scoutbot whenever the operator asks for work or live context.",
].join(" ");

const SCOUTBOT_REALTIME_TOOL = {
  type: "function",
  name: "ask_scoutbot",
  description: "Ask the live Scoutbot control-plane assistant about the current OpenScout fleet, agents, workspace, coordination, navigation, or next action. Use this for any request that needs live Scout context or should affect the OpenScout UI.",
  parameters: {
    type: "object",
    properties: {
      request: {
        type: "string",
        description: "The operator's complete request, preserving relevant agent names, project names, and requested action.",
      },
    },
    required: ["request"],
    additionalProperties: false,
  },
};

export type ScoutRealtimeVoiceConfig = {
  model: string;
  voice: string;
  instructions: string;
};

export class ScoutRealtimeVoiceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly diagnostic?: Record<string, string | number>,
  ) {
    super(message);
    this.name = "ScoutRealtimeVoiceError";
  }
}

export function resolveScoutRealtimeVoiceConfig(
  env: NodeJS.ProcessEnv = process.env,
): ScoutRealtimeVoiceConfig {
  return {
    model: firstNonEmptyString(env.OPENSCOUT_REALTIME_MODEL) ?? DEFAULT_REALTIME_MODEL,
    voice: firstNonEmptyString(env.OPENSCOUT_REALTIME_VOICE) ?? DEFAULT_REALTIME_VOICE,
    instructions: firstNonEmptyString(env.OPENSCOUT_REALTIME_INSTRUCTIONS) ?? SCOUT_REALTIME_INSTRUCTIONS,
  };
}

export function validateScoutRealtimeOffer(sdp: string): string {
  const candidate = sdp.trim();
  if (!candidate) {
    throw new ScoutRealtimeVoiceError("WebRTC offer SDP is required.", 400);
  }
  if (new TextEncoder().encode(sdp).byteLength > MAX_SDP_BYTES) {
    throw new ScoutRealtimeVoiceError("WebRTC offer SDP is too large.", 413);
  }
  if (!candidate.startsWith("v=0")) {
    throw new ScoutRealtimeVoiceError("WebRTC offer SDP is invalid.", 400);
  }
  // SDP uses CRLF line endings. In particular, the final CRLF is significant to
  // the Realtime SDP parser, so validate a trimmed view but proxy the browser's
  // exact payload rather than normalizing it.
  return sdp;
}

export async function createScoutRealtimeVoiceCall(input: {
  offerSdp: string;
  apiKey: string;
  config?: ScoutRealtimeVoiceConfig;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const config = input.config ?? resolveScoutRealtimeVoiceConfig();
  const session = JSON.stringify({
    type: "realtime",
    model: config.model,
    audio: { output: { voice: config.voice } },
    instructions: config.instructions,
    tools: [SCOUTBOT_REALTIME_TOOL],
    tool_choice: "auto",
  });
  const form = new FormData();
  form.set("sdp", input.offerSdp);
  form.set("session", session);

  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(OPENAI_REALTIME_CALLS_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${input.apiKey}` },
      body: form,
      signal: input.signal,
    });
  } catch {
    throw new ScoutRealtimeVoiceError("Could not reach OpenAI Realtime.", 502);
  }

  const body = await response.text();
  if (!response.ok) {
    throw new ScoutRealtimeVoiceError(
      `OpenAI Realtime could not start the call (${response.status}).`,
      502,
      {
        upstreamStatus: response.status,
        model: config.model,
        ...parseOpenAIErrorDiagnostic(body),
      },
    );
  }
  if (!body.trim()) {
    throw new ScoutRealtimeVoiceError("OpenAI Realtime returned an empty call answer.", 502);
  }
  return body;
}

function firstNonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function parseOpenAIErrorDiagnostic(body: string): Record<string, string> {
  try {
    const parsed = JSON.parse(body) as {
      error?: { code?: unknown; message?: unknown; type?: unknown };
    };
    const error = parsed.error;
    if (!error || typeof error !== "object") return {};
    return {
      ...(typeof error.type === "string" ? { upstreamType: error.type } : {}),
      ...(typeof error.code === "string" ? { upstreamCode: error.code } : {}),
      ...(typeof error.message === "string" ? { upstreamMessage: error.message } : {}),
    };
  } catch {
    return {};
  }
}
