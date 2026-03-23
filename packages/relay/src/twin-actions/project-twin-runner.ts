import type { ProjectTwinRuntime } from "../core/protocol/twins.js";
import type {
  TwinActionRequest,
  TwinActionResult,
  TwinActionRunner,
} from "./protocol.js";

function buildTwinActionPrompt(request: TwinActionRequest): string {
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

export function createProjectTwinActionRunner(
  runtime: ProjectTwinRuntime,
): TwinActionRunner {
  return {
    async invokeTwinAction(request: TwinActionRequest): Promise<TwinActionResult> {
      const mode = request.mode ?? "persistent";
      try {
        const respondedAt = nowSeconds();

        if (mode !== "persistent") {
          return {
            twinId: request.twinId,
            action: request.action,
            mode,
            ok: false,
            output: "ephemeral twin actions are not implemented yet",
            respondedAt,
            runner: "project-twin-runtime",
            transport: "relay",
          };
        }

        if (request.action === "status") {
          const twins = await runtime.loadTwins();
          const twin = twins[request.twinId];
          if (!twin) {
            return {
              twinId: request.twinId,
              action: request.action,
              mode,
              ok: false,
              output: `twin "${request.twinId}" is not registered`,
              respondedAt,
              runner: "project-twin-runtime",
              transport: "relay",
            };
          }

          const alive = await runtime.isTwinAlive(request.twinId);
          return {
            twinId: request.twinId,
            action: request.action,
            mode,
            ok: true,
            output: alive
              ? `${request.twinId} is running (${twin.runtime})`
              : `${request.twinId} is registered but offline`,
            respondedAt,
            runner: "project-twin-runtime",
            transport: "relay",
            metadata: {
              alive,
              project: twin.project,
              projectRoot: twin.projectRoot,
              runtime: twin.runtime,
              protocol: twin.protocol,
              tmuxSession: twin.tmuxSession,
            },
          };
        }

        if (request.action === "tick") {
          const reason = request.input?.trim() || "host tick";
          const ok = await runtime.tickProjectTwin(request.twinId, reason);
          return {
            twinId: request.twinId,
            action: request.action,
            mode,
            ok,
            output: ok
              ? `twin "${request.twinId}" ticked`
              : `twin "${request.twinId}" could not be ticked`,
            respondedAt,
            runner: "project-twin-runtime",
            transport: "relay",
          };
        }

        const result = await runtime.invokeProjectTwin(request.twinId, {
          asker: request.actor ?? "system",
          task: buildTwinActionPrompt(request),
          context: request.context,
          timeoutSeconds: request.timeoutSeconds,
        });

        return {
          twinId: request.twinId,
          action: request.action,
          mode,
          ok: true,
          output: result.response,
          respondedAt: result.respondedAt,
          runner: "project-twin-runtime",
          transport: "relay",
          flightId: result.flightId,
        };
      } catch (error) {
        return {
          twinId: request.twinId,
          action: request.action,
          mode,
          ok: false,
          output: error instanceof Error ? error.message : String(error),
          respondedAt: nowSeconds(),
          runner: "project-twin-runtime",
          transport: "relay",
        };
      }
    },
  };
}
