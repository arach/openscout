import { describe, expect, test } from "bun:test";
import { isNewChatShortcut } from "./new-chat-shortcut.ts";

describe("new chat shortcuts", () => {
  test("uses C as the primary web shortcut", () => {
    expect(isNewChatShortcut({ key: "c" })).toBe(true);
    expect(isNewChatShortcut({ key: "C", shiftKey: true })).toBe(false);
  });

  test("keeps Cmd+Option+N or Ctrl+Alt+N as a fallback", () => {
    expect(isNewChatShortcut({ key: "n", metaKey: true, altKey: true })).toBe(true);
    expect(isNewChatShortcut({ key: "N", ctrlKey: true, altKey: true })).toBe(true);
  });

  test("does not hijack Chrome-owned Cmd+Shift+N", () => {
    expect(isNewChatShortcut({ key: "n", metaKey: true, shiftKey: true })).toBe(false);
  });

  test("does not hijack plain Cmd+N", () => {
    expect(isNewChatShortcut({ key: "n", metaKey: true })).toBe(false);
  });

  test("does not fire from editable targets", () => {
    const inputTarget = { tagName: "input" } as unknown as EventTarget;
    const ariaTextboxTarget = {
      closest: (selector: string) => selector.includes("[role='textbox']") ? {} : null,
      tagName: "div",
    } as unknown as EventTarget;

    expect(isNewChatShortcut({ key: "c", target: inputTarget })).toBe(false);
    expect(isNewChatShortcut({ key: "n", metaKey: true, altKey: true, target: ariaTextboxTarget })).toBe(false);
  });
});
