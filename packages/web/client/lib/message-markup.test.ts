import { describe, expect, test } from "bun:test";

import { normalizeMessageMarkupText, parseMessageMarkup } from "./message-markup.ts";

describe("message markup parsing", () => {
  test("promotes flattened markdown separators and headings to blocks", () => {
    expect(normalizeMessageMarkupText("Intro --- ### 1. Endpoint\nBody")).toBe(
      "Intro\n\n---\n\n### 1. Endpoint\nBody",
    );

    expect(parseMessageMarkup("Intro --- ### 1. Endpoint\nBody")).toEqual([
      { type: "paragraph", text: "Intro" },
      { type: "hr" },
      { type: "heading", depth: 3, text: "1. Endpoint" },
      { type: "paragraph", text: "Body" },
    ]);
  });

  test("keeps common markdown structures as safe renderable blocks", () => {
    expect(parseMessageMarkup([
      "**Summary**",
      "",
      "- one",
      "- two",
      "",
      "| Field | Value |",
      "| --- | --- |",
      "| state | ok |",
      "",
      "```ts",
      "const value = 1;",
      "```",
    ].join("\n"))).toEqual([
      { type: "paragraph", text: "**Summary**" },
      { type: "list", ordered: false, items: ["one", "two"] },
      { type: "table", headers: ["Field", "Value"], rows: [["state", "ok"]] },
      { type: "code", language: "ts", text: "const value = 1;" },
    ]);
  });
});
