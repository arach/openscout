import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodexExecutable } from "@openscout/agent-sessions/codex-executable";
import type {
  AgentDefinition,
  AgentEndpoint,
  InvocationRequest,
} from "@openscout/protocol";

import {
  buildCollaborationContractPrompt,
  buildInvocationCollaborationContextPrompt,
} from "./collaboration-contract.js";

interface LocalCodexInvocationOptions {
  agent: AgentDefinition;
  endpoint: AgentEndpoint;
  invocation: InvocationRequest;
}

function metadataValue(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function metadataString(endpoint: AgentEndpoint, key: string): string | undefined {
  return metadataValue(endpoint.metadata, key);
}

function roleGuidance(agent: AgentDefinition): string {
  switch (agent.agentClass) {
    case "builder":
      return "Focus on implementation. When the action is execute, make the necessary code changes and summarize concrete results.";
    case "reviewer":
      return "Focus on review quality. Lead with bugs, risks, regressions, or missing tests before any summary.";
    case "researcher":
      return "Focus on discovery and supporting evidence. Summarize the relevant context and open questions clearly.";
    case "operator":
      return "Act as a general-purpose operator agent. Clarify the next best move and coordinate work pragmatically.";
    default:
      return "Act as a concise, useful local agent and respond directly to the requested task.";
  }
}

function buildPrompt(agent: AgentDefinition, invocation: InvocationRequest): string {
  const role = metadataValue(agent.metadata, "role");
  const summary = metadataValue(agent.metadata, "summary");
  const contextLines = Object.entries(invocation.context ?? {})
    .map(([key, value]) => `- ${key}: ${String(value)}`)
    .join("\n");
  const collaborationContract = buildCollaborationContractPrompt(agent.id);
  const collaborationContext = buildInvocationCollaborationContextPrompt(invocation);
  const actionRules = invocation.action === "execute"
    ? "You may inspect and modify the workspace when needed. End with a concise summary of what changed, what remains, and any blockers."
    : "Do not modify files. Read, inspect, and respond in text only.";

  return [
    `You are OpenScout agent "${agent.displayName}" (id: ${agent.id}).`,
    role ? `Role: ${role}` : undefined,
    summary ? `Summary: ${summary}` : undefined,
    `Agent class: ${agent.agentClass}.`,
    `Invocation action: ${invocation.action}.`,
    `Requester: ${invocation.requesterId}.`,
    invocation.conversationId ? `Conversation: ${invocation.conversationId}.` : undefined,
    invocation.messageId ? `Message: ${invocation.messageId}.` : undefined,
    "",
    roleGuidance(agent),
    actionRules,
    collaborationContract,
    "Return only the message that should appear back in the OpenScout conversation.",
    "",
    collaborationContext,
    contextLines ? "Context:\n" + contextLines : undefined,
    "Task:",
    invocation.task,
  ]
    .filter((value): value is string => Boolean(value && value.length > 0))
    .join("\n");
}

function buildCodexExecutionEnv(endpoint: AgentEndpoint): NodeJS.ProcessEnv {
  const commandPath = metadataString(endpoint, "commandPath");
  return commandPath
    ? { ...process.env, OPENSCOUT_CODEX_BIN: commandPath }
    : process.env;
}

export async function runLocalCodexInvocation(
  options: LocalCodexInvocationOptions,
): Promise<{ output: string }> {
  const { agent, endpoint, invocation } = options;
  const childEnv = buildCodexExecutionEnv(endpoint);
  const codexExecutable = resolveCodexExecutable(childEnv);
  const workingDirectory = endpoint.cwd ?? endpoint.projectRoot ?? process.cwd();
  const tempDirectory = await mkdtemp(join(tmpdir(), "openscout-agent-"));
  const outputPath = join(tempDirectory, "last-message.txt");
  const prompt = buildPrompt(agent, invocation);
  const timeoutMs = invocation.timeoutMs ?? (invocation.action === "execute" ? 15 * 60_000 : 5 * 60_000);

  const args = [
    "exec",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
    "--color",
    "never",
    "-C",
    workingDirectory,
    "--output-last-message",
    outputPath,
    prompt,
  ];

  try {
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>((resolve, reject) => {
      const child = spawn(codexExecutable, args, {
        cwd: workingDirectory,
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stderr = "";
      let stdout = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        resolve({
          code,
          signal,
          stderr: `${stdout}\n${stderr}`.trim(),
        });
      });
    });

    let output = "";
    try {
      output = (await readFile(outputPath, "utf8")).trim();
    } catch {
      output = "";
    }

    if (result.code !== 0) {
      throw new Error(result.stderr || `Codex exited with code ${result.code ?? "unknown"}${result.signal ? ` (${result.signal})` : ""}.`);
    }

    if (!output) {
      throw new Error("Codex completed without producing a final response.");
    }

    return { output };
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}
