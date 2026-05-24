/**
 * Tree Viewer — study.
 *
 * Real directory tree walked from disk at request time, rendered as a
 * collapsible client component. Two trees side by side:
 *
 *   docs/eng/    — the SCO corpus the eng/ surface already shows
 *   plans/       — the planning corpus
 *
 * Files are clickable links to /eng/file/<relPath>. Directories open
 * inline. The intent is to validate the TreeView primitive against
 * actual content shapes, not a mock — every count, every size, every
 * filename below comes from disk.
 */

import { countFiles, readTree } from "@/lib/repo-tree";
import { TreeView } from "@/components/TreeView";

export const dynamic = "force-dynamic";

export default function TreeViewerPage() {
  const engTree = readTree({ relPath: "docs/eng", maxDepth: 4 });
  const plansTree = readTree({ relPath: "plans", maxDepth: 3 });
  const studioTree = readTree({
    relPath: "design/studio/app",
    maxDepth: 5,
    ignore: ["node_modules", ".next"],
  });

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-8 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · tree-viewer
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Tree viewer
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Generic collapsible tree, server-walked from real repo paths
          via{" "}
          <code className="font-mono text-[11px] text-studio-ink">
            lib/repo-tree.ts
          </code>
          . Files link into the existing{" "}
          <code className="font-mono text-[11px] text-studio-ink">
            /eng/file
          </code>{" "}
          viewer; expand/collapse is local state.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Column
          title="docs/eng"
          subtitle={engTree ? `${countFiles(engTree)} files` : "missing"}
        >
          {engTree ? (
            <TreeView
              root={engTree}
              density="compact"
              initialExpanded
              fromRoute="/studies/tree-viewer"
            />
          ) : (
            <Missing path="docs/eng" />
          )}
        </Column>

        <Column
          title="plans"
          subtitle={plansTree ? `${countFiles(plansTree)} files` : "missing"}
        >
          {plansTree ? (
            <TreeView
              root={plansTree}
              density="comfortable"
              initialExpanded
              fromRoute="/studies/tree-viewer"
            />
          ) : (
            <Missing path="plans" />
          )}
        </Column>

        <Column
          title="design/studio/app"
          subtitle={
            studioTree ? `${countFiles(studioTree)} files` : "missing"
          }
        >
          {studioTree ? (
            <TreeView
              root={studioTree}
              density="compact"
              fromRoute="/studies/tree-viewer"
            />
          ) : (
            <Missing path="design/studio/app" />
          )}
        </Column>
      </div>

      <section className="mt-12 max-w-prose">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · safety
        </div>
        <p className="font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The tree walker enforces containment (no{" "}
          <code className="font-mono text-[11px] text-studio-ink">..</code>{" "}
          escape from repo root), max depth (default 6), and a default
          ignore set covering{" "}
          <code className="font-mono text-[11px] text-studio-ink">
            node_modules
          </code>
          ,{" "}
          <code className="font-mono text-[11px] text-studio-ink">.git</code>
          ,{" "}
          <code className="font-mono text-[11px] text-studio-ink">
            .next
          </code>
          , <code className="font-mono text-[11px] text-studio-ink">dist</code>
          , <code className="font-mono text-[11px] text-studio-ink">build</code>
          , and dotfiles. Same containment guard the{" "}
          <code className="font-mono text-[11px] text-studio-ink">
            /eng/file
          </code>{" "}
          viewer uses.
        </p>
      </section>
    </main>
  );
}

function Column({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2 border-b border-studio-edge pb-1.5">
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-eyebrow text-studio-ink">
          {title}
        </span>
        <span className="font-mono text-[9.5px] text-studio-ink-faint">
          {subtitle}
        </span>
      </div>
      <div className="rounded-md border border-studio-edge bg-studio-surface py-1">
        {children}
      </div>
    </section>
  );
}

function Missing({ path }: { path: string }) {
  return (
    <div className="px-3 py-2 font-mono text-[10.5px] italic text-studio-ink-faint">
      {path} not found on disk.
    </div>
  );
}
