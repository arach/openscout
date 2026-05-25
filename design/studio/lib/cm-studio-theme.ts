import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { tags as t } from "@lezer/highlight";

/**
 * CodeMirror theme that lives inside the studio token system —
 * background pulls from --code-bg, gutter + accents from --studio-*
 * and --scout-accent, syntax colors from the --status-* palette. The
 * result reads as part of the studio rather than a bolted-on github
 * theme.
 *
 * Same `Extension[]` shape on both branches so the consumer can swap
 * by passing one or the other.
 */

const chrome = (mode: "dark" | "light") =>
  EditorView.theme(
    {
      "&": {
        color: "var(--studio-ink)",
        backgroundColor: "var(--code-bg)",
      },
      ".cm-content": {
        caretColor: "var(--scout-accent)",
      },
      ".cm-scroller": {
        fontFamily:
          '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
        fontSize: "12.5px",
        lineHeight: "1.55",
      },
      ".cm-gutters": {
        backgroundColor: "var(--code-bg)",
        color: "var(--studio-ink-faint)",
        border: "none",
        borderRight: "1px solid var(--code-border)",
      },
      ".cm-activeLineGutter, .cm-activeLine": {
        backgroundColor: "transparent",
      },
      ".cm-lineNumbers .cm-gutterElement": {
        color: "color-mix(in oklab, var(--studio-ink-faint) 70%, transparent)",
        padding: "0 12px 0 8px",
      },
      ".cm-foldGutter .cm-gutterElement": {
        color: "var(--studio-ink-faint)",
        opacity: 0.5,
      },
      ".cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "var(--scout-accent-soft)",
      },
      ".cm-cursor": {
        borderLeftColor: "var(--scout-accent)",
      },
      ".cm-tooltip": {
        backgroundColor: "var(--studio-surface)",
        borderColor: "var(--studio-edge)",
        color: "var(--studio-ink)",
      },
      ".cm-panels": {
        backgroundColor: "var(--studio-canvas)",
        color: "var(--studio-ink)",
      },
    },
    { dark: mode === "dark" },
  );

const KEYWORD = "var(--scout-accent)";
const STRING = "var(--status-warn-fg)";
const NUMBER = "var(--status-ok-fg)";
const TYPE = "var(--status-info-fg)";
const COMMENT = "color-mix(in oklab, var(--studio-ink-faint) 80%, transparent)";
const PUNCT = "color-mix(in oklab, var(--studio-ink-faint) 75%, transparent)";
const HEADING = "var(--studio-ink)";
const META = "var(--status-info-fg)";
const INVALID = "var(--status-error-fg)";

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.modifier], color: KEYWORD, fontWeight: "500" },
  { tag: [t.string, t.special(t.string), t.regexp], color: STRING },
  { tag: [t.number, t.bool, t.null], color: NUMBER },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: COMMENT, fontStyle: "italic" },
  { tag: [t.typeName, t.className, t.namespace], color: TYPE },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: "var(--studio-ink)" },
  { tag: [t.variableName, t.propertyName, t.labelName], color: "var(--studio-ink)" },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: "var(--studio-ink)" },
  { tag: [t.operator, t.punctuation, t.separator, t.bracket], color: PUNCT },
  { tag: [t.attributeName], color: TYPE },
  { tag: [t.attributeValue], color: STRING },
  { tag: [t.tagName, t.angleBracket], color: KEYWORD },
  { tag: [t.meta, t.processingInstruction, t.annotation], color: META },
  { tag: [t.invalid], color: INVALID, textDecoration: "underline wavy" },
  // Markdown-specific
  { tag: [t.heading, t.heading1, t.heading2, t.heading3, t.heading4], color: HEADING, fontWeight: "600" },
  { tag: [t.strong], color: "var(--studio-ink)", fontWeight: "700" },
  { tag: [t.emphasis], color: "var(--studio-ink)", fontStyle: "italic" },
  { tag: [t.link, t.url], color: KEYWORD, textDecoration: "underline" },
  { tag: [t.quote], color: COMMENT, fontStyle: "italic" },
  { tag: [t.monospace], color: STRING },
  { tag: [t.list], color: KEYWORD },
]);

export function studioCodeTheme(mode: "dark" | "light"): Extension[] {
  return [chrome(mode), syntaxHighlighting(highlight)];
}
