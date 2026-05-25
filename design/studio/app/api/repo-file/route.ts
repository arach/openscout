import { NextResponse } from "next/server";
import { loadRepoFile } from "@/lib/repo-file";
import { readFileStat } from "@/lib/repo-tree";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * /api/repo-file?path=<relPath>
 *
 * Returns `{ stat, excerpt, language, truncated }` for a single
 * repo-relative file. Used by the file-explorer study to load file
 * content lazily as the user clicks tree entries — keeps the initial
 * page payload small while still doing all containment + allowlist
 * checks server-side.
 *
 * Security: both `loadRepoFile` (extension allowlist + containment +
 * 512KB cap) and `readFileStat` (containment) reject anything outside
 * the repo or off the allowlist. Errors collapse to a 404 so the API
 * surface doesn't tell callers *why* a path was rejected.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const relPath = url.searchParams.get("path");
  if (!relPath) {
    return NextResponse.json(
      { error: "missing path" },
      { status: 400 },
    );
  }

  // loadRepoFile expects the path already split into segments and
  // URI-decoded. Browser query strings come in already decoded.
  const parts = relPath.split("/").filter(Boolean);
  if (parts.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const file = await loadRepoFile(parts);
  const stat = readFileStat(parts.join("/"));
  if (!file || !stat) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const excerpt = file.content.split("\n").slice(0, 80).join("\n");
  const language = file.filename.includes(".")
    ? file.filename.slice(file.filename.lastIndexOf(".") + 1).toLowerCase()
    : "";

  return NextResponse.json(
    {
      stat,
      excerpt,
      language,
      truncated: file.truncated,
      totalLines: file.content.split("\n").length,
    },
    {
      headers: {
        // Lightweight cache — files don't change inside a request.
        "Cache-Control": "no-store",
      },
    },
  );
}
