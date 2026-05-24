/**
 * File Card — study.
 *
 * Three sizes of the at-a-glance file metadata card, each populated
 * from real repo files (mtime, size, lines all live). The preview
 * variant includes a 12-line excerpt pre-sliced server-side.
 *
 * Demonstrates how the card composes:
 *   - compact   → drop-in inline replacement for prose file refs
 *   - standard  → grid tile (3-up grid, ops surface)
 *   - preview   → hover-card / drawer header
 */

import fs from "node:fs";
import path from "node:path";
import {
  FileCardCompact,
  FileCardPreview,
  FileCardStandard,
} from "@/components/FileCard";
import { readFileStat, type FileStat } from "@/lib/repo-tree";

export const dynamic = "force-dynamic";

const SAMPLE_PATHS = [
  "docs/eng/sco-039-durable-invocation-and-delivery-lifecycle.md",
  "docs/eng/sco-047-cursor-transport-spike.md",
  "docs/eng/sco-019-lightweight-mission-channels.md",
  "packages/web/client/scout/Provider.tsx",
  "packages/web/client/scout/slots/Inspector.tsx",
  "design/studio/components/EngDocHeader.tsx",
] as const;

const REPO_ROOT = path.resolve(process.cwd(), "..", "..");

function loadExcerpt(relPath: string, lineCount = 12): string {
  try {
    const raw = fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8");
    return raw.split("\n").slice(0, lineCount).join("\n");
  } catch {
    return "";
  }
}

export default function FileCardPage() {
  const stats = SAMPLE_PATHS.map((p) => readFileStat(p)).filter(
    (s): s is FileStat => s !== null,
  );

  if (stats.length === 0) {
    return (
      <main className="mx-auto max-w-page px-7 py-8">
        <p className="font-sans text-[13px] italic text-studio-ink-faint">
          No sample files found on disk.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-8 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · file-card
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          File card
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          One file primitive in three sizes. All metadata (lines,
          bytes, mtime) read live from disk via{" "}
          <code className="font-mono text-[11px] text-studio-ink">
            lib/repo-tree.ts
          </code>
          . Each card links into the existing{" "}
          <code className="font-mono text-[11px] text-studio-ink">
            /eng/file
          </code>{" "}
          viewer.
        </p>
      </header>

      <Section
        title="Compact"
        hint="Inline manifest row — could replace path-as-code links in prose"
      >
        <div className="flex flex-col gap-1">
          {stats.map((s) => (
            <FileCardCompact
              key={s.relPath}
              stat={s}
              fromRoute="/studies/file-card"
            />
          ))}
        </div>
      </Section>

      <Section
        title="Standard"
        hint="Multi-line tile — grid layout for ops surfaces"
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {stats.slice(0, 6).map((s) => (
            <FileCardStandard
              key={s.relPath}
              stat={s}
              fromRoute="/studies/file-card"
            />
          ))}
        </div>
      </Section>

      <Section
        title="Preview"
        hint="With 12-line excerpt — hover-card or drawer header"
      >
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {stats.slice(0, 4).map((s) => (
            <FileCardPreview
              key={s.relPath}
              stat={s}
              excerpt={loadExcerpt(s.relPath)}
              fromRoute="/studies/file-card"
            />
          ))}
        </div>
      </Section>

      <section className="mt-12 max-w-prose">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · candidate consumers
        </div>
        <ul className="font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
          <li>
            <code className="font-mono text-[11px] text-studio-ink">
              components/EngMarkdown.tsx
            </code>{" "}
            — wrap inline path code spans in a hover card
          </li>
          <li>
            <code className="font-mono text-[11px] text-studio-ink">
              app/eng/file/[...path]/page.tsx
            </code>{" "}
            — replace the manual file-info strip with{" "}
            <code className="font-mono text-[11px] text-studio-ink">
              &lt;FileCardCompact /&gt;
            </code>
          </li>
          <li>
            <code className="font-mono text-[11px] text-studio-ink">
              components/EngDocHeader.tsx
            </code>{" "}
            — Related row could render sibling files as compact cards
            instead of plain links
          </li>
        </ul>
      </section>
    </main>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <div className="mb-3 flex items-baseline gap-3">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · {title}
        </div>
        <div className="font-mono text-[10px] text-studio-ink-faint">
          {hint}
        </div>
        <div className="ml-3 h-px flex-1 bg-studio-edge" />
      </div>
      {children}
    </section>
  );
}
