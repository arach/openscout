/**
 * /api/design-system — agent-facing JSON query surface for the component
 * registry, for when the studio dev server is up on :43140. The CLI at
 * `scripts/ds.ts` is the primary path (works with no server); this route
 * exists for callers that already have the studio running and would rather
 * fetch than shell out.
 *
 *   GET /api/design-system                    → { components: ComponentManifest[] }
 *   GET /api/design-system?id=runtime-picker   → ComponentManifest | 404 { error }
 *   GET /api/design-system?q=model+picker      → { query, hits: [...] }
 *   GET /api/design-system?status=graduated    → { components: ComponentManifest[] }
 *   GET /api/design-system?audit=1             → { health: [...], issues: { [id]: AuditIssue[] } }
 *
 * `id` wins over `q`/`status`/`audit` if more than one is present, since it
 * names one exact component. `audit` is otherwise checked before `q` and
 * `status` so `?audit=1&status=graduated` doesn't silently fall through to a
 * plain list.
 */

import { NextResponse } from "next/server";
import {
  allComponents,
  auditManifest,
  componentsByStatus,
  findComponents,
  getComponent,
  registryHealth,
  type ComponentStatus,
} from "@/lib/design-system/registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUSES: ComponentStatus[] = ["draft", "candidate", "graduated"];

function isStatus(value: string): value is ComponentStatus {
  return (STATUSES as string[]).includes(value);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const q = url.searchParams.get("q");
  const status = url.searchParams.get("status");
  const audit = url.searchParams.get("audit");

  if (id) {
    const manifest = getComponent(id);
    if (!manifest) {
      return NextResponse.json({ error: `no component "${id}"` }, { status: 404 });
    }
    return NextResponse.json(manifest);
  }

  if (audit) {
    const health = registryHealth();
    const issues: Record<string, ReturnType<typeof auditManifest>> = {};
    for (const manifest of allComponents()) {
      issues[manifest.id] = auditManifest(manifest);
    }
    return NextResponse.json({ health, issues });
  }

  if (q) {
    const hits = findComponents(q);
    return NextResponse.json({
      query: q,
      hits: hits.map((hit) => ({
        id: hit.manifest.id,
        name: hit.manifest.name,
        status: hit.manifest.status,
        score: hit.score,
        matched: hit.matched,
        summary: hit.manifest.summary,
      })),
    });
  }

  if (status) {
    if (!isStatus(status)) {
      return NextResponse.json(
        { error: `status must be one of: ${STATUSES.join(", ")}` },
        { status: 400 },
      );
    }
    return NextResponse.json({ components: componentsByStatus(status) });
  }

  return NextResponse.json({ components: allComponents() });
}
