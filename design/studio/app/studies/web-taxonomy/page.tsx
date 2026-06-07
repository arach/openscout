"use client";

/**
 * Web Taxonomy — interactive map.
 *
 * Renders the machine-readable registry in `lib/web-taxonomy.ts` as a live
 * mock of the app's own chrome: a main-nav → sub-nav header you click
 * through, a global search, and a PIN BOARD so you can park several
 * surfaces side by side (e.g. the Channel viewer next to the Agent viewer).
 *
 * The nav geometry mirrors the real configs:
 *   - packages/web/client/scout/topNavConfig.ts        (main nav)
 *   - packages/web/client/scout/secondaryNavConfig.ts  (sub nav)
 * Home has no secondary-nav config (it's section-driven), so its lenses are
 * derived from the views its screens actually render. Cross-cutting chrome
 * is bucketed by file location.
 *
 * Source of truth is the registry; regenerate via the `web-taxonomy`
 * workflow rather than hand-editing. The agent-lens deep-dive (the
 * Profile/Observe/Message overlap analysis) hangs off the bottom.
 */
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  WEB_TAXONOMY,
  AGENT_LENS_DEEP_DIVE,
  WEB_TAXONOMY_SUMMARY,
  WEB_TAXONOMY_GENERATED_AT,
  WEB_TAXONOMY_SCREEN_COUNT,
  type WebArea,
  type WebScreen,
  type DuplicationCluster,
} from "@/lib/web-taxonomy";

// CodeMirror viewer is browser-only — load it client-side when a file opens.
const CodeViewer = dynamic(
  () => import("@/components/CodeViewer").then((m) => m.CodeViewer),
  {
    ssr: false,
    loading: () => (
      <div className="p-4 font-mono text-[11px] text-studio-ink-faint">loading viewer…</div>
    ),
  },
);

// ─── Nav model (mirrors topNavConfig + secondaryNavConfig) ───────────────

type NavLens = {
  id: string;
  label: string;
  /** Route views this lens owns (matched against a screen's `route`). */
  views?: string[];
  /** If set, the screen's route `mode` must be one of these (undefined ok). */
  modeIn?: (string | undefined)[];
  /** If set, the screen's route `section` must equal this. */
  section?: string;
  /** Derived lens: match by screen name substring (case-insensitive). Used for
   *  surfaces rendered as `component`/`slot:*` with no route of their own. */
  nameIncludes?: string[];
  /** Chrome surfaces have no route — match by file path substring instead. */
  pathIncludes?: string[];
};

// Mirrors the real nav (topNavConfig + secondaryNavConfig). A handful of derived
// lenses (Observe, Inspectors, Mesh/Work clusters) group route-less sub-surfaces
// the way an operator thinks about them; everything left over lands in "More".
const WEB_NAV: Record<WebArea, NavLens[]> = {
  home: [
    { id: "inbox", label: "Fleet / Inbox", views: ["inbox", "fleet"] },
    { id: "activity", label: "Activity", views: ["activity"] },
    { id: "briefings", label: "Briefings", views: ["briefings"] },
    { id: "follow", label: "Follow", views: ["follow"] },
  ],
  agents: [
    { id: "directory", label: "Directory", views: ["agents", "agent-info"] },
    { id: "sessions", label: "Sessions", views: ["sessions", "terminal"] },
    { id: "observe", label: "Observe", nameIncludes: ["Observe"] },
    { id: "config", label: "Config", views: ["settings"], section: "agents" },
    { id: "rails", label: "Inspectors", nameIncludes: ["Inspector", "Peek"] },
  ],
  chat: [
    { id: "messages", label: "Messages", views: ["messages", "conversations", "conversation"] },
    { id: "channels", label: "Channels", views: ["channels"] },
    { id: "rails", label: "Inspectors", nameIncludes: ["Inspector", "left panel"] },
  ],
  search: [
    { id: "knowledge", label: "Knowledge", views: ["search"], modeIn: ["knowledge", undefined] },
    { id: "indexer", label: "Indexer", views: ["search"], modeIn: ["indexer"] },
  ],
  ops: [
    { id: "control", label: "Control", views: ["ops"], modeIn: ["mission", "issues", "agents", undefined] },
    { id: "dispatch", label: "Dispatch", views: ["broker"] },
    { id: "mesh", label: "Mesh", views: ["mesh"], nameIncludes: ["Mesh"] },
    { id: "tail", label: "Tail", views: ["ops"], modeIn: ["tail"] },
    { id: "runtime", label: "Runtime", views: ["ops"], modeIn: ["atop"] },
    { id: "plans", label: "Plans", views: ["ops"], modeIn: ["plan"] },
    { id: "work", label: "Work", views: ["work"], nameIncludes: ["Work"] },
    { id: "rails", label: "Rails", nameIncludes: ["Left Panel", "Inspector"] },
  ],
  chrome: [
    { id: "shell", label: "App shell", pathIncludes: ["OpenScoutAppShell"] },
    { id: "assistant", label: "Assistant", pathIncludes: ["scoutbot"] },
    { id: "inspectors", label: "Inspectors", pathIncludes: ["scout/inspector"] },
    { id: "rails", label: "Rails / slots", pathIncludes: ["scout/slots"] },
    { id: "settings", label: "Settings", pathIncludes: ["Settings"] },
    { id: "takeover", label: "Takeover", pathIncludes: ["takeover"] },
    { id: "preview", label: "File preview", pathIncludes: ["FilePreview", "file-renderers"] },
  ],
};

const MORE_LENS: NavLens = { id: "more", label: "More" };

function routeParts(route: string) {
  return {
    view: (route.match(/view:"([a-z-]+)"/) || [])[1],
    mode: (route.match(/mode:"([a-z-]+)"/) || [])[1] as string | undefined,
    section: (route.match(/section:"([a-z-]+)"/) || [])[1],
  };
}

function lensMatch(l: NavLens, screen: WebScreen): boolean {
  if (l.pathIncludes) {
    return screen.files.some((f) => l.pathIncludes!.some((p) => f.includes(p)));
  }
  const { view, mode, section } = routeParts(screen.route);
  let routeOk = false;
  if (l.views && view && l.views.includes(view)) {
    routeOk = (!l.modeIn || l.modeIn.includes(mode)) && (!l.section || section === l.section);
  }
  let nameOk = false;
  if (l.nameIncludes) {
    const n = screen.name.toLowerCase();
    nameOk = l.nameIncludes.some((x) => n.includes(x.toLowerCase()));
  }
  if (l.views && l.nameIncludes) return routeOk || nameOk;
  if (l.views) return routeOk;
  if (l.nameIncludes) return nameOk;
  return false;
}

function lensFor(areaId: WebArea, screen: WebScreen): NavLens {
  for (const l of WEB_NAV[areaId]) {
    if (lensMatch(l, screen)) return l;
  }
  return MORE_LENS;
}

// ─── Flattened surface index (built once from the registry) ──────────────

type Surface = {
  key: string;
  areaId: WebArea;
  areaLabel: string;
  topNavKey: string | null;
  lens: NavLens;
  screen: WebScreen;
};

const AREA_LABEL: Record<WebArea, string> = Object.fromEntries(
  WEB_TAXONOMY.map((a) => [a.id, a.label]),
) as Record<WebArea, string>;

const ALL_SURFACES: Surface[] = WEB_TAXONOMY.flatMap((area) =>
  area.screens.map((screen) => ({
    key: `${area.id}::${screen.name}`,
    areaId: area.id,
    areaLabel: area.label,
    topNavKey: area.topNavKey,
    lens: lensFor(area.id, screen),
    screen,
  })),
);

const SURFACE_BY_KEY = new Map(ALL_SURFACES.map((s) => [s.key, s]));
const NAME_TO_KEY = new Map(ALL_SURFACES.map((s) => [s.screen.name, s.key]));

/** "Session Observe (SessionObserve)" → "Session Observe" for compact chips. */
const shortName = (n: string) => n.replace(/\s*\(.*\)\s*$/, "");

/** Lenses (with counts) that actually hold screens in an area, in nav order. */
function lensesForArea(areaId: WebArea): Array<NavLens & { count: number }> {
  const counts = new Map<string, number>();
  for (const s of ALL_SURFACES) {
    if (s.areaId === areaId) counts.set(s.lens.id, (counts.get(s.lens.id) ?? 0) + 1);
  }
  const ordered = [...WEB_NAV[areaId], MORE_LENS]
    .filter((l) => counts.has(l.id))
    .map((l) => ({ ...l, count: counts.get(l.id) ?? 0 }));
  return ordered;
}

// ─── Presentational atoms ────────────────────────────────────────────────

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
      {children}
    </div>
  );
}

/** Pinned mark — a small filled accent circle (matches the studio's
 *  geometric dot language, cf. StatusDot; no emoji). */
function PinMark({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full align-middle ${className}`}
      style={{ background: "var(--scout-accent)" }}
    />
  );
}

function FieldList({ label, items }: { label: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <Eyebrow>
        {label} <span className="text-studio-ink-faint/70">· {items.length}</span>
      </Eyebrow>
      <ul className="mt-1.5 flex flex-col gap-1">
        {items.map((it, i) => (
          <li key={i} className="font-sans text-[12px] leading-relaxed text-studio-ink-muted">
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RouteBadge({ route }: { route: string }) {
  const isSlot = route.startsWith("slot:");
  const isComponent = route === "component";
  const tone = isComponent
    ? "border-studio-edge text-studio-ink-faint"
    : isSlot
      ? "border-status-info-fg/40 text-status-info-fg"
      : "border-scout-accent/40 text-scout-accent";
  return (
    <code className={`shrink-0 rounded border ${tone} bg-studio-canvas px-1.5 py-0.5 font-mono text-[9.5px] leading-none`}>
      {route}
    </code>
  );
}

function Placement({ areaLabel, lens }: { areaLabel: string; lens: NavLens }) {
  return (
    <span className="font-mono text-[9px] uppercase tracking-ch text-studio-ink-faint">
      {areaLabel} <span className="text-studio-ink-faint/50">›</span> {lens.label}
    </span>
  );
}

// ─── Pinned detail card (the comparison unit) ────────────────────────────

function PinnedCard({
  surface,
  onUnpin,
  onOpenSource,
}: {
  surface: Surface;
  onUnpin: () => void;
  onOpenSource: (file: string) => void;
}) {
  const s = surface.screen;
  return (
    <div className="flex flex-col rounded-md border border-scout-accent/40 bg-studio-surface">
      <div className="flex items-start justify-between gap-2 border-b border-studio-edge px-3 py-2">
        <div className="min-w-0">
          <Placement areaLabel={surface.areaLabel} lens={surface.lens} />
          <h3 className="mt-0.5 truncate font-display text-[14.5px] font-medium leading-tight text-studio-ink">
            {s.name}
          </h3>
        </div>
        <button
          onClick={onUnpin}
          title="Unpin"
          className="shrink-0 rounded border border-studio-edge px-1.5 py-0.5 font-mono text-[11px] leading-none text-studio-ink-faint transition-colors hover:border-status-error-fg/50 hover:text-status-error-fg"
        >
          ✕
        </button>
      </div>
      <div className="flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <RouteBadge route={s.route} />
          {s.files.map((f) => (
            <button
              key={f}
              onClick={() => onOpenSource(f)}
              title={`View source · ${f}`}
              className="rounded border border-studio-edge bg-studio-canvas px-1.5 py-0.5 font-mono text-[9px] text-studio-ink-faint transition-colors hover:border-scout-accent/50 hover:text-scout-accent"
            >
              {"</> "}
              {f.replace("packages/web/client/", "")}
            </button>
          ))}
        </div>
        <p className="font-sans text-[12.5px] leading-relaxed text-studio-ink-muted">{s.purpose}</p>
        <FieldList label="Actions" items={s.actions} />
        <FieldList label="Data sources" items={s.dataSources} />
        <FieldList label="Sub-views" items={s.subViews} />
        <FieldList label="Shared components" items={s.sharedComponents} />
        <FieldList label="Overlaps" items={s.overlaps} />
      </div>
    </div>
  );
}

// ─── Duplication cluster (overview → pin board bridge) ───────────────────

function ClusterCard({
  cluster,
  pinned,
  onPinOne,
  onPinAll,
}: {
  cluster: DuplicationCluster;
  pinned: Set<string>;
  onPinOne: (name: string) => void;
  onPinAll: (names: string[]) => void;
}) {
  const keys = cluster.surfaces.map((n) => NAME_TO_KEY.get(n)).filter(Boolean) as string[];
  const allPinned = keys.length > 0 && keys.every((k) => pinned.has(k));
  return (
    <div className="rounded-md border border-studio-edge bg-studio-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-display text-[13px] font-medium leading-tight text-studio-ink">
          {cluster.label}
          <span className="ml-1.5 font-mono text-[10px] tabular-nums text-studio-ink-faint">
            {cluster.surfaces.length}
          </span>
        </h4>
        <button
          onClick={() => onPinAll(cluster.surfaces)}
          className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-ch transition-colors ${
            allPinned
              ? "border-scout-accent/50 bg-scout-accent-soft text-scout-accent"
              : "border-studio-edge text-studio-ink-faint hover:border-scout-accent/50 hover:text-scout-accent"
          }`}
        >
          {allPinned ? "pinned" : "pin all"}
        </button>
      </div>
      <p className="mt-1.5 font-sans text-[11.5px] leading-relaxed text-studio-ink-muted">
        {cluster.opportunity}
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        {cluster.surfaces.map((n) => {
          const k = NAME_TO_KEY.get(n);
          const isPinned = k ? pinned.has(k) : false;
          return (
            <button
              key={n}
              onClick={() => onPinOne(n)}
              title={k ? "Pin to board" : "Not found in registry"}
              className={`rounded border px-1.5 py-0.5 font-mono text-[9px] transition-colors ${
                isPinned
                  ? "border-scout-accent/50 bg-scout-accent-soft/50 text-scout-accent"
                  : "border-studio-edge bg-studio-canvas text-studio-ink-faint hover:border-studio-edge-strong hover:text-studio-ink"
              }`}
            >
              {isPinned ? <PinMark className="mr-1" /> : null}
              {shortName(n)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Source viewer (click any file → see the code, in page) ──────────────

type SourceState = {
  loading: boolean;
  content?: string;
  filename?: string;
  totalLines?: number;
  error?: string;
};

function SourceDrawer({ path, onClose }: { path: string; onClose: () => void }) {
  const [state, setState] = useState<SourceState>({ loading: true });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    fetch(`/api/repo-file?path=${encodeURIComponent(path)}&full=1`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => {
        if (!alive) return;
        setState({
          loading: false,
          content: j.excerpt ?? j.content ?? "",
          filename: j.filename ?? path.split("/").pop(),
          totalLines: j.totalLines,
        });
      })
      .catch((e) => alive && setState({ loading: false, error: String(e?.message ?? e) }));
    return () => {
      alive = false;
    };
  }, [path]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copyPath = () => {
    navigator.clipboard?.writeText(path).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-[860px] flex-col border-l border-studio-edge bg-studio-canvas shadow-2xl">
        <div className="flex items-center gap-3 border-b border-studio-edge px-4 py-2.5">
          <div className="min-w-0">
            <div className="truncate font-mono text-[12px] text-studio-ink">{path}</div>
            {state.totalLines != null && (
              <div className="font-mono text-[9px] uppercase tracking-ch text-studio-ink-faint">
                {state.totalLines} lines
              </div>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={copyPath}
              className="rounded border border-studio-edge px-2 py-1 font-mono text-[9px] uppercase tracking-ch text-studio-ink-faint hover:border-studio-edge-strong hover:text-studio-ink"
            >
              {copied ? "copied" : "copy path"}
            </button>
            <button
              onClick={onClose}
              className="rounded border border-studio-edge px-2 py-1 font-mono text-[12px] leading-none text-studio-ink-faint hover:border-status-error-fg/50 hover:text-status-error-fg"
              title="Close (Esc)"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {state.loading && (
            <div className="p-4 font-mono text-[11px] text-studio-ink-faint">loading source…</div>
          )}
          {state.error && (
            <div className="p-4 font-mono text-[11px] text-status-error-fg">
              couldn’t load: {state.error}
            </div>
          )}
          {!state.loading && !state.error && state.content != null && (
            <CodeViewer content={state.content} filename={state.filename ?? path} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────

const PIN_STORAGE_KEY = "studio.web-taxonomy.pins";

export default function WebTaxonomyPage() {
  const [activeArea, setActiveArea] = useState<WebArea>("agents");
  const [activeLens, setActiveLens] = useState<string | null>(null); // null = all in area
  const [query, setQuery] = useState("");
  const [pins, setPins] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [sourceFile, setSourceFile] = useState<string | null>(null);

  // Hydrate pins from localStorage after mount (avoids SSR mismatch).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PIN_STORAGE_KEY);
      if (raw) setPins(JSON.parse(raw).filter((k: string) => SURFACE_BY_KEY.has(k)));
    } catch {
      /* ignore */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(pins));
  }, [pins, hydrated]);

  const pinned = useMemo(() => new Set(pins), [pins]);
  const togglePin = (key: string) =>
    setPins((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  const pinName = (name: string) => {
    const k = NAME_TO_KEY.get(name);
    if (k) togglePin(k);
  };
  const pinAll = (names: string[]) =>
    setPins((prev) => {
      const set = new Set(prev);
      const keys = names.map((n) => NAME_TO_KEY.get(n)).filter(Boolean) as string[];
      const everyPinned = keys.length > 0 && keys.every((k) => set.has(k));
      // Toggle: if the whole cluster is already pinned, clear it; else add all.
      keys.forEach((k) => (everyPinned ? set.delete(k) : set.add(k)));
      return [...set];
    });

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  const lensTabs = useMemo(() => lensesForArea(activeArea), [activeArea]);

  // Left-list contents: global search results, or the active area/lens slice.
  const listed = useMemo(() => {
    if (searching) {
      return ALL_SURFACES.filter((s) => {
        const hay = (
          s.screen.name +
          " " +
          s.screen.purpose +
          " " +
          s.screen.files.join(" ") +
          " " +
          s.areaLabel +
          " " +
          s.lens.label
        ).toLowerCase();
        return hay.includes(q);
      });
    }
    return ALL_SURFACES.filter(
      (s) => s.areaId === activeArea && (activeLens === null || s.lens.id === activeLens),
    );
  }, [searching, q, activeArea, activeLens]);

  const pinnedSurfaces = pins.map((k) => SURFACE_BY_KEY.get(k)).filter(Boolean) as Surface[];

  return (
    <div className="mx-auto flex max-w-page flex-col px-7 py-6">
      {/* Title strip */}
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Eyebrow>Web · Interactive map</Eyebrow>
          <h1 className="mt-1 font-display text-[26px] font-medium leading-none tracking-tight text-studio-ink">
            Web Taxonomy
          </h1>
        </div>
        <p className="font-sans text-[11px] leading-relaxed text-studio-ink-faint">
          {WEB_TAXONOMY_SCREEN_COUNT} surfaces · {WEB_TAXONOMY.length} areas ·{" "}
          <code className="font-mono">lib/web-taxonomy.ts</code> · gen {WEB_TAXONOMY_GENERATED_AT}
        </p>
      </header>

      {/* ── Overview: top-level synthesis ── */}
      <details
        open
        className="group mb-4 rounded-lg border border-studio-edge bg-studio-surface/40"
      >
        <summary className="flex cursor-pointer list-none items-baseline gap-2 px-4 py-2.5">
          <span className="font-display text-[15px] font-medium tracking-tight text-studio-ink">
            Overview
          </span>
          <span className="font-mono text-[10px] uppercase tracking-ch text-studio-ink-faint">
            {WEB_TAXONOMY_SUMMARY.themes.length} themes ·{" "}
            {WEB_TAXONOMY_SUMMARY.duplicationClusters.length} duplication clusters
          </span>
          <span className="ml-auto font-mono text-[11px] text-studio-ink-faint group-open:hidden">
            ▸ show
          </span>
          <span className="ml-auto hidden font-mono text-[11px] text-studio-ink-faint group-open:inline">
            ▾ hide
          </span>
        </summary>
        <div className="border-t border-studio-edge px-4 py-4">
          <p className="mb-5 max-w-prose rounded-md border-l-2 border-scout-accent/50 bg-scout-accent-soft/30 px-3 py-2 font-sans text-[13px] leading-relaxed text-studio-ink">
            {WEB_TAXONOMY_SUMMARY.headline}
          </p>
          <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
            {/* themes */}
            <div>
              <Eyebrow>Cross-cutting themes · {WEB_TAXONOMY_SUMMARY.themes.length}</Eyebrow>
              <ul className="mt-2 flex flex-col gap-2.5">
                {WEB_TAXONOMY_SUMMARY.themes.map((t) => (
                  <li key={t.title} className="border-l border-studio-edge pl-3">
                    <div className="flex items-baseline gap-2">
                      <span className="font-sans text-[12.5px] font-semibold text-studio-ink">
                        {t.title}
                      </span>
                      <button
                        onClick={() => pinAll(t.surfaces)}
                        className="shrink-0 font-mono text-[9px] uppercase tracking-ch text-studio-ink-faint hover:text-scout-accent"
                        title="Pin all surfaces in this theme"
                      >
                        {t.surfaces.length} surfaces ↗
                      </button>
                    </div>
                    <p className="mt-0.5 font-sans text-[11.5px] leading-relaxed text-studio-ink-muted">
                      {t.detail}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
            {/* duplication clusters */}
            <div>
              <Eyebrow>
                Duplication clusters · pin a row to line them up on the board
              </Eyebrow>
              <div className="mt-2 flex flex-col gap-2">
                {WEB_TAXONOMY_SUMMARY.duplicationClusters.map((c) => (
                  <ClusterCard
                    key={c.label}
                    cluster={c}
                    pinned={pinned}
                    onPinOne={pinName}
                    onPinAll={pinAll}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </details>

      {/* ── Live header: main nav → sub nav ── */}
      <div className="sticky top-0 z-20 -mx-2 rounded-lg border border-studio-edge bg-studio-canvas/95 px-2 py-2 backdrop-blur">
        {/* main nav */}
        <div className="flex flex-wrap items-center gap-1">
          {WEB_TAXONOMY.map((a) => {
            const active = !searching && a.id === activeArea;
            return (
              <button
                key={a.id}
                onClick={() => {
                  setActiveArea(a.id);
                  setActiveLens(null);
                  setQuery("");
                }}
                className={`rounded-md px-3 py-1.5 font-display text-[13px] font-medium tracking-tight transition-colors ${
                  active
                    ? "bg-scout-accent-soft text-scout-accent"
                    : "text-studio-ink-muted hover:bg-studio-surface hover:text-studio-ink"
                }`}
              >
                {a.label}
                <span className="ml-1.5 font-mono text-[10px] tabular-nums text-studio-ink-faint">
                  {a.screens.length}
                </span>
                {a.topNavKey === null && (
                  <span className="ml-1 font-mono text-[8px] uppercase tracking-ch text-studio-ink-faint/70">
                    ·chrome
                  </span>
                )}
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search all surfaces…"
              className="w-52 rounded-md border border-studio-edge bg-studio-surface px-2.5 py-1.5 font-sans text-[12px] text-studio-ink outline-none placeholder:text-studio-ink-faint focus:border-scout-accent/50"
            />
            <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-ch text-studio-ink-faint">
              <PinMark />
              {pins.length}
            </span>
            {pins.length > 0 && (
              <button
                onClick={() => setPins([])}
                className="rounded border border-studio-edge px-2 py-1 font-mono text-[9px] uppercase tracking-ch text-studio-ink-faint hover:border-studio-edge-strong hover:text-studio-ink"
              >
                clear
              </button>
            )}
          </div>
        </div>

        {/* sub nav */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1 border-t border-studio-edge/60 pt-1.5">
          {searching ? (
            <span className="px-2 font-mono text-[10px] uppercase tracking-ch text-studio-ink-faint">
              Searching all areas · {listed.length} match{listed.length === 1 ? "" : "es"}
            </span>
          ) : (
            <>
              <button
                onClick={() => setActiveLens(null)}
                className={`rounded px-2.5 py-1 font-mono text-[10px] uppercase tracking-ch transition-colors ${
                  activeLens === null
                    ? "bg-studio-surface text-studio-ink"
                    : "text-studio-ink-faint hover:text-studio-ink"
                }`}
              >
                All
              </button>
              {lensTabs.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setActiveLens(l.id)}
                  className={`rounded px-2.5 py-1 font-mono text-[10px] uppercase tracking-ch transition-colors ${
                    activeLens === l.id
                      ? "bg-studio-surface text-studio-ink"
                      : "text-studio-ink-faint hover:text-studio-ink"
                  }`}
                >
                  {l.label}
                  <span className="ml-1 tabular-nums text-studio-ink-faint/70">{l.count}</span>
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {/* ── Body: surface list | pin board ── */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* list */}
        <div className="flex flex-col gap-1.5">
          {listed.map((s) => {
            const isPinned = pinned.has(s.key);
            const file0 = s.screen.files[0];
            return (
              <div
                key={s.key}
                className={`relative rounded-md border transition-colors ${
                  isPinned
                    ? "border-scout-accent/50 bg-scout-accent-soft/40"
                    : "border-studio-edge bg-studio-surface hover:border-studio-edge-strong"
                }`}
              >
                <button
                  onClick={() => togglePin(s.key)}
                  title={isPinned ? "Unpin from board" : "Pin to board"}
                  className="flex w-full flex-col gap-1 px-2.5 py-2 pr-9 text-left"
                >
                  <span className="truncate font-sans text-[12.5px] font-medium text-studio-ink">
                    {isPinned ? <PinMark className="mr-1.5" /> : null}
                    {s.screen.name}
                  </span>
                  {searching && <Placement areaLabel={s.areaLabel} lens={s.lens} />}
                  <span className="line-clamp-2 font-sans text-[11px] leading-snug text-studio-ink-faint">
                    {s.screen.purpose}
                  </span>
                </button>
                {file0 && (
                  <button
                    onClick={() => setSourceFile(file0)}
                    title={`View source · ${file0}`}
                    className="absolute right-1.5 top-1.5 rounded border border-studio-edge bg-studio-canvas px-1 py-0.5 font-mono text-[9px] leading-none text-studio-ink-faint transition-colors hover:border-scout-accent/50 hover:text-scout-accent"
                  >
                    {"</>"}
                  </button>
                )}
              </div>
            );
          })}
          {listed.length === 0 && (
            <p className="rounded-md border border-dashed border-studio-edge px-3 py-6 text-center font-sans text-[12px] text-studio-ink-faint">
              No surfaces match.
            </p>
          )}
        </div>

        {/* pin board */}
        <div>
          {pinnedSurfaces.length === 0 ? (
            <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-studio-edge bg-studio-surface/40 px-6 text-center">
              <p className="font-display text-[15px] text-studio-ink">Pin surfaces to compare</p>
              <p className="max-w-sm font-sans text-[12px] leading-relaxed text-studio-ink-faint">
                Click any surface in the list to pin it here. Search “channel” and “agent”, pin
                both, and the Channel viewer and Agent viewer sit side by side.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {pinnedSurfaces.map((s) => (
                <PinnedCard
                  key={s.key}
                  surface={s}
                  onUnpin={() => togglePin(s.key)}
                  onOpenSource={setSourceFile}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Agent-lens deep-dive (collapsible) ── */}
      <details className="group mt-12 rounded-lg border border-scout-accent/30 bg-studio-surface/50">
        <summary className="flex cursor-pointer list-none items-baseline gap-2 px-4 py-3">
          <span className="font-display text-[16px] font-medium tracking-tight text-studio-ink">
            ★ Agent lenses — the overlap deep-dive
          </span>
          <span className="font-mono text-[10px] uppercase tracking-ch text-studio-ink-faint">
            {AGENT_LENS_DEEP_DIVE.lenses.length} lenses ·{" "}
            {AGENT_LENS_DEEP_DIVE.consolidationOpportunities.length} consolidations
          </span>
          <span className="ml-auto font-mono text-[11px] text-studio-ink-faint group-open:hidden">
            ▸ open
          </span>
          <span className="ml-auto hidden font-mono text-[11px] text-studio-ink-faint group-open:inline">
            ▾ close
          </span>
        </summary>
        <div className="border-t border-studio-edge px-4 py-4">
          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            {AGENT_LENS_DEEP_DIVE.lenses.map((l) => (
              <div key={l.name} className="rounded-md border border-studio-edge bg-studio-surface p-3">
                <h3 className="font-display text-[13.5px] font-medium leading-tight text-studio-ink">
                  {l.name}
                </h3>
                <p className="mt-0.5 font-mono text-[9px] text-studio-ink-faint">{l.surface}</p>
                <div className="mt-3 flex flex-col gap-3">
                  <FieldList label="Shows" items={l.shows} />
                  <FieldList label="Unique to this lens" items={l.uniqueTo} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="rounded-md border border-studio-edge bg-studio-surface p-4">
              <FieldList label="Shared across lenses" items={AGENT_LENS_DEEP_DIVE.sharedComponents} />
            </div>
            <div className="rounded-md border border-studio-edge bg-studio-surface p-4">
              <FieldList label="Where they diverge" items={AGENT_LENS_DEEP_DIVE.divergences} />
            </div>
          </div>
          <div className="mt-5">
            <Eyebrow>
              Consolidation opportunities · {AGENT_LENS_DEEP_DIVE.consolidationOpportunities.length}
            </Eyebrow>
            <div className="mt-2 flex flex-col gap-3">
              {AGENT_LENS_DEEP_DIVE.consolidationOpportunities.map((c, i) => (
                <div
                  key={i}
                  className={`rounded-md border bg-studio-surface p-4 ${
                    i === 0 ? "border-scout-accent/50" : "border-studio-edge"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {i === 0 && (
                      <code className="mt-0.5 shrink-0 rounded bg-scout-accent-soft px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-ch text-scout-accent">
                        ★ top pick
                      </code>
                    )}
                    <h3 className="font-display text-[14px] font-medium leading-snug text-studio-ink">
                      {c.idea}
                    </h3>
                  </div>
                  <p className="mt-2 font-sans text-[12.5px] leading-relaxed text-studio-ink-muted">
                    {c.rationale}
                  </p>
                  {c.blockers.length > 0 && (
                    <div className="mt-3 border-t border-studio-edge pt-2">
                      <FieldList label="Blockers" items={c.blockers} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </details>

      {/* ── Source viewer ── */}
      {sourceFile && <SourceDrawer path={sourceFile} onClose={() => setSourceFile(null)} />}
    </div>
  );
}
