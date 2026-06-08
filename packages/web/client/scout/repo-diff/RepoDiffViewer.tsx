/**
 * Repo Diff Viewer (SCO-065) — the shared diff review surface.
 *
 * Fetches `GET /api/repo-diff/worktree?path=…&layer=unstaged&layer=staged` (a
 * `ScoutRepoDiffSnapshot`), then renders it with **Pierre Diffs + Shiki**, which
 * are loaded at runtime from a pinned esm.sh version (see ./pierre.ts) — never
 * bundled. Diff DATA is always local; only the Pierre/Shiki LIBRARY is remote.
 *
 * Two entry points share this component:
 *   1. In-app: a `SlidePanel` opened from a Repo Watch worktree row.
 *   2. Standalone embed: `/embed/repo-diff?path=…` for the macOS WKWebView.
 *
 * Both are reached via `React.lazy` so the heavy Pierre import only happens when
 * the viewer opens.
 *
 * Visual language matches `design/studio/.../branch-diff-sheet` (files rail +
 * churn, layer header, unified/split toggle) using the web client's tokens; see
 * ./repo-diff.css. Large / truncated / binary diffs degrade VISIBLY per §14.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ParsedPatch } from "@pierre/diffs";
import type { CodeViewItem } from "@pierre/diffs/react";

import "./repo-diff.css";
import { api } from "../../lib/api.ts";
import {
  loadPierre,
  mountPierreDiff,
  parseLayerPatch,
  warmupHighlighter,
  type PierreDiffHandle,
  type PierreRuntime,
} from "./pierre.ts";
import type {
  RepoDiffFile,
  RepoDiffLayer,
  RepoDiffLayerKind,
  ScoutRepoDiffSnapshot,
} from "./types.ts";

export type RepoDiffViewerProps = {
  /** Absolute worktree path to diff. The viewer fetches the snapshot itself. */
  path: string;
  /** Layers to request (default: unstaged + staged). */
  layers?: RepoDiffLayerKind[];
  /** Optional close affordance (rendered in the header when present). */
  onClose?: () => void;
  /** Extra className on the root (e.g. for the chrome-free embed). */
  className?: string;
  /** Heading shown in the header (defaults to the worktree leaf name). */
  title?: string;
};

const DEFAULT_LAYERS: RepoDiffLayerKind[] = ["unstaged", "staged"];

const LAYER_LABELS: Record<RepoDiffLayerKind, string> = {
  unstaged: "Unstaged",
  staged: "Staged",
  branch: "Branch",
};

const STATUS_GLYPH: Record<RepoDiffFile["status"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  typechange: "T",
  conflict: "!",
  unknown: "?",
};

// ── Path helpers ────────────────────────────────────────────────────────────

function fileDisplayPath(file: RepoDiffFile): string {
  return file.newPath ?? file.oldPath ?? "(unknown)";
}

function splitPath(p: string): { name: string; dir: string } {
  const parts = p.split("/");
  const name = parts[parts.length - 1] || p;
  const dir = parts.slice(0, -1).join("/");
  return { name, dir };
}

function fileKey(file: RepoDiffFile, index: number): string {
  return `${file.oldPath ?? ""}→${file.newPath ?? ""}#${index}`;
}

function leafName(path: string): string {
  const cleaned = path.replace(/\/+$/, "");
  const parts = cleaned.split("/");
  return parts[parts.length - 1] || cleaned;
}

// ── Layer / fetch state ─────────────────────────────────────────────────────

function buildUrl(path: string, layers: RepoDiffLayerKind[]): string {
  const params = new URLSearchParams();
  params.set("path", path);
  for (const layer of layers) params.append("layer", layer);
  return `/api/repo-diff/worktree?${params.toString()}`;
}

type FetchPhase = "loading" | "ready" | "error";
type PierrePhase = "loading" | "ready" | "error";
type DiffLayout = "unified" | "split";

export function RepoDiffViewer({
  path,
  layers = DEFAULT_LAYERS,
  onClose,
  className,
  title,
}: RepoDiffViewerProps) {
  // The requested layer set is stable across renders for the same call site;
  // rebuild from a string key so the fetch effect doesn't re-fire when the
  // caller passes a fresh array literal each render.
  const layersKey = layers.join(",");
  const requestedLayers = useMemo(
    () => layersKey.split(",") as RepoDiffLayerKind[],
    [layersKey],
  );

  const [snapshot, setSnapshot] = useState<ScoutRepoDiffSnapshot | null>(null);
  const [fetchPhase, setFetchPhase] = useState<FetchPhase>("loading");
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [pierre, setPierre] = useState<PierreRuntime | null>(null);
  const [pierrePhase, setPierrePhase] = useState<PierrePhase>("loading");
  const [pierreError, setPierreError] = useState<string | null>(null);

  const [activeLayer, setActiveLayer] = useState<RepoDiffLayerKind | null>(null);
  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(null);
  const [layout, setLayout] = useState<DiffLayout>("split");

  // ── Fetch the snapshot ────────────────────────────────────────────────────
  const loadSnapshot = useCallback(async () => {
    setFetchPhase("loading");
    setFetchError(null);
    try {
      const data = await api<ScoutRepoDiffSnapshot>(
        buildUrl(path, requestedLayers),
      );
      setSnapshot(data);
      setFetchPhase("ready");
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
      setFetchPhase("error");
    }
  }, [path, requestedLayers]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  // ── Load Pierre once (runtime esm.sh import) ──────────────────────────────
  const retryPierre = useCallback(() => {
    setPierrePhase("loading");
    setPierreError(null);
    loadPierre().then(
      (runtime) => {
        setPierre(runtime);
        setPierrePhase("ready");
      },
      (err) => {
        setPierreError(err instanceof Error ? err.message : String(err));
        setPierrePhase("error");
      },
    );
  }, []);

  useEffect(() => {
    let alive = true;
    loadPierre().then(
      (runtime) => {
        if (!alive) return;
        setPierre(runtime);
        setPierrePhase("ready");
      },
      (err) => {
        if (!alive) return;
        setPierreError(err instanceof Error ? err.message : String(err));
        setPierrePhase("error");
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  // Warm up the highlighter for the snapshot's preferred theme once both the
  // snapshot and Pierre are ready (best-effort; see warmupHighlighter).
  useEffect(() => {
    if (pierre && snapshot) {
      void warmupHighlighter(pierre, snapshot.render.preferredTheme);
    }
  }, [pierre, snapshot]);

  // Default the layout from the render hint ("stacked" → unified).
  useEffect(() => {
    if (snapshot) {
      setLayout(snapshot.render.preferredLayout === "stacked" ? "unified" : "split");
    }
  }, [snapshot]);

  // Seed / re-seed the active layer when the snapshot changes. Prefer a layer
  // that actually has files so the body isn't empty on open.
  useEffect(() => {
    if (!snapshot) return;
    const layersWithFiles = snapshot.layers.filter((l) => l.files.length > 0);
    const target =
      layersWithFiles[0] ?? snapshot.layers[0] ?? null;
    setActiveLayer((prev) => {
      if (prev && snapshot.layers.some((l) => l.kind === prev)) return prev;
      return target ? target.kind : null;
    });
  }, [snapshot]);

  const layer = useMemo<RepoDiffLayer | null>(() => {
    if (!snapshot || !activeLayer) return null;
    return snapshot.layers.find((l) => l.kind === activeLayer) ?? null;
  }, [snapshot, activeLayer]);

  // Reset / clamp the selected file when the layer changes.
  useEffect(() => {
    if (!layer) {
      setSelectedFileKey(null);
      return;
    }
    setSelectedFileKey((prev) => {
      const keys = layer.files.map((f, i) => fileKey(f, i));
      if (prev && keys.includes(prev)) return prev;
      return keys[0] ?? null;
    });
  }, [layer]);

  // ── Loading / error gates ─────────────────────────────────────────────────
  if (fetchPhase === "loading" && !snapshot) {
    return (
      <Viewer className={className}>
        <Center>
          <div className="rd-spinner" aria-hidden />
          <div className="rd-center-title">Reading worktree diff…</div>
          <div className="rd-center-body">{path}</div>
        </Center>
      </Viewer>
    );
  }

  if (fetchPhase === "error" && !snapshot) {
    return (
      <Viewer className={className}>
        <Center>
          <div className="rd-center-title">Couldn’t load the diff</div>
          <div className="rd-center-body">
            {fetchError ?? "The broker did not return a diff snapshot."}
          </div>
          <div className="rd-center-action">
            <button type="button" className="rd-btn" onClick={() => void loadSnapshot()}>
              Retry
            </button>
          </div>
        </Center>
      </Viewer>
    );
  }

  if (!snapshot) return <Viewer className={className} />;

  const heading = title ?? leafName(snapshot.worktreePath);

  return (
    <Viewer className={className}>
      <Header
        heading={heading}
        worktreePath={snapshot.worktreePath}
        snapshot={snapshot}
        activeLayer={activeLayer}
        onLayer={setActiveLayer}
        layout={layout}
        onLayout={setLayout}
        onClose={onClose}
      />

      <SnapshotDiagnostics snapshot={snapshot} />

      {/* Pierre renders in its own ISOLATED React root (DiffSurface →
          PierreCodeView → mountPierreDiff), so the worker pool + CodeView live
          entirely in Pierre's React instance, never the host's. The host React
          owns only the files rail and the container element. */}
      <div className="rd-body">
        <FilesRail
          layer={layer}
          selectedFileKey={selectedFileKey}
          onSelect={setSelectedFileKey}
        />
        <DiffSurface
          layer={layer}
          selectedFileKey={selectedFileKey}
          renderKey={snapshot.render.renderKey}
          theme={snapshot.render.preferredTheme}
          layout={layout}
          pierre={pierre}
          pierrePhase={pierrePhase}
          pierreError={pierreError}
          onRetryPierre={retryPierre}
        />
      </div>
    </Viewer>
  );
}

/**
 * Renders Pierre's `CodeView` into an ISOLATED React root (Pierre's own
 * React + react-dom; see `mountPierreDiff`). The host React owns only the
 * container `<div>`; Pierre's component tree (worker pool + CodeView) lives in
 * its own root so its CDN-loaded React instance never mixes with the host's
 * bundled React. The root is created once per Pierre runtime and updated
 * in-place as items / theme / layout change (spec §12: options flow through the
 * pool, no remount).
 */
function PierreCodeView({
  pierre,
  items,
  theme,
  layout,
  scrollToItemId,
}: {
  pierre: PierreRuntime;
  items: CodeViewItem[];
  theme: string;
  layout: DiffLayout;
  scrollToItemId: string | null;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<PierreDiffHandle | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const handle = mountPierreDiff(pierre, hostRef.current);
    handleRef.current = handle;
    return () => {
      handleRef.current = null;
      // Defer so Pierre's root isn't unmounted during the host React commit.
      setTimeout(() => handle.unmount(), 0);
    };
  }, [pierre]);

  useEffect(() => {
    handleRef.current?.render({ items, theme, layout });
  }, [items, theme, layout]);

  // Scroll the diff surface to the file picked in the rail. Deferred to the next
  // frame so CodeView has laid out the (re)rendered items before scrolling.
  useEffect(() => {
    if (!scrollToItemId) return;
    const raf = requestAnimationFrame(() => {
      handleRef.current?.scrollToItem(scrollToItemId);
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollToItemId]);

  return <div ref={hostRef} className="rd-codeview-host" />;
}

export default RepoDiffViewer;

// ── Shell ───────────────────────────────────────────────────────────────────

function Viewer({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={className ? `rd-viewer ${className}` : "rd-viewer"} data-scout-theme>
      {children}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div className="rd-center">
      <div className="rd-center-card">{children}</div>
    </div>
  );
}

// ── Header (identity + layer tabs + layout toggle) ──────────────────────────

function Header({
  heading,
  worktreePath,
  snapshot,
  activeLayer,
  onLayer,
  layout,
  onLayout,
  onClose,
}: {
  heading: string;
  worktreePath: string;
  snapshot: ScoutRepoDiffSnapshot;
  activeLayer: RepoDiffLayerKind | null;
  onLayer: (layer: RepoDiffLayerKind) => void;
  layout: DiffLayout;
  onLayout: (layout: DiffLayout) => void;
  onClose?: () => void;
}) {
  const { dir } = splitPath(worktreePath);
  return (
    <div className="rd-header">
      <div className="rd-header-id">
        <div className="rd-header-title">
          <span className="rd-header-name" title={worktreePath}>
            {heading}
          </span>
          {dir ? <span className="rd-header-dir">{dir}</span> : null}
        </div>
        <div className="rd-header-sub">
          <LayerTabs
            layers={snapshot.layers}
            activeLayer={activeLayer}
            onLayer={onLayer}
          />
        </div>
      </div>
      <div className="rd-header-actions">
        <div className="rd-segmented" role="group" aria-label="Diff layout">
          <button
            type="button"
            className={layout === "unified" ? "on" : ""}
            aria-pressed={layout === "unified"}
            onClick={() => onLayout("unified")}
          >
            Unified
          </button>
          <button
            type="button"
            className={layout === "split" ? "on" : ""}
            aria-pressed={layout === "split"}
            onClick={() => onLayout("split")}
          >
            Split
          </button>
        </div>
        {onClose ? (
          <button type="button" className="rd-close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        ) : null}
      </div>
    </div>
  );
}

function LayerTabs({
  layers,
  activeLayer,
  onLayer,
}: {
  layers: RepoDiffLayer[];
  activeLayer: RepoDiffLayerKind | null;
  onLayer: (layer: RepoDiffLayerKind) => void;
}) {
  return (
    <div className="rd-layers" role="tablist" aria-label="Diff layers">
      {layers.map((l) => {
        const churn = layerChurn(l);
        return (
          <button
            key={l.kind}
            type="button"
            role="tab"
            aria-selected={l.kind === activeLayer}
            className={"rd-layer-tab" + (l.kind === activeLayer ? " on" : "")}
            onClick={() => onLayer(l.kind)}
            title={l.shortstat ?? undefined}
          >
            <span>{LAYER_LABELS[l.kind] ?? l.kind}</span>
            <span className="rd-layer-stat">
              {l.files.length === 0 ? (
                "clean"
              ) : (
                <>
                  {l.files.length}f{" "}
                  <span style={{ color: "var(--rd-add)" }}>+{churn.add}</span>{" "}
                  <span style={{ color: "var(--rd-del)" }}>−{churn.del}</span>
                  {l.truncated ? " ⚠" : ""}
                </>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function layerChurn(layer: RepoDiffLayer): { add: number; del: number } {
  return layer.files.reduce(
    (acc, f) => ({
      add: acc.add + (f.additions ?? 0),
      del: acc.del + (f.deletions ?? 0),
    }),
    { add: 0, del: 0 },
  );
}

// ── Snapshot-level diagnostics (§14: never silently hide) ───────────────────

function SnapshotDiagnostics({ snapshot }: { snapshot: ScoutRepoDiffSnapshot }) {
  const banners: { level: "info" | "warning"; text: string }[] = [];

  if (snapshot.coverage.truncatedLayers > 0) {
    banners.push({
      level: "warning",
      text: `${snapshot.coverage.truncatedLayers} layer${
        snapshot.coverage.truncatedLayers === 1 ? "" : "s"
      } truncated — the native diff hit a size budget; some files or hunks are omitted.`,
    });
  }
  if (snapshot.coverage.scanBudgetReached) {
    banners.push({
      level: "warning",
      text: "Scan budget reached — this diff is partial.",
    });
  }
  for (const d of snapshot.diagnostics) {
    banners.push({
      level: d.level,
      text: d.path ? `${d.message} (${d.path})` : d.message,
    });
  }

  if (banners.length === 0) return null;

  return (
    <>
      {banners.map((b, i) => (
        <div key={i} className={`rd-banner ${b.level}`}>
          <span className="rd-banner-dot" aria-hidden />
          <span>{b.text}</span>
        </div>
      ))}
    </>
  );
}

// ── Files rail ──────────────────────────────────────────────────────────────

function FilesRail({
  layer,
  selectedFileKey,
  onSelect,
}: {
  layer: RepoDiffLayer | null;
  selectedFileKey: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="rd-rail">
      <div className="rd-rail-head">
        {layer ? `Changed files · ${layer.files.length}` : "Changed files"}
      </div>
      <div className="rd-rail-list">
        {layer?.files.map((file, index) => {
          const key = fileKey(file, index);
          const display = fileDisplayPath(file);
          const { name, dir } = splitPath(display);
          const renamed =
            (file.status === "renamed" || file.status === "copied") &&
            file.oldPath &&
            file.newPath &&
            file.oldPath !== file.newPath;
          return (
            <button
              key={key}
              type="button"
              className={"rd-file-row" + (key === selectedFileKey ? " on" : "")}
              onClick={() => onSelect(key)}
              title={renamed ? `${file.oldPath} → ${file.newPath}` : display}
            >
              <span className={`rd-file-glyph ${file.status}`}>
                {STATUS_GLYPH[file.status]}
              </span>
              <span className="rd-file-id">
                <span className="rd-file-name">{name}</span>
                <span className="rd-file-dir">
                  {renamed ? `${file.oldPath} → ${dir || name}` : dir}
                </span>
                <FileTags file={file} />
              </span>
              <span className="rd-file-churn">
                {file.binary ? (
                  <span className="add" style={{ color: "var(--muted)" }}>
                    bin
                  </span>
                ) : (
                  <>
                    <span className="add">+{file.additions ?? 0}</span>
                    <span className="del">−{file.deletions ?? 0}</span>
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FileTags({ file }: { file: RepoDiffFile }) {
  const tags: string[] = [];
  if (file.binary) tags.push("BINARY");
  if (file.truncated) tags.push("TRUNCATED");
  if (file.status === "conflict") tags.push("CONFLICT");
  if (tags.length === 0) return null;
  return (
    <span className="rd-file-tags">
      {tags.map((t) => (
        <span key={t} className="rd-file-tag">
          {t}
        </span>
      ))}
    </span>
  );
}

// ── Diff surface (Pierre CodeView, fed the layer's rawPatch) ────────────────

function DiffSurface({
  layer,
  selectedFileKey,
  renderKey,
  theme,
  layout,
  pierre,
  pierrePhase,
  pierreError,
  onRetryPierre,
}: {
  layer: RepoDiffLayer | null;
  selectedFileKey: string | null;
  renderKey: string;
  theme: string;
  layout: DiffLayout;
  pierre: PierreRuntime | null;
  pierrePhase: PierrePhase;
  pierreError: string | null;
  onRetryPierre: () => void;
}) {
  // The selected file (for the single-file / binary / no-patch cases).
  const selectedFile = useMemo(() => {
    if (!layer) return null;
    return (
      layer.files.find((f, i) => fileKey(f, i) === selectedFileKey) ?? null
    );
  }, [layer, selectedFileKey]);

  // Parse the layer's rawPatch into Pierre items once per layer/content, keyed
  // by the snapshot render key + layer (content-stable Pierre cache key). A
  // parse failure becomes a visible diagnostic and falls back to raw text.
  const parsed = useMemo<
    | { ok: true; items: CodeViewItem[]; patches: ParsedPatch[] }
    | { ok: false; error: string }
    | null
  >(() => {
    if (!pierre || !layer || !layer.rawPatch) return null;
    try {
      const cachePrefix = `${renderKey}:${layer.kind}:${layer.patchOid}`;
      const patches = parseLayerPatch(pierre, layer.rawPatch, cachePrefix);
      const items: CodeViewItem[] = [];
      patches.forEach((patch, pi) => {
        patch.files.forEach((fileDiff, fi) => {
          items.push({
            id: `${cachePrefix}:${pi}:${fi}:${fileDiff.name}`,
            type: "diff",
            fileDiff,
          });
        });
      });
      return { ok: true, items, patches };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }, [pierre, layer, renderKey]);

  // Map the rail's selected file to its CodeView item id (match by path) so
  // selecting a file scrolls the diff surface to it.
  const selectedItemId = useMemo<string | null>(() => {
    if (!parsed || !parsed.ok || !selectedFile) return null;
    const candidates = [selectedFile.newPath, selectedFile.oldPath].filter(
      (p): p is string => Boolean(p),
    );
    for (const item of parsed.items) {
      const name = (item as { fileDiff?: { name?: string } }).fileDiff?.name;
      if (name && candidates.includes(name)) return item.id;
    }
    return null;
  }, [parsed, selectedFile]);

  if (!layer) {
    return (
      <div className="rd-surface">
        <Center>
          <div className="rd-center-title">No layer selected</div>
        </Center>
      </div>
    );
  }

  if (layer.files.length === 0) {
    return (
      <div className="rd-surface">
        <Center>
          <div className="rd-center-title">Nothing to diff</div>
          <div className="rd-center-body">
            The {LAYER_LABELS[layer.kind] ?? layer.kind.toLowerCase()} layer is
            clean.
          </div>
        </Center>
      </div>
    );
  }

  // Pierre still loading.
  if (pierrePhase === "loading") {
    return (
      <div className="rd-surface">
        <Center>
          <div className="rd-spinner" aria-hidden />
          <div className="rd-center-title">Loading the diff renderer…</div>
          <div className="rd-center-body">
            Fetching Pierre Diffs + Shiki (first open only).
          </div>
        </Center>
      </div>
    );
  }

  // Pierre failed to load — fall back to the raw patch so the operator still
  // sees the change, with an explicit error (spec: surface Pierre load error).
  if (pierrePhase === "error" || !pierre) {
    return (
      <div className="rd-surface">
        <div className="rd-banner warning">
          <span className="rd-banner-dot" aria-hidden />
          <span>
            The diff renderer failed to load
            {pierreError ? `: ${pierreError}` : "."} Showing raw patch text.
          </span>
        </div>
        <div className="rd-surface-scroll">
          <RawPatchFallback layer={layer} onRetry={onRetryPierre} />
        </div>
      </div>
    );
  }

  // Layer has files but no rawPatch (e.g. all-binary, or patch excluded by the
  // native budget while summaries were kept).
  if (!layer.rawPatch || !parsed) {
    return (
      <div className="rd-surface">
        <Center>
          <div className="rd-center-title">No patch text available</div>
          <div className="rd-center-body">
            {layer.truncated
              ? "This layer was truncated by the native diff budget; file summaries are shown in the rail."
              : "The native producer returned summaries without patch text for this layer."}
          </div>
        </Center>
      </div>
    );
  }

  // Parse failed — surface as a diagnostic and fall back to raw text (spec §11).
  if (!parsed.ok) {
    return (
      <div className="rd-surface">
        <div className="rd-banner warning">
          <span className="rd-banner-dot" aria-hidden />
          <span>Couldn’t parse the patch ({parsed.error}). Showing raw text.</span>
        </div>
        <div className="rd-surface-scroll">
          <RawPatchFallback layer={layer} />
        </div>
      </div>
    );
  }

  const truncatedFiles = layer.files.filter((f) => f.truncated).length;

  return (
    <div className="rd-surface">
      {layer.truncated || truncatedFiles > 0 ? (
        <div className="rd-banner warning">
          <span className="rd-banner-dot" aria-hidden />
          <span>
            {layer.truncated
              ? "This layer was truncated; some files or hunks are omitted."
              : `${truncatedFiles} file${truncatedFiles === 1 ? "" : "s"} truncated.`}
          </span>
        </div>
      ) : null}
      <div className="rd-surface-scroll">
        <PierreCodeView
          pierre={pierre}
          items={parsed.items}
          theme={theme}
          layout={layout}
          scrollToItemId={selectedItemId}
        />
      </div>
    </div>
  );
}

// ── Raw-patch fallback (Pierre missing / parse failed) ──────────────────────

function RawPatchFallback({
  layer,
  onRetry,
}: {
  layer: RepoDiffLayer;
  onRetry?: () => void;
}) {
  return (
    <div style={{ padding: "var(--space-lg)" }}>
      {onRetry ? (
        <div className="rd-center-action" style={{ marginTop: 0, marginBottom: "var(--space-md)" }}>
          <button type="button" className="rd-btn" onClick={onRetry}>
            Retry renderer
          </button>
        </div>
      ) : null}
      <pre
        style={{
          margin: 0,
          whiteSpace: "pre",
          fontFamily: "var(--rd-mono)",
          fontSize: "var(--text-xs)",
          lineHeight: 1.5,
          color: "var(--ink)",
        }}
      >
        {layer.rawPatch ?? "(no patch text)"}
      </pre>
    </div>
  );
}
