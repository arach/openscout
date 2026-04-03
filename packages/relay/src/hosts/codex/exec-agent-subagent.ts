import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import type { HostAgentActionAdapter } from "../protocol.js";
import type { AgentActionRequest, AgentActionResult } from "../../agent-actions/protocol.js";
import { buildAgentActionCommand, parseAgentActionResult } from "../shared/agent-action-command.js";

interface CodexExecAgentActionOptions {
  request: AgentActionRequest;
  cwd?: string;
  codexBinary?: string;
}

function buildCodexPrompt(command: string): string {
  return [
    "You are a thin agent invocation wrapper.",
    "Do not answer from your own knowledge.",
    "Run exactly one shell command and return only the command's JSON output as your final response.",
    "",
    command,
  ].join("\n");
}

export async function invokeCodexExecAgentAction(
  options: CodexExecAgentActionOptions,
): Promise<AgentActionResult> {
  const codexBinary = options.codexBinary ?? "codex";
  const cwd = options.cwd ?? process.cwd();
  const relayHome = join(homedir(), ".openscout");
  const command = buildAgentActionCommand(options.request);
  const prompt = buildCodexPrompt(command);
  const tempDir = await mkdtemp(join(tmpdir(), "relay-codex-"));
  const outputFile = join(tempDir, "last-message.txt");

  const args = [
    "-a",
    "never",
    "exec",
    "-C",
    cwd,
    "-s",
    "workspace-write",
    "--skip-git-repo-check",
    "--add-dir",
    relayHome,
    "--color",
    "never",
    "-o",
    outputFile,
    prompt,
  ];

  try {
    return await new Promise<AgentActionResult>((resolvePromise, reject) => {
      const child = spawn(codexBinary, args, {
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

      child.on("close", async (code) => {
        try {
          if (code !== 0) {
            reject(new Error(stderr.trim() || stdout.trim() || `codex exited with code ${code}`));
            return;
          }

          const output = await readFile(outputFile, "utf8");
          resolvePromise(parseAgentActionResult(output));
        } catch (error) {
          reject(
            new Error(
              `failed to parse Codex agent action output: ${
                error instanceof Error ? error.message : String(error)
              }\n${stdout.trim()}`,
            ),
          );
        }
      });
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export function createCodexExecAgentActionAdapter(
  cwd?: string,
): HostAgentActionAdapter {
  return {
    host: "codex",
    invokeAgentAction(request: AgentActionRequest): Promise<AgentActionResult> {
      return invokeCodexExecAgentAction({ request, cwd });
    },
  };
}
