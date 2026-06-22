import { describe, expect, test } from "bun:test";

import {
  CHAT_ID_PREFIX,
  LEGACY_CHANNEL_ID_PREFIX,
  isOpaqueChannelId,
  mintChannelId,
} from "./channel-identity";

describe("channel identity", () => {
  test("mints chat-prefixed opaque ids without UUID punctuation", () => {
    const id = mintChannelId(() => "FF3A45D0-76DE-4614-995C-530D455FFC48");

    expect(id).toBe("chat_ff3a45d076de4614995c530d455ffc48");
    expect(id.startsWith(CHAT_ID_PREFIX)).toBe(true);
    expect(isOpaqueChannelId(id)).toBe(true);
  });

  test("accepts legacy c-dot ids while rejecting structural ids", () => {
    expect(isOpaqueChannelId(`${LEGACY_CHANNEL_ID_PREFIX}ff3a45d0-76de-4614-995c-530d455ffc48`)).toBe(true);
    expect(isOpaqueChannelId("dm.operator.agent")).toBe(false);
    expect(isOpaqueChannelId("channel.ops")).toBe(false);
  });
});
