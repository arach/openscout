"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { ComponentType } from "react";

const ArcDiagram: ComponentType<Record<string, unknown>> = dynamic(
  () => import("@arach/arc").then((m) => ({ default: m.ArcDiagram })) as any,
  { ssr: false },
);

const DIAGRAM_CODES: Record<string, string> = {
  "communication-flow": "SCOUT-001-COMM",
  "agent-lifecycle": "SCOUT-002-LIFE",
  "mesh-topology": "SCOUT-003-MESH",
};

function formatDiagramLabel(src: string) {
  return DIAGRAM_CODES[src] ?? `SCOUT-${src.toUpperCase().replace(/-/g, "")}`;
}

export function ArcDiagramEmbed({
  src,
  className,
  interactive = true,
  aspectRatio,
  initialZoom = 0.25,
  zoomStep = 0.1,
}: {
  src: string;
  className?: string;
  interactive?: boolean;
  aspectRatio?: string;
  initialZoom?: number;
  zoomStep?: number;
}) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const check = () =>
      setIsDark(document.documentElement.getAttribute("data-site-theme") === "dark");
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-site-theme"] });
    return () => observer.disconnect();
  }, []);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    fetch(`/diagrams/${src}.arc.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [src]);

  // Center the diagram once we know container size + layout dims.
  useEffect(() => {
    if (!data || !wrapperRef.current) return;
    const layout = data.layout as { width: number; height: number } | undefined;
    if (!layout) return;
    const compute = () => {
      const el = wrapperRef.current;
      if (!el) return;
      // arc measures its own root's clientWidth (the post-padding content box).
      // wrapper.clientWidth includes padding, so subtract it for the centering math.
      const style = window.getComputedStyle(el);
      const padX =
        parseFloat(style.paddingLeft || "0") +
        parseFloat(style.paddingRight || "0");
      const padY =
        parseFloat(style.paddingTop || "0") +
        parseFloat(style.paddingBottom || "0");
      const cw = el.clientWidth - padX;
      const ch = el.clientHeight - padY;
      setPan({
        x: (cw - layout.width * initialZoom) / 2,
        y: (ch - layout.height * initialZoom) / 2,
      });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, [data, initialZoom]);

  if (error) return null;

  const layout = (data?.layout as { width: number; height: number } | undefined);
  const resolvedAspectRatio =
    aspectRatio ?? (layout ? `${layout.width}/${layout.height}` : "10/7");
  const ready = data && pan !== null;

  return (
    <div
      ref={wrapperRef}
      className={
        className ??
        "arc-docs-embed relative overflow-hidden rounded-lg border border-[var(--site-border-soft)] bg-[var(--site-surface-strong)] px-4 pt-4 pb-2"
      }
      style={{ aspectRatio: resolvedAspectRatio }}
    >
      {ready ? (
        <ArcDiagram
          data={data}
          className="w-full h-full !rounded-none !border-0 !shadow-none !bg-transparent"
          mode={isDark ? "dark" : "light"}
          theme={isDark ? "warm" : "cool"}
          interactive={interactive}
          showArcToggle={false}
          label={formatDiagramLabel(src)}
          defaultZoom={initialZoom}
          zoomStep={zoomStep}
          initialPan={pan}
        />
      ) : (
        <div className="h-full w-full animate-pulse" style={{ background: "rgba(0,0,0,0.02)" }} />
      )}
    </div>
  );
}
