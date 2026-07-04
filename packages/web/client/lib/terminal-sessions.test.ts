import { describe, expect, test } from "bun:test";
import type { TerminalSessionRecord } from "@openscout/protocol";
import {
  compactTerminalPath,
  resolveRegisteredTerminalTarget,
  terminalListItems,
} from "./terminal-sessions.ts";

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

describe("terminal list metadata", () => {
  test("surfaces project and thread context for table rows", () => {
    const [item] = terminalListItems([{
      ...terminalSession("ts.context", "tmux", "relay-openscout-main-arts-mac-mini-local-claude"),
      harness: "claude",
      sourceSessionId: "source-session-1",
      cwd: "/Users/art/dev/openscout",
      metadata: {
        project: "OpenScout",
        threadId: "thread-123",
        currentCommand: "claude",
        currentPath: "/Users/art/dev/openscout",
      },
    }]);

    expect(item?.project).toBe("OpenScout");
    expect(item?.contextKind).toBe("thread");
    expect(item?.contextValue).toBe("thread-123");
    expect(item?.cwdLabel).toBe("dev/openscout");
    expect(item?.searchable).toContain("thread-123");
    expect(item?.searchable).toContain("claude");
  });

  test("derives compact cwd labels", () => {
    expect(compactTerminalPath("/Users/art/dev/openscout/")).toBe("dev/openscout");
  });
});
