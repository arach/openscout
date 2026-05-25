/**
 * Shared engage state hook for HUD tabs.
 *
 * Standardizes the tap/engage pattern across all four tabs:
 *   · `toggle(id)`  — click a row. If it's the engaged row, close. If
 *                     another row is engaged, swap to this one without
 *                     closing. If nothing is engaged, open it.
 *   · Esc closes the engage panel.
 *
 * Each tab calls `useHudEngage()` to manage its own engaged-row id.
 * Engage state is per-tab; switching tabs resets to closed.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import type { EngageState } from "./types";

export interface HudEngageApi {
  engaged: EngageState;
  /** Click handler — opens, swaps, or closes. */
  toggle: (id: string) => void;
  /** Direct setter for explicit selection (used at large where the side
   *  column always shows something). */
  select: (id: string | null) => void;
  /** True when the given id is currently engaged. */
  isEngaged: (id: string) => boolean;
}

export function useHudEngage(): HudEngageApi {
  const [engaged, setEngaged] = useState<EngageState>(null);

  const toggle = useCallback((id: string) => {
    setEngaged((current) => (current === id ? null : id));
  }, []);

  const select = useCallback((id: string | null) => {
    setEngaged(id);
  }, []);

  const isEngaged = useCallback(
    (id: string) => engaged === id,
    [engaged],
  );

  // Esc closes the engage panel.
  useEffect(() => {
    if (!engaged) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const target = e.target as HTMLElement | null;
        const inEditable =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          (target?.isContentEditable ?? false);
        if (inEditable) return;
        setEngaged(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [engaged]);

  return { engaged, toggle, select, isEngaged };
}
