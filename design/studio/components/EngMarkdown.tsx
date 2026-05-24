"use client";

import { createContext, useContext } from "react";
import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

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
