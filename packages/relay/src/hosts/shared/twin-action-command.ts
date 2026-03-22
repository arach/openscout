import { resolve } from "node:path";

import type { TwinActionRequest, TwinActionResult } from "../../twin-actions/protocol.js";

function encodeBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function encodeContext(context?: Record<string, unknown>): string | null {
  if (!context) return null;
  return encodeBase64(JSON.stringify(context));
}

function getRelayCliPath(): string {
  return resolve(import.meta.dirname, "..", "..", "cli.ts");
}

function shellQuote(value: string): string {
  return JSON.stringify(value);
}

export function buildTwinActionCommand(request: TwinActionRequest): string {
  const parts = [
    "bun",
    "run",
    shellQuote(getRelayCliPath()),
    "relay",
    "twin-action",
    "--json",
    "--twin",
    shellQuote(request.twinId),
    "--action",
    shellQuote(request.action),
    "--mode",
    shellQuote(request.mode ?? "persistent"),
  ];

  if (request.actor) {
    parts.push("--from", shellQuote(request.actor));
  }

  if (request.timeoutSeconds) {
    parts.push("--timeout", shellQuote(String(request.timeoutSeconds)));
  }

  if (request.input) {
    parts.push("--input-base64", shellQuote(encodeBase64(request.input)));
  }

  const context = encodeContext(request.context);
  if (context) {
    parts.push("--context-base64", shellQuote(context));
  }

  return parts.join(" ");
}

export function parseTwinActionResult(output: string): TwinActionResult {
  const trimmed = output.trim();
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");
  const candidate = jsonStart >= 0 && jsonEnd >= jsonStart
    ? trimmed.slice(jsonStart, jsonEnd + 1)
    : trimmed;

  return JSON.parse(candidate) as TwinActionResult;
}
