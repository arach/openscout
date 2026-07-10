import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  createHistorySessionSnapshot,
  createSessionEvidence,
  type SessionEvidence,
} from "@openscout/agent-sessions";
import type { ContextScope } from "@openscout/protocol";

import { ScoutCliError } from "./errors.ts";

export type ConstructiveCommandArgs = {
  flags: Map<string, string>;
  switches: Set<string>;
  positionals: string[];
};

export function parseConstructiveCommandArgs(
  args: string[],
  booleanFlags: readonly string[] = [],
): ConstructiveCommandArgs {
  const booleanSet = new Set(booleanFlags);
  const flags = new Map<string, string>();
  const switches = new Set<string>();
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index] ?? "";
    if (!current.startsWith("--")) {
      positionals.push(current);
      continue;
    }

    const equals = current.indexOf("=");
    const name = equals >= 0 ? current.slice(0, equals) : current;
    if (booleanSet.has(name)) {
      switches.add(name);
      continue;
    }
    const value = equals >= 0 ? current.slice(equals + 1) : args[index + 1];
    if (!value || (equals < 0 && value.startsWith("--"))) {
      throw new ScoutCliError(`missing value for ${name}`);
    }
    flags.set(name, value);
    if (equals < 0) index += 1;
  }

  return { flags, switches, positionals };
}

export function constructiveScope(input: {
  scopeKind?: string;
  scopeId?: string;
  defaultWorkspace: string;
}): ContextScope {
  const kind = input.scopeKind?.trim() || "workspace";
  if (kind === "global") return { kind: "global" };
  if (
    kind !== "workspace"
    && kind !== "agent"
    && kind !== "conversation"
    && kind !== "work_item"
    && kind !== "session"
  ) {
    throw new ScoutCliError(`unsupported context scope: ${kind}`);
  }
  const id = input.scopeId?.trim() || (kind === "workspace" ? input.defaultWorkspace : "");
  if (!id) throw new ScoutCliError(`--scope-id is required for ${kind} scope`);
  return { kind, id };
}

export async function readObservedSessionEvidence(input: {
  path: string;
  adapterType?: string;
  cwd: string;
}): Promise<SessionEvidence> {
  const path = resolve(input.cwd, input.path);
  const content = await readFile(path, "utf8");
  const decoded = createHistorySessionSnapshot({
    path,
    content,
    adapterType: input.adapterType,
  });
  const evidence = createSessionEvidence(decoded.snapshot);
  return {
    ...evidence,
    sourceRef: {
      ...evidence.sourceRef,
      metadata: {
        path,
        adapterType: decoded.adapterType,
        parsedLineCount: decoded.parsedLineCount,
        skippedLineCount: decoded.skippedLineCount,
      },
    },
    limitations: [
      ...evidence.limitations,
      ...(decoded.skippedLineCount > 0
        ? [`${decoded.skippedLineCount} source lines were not recognized by the observation decoder.`]
        : []),
    ],
  };
}

export function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new ScoutCliError(`expected a positive integer, received: ${value}`);
  }
  return parsed;
}
