import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { SCOUT_REALTIME_VOICE_CALL_PATH } from "../shared/realtime-voice.ts";
import {
  ScoutRealtimeVoiceError,
  createScoutRealtimeVoiceCall,
  resolveScoutRealtimeVoiceConfig,
  validateScoutRealtimeOffer,
} from "./realtime-voice.ts";
import { mountScoutVoiceRoutes } from "./routes/voice.ts";

describe("Scout Realtime voice", () => {
  test("keeps the server call route closed without the client feature marker", async () => {
    const app = new Hono();
    let resolvedApiKey = false;
    mountScoutVoiceRoutes(app, {
      resolveOpenAIApiKey: async () => {
        resolvedApiKey = true;
        return "sk-test";
      },
    });

    const response = await app.request(SCOUT_REALTIME_VOICE_CALL_PATH, {
      method: "POST",
      headers: { "content-type": "application/sdp" },
      body: "v=0\r\noffer\r\n",
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Realtime voice is not enabled." });
    expect(resolvedApiKey).toBe(false);
  });

  test("sends the browser offer and Scout-owned session config through the server", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const answer = await createScoutRealtimeVoiceCall({
      offerSdp: "v=0\r\noffer",
      apiKey: "sk-test",
      config: {
        model: "gpt-test-realtime",
        voice: "marin",
        instructions: "Use concise replies.",
      },
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response("v=0\r\nanswer", { status: 200 });
      },
    });

    expect(answer).toBe("v=0\r\nanswer");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/realtime/calls");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe("Bearer sk-test");
    expect(calls[0]?.init?.body).toBeInstanceOf(FormData);
    const form = calls[0]?.init?.body as FormData;
    expect(form.get("sdp")).toBe("v=0\r\noffer");
    expect(JSON.parse(String(form.get("session")))).toEqual({
      type: "realtime",
      model: "gpt-test-realtime",
      audio: { output: { voice: "marin" } },
      instructions: "Use concise replies.",
      tools: [
        {
          type: "function",
          name: "ask_scoutbot",
          description: expect.stringContaining("live Scoutbot control-plane assistant"),
          parameters: {
            type: "object",
            properties: {
              request: {
                type: "string",
                description: expect.stringContaining("operator's complete request"),
              },
            },
            required: ["request"],
            additionalProperties: false,
          },
        },
      ],
      tool_choice: "auto",
    });
  });

  test("does not leak an upstream error response through the browser route", async () => {
    const error = await createScoutRealtimeVoiceCall({
      offerSdp: "v=0\r\noffer",
      apiKey: "sk-test",
      fetchImpl: async () => new Response('{"error":{"message":"invalid key"}}', { status: 401 }),
    }).catch((caught) => caught);

    expect(error).toEqual(expect.objectContaining({
      name: "ScoutRealtimeVoiceError",
      status: 502,
      message: expect.stringContaining("401"),
    }));
    expect(error).toEqual(expect.objectContaining({
      message: expect.not.stringContaining("invalid key"),
    }));
  });

  test("validates browser SDP before making an upstream call", () => {
    const offer = "v=0\r\noffer\r\n";
    expect(validateScoutRealtimeOffer(offer)).toBe(offer);
    expect(() => validateScoutRealtimeOffer("not an offer")).toThrow(ScoutRealtimeVoiceError);
  });

  test("keeps the documented defaults configurable at the server boundary", () => {
    expect(resolveScoutRealtimeVoiceConfig({
      OPENSCOUT_REALTIME_MODEL: "gpt-test-realtime",
      OPENSCOUT_REALTIME_VOICE: "cedar",
      OPENSCOUT_REALTIME_INSTRUCTIONS: "Be direct.",
    })).toEqual({
      model: "gpt-test-realtime",
      voice: "cedar",
      instructions: "Be direct.",
    });
  });
});
