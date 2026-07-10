import { resolve } from "node:path";

import {
  contextContentHash,
  distillMemoryCandidates,
  materializeMemoryCandidate,
} from "@openscout/agent-sessions";
import {
  MEMORY_KINDS,
  contextScopeKey,
  type ContextBlock,
  type ContextBlockState,
  type MemoryCandidate,
  type MemoryKind,
} from "@openscout/protocol";
import { findNearestProjectRoot } from "@openscout/runtime/setup";

import type { ScoutCommandContext } from "../context.ts";
import { ScoutCliError } from "../errors.ts";
import {
  constructiveScope,
  parseConstructiveCommandArgs,
  positiveInteger,
  readObservedSessionEvidence,
} from "../constructive-context.ts";
import {
  listScoutContextBlocks,
  upsertScoutContextBlock,
} from "../../core/broker/service.ts";

const HELP_FLAGS = new Set(["--help", "-h"]);

export function renderMemoryCommandHelp(): string {
  return [
    "Usage:",
    "  scout memory list [--state proposed|active|superseded|archived] [--scope <kind>] [--scope-id <id>] [--limit <n>]",
    "  scout memory add --kind <kind> [--title <title>] [--scope <kind>] [--scope-id <id>] <memory>",
    "  scout memory distill --from <session-file> [--adapter claude-code|codex|pi] [--scope <kind>] [--scope-id <id>]",
    "  scout memory promote <memory-id>",
    "",
    `Memory kinds: ${MEMORY_KINDS.join(", ")}`,
    "Distillation creates proposed memories with source provenance. Promotion makes a reviewed memory active.",
  ].join("\n");
}

function memoryKind(value: string | undefined): MemoryKind {
  if (!value || !MEMORY_KINDS.includes(value as MemoryKind)) {
    throw new ScoutCliError(`--kind must be one of: ${MEMORY_KINDS.join(", ")}`);
  }
  return value as MemoryKind;
}

function blockFromExplicitMemory(input: {
  kind: MemoryKind;
  title?: string;
  body: string;
  scope: ContextBlock["scope"];
  now: number;
}): ContextBlock {
  const candidate: MemoryCandidate = {
    id: "explicit",
    memoryKind: input.kind,
    title: input.title?.trim() || input.body.trim().slice(0, 80),
    body: input.body.trim(),
    scope: input.scope,
    sourceRefs: [{
      kind: "operator",
      ref: `operator:scout-memory:${input.now}`,
      observedAt: input.now,
    }],
    confidence: 1,
  };
  return materializeMemoryCandidate(candidate, {
    createdById: "operator",
    state: "active",
    now: input.now,
  });
}

function renderMemoryList(blocks: ContextBlock[]): string {
  if (blocks.length === 0) return "No matching memory.";
  return blocks.map((block) => [
    block.id,
    `[${block.state}]`,
    block.memoryKind ?? block.kind,
    contextScopeKey(block.scope),
    block.title,
  ].join(" · ")).join("\n");
}

async function findMemory(id: string): Promise<ContextBlock> {
  const block = (await listScoutContextBlocks({ kind: "memory", limit: 500 }))
    .find((candidate) => candidate.id === id);
  if (!block) throw new ScoutCliError(`memory not found: ${id}`);
  return block;
}

export async function runMemoryCommand(
  context: ScoutCommandContext,
  args: string[],
): Promise<void> {
  if (args.some((arg) => HELP_FLAGS.has(arg))) {
    context.output.writeText(renderMemoryCommandHelp());
    return;
  }

  const operation = args[0] ?? "list";
  const parsed = parseConstructiveCommandArgs(args.slice(1));
  const workspace = await findNearestProjectRoot(context.cwd) ?? resolve(context.cwd);

  if (operation === "list") {
    const state = parsed.flags.get("--state") as ContextBlockState | undefined;
    const scope = parsed.flags.get("--scope");
    const scopeId = parsed.flags.get("--scope-id");
    const blocks = await listScoutContextBlocks({
      kind: "memory",
      state,
      scopeKind: scope as ContextBlock["scope"]["kind"] | undefined,
      scopeId,
      limit: positiveInteger(parsed.flags.get("--limit"), 100),
    });
    context.output.writeValue(blocks, renderMemoryList);
    return;
  }

  if (operation === "add") {
    const body = parsed.positionals.join(" ").trim();
    if (!body) throw new ScoutCliError("memory add requires a memory body");
    const block = blockFromExplicitMemory({
      kind: memoryKind(parsed.flags.get("--kind")),
      title: parsed.flags.get("--title"),
      body,
      scope: constructiveScope({
        scopeKind: parsed.flags.get("--scope"),
        scopeId: parsed.flags.get("--scope-id"),
        defaultWorkspace: workspace,
      }),
      now: Date.now(),
    });
    await upsertScoutContextBlock(block);
    context.output.writeValue(block, (value) => `Active memory ${value.id}: ${value.title}`);
    return;
  }

  if (operation === "distill") {
    const from = parsed.flags.get("--from");
    if (!from) throw new ScoutCliError("memory distill requires --from <session-file>");
    const evidence = await readObservedSessionEvidence({
      path: from,
      adapterType: parsed.flags.get("--adapter"),
      cwd: context.cwd,
    });
    const observedWorkspace = evidence.cwd
      ? await findNearestProjectRoot(evidence.cwd) ?? resolve(evidence.cwd)
      : workspace;
    const scope = constructiveScope({
      scopeKind: parsed.flags.get("--scope"),
      scopeId: parsed.flags.get("--scope-id"),
      defaultWorkspace: observedWorkspace,
    });
    const blocks = distillMemoryCandidates(evidence, { scope })
      .map((candidate) => materializeMemoryCandidate(candidate, {
        createdById: "operator",
        state: "proposed",
      }));
    for (const block of blocks) await upsertScoutContextBlock(block);
    context.output.writeValue(
      { evidence: evidence.sourceRef, memories: blocks },
      (value) => `Proposed ${value.memories.length} memories from ${value.evidence.ref}. Review with: scout memory list --state proposed`,
    );
    return;
  }

  if (operation === "promote") {
    const id = parsed.positionals[0]?.trim();
    if (!id) throw new ScoutCliError("memory promote requires a memory id");
    const current = await findMemory(id);
    const updatedAt = Date.now();
    const block: ContextBlock = {
      ...current,
      state: "active",
      version: current.version + 1,
      updatedAt,
      contentHash: contextContentHash({
        kind: current.kind,
        memoryKind: current.memoryKind,
        title: current.title,
        body: current.body,
        summary: current.summary,
        scope: current.scope,
        sourceRefs: current.sourceRefs,
      }),
    };
    await upsertScoutContextBlock(block);
    context.output.writeValue(block, (value) => `Promoted memory ${value.id}: ${value.title}`);
    return;
  }

  throw new ScoutCliError(`unknown memory operation: ${operation}`);
}
