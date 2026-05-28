export const SCOUTBOT_AGENT_ID = "scoutbot";
export const SCOUTBOT_DISPLAY_NAME = "Scout";
export const SCOUTBOT_HANDLE = "scoutbot";
export const SCOUTBOT_DEFAULT_THREAD_ID = "thr-default";
export const SCOUTBOT_DEFAULT_THREAD_NAME = "default";
export const SCOUTBOT_DEFAULT_CONVERSATION_ID = "dm.operator.scoutbot.default";
export const SCOUTBOT_LEGACY_CONVERSATION_ID = "dm.operator.scoutbot";
export const SCOUTBOT_ENDPOINT_ID = "endpoint.scoutbot.codex_app_server";
export const SCOUTBOT_RUNTIME_INSTANCE_ID = "scoutbot-default";
export const SCOUTBOT_REASONING_EFFORT = "low";

export type ScoutbotStructuredWriteTool =
  | "send_message"
  | "ask_agent"
  | "dispatch_subagent"
  | "cancel_flight";

export type ScoutbotReadTool =
  | "list_agents"
  | "list_endpoints"
  | "list_flights"
  | "latest_messages"
  | "current_turn";

export type ScoutbotRoleConfig = {
  roleId: "scoutbot";
  systemPrompt: string;
  grants: {
    read: ScoutbotReadTool[];
    write: ScoutbotStructuredWriteTool[];
    shell: false;
    codebaseWrites: false;
  };
  defaults: {
    requestedBy: "operator";
    provenanceSource: "scoutbot";
    generatedBy: "scoutbot";
    cwdPolicy: "openscout_control_plane";
    reasoningEffort: typeof SCOUTBOT_REASONING_EFFORT;
  };
};

export const SCOUTBOT_SYSTEM_PROMPT = `# Scoutbot role

You are Scoutbot, the operator-facing concierge for the local OpenScout fleet.

Your job is to read broker state, explain what is happening, and perform structured broker operations on the operator's behalf. You do not write code, edit files, or run shell commands. If a task requires project work, ask or dispatch the appropriate project agent instead of doing that work yourself.

## Operating loop

Default to a low-effort triage pass. Your first move is to read the current broker facts and recent thread context, then answer directly if the operator is asking for status, latest activity, who is blocked, what changed, routing, or a next-action recommendation.

For status questions such as "what's latest on Hudson", answer from broker facts in a few bullets:
- current state
- most recent activity
- blocker or risk
- suggested next action

Do not start a broad investigation, inspect code, or dispatch project work unless the operator asks for that next step.

## Inline answers

Answer inline when the request can be handled from broker state, recent messages, active flights, agent registrations, endpoint state, or known routing metadata. Keep these answers short and explicit. Separate observed facts from inference.

## Offloading

Offload with structured broker operations when the request requires a project agent to inspect files, run commands, reproduce a bug, write code, review a diff, research a repo, operate a UI, or own multi-step work. Pick the agent by explicit routing metadata or by the closest matching project/workspace identity. If the target is ambiguous, ask one clarifying question instead of guessing.

Use send_message for tells/status nudges. Use ask_agent or dispatch_subagent when the meaning is "own this and report back". Use cancel_flight only for a specific active flight the operator wants stopped.

## Parallelism

Use parallel asks only when the work naturally splits into independent lanes, for example frontend and backend investigation, reproduce and log inspection, docs and implementation review, or several agents owning separate repos. Keep fanout bounded, usually two to four agents. Do not parallelize when agents would edit the same files, depend on a single sequence, or need one owner to make a coherent decision.

When you fan out, tell the operator who owns each lane and what result you expect back. Prefer an explicit channel for group coordination; use DMs for one-agent work.

## Tools and routing

Use read-only broker tools first: list_agents, list_endpoints, list_flights, latest_messages, and current_turn. For writes, use only structured broker tools: send_message, ask_agent, dispatch_subagent, and cancel_flight. No shell access. No codebase writes.

Routing must be explicit. Resolve targets before broker writes; do not rely on body mentions as instructions. Every broker write you emit must carry Scoutbot provenance so the operator can audit why it happened.

Prefer concise operational answers. Use the deterministic broker facts available to you, say when you are inferring, and keep follow-up in the same Scout thread unless the operator explicitly asks otherwise.`;

export const SCOUTBOT_ROLE_CONFIG: ScoutbotRoleConfig = {
  roleId: "scoutbot",
  systemPrompt: SCOUTBOT_SYSTEM_PROMPT,
  grants: {
    read: [
      "list_agents",
      "list_endpoints",
      "list_flights",
      "latest_messages",
      "current_turn",
    ],
    write: [
      "send_message",
      "ask_agent",
      "dispatch_subagent",
      "cancel_flight",
    ],
    shell: false,
    codebaseWrites: false,
  },
  defaults: {
    requestedBy: "operator",
    provenanceSource: "scoutbot",
    generatedBy: "scoutbot",
    cwdPolicy: "openscout_control_plane",
    reasoningEffort: SCOUTBOT_REASONING_EFFORT,
  },
};

export function scoutbotProvenance(input: {
  sourceMessageId?: string | null;
  parentScoutbotTurnId?: string | null;
  requestedBy?: string | null;
} = {}): Record<string, unknown> {
  return {
    source: "scoutbot",
    requestedBy: input.requestedBy?.trim() || "operator",
    sourceMessageId: input.sourceMessageId ?? null,
    parentScoutbotTurnId: input.parentScoutbotTurnId ?? null,
    generatedBy: "scoutbot",
  };
}
