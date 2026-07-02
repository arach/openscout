"use client";

import { useState, type ReactNode } from "react";

/**
 * Shared frame for the focused macOS Scout studies (scout-comms, scout-tail,
 * scout-settings). Renders the standard study header (eyebrow / title / blurb)
 * plus the skin toggle, and wraps the surface in a `data-scout-skin` container
 * so every child reads the shared `--s-*` tokens (see app/scout-skins.css).
 *
 * Children may be a node or a render-prop that receives the active skin id, for
 * surfaces that want to vary copy or assets per skin.
 */

export const SCOUT_SKINS = [
  { id: "juniper-l", label: "Juniper", tone: "Light", current: true },
  { id: "juniper-d", label: "Juniper", tone: "Dark", current: false },
  { id: "graphite", label: "Graphite", tone: "Dark", current: false },
] as const;

export type ScoutSkinId = (typeof SCOUT_SKINS)[number]["id"];

export function ScoutStudyShell({
  pageId,
  title,
  blurb,
  surface = "macos",
  initialSkin = "juniper-l",
  children,
}: {
  pageId: string;
  title: string;
  blurb: ReactNode;
  surface?: "web" | "ios" | "macos" | "shell" | "cross";
  initialSkin?: ScoutSkinId;
  children: ReactNode | ((skin: ScoutSkinId) => ReactNode);
}) {
  const [skin, setSkin] = useState<ScoutSkinId>(() => {
    if (typeof window !== "undefined") {
      const q = new URLSearchParams(window.location.search).get("skin");
      if (q && SCOUT_SKINS.some((s) => s.id === q)) {
        return q as ScoutSkinId;
      }
    }
    return initialSkin;
  });

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-prose">
          <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            · studies · {surface} · {pageId}
          </div>
          <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
            {title}
          </h1>
          <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
            {blurb}
          </p>
        </div>
        <ScoutSkinToggle skin={skin} setSkin={setSkin} />
      </header>
      <div data-scout-skin={skin}>
        {typeof children === "function" ? children(skin) : children}
      </div>
    </main>
  );
}

export function ScoutSkinToggle({
  skin,
  setSkin,
}: {
  skin: ScoutSkinId;
  setSkin: (skin: ScoutSkinId) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-studio-edge p-0.5">
      {SCOUT_SKINS.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => setSkin(s.id)}
          className={`relative rounded-[5px] px-3 py-1.5 text-left transition-colors ${
            skin === s.id
              ? "bg-studio-surface text-studio-ink"
              : "text-studio-ink-faint hover:text-studio-ink"
          }`}
        >
          <div className="flex items-center gap-1.5 font-mono text-[11px] font-semibold">
            {s.label}
            {s.current ? (
              <span
                className="h-1.5 w-1.5 rounded-full bg-emerald-500"
                title="current app theme"
              />
            ) : null}
          </div>
          <div className="font-mono text-[8.5px] uppercase tracking-eyebrow opacity-70">
            {s.tone}
          </div>
        </button>
      ))}
    </div>
  );
}
