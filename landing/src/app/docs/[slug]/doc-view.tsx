"use client";

import { useEffect, useMemo, useState } from "react";
import GithubSlugger from "github-slugger";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ChevronRight } from "lucide-react";
import { MarkdownContent } from "@arach/dewey";
import dynamic from "next/dynamic";
import type { ComponentType } from "react";

const ArcDiagram: ComponentType<Record<string, unknown>> = dynamic(
  () => import("@arach/arc").then((m) => ({ default: m.ArcDiagram })) as any,
  { ssr: false },
);
import type { NavGroup } from "@/lib/docs";

type Heading = {
  id: string;
  title: string;
  depth: 2 | 3;
};

function stripLeadHeading(content: string) {
  return content.replace(/^\s*#\s+.+\n+/, "");
}

function cleanHeadingText(text: string) {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .trim();
}

function extractHeadings(content: string): Heading[] {
  const slugger = new GithubSlugger();
  const headings: Heading[] = [];

  for (const line of content.split("\n")) {
    const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (!match) continue;

    const title = cleanHeadingText(match[2]);
    if (!title) continue;

    headings.push({
      id: slugger.slug(title),
      title,
      depth: match[1].length as 2 | 3,
    });
  }

  return headings;
}

type ContentSegment =
  | { type: "markdown"; content: string }
  | { type: "arc"; src: string };

function splitArcDiagrams(content: string): ContentSegment[] {
  const pattern = /!\[[^\]]*\]\(arc:([^)]+)\)/g;
  const segments: ContentSegment[] = [];
  let last = 0;

  for (const match of content.matchAll(pattern)) {
    if (match.index > last) {
      segments.push({ type: "markdown", content: content.slice(last, match.index) });
    }
    segments.push({ type: "arc", src: match[1] });
    last = match.index + match[0].length;
  }

  if (last < content.length) {
    segments.push({ type: "markdown", content: content.slice(last) });
  }

  return segments.length > 0 ? segments : [{ type: "markdown", content }];
}

const DIAGRAM_CODES: Record<string, string> = {
  "communication-flow": "SCOUT-001-COMM",
  "agent-lifecycle": "SCOUT-002-LIFE",
  "mesh-topology": "SCOUT-003-MESH",
};

function formatDiagramLabel(src: string) {
  return DIAGRAM_CODES[src] ?? `SCOUT-${src.toUpperCase().replace(/-/g, "")}`;
}

function ArcDiagramEmbed({ src }: { src: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/diagrams/${src}.arc.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [src]);

  if (error) return null;
  if (!data) return <div className="mt-8 mb-2 aspect-[10/7] animate-pulse rounded-lg" style={{ background: 'rgba(0,0,0,0.02)' }} />;

  const layout = data.layout as { width: number; height: number } | undefined;
  const aspectRatio = layout ? `${layout.width}/${layout.height}` : '10/7';

  return (
    <div className="mt-8 mb-2 arc-docs-embed overflow-hidden rounded-lg" style={{ aspectRatio }}>
      <ArcDiagram
        data={data}
        className="w-full h-full !rounded-none !border-0 !shadow-none !bg-[#fafafa]"
        mode="light"
        theme="cool"
        interactive={true}
        showArcToggle={false}
        label={formatDiagramLabel(src)}
        defaultZoom="fit"
        maxFitZoom={0.95}
        hoverEffects={{ dim: true, lift: true, glow: true, highlightEdges: true }}
      />
    </div>
  );
}

export function DocView({
  title,
  description,
  content,
  navigation,
  slug,
  prevPage,
  nextPage,
}: {
  title: string;
  description: string;
  content: string;
  navigation: NavGroup[];
  slug: string;
  prevPage?: { id: string; title: string };
  nextPage?: { id: string; title: string };
}) {
  const currentGroup = navigation.find((group) => group.items.some((item) => item.id === slug));
  const renderedContent = useMemo(() => stripLeadHeading(content), [content]);
  const headings = useMemo(() => extractHeadings(renderedContent), [renderedContent]);
  const segments = useMemo(() => splitArcDiagrams(renderedContent), [renderedContent]);

  const [activeId, setActiveId] = useState<string>("");
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    if (headings.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        }
      },
      { rootMargin: "-80px 0px -80% 0px" },
    );
    const elements = headings.map((h) => document.getElementById(h.id)).filter(Boolean);
    elements.forEach((el) => observer.observe(el!));
    return () => observer.disconnect();
  }, [headings]);

  useEffect(() => {
    function onScroll() {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setScrollProgress(max > 0 ? window.scrollY / max : 0);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="min-h-screen bg-[#fafafa] text-[#111110]">
      {/* Header */}
      <header className="fixed inset-x-0 top-0 z-40 border-b border-black/[0.08] bg-[#fafafa]/90 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[92rem] items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <span className="font-[family-name:var(--font-spectral)] text-lg font-semibold tracking-tight text-[#111110]">
              Scout
            </span>
          </Link>
          <div className="flex items-center gap-5 text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-[#8b8579]">
            <Link href="/docs" className="transition-colors hover:text-[#111110]">
              Docs
            </Link>
            <span className="hidden sm:block truncate">{title}</span>
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-[2px]">
          <div className="h-full bg-[#111110]/20 transition-[width] duration-150" style={{ width: `${scrollProgress * 100}%` }} />
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-[92rem] pt-14">
        <div className="grid lg:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[16rem_minmax(0,1fr)_13rem]">
          {/* Sidebar — rail, not card */}
          <aside className="hidden lg:block border-r border-black/[0.08] sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto">
            <div className="py-6 px-4">
              <div className="space-y-0">
                {navigation.map((group, groupIdx) => (
                  <section key={group.title} className={groupIdx > 0 ? "mt-5 pt-4 border-t border-black/[0.08]" : ""}>
                    <p className="text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-[#8b8579] px-3 mb-2">
                      {group.title}
                    </p>
                    <div className="space-y-0.5">
                      {group.items.map((item) => {
                        const isActive = item.id === slug;

                        return (
                          <Link
                            key={item.id}
                            href={`/docs/${item.id}`}
                            className={`block rounded-xl px-3 py-2 text-[13px] transition-colors ${
                              isActive
                                ? "bg-[#111110] text-white font-semibold"
                                : "text-[#4c4841] hover:bg-black/[0.04]"
                            }`}
                          >
                            {item.title}
                          </Link>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </aside>

          {/* Mobile sidebar */}
          <div className="mb-4 px-4 pt-6 lg:hidden">
            <details className="border border-black/[0.08] rounded-xl p-4">
              <summary className="cursor-pointer list-none text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-[#8b8579]">
                Browse Docs
              </summary>
              <div className="mt-4 space-y-4 border-t border-black/[0.08] pt-4">
                {navigation.map((group) => (
                  <section key={group.title}>
                    <p className="text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-[#8b8579] mb-2">
                      {group.title}
                    </p>
                    <div className="space-y-0.5">
                      {group.items.map((item) => {
                        const isActive = item.id === slug;

                        return (
                          <Link
                            key={item.id}
                            href={`/docs/${item.id}`}
                            className={`block rounded-xl px-3 py-2 text-sm transition-colors ${
                              isActive
                                ? "bg-[#111110] text-white font-semibold"
                                : "text-[#4c4841] hover:bg-black/[0.04]"
                            }`}
                          >
                            {item.title}
                          </Link>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </details>
          </div>

          {/* Article — content region, not a card */}
          <article className="px-6 sm:px-10 lg:px-14 py-10">
            <nav className="mb-6 flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-[#8b8579]">
              <Link href="/docs" className="transition-colors hover:text-[#111110]">
                Docs
              </Link>
              <ChevronRight className="h-3 w-3" />
              <span>{currentGroup?.title ?? "Documentation"}</span>
            </nav>

            <div className="max-w-3xl pb-8">
              <h1 className="font-[family-name:var(--font-spectral)] text-3xl font-semibold tracking-[-0.02em] text-[#111110] sm:text-4xl">
                {title}
              </h1>
              <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[#5e5a52]">
                {description}
              </p>
            </div>

            {/* Inline ToC for small screens */}
            {headings.length > 0 ? (
              <div className="mt-8 xl:hidden">
                <div className="border border-black/[0.08] rounded-xl p-4">
                  <p className="text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-[#8b8579]">
                    On This Page
                  </p>
                  <div className="mt-3 space-y-1">
                    {headings.map((heading) => (
                      <a
                        key={heading.id}
                        href={`#${heading.id}`}
                        className={`block py-1 text-[13px] transition-colors hover:text-[#111110] ${
                          heading.depth === 3 ? "ml-4" : ""
                        } ${activeId === heading.id ? "text-[#111110] font-medium" : "text-[#4c4841]"}`}
                      >
                        {heading.title}
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="docs-markdown mt-10 max-w-none">
              {segments.map((seg, i) =>
                seg.type === "arc" ? (
                  <ArcDiagramEmbed key={i} src={seg.src} />
                ) : (
                  <MarkdownContent key={i} content={seg.content} />
                ),
              )}
            </div>

            {prevPage || nextPage ? (
              <nav className="mt-12 grid gap-3 border-t border-black/[0.08] pt-8 md:grid-cols-2">
                {prevPage ? (
                  <Link
                    href={`/docs/${prevPage.id}`}
                    className="group rounded-xl border border-black/[0.08] p-4 transition-all hover:border-black/[0.15]"
                  >
                    <span className="text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-[#8b8579] flex items-center gap-1.5">
                      <ArrowLeft className="h-3 w-3" />
                      Previous
                    </span>
                    <span className="mt-2 block text-sm font-medium text-[#111110]">
                      {prevPage.title}
                    </span>
                  </Link>
                ) : (
                  <div />
                )}
                {nextPage ? (
                  <Link
                    href={`/docs/${nextPage.id}`}
                    className="group rounded-xl border border-black/[0.08] p-4 text-left transition-all hover:border-black/[0.15]"
                  >
                    <span className="text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-[#8b8579] flex items-center justify-end gap-1.5">
                      Next
                      <ArrowRight className="h-3 w-3" />
                    </span>
                    <span className="mt-2 block text-right text-sm font-medium text-[#111110]">
                      {nextPage.title}
                    </span>
                  </Link>
                ) : null}
              </nav>
            ) : null}
          </article>

          {/* Table of Contents — rail, not card */}
          {headings.length > 0 ? (
            <aside className="hidden xl:block border-l border-black/[0.08] sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto">
              <div className="py-10 px-5">
                <p className="text-[10px] font-mono font-bold uppercase tracking-[0.12em] text-[#8b8579]">
                  On This Page
                </p>
                <div className="mt-3 space-y-1">
                  {headings.map((heading) => (
                    <a
                      key={heading.id}
                      href={`#${heading.id}`}
                      className={`block py-1 text-[13px] transition-colors hover:text-[#111110] ${
                        heading.depth === 3 ? "ml-3" : ""
                      } ${activeId === heading.id ? "text-[#111110] font-medium" : "text-[#4c4841]"}`}
                    >
                      {heading.title}
                    </a>
                  ))}
                </div>
              </div>
            </aside>
          ) : null}
        </div>
      </main>
    </div>
  );
}
