import { spawn } from "node:child_process";

import type { HostAgentActionAdapter } from "../protocol.js";
import type { AgentActionRequest, AgentActionResult } from "../../agent-actions/protocol.js";
import { buildAgentActionCommand, parseAgentActionResult } from "../shared/agent-action-command.js";

interface ClaudeExploreAgentActionOptions {
  request: AgentActionRequest;
  cwd?: string;
  claudeBinary?: string;
}

function buildClaudeExplorePrompt(command: string): string {
  return [
    "You are a thin agent invocation wrapper.",
    "Do not answer from your own knowledge.",
    "Run exactly one Bash command and return only the command's JSON output as your final response.",
    "",
    command,
  ].join("\n");
}

export async function invokeClaudeExploreAgentAction(
  options: ClaudeExploreAgentActionOptions,
): Promise<AgentActionResult> {
  const claudeBinary = options.claudeBinary ?? "claude";
  const cwd = options.cwd ?? process.cwd();
  const command = buildAgentActionCommand(options.request);
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

  return new Promise<AgentActionResult>((resolvePromise, reject) => {
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
        resolvePromise(parseAgentActionResult(stdout));
      } catch (error) {
        reject(
          new Error(
            `failed to parse Claude agent action output: ${
              error instanceof Error ? error.message : String(error)
            }\n${stdout.trim()}`,
          ),
        );
      }
    });
  });
}

export function createClaudeExploreAgentActionAdapter(
  cwd?: string,
): HostAgentActionAdapter {
  return {
    host: "claude",
    invokeAgentAction(request: AgentActionRequest): Promise<AgentActionResult> {
      return invokeClaudeExploreAgentAction({ request, cwd });
    },
  };
}
