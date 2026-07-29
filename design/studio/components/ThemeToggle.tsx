"use client";

import { useEffect } from "react";
import { useTheme, type HudsonTheme } from "hudsonkit/theme";

/**
 * Dark / light toggle backed by Hudsonkit's ThemeProvider.
 *
 * Also mirrors the resolved theme onto `data-theme` so older studio CSS
 * (eng-doc highlight, CodeViewer, foundation swatches) that still keys
 * off that attribute keeps working while we migrate fully to
 * `data-hudson-theme`.
 */
export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const active: "dark" | "light" =
    resolvedTheme === "light" || theme === "light" ? "light" : "dark";

  useEffect(() => {
    if (!resolvedTheme) return;
    document.documentElement.dataset.theme = resolvedTheme;
  }, [resolvedTheme]);

  const apply = (next: Exclude<HudsonTheme, "system">) => {
    setTheme(next);
    document.documentElement.dataset.theme = next;
  };

  return (
    <div className="flex items-center gap-px rounded-[3px] border border-studio-edge p-px">
      <Pill active={active === "dark"} onClick={() => apply("dark")} label="Dark" />
      <Pill active={active === "light"} onClick={() => apply("light")} label="Light" />
    </div>
  );
}

function Pill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "focus-ring flex-1 rounded-[2px] px-2 py-1 font-mono text-2xs font-semibold uppercase tracking-ch transition-colors",
        active
          ? "bg-studio-canvas-alt text-studio-ink"
          : "text-studio-ink-faint hover:text-studio-ink",
      ].join(" ")}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}
