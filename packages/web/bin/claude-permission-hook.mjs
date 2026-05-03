#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createHash, randomUUID } from "node:crypto";

const CONTROL_HOME = process.env.OPENSCOUT_CONTROL_HOME
  || join(homedir(), ".openscout", "control-plane");
const REQUEST_DIR = join(CONTROL_HOME, "permission-requests");
const TIMEOUT_MS = Math.max(1000, Number(process.env.OPENSCOUT_PERMISSION_HOOK_TIMEOUT_MS || 45000));
const POLL_MS = Math.max(100, Number(process.env.OPENSCOUT_PERMISSION_HOOK_POLL_MS || 350));

function readStdin() {
  return new Promise((resolve, reject) => {
    let body = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      body += chunk;
    });
    process.stdin.on("end", () => resolve(body));
    process.stdin.on("error", reject);
  });
}

function stableRequestId(input) {
  const hash = createHash("sha256");
  hash.update(JSON.stringify({
    session_id: input.session_id ?? "",
    transcript_path: input.transcript_path ?? "",
    cwd: input.cwd ?? "",
    tool_name: input.tool_name ?? "",
    tool_input: input.tool_input ?? null,
  }));
  return `claude:${hash.digest("hex").slice(0, 24)}`;
}

function writeJsonAtomic(path, value) {
  mkdirSync(REQUEST_DIR, { recursive: true });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temp, path);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function emitPermission(decision, reason) {
  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
    suppressOutput: true,
  })}\n`);
}

function toolSummary(input) {
  const toolInput = input.tool_input;
  if (!toolInput || typeof toolInput !== "object") {
    return null;
  }
  if (typeof toolInput.command === "string") return toolInput.command;
  if (typeof toolInput.file_path === "string") return toolInput.file_path;
  if (typeof toolInput.path === "string") return toolInput.path;
  if (typeof toolInput.description === "string") return toolInput.description;
  return null;
}

async function main() {
  const raw = await readStdin();
  const input = JSON.parse(raw || "{}");
  if (input.hook_event_name !== "PreToolUse" || typeof input.tool_name !== "string") {
    return;
  }

  const id = stableRequestId(input);
  const path = join(REQUEST_DIR, `${encodeURIComponent(id)}.json`);
  const now = Date.now();
  const existing = existsSync(path) ? readJson(path) : null;
  const request = {
    ...(existing && typeof existing === "object" ? existing : {}),
    id,
    source: "claude-code",
    status: existing?.decision ? "decided" : "pending",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    expiresAt: now + TIMEOUT_MS,
    sessionId: input.session_id ?? null,
    transcriptPath: input.transcript_path ?? null,
    cwd: input.cwd ?? process.cwd(),
    hookEventName: input.hook_event_name,
    toolName: input.tool_name,
    toolInput: input.tool_input ?? null,
    summary: toolSummary(input),
    raw: input,
  };
  writeJsonAtomic(path, request);

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    if (!existsSync(path)) continue;
    const latest = readJson(path);
    const decision = latest?.decision;
    if (decision === "allow" || decision === "deny") {
      const reason = typeof latest.reason === "string" && latest.reason.trim()
        ? latest.reason.trim()
        : `Scout operator ${decision}ed ${input.tool_name}`;
      emitPermission(decision, reason);
      return;
    }
  }

  const latest = existsSync(path) ? readJson(path) : request;
  writeJsonAtomic(path, {
    ...latest,
    status: "expired",
    updatedAt: Date.now(),
  });
  emitPermission("ask", "Scout did not receive a remote decision in time.");
}

main().catch((error) => {
  process.stderr.write(`[openscout claude permission hook] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
