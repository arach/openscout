"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownProse({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="mt-12 mb-4 font-[family-name:var(--font-display)] text-3xl tracking-[-0.02em] text-foreground first:mt-0">
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="mt-10 mb-3 font-[family-name:var(--font-display)] text-2xl tracking-[-0.01em] text-foreground">
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="mt-8 mb-2 text-lg font-medium text-foreground">
            {children}
          </h3>
        ),
        h4: ({ children }) => (
          <h4 className="mt-6 mb-2 text-base font-medium text-foreground">
            {children}
          </h4>
        ),
        p: ({ children }) => (
          <p className="my-3 text-[15px] leading-[1.7] text-secondary">
            {children}
          </p>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            className="text-accent underline underline-offset-2 decoration-accent/30 hover:decoration-accent transition-colors"
          >
            {children}
          </a>
        ),
        ul: ({ children }) => (
          <ul className="my-3 ml-1 list-none space-y-1.5 text-[15px] leading-[1.7] text-secondary">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="my-3 ml-5 list-decimal space-y-1.5 text-[15px] leading-[1.7] text-secondary">
            {children}
          </ol>
        ),
        li: ({ children }) => (
          <li className="relative pl-4 before:absolute before:left-0 before:top-[0.7em] before:h-1 before:w-1 before:rounded-full before:bg-muted">
            {children}
          </li>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-4 border-l-2 border-border-strong pl-4 text-[15px] leading-[1.7] text-muted italic">
            {children}
          </blockquote>
        ),
        code: ({ className, children }) => {
          const isBlock = className?.includes("language-");
          if (isBlock) {
            return (
              <code className="block overflow-x-auto rounded-lg border border-border bg-surface p-4 font-mono text-[13px] leading-relaxed text-foreground">
                {children}
              </code>
            );
          }
          return (
            <code className="rounded bg-surface-elevated px-1.5 py-0.5 font-mono text-[13px] text-accent">
              {children}
            </code>
          );
        },
        pre: ({ children }) => (
          <pre className="my-4">{children}</pre>
        ),
        table: ({ children }) => (
          <div className="my-4 overflow-x-auto">
            <table className="w-full border-collapse text-[14px]">
              {children}
            </table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="border-b border-border-strong">{children}</thead>
        ),
        th: ({ children }) => (
          <th className="px-3 py-2 text-left font-mono text-[12px] uppercase tracking-wider text-muted">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border-b border-border px-3 py-2 text-secondary">
            {children}
          </td>
        ),
        hr: () => <hr className="my-8 border-border" />,
        strong: ({ children }) => (
          <strong className="font-medium text-foreground">{children}</strong>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
