"use client";

/**
 * Read-only code viewer for file references.
 *
 * Now a thin wrapper over the shared `studio/code` CodeViewer (adopted
 * from the `studio` package — see its adoption recipe). The shared viewer
 * is the same CodeMirror 6 display-mode component with the studio-native
 * theme; `studioCodeTheme` pulls colors from the same CSS vars this app
 * already defines (--code-bg, --studio-ink, --scout-accent, …).
 *
 * `themeDetection: data-attribute` watches `data-theme` on <html>, which
 * is exactly how this app toggles light/dark (see ThemeToggle).
 *
 * Local API preserved ({ content, filename }) so existing import sites
 * (`@/components/CodeViewer`) don't change.
 */
import { CodeViewer as SharedCodeViewer } from "studio/code";

export function CodeViewer({ content, filename }: { content: string; filename: string }) {
  return (
    <SharedCodeViewer
      content={content}
      filename={filename}
      themeDetection={{ mode: "data-attribute" }}
    />
  );
}
