"use client";

import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { json } from "@codemirror/lang-json";
import { css as cssLang } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { go } from "@codemirror/legacy-modes/mode/go";
import { python } from "@codemirror/legacy-modes/mode/python";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { StreamLanguage } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { studioCodeTheme } from "@/lib/cm-studio-theme";
import { useEffect, useState } from "react";

/**
 * Read-only code viewer for file references inside engineering docs.
 *
 * CodeMirror 6 in display mode — line numbers, language-aware
 * highlighting, no editing affordances. Uses the studio-native theme
 * from lib/cm-studio-theme.ts so colors track --code-bg, --studio-ink,
 * --scout-accent, and the --status-* palette rather than vendor GitHub.
 */
interface CodeViewerProps {
  content: string;
  filename: string;
}

export function CodeViewer({ content, filename }: CodeViewerProps) {
  const [mode, setMode] = useState<"light" | "dark">("dark");

  useEffect(() => {
    const root = document.documentElement;
    const read = () =>
      setMode(root.dataset.theme === "light" ? "light" : "dark");
    read();
    const obs = new MutationObserver(read);
    obs.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  const lang = languageForFilename(filename);
  const extensions: Extension[] = [
    EditorView.editable.of(false),
    EditorView.contentAttributes.of({ tabindex: "0" }),
    ...studioCodeTheme(mode),
  ];
  if (lang) extensions.push(lang);

  return (
    <CodeMirror
      value={content}
      readOnly
      theme="none"
      extensions={extensions}
      basicSetup={{
        lineNumbers: true,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        foldGutter: true,
        dropCursor: false,
        allowMultipleSelections: false,
        autocompletion: false,
        bracketMatching: true,
        closeBrackets: false,
        crosshairCursor: false,
        indentOnInput: false,
      }}
    />
  );
}

function languageForFilename(filename: string): Extension | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "swift":
      return StreamLanguage.define(swift);
    case "ts":
      return javascript({ typescript: true });
    case "tsx":
      return javascript({ typescript: true, jsx: true });
    case "js":
      return javascript();
    case "jsx":
      return javascript({ jsx: true });
    case "md":
    case "mdx":
      return markdown();
    case "json":
      return json();
    case "css":
    case "scss":
      return cssLang();
    case "html":
    case "htm":
      return html();
    case "sh":
    case "bash":
    case "zsh":
      return StreamLanguage.define(shell);
    case "yaml":
    case "yml":
      return StreamLanguage.define(yaml);
    case "toml":
      return StreamLanguage.define(toml);
    case "rs":
      return StreamLanguage.define(rust);
    case "go":
      return StreamLanguage.define(go);
    case "py":
      return StreamLanguage.define(python);
    case "sql":
      return StreamLanguage.define(standardSQL);
    default:
      return null;
  }
}
