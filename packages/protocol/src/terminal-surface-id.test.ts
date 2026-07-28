import { describe, expect, test } from "bun:test";

import {
  formatTerminalSurfaceId,
  isTerminalSurfaceId,
  legacyTerminalSurfaceKey,
  parseTerminalSurfaceId,
  terminalSurfaceIdsEqual,
} from "./terminal-surface-id.js";
import {
  terminalSurfaceIdForSurface,
  terminalSurfaceMatchesId,
  type TerminalSurface,
} from "./terminal-sessions.js";

const surface: TerminalSurface = {
  backend: "tmux",
  sessionName: "relay-openscout-main-arts-mac-mini-local-claude",
  paneId: null,
  attachCommand: ["tmux", "attach", "-t", "relay-openscout-main-arts-mac-mini-local-claude"],
  observeCommand: null,
  relay: { backend: "tmux", sessionName: "relay-openscout-main-arts-mac-mini-local-claude" },
};

describe("terminal surface ids", () => {
  test("round-trips every part of an address", () => {
    const address = {
      backend: "zellij",
      hostSession: "scout-main",
      paneId: "terminal_3",
      nodeId: "node-abc",
    };
    const id = formatTerminalSurfaceId(address);
    expect(isTerminalSurfaceId(id)).toBe(true);
    expect(parseTerminalSurfaceId(id)).toEqual(address);
  });

  test("is deterministic, so two writers converge on one id", () => {
    expect(formatTerminalSurfaceId({ backend: "tmux", hostSession: "a" }))
      .toBe(formatTerminalSurfaceId({ backend: "tmux", hostSession: "a", paneId: null, nodeId: null }));
  });

  test("survives session names that broke the old separator conventions", () => {
    for (const hostSession of ["a:b:c", "with space", "emoji-🌱", "colons::everywhere", "-leading-dash"]) {
      const id = formatTerminalSurfaceId({ backend: "tmux", hostSession });
      expect(parseTerminalSurfaceId(id)?.hostSession).toBe(hostSession);
    }
  });

  test("is URL-safe, so a deep link never encodes backend syntax", () => {
    const id = formatTerminalSurfaceId({ backend: "zellij", hostSession: "a b:c/d?e#f" });
    expect(encodeURIComponent(id)).toBe(id);
  });

  test("distinguishes panes and nodes", () => {
    const base = { backend: "zellij", hostSession: "scout-main" };
    expect(formatTerminalSurfaceId(base)).not.toBe(formatTerminalSurfaceId({ ...base, paneId: "terminal_1" }));
    expect(formatTerminalSurfaceId(base)).not.toBe(formatTerminalSurfaceId({ ...base, nodeId: "node-b" }));
  });

  test("identity does not move when a display name is reused elsewhere", () => {
    expect(formatTerminalSurfaceId({ backend: "tmux", hostSession: "main" }))
      .not.toBe(formatTerminalSurfaceId({ backend: "zellij", hostSession: "main" }));
  });

  test("refuses an address with no backend or no host session", () => {
    expect(() => formatTerminalSurfaceId({ backend: "", hostSession: "a" })).toThrow();
    expect(() => formatTerminalSurfaceId({ backend: "tmux", hostSession: "  " })).toThrow();
  });
});

describe("parseTerminalSurfaceId", () => {
  test("accepts legacy backend:name keys", () => {
    expect(parseTerminalSurfaceId("tmux:relay-main")).toEqual({
      backend: "tmux",
      hostSession: "relay-main",
      paneId: null,
      nodeId: null,
    });
    expect(parseTerminalSurfaceId("herdr:scout-local-1")?.backend).toBe("herdr");
  });

  test("returns null rather than guessing", () => {
    for (const value of [null, undefined, "", "   ", "no-separator", ":leading", "srf1.", "srf1.!!!", "srf1.QQ"]) {
      expect(parseTerminalSurfaceId(value)).toBeNull();
    }
  });

  test("rejects a truncated or re-encoded token instead of half-resolving it", () => {
    const id = formatTerminalSurfaceId({ backend: "tmux", hostSession: "relay-main" });
    expect(parseTerminalSurfaceId(id.slice(0, id.length - 4))).toBeNull();
  });
});

describe("terminalSurfaceIdsEqual", () => {
  test("compares what a handle addresses, not how it was written", () => {
    const opaque = formatTerminalSurfaceId({ backend: "tmux", hostSession: "relay-main" });
    expect(terminalSurfaceIdsEqual(opaque, "tmux:relay-main")).toBe(true);
    expect(terminalSurfaceIdsEqual(opaque, "zellij:relay-main")).toBe(false);
    expect(terminalSurfaceIdsEqual(opaque, null)).toBe(false);
  });
});

describe("terminalSurfaceIdForSurface", () => {
  test("derives the id a legacy record would be issued today", () => {
    expect(terminalSurfaceIdForSurface(surface)).toBe(formatTerminalSurfaceId({
      backend: "tmux",
      hostSession: surface.sessionName,
    }));
  });

  test("prefers a stored id over a derived one", () => {
    expect(terminalSurfaceIdForSurface({ ...surface, surfaceId: "srf1.stored" })).toBe("srf1.stored");
  });

  test("matches its own handle and the legacy key for it", () => {
    expect(terminalSurfaceMatchesId(surface, terminalSurfaceIdForSurface(surface))).toBe(true);
    expect(terminalSurfaceMatchesId(surface, legacyTerminalSurfaceKey({
      backend: "tmux",
      hostSession: surface.sessionName,
    }))).toBe(true);
    expect(terminalSurfaceMatchesId(surface, "tmux:other")).toBe(false);
    expect(terminalSurfaceMatchesId(surface, undefined)).toBe(false);
  });

  test("a pane-scoped handle does not match a session-scoped surface", () => {
    const paneHandle = formatTerminalSurfaceId({
      backend: "tmux",
      hostSession: surface.sessionName,
      paneId: "%3",
    });
    expect(terminalSurfaceMatchesId(surface, paneHandle)).toBe(false);
    expect(terminalSurfaceMatchesId({ ...surface, paneId: "%3" }, paneHandle)).toBe(true);
    // A legacy key names no pane, so it still reaches a pane-scoped surface.
    expect(terminalSurfaceMatchesId({ ...surface, paneId: "%3" }, "tmux:relay-openscout-main-arts-mac-mini-local-claude")).toBe(true);
  });
});
