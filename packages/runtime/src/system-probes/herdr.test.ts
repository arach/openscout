import { describe, expect, test } from "bun:test";

import {
  buildHerdrAttachCommand,
  buildHerdrCreateAttachCommand,
  parseHerdrSessionListJson,
} from "./herdr.js";

describe("herdr session helpers", () => {
  test("parses herdr session list JSON", () => {
    expect(parseHerdrSessionListJson(JSON.stringify({
      sessions: [
        {
          default: true,
          name: "default",
          running: true,
          session_dir: "/Users/art/.config/herdr",
          socket_path: "/Users/art/.config/herdr/herdr.sock",
        },
        {
          default: false,
          name: "scout-local-1",
          running: false,
        },
      ],
    }))).toEqual([
      {
        name: "default",
        isDefault: true,
        running: true,
        sessionDir: "/Users/art/.config/herdr",
      },
      {
        name: "scout-local-1",
        isDefault: false,
        running: false,
        sessionDir: null,
      },
    ]);
  });

  test("builds attach commands without socket paths", () => {
    expect(buildHerdrAttachCommand({ name: "default", isDefault: true })).toEqual(["herdr"]);
    expect(buildHerdrAttachCommand({ name: "scout-local-1", isDefault: false })).toEqual([
      "herdr",
      "session",
      "attach",
      "scout-local-1",
    ]);
    expect(buildHerdrCreateAttachCommand("scout-main-1")).toEqual(["herdr", "--session", "scout-main-1"]);
  });
});
