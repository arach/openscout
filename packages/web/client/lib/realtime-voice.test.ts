import { afterEach, describe, expect, test } from "bun:test";

import { startScoutRealtimeVoiceCall } from "./realtime-voice.ts";
import {
  SCOUT_REALTIME_VOICE_FLAG_HEADER,
  SCOUT_REALTIME_VOICE_FLAG_HEADER_VALUE,
} from "../../shared/realtime-voice.ts";

const originalFetch = globalThis.fetch;
const originalPeerConnection = globalThis.RTCPeerConnection;
const originalAudio = globalThis.Audio;
const originalNavigator = globalThis.navigator;

class FakeDataChannel extends EventTarget {
  static latest: FakeDataChannel | null = null;

  readonly sent: string[] = [];
  readyState: RTCDataChannelState = "open";

  constructor() {
    super();
    FakeDataChannel.latest = this;
  }

  send(value: string): void {
    this.sent.push(value);
  }
}

class FakePeerConnection {
  connectionState: RTCPeerConnectionState = "new";
  onconnectionstatechange: (() => void) | null = null;

  addTrack(): RTCRtpSender {
    return {} as RTCRtpSender;
  }

  createDataChannel(): RTCDataChannel {
    return new FakeDataChannel() as unknown as RTCDataChannel;
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: "offer", sdp: "v=0\r\noffer\r\n" };
  }

  async setLocalDescription(): Promise<void> {}

  async setRemoteDescription(): Promise<void> {
    this.connectionState = "connected";
    this.onconnectionstatechange?.();
  }

  close(): void {}
}

class FakeAudio {
  autoplay = false;
  srcObject: MediaProvider | null = null;

  async play(): Promise<void> {}

  pause(): void {}
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, "RTCPeerConnection", { configurable: true, value: originalPeerConnection });
  Object.defineProperty(globalThis, "Audio", { configurable: true, value: originalAudio });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
  FakeDataChannel.latest = null;
});

describe("Scout Realtime voice client", () => {
  test("routes a realtime ask_scoutbot function call through the existing Scoutbot chat loop", async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const replies: string[] = [];
    const trace: string[] = [];
    globalThis.fetch = (async (url, init) => {
      fetchCalls.push({ url: String(url), init });
      if (String(url) === "/api/voice/realtime/call") {
        return new Response("v=0\r\nanswer\r\n", { status: 200 });
      }
      return new Response(JSON.stringify({
        reply: {
          body: [
            "The fleet is healthy.",
            "```scout-ui",
            '{"type":"navigate","route":{"view":"fleet"}}',
            "```",
          ].join("\n"),
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    Object.defineProperty(globalThis, "RTCPeerConnection", { configurable: true, value: FakePeerConnection });
    Object.defineProperty(globalThis, "Audio", { configurable: true, value: FakeAudio });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        mediaDevices: {
          getUserMedia: async () => ({
            getTracks: () => [{ stop: () => {}, addEventListener: () => {} }],
          }),
        },
      },
    });

    let currentRoute: unknown = { view: "inbox" };
    await startScoutRealtimeVoiceCall({
      getRoute: () => currentRoute,
      onScoutbotReply: (body) => replies.push(body),
      onTrace: (event) => trace.push(event.label),
    });
    const events = FakeDataChannel.latest;
    expect(events).not.toBeNull();
    events?.dispatchEvent(new Event("open"));
    currentRoute = { view: "fleet" };
    events?.dispatchEvent(Object.assign(new Event("message"), {
      data: JSON.stringify({
        type: "response.done",
        response: {
          output: [{
            type: "function_call",
            name: "ask_scoutbot",
            call_id: "call-1",
            arguments: JSON.stringify({ request: "What is happening in the fleet?" }),
          }],
        },
      }),
    }));

    await waitFor(() => fetchCalls.length === 2 && replies.length === 1);

    expect(new Headers(fetchCalls[0]?.init?.headers).get(SCOUT_REALTIME_VOICE_FLAG_HEADER))
      .toBe(SCOUT_REALTIME_VOICE_FLAG_HEADER_VALUE);
    expect(fetchCalls[1]).toMatchObject({
      url: "/api/scoutbot/chat",
      init: {
        method: "POST",
        body: JSON.stringify({ body: "What is happening in the fleet?", route: { view: "fleet" } }),
      },
    });
    expect(replies).toEqual([expect.stringContaining("The fleet is healthy.")]);
    expect(trace).toEqual(expect.arrayContaining([
      "Scoutbot bridge ready",
      "Scoutbot is checking the control plane",
      "Scoutbot reply ready",
    ]));
    expect(events?.sent.map((value) => JSON.parse(value))).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "response.create" }),
      expect.objectContaining({
        type: "conversation.item.create",
        item: expect.objectContaining({
          type: "function_call_output",
          call_id: "call-1",
          output: JSON.stringify({ ok: true, reply: "The fleet is healthy." }),
        }),
      }),
    ]));
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("condition did not become true");
}
