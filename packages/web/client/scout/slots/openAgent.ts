import type { Agent, Route } from "../../lib/types.ts";
import { setNavReturn } from "../../lib/nav-return.ts";

/**
 * Where the open-agent call originated. Captured forward-looking for the
 * future content-pane swap (instantiate-and-dismiss inside the current shell);
 * also drives the agent-detail "back" affordance via `returnTo`.
 */
export type OpenAgentFrom =
  | "agents-tree"
  | "agents-rail"
  | "mesh-canvas"
  | "mesh-tree"
  | "fleet-map"
  | "messages"
  | "base-rail"
  | "inspector"
  | "home";

type OpenAgentOptions = {
  observe?: boolean;
  from?: OpenAgentFrom;
  /** Where the back/dismiss action on agent detail should return to. */
  returnTo?: Route;
};

export function openAgent(
  navigate: (route: Route) => void,
  agent: Agent,
  options: OpenAgentOptions = {},
): void {
  if (options.returnTo) setNavReturn("agents", options.returnTo);
  navigate({
    view: "agents",
    agentId: agent.id,
    ...(options.observe ? { tab: "observe" } : {}),
  });
}
