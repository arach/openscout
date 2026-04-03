import type { LocalAgentRuntime } from "../core/protocol/local-agents.js";
import type {
  AgentActionRequest,
  AgentActionResult,
  AgentActionRunner,
} from "./protocol.js";

function buildAgentActionPrompt(request: AgentActionRequest): string {
  const input = request.input?.trim() ?? "";

  switch (request.action) {
    case "consult":
      return input;
    case "execute":
      return [
        "Execute this task for the project and report the concrete outcome.",
        "",
        input,
      ].join("\n");
    case "summarize":
      return [
        "Summarize the current project state.",
        input ? "" : undefined,
        input || undefined,
      ].filter(Boolean).join("\n");
    default:
      return input;
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function createLocalAgentActionRunner(
  runtime: LocalAgentRuntime,
): AgentActionRunner {
  return {
    async invokeAgentAction(request: AgentActionRequest): Promise<AgentActionResult> {
      const mode = request.mode ?? "persistent";
      try {
        const respondedAt = nowSeconds();

        if (mode !== "persistent") {
          return {
            agentId: request.agentId,
            action: request.action,
            mode,
            ok: false,
            output: "ephemeral local-agent actions are not implemented yet",
            respondedAt,
            runner: "local-agent-runtime",
            transport: "relay",
          };
        }

        if (request.action === "status") {
          const localAgents = await runtime.loadLocalAgents();
          const localAgent = localAgents[request.agentId];
          if (!localAgent) {
            return {
              agentId: request.agentId,
              action: request.action,
              mode,
              ok: false,
              output: `agent "${request.agentId}" is not registered`,
              respondedAt,
              runner: "local-agent-runtime",
              transport: "relay",
            };
          }

          const alive = await runtime.isLocalAgentAlive(request.agentId);
          return {
            agentId: request.agentId,
            action: request.action,
            mode,
            ok: true,
            output: alive
              ? `${request.agentId} is running (${localAgent.runtime})`
              : `${request.agentId} is registered but offline`,
            respondedAt,
            runner: "local-agent-runtime",
            transport: "relay",
            metadata: {
              alive,
              project: localAgent.project,
              projectRoot: localAgent.projectRoot,
              runtime: localAgent.runtime,
              protocol: localAgent.protocol,
              tmuxSession: localAgent.tmuxSession,
            },
          };
        }

        if (request.action === "tick") {
          const reason = request.input?.trim() || "host tick";
          const ok = await runtime.tickLocalAgent(request.agentId, reason);
          return {
            agentId: request.agentId,
            action: request.action,
            mode,
            ok,
            output: ok
              ? `agent "${request.agentId}" ticked`
              : `agent "${request.agentId}" could not be ticked`,
            respondedAt,
            runner: "local-agent-runtime",
            transport: "relay",
          };
        }

        const result = await runtime.invokeLocalAgent(request.agentId, {
          asker: request.actor ?? "system",
          task: buildAgentActionPrompt(request),
          context: request.context,
          timeoutSeconds: request.timeoutSeconds,
        });

        return {
          agentId: request.agentId,
          action: request.action,
          mode,
          ok: true,
          output: result.response,
          respondedAt: result.respondedAt,
          runner: "local-agent-runtime",
          transport: "relay",
          flightId: result.flightId,
        };
      } catch (error) {
        return {
          agentId: request.agentId,
          action: request.action,
          mode,
          ok: false,
          output: error instanceof Error ? error.message : String(error),
          respondedAt: nowSeconds(),
          runner: "local-agent-runtime",
          transport: "relay",
        };
      }
    },
  };
}
