import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const useTerminalRelayMock = mock(() => ({
  status: "disconnected" as const,
  sessionId: null,
  error: null,
  exitCode: null,
  cwd: "~",
  setCwd: () => {},
  onData: () => {},
  sendInput: () => {},
  sendLine: () => {},
  resize: () => {},
  connect: () => {},
  disconnect: () => {},
  restart: () => {},
}));

mock.module("@hudson/sdk", () => ({
  useTerminalRelay: useTerminalRelayMock,
  TerminalRelay: () => createElement("div"),
}));

mock.module(new URL("./scout/Provider.tsx", import.meta.url).pathname, () => ({
  useScout: () => ({
    agents: [],
  }),
}));

const { ScoutTerminal } = await import("./scout/slots/Terminal.tsx");
const { TerminalScreen } = await import("./screens/TerminalScreen.tsx");

describe("terminal relay config", () => {
  test("ScoutTerminal auto-connects its relay", () => {
    useTerminalRelayMock.mockClear();

    renderToStaticMarkup(createElement(ScoutTerminal));

    expect(useTerminalRelayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        autoConnect: true,
        sessionKey: "scout-terminal",
      }),
    );
  });

  test("TerminalScreen auto-connects takeover sessions", () => {
    useTerminalRelayMock.mockClear();

    renderToStaticMarkup(createElement(TerminalScreen, {
      agentId: "agent-1",
      navigate: () => {},
    }));

    expect(useTerminalRelayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        autoConnect: true,
        sessionKey: "scout-takeover-agent-1",
      }),
    );
  });
});
