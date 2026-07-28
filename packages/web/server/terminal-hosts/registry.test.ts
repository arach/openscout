import { describe, expect, test } from "bun:test";

import { parseTerminalSurfaceId } from "@openscout/protocol";

import {
  DEFAULT_TERMINAL_HOST_ID,
  isKnownTerminalHost,
  resolveTerminalHostAdapter,
  terminalHostAdapter,
  terminalHostAdapters,
  terminalHostSupportsControl,
  TERMINAL_HOST_ADAPTERS,
} from "./registry.ts";
import type { TerminalHostControlAction } from "./types.ts";

const ALL_ACTIONS: TerminalHostControlAction[] = [
  "interrupt",
  "quit",
  "stop-job",
  "restart-resume",
  "detach",
  "force-quit",
  "force-quit-bridge",
];

describe("terminal host registry", () => {
  test("resolves registered hosts and falls back to the declared default", () => {
    expect(terminalHostAdapter("zellij")?.id).toBe("zellij");
    expect(terminalHostAdapter("herdr")?.id).toBe("herdr");
    expect(terminalHostAdapter("nope")).toBeNull();
    expect(terminalHostAdapter(undefined)).toBeNull();
    // Unknown hosts land on a NAMED default, not on whatever the last if/else
    // happened to fall through to.
    expect(resolveTerminalHostAdapter("nope").id).toBe(DEFAULT_TERMINAL_HOST_ID);
    expect(resolveTerminalHostAdapter(null).id).toBe(DEFAULT_TERMINAL_HOST_ID);
  });

  test("every adapter is keyed by its own id", () => {
    for (const [key, adapter] of Object.entries(TERMINAL_HOST_ADAPTERS)) {
      expect(adapter.id).toBe(key);
      expect(isKnownTerminalHost(key)).toBe(true);
    }
  });

  test("an adapter implements exactly the methods its capabilities claim", () => {
    for (const adapter of terminalHostAdapters()) {
      const { capabilities } = adapter;
      expect(typeof adapter.probe).toBe("function");
      expect(typeof adapter.list).toBe("function");
      expect(typeof adapter.surface).toBe("function");
      expect(Boolean(adapter.create)).toBe(capabilities.create);
      expect(Boolean(adapter.capture)).toBe(capabilities.capture);
      expect(Boolean(adapter.observedAgents)).toBe(capabilities.observedAgentState);
      expect(Boolean(adapter.control)).toBe(capabilities.control.length > 0);
      // A verb cannot be claimed twice; "via" must be unambiguous.
      for (const action of capabilities.harnessControl) {
        expect(capabilities.control).not.toContain(action);
      }
    }
  });

  test("the capability matrix is the one the hosts actually implement", () => {
    const matrix = Object.fromEntries(terminalHostAdapters().map((adapter) => [adapter.id, {
      relayAttach: adapter.capabilities.relayAttach,
      capture: adapter.capabilities.capture,
      create: adapter.capabilities.create,
      observedAgentState: adapter.capabilities.observedAgentState,
      control: adapter.capabilities.control,
      harnessControl: adapter.capabilities.harnessControl,
    }]));

    expect(matrix).toEqual({
      tmux: {
        relayAttach: true,
        capture: true,
        create: true,
        observedAgentState: false,
        control: ["interrupt", "quit", "detach", "force-quit-bridge"],
        harnessControl: ["stop-job", "restart-resume", "force-quit"],
      },
      zellij: {
        relayAttach: true,
        capture: true,
        create: true,
        observedAgentState: false,
        control: ["interrupt", "quit", "detach", "force-quit-bridge"],
        harnessControl: [],
      },
      herdr: {
        // The relay is vendored and knows pty/tmux/zellij only.
        relayAttach: false,
        capture: true,
        // Herdr owns workspaces, tabs, and panes; Scout does not create them.
        create: false,
        // The one host that reports agent state instead of Scout inferring it.
        observedAgentState: true,
        // Scout detaches from a herdr session; Scout never kills it.
        control: ["detach", "force-quit-bridge"],
        harnessControl: [],
      },
    });
  });

  test("support answers which route a verb takes, or that there is none", () => {
    expect(terminalHostSupportsControl("tmux", "interrupt")).toEqual({ supported: true, via: "host" });
    expect(terminalHostSupportsControl("tmux", "restart-resume")).toEqual({ supported: true, via: "harness" });
    expect(terminalHostSupportsControl("zellij", "interrupt")).toEqual({ supported: true, via: "host" });
    expect(terminalHostSupportsControl("zellij", "restart-resume")).toEqual({ supported: false, via: null });
    expect(terminalHostSupportsControl("herdr", "detach")).toEqual({ supported: true, via: "host" });
    expect(terminalHostSupportsControl("herdr", "force-quit")).toEqual({ supported: false, via: null });
    expect(terminalHostSupportsControl("nope", "detach")).toEqual({ supported: false, via: null });
  });

  test("every host answers every verb without throwing", () => {
    for (const adapter of terminalHostAdapters()) {
      for (const action of ALL_ACTIONS) {
        expect(typeof terminalHostSupportsControl(adapter.id, action).supported).toBe("boolean");
      }
    }
  });
});

describe("adapter surfaces", () => {
  test("carry an opaque surface id that resolves to their own host", () => {
    for (const adapter of terminalHostAdapters()) {
      const surface = adapter.surface({ name: "scout-example", state: "live" });
      expect(parseTerminalSurfaceId(surface.surfaceId)).toEqual({
        backend: adapter.id,
        hostSession: "scout-example",
        paneId: null,
        nodeId: null,
      });
      expect(surface.attachCommand.length).toBeGreaterThan(0);
      // Server-local socket paths must never ride out on a discovered record.
      expect(JSON.stringify(surface)).not.toContain(".sock");
    }
  });

  test("a host with no read-only view does not advertise an observe command", () => {
    const herdr = terminalHostAdapter("herdr")!;
    expect(herdr.capabilities.observe).toBe(false);
    expect(herdr.surface({ name: "scout-local-1", state: "detached" }).observeCommand).toBeNull();
    expect(terminalHostAdapter("tmux")!.surface({ name: "a", state: "live" }).observeCommand).not.toBeNull();
  });

  test("herdr attaches to the default session without naming it", () => {
    const herdr = terminalHostAdapter("herdr")!;
    expect(herdr.surface({ name: "default", state: "live" }).attachCommand).toEqual(["herdr"]);
    expect(herdr.surface({ name: "scout-local-1", state: "detached" }).attachCommand)
      .toEqual(["herdr", "session", "attach", "scout-local-1"]);
  });
});

describe("host probes", () => {
  test("report a missing binary as not installed rather than throwing", async () => {
    const adapter = terminalHostAdapter("tmux")!;
    const availability = await adapter.probe({
      // An empty PATH makes every host unreachable, which is the state an
      // adapter for a host nobody installed has to survive.
      env: { ...process.env, PATH: "/nonexistent-scout-probe" },
    });
    expect(availability.installed).toBe(false);
    expect(availability.reason).toBeTruthy();
  });

  test("a host with no sessions lists nothing instead of failing", async () => {
    for (const adapter of terminalHostAdapters()) {
      const sessions = await adapter.list({ env: { ...process.env, PATH: "/nonexistent-scout-probe" } });
      expect(Array.isArray(sessions)).toBe(true);
    }
  });
});
