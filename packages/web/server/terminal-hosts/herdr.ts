import {
  buildHerdrAttachCommand,
  execSystemFile,
  herdrSessionsProbe,
  parseHerdrAgentList,
} from "@openscout/runtime/system-probes";
import { formatTerminalSurfaceId } from "@openscout/protocol";
import type { TerminalSurface } from "@openscout/protocol";

import { errorReason, probeCommand } from "./tmux.ts";
import type {
  TerminalHostAdapter,
  TerminalHostContext,
  TerminalHostControlResult,
  TerminalHostSession,
} from "./types.ts";

const HERDR_TIMEOUT_MS = 2_000;

export const herdrTerminalHost: TerminalHostAdapter = {
  id: "herdr",
  label: "Herdr",
  description: "Persistent agent workspace that survives closing this window",
  capabilities: {
    attach: true,
    relayAttach: false,
    // Herdr has no read-only attach; `agent read` is a capture, not a view.
    observe: false,
    sendInput: true,
    capture: true,
    // Scout does not create herdr sessions headlessly. Herdr already owns
    // workspaces, tabs, and panes; Scout's layer is coordination over whatever
    // host is present, not a second layout manager.
    create: false,
    list: true,
    // The whole reason to prefer herdr: `herdr agent wait --status` answers the
    // question tmux delivery verification infers from rendered TUI frames.
    observedAgentState: true,
    // A herdr host session outlives the Scout client attached to it. Scout
    // detaches; Scout never kills the host. That is a declared boundary, not a
    // route that 400s after the operator has already clicked.
    control: ["detach", "force-quit-bridge"],
    harnessControl: [],
  },

  async probe(context = {}) {
    return probeCommand("herdr", ["--version"], context);
  },

  async list(context = {}) {
    const snapshot = await herdrSessionsProbe.for({ env: context.env ?? process.env }).fresh();
    return (snapshot.value ?? []).map((session): TerminalHostSession => ({
      name: session.name,
      // A herdr session that is not running still exists and still reattaches;
      // it is detached, not exited.
      state: session.running ? "live" : "detached",
      metadata: { isDefault: session.isDefault, running: session.running },
    }));
  },

  surface(session): TerminalSurface {
    const isDefault = session.metadata?.isDefault === true || session.name === "default";
    return {
      surfaceId: formatTerminalSurfaceId({ backend: "herdr", hostSession: session.name }),
      backend: "herdr",
      sessionName: session.name,
      paneId: session.paneId ?? null,
      attachCommand: buildHerdrAttachCommand({ name: session.name, isDefault }),
      observeCommand: null,
      relay: { backend: "herdr", sessionName: session.name },
      state: session.state,
    };
  },

  async control(action, target, context = {}): Promise<TerminalHostControlResult> {
    if (action !== "detach") {
      return { delivered: false, reason: `herdr sessions outlive Scout; ${action} is not offered` };
    }
    try {
      await execSystemFile("herdr", ["agent", "focus", target.sessionName], {
        timeoutMs: HERDR_TIMEOUT_MS,
        env: context.env,
      });
      return { delivered: true };
    } catch (error) {
      return { delivered: false, reason: errorReason(error) };
    }
  },

  async capture(target, context = {}) {
    try {
      const { stdout } = await execSystemFile("herdr", [
        "agent",
        "read",
        target.sessionName,
        "--source",
        "visible",
        "--format",
        "text",
      ], { timeoutMs: HERDR_TIMEOUT_MS, env: context.env, maxStdoutBytes: 1024 * 1024 });
      return stdout;
    } catch {
      return null;
    }
  },

  async observedAgents(target, context = {}) {
    try {
      const { stdout } = await execSystemFile("herdr", ["agent", "list"], {
        timeoutMs: HERDR_TIMEOUT_MS,
        env: { ...(context.env ?? process.env), HERDR_SESSION: target.sessionName },
        maxStdoutBytes: 256 * 1024,
      });
      return parseHerdrAgentList(stdout);
    } catch {
      // The session's herdr server is not running. That is an ordinary state,
      // not a failure: report no observed agents and let the caller fall back.
      return [];
    }
  },
};
