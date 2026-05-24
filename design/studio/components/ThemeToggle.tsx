"use client";

import { useEffect, useState } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "openscout-studio:theme";

/** Read the current theme from the html element. Browser-only. */
function readTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** Persistent dark/light toggle. Writes to localStorage and flips the
 *  `data-theme` attribute on <html>. Mirrors what the inline bootstrap
 *  script (in app/layout.tsx) does at first paint. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  const apply = (next: Theme) => {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* localStorage may be unavailable — no-op */
    }
  };

  return (
    <div className="flex items-center gap-px rounded-[3px] border border-studio-edge p-px">
      <Pill active={theme === "dark"} onClick={() => apply("dark")} label="Dark" />
      <Pill active={theme === "light"} onClick={() => apply("light")} label="Light" />
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
        "focus-ring flex-1 rounded-[2px] px-2 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] transition-colors",
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

/** Inline script body — run before paint to honor the saved theme.
 *  Embedded via dangerouslySetInnerHTML in app/layout.tsx so it
 *  executes synchronously in <head>. */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});var t=(s==='light'||s==='dark')?s:'dark';document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;
