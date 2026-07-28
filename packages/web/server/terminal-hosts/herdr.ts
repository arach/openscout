import { spawn } from "node:child_process";

import {
  buildHerdrAttachCommand,
  buildHerdrStartServerCommand,
  buildHerdrWorkspaceCreateCommand,
  execSystemFile,
  herdrSessionsProbe,
  invalidateHerdrSessions,
  parseHerdrAgentList,
  readHerdrSessions,
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
    // `herdr --session <name> server` brings a named session into existence
    // with no terminal attached, and `workspace create` gives it a first
    // workspace. Scout creates the SESSION and stops there: herdr already owns
    // workspaces, tabs, and panes, and Scout's layer is coordination over
    // whatever host is present, not a second layout manager.
    create: true,
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

  async create(input, context = {}) {
    const sessionName = input.sessionName.trim();
    if (!sessionName || sessionName === "default") {
      return { created: false, reason: "the default herdr session is not Scout's to create" };
    }
    const env = context.env ?? process.env;
    try {
      // The session server runs for as long as the session does, so it is
      // spawned detached rather than awaited: awaiting it would hang until the
      // operator stopped the session.
      const [serverBin, ...serverArgs] = buildHerdrStartServerCommand(sessionName);
      spawnDetachedHerdrServer(serverBin!, serverArgs, env);
      await waitForHerdrSession(sessionName, env);
      const [, ...workspaceArgs] = buildHerdrWorkspaceCreateCommand(sessionName, {
        cwd: input.cwd,
        label: "Scout",
      });
      await execSystemFile("herdr", workspaceArgs, { timeoutMs: 5_000, env });
      return { created: true };
    } catch (error) {
      return { created: false, reason: errorReason(error) };
    }
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
        "--session",
        target.sessionName,
        "agent",
        "read",
        target.paneId ?? target.sessionName,
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
      const { stdout } = await execSystemFile("herdr", ["--session", target.sessionName, "agent", "list"], {
        timeoutMs: HERDR_TIMEOUT_MS,
        env: context.env,
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

/**
 * A herdr session server outlives this request by design, so it is spawned
 * detached and unref'd. `execSystemFile` would wait for it to exit.
 */
function spawnDetachedHerdrServer(bin: string, args: string[], env: NodeJS.ProcessEnv): void {
  const child = spawn(bin, args, { env, detached: true, stdio: "ignore" });
  child.unref();
}

/** Wait for the new session to appear before driving it. */
async function waitForHerdrSession(sessionName: string, env: NodeJS.ProcessEnv): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    invalidateHerdrSessions({ env, reason: "herdr.create" });
    const sessions = await readHerdrSessions({ env, maxAgeMs: 0 });
    if (sessions.some((session) => session.name === sessionName)) return;
  }
  throw new Error(`herdr session ${sessionName} did not start`);
}
