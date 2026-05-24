import hljs from "highlight.js/lib/common";

/**
 * CodeExcerpt — static, read-only code block with a faint line-number
 * gutter. Server-rendered, zero client JS. Syntax highlighting via
 * highlight.js using the `.hljs-*` rules in app/globals.css (which
 * mirror the CodeMirror studio theme palette).
 *
 * Two-column flex: line-number gutter on the left, highlighted blob on
 * the right. Both columns share the same leading so the line numbers
 * line up with the code rows.
 *
 * Optional `startLine`/`endLine` slice the supplied content and render
 * a small "lines N–M" caption above. `maxLines` caps the rendered
 * range (default 80) and appends a truncation marker if exceeded.
 */
export function CodeExcerpt({
  content,
  language,
  startLine,
  endLine,
  maxLines = 80,
}: {
  content: string;
  language?: string;
  startLine?: number;
  endLine?: number;
  maxLines?: number;
}) {
  const allLines = content.split("\n");

  const fromIdx = startLine ? Math.max(0, startLine - 1) : 0;
  const toIdx = endLine ? Math.min(allLines.length, endLine) : allLines.length;
  const windowed = allLines.slice(fromIdx, toIdx);

  const capped = windowed.slice(0, maxLines);
  const truncated = windowed.length > maxLines;
  const firstLineNo = fromIdx + 1;
  const lastLineNo = firstLineNo + capped.length - 1;
  const gutterWidth = String(lastLineNo).length;

  const blob = capped.join("\n");
  const highlighted = highlight(blob, language);
  const gutter = capped
    .map((_, i) => String(firstLineNo + i).padStart(gutterWidth, " "))
    .join("\n");

  return (
    <div className="font-mono text-[11.5px] leading-[1.55]">
      {(startLine || endLine || language) ? (
        <div className="mb-1.5 flex items-baseline gap-2 px-1 text-[9.5px] uppercase tracking-eyebrow text-studio-ink-faint">
          {language ? <span>{language}</span> : null}
          {language && (startLine || endLine) ? (
            <span aria-hidden className="text-studio-ink-faint">·</span>
          ) : null}
          {startLine || endLine ? (
            <span className="tabular-nums normal-case tracking-normal">
              lines {firstLineNo}
              <span aria-hidden className="px-0.5">–</span>
              {lastLineNo}
            </span>
          ) : null}
        </div>
      ) : null}

      <div
        className="overflow-hidden rounded-md border"
        style={{
          background: "var(--code-bg)",
          borderColor: "var(--code-border)",
        }}
      >
        <div className="flex">
          <pre
            aria-hidden
            className="m-0 shrink-0 select-none px-3 py-2 text-right text-studio-ink-faint tabular-nums"
            style={{
              borderRight: "1px solid var(--code-border)",
              minWidth: `${gutterWidth + 2}ch`,
            }}
          >
            {gutter}
          </pre>
          <pre className="m-0 flex-1 overflow-x-auto px-3 py-2">
            <code
              className={`hljs language-${language ?? "plaintext"}`}
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
          </pre>
        </div>
        {truncated ? (
          <div
            className="flex items-baseline border-t"
            style={{ borderColor: "var(--code-border)" }}
          >
            <span
              aria-hidden
              className="select-none px-3 py-1 text-right text-studio-ink-faint tabular-nums"
              style={{
                minWidth: `${gutterWidth + 2}ch`,
                borderRight: "1px solid var(--code-border)",
              }}
            >
              …
            </span>
            <span className="flex-1 px-3 py-1 italic text-studio-ink-faint text-[10px]">
              truncated at {maxLines} lines ({windowed.length - maxLines} more)
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Highlight `code` using highlight.js. Falls back to escaped plaintext
 * when the language is unknown. `highlight.js/lib/common` carries the
 * popular ~36-language set on the server bundle only — no client JS.
 */
function highlight(code: string, language?: string): string {
  const lang = resolveLanguage(language);
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    } catch {
      /* fall through to plain */
    }
  }
  return escapeHtml(code);
}

/** Map file extensions / common short names to highlight.js language IDs. */
const LANG_ALIAS: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  md: "markdown",
  mdx: "markdown",
  yml: "yaml",
  sh: "bash",
  zsh: "bash",
  htm: "xml",
  html: "xml",
  svg: "xml",
  rb: "ruby",
  py: "python",
  rs: "rust",
  kt: "kotlin",
  cs: "csharp",
  hpp: "cpp",
  cc: "cpp",
  h: "c",
  obj: "objectivec",
  m: "objectivec",
  mm: "objectivec",
  toml: "ini",
};
function resolveLanguage(input?: string): string | undefined {
  if (!input) return undefined;
  const lower = input.toLowerCase();
  return LANG_ALIAS[lower] ?? lower;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
