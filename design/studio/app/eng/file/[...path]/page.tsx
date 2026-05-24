import Link from "next/link";
import { notFound } from "next/navigation";
import { CodeViewer } from "@/components/CodeViewer";
import { StatusPill } from "@/components/StatusPill";
import { loadRepoFile } from "@/lib/repo-file";

export const dynamic = "force-dynamic";

export default async function FileViewerPage({
  params,
  searchParams,
}: {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { path: parts } = await params;
  const { from } = await searchParams;
  const file = await loadRepoFile(parts);
  if (!file) notFound();

  const backHref = from ?? "/eng";
  const backLabel = from?.startsWith("/eng/")
    ? "← Back to doc"
    : "← Engineering docs";
  const dir = file.relativePath.includes("/")
    ? file.relativePath.slice(0, file.relativePath.lastIndexOf("/"))
    : "";

  const lines = file.content.split("\n").length;
  const kb = (file.bytes / 1024).toFixed(1);

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <nav className="mb-3 font-mono text-[10px] text-studio-ink-faint">
        <Link
          href={backHref}
          className="focus-ring rounded-[2px] hover:text-studio-ink transition-colors"
        >
          {backLabel}
        </Link>
      </nav>

      <div className="mb-5 border-b border-studio-edge pb-3">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · File
          {dir ? (
            <>
              <span aria-hidden className="mx-1.5 text-studio-ink-faint">
                ›
              </span>
              <span className="normal-case tracking-normal text-studio-ink-faint">
                {dir}
              </span>
            </>
          ) : null}
        </div>
        <h1 className="mt-1 font-sans text-[20px] font-medium tracking-tight text-studio-ink">
          {file.filename}
        </h1>
        <div className="mt-2 flex flex-wrap items-baseline gap-3 font-mono text-[10px] text-studio-ink-faint">
          <span>{lines.toLocaleString()} lines</span>
          <span aria-hidden className="h-3 w-px shrink-0 bg-studio-edge" />
          <span>{kb} KB</span>
          {file.truncated ? (
            <>
              <span aria-hidden className="h-3 w-px shrink-0 bg-studio-edge" />
              <StatusPill tone="warn" label="TRUNCATED" />
            </>
          ) : null}
        </div>
      </div>

      <div
        className="overflow-hidden rounded-md border border-studio-edge"
        style={{ background: "var(--code-bg)" }}
      >
        <CodeViewer content={file.content} filename={file.filename} />
      </div>
    </main>
  );
}
