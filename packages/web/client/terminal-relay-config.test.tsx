import { describe, expect, mock, test } from "bun:test";

const React = await import("../node_modules/react/index.js");
const ReactJsxRuntime = await import("../node_modules/react/jsx-runtime.js");
const ReactJsxDevRuntime = await import("../node_modules/react/jsx-dev-runtime.js");
const ReactDomServer = await import("../node_modules/react-dom/server.node.js");
const { createElement } = React;
const { renderToStaticMarkup } = ReactDomServer;

mock.module("react", () => React);
mock.module("react/jsx-runtime", () => ReactJsxRuntime);
mock.module("react/jsx-dev-runtime", () => ReactJsxDevRuntime);
mock.module("react-dom/server", () => ReactDomServer);

let terminalRelayProps: { relay?: { sendInput?: (value: string) => void; sendLine?: (value: string) => void; restart?: () => void } } | null = null;
const baseRelaySendInput = mock((_value: string) => {});
const baseRelaySendLine = mock((_value: string) => {});
const baseRelayRestart = mock(() => {});

const useTerminalRelayMock = mock(() => ({
  status: "disconnected" as const,
  sessionId: null,
  error: null,
  exitCode: null,
  cwd: "~",
  setCwd: () => {},
  onData: () => {},
  sendInput: baseRelaySendInput,
  sendLine: baseRelaySendLine,
  resize: () => {},
  connect: () => {},
  disconnect: () => {},
  restart: baseRelayRestart,
}));

let scoutAgents: unknown[] = [];

mock.module("@hudsonkit", () => ({
  useTerminalRelay: useTerminalRelayMock,
  TerminalRelay: (props: { relay?: unknown }) => {
    terminalRelayProps = props as typeof terminalRelayProps;
    return createElement("div");
  },
}));

mock.module(new URL("./scout/Provider.tsx", import.meta.url).pathname, () => ({
  useScout: () => ({
    agents: scoutAgents,
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
    terminalRelayProps = null;
    scoutAgents = [];
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
    terminalRelayProps = null;
    scoutAgents = [{
      id: "agent-1",
      name: "Agent One",
      handle: null,
      transport: "bridge",
      harness: "codex",
      harnessSessionId: null,
      cwd: "/tmp/agent-1",
      projectRoot: "/tmp/agent-1",
    }];
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
        url: "wss://scout.test/ws/relay?agentId=agent-1",
      }),
    );
  });

  test("TerminalScreen attaches tmux-backed agents to their tmux session", () => {
    useTerminalRelayMock.mockClear();
    terminalRelayProps = null;
    scoutAgents = [{
      id: "agent-1",
      name: "Agent One",
      handle: null,
      transport: "tmux",
      harness: "claude",
      harnessSessionId: "relay-agent-1-claude",
      cwd: "/tmp/agent-1",
      projectRoot: "/tmp/agent-1",
    }];
    installWindow();

    renderToStaticMarkup(createElement(TerminalScreen, {
      agentId: "agent-1",
      navigate: () => {},
    }));

    expect(useTerminalRelayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        autoConnect: true,
        backend: "tmux",
        healthUrl: "https://scout.test/ws/terminal/health",
        sessionKey: "scout-tmux-agent-1-relay-agent-1-claude",
        tmuxSession: "relay-agent-1-claude",
        url: "wss://scout.test/ws/terminal?agentId=agent-1",
      }),
    );
  });

  test("TerminalScreen attaches terminal-surface agents to zellij sessions", () => {
    useTerminalRelayMock.mockClear();
    terminalRelayProps = null;
    scoutAgents = [{
      id: "agent-1",
      name: "Agent One",
      handle: null,
      transport: "claude_stream_json",
      harness: "claude",
      harnessSessionId: "source-session-1",
      terminalSurface: {
        backend: "zellij",
        sessionName: "scout-zj-source-session-1",
        paneId: "terminal_0",
        socketDir: "/Users/test/.openscout/zellij-sockets",
      },
      cwd: "/tmp/agent-1",
      projectRoot: "/tmp/agent-1",
    }];
    installWindow();

    renderToStaticMarkup(createElement(TerminalScreen, {
      agentId: "agent-1",
      navigate: () => {},
    }));

    expect(useTerminalRelayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        autoConnect: true,
        backend: "zellij",
        healthUrl: "https://scout.test/ws/terminal/health",
        sessionKey: "scout-terminal-zellij-agent-1-scout-zj-source-session-1",
        terminalSession: "scout-zj-source-session-1",
        zellijSession: "scout-zj-source-session-1",
        zellijSocketDir: "/Users/test/.openscout/zellij-sockets",
        url: "wss://scout.test/ws/terminal?agentId=agent-1",
      }),
    );
  });

  test("TerminalScreen makes tmux observe mode read-only", () => {
    useTerminalRelayMock.mockClear();
    baseRelaySendInput.mockClear();
    baseRelaySendLine.mockClear();
    baseRelayRestart.mockClear();
    terminalRelayProps = null;
    scoutAgents = [{
      id: "agent-1",
      name: "Agent One",
      handle: null,
      transport: "tmux",
      harness: "claude",
      harnessSessionId: "relay-agent-1-claude",
      cwd: "/tmp/agent-1",
      projectRoot: "/tmp/agent-1",
    }];
    installWindow();

    renderToStaticMarkup(createElement(TerminalScreen, {
      agentId: "agent-1",
      mode: "observe",
      navigate: () => {},
    }));

    expect(terminalRelayProps?.relay).toBeTruthy();
    terminalRelayProps?.relay?.sendInput?.("whoami");
    terminalRelayProps?.relay?.sendLine?.("whoami");
    terminalRelayProps?.relay?.restart?.();

    expect(baseRelaySendInput).not.toHaveBeenCalled();
    expect(baseRelaySendLine).not.toHaveBeenCalled();
    expect(baseRelayRestart).not.toHaveBeenCalled();
  });

  test("SSR falls back to the default terminal relay path", () => {
    useTerminalRelayMock.mockClear();
    terminalRelayProps = null;
    scoutAgents = [];
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
