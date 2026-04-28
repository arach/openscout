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

function installWindow(bootstrap?: {
  routes?: {
    terminalRelayPath?: string;
    terminalRelayHealthPath?: string;
  };
}) {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __OPENSCOUT_WEB_BOOTSTRAP__: bootstrap,
      location: {
        protocol: "https:",
        host: "scout.test",
      },
    },
  });
}

describe("terminal relay config", () => {
  test("ScoutTerminal auto-connects its relay", () => {
    useTerminalRelayMock.mockClear();
    installWindow();

    renderToStaticMarkup(createElement(ScoutTerminal));

    expect(useTerminalRelayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        autoConnect: true,
        healthUrl: "https://scout.test/ws/terminal/health",
        sessionKey: "scout-terminal",
        url: "wss://scout.test/ws/terminal",
      }),
    );
  });

  test("TerminalScreen auto-connects takeover sessions", () => {
    useTerminalRelayMock.mockClear();
    installWindow({
      routes: {
        terminalRelayPath: "/ws/relay",
        terminalRelayHealthPath: "/api/relay-health",
      },
    });

    renderToStaticMarkup(createElement(TerminalScreen, {
      agentId: "agent-1",
      navigate: () => {},
    }));

    expect(useTerminalRelayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        autoConnect: true,
        healthUrl: "https://scout.test/api/relay-health",
        sessionKey: "scout-takeover-agent-1",
        url: "wss://scout.test/ws/relay",
      }),
    );
  });

  test("SSR falls back to the default terminal relay path", () => {
    useTerminalRelayMock.mockClear();
    Reflect.deleteProperty(globalThis, "window");

    renderToStaticMarkup(createElement(ScoutTerminal));

    expect(useTerminalRelayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        healthUrl: "http://localhost:3200/ws/terminal/health",
        url: "ws://localhost:3200/ws/terminal",
      }),
    );
  });
});
