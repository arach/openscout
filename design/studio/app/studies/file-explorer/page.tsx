/**
 * File Explorer — study.
 *
 * Split-pane composition: a `TreeView` of `design/studio/app` on the
 * left, a swap-in detail pane on the right. With no selection, the
 * right pane shows a `DirSummary` aggregate; selecting a file fetches
 * its content from `/api/repo-file` and renders the
 * breadcrumb + stat row + code excerpt + symbol outline layout.
 *
 * The server component owns the initial tree walk only — every other
 * interaction is client-side state in `FileExplorerWorkspace`.
 */

import { readTree } from "@/lib/repo-tree";
import { FileExplorerWorkspace } from "@/components/FileExplorerWorkspace";

export const dynamic = "force-dynamic";

const ROOT_REL = "design/studio/app";

export default function FileExplorerPage() {
  const tree = readTree({
    relPath: ROOT_REL,
    maxDepth: 5,
    ignore: ["node_modules", ".next"],
  });

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-6 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · file-explorer
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          File explorer
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          A composition study layering the existing tree + file primitives
          into a split-pane workspace. Tree walks{" "}
          <code className="font-mono text-[11px] text-studio-ink">
            {ROOT_REL}
          </code>{" "}
          server-side; file content streams in from{" "}
          <code className="font-mono text-[11px] text-studio-ink">
            /api/repo-file
          </code>{" "}
          on demand. Selection, search, and outline collapse all live in
          the client.
        </p>
      </header>

      {tree ? (
        <FileExplorerWorkspace initialTree={tree} rootRel={ROOT_REL} />
      ) : (
        <Missing path={ROOT_REL} />
      )}

      <section className="mt-10 max-w-prose">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · what composes here
        </div>
        <ul className="font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
          <li>
            <code className="font-mono text-[11px] text-studio-ink">
              TreeView
            </code>{" "}
            with new{" "}
            <code className="font-mono text-[11px] text-studio-ink">
              searchTerm
            </code>
            ,{" "}
            <code className="font-mono text-[11px] text-studio-ink">
              currentPath
            </code>
            , and{" "}
            <code className="font-mono text-[11px] text-studio-ink">
              onFileClick
            </code>{" "}
            wiring — left rail; indent guides + keyboard nav.
          </li>
          <li>
            <code className="font-mono text-[11px] text-studio-ink">
              BreadcrumbPath
            </code>{" "}
            — sticky header; clicking a segment clears the file selection.
          </li>
          <li>
            <code className="font-mono text-[11px] text-studio-ink">
              CodeExcerpt
            </code>{" "}
            — static 80-line slice with line-number gutter, no editor.
          </li>
          <li>
            <code className="font-mono text-[11px] text-studio-ink">
              SymbolOutline
            </code>{" "}
            — regex extractor for md / ts / tsx / swift, collapsible rail.
          </li>
          <li>
            <code className="font-mono text-[11px] text-studio-ink">
              DirSummary
            </code>{" "}
            — fallback right-pane card when nothing is selected.
          </li>
        </ul>
      </section>
    </main>
  );
}

function Missing({ path }: { path: string }) {
  return (
    <div className="rounded-md border border-studio-edge bg-studio-surface px-4 py-3 font-mono text-[11px] italic text-studio-ink-faint">
      {path} not found on disk.
    </div>
  );
}
