import { describe, expect, test } from "bun:test";
import type { TerminalSessionRecord } from "@openscout/protocol";
import { resolveRegisteredTerminalTarget } from "./terminal-sessions.ts";

function terminalSession(
  id: string,
  backend: "tmux" | "zellij",
  sessionName: string,
): TerminalSessionRecord {
  return {
    id,
    harness: backend,
    sourceSessionId: sessionName,
    cwd: "",
    resumeCommand: `${backend} attach ${sessionName}`,
    surfaces: [{
      backend,
      sessionName,
      paneId: null,
      attachCommand: [backend, "attach", sessionName],
      observeCommand: null,
      relay: { backend, sessionName },
      state: "live",
    }],
    createdAt: 1,
    updatedAt: 1,
    metadata: {},
  };
}

describe("terminal session resolution", () => {
  test("resolves backend/session path links by surface key", () => {
    const target = resolveRegisteredTerminalTarget(
      [terminalSession("discovered.zellij.1", "zellij", "hudson-dm79928c")],
      undefined,
      "zellij:hudson-dm79928c",
    );

    expect(target?.session.id).toBe("discovered.zellij.1");
    expect(target?.surface.sessionName).toBe("hudson-dm79928c");
  });

  test("falls back to surface key when a remembered session id is stale", () => {
    const target = resolveRegisteredTerminalTarget(
      [
        terminalSession("ts.old", "zellij", "scout-zj-final-7e55c009"),
        terminalSession("discovered.zellij.1", "zellij", "hudson-dm79928c"),
      ],
      "ts.missing",
      "zellij:hudson-dm79928c",
    );

    expect(target?.session.id).toBe("discovered.zellij.1");
    expect(target?.surface.sessionName).toBe("hudson-dm79928c");
  });
});
