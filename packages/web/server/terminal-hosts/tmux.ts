import { captureTmuxPane, execSystemFile, tmuxSessionsProbe } from "@openscout/runtime/system-probes";
import { formatTerminalSurfaceId } from "@openscout/protocol";
import type { TerminalSurface } from "@openscout/protocol";

import type {
  TerminalHostAdapter,
  TerminalHostContext,
  TerminalHostControlResult,
  TerminalHostSession,
} from "./types.ts";

const TMUX_TIMEOUT_MS = 2_000;
/** A `--version` shell-out can take seconds on a loaded machine; a host must
 * not vanish from the UI because the box was briefly busy. */
const HOST_PROBE_TIMEOUT_MS = 5_000;

export const tmuxTerminalHost: TerminalHostAdapter = {
  id: "tmux",
  label: "Tmux",
  description: "Persistent session that survives closing this window",
  capabilities: {
    attach: true,
    relayAttach: true,
    observe: true,
    sendInput: true,
    capture: true,
    create: true,
    list: true,
    // Delivery state is inferred from a rendered composer, not reported.
    observedAgentState: false,
    control: ["interrupt", "quit", "detach", "force-quit-bridge"],
    harnessControl: ["stop-job", "restart-resume", "force-quit"],
  },

  async probe(context = {}) {
    return probeCommand("tmux", ["-V"], context);
  },

  async list(context = {}) {
    const snapshot = await tmuxSessionsProbe.for({ env: context.env ?? process.env }).fresh();
    return (snapshot.value ?? []).map((session): TerminalHostSession => ({
      name: session.name,
      state: "live",
      attachedClients: session.attached,
      cwd: session.currentPath,
      currentCommand: session.currentCommand,
      metadata: {
        windows: session.windows,
        ...(session.createdAt ? { startedAt: session.createdAt * 1000 } : {}),
      },
    }));
  },

  surface(session): TerminalSurface {
    return {
      surfaceId: formatTerminalSurfaceId({ backend: "tmux", hostSession: session.name }),
      backend: "tmux",
      sessionName: session.name,
      paneId: session.paneId ?? null,
      attachCommand: ["tmux", "attach", "-t", session.name],
      observeCommand: ["tmux", "attach", "-t", session.name, "-r"],
      relay: { backend: "tmux", sessionName: session.name, tmuxSession: session.name },
      state: session.state,
    };
  },

  async create(input, context = {}) {
    try {
      await execSystemFile("tmux", [
        "new-session",
        "-d",
        "-s",
        input.sessionName,
        ...(input.cwd ? ["-c", input.cwd] : []),
      ], { timeoutMs: 5_000, env: context.env });
      return { created: true };
    } catch (error) {
      return { created: false, reason: errorReason(error) };
    }
  },

  async control(action, target, context = {}): Promise<TerminalHostControlResult> {
    try {
      switch (action) {
        case "interrupt":
          await execSystemFile("tmux", ["send-keys", "-t", target.sessionName, "C-c"], {
            timeoutMs: TMUX_TIMEOUT_MS,
            env: context.env,
          });
          return { delivered: true };
        case "quit":
          await execSystemFile("tmux", ["send-keys", "-t", target.sessionName, "C-d"], {
            timeoutMs: TMUX_TIMEOUT_MS,
            env: context.env,
          });
          return { delivered: true };
        case "detach":
          await execSystemFile("tmux", ["detach-client", "-s", target.sessionName], {
            timeoutMs: TMUX_TIMEOUT_MS,
            env: context.env,
          });
          return { delivered: true };
        default:
          return { delivered: false, reason: `tmux does not perform ${action}` };
      }
    } catch (error) {
      return { delivered: false, reason: errorReason(error) };
    }
  },

  async capture(target) {
    const lines = Math.max(1, Math.min(500, target.lines ?? 40));
    return captureTmuxPane(target.paneId ?? target.sessionName, {
      start: `-${lines}`,
      end: "-",
      maxBytes: 1024 * 1024,
    });
  },
};

export async function probeCommand(
  file: string,
  args: readonly string[],
  context: TerminalHostContext,
): Promise<{ installed: boolean; version?: string | null; reason?: string | null }> {
  try {
    const { stdout } = await execSystemFile(file, args, {
      timeoutMs: HOST_PROBE_TIMEOUT_MS,
      env: context.env,
    });
    return { installed: true, version: stdout.trim().split(/\r?\n/u)[0] ?? null };
  } catch (error) {
    return { installed: false, version: null, reason: errorReason(error) ?? `${file} is not installed` };
  }
}

export function errorReason(error: unknown): string | null {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return null;
}
