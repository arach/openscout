"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
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
  /** Bind to the drag handle: onPointerDown={beginResize} */
  beginResize: (e: ReactPointerEvent<Element>) => void;
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

  // Drag session lives outside React so re-renders never drop listeners.
  const dragRef = useRef<{
    startX: number;
    startW: number;
    pointerId: number;
  } | null>(null);

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

  const endDrag = useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    writeStored(widthRef.current);
  }, []);

  const beginResize = useCallback((e: ReactPointerEvent<Element>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    dragRef.current = {
      startX: e.clientX,
      startW: widthRef.current,
      pointerId: e.pointerId,
    };
    setDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    // Capture on the handle so moves keep arriving after the pointer
    // leaves the strip and travels over the main canvas.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* some targets refuse capture */
    }
  }, []);

  // Window-level move/up so drag keeps working if capture fails or the
  // handle unmounts mid-gesture.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const session = dragRef.current;
      if (!session) return;
      // Ignore secondary pointers (multi-touch); accept primary mouse/pen.
      if (session.pointerId !== e.pointerId && e.isPrimary === false) return;
      const next = clamp(session.startW + (e.clientX - session.startX));
      if (next === widthRef.current) return;
      widthRef.current = next;
      setWidthState(next);
    };

    const onUp = (e: PointerEvent) => {
      const session = dragRef.current;
      if (!session) return;
      if (session.pointerId !== e.pointerId && e.isPrimary === false) return;
      endDrag();
    };

    const onBlur = () => endDrag();

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("blur", onBlur);
      endDrag();
    };
  }, [endDrag]);

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
    <Ctx.Provider
      value={{ width, dragging, setWidth, nudge, reset, beginResize }}
    >
      {children}
    </Ctx.Provider>
  );
}
