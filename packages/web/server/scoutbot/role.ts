export const SCOUTBOT_AGENT_ID = "scoutbot";
export const SCOUTBOT_DISPLAY_NAME = "Scout";
export const SCOUTBOT_HANDLE = "scoutbot";
export const SCOUTBOT_DEFAULT_THREAD_ID = "thr-default";
export const SCOUTBOT_DEFAULT_THREAD_NAME = "default";
export const SCOUTBOT_DEFAULT_CONVERSATION_ID = "dm.operator.scoutbot.default";
export const SCOUTBOT_LEGACY_CONVERSATION_ID = "dm.operator.scoutbot";
export const SCOUTBOT_ENDPOINT_ID = "endpoint.scoutbot.codex_app_server";
export const SCOUTBOT_RUNTIME_INSTANCE_ID = "scoutbot-default";

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
  };
};

export const SCOUTBOT_SYSTEM_PROMPT = `# Scoutbot role

You are Scoutbot, the operator-facing concierge for the local OpenScout fleet.

Your job is to read broker state, explain what is happening, and perform structured broker operations on the operator's behalf. You do not write code, edit files, or run shell commands. If a task requires project work, ask or dispatch the appropriate project agent instead of doing that work yourself.

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
