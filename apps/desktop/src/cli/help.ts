import { listScoutDeprecatedCommands, listScoutPrimaryCommands } from "./registry.ts";

export function renderScoutHelp(version = "0.2.17"): string {
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
    "",
    "Compatibility:",
    "  relay         Namespace alias for ask/send/speak/watch/card",
    "  scout         Canonical CLI binary",
  ].join("\n");
}
