import { describe, expect, test } from "bun:test";
import { isNewChatShortcut } from "./new-chat-shortcut.ts";

describe("new chat shortcuts", () => {
  test("uses Cmd+Option+N or Ctrl+Alt+N for the web shortcut", () => {
    expect(isNewChatShortcut({ key: "n", metaKey: true, altKey: true })).toBe(true);
    expect(isNewChatShortcut({ key: "N", ctrlKey: true, altKey: true })).toBe(true);
  });

  test("does not hijack Chrome-owned Cmd+Shift+N", () => {
    expect(isNewChatShortcut({ key: "n", metaKey: true, shiftKey: true })).toBe(false);
  });

  test("does not hijack plain Cmd+N", () => {
    expect(isNewChatShortcut({ key: "n", metaKey: true })).toBe(false);
  });
});
