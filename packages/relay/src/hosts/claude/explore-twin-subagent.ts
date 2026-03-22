import { spawn } from "node:child_process";

import type { HostTwinActionAdapter } from "../protocol.js";
import type { TwinActionRequest, TwinActionResult } from "../../twin-actions/protocol.js";
import { buildTwinActionCommand, parseTwinActionResult } from "../shared/twin-action-command.js";

interface ClaudeExploreTwinActionOptions {
  request: TwinActionRequest;
  cwd?: string;
  claudeBinary?: string;
}

function buildClaudeExplorePrompt(command: string): string {
  return [
    "You are a thin twin invocation wrapper.",
    "Do not answer from your own knowledge.",
    "Run exactly one Bash command and return only the command's JSON output as your final response.",
    "",
    command,
  ].join("\n");
}

export async function invokeClaudeExploreTwinAction(
  options: ClaudeExploreTwinActionOptions,
): Promise<TwinActionResult> {
  const claudeBinary = options.claudeBinary ?? "claude";
  const cwd = options.cwd ?? process.cwd();
  const command = buildTwinActionCommand(options.request);
  const prompt = buildClaudeExplorePrompt(command);

  const args = [
    "-p",
    "--bare",
    "--agent",
    "Explore",
    "--effort",
    "low",
    "--tools",
    "Bash",
    "--allowedTools",
    "Bash(bun:*)",
    "--permission-mode",
    "bypassPermissions",
    prompt,
  ];

  return new Promise<TwinActionResult>((resolvePromise, reject) => {
    const child = spawn(claudeBinary, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `claude exited with code ${code}`));
        return;
      }

      try {
        resolvePromise(parseTwinActionResult(stdout));
      } catch (error) {
        reject(
          new Error(
            `failed to parse Claude twin action output: ${
              error instanceof Error ? error.message : String(error)
            }\n${stdout.trim()}`,
          ),
        );
      }
    });
  });
}

export function createClaudeExploreTwinActionAdapter(
  cwd?: string,
): HostTwinActionAdapter {
  return {
    host: "claude",
    invokeTwinAction(request: TwinActionRequest): Promise<TwinActionResult> {
      return invokeClaudeExploreTwinAction({ request, cwd });
    },
  };
}
