import Link from "next/link";
import { notFound } from "next/navigation";
import { CodeViewer } from "@/components/CodeViewer";
import { DocAnnotate } from "@/components/DocAnnotate";
import { EngMarkdown } from "@/components/EngMarkdown";
import { StatusPill } from "@/components/StatusPill";
import { loadRepoFile } from "@/lib/repo-file";
import "../../eng-doc.css";

export const dynamic = "force-dynamic";

function stripFrontmatter(content: string): string {
  const m = content.match(/^---\n[\s\S]*?\n---\n/);
  return m ? content.slice(m[0].length) : content;
}

export default async function FileViewerPage({
  params,
  searchParams,
}: {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<{ from?: string; view?: string }>;
}) {
  const { path: parts } = await params;
  const { from, view } = await searchParams;
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

  // Markdown files read rendered by default; everything else is source.
  const isMarkdown = /\.mdx?$/i.test(file.filename);
  const showPreview = isMarkdown && view !== "source";
  const basePath = `/eng/file/${file.relativePath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const viewHref = (v: "preview" | "source") => {
    const qs = new URLSearchParams();
    if (v === "source") qs.set("view", "source");
    if (from) qs.set("from", from);
    const s = qs.toString();
    return s ? `${basePath}?${s}` : basePath;
  };

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <nav className="mb-3 font-mono text-xs text-studio-ink-faint">
        <Link
          href={backHref}
          className="focus-ring rounded-[2px] hover:text-studio-ink transition-colors"
        >
          {backLabel}
        </Link>
      </nav>

      <div className="mb-5 border-b border-studio-edge pb-3">
        <div className="text-2xs font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
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
        <h1 className="mt-1 font-sans text-4xl font-medium tracking-tight text-studio-ink">
          {file.filename}
        </h1>
        <div className="mt-2 flex flex-wrap items-baseline gap-3 font-mono text-xs text-studio-ink-faint">
          <span>{lines.toLocaleString()} lines</span>
          <span aria-hidden className="h-3 w-px shrink-0 bg-studio-edge" />
          <span>{kb} KB</span>
          {file.truncated ? (
            <>
              <span aria-hidden className="h-3 w-px shrink-0 bg-studio-edge" />
              <StatusPill tone="warn" label="TRUNCATED" />
            </>
          ) : null}
          {isMarkdown ? (
            <span className="ml-auto flex items-center gap-2">
              <ViewTab
                label="Preview"
                href={viewHref("preview")}
                active={showPreview}
              />
              <span aria-hidden className="h-3 w-px shrink-0 bg-studio-edge" />
              <ViewTab
                label="Source"
                href={viewHref("source")}
                active={!showPreview}
              />
            </span>
          ) : null}
        </div>
      </div>

      {showPreview ? (
        <>
          <div className="mx-auto max-w-[820px]">
            <DocAnnotate path={file.relativePath}>
              <EngMarkdown body={stripFrontmatter(file.content)} />
            </DocAnnotate>
          </div>
          <p className="mx-auto mt-10 max-w-[820px] border-t border-studio-edge pt-3 font-mono text-2xs uppercase tracking-eyebrow text-studio-ink-faint">
            Select any passage to annotate — notes dispatch to an agent via
            the broker.
          </p>
        </>
      ) : (
        <div
          className="overflow-hidden rounded-md border border-studio-edge"
          style={{ background: "var(--code-bg)" }}
        >
          <CodeViewer content={file.content} filename={file.filename} />
        </div>
      )}
    </main>
  );
}

function ViewTab({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  if (active) {
    return <span className="font-semibold text-studio-ink">{label}</span>;
  }
  return (
    <Link
      href={href}
      className="focus-ring rounded-[2px] transition-colors hover:text-studio-ink"
    >
      {label}
    </Link>
  );
}
