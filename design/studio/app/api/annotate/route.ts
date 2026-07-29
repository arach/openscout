/**
 * Doc-annotation dispatch: POST { path, quote, note } → broker ask.
 *
 * Runs the scout CLI (`scout ask --project <repo>`) so routing, worker
 * selection, and receipts stay broker-owned — this route is a thin
 * bridge, not a second routing model. execFile (no shell) keeps the
 * user-provided note/quote as argv payload, never shell-interpreted.
 */

import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

import { resolveRepoPath } from "@/lib/repo-path";

const execFileAsync = promisify(execFile);

const MAX_NOTE_CHARS = 4000;
const MAX_QUOTE_CHARS = 600;

export async function POST(request: Request) {
  let body: { path?: unknown; quote?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const docPath = typeof body.path === "string" ? body.path : "";
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const quote = typeof body.quote === "string" ? body.quote.trim() : "";

  const resolved = docPath ? resolveRepoPath(docPath) : null;
  if (!resolved) {
    return NextResponse.json({ ok: false, error: "invalid doc path" }, { status: 400 });
  }
  if (!note) {
    return NextResponse.json({ ok: false, error: "empty note" }, { status: 400 });
  }

  const repoRoot = resolveRepoPath(".")!.absolute;
  const cli = path.join(repoRoot, "packages", "cli", "bin", "scout.mjs");

  const quoteBlock = quote
    ? `\n${quote.slice(0, MAX_QUOTE_CHARS).split("\n").map((l) => `> ${l}`).join("\n")}\n`
    : "";
  const message =
    `Doc annotation on ${resolved.relative} (sent from the studio doc viewer):\n` +
    `${quoteBlock}\n${note.slice(0, MAX_NOTE_CHARS)}`;

  try {
    const { stdout, stderr } = await execFileAsync(
      "bun",
      [cli, "ask", "--project", repoRoot, message],
      { timeout: 90_000, maxBuffer: 1024 * 1024 },
    );
    const out = `${stdout}\n${stderr}`;
    const conversationId = out.match(/\b(chn-[a-z0-9]+)\b/)?.[1];
    const invocationId = out.match(/\b(inv-[a-z0-9-]+)\b/)?.[1];
    return NextResponse.json({
      ok: true,
      conversationId,
      invocationId,
      receipt: stdout.trim().split("\n").slice(-2).join(" · "),
    });
  } catch (e) {
    const message2 = e instanceof Error ? e.message : "broker dispatch failed";
    return NextResponse.json({ ok: false, error: message2 }, { status: 502 });
  }
}
