import { type ReactNode } from "react";

export type TextDocumentKind = "text" | "markdown" | "code" | "raw";
export type TextDocumentMode = "read" | "preview";
export type TextDocumentLanguage =
  | "css"
  | "html"
  | "javascript"
  | "json"
  | "markdown"
  | "plain"
  | "shell"
  | "typescript";

export type TextDocument = {
  id: string;
  title: string;
  uri?: string;
  mediaType?: string;
  language?: TextDocumentLanguage;
  kind: TextDocumentKind;
  value: string;
  readOnly?: boolean;
};

export type TextDocumentDetectionInput = {
  id?: string;
  title?: string;
  uri?: string;
  filename?: string;
  mediaType?: string;
  kind?: TextDocumentKind;
  language?: TextDocumentLanguage;
  value: string;
  readOnly?: boolean;
};

const EXTENSION_LANGUAGE: Record<string, TextDocumentLanguage> = {
  cjs: "javascript",
  css: "css",
  htm: "html",
  html: "html",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  mjs: "javascript",
  md: "markdown",
  mdx: "markdown",
  sh: "shell",
  ts: "typescript",
  tsx: "typescript",
  txt: "plain",
};

const CODE_EXTENSIONS = new Set([
  "cjs",
  "css",
  "htm",
  "html",
  "js",
  "jsx",
  "json",
  "mjs",
  "sh",
  "ts",
  "tsx",
]);

function extensionFor(input: Pick<TextDocumentDetectionInput, "filename" | "title" | "uri">): string {
  const name = input.filename ?? input.title ?? input.uri ?? "";
  const clean = name.split(/[?#]/)[0];
  const basename = clean.split("/").pop() ?? clean;
  const dotIndex = basename.lastIndexOf(".");
  return dotIndex >= 0 ? basename.slice(dotIndex + 1).toLowerCase() : "";
}

export function inferTextDocumentLanguage(
  input: Pick<TextDocumentDetectionInput, "filename" | "title" | "uri" | "mediaType">,
): TextDocumentLanguage {
  const mediaType = input.mediaType?.toLowerCase() ?? "";
  if (mediaType.includes("json")) return "json";
  if (mediaType.includes("markdown")) return "markdown";
  if (mediaType.includes("javascript")) return "javascript";
  if (mediaType.includes("typescript")) return "typescript";
  if (mediaType.includes("html")) return "html";
  if (mediaType.includes("css")) return "css";
  if (mediaType.includes("shell") || mediaType.includes("x-sh")) return "shell";

  return EXTENSION_LANGUAGE[extensionFor(input)] ?? "plain";
}

export function detectTextDocumentKind(input: TextDocumentDetectionInput): TextDocumentKind {
  const mediaType = input.mediaType?.toLowerCase() ?? "";
  const extension = extensionFor(input);

  if (mediaType.includes("markdown") || extension === "md" || extension === "mdx") return "markdown";
  if (mediaType.includes("json") || mediaType.includes("javascript") || mediaType.includes("typescript")) return "code";
  if (mediaType.includes("html") || mediaType.includes("xml") || mediaType.includes("css")) return "code";
  if (CODE_EXTENSIONS.has(extension)) return "code";
  if (mediaType.startsWith("text/") || extension === "txt") return "text";

  const value = input.value.trim();
  if (/^#{1,6}\s+/m.test(value) || /```[\s\S]*```/.test(value)) return "markdown";
  return "text";
}

export function createTextDocument(input: TextDocumentDetectionInput): TextDocument {
  const title = input.title ?? input.filename ?? input.uri?.split("/").pop() ?? "Untitled";
  const language = input.language ?? inferTextDocumentLanguage(input);
  return {
    id: input.id ?? input.uri ?? title,
    title,
    uri: input.uri,
    mediaType: input.mediaType,
    language,
    kind: input.kind ?? detectTextDocumentKind(input),
    value: input.value,
    readOnly: input.readOnly,
  };
}

export function TextDocumentSurface({
  document,
  mode,
  className,
}: {
  document: TextDocument;
  mode?: TextDocumentMode;
  showHeader?: boolean;
  className?: string;
}) {
  const resolvedMode = mode ?? (document.kind === "markdown" ? "preview" : "read");
  const body = document.kind === "markdown" && resolvedMode === "preview"
    ? <MarkdownPreview markdown={document.value} />
    : <CodeLikePreview document={document} />;

  return (
    <div className={`s-text-document-surface s-text-document-surface-${document.kind}${className ? ` ${className}` : ""}`}>
      {body}
    </div>
  );
}

function CodeLikePreview({ document }: { document: TextDocument }) {
  return (
    <pre className="s-text-document-code" data-language={document.language ?? document.kind}>
      <code>{document.value}</code>
    </pre>
  );
}

function MarkdownPreview({ markdown }: { markdown: string }) {
  const blocks = parseMarkdownBlocks(markdown);
  return (
    <div className="s-text-document-markdown">
      {blocks.length > 0 ? blocks : <p />}
    </div>
  );
}

type MarkdownBlock =
  | { kind: "blockquote"; content: string }
  | { kind: "code"; content: string; language?: string }
  | { kind: "heading"; depth: 1 | 2 | 3 | 4 | 5 | 6; content: string }
  | { kind: "hr" }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "paragraph"; content: string };

function parseMarkdownBlocks(markdown: string): ReactNode[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = /^```(\S*)\s*$/.exec(line);
    if (fence) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? "")) {
        code.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) {
        i += 1;
      }
      blocks.push({ kind: "code", content: code.join("\n"), language: fence[1] || undefined });
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        depth: toHeadingDepth(heading[1].length),
        content: heading[2].trim(),
      });
      i += 1;
      continue;
    }

    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ kind: "hr" });
      i += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i] ?? "")) {
        quote.push((lines[i] ?? "").replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ kind: "blockquote", content: quote.join(" ") });
      continue;
    }

    const listMatch = /^(\s*)([-*+]|\d+[.)])\s+(.+)$/.exec(line);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[2]);
      const items: string[] = [];
      while (i < lines.length) {
        const itemMatch = /^(\s*)([-*+]|\d+[.)])\s+(.+)$/.exec(lines[i] ?? "");
        if (!itemMatch || /\d/.test(itemMatch[2]) !== ordered) {
          break;
        }
        items.push(itemMatch[3]);
        i += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length) {
      const nextLine = lines[i] ?? "";
      if (
        !nextLine.trim()
        || /^```/.test(nextLine)
        || /^(#{1,6})\s+/.test(nextLine)
        || /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(nextLine)
        || /^>\s?/.test(nextLine)
        || /^(\s*)([-*+]|\d+[.)])\s+/.test(nextLine)
      ) {
        break;
      }
      paragraph.push(nextLine.trim());
      i += 1;
    }
    blocks.push({ kind: "paragraph", content: paragraph.join(" ") });
  }

  return blocks.map((block, index) => renderMarkdownBlock(block, index));
}

function toHeadingDepth(value: number): 1 | 2 | 3 | 4 | 5 | 6 {
  if (value <= 1) return 1;
  if (value === 2) return 2;
  if (value === 3) return 3;
  if (value === 4) return 4;
  if (value === 5) return 5;
  return 6;
}

function renderMarkdownBlock(block: MarkdownBlock, index: number): ReactNode {
  switch (block.kind) {
    case "heading": {
      const HeadingTag = `h${block.depth}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return <HeadingTag key={index}>{renderInlineMarkdown(block.content)}</HeadingTag>;
    }
    case "paragraph":
      return <p key={index}>{renderInlineMarkdown(block.content)}</p>;
    case "blockquote":
      return <blockquote key={index}>{renderInlineMarkdown(block.content)}</blockquote>;
    case "list": {
      const ListTag = block.ordered ? "ol" : "ul";
      return (
        <ListTag key={index}>
          {block.items.map((item, itemIndex) => (
            <li key={`${index}:${itemIndex}`}>{renderInlineMarkdown(item)}</li>
          ))}
        </ListTag>
      );
    }
    case "code":
      return (
        <pre key={index} className="s-text-document-fenced-code" data-language={block.language}>
          <code>{block.content}</code>
        </pre>
      );
    case "hr":
      return <hr key={index} />;
  }
}

function renderInlineMarkdown(value: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(value.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(<code key={nodes.length}>{token.slice(1, -1)}</code>);
    } else {
      const href = safeMarkdownHref(match[3]);
      nodes.push(href
        ? (
            <a key={nodes.length} href={href} target="_blank" rel="noreferrer">
              {match[2]}
            </a>
          )
        : match[2]);
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < value.length) {
    nodes.push(value.slice(lastIndex));
  }
  return nodes;
}

function safeMarkdownHref(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:"
      ? value
      : null;
  } catch {
    return null;
  }
}
