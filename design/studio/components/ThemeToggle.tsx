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
    <div
      role="group"
      aria-label="Theme"
      className="flex w-full items-center gap-0.5 rounded-[5px] border border-studio-edge p-0.5"
    >
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
        "focus-ring flex-1 rounded-[3px] px-2 py-1 font-mono text-2xs font-semibold uppercase tracking-ch transition-colors",
        active
          ? "bg-studio-canvas text-studio-ink shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--studio-ink)_10%,transparent)]"
          : "text-studio-ink-faint hover:text-studio-ink",
      ].join(" ")}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}
