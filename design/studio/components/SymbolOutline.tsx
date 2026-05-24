"use client";

import { useMemo, useState } from "react";

/**
 * SymbolOutline — cheap regex-driven structure view for the right-hand
 * rail of the file-explorer. Two extractors:
 *
 *   - Markdown: pulls `##` and `###` headings, indented by level.
 *   - TS / TSX / JS / Swift: top-level `function`, `export function`,
 *     `class`, `interface`, `type` declarations.
 *
 * This is deliberately not a real parser. It's a "good enough" peek
 * that gives the reader a sense of shape; for anything heavier the
 * full file viewer still has CodeMirror's fold gutter.
 */

interface Symbol {
  name: string;
  kind: string;
  line: number;
  depth: number;
}

export function SymbolOutline({
  content,
  language,
  onSelect,
}: {
  content: string;
  language?: string;
  onSelect?: (line: number) => void;
}) {
  const [open, setOpen] = useState(true);

  const symbols = useMemo(
    () => extractSymbols(content, language),
    [content, language],
  );

  if (symbols.length === 0) {
    return (
      <div className="rounded-md border border-studio-edge bg-studio-surface px-3 py-2 font-mono text-[10px] italic text-studio-ink-faint">
        No symbols detected.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-studio-edge bg-studio-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-baseline gap-2 border-b border-studio-edge px-3 py-1.5 text-left transition-colors hover:bg-studio-canvas-alt"
      >
        <span
          aria-hidden
          className={`w-3 shrink-0 text-[10px] text-studio-ink-faint transition-transform ${
            open ? "translate-y-px" : ""
          }`}
        >
          {open ? "▾" : "▸"}
        </span>
        <span className="flex-1 font-mono text-[9.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          Outline
        </span>
        <span className="font-mono text-[9.5px] tabular-nums text-studio-ink-faint">
          {symbols.length}
        </span>
      </button>

      {open ? (
        <ul className="flex flex-col py-1">
          {symbols.map((sym, i) => (
            <li key={`${sym.line}:${i}`}>
              <button
                type="button"
                onClick={() => onSelect?.(sym.line)}
                className="group flex w-full items-baseline gap-2 px-3 py-[3px] text-left transition-colors hover:bg-studio-canvas-alt"
                style={{ paddingLeft: 12 + sym.depth * 12 }}
              >
                <span
                  aria-hidden
                  className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-studio-ink-faint group-hover:text-studio-ink-faint"
                  style={{ minWidth: "3.5ch" }}
                >
                  {SHORT_KIND[sym.kind] ?? sym.kind.slice(0, 3)}
                </span>
                <span className="flex-1 truncate font-mono text-[11px] text-studio-ink-muted group-hover:text-studio-ink">
                  {sym.name}
                </span>
                <span className="font-mono text-[9.5px] tabular-nums text-studio-ink-faint">
                  {sym.line}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const SHORT_KIND: Record<string, string> = {
  heading: "H",
  function: "fn",
  class: "cls",
  interface: "if",
  type: "ty",
  const: "co",
  enum: "en",
  struct: "st",
  protocol: "pr",
};

function extractSymbols(content: string, language?: string): Symbol[] {
  const lang = (language ?? "").toLowerCase();
  const lines = content.split("\n");

  if (lang === "md" || lang === "mdx" || lang === "markdown") {
    return extractMarkdown(lines);
  }
  if (
    lang === "ts" ||
    lang === "tsx" ||
    lang === "js" ||
    lang === "jsx" ||
    lang === "mjs" ||
    lang === "cjs"
  ) {
    return extractJsLike(lines);
  }
  if (lang === "swift") {
    return extractSwift(lines);
  }
  return [];
}

function extractMarkdown(lines: string[]): Symbol[] {
  const out: Symbol[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{2,3})\s+(.+?)\s*$/);
    if (m) {
      const level = m[1].length;
      out.push({
        name: m[2],
        kind: "heading",
        line: i + 1,
        depth: level - 2,
      });
    }
  }
  return out;
}

function extractJsLike(lines: string[]): Symbol[] {
  const out: Symbol[] = [];
  // Top-level declarations only. Indentation = 0 (no leading space/tab).
  const patterns: Array<{ re: RegExp; kind: string; nameIdx: number }> = [
    { re: /^export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/, kind: "function", nameIdx: 1 },
    { re: /^(?:async\s+)?function\s+(\w+)/, kind: "function", nameIdx: 1 },
    { re: /^export\s+(?:default\s+)?class\s+(\w+)/, kind: "class", nameIdx: 1 },
    { re: /^class\s+(\w+)/, kind: "class", nameIdx: 1 },
    { re: /^export\s+interface\s+(\w+)/, kind: "interface", nameIdx: 1 },
    { re: /^interface\s+(\w+)/, kind: "interface", nameIdx: 1 },
    { re: /^export\s+type\s+(\w+)/, kind: "type", nameIdx: 1 },
    { re: /^type\s+(\w+)/, kind: "type", nameIdx: 1 },
    { re: /^export\s+const\s+(\w+)\s*[:=]/, kind: "const", nameIdx: 1 },
    { re: /^export\s+enum\s+(\w+)/, kind: "enum", nameIdx: 1 },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s/.test(line)) continue; // top-level only
    for (const { re, kind, nameIdx } of patterns) {
      const m = line.match(re);
      if (m) {
        out.push({ name: m[nameIdx], kind, line: i + 1, depth: 0 });
        break;
      }
    }
  }
  return out;
}

function extractSwift(lines: string[]): Symbol[] {
  const out: Symbol[] = [];
  const patterns: Array<{ re: RegExp; kind: string }> = [
    { re: /^(?:public\s+|private\s+|internal\s+|fileprivate\s+|open\s+)?(?:final\s+)?class\s+(\w+)/, kind: "class" },
    { re: /^(?:public\s+|private\s+|internal\s+|fileprivate\s+|open\s+)?struct\s+(\w+)/, kind: "struct" },
    { re: /^(?:public\s+|private\s+|internal\s+|fileprivate\s+|open\s+)?protocol\s+(\w+)/, kind: "protocol" },
    { re: /^(?:public\s+|private\s+|internal\s+|fileprivate\s+|open\s+)?enum\s+(\w+)/, kind: "enum" },
    { re: /^(?:public\s+|private\s+|internal\s+|fileprivate\s+|open\s+)?(?:static\s+)?func\s+(\w+)/, kind: "function" },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s/.test(line)) continue;
    for (const { re, kind } of patterns) {
      const m = line.match(re);
      if (m) {
        out.push({ name: m[1], kind, line: i + 1, depth: 0 });
        break;
      }
    }
  }
  return out;
}
