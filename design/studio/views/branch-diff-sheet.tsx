"use client";

/**
 * Branch Diff Sheet — study (macOS Repos view).
 *
 * The Repos view lists repos and their worktrees/branches, but a branch
 * row is a dead end: you can see *that* it changed (a shortstat churn
 * badge) but not *what* changed. This study gives the branch row a
 * destination — click it and a diff sheet comes into view, carrying the
 * full recap of the branch's diffs.
 *
 * The open questions this exists to answer: where does the sheet come
 * from, how permanent is it, and how big? Flip the *edge* control to
 * watch the same sheet enter from the right (a tall reading column) or
 * the bottom (a wide drawer). Flip *presentation* between a modal you
 * dismiss, a docked panel that stays put while you navigate away (back
 * to a chat), and the diff as its own page. Drag the seam to resize
 * either sheet — the size is remembered. In native this is one
 * component — `HudEdgeSheet(edge:persistence:)` — a SwiftUI
 * `.transition(.move(edge:))` over a scrim, on `HudMotion`'s drawer
 * spring. Hudson has a bottom-only `HudTerminalDrawer` and a docked
 * `HudSidebarPanel`, but no edge-agnostic, persistence-aware sheet yet;
 * this is the spec for it.
 *
 * The diff body is real: the three files below are the actual patch from
 * openscout commit 807c2d23 ("Make native Repo Watch rust or bust"),
 * embedded verbatim and parsed client-side — the same shape a native
 * git-diff viewer would consume.
 *
 * Data note: today the Repo Watch snapshot only carries `--shortstat`
 * (the churn badge) + a changed-file list. Lighting up this sheet for
 * real means extending `crates/openscout-repo-service` to emit patch
 * text behind an `includePatch=1` flag, then `RepoDiff` in
 * ScoutRepoModels.swift to carry it.
 *
 * Ports to:
 *   apps/macos/Sources/Scout/ScoutReposView.swift  (branch row → sheet)
 *   apps/macos/Sources/Scout/ScoutBranchDiffSheet.swift  (new)
 *   ~/dev/hudson … HudsonShell/HudEdgeSheet.swift  (new primitive)
 */

import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import hljs from "highlight.js/lib/common";
import { COMMIT, DIFF_FIXTURES } from "./branch-diff-sheet.fixtures";

// ── Diff model ───────────────────────────────────────────────────────

type LineType = "context" | "add" | "del";

interface DiffLine {
  type: LineType;
  oldNo: number | null;
  newNo: number | null;
  text: string;
  html: string; // syntax-highlighted, escaped
}

interface Hunk {
  header: string; // "@@ -1324 +1324 @@"
  section: string; // the symbol context git prints after the @@
  lines: DiffLine[];
}

interface FileDiff {
  path: string;
  name: string;
  dir: string;
  lang: string;
  status: "modified" | "added" | "deleted";
  additions: number;
  deletions: number;
  hunks: Hunk[];
}

const LANG_ALIAS: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  md: "markdown",
  rs: "rust",
  swift: "swift",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Per-line highlight. Single lines lose cross-line context (block
// comments, multi-line template literals) but read cleanly enough for a
// diff, and the +/- tint stays the dominant signal.
function highlightLine(text: string, lang: string): string {
  if (!text) return "";
  const resolved = LANG_ALIAS[lang] ?? lang;
  if (resolved && hljs.getLanguage(resolved)) {
    try {
      return hljs.highlight(text, { language: resolved, ignoreIllegals: true })
        .value;
    } catch {
      /* fall through */
    }
  }
  return escapeHtml(text);
}

function parseUnifiedDiff(
  patch: string,
  lang: string
): { hunks: Hunk[]; additions: number; deletions: number } {
  const lines = patch.split("\n");
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  let additions = 0;
  let deletions = 0;

  for (const raw of lines) {
    if (raw.startsWith("@@")) {
      const m = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
      oldNo = m ? parseInt(m[1]!, 10) : 0;
      newNo = m ? parseInt(m[2]!, 10) : 0;
      cur = {
        header: m ? `@@ -${m[1]} +${m[2]} @@` : raw,
        section: (m?.[3] ?? "").trim(),
        lines: [],
      };
      hunks.push(cur);
      continue;
    }
    // Everything before the first hunk (diff --git, index, ---, +++) is
    // skipped because cur is still null.
    if (!cur) continue;
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"

    const sign = raw[0];
    const text = raw.slice(1);
    const html = highlightLine(text, lang);
    if (sign === "+") {
      cur.lines.push({ type: "add", oldNo: null, newNo, text, html });
      newNo++;
      additions++;
    } else if (sign === "-") {
      cur.lines.push({ type: "del", oldNo, newNo: null, text, html });
      oldNo++;
      deletions++;
    } else {
      cur.lines.push({ type: "context", oldNo, newNo, text, html });
      oldNo++;
      newNo++;
    }
  }
  return { hunks, additions, deletions };
}

const FILES: FileDiff[] = DIFF_FIXTURES.map((fx) => {
  const parts = fx.path.split("/");
  const name = parts[parts.length - 1]!;
  const dir = parts.slice(0, -1).join("/");
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  const { hunks, additions, deletions } = parseUnifiedDiff(fx.patch, ext);
  return {
    path: fx.path,
    name,
    dir,
    lang: ext,
    status: fx.status,
    additions,
    deletions,
    hunks,
  };
});

// ── Branch model (the Repos rail) ────────────────────────────────────

interface Branch {
  name: string;
  files: FileDiff[];
  ahead: number;
  behind: number;
  isCurrent?: boolean;
}

const BRANCHES: Branch[] = [
  { name: "feat/native-repo-service", files: FILES, ahead: 4, behind: 0 },
  {
    name: "fix/macos-comms-relayout-perf",
    files: [],
    ahead: 2,
    behind: 0,
    isCurrent: true,
  },
  { name: "main", files: [], ahead: 0, behind: 0 },
];

const churn = (b: Branch) =>
  b.files.reduce(
    (acc, f) => ({
      add: acc.add + f.additions,
      del: acc.del + f.deletions,
    }),
    { add: 0, del: 0 }
  );

const STATUS_COLOR: Record<FileDiff["status"], string> = {
  modified: "var(--status-warn-fg)",
  added: "var(--status-ok-fg)",
  deleted: "var(--status-error-fg)",
};
const STATUS_GLYPH: Record<FileDiff["status"], string> = {
  modified: "M",
  added: "A",
  deleted: "D",
};

// ── Page ─────────────────────────────────────────────────────────────

type Edge = "right" | "bottom";
type Mode = "unified" | "split";
// How permanent is the diff? A modal you dismiss, a docked panel that
// stays put while you navigate away, or the diff as its own page.
type Present = "modal" | "docked" | "page";

// Rail width (kept in sync with ReposRail's w-[300px]) — a docked bottom
// drawer tucks under the main column only, leaving the rail clickable.
const RAIL_W = 300;

// Sheet size is stored as a fraction of the mock window (survives the
// fluid container width better than px) and clamped to sane bounds.
const DEFAULT_FRAC: Record<Edge, number> = { right: 0.65, bottom: 0.76 };
const MIN_FRAC: Record<Edge, number> = { right: 0.3, bottom: 0.25 };
const MAX_FRAC: Record<Edge, number> = { right: 0.95, bottom: 0.95 };
const SIZE_KEY = "studio.branch-diff-sheet.size";

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));
const clampFrac = (edge: Edge, v: number) =>
  Number.isFinite(v) ? clamp(v, MIN_FRAC[edge], MAX_FRAC[edge]) : DEFAULT_FRAC[edge];

export default function BranchDiffSheetPage() {
  const [selected, setSelected] = useState<Branch | null>(null);
  const [open, setOpen] = useState(false);
  const [edge, setEdge] = useState<Edge>("right");
  const [mode, setMode] = useState<Mode>("unified");
  const [present, setPresent] = useState<Present>("modal");
  const [frac, setFrac] = useState<Record<Edge, number>>(DEFAULT_FRAC);
  const windowRef = useRef<HTMLDivElement>(null);
  const reopenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore a previously dragged size after mount (not in the initializer)
  // so SSR and the first client render agree — the sheet is closed on load,
  // so there's no visible size flash.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SIZE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<Record<Edge, number>>;
        setFrac({
          right: clampFrac("right", Number(p.right)),
          bottom: clampFrac("bottom", Number(p.bottom)),
        });
      }
    } catch {
      /* ignore unreadable/legacy values */
    }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(SIZE_KEY, JSON.stringify(frac));
    } catch {
      /* ignore */
    }
  }, [frac]);

  const openBranch = (b: Branch) => {
    setSelected(b);
    setOpen(true);
  };

  const resize = (f: number) =>
    setFrac((prev) => ({ ...prev, [edge]: clampFrac(edge, f) }));

  // Flip the entry edge live. If a modal/docked sheet is open, retract it
  // and let it re-enter from the new edge — that *is* the thing this study
  // is for. (A page has no edge, so just record the preference.)
  const changeEdge = (next: Edge) => {
    if (next === edge) return;
    if (open && present !== "page") {
      setOpen(false);
      if (reopenTimer.current) clearTimeout(reopenTimer.current);
      reopenTimer.current = setTimeout(() => {
        setEdge(next);
        setOpen(true);
      }, 220);
    } else {
      setEdge(next);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(
    () => () => {
      if (reopenTimer.current) clearTimeout(reopenTimer.current);
    },
    []
  );

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <style>{STYLES}</style>

      <header className="mb-6 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · macos · branch-diff-sheet
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Branch diff sheet
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Click a branch in the rail and its diff comes into view — the full
          recap of that branch&rsquo;s changes. Two dials:{" "}
          <span className="text-studio-ink-muted">which edge</span> it enters
          from, and <span className="text-studio-ink-muted">how permanent</span>{" "}
          it is — a modal you dismiss, a docked panel you keep open while you
          wander off to a chat, or its own page. Drag the seam to size it
          (double-click to reset). The diff is real — the actual patch from
          commit{" "}
          <code className="font-mono text-[11px] text-studio-ink-muted">
            {COMMIT.sha}
          </code>
          .
        </p>
      </header>

      {/* Toolbar — the presentation exploration this study is for */}
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            Presentation
          </span>
          <Segmented
            value={present}
            onChange={(v) => setPresent(v as Present)}
            options={[
              { value: "modal", label: "Modal" },
              { value: "docked", label: "Docked" },
              { value: "page", label: "Page" },
            ]}
          />
        </div>
        <div
          className="flex items-center gap-2 transition-opacity"
          style={{
            opacity: present === "page" ? 0.35 : 1,
            pointerEvents: present === "page" ? "none" : undefined,
          }}
        >
          <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            Enters from
          </span>
          <Segmented
            value={edge}
            onChange={(v) => changeEdge(v as Edge)}
            options={[
              { value: "right", label: "Right" },
              { value: "bottom", label: "Bottom" },
            ]}
          />
        </div>
        <span className="font-mono text-[10px] text-studio-ink-faint">
          one component · <span className="text-studio-ink-muted">edge</span> +{" "}
          <span className="text-studio-ink-muted">persistence</span> are
          parameters →{" "}
          <code className="text-studio-ink-muted">HudEdgeSheet</code>
        </span>
      </div>

      {/* Mock Repos window */}
      <div
        ref={windowRef}
        className="relative overflow-hidden rounded-lg border border-studio-edge bg-studio-canvas-alt shadow-[0_18px_50px_-20px_rgba(0,0,0,0.6)]"
        style={{ height: 640 }}
      >
        <div className="flex h-full">
          <ReposRail
            activeBranch={open ? selected?.name : undefined}
            onPick={openBranch}
          />
          {present === "page" && open && selected ? (
            // "Its own page" — the diff *is* the main column, no overlay.
            // Maximal permanence; pick another branch and it just navigates.
            <div className="flex min-h-0 min-w-0 flex-1 flex-col border-l border-studio-edge">
              <DiffContent
                branch={selected}
                mode={mode}
                onMode={setMode}
                onClose={() => setOpen(false)}
                variant="page"
              />
            </div>
          ) : (
            <ReposBackdrop hasOpen={open} present={present} />
          )}
        </div>

        {present !== "page" && selected ? (
          <DiffSheet
            branch={selected}
            edge={edge}
            open={open}
            present={present}
            mode={mode}
            frac={frac[edge]}
            windowRef={windowRef}
            onMode={setMode}
            onResize={resize}
            onResetSize={() => resize(DEFAULT_FRAC[edge])}
            onClose={() => setOpen(false)}
          />
        ) : null}
      </div>

      {/* Ports-to */}
      <section className="mt-9 max-w-prose">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · ports to
        </div>
        <ul className="space-y-1 font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
          <li>
            <code className="font-mono text-[11px] text-studio-ink">
              ScoutReposView.swift
            </code>{" "}
            — branch row gains an activate → present action
          </li>
          <li>
            <code className="font-mono text-[11px] text-studio-ink">
              ScoutBranchDiffSheet.swift
            </code>{" "}
            <span className="text-studio-ink-muted">(new)</span> — the diff
            content; files rail + unified/split body
          </li>
          <li>
            <code className="font-mono text-[11px] text-studio-ink">
              hudson · HudEdgeSheet.swift
            </code>{" "}
            <span className="text-studio-ink-muted">(new primitive)</span> —{" "}
            <code className="font-mono text-[11px]">edge</code> +{" "}
            <code className="font-mono text-[11px]">persistence</code> params, a
            resizable{" "}
            <code className="font-mono text-[11px]">.move(edge:)</code>{" "}
            transition + scrim on{" "}
            <code className="font-mono text-[11px]">HudMotion</code>
          </li>
          <li>
            <span className="text-studio-ink-muted">docked vs page</span> — a
            docked sheet maps to a kept{" "}
            <code className="font-mono text-[11px]">HudSidebarPanel</code>/
            <code className="font-mono text-[11px]">HudTerminalDrawer</code>;
            &ldquo;its own page&rdquo; is a Repos detail route you leave open and
            return to
          </li>
          <li className="pt-1 text-studio-ink-faint">
            <span className="text-status-warn-fg">data gap</span> — the snapshot
            carries only <code className="font-mono text-[11px]">--shortstat</code>{" "}
            today; patch text needs an{" "}
            <code className="font-mono text-[11px]">includePatch=1</code> path
            through{" "}
            <code className="font-mono text-[11px]">
              openscout-repo-service
            </code>{" "}
            → <code className="font-mono text-[11px]">RepoDiff</code>
          </li>
        </ul>
      </section>
    </main>
  );
}

// ── Repos rail ───────────────────────────────────────────────────────

function ReposRail({
  activeBranch,
  onPick,
}: {
  activeBranch: string | undefined;
  onPick: (b: Branch) => void;
}) {
  return (
    <div className="flex h-full w-[300px] shrink-0 flex-col border-r border-studio-edge">
      <div className="flex items-center gap-2 border-b border-studio-edge px-3 py-2">
        <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          Repos
        </span>
        <span className="ml-auto font-mono text-[10px] tabular-nums text-studio-ink-faint">
          1 repo
        </span>
      </div>

      <div className="flex-1 overflow-y-auto py-1.5">
        {/* repo node */}
        <div className="flex items-center gap-2 px-3 py-1">
          <span className="text-[9px] leading-none text-studio-ink-faint">
            ▾
          </span>
          <span className="font-mono text-[12px] font-semibold text-studio-ink">
            openscout
          </span>
          <span className="font-mono text-[10px] text-studio-ink-faint">
            ~/dev/openscout
          </span>
        </div>

        {BRANCHES.map((b) => (
          <BranchRow
            key={b.name}
            branch={b}
            active={activeBranch === b.name}
            onPick={() => onPick(b)}
          />
        ))}
      </div>

      <div className="flex items-center gap-3 border-t border-studio-edge px-3 py-1.5 font-mono text-[9px] text-studio-ink-faint">
        <span>
          <Kbd>↵</Kbd> open diff
        </span>
        <span className="ml-auto opacity-70">click a branch →</span>
      </div>
    </div>
  );
}

function BranchRow({
  branch,
  active,
  onPick,
}: {
  branch: Branch;
  active: boolean;
  onPick: () => void;
}) {
  const c = churn(branch);
  const dirty = branch.files.length > 0;
  const slash = branch.name.lastIndexOf("/");
  const prefix = slash >= 0 ? branch.name.slice(0, slash + 1) : "";
  const leaf = slash >= 0 ? branch.name.slice(slash + 1) : branch.name;

  return (
    <button
      onClick={onPick}
      className="group relative flex w-full items-center gap-2 py-1 pl-7 pr-3 text-left transition-colors duration-75 hover:bg-studio-surface"
      style={{
        background: active
          ? "color-mix(in oklab, var(--scout-accent) 10%, transparent)"
          : undefined,
        boxShadow: active ? "inset 2px 0 0 var(--scout-accent)" : undefined,
      }}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{
          background: dirty
            ? "var(--status-warn-fg)"
            : "var(--studio-ink-faint)",
          animation: dirty ? "bd-pulse 2s ease-in-out infinite" : undefined,
        }}
      />
      <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
        <span className="text-studio-ink-faint">{prefix}</span>
        <span className="text-studio-ink">{leaf}</span>
        {branch.isCurrent ? (
          <span className="ml-1.5 font-sans text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
            HEAD
          </span>
        ) : null}
      </span>

      {dirty ? (
        <span className="shrink-0 font-mono text-[10px] tabular-nums">
          <span style={{ color: "var(--status-ok-fg)" }}>+{c.add}</span>{" "}
          <span style={{ color: "var(--status-error-fg)" }}>−{c.del}</span>
        </span>
      ) : (
        <span className="shrink-0 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          clean
        </span>
      )}
      <Position ahead={branch.ahead} behind={branch.behind} />
    </button>
  );
}

function Position({ ahead, behind }: { ahead: number; behind: number }) {
  if (!ahead && !behind)
    return <span className="w-9 shrink-0" aria-hidden />;
  return (
    <span className="w-9 shrink-0 text-right font-mono text-[9px] tabular-nums text-studio-ink-faint">
      {ahead ? `↑${ahead}` : ""}
      {behind ? ` ↓${behind}` : ""}
    </span>
  );
}

// Faint placeholder behind the rail — what the Repos main column shows
// before a sheet is summoned. In docked mode it stays visible (no scrim)
// to make the "pick another branch, it stays" behaviour legible.
function ReposBackdrop({
  hasOpen,
  present,
}: {
  hasOpen: boolean;
  present: Present;
}) {
  const docked = hasOpen && present === "docked";
  return (
    <div className="relative flex flex-1 items-center justify-center">
      <div
        className="text-center transition-opacity duration-300"
        style={{ opacity: hasOpen ? 0.25 : 1 }}
      >
        <div className="font-mono text-[11px] text-studio-ink-faint">
          {docked ? "diff docked" : "select a branch"}
        </div>
        <div className="mt-1 font-mono text-[10px] text-studio-ink-faint opacity-60">
          {docked
            ? "pick another branch — it stays open"
            : "its diffs recap into a sheet"}
        </div>
      </div>
    </div>
  );
}

// ── The sheet ────────────────────────────────────────────────────────
//
// Overlay shell for modal + docked. Modal lays down a scrim and dismisses
// on click; docked drops the scrim so the rail stays live. Both enter from
// the chosen edge and carry a draggable resize seam on that edge.

function DiffSheet({
  branch,
  edge,
  open,
  present,
  mode,
  frac,
  windowRef,
  onMode,
  onResize,
  onResetSize,
  onClose,
}: {
  branch: Branch;
  edge: Edge;
  open: boolean;
  present: Present;
  mode: Mode;
  frac: number;
  windowRef: React.RefObject<HTMLDivElement | null>;
  onMode: (m: Mode) => void;
  onResize: (f: number) => void;
  onResetSize: () => void;
  onClose: () => void;
}) {
  // rAF gate so the panel animates in on mount / on open changes.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
  }, [open]);

  const [dragging, setDragging] = useState(false);
  const isRight = edge === "right";
  const modal = present === "modal";

  // Drag the seam to resize. Listeners live on window (not the thin handle)
  // so the drag keeps tracking even when the pointer outruns it. Pointer
  // capture keeps the trailing click off the scrim (no accidental close).
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const el = windowRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      onResize(
        isRight
          ? (rect.right - e.clientX) / rect.width
          : (rect.bottom - e.clientY) / rect.height
      );
    };
    const up = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = isRight ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [dragging, isRight, onResize, windowRef]);

  const sizePct = `${frac * 100}%`;
  const panelStyle: CSSProperties = isRight
    ? {
        top: 0,
        right: 0,
        bottom: 0,
        width: sizePct,
        transform: shown ? "translateX(0)" : "translateX(101%)",
        borderLeft: "1px solid var(--studio-edge-strong)",
      }
    : {
        // Docked bottom drawer tucks under the main column, leaving the
        // rail uncovered; a modal bottom sheet spans the full width.
        left: present === "docked" ? RAIL_W : 0,
        right: 0,
        bottom: 0,
        height: sizePct,
        transform: shown ? "translateY(0)" : "translateY(101%)",
        borderTop: "1px solid var(--studio-edge-strong)",
      };

  // The seam sits on the panel's moving edge (at the size fraction).
  const handleStyle: CSSProperties = isRight
    ? {
        top: 0,
        bottom: 0,
        left: `${(1 - frac) * 100}%`,
        width: 14,
        transform: "translateX(-50%)",
      }
    : {
        left: present === "docked" ? RAIL_W : 0,
        right: 0,
        top: `${(1 - frac) * 100}%`,
        height: 14,
        transform: "translateY(-50%)",
      };

  return (
    <>
      {/* scrim — modal only; docked leaves the rail live */}
      {modal ? (
        <div
          className="absolute inset-0"
          style={{
            background: "color-mix(in oklab, black 42%, transparent)",
            opacity: shown ? 1 : 0,
            transition: "opacity 280ms ease",
            pointerEvents: shown ? "auto" : "none",
          }}
          onClick={onClose}
        />
      ) : null}

      {/* panel */}
      <div
        className="absolute flex flex-col overflow-hidden bg-studio-canvas shadow-[0_-2px_60px_-12px_rgba(0,0,0,0.7)]"
        style={{
          ...panelStyle,
          transition: dragging
            ? "none"
            : "transform 380ms cubic-bezier(.32,.72,0,1)",
        }}
      >
        <DiffContent
          branch={branch}
          mode={mode}
          onMode={onMode}
          onClose={onClose}
          variant="sheet"
        />
      </div>

      {/* resize seam — drag to size, double-click to reset */}
      <div
        role="separator"
        aria-orientation={isRight ? "vertical" : "horizontal"}
        aria-label="Resize diff sheet"
        title="Drag to resize · double-click to reset"
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture?.(e.pointerId);
          setDragging(true);
        }}
        onDoubleClick={onResetSize}
        className={`group absolute z-20 flex items-center justify-center ${
          isRight ? "cursor-col-resize" : "cursor-row-resize"
        }`}
        style={{
          ...handleStyle,
          opacity: shown ? 1 : 0,
          pointerEvents: shown ? "auto" : "none",
          transition: "opacity 200ms ease",
        }}
      >
        <span
          className="rounded-full transition-colors group-hover:!bg-[var(--scout-accent)]"
          style={{
            background: dragging
              ? "var(--scout-accent)"
              : "var(--studio-edge-strong)",
            width: isRight ? 3 : 48,
            height: isRight ? 48 : 3,
          }}
        />
      </div>
    </>
  );
}

// The diff itself — header (branch + churn + unified/split + close) and
// body (changed-files rail + diff). Shared verbatim by the overlay sheet
// and the full-column "page" presentation; the parent supplies the flex
// column it fills.
function DiffContent({
  branch,
  mode,
  onMode,
  onClose,
  variant,
}: {
  branch: Branch;
  mode: Mode;
  onMode: (m: Mode) => void;
  onClose: () => void;
  variant: "sheet" | "page";
}) {
  const [fileIdx, setFileIdx] = useState(0);
  useEffect(() => {
    setFileIdx(0);
  }, [branch.name]);

  const file = branch.files[fileIdx];
  const c = churn(branch);
  const slash = branch.name.lastIndexOf("/");
  const prefix = slash >= 0 ? branch.name.slice(0, slash + 1) : "";
  const leaf = slash >= 0 ? branch.name.slice(slash + 1) : branch.name;

  return (
    <>
      {/* header */}
      <div className="flex items-center gap-3 border-b border-studio-edge px-4 py-2.5">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: "var(--status-warn-fg)" }}
        />
        <div className="min-w-0">
          <div className="truncate font-mono text-[13px]">
            <span className="text-studio-ink-faint">{prefix}</span>
            <span className="font-semibold text-studio-ink">{leaf}</span>
          </div>
          <div className="mt-0.5 font-mono text-[10px] tabular-nums text-studio-ink-faint">
            {branch.files.length} file
            {branch.files.length === 1 ? "" : "s"}
            {" · "}
            <span style={{ color: "var(--status-ok-fg)" }}>+{c.add}</span>{" "}
            <span style={{ color: "var(--status-error-fg)" }}>−{c.del}</span>
            {branch.ahead ? <span> · ↑{branch.ahead} ahead</span> : null}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {branch.files.length ? (
            <Segmented
              value={mode}
              onChange={(v) => onMode(v as Mode)}
              options={[
                { value: "unified", label: "Unified" },
                { value: "split", label: "Split" },
              ]}
            />
          ) : null}
          <button
            onClick={onClose}
            aria-label={variant === "page" ? "Close diff" : "Close"}
            className="focus-ring grid h-6 w-6 place-items-center rounded-[4px] text-studio-ink-faint transition-colors hover:bg-studio-surface hover:text-studio-ink"
          >
            ✕
          </button>
        </div>
      </div>

      {/* body */}
      {branch.files.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="font-mono text-[12px] text-studio-ink-muted">
              working tree clean
            </div>
            <div className="mt-1 font-mono text-[10px] text-studio-ink-faint">
              nothing to diff on this branch
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <FilesRail
            files={branch.files}
            selected={fileIdx}
            onSelect={setFileIdx}
          />
          {file ? <DiffBody file={file} mode={mode} /> : null}
        </div>
      )}
    </>
  );
}

function FilesRail({
  files,
  selected,
  onSelect,
}: {
  files: FileDiff[];
  selected: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="flex w-[230px] shrink-0 flex-col border-r border-studio-edge bg-studio-canvas-alt">
      <div className="border-b border-studio-edge px-3 py-1.5 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        Changed files
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {files.map((f, i) => (
          <button
            key={f.path}
            onClick={() => onSelect(i)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-75 hover:bg-studio-surface"
            style={{
              background:
                i === selected
                  ? "color-mix(in oklab, var(--scout-accent) 10%, transparent)"
                  : undefined,
              boxShadow:
                i === selected ? "inset 2px 0 0 var(--scout-accent)" : undefined,
            }}
          >
            <span
              className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] font-mono text-[8px] font-bold"
              style={{
                color: STATUS_COLOR[f.status],
                background: "color-mix(in oklab, currentColor 16%, transparent)",
              }}
            >
              {STATUS_GLYPH[f.status]}
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate font-mono text-[11px] text-studio-ink">
                {f.name}
              </span>
              <span className="block truncate font-mono text-[9px] text-studio-ink-faint">
                {f.dir}
              </span>
            </span>
            <span className="shrink-0 text-right font-mono text-[9px] tabular-nums leading-tight">
              <span className="block" style={{ color: "var(--status-ok-fg)" }}>
                +{f.additions}
              </span>
              <span
                className="block"
                style={{ color: "var(--status-error-fg)" }}
              >
                −{f.deletions}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Diff body ────────────────────────────────────────────────────────

function DiffBody({ file, mode }: { file: FileDiff; mode: Mode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {/* file breadcrumb */}
      <div className="flex items-center gap-2 border-b border-studio-edge px-4 py-1.5">
        <span className="truncate font-mono text-[11px]">
          <span className="text-studio-ink-faint">{file.dir}/</span>
          <span className="text-studio-ink">{file.name}</span>
        </span>
        {file.lang ? (
          <span className="shrink-0 rounded-[3px] border border-studio-edge px-1 py-px font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
            {file.lang}
          </span>
        ) : null}
        <span className="ml-auto shrink-0 font-mono text-[9px] tabular-nums text-studio-ink-faint">
          {file.hunks.length} hunk{file.hunks.length === 1 ? "" : "s"}
        </span>
      </div>

      <div
        className="min-h-0 flex-1 overflow-auto"
        style={{ background: "var(--code-bg)" }}
      >
        <div className="min-w-max font-mono text-[11px] leading-[1.5]">
          {file.hunks.map((h, i) =>
            mode === "unified" ? (
              <UnifiedHunk key={i} hunk={h} />
            ) : (
              <SplitHunk key={i} hunk={h} />
            )
          )}
        </div>
      </div>
    </div>
  );
}

function HunkHeader({ hunk }: { hunk: Hunk }) {
  return (
    <div
      className="flex items-baseline gap-3 px-3 py-1"
      style={{
        background: "var(--studio-canvas-alt)",
        borderTop: "1px solid var(--code-border)",
        borderBottom: "1px solid var(--code-border)",
      }}
    >
      <span className="tabular-nums text-studio-ink-faint">{hunk.header}</span>
      {hunk.section ? (
        <span className="truncate text-studio-ink-faint opacity-70">
          {hunk.section}
        </span>
      ) : null}
    </div>
  );
}

const ROW_BG: Record<LineType, string> = {
  add: "var(--status-ok-bg)",
  del: "var(--status-error-bg)",
  context: "transparent",
};
const SIGN: Record<LineType, string> = { add: "+", del: "−", context: " " };
const SIGN_COLOR: Record<LineType, string> = {
  add: "var(--status-ok-fg)",
  del: "var(--status-error-fg)",
  context: "var(--studio-ink-faint)",
};

function Gutter({ n }: { n: number | null }) {
  return (
    <span className="w-[3ch] shrink-0 select-none px-1.5 text-right tabular-nums text-studio-ink-faint">
      {n ?? ""}
    </span>
  );
}

function Code({ html }: { html: string }) {
  return (
    <code
      className="hljs flex-1 whitespace-pre px-2"
      style={{ background: "transparent" }}
      dangerouslySetInnerHTML={{ __html: html || " " }}
    />
  );
}

function UnifiedHunk({ hunk }: { hunk: Hunk }) {
  return (
    <div>
      <HunkHeader hunk={hunk} />
      {hunk.lines.map((ln, i) => (
        <div
          key={i}
          className="flex"
          style={{ background: ROW_BG[ln.type] }}
        >
          <Gutter n={ln.oldNo} />
          <Gutter n={ln.newNo} />
          <span
            className="w-[2ch] shrink-0 select-none text-center"
            style={{ color: SIGN_COLOR[ln.type] }}
          >
            {SIGN[ln.type]}
          </span>
          <Code html={ln.html} />
        </div>
      ))}
    </div>
  );
}

// Pair del/add runs into side-by-side rows; context spans both columns.
interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}
function pairHunk(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];
  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i++) {
      rows.push({ left: dels[i] ?? null, right: adds[i] ?? null });
    }
    dels = [];
    adds = [];
  };
  for (const ln of lines) {
    if (ln.type === "context") {
      flush();
      rows.push({ left: ln, right: ln });
    } else if (ln.type === "del") {
      dels.push(ln);
    } else {
      adds.push(ln);
    }
  }
  flush();
  return rows;
}

function SplitCell({
  line,
  side,
}: {
  line: DiffLine | null;
  side: "left" | "right";
}) {
  if (!line) {
    return (
      <div
        className="flex flex-1 border-r border-studio-edge"
        style={{ background: "color-mix(in oklab, var(--studio-ink) 4%, transparent)" }}
      >
        <span className="w-[3ch] shrink-0" />
        <span className="flex-1" />
      </div>
    );
  }
  const no = side === "left" ? line.oldNo : line.newNo;
  return (
    <div
      className="flex min-w-0 flex-1 border-r border-studio-edge"
      style={{ background: ROW_BG[line.type] }}
    >
      <Gutter n={no} />
      <span
        className="w-[2ch] shrink-0 select-none text-center"
        style={{ color: SIGN_COLOR[line.type] }}
      >
        {SIGN[line.type]}
      </span>
      <Code html={line.html} />
    </div>
  );
}

function SplitHunk({ hunk }: { hunk: Hunk }) {
  const rows = useMemo(() => pairHunk(hunk.lines), [hunk]);
  return (
    <div>
      <HunkHeader hunk={hunk} />
      {rows.map((r, i) => (
        <div key={i} className="flex">
          <SplitCell line={r.left} side="left" />
          <SplitCell line={r.right} side="right" />
        </div>
      ))}
    </div>
  );
}

// ── Atoms ────────────────────────────────────────────────────────────

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-[5px] border border-studio-edge">
      {options.map((opt, i) => {
        const on = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className="focus-ring px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-eyebrow transition-colors"
            style={{
              borderLeft: i ? "1px solid var(--studio-edge)" : undefined,
              background: on
                ? "color-mix(in oklab, var(--scout-accent) 16%, transparent)"
                : "transparent",
              color: on ? "var(--studio-ink)" : "var(--studio-ink-faint)",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-[3px] border border-studio-edge bg-studio-canvas px-1 py-px font-mono text-[10px] text-studio-ink-muted">
      {children}
    </kbd>
  );
}

const STYLES = `
@keyframes bd-pulse {
  0%, 100% { box-shadow: 0 0 0 2px color-mix(in oklab, var(--status-warn-fg) 28%, transparent); }
  50%      { box-shadow: 0 0 0 4px color-mix(in oklab, var(--status-warn-fg) 5%, transparent); }
}
@media (prefers-reduced-motion: reduce) {
  [style*="bd-pulse"] { animation: none !important; }
  [style*="cubic-bezier(.32"] { transition: none !important; }
}
`;
