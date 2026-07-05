"use client";

import { createContext, useContext, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { ComponentType } from "react";
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

const ArcDiagram: ComponentType<Record<string, unknown>> = dynamic(
  () => import("@arach/arc").then((m) => ({ default: m.ArcDiagram })) as any,
  { ssr: false },
);

const DIAGRAM_CODES: Record<string, string> = {
  "communication-flow": "SCOUT-001-COMM",
  "agent-lifecycle": "SCOUT-002-LIFE",
  "mesh-topology": "SCOUT-003-MESH",
  "session-harness-lifecycle": "SCO-079-SESSION",
};

/** Set true while rendering inside an `<a>`. Prevents the inline-code
 *  renderer from wrapping a path-like span in a second <Link> — which
 *  would emit nested anchors and trigger a hydration error. */
const InsideAnchorContext = createContext(false);

/**
 * Markdown renderer for SCO engineering docs.
 *
 * Styled to match Studio chrome — Newsreader display for headings,
 * Inter for body, JetBrains Mono for code. GFM enabled for the tables
 * that show up frequently in SCO specs.
 *
 * Anchored headings — every h2/h3 gets a stable id derived from its
 * text so reviewers can deep-link sections.
 *
 * Path autolinking — inline `code` whose content looks like a relative
 * repo path with a known extension becomes a Link to /eng/file/...
 * carrying a ?from=/eng/<slug> back ref. Turns docs into a nav graph.
 */
export function EngMarkdown({
  body,
  fromSlug,
  compact = false,
}: {
  body: string;
  fromSlug?: string;
  compact?: boolean;
}) {
  return (
    <article className={`eng-doc ${compact ? "eng-doc--compact" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (
          url.startsWith("arc:") ? url : defaultUrlTransform(url)
        )}
        rehypePlugins={[
          [rehypeHighlight, { detect: true, ignoreMissing: true }],
        ]}
        components={buildComponents(fromSlug)}
      >
        {body}
      </ReactMarkdown>
    </article>
  );
}

const VIEWABLE_EXT_RE =
  /\.(swift|ts|tsx|js|jsx|mjs|cjs|md|mdx|json|css|scss|html?|sh|bash|zsh|ya?ml|toml|txt|rs|go|py|sql)(?::\d+(?:-\d+)?)?$/i;

function isViewablePath(text: string): { path: string } | null {
  if (!text) return null;
  if (text.includes("://")) return null;
  if (text.startsWith("http") || text.startsWith("//")) return null;
  if (!text.includes("/")) return null;
  if (!VIEWABLE_EXT_RE.test(text)) return null;
  const cleaned = text.replace(/:\d+(?:-\d+)?$/, "");
  return { path: cleaned };
}

function buildFileHref(p: string, fromSlug?: string): string {
  const segments = p.split("/").map((s) => encodeURIComponent(s));
  const from = fromSlug
    ? `?from=${encodeURIComponent(`/eng/${fromSlug}`)}`
    : "";
  return `/eng/file/${segments.join("/")}${from}`;
}

function buildComponents(fromSlug: string | undefined): Components {
  return {
    h1: ({ children }) => (
      <h1
        id={slugify(children)}
        className="font-display text-[24px] font-medium tracking-tight text-studio-ink mt-8 mb-3 scroll-mt-24"
      >
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2
        id={slugify(children)}
        className="font-display text-[20px] font-medium tracking-tight text-studio-ink mt-10 mb-3 pb-1.5 border-b border-studio-edge scroll-mt-24"
      >
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3
        id={slugify(children)}
        className="font-display text-[16px] font-medium tracking-tight text-studio-ink mt-7 mb-2 scroll-mt-24"
      >
        {children}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className="font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint mt-5 mb-1.5">
        {children}
      </h4>
    ),
    p: ({ children }) => (
      <p className="font-sans text-[14px] leading-[1.65] text-studio-ink my-3">
        {children}
      </p>
    ),
    a: ({ href, children }) => (
      <a
        href={href}
        className="text-studio-ink underline decoration-studio-edge underline-offset-2 hover:decoration-studio-ink"
        target={href?.startsWith("http") ? "_blank" : undefined}
        rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
      >
        <InsideAnchorContext.Provider value={true}>
          {children}
        </InsideAnchorContext.Provider>
      </a>
    ),
    img: ({ src, alt }) => {
      if (typeof src === "string" && src.startsWith("arc:")) {
        return <ArcMarkdownDiagram src={src.slice("arc:".length)} alt={alt} />;
      }
      return (
        <img
          src={src}
          alt={alt ?? ""}
          className="my-5 rounded-lg border border-studio-edge"
        />
      );
    },
    ul: ({ children }) => (
      <ul className="font-sans text-[14px] leading-[1.65] text-studio-ink my-3 ml-5 list-disc space-y-1">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="font-sans text-[14px] leading-[1.65] text-studio-ink my-3 ml-5 list-decimal space-y-1">
        {children}
      </ol>
    ),
    li: ({ children }) => <li className="pl-1">{children}</li>,
    strong: ({ children }) => (
      <strong className="font-semibold text-studio-ink">{children}</strong>
    ),
    em: ({ children }) => <em className="italic">{children}</em>,
    hr: () => <hr className="my-8 border-studio-edge" />,
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-studio-edge pl-4 my-4 font-sans text-[14px] italic text-studio-ink-faint">
        {children}
      </blockquote>
    ),
    code: (props) => <CodeRenderer {...props} fromSlug={fromSlug} />,
    pre: ({ children }) => (
      <pre className="my-4 overflow-x-auto rounded-md border border-studio-edge bg-studio-canvas-alt p-4 font-mono text-[12.5px] leading-[1.55]">
        {children}
      </pre>
    ),
    table: ({ children }) => (
      <div className="my-5 overflow-x-auto">
        <table className="w-full border-collapse font-sans text-[13px]">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => (
      <thead className="border-b border-studio-edge text-left">
        {children}
      </thead>
    ),
    th: ({ children }) => (
      <th className="px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="px-3 py-1.5 border-b border-studio-edge align-top text-studio-ink">
        {children}
      </td>
    ),
  };
}

function ArcMarkdownDiagram({ src, alt }: { src: string; alt?: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(
      `/api/repo-file?path=${encodeURIComponent(`docs/diagrams/${src}.arc.json`)}&full=1`,
    )
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((payload) => {
        const raw = typeof payload.excerpt === "string" ? payload.excerpt : "";
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (!cancelled) setData(parsed);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "failed");
      });
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (error) {
    return (
      <div className="my-5 rounded-lg border border-rose-300/30 bg-rose-300/[0.07] px-4 py-3 font-mono text-[11px] text-rose-100/80">
        Could not load Arc diagram: {src}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="my-5 aspect-[10/6] animate-pulse rounded-lg border border-studio-edge bg-studio-canvas-alt" />
    );
  }

  const layout = data.layout as { width?: number; height?: number } | undefined;
  const aspectRatio = layout?.width && layout?.height
    ? `${layout.width}/${layout.height}`
    : "10/6";

  return (
    <figure className="my-6">
      <div
        className="overflow-hidden rounded-xl border border-studio-edge bg-studio-canvas-alt"
        style={{ aspectRatio }}
      >
        <ArcDiagram
          data={data}
          className="h-full w-full !rounded-none !border-0 !bg-studio-canvas-alt !shadow-none"
          mode="dark"
          theme="cool"
          interactive={true}
          showArcToggle={false}
          label={formatDiagramLabel(src)}
          defaultZoom="fit"
          maxFitZoom={0.95}
          hoverEffects={{ dim: true, lift: true, glow: true, highlightEdges: true }}
        />
      </div>
      {alt ? (
        <figcaption className="mt-2 font-mono text-[10px] text-studio-ink-faint">
          {alt}
        </figcaption>
      ) : null}
    </figure>
  );
}

function formatDiagramLabel(src: string) {
  return DIAGRAM_CODES[src] ?? `SCOUT-${src.toUpperCase().replace(/-/g, "")}`;
}

function CodeRenderer({
  className,
  children,
  node: _node,
  fromSlug,
  ...rest
}: React.HTMLAttributes<HTMLElement> & {
  node?: unknown;
  fromSlug?: string;
  children?: React.ReactNode;
}) {
  const insideAnchor = useContext(InsideAnchorContext);
  const isInline = !className;
  if (isInline) {
    const text = extractText(children);
    const viewable = isViewablePath(text);
    if (viewable && !insideAnchor) {
      return (
        <Link
          href={buildFileHref(viewable.path, fromSlug)}
          className="font-mono text-[12.5px] bg-studio-canvas-alt text-studio-ink px-1 py-px rounded-[2px] underline decoration-studio-edge underline-offset-2 hover:decoration-studio-ink hover:text-studio-ink transition-colors"
        >
          {children}
        </Link>
      );
    }
    return (
      <code
        className="font-mono text-[12.5px] bg-studio-canvas-alt text-studio-ink px-1 py-px rounded-[2px]"
        {...rest}
      >
        {children}
      </code>
    );
  }
  return (
    <code className={`${className ?? ""} font-mono text-[12.5px]`} {...rest}>
      {children}
    </code>
  );
}

function slugify(node: React.ReactNode): string {
  const text = extractText(node);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    // @ts-expect-error — children is dynamic on the ReactElement props
    return extractText(node.props.children);
  }
  return "";
}
