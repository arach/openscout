import { SCOUT_COMMANDS } from "./registry.ts";

export function renderScoutHelp(version = "0.2.0"): string {
  const commandLines = SCOUT_COMMANDS
    .map((command) => `  ${command.name.padEnd(12, " ")} ${command.summary}`)
    .join("\n");

  return [
    `scout ${version}`,
    "",
    "Usage:",
    "  scout [--json] <command> [options]",
    "",
    "Commands:",
    commandLines,
    "",
    "Global flags:",
    "  --json        Structured JSON (doctor: NDJSON stream; last object has phase \"complete\")",
  ].join("\n");
}
