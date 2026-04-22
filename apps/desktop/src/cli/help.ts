import {
  listScoutDeprecatedCommands,
  listScoutPrimaryCommands,
} from "./registry.ts";

export function renderScoutHelp(version = "0.2.18"): string {
  const commandLines = listScoutPrimaryCommands()
    .map((command) => `  ${command.name.padEnd(12, " ")} ${command.summary}`)
    .join("\n");
  const deprecatedLines = listScoutDeprecatedCommands()
    .map((command) => `  ${command.name.padEnd(12, " ")} ${command.summary}`)
    .join("\n");

  return [
    `scout ${version}`,
    "",
    "Usage:",
    "  scout [--json] <command> [options]",
    "  scout relay <command> [options]",
    "",
    "Commands:",
    commandLines,
    ...(deprecatedLines ? ["", "Deprecated aliases:", deprecatedLines] : []),
    "",
    "Global flags:",
    '  --json        Structured JSON (doctor: NDJSON stream; last object has phase "complete")',
    "",
    "Implicit ask:",
    "  scout @agent your request",
    "  scout hey @agent can you review this?",
    "  scout @agent.harness:codex use the Codex-backed one",
    "",
    "Operator loop:",
    "  scout whoami",
    "  scout who",
    "  scout latest",
    "  scout menu",
    "  scout server open",
    "",
    "Lifecycle:",
    '  scout send "@hudson ready for review"          # tell / update in a DM',
    '  scout ask --to hudson "review the parser"      # owned work / reply in a DM',
    "  scout card create                              # fresh reply-ready return address",
    '  scout broadcast "deploying in 15m"             # explicit shared broadcast',
    "",
    "One-to-one delegation:",
    '  scout ask --to hudson "review the parser"      # DM by default',
    '  scout ask --as premotion.master.mini --to hudson "build the editor"',
    "",
    "Routing:",
    '  scout send "@hudson ready for review"          # one target -> DM',
    '  scout send --channel triage "need two reviewers"  # explicit group thread',
    '  scout broadcast "deploying in 15m"             # explicit shared broadcast',
    "  no target + no channel                         # error, not fallback",
    "  multiple targets + no channel                  # error, not fallback",
    "",
    "Addressing:",
    "  @name                              short form; requires exactly one live match",
    "  @name.harness:<codex|claude|...>   pin a specific harness (alias: runtime:)",
    "  @name.profile:<id>                 pin a specific profile (alias: persona:)",
    "  @name.node:<host>                  pin a specific machine",
    "  Dimensions combine, any order: @vox.harness:codex.node:mini",
    "",
    "MCP parity:",
    "  whoami -> agents_search / agents_resolve -> messages_send or invocations_ask -> work_update",
    "",
    "Compatibility:",
    "  relay         Namespace alias for ask/send/speak/watch/card",
    "  scout         Canonical CLI binary",
  ].join("\n");
}
