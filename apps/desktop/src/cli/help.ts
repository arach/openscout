import { listScoutDeprecatedCommands, listScoutPrimaryCommands } from "./registry.ts";

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
    ...(deprecatedLines
      ? [
          "",
          "Deprecated aliases:",
          deprecatedLines,
        ]
      : []),
    "",
    "Global flags:",
    "  --json        Structured JSON (doctor: NDJSON stream; last object has phase \"complete\")",
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
    "Addressing:",
    "  @name                              short form; requires exactly one live match",
    "  @name.harness:<codex|claude|...>   pin a specific harness (alias: runtime:)",
    "  @name.profile:<id>                 pin a specific profile (alias: persona:)",
    "  @name.node:<host>                  pin a specific machine",
    "  Dimensions combine, any order: @vox.harness:codex.node:mini",
    "",
    "Compatibility:",
    "  relay         Namespace alias for ask/send/speak/watch/card",
    "  scout         Canonical CLI binary",
  ].join("\n");
}
