"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export const MIN_SIDEBAR_W = 200;
export const MAX_SIDEBAR_W = 480;
export const DEFAULT_SIDEBAR_W = 260;
export const SIDEBAR_WIDTH_LS_KEY = "studio.sidebarWidth";

type SidebarWidthApi = {
  width: number;
  dragging: boolean;
  setWidth: (w: number) => void;
  nudge: (delta: number) => void;
  reset: () => void;
};

const Ctx = createContext<SidebarWidthApi | null>(null);

export function useSidebarWidth(): SidebarWidthApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSidebarWidth requires SidebarWidthProvider");
  return ctx;
}

function clamp(n: number) {
  return Math.min(MAX_SIDEBAR_W, Math.max(MIN_SIDEBAR_W, Math.round(n)));
}

function readStored(): number {
  if (typeof window === "undefined") return DEFAULT_SIDEBAR_W;
  try {
    const n = Number(localStorage.getItem(SIDEBAR_WIDTH_LS_KEY));
    if (Number.isFinite(n) && n >= MIN_SIDEBAR_W && n <= MAX_SIDEBAR_W) {
      return Math.round(n);
    }
  } catch {
    /* private mode */
  }
  return DEFAULT_SIDEBAR_W;
}

function writeStored(w: number) {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_LS_KEY, String(w));
  } catch {
    /* private mode */
  }
}

export function SidebarWidthProvider({ children }: { children: ReactNode }) {
  const [width, setWidthState] = useState(DEFAULT_SIDEBAR_W);
  const [dragging, setDragging] = useState(false);
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    const w = readStored();
    widthRef.current = w;
    setWidthState(w);
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--studio-sidebar-width",
      `${width}px`,
    );
  }, [width]);

  const setWidth = useCallback((raw: number) => {
    const next = clamp(raw);
    widthRef.current = next;
    setWidthState(next);
    writeStored(next);
  }, []);

  const nudge = useCallback(
    (delta: number) => setWidth(widthRef.current + delta),
    [setWidth],
  );

  const reset = useCallback(() => setWidth(DEFAULT_SIDEBAR_W), [setWidth]);

  // Global drag protocol: any element with data-studio-resize-handle
  // that receives pointerdown starts a window-level drag.
  useEffect(() => {
    let startX = 0;
    let startW = 0;
    let active = false;

    const onMove = (e: PointerEvent | MouseEvent) => {
      if (!active) return;
      const next = clamp(startW + (e.clientX - startX));
      widthRef.current = next;
      setWidthState(next);
    };

    const onUp = () => {
      if (!active) return;
      active = false;
      setDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      writeStored(widthRef.current);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (!t.closest("[data-studio-resize-handle]")) return;
      e.preventDefault();
      e.stopPropagation();
      active = true;
      startX = e.clientX;
      startW = widthRef.current;
      setDragging(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };

    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      onUp();
    };
  }, []);

  // Keyboard: [ and ] resize when not typing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.key === "[") {
        e.preventDefault();
        nudge(-24);
      } else if (e.key === "]") {
        e.preventDefault();
        nudge(24);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nudge]);

  return (
    <Ctx.Provider value={{ width, dragging, setWidth, nudge, reset }}>
      {children}
    </Ctx.Provider>
  );
}
