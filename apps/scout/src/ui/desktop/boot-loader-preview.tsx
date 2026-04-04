import type { CSSProperties } from "react";
import { useMemo, useState } from "react";

import { BootLoader } from "@/components/boot-loader";
import { Moon, Sun } from "lucide-react";

const C = {
  bg: "var(--os-bg)",
  border: "var(--os-border)",
  termBg: "var(--os-terminal-bg)",
  termFg: "var(--os-terminal-fg)",
  accent: "var(--os-accent)",
};

/**
 * Dev-only full-screen preview of the boot loader. Open the Vite app with
 * `?boot-preview` (optionally `&dark` for dark mode on first paint).
 */
export default function BootLoaderPreview() {
  const [dark, setDark] = useState(() =>
    typeof window !== "undefined"
    && new URLSearchParams(window.location.search).has("dark"),
  );

  const s = useMemo(
    () => ({
      inkText: { color: "var(--os-ink)" } satisfies CSSProperties,
      mutedText: { color: "var(--os-muted)" } satisfies CSSProperties,
    }),
    [],
  );

  return (
    <div
      className={`min-h-screen w-full font-sans flex flex-col items-center justify-center px-6 py-10${dark ? " dark" : ""}`}
      style={{ backgroundColor: C.bg, color: "var(--os-ink)" }}
    >
      <button
        type="button"
        className="fixed top-4 right-4 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] transition-opacity hover:opacity-80"
        style={{ borderColor: C.border, color: "var(--os-muted)" }}
        onClick={() => setDark((d) => !d)}
      >
        {dark ? <Sun size={14} /> : <Moon size={14} />}
        {dark ? "Light" : "Dark"}
      </button>
      <BootLoader dark={dark} C={C} s={s} />
    </div>
  );
}
