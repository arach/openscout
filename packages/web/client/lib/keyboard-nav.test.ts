import { describe, expect, test } from "bun:test";
import { isEditableTarget, nextListIndex } from "./keyboard-nav-core.ts";

describe("keyboard list index", () => {
  test("starts at the first item when moving down from an unset cursor", () => {
    expect(nextListIndex(-1, 3, 1)).toBe(0);
  });

  test("starts at the last item when moving up from an unset cursor", () => {
    expect(nextListIndex(-1, 3, -1)).toBe(2);
  });

  test("clamps at the ends of the list", () => {
    expect(nextListIndex(0, 3, -1)).toBe(0);
    expect(nextListIndex(2, 3, 1)).toBe(2);
    expect(nextListIndex(1, 3, 1)).toBe(2);
  });
});

describe("editable shortcut targets", () => {
  test("treats native form controls as editable", () => {
    expect(isEditableTarget({ tagName: "INPUT" } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: "textarea" } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: "select" } as unknown as EventTarget)).toBe(true);
  });

  test("treats contenteditable and ARIA textbox descendants as editable", () => {
    expect(isEditableTarget({ isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({
      closest: (selector: string) => selector.includes("[role='textbox']") ? {} : null,
      tagName: "SPAN",
    } as unknown as EventTarget)).toBe(true);
  });

  test("ignores ordinary controls", () => {
    expect(isEditableTarget({
      closest: () => null,
      isContentEditable: false,
      tagName: "BUTTON",
    } as unknown as EventTarget)).toBe(false);
  });
});
