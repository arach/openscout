"use client";

import { EyebrowLabel } from "@/components/EyebrowLabel";
import { useState, type ReactNode } from "react";

// Studio study for Scout terminal sessions.
//
// Product model (see docs/specs/terminal-session-intake-surfaces.md):
//   harness session id = stable identity
//   terminal backend   = disposable, interchangeable surface
//
// The durable noun is HarnessSession (a known agent session with a stable
// source id + resume command). A HarnessSession is *materialized* through one
// or more TerminalSurfaces (tmux | zellij | future ssh). The same session can
// move from one backend to another without changing identity — you are not
// moving a terminal, you are rematerializing a harness session.
//
// Mock data only. No runtime/web relay or durable registry is wired here.

type TerminalBackend = "tmux" | "zellij";
type SurfaceState = "live" | "detached" | "exited";
type HarnessKind = "claude" | "codex" | "pi";

type TerminalSurface = {
  id: string;
  backend: TerminalBackend;
  state: SurfaceState;
  /** Backend session name — secondary metadata, never the primary noun. */
  sessionName: string;
  paneId: string | null;
  attachCommand: string[];
  observeCommand: string[] | null;
  /** Zellij needs a short socket dir (macOS socket-path length gotcha). */
  socketDir: string | null;
  updated: string;
  note: string | null;
};

type HarnessSession = {
  id: string;
  harness: HarnessKind;
  label: string;
  /** Harness-native session id — the stable identity across backends. */
  sourceSessionId: string;
  project: string;
  cwd: string;
  resumeCommand: string;
  surfaces: TerminalSurface[];
  /** Last frames from the active surface. A surface artifact, not a Scout message. */
  preview: string[];
};

const ZELLIJ_SOCKET_DIR = "/Users/art/.openscout/zellij-sockets";

const HARNESS_SESSIONS: HarnessSession[] = [
  {
    // The real end-to-end validated session from the brief: started in tmux,
    // detached + exited, then rematerialized in Zellij with full context.
    id: "claude-7e55c009",
    harness: "claude",
    label: "Claude Code",
    sourceSessionId: "7e55c009-f579-439c-a817-988318789330",
    project: "openscout-session-intake-test",
    cwd: "~/Library/Caches/openscout-session-intake-test/7e55c009",
    resumeCommand: "claude --resume 7e55c009-f579-439c-a817-988318789330",
    surfaces: [
      {
        id: "s-tmux",
        backend: "tmux",
        state: "exited",
        sessionName: "scout-tmux-7e55c009",
        paneId: "%0",
        attachCommand: ["tmux", "attach", "-t", "scout-tmux-7e55c009"],
        observeCommand: null,
        socketDir: null,
        updated: "9m",
        note: "client detached, harness process exited cleanly",
      },
      {
        id: "s-zellij",
        backend: "zellij",
        state: "live",
        sessionName: "scout-zj-final-7e55c009",
        paneId: "terminal_0",
        attachCommand: [
          "env",
          `ZELLIJ_SOCKET_DIR=${ZELLIJ_SOCKET_DIR}`,
          "zellij",
          "attach",
          "scout-zj-final-7e55c009",
        ],
        observeCommand: [
          "env",
          `ZELLIJ_SOCKET_DIR=${ZELLIJ_SOCKET_DIR}`,
          "zellij",
          "watch",
          "scout-zj-final-7e55c009",
        ],
        socketDir: ZELLIJ_SOCKET_DIR,
        updated: "12s",
        note: "v1 keeps Zellij's extra shell pane (terminal_1)",
      },
    ],
    preview: [
      "$ claude --resume 7e55c009-f579-439c-a817-988318789330",
      "resumed session · 3 prior turns restored",
      "operator: are TMUX_PROMPT_ONE/TWO/THREE still in context?",
      "claude: yes — all three tmux tokens carried over to this surface",
      "ZELLIJ_RESUME_READY",
    ],
  },
  {
    id: "codex-runtime",
    harness: "codex",
    label: "Codex",
    sourceSessionId: "c0d3x-4f7a-runtime-broker",
    project: "openscout",
    cwd: "packages/runtime",
    resumeCommand: "codex resume -C packages/runtime c0d3x-4f7a-runtime-broker",
    surfaces: [
      {
        id: "s-codex-tmux",
        backend: "tmux",
        state: "live",
        sessionName: "scout-codex-runtime",
        paneId: "%4",
        attachCommand: ["tmux", "attach", "-t", "scout-codex-runtime"],
        observeCommand: null,
        socketDir: null,
        updated: "1m",
        note: null,
      },
    ],
    preview: [
      "broker process manager: scoutd resolved from package bin",
      "running broker-process-manager.test.ts",
      "12 pass · 0 fail",
      "waiting for next instruction",
    ],
  },
  {
    // A known harness session with no active surface — the case that makes
    // "materialize" the primary action.
    id: "claude-dormant",
    harness: "claude",
    label: "Claude Code",
    sourceSessionId: "a1b2c3d4-web-client-refactor",
    project: "openscout",
    cwd: "packages/web",
    resumeCommand: "claude --resume a1b2c3d4-web-client-refactor",
    surfaces: [],
    preview: [],
  },
];

const ALL_SURFACES = HARNESS_SESSIONS.flatMap((s) => s.surfaces);
const LIVE_SURFACE_COUNT = ALL_SURFACES.filter((s) => s.state === "live").length;

function hasLiveSurface(session: HarnessSession): boolean {
  return session.surfaces.some((s) => s.state === "live");
}

function preferredSurface(session: HarnessSession): TerminalSurface | null {
  return (
    session.surfaces.find((s) => s.state === "live") ??
    session.surfaces[0] ??
    null
  );
}

const SELECTED = HARNESS_SESSIONS[0]!;

export default function TerminalSessionsStudy() {
  const [selectedId, setSelectedId] = useState(SELECTED.id);
  const [surfaceId, setSurfaceId] = useState<string | null>(
    preferredSurface(SELECTED)?.id ?? null,
  );

  const session =
    HARNESS_SESSIONS.find((s) => s.id === selectedId) ?? SELECTED;
  const activeSurface =
    session.surfaces.find((s) => s.id === surfaceId) ??
    preferredSurface(session);

  const selectSession = (id: string) => {
    setSelectedId(id);
    const next = HARNESS_SESSIONS.find((s) => s.id === id);
    setSurfaceId(next ? (preferredSurface(next)?.id ?? null) : null);
  };

  return (
    <main className="mx-auto max-w-page px-7 py-8 text-studio-ink">
      <header className="mb-5 max-w-3xl">
        <EyebrowLabel>studies / web / runtime</EyebrowLabel>
        <h1 className="mt-1 font-display text-[32px] font-medium leading-none text-studio-ink">
          Terminal sessions
        </h1>
        <p className="mt-3 max-w-3xl font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Scout indexes <span className="text-studio-ink-muted">harness sessions</span> — a
          stable agent identity with a resume command — and materializes each one through
          interchangeable terminal <span className="text-studio-ink-muted">surfaces</span>. tmux
          and Zellij are backends, not the product noun.
        </p>
      </header>

      <section className="overflow-hidden rounded-[10px] border border-studio-edge-strong bg-studio-canvas shadow-[0_18px_40px_-24px_color-mix(in_oklab,var(--studio-ink)_55%,transparent)]">
        <WindowTitlebar />
        <ModeStrip />

        <div className="grid min-h-[700px] xl:grid-cols-[324px_minmax(0,1fr)_320px]">
          <SessionRail selectedId={session.id} onSelect={selectSession} />
          <SessionDetail
            session={session}
            activeSurface={activeSurface}
            onSelectSurface={setSurfaceId}
          />
          <ContextRail session={session} activeSurface={activeSurface} />
        </div>

        <MaterializeDock session={session} />
        <WindowStatusbar />
      </section>
    </main>
  );
}

function WindowTitlebar() {
  return (
    <div className="flex h-[30px] items-center gap-2 border-b border-studio-edge bg-studio-canvas-alt px-3">
      <div className="flex items-center gap-1.5" aria-hidden>
        <span className="h-[10px] w-[10px] rounded-full bg-[#FF5F57]" />
        <span className="h-[10px] w-[10px] rounded-full bg-[#FEBC2E]" />
        <span className="h-[10px] w-[10px] rounded-full bg-[#28C840]" />
      </div>
      <span className="ml-2 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        Scout sessions
      </span>
      <span className="ml-auto hidden font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint md:inline">
        identity stays · backend is disposable
      </span>
    </div>
  );
}

function ModeStrip() {
  return (
    <div className="relative flex h-[34px] items-center justify-between border-b border-studio-edge bg-studio-surface px-3">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-eyebrow text-scout-accent">
        -- sessions --
      </span>
      <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-2 font-mono text-[9.5px] text-studio-ink-muted md:flex">
        <span>{HARNESS_SESSIONS.length} sessions</span>
        <MetaDot />
        <span>{ALL_SURFACES.length} surfaces</span>
        <MetaDot />
        <span>{LIVE_SURFACE_COUNT} live</span>
      </div>
      <span className="hidden font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint sm:inline">
        rematerialize, don&apos;t move
      </span>
    </div>
  );
}

function WindowStatusbar() {
  return (
    <div className="flex h-[22px] items-center gap-2 border-t border-studio-edge bg-studio-canvas-alt px-3 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-status-ok-fg" />
      <span className="text-studio-ink-muted">
        {LIVE_SURFACE_COUNT} live / {ALL_SURFACES.length} surfaces /{" "}
        {HARNESS_SESSIONS.length} sessions
      </span>
      <span className="ml-auto hidden text-studio-ink-faint sm:inline">
        backends: tmux / zellij / ssh (future)
      </span>
    </div>
  );
}

/* ── Left rail: known harness sessions ──────────────────────────────── */

function SessionRail({
  selectedId,
  onSelect,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const live = HARNESS_SESSIONS.filter(hasLiveSurface);
  const dormant = HARNESS_SESSIONS.filter((s) => !hasLiveSurface(s));

  return (
    <aside className="flex min-h-0 flex-col border-b border-studio-edge bg-studio-canvas-alt xl:border-b-0 xl:border-r">
      <RailHeader title="harness sessions" count={HARNESS_SESSIONS.length} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col">
          {live.length > 0 ? (
            <>
              <ListEyebrow label="live" count={live.length} />
              {live.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  selected={session.id === selectedId}
                  onSelect={onSelect}
                />
              ))}
            </>
          ) : null}
          {dormant.length > 0 ? (
            <>
              <ListEyebrow label="dormant" count={dormant.length} />
              {dormant.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  selected={session.id === selectedId}
                  onSelect={onSelect}
                />
              ))}
            </>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function SessionRow({
  session,
  selected,
  onSelect,
}: {
  session: HarnessSession;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const live = hasLiveSurface(session);
  return (
    <button
      type="button"
      onClick={() => onSelect(session.id)}
      className={[
        "group relative border-b border-studio-edge px-3 py-3 text-left transition-colors hover:bg-studio-surface",
        selected ? "bg-studio-surface" : "",
      ].join(" ")}
    >
      {selected ? (
        <span
          aria-hidden
          className="absolute inset-y-2 left-0 w-[2px] rounded-r"
          style={{ background: "var(--scout-accent)" }}
        />
      ) : null}
      <div className="flex items-baseline gap-2">
        <SurfaceStateDot state={live ? "live" : "exited"} />
        <span className="truncate font-sans text-[12.5px] font-semibold text-studio-ink">
          {session.label}
        </span>
        <HarnessBadge harness={session.harness} />
        <span className="ml-auto font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          {live ? "live" : session.surfaces.length === 0 ? "no surface" : "idle"}
        </span>
      </div>
      <div className="mt-1 truncate pl-[15px] font-mono text-[9.5px] text-studio-ink-faint">
        {session.sourceSessionId}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 pl-[15px]">
        {session.surfaces.length === 0 ? (
          <span className="font-mono text-[9px] text-studio-ink-faint">
            not materialized
          </span>
        ) : (
          session.surfaces.map((surface) => (
            <SurfaceBadge key={surface.id} surface={surface} />
          ))
        )}
      </div>
    </button>
  );
}

/* ── Center: selected session + active surface ──────────────────────── */

function SessionDetail({
  session,
  activeSurface,
  onSelectSurface,
}: {
  session: HarnessSession;
  activeSurface: TerminalSurface | null;
  onSelectSurface: (id: string) => void;
}) {
  return (
    <section className="flex min-w-0 flex-col border-b border-studio-edge xl:border-b-0 xl:border-r">
      <div className="flex flex-wrap items-center gap-3 border-b border-studio-edge px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <SurfaceStateDot state={hasLiveSurface(session) ? "live" : "exited"} strong />
            <h2 className="truncate font-sans text-[15px] font-semibold leading-none tracking-tight text-studio-ink">
              {session.label}
            </h2>
            <HarnessBadge harness={session.harness} />
          </div>
          <div className="mt-1 truncate font-mono text-[10px] text-studio-ink-faint">
            session {session.sourceSessionId}
          </div>
        </div>
        <SurfaceActions surface={activeSurface} />
      </div>

      <SurfaceTabs
        session={session}
        activeSurface={activeSurface}
        onSelectSurface={onSelectSurface}
      />

      {activeSurface ? (
        <div className="grid border-b border-studio-edge bg-studio-canvas-alt md:grid-cols-4">
          <MetaCell label="backend" value={activeSurface.backend} subtle />
          <MetaCell label="surface" value={activeSurface.sessionName} wide />
          <MetaCell label="pane" value={activeSurface.paneId ?? "—"} />
          <MetaCell label="updated" value={activeSurface.updated} />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 bg-studio-canvas p-4">
        <div className="flex h-full min-h-[392px] flex-col overflow-hidden rounded-[6px] border border-studio-edge-strong bg-[#070907] shadow-[0_12px_30px_-20px_rgba(0,0,0,0.85)]">
          <div className="flex h-8 items-center gap-2 border-b border-white/10 bg-black/25 px-3">
            <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
              {activeSurface ? `${activeSurface.backend} surface` : "no surface"}
            </span>
            {activeSurface ? (
              <span
                className="font-mono text-[9px] uppercase tracking-eyebrow"
                style={{ color: surfaceStateColor(activeSurface.state) }}
              >
                {activeSurface.state}
              </span>
            ) : null}
            <span className="ml-auto truncate font-mono text-[9px] text-studio-ink-faint">
              {session.cwd}
            </span>
          </div>
          {activeSurface ? (
            <pre className="min-h-0 flex-1 overflow-hidden whitespace-pre-wrap px-4 py-3 font-mono text-[12px] leading-6 text-[#c7e7cd]">
              {session.preview.map((line) => (
                <TerminalLine key={line}>{line}</TerminalLine>
              ))}
              <TerminalLine tone="muted"> </TerminalLine>
              <TerminalLine tone="accent">
                {activeSurface.state === "live"
                  ? "scout relay: streaming this surface"
                  : "scout relay: surface not live — rematerialize to attach"}
              </TerminalLine>
              {activeSurface.state === "live" ? <TerminalCursor /> : null}
            </pre>
          ) : (
            <NoSurfacePlaceholder />
          )}
        </div>

        {activeSurface ? <CommandBlock surface={activeSurface} /> : null}
      </div>
    </section>
  );
}

function SurfaceTabs({
  session,
  activeSurface,
  onSelectSurface,
}: {
  session: HarnessSession;
  activeSurface: TerminalSurface | null;
  onSelectSurface: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-studio-edge bg-studio-surface px-4 py-2">
      <span className="font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        surfaces
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {session.surfaces.length === 0 ? (
          <span className="font-mono text-[9.5px] text-studio-ink-faint">
            none — materialize below
          </span>
        ) : (
          session.surfaces.map((surface) => (
            <button
              key={surface.id}
              type="button"
              onClick={() => onSelectSurface(surface.id)}
              className={[
                "inline-flex items-center gap-1.5 rounded-[4px] border px-2 py-1 font-mono text-[9px] font-semibold uppercase tracking-eyebrow transition-colors",
                activeSurface?.id === surface.id
                  ? "border-[color-mix(in_oklab,var(--scout-accent)_42%,transparent)] bg-scout-accent-soft text-scout-accent"
                  : "border-studio-edge bg-studio-canvas text-studio-ink-muted hover:border-studio-edge-strong hover:text-studio-ink",
              ].join(" ")}
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: surfaceStateColor(surface.state) }}
              />
              {surface.backend}
              <span className="text-studio-ink-faint">· {surface.state}</span>
            </button>
          ))
        )}
        <span className="ml-1 font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
          one identity, swappable backends
        </span>
      </div>
    </div>
  );
}

function SurfaceActions({ surface }: { surface: TerminalSurface | null }) {
  if (!surface) {
    return (
      <div className="flex items-center gap-1.5">
        <ActionButton accent icon={<MaterializeIcon />} label="Materialize tmux" />
        <ActionButton accent icon={<MaterializeIcon />} label="Materialize Zellij" />
      </div>
    );
  }
  if (surface.state === "live") {
    return (
      <div className="flex items-center gap-1.5">
        <ActionButton accent icon={<AttachIcon />} label="Attach" />
        <ActionButton icon={<EyeIcon />} label="Observe" />
        <ActionButton icon={<DetachIcon />} label="Detach" />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <ActionButton accent icon={<RematerializeIcon />} label="Rematerialize" />
      <ActionButton icon={<AttachIcon />} label="Attach" />
    </div>
  );
}

function CommandBlock({ surface }: { surface: TerminalSurface }) {
  const attach = surface.attachCommand.join(" ");
  const observe = surface.observeCommand?.join(" ") ?? null;
  return (
    <div className="mt-3 overflow-hidden rounded-[6px] border border-studio-edge bg-studio-canvas-alt">
      <CommandRow label="attach" command={attach} />
      {observe ? (
        <div className="border-t border-studio-edge">
          <CommandRow label="observe" command={observe} />
        </div>
      ) : (
        <div className="border-t border-studio-edge px-3 py-2 font-mono text-[9px] text-studio-ink-faint">
          observe · {surface.backend === "tmux" ? "read-only relay mode" : "—"}
        </div>
      )}
      {surface.socketDir ? (
        <div className="border-t border-studio-edge px-3 py-1.5 font-mono text-[8.5px] text-studio-ink-faint">
          ZELLIJ_SOCKET_DIR pinned to {surface.socketDir} — relays must preserve it
        </div>
      ) : null}
    </div>
  );
}

function CommandRow({ label, command }: { label: string; command: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className="w-[52px] shrink-0 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        {label}
      </span>
      <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-studio-ink-muted">
        {command}
      </code>
      <CopyButton value={command} />
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }}
      className="inline-flex h-6 shrink-0 items-center gap-1 rounded-[4px] border border-studio-edge bg-studio-canvas px-1.5 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint transition-colors hover:border-studio-edge-strong hover:text-studio-ink"
    >
      <CopyIcon />
      {copied ? "copied" : "copy"}
    </button>
  );
}

function NoSurfacePlaceholder() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink-faint">
        no active surface
      </span>
      <p className="max-w-[320px] font-sans text-[11.5px] leading-relaxed text-studio-ink-muted">
        This harness session is known and resumable. Materialize it through a
        backend to attach — the source session id stays the same.
      </p>
      <div className="flex items-center gap-1.5">
        <ActionButton accent icon={<MaterializeIcon />} label="Materialize tmux" />
        <ActionButton accent icon={<MaterializeIcon />} label="Materialize Zellij" />
      </div>
    </div>
  );
}

/* ── Right rail: resume context + backend capabilities ──────────────── */

function ContextRail({
  session,
  activeSurface,
}: {
  session: HarnessSession;
  activeSurface: TerminalSurface | null;
}) {
  return (
    <aside className="flex min-h-0 flex-col bg-studio-surface">
      <RailHeader title="context" count={session.surfaces.length} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-3">
        <section>
          <MiniHeader label="resume context" />
          <div className="mt-2 grid gap-1.5">
            <FactLine label="harness" value={session.harness} />
            <FactLine label="source id" value={session.sourceSessionId} />
            <FactLine label="cwd" value={session.cwd} />
            <FactLine label="resume" value={session.resumeCommand} />
          </div>
        </section>

        <Divider />

        <section>
          <MiniHeader label="surfaces" />
          <div className="mt-2 flex flex-col gap-2">
            {session.surfaces.length === 0 ? (
              <p className="font-sans text-[10.5px] leading-snug text-studio-ink-faint">
                None materialized. The session persists as a resumable record
                with no terminal attached.
              </p>
            ) : (
              session.surfaces.map((surface) => (
                <SurfaceRow
                  key={surface.id}
                  surface={surface}
                  active={activeSurface?.id === surface.id}
                />
              ))
            )}
          </div>
        </section>

        <Divider />

        <section>
          <MiniHeader label="backend capabilities" />
          <div className="mt-2 flex flex-col gap-1.5">
            <CapabilityRow
              backend="tmux"
              attach="tmux attach -t <name>"
              observe="read-only relay mode"
            />
            <CapabilityRow
              backend="zellij"
              attach="zellij attach <name>"
              observe="zellij watch <name>"
              note="needs ZELLIJ_SOCKET_DIR"
            />
          </div>
        </section>
      </div>
    </aside>
  );
}

function SurfaceRow({
  surface,
  active,
}: {
  surface: TerminalSurface;
  active: boolean;
}) {
  return (
    <div
      className={[
        "rounded-[5px] border bg-studio-canvas-alt p-2.5",
        active
          ? "border-[color-mix(in_oklab,var(--scout-accent)_38%,transparent)]"
          : "border-studio-edge",
      ].join(" ")}
    >
      <div className="flex items-baseline gap-2">
        <SurfaceBadge surface={surface} />
        <span
          className="font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow"
          style={{ color: surfaceStateColor(surface.state) }}
        >
          {surface.state}
        </span>
        <span className="ml-auto font-mono text-[8.5px] text-studio-ink-faint">
          {surface.updated}
        </span>
      </div>
      <div className="mt-1 truncate font-mono text-[9px] text-studio-ink-faint">
        {surface.sessionName}
        {surface.paneId ? ` · ${surface.paneId}` : ""}
      </div>
      {surface.note ? (
        <div className="mt-1 font-sans text-[9.5px] leading-snug text-studio-ink-faint">
          {surface.note}
        </div>
      ) : null}
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {surface.state === "live" ? (
          <>
            <SmallAction label="Attach" accent />
            <SmallAction label="Detach" />
          </>
        ) : (
          <>
            <SmallAction label="Rematerialize" accent />
            <SmallAction label="Copy cmd" />
          </>
        )}
      </div>
    </div>
  );
}

function CapabilityRow({
  backend,
  attach,
  observe,
  note,
}: {
  backend: TerminalBackend;
  attach: string;
  observe: string;
  note?: string;
}) {
  return (
    <div className="rounded-[5px] border border-studio-edge bg-studio-canvas-alt px-2.5 py-2">
      <div className="flex items-center gap-2">
        <BackendLabel backend={backend} />
        {note ? (
          <span className="ml-auto font-mono text-[8px] uppercase tracking-eyebrow text-studio-ink-faint">
            {note}
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 grid grid-cols-[52px_1fr] gap-x-2 gap-y-0.5 font-mono text-[9px]">
        <span className="uppercase tracking-eyebrow text-studio-ink-faint">attach</span>
        <span className="truncate text-studio-ink-muted">{attach}</span>
        <span className="uppercase tracking-eyebrow text-studio-ink-faint">observe</span>
        <span className="truncate text-studio-ink-muted">{observe}</span>
      </div>
    </div>
  );
}

/* ── Bottom: materialize a surface ──────────────────────────────────── */

function MaterializeDock({ session }: { session: HarnessSession }) {
  return (
    <div className="border-t border-studio-edge bg-studio-canvas-alt px-3 py-3">
      <div className="grid gap-2 xl:grid-cols-[184px_1fr_1fr_auto_auto] xl:items-center">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-full border border-studio-edge bg-studio-canvas text-scout-accent">
            <MaterializeIcon />
          </span>
          <div>
            <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink">
              materialize surface
            </div>
            <div className="font-mono text-[8.5px] text-studio-ink-faint">
              same source id
            </div>
          </div>
        </div>
        <DockField label="session" value={session.sourceSessionId} />
        <DockField label="cwd" value={session.cwd} />
        <BackendToggle />
        <button
          type="button"
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[5px] border border-studio-edge-strong bg-studio-canvas px-4 font-mono text-[9.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-muted transition-colors hover:border-[color-mix(in_oklab,var(--scout-accent)_42%,transparent)] hover:text-scout-accent"
        >
          <MaterializeIcon />
          Materialize
        </button>
      </div>
    </div>
  );
}

function BackendToggle() {
  const [backend, setBackend] = useState<TerminalBackend>("zellij");
  return (
    <div className="grid h-9 grid-cols-2 overflow-hidden rounded-[5px] border border-studio-edge bg-studio-canvas">
      {(["tmux", "zellij"] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setBackend(option)}
          className={[
            "font-mono text-[9px] font-semibold uppercase tracking-eyebrow transition-colors",
            backend === option
              ? "bg-scout-accent-soft text-scout-accent"
              : "text-studio-ink-faint hover:text-studio-ink-muted",
          ].join(" ")}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function DockField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid h-9 grid-cols-[64px_1fr] items-center rounded-[5px] border border-studio-edge bg-studio-canvas px-2">
      <span className="font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        {label}
      </span>
      <span className="truncate text-right font-mono text-[10px] text-studio-ink">
        {value}
      </span>
    </div>
  );
}

/* ── Shared primitives ──────────────────────────────────────────────── */

function RailHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center justify-between border-b border-studio-edge px-3 py-2.5">
      <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        {title}
      </span>
      <span className="rounded-[2px] border border-studio-edge bg-studio-canvas px-1.5 py-px font-mono text-[9px] tabular-nums text-studio-ink-muted">
        {count}
      </span>
    </div>
  );
}

function ListEyebrow({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center justify-between border-b border-studio-edge bg-studio-canvas px-3 py-1.5">
      <span className="font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        {label}
      </span>
      <span className="font-mono text-[8.5px] tabular-nums text-studio-ink-faint">
        {count}
      </span>
    </div>
  );
}

function MetaCell({
  label,
  value,
  subtle,
  wide,
}: {
  label: string;
  value: string;
  subtle?: boolean;
  wide?: boolean;
}) {
  return (
    <div
      className={[
        "min-w-0 border-r border-studio-edge px-3 py-2 last:border-r-0",
        wide ? "md:col-span-1" : "",
      ].join(" ")}
    >
      <div className="font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        {label}
      </div>
      <div
        className={[
          "mt-0.5 truncate font-mono text-[10px]",
          subtle ? "text-studio-ink-faint" : "text-studio-ink-muted",
        ].join(" ")}
      >
        {value}
      </div>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  accent,
}: {
  icon: ReactNode;
  label: string;
  accent?: boolean;
}) {
  return (
    <button
      type="button"
      className={[
        "inline-flex h-8 items-center gap-1.5 rounded-[5px] border px-2.5 font-mono text-[9px] font-semibold uppercase tracking-eyebrow transition-colors",
        accent
          ? "border-[color-mix(in_oklab,var(--scout-accent)_42%,transparent)] bg-scout-accent-soft text-scout-accent"
          : "border-studio-edge bg-studio-canvas-alt text-studio-ink-muted hover:border-studio-edge-strong hover:text-studio-ink",
      ].join(" ")}
    >
      <span className="grid h-3 w-3 place-items-center">{icon}</span>
      {label}
    </button>
  );
}

function SmallAction({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <button
      type="button"
      className={[
        "h-7 rounded-[4px] border font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow transition-colors",
        accent
          ? "border-[color-mix(in_oklab,var(--scout-accent)_42%,transparent)] bg-scout-accent-soft text-scout-accent"
          : "border-studio-edge bg-studio-canvas text-studio-ink-muted hover:text-studio-ink",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function HarnessBadge({ harness }: { harness: HarnessKind }) {
  return (
    <span className="rounded-[2px] border border-studio-edge bg-studio-canvas px-1.5 py-px font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-muted">
      {harness}
    </span>
  );
}

function SurfaceBadge({ surface }: { surface: TerminalSurface }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-[2px] border border-studio-edge bg-studio-canvas px-1.5 py-px font-mono text-[8px] font-semibold uppercase tracking-eyebrow text-studio-ink-muted">
      <span
        className="inline-block h-1 w-1 rounded-full"
        style={{ background: surfaceStateColor(surface.state) }}
      />
      {surface.backend}
    </span>
  );
}

function BackendLabel({ backend }: { backend: TerminalBackend }) {
  return (
    <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-muted">
      {backend}
    </span>
  );
}

function MiniHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-3 w-[2px] rounded-sm bg-scout-accent" />
      <span className="font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        {label}
      </span>
    </div>
  );
}

function FactLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[58px_1fr] items-baseline gap-2 font-mono text-[9.5px]">
      <span className="uppercase tracking-eyebrow text-studio-ink-faint">
        {label}
      </span>
      <span className="truncate text-right text-studio-ink-muted">{value}</span>
    </div>
  );
}

function SurfaceStateDot({
  state,
  strong,
}: {
  state: SurfaceState;
  strong?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={[
        "inline-block shrink-0 translate-y-[-1px] rounded-full",
        strong ? "h-2 w-2" : "h-1.5 w-1.5",
      ].join(" ")}
      style={{
        background: surfaceStateColor(state),
        boxShadow:
          state === "live" && strong
            ? "0 0 0 3px color-mix(in oklab, var(--status-ok-fg) 12%, transparent)"
            : undefined,
      }}
    />
  );
}

function MetaDot() {
  return (
    <span
      aria-hidden
      className="inline-block h-[2px] w-[2px] rounded-full"
      style={{ background: "var(--studio-ink-faint)" }}
    />
  );
}

function Divider() {
  return <div className="h-px bg-studio-edge" />;
}

function TerminalLine({
  children,
  tone = "default",
}: {
  children: string;
  tone?: "default" | "muted" | "accent";
}) {
  const color =
    tone === "accent"
      ? "var(--scout-accent)"
      : tone === "muted"
        ? "color-mix(in oklab, #c7e7cd 38%, transparent)"
        : undefined;
  return (
    <span className="block" style={{ color }}>
      {children}
    </span>
  );
}

function TerminalCursor() {
  return (
    <span
      aria-hidden
      className="mt-2 block h-[15px] w-[7px]"
      style={{ background: "var(--scout-accent)" }}
    />
  );
}

function surfaceStateColor(state: SurfaceState): string {
  switch (state) {
    case "live":
      return "var(--status-ok-fg)";
    case "detached":
      return "var(--status-warn-fg)";
    case "exited":
    default:
      return "var(--studio-ink-faint)";
  }
}

function EyeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M1.5 8S3.8 3.5 8 3.5 14.5 8 14.5 8 12.2 12.5 8 12.5 1.5 8 1.5 8Z" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function AttachIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M6.5 9.5 4 12a2.1 2.1 0 0 1-3-3l2.5-2.5M9.5 6.5 12 4a2.1 2.1 0 0 1 3 3l-2.5 2.5M6 10l4-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function DetachIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M6.5 9.5 4.5 11.5M9.5 6.5l2-2M5.5 5.5 3 3M3 8.5 2 9.5M13 6.5 14 5.5M10.5 10.5 13 13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function RematerializeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M13 8a5 5 0 1 1-1.5-3.5M13 2v3h-3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MaterializeIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 2v12M2 8h12M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3.5 10.5h-1V3a.5.5 0 0 1 .5-.5h7v1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
