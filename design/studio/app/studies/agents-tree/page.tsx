"use client";

/**
 * Agents Tree — study (macOS Agents view).
 *
 * The native Agents view is currently a flat grid of agent cards: every
 * agent is a peer and the only grouping signal (the workspace path) is
 * buried inside each tile. But the fleet already *is* a hierarchy —
 * several agents share one repo. This study makes the structure the
 * layout: a single-column tree with the platform's real information
 * architecture —
 *
 *     project  →  agent  →  session
 *
 * — driven by the inspector on the right, and built to be flown entirely
 * from the keyboard (vim-tree muscle memory). The card body doesn't
 * disappear: it relocates into the inspector, which slaves to the cursor.
 *
 * Embellishments from the broader thread live *inside* the tree rather
 * than decorating it: the working-dot pulse, settling numerals on the
 * live age, a soft fold spring on the disclosure, and the lime
 * baseline-rule selection from the active nav tab.
 *
 * Ports to: apps/macos/Sources/Scout/ScoutRootView.swift (AgentsView) +
 * the trailing inspector panel.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AGENT_STATE_COLOR,
  type AgentState,
} from "@/components/AgentPresenceDot";
import { SpriteAvatar } from "@/components/SpriteAvatar";

// ── Data model ───────────────────────────────────────────────────────

interface Session {
  id: string;
  cId: string;
  label: string;
  state: AgentState;
  age: string;
  live?: boolean;
}

interface Agent {
  id: string;
  name: string;
  handle: string;
  role: string;
  harness: string;
  transport: string;
  model: string;
  branch: string;
  node: string;
  state: AgentState;
  age: string;
  live?: boolean;
  sessions: Session[];
}

interface Project {
  id: string;
  name: string;
  path: string;
  agents: Agent[];
}

const NODE = "Arts-Mac-mini.local";

// Mirrors the fleet in the live app screenshots: 13 agents, 11 repos.
const PROJECTS: Project[] = [
  {
    id: "openscout",
    name: "openscout",
    path: "~/dev/openscout",
    agents: [
      {
        id: "openscout",
        name: "Openscout",
        handle: "openscout.fea…mac-mini-local",
        role: "Relay agent",
        harness: "codex",
        transport: "codex_app_server",
        model: "Default",
        branch: "feat/web-design-system",
        node: NODE,
        state: "working",
        age: "1h 52m",
        live: true,
        sessions: [
          {
            id: "relay-op…odex",
            cId: "24e88778",
            label: "codex route smoke",
            state: "working",
            age: "1h 52m",
            live: true,
          },
          {
            id: "relay-op…7afb",
            cId: "af7eb62f",
            label: "blocker report",
            state: "idle",
            age: "2h 04m",
          },
        ],
      },
      {
        id: "openscout-card-0",
        name: "Openscout Card 0",
        handle: "openscout-card-0-mdffar.f_system",
        role: "Relay agent",
        harness: "codex",
        transport: "codex_app_server",
        model: "Default",
        branch: "feat/web-design-system",
        node: NODE,
        state: "available",
        age: "1h 53m",
        sessions: [
          {
            id: "relay-op…odex",
            cId: "a2659dfd",
            label: "active",
            state: "available",
            age: "1h 53m",
          },
        ],
      },
      {
        id: "scout",
        name: "Scout",
        handle: "scoutbot.arts-mac-mini-local",
        role: "operator-assistant",
        harness: "codex",
        transport: "codex_app_server",
        model: "Default",
        branch: "—",
        node: NODE,
        state: "available",
        age: "1h 23m",
        sessions: [
          {
            id: "scoutbot…main",
            cId: "c037c36f",
            label: "idle, ready to dispatch",
            state: "idle",
            age: "1h 23m",
          },
        ],
      },
    ],
  },
  {
    id: "talkie",
    name: "talkie",
    path: "~/dev/talkie",
    agents: [
      {
        id: "talkie",
        name: "Talkie",
        handle: "talkie.codex-…mac-mini-local",
        role: "Relay agent",
        harness: "claude",
        transport: "tmux",
        model: "Default",
        branch: "codex/top-band-study",
        node: NODE,
        state: "needs-attention",
        age: "5h 04m",
        sessions: [
          {
            id: "talkie…band",
            cId: "21f00c9c",
            label: "product/spec synthesis lane",
            state: "needs-attention",
            age: "5h 04m",
          },
        ],
      },
    ],
  },
  {
    id: "usetalkie.com",
    name: "usetalkie.com",
    path: "~/dev/usetalkie.com",
    agents: [
      {
        id: "usetalkie-com",
        name: "Usetalkie Com",
        handle: "usetalkie-com…mac-mini-local",
        role: "Relay agent",
        harness: "claude",
        transport: "tmux",
        model: "Default",
        branch: "main",
        node: NODE,
        state: "available",
        age: "1h 23m",
        sessions: [
          {
            id: "usetalkie…com",
            cId: "9f31ad20",
            label: "idle",
            state: "idle",
            age: "1h 23m",
          },
        ],
      },
    ],
  },
  {
    id: "lattices",
    name: "lattices",
    path: "~/dev/lattices",
    agents: [
      {
        id: "lattices",
        name: "Lattices",
        handle: "lattices.work.mac-mini-local",
        role: "Relay agent",
        harness: "claude",
        transport: "claude_stream_json",
        model: "Default",
        branch: "work/sck-window-capture",
        node: NODE,
        state: "available",
        age: "1h 23m",
        sessions: [
          {
            id: "lattices…cap",
            cId: "6dc7a3cc",
            label: "migrated, no commit made",
            state: "idle",
            age: "3h 03m",
          },
        ],
      },
    ],
  },
  {
    id: "action",
    name: "action",
    path: "~/dev/action",
    agents: [
      {
        id: "action",
        name: "Action",
        handle: "action.codex-…mac-mini-local",
        role: "Relay agent",
        harness: "claude",
        transport: "claude_stream_json",
        model: "Default",
        branch: "codex/polished-mira-demo",
        node: NODE,
        state: "available",
        age: "1h 53m",
        sessions: [
          {
            id: "action…demo",
            cId: "b81c4e07",
            label: "idle",
            state: "idle",
            age: "1h 53m",
          },
        ],
      },
    ],
  },
  ...["dewey", "hudson", "iris", "pi-scout", "preframe", "premotion"].map(
    (name): Project => {
      const branch =
        name === "iris" ? "—" : name === "premotion" ? "master" : "main";
      return {
        id: name,
        name,
        path: `~/dev/${name}`,
        agents: [
          {
            id: name,
            name: name
              .split("-")
              .map((p) => p[0]!.toUpperCase() + p.slice(1))
              .join(" "),
            handle: `${name}.main.mac-mini-local`,
            role: "Relay agent",
            harness: "claude",
            transport: "claude_stream_json",
            model: "Default",
            branch,
            node: NODE,
            state: "available",
            age: "1h 53m",
            sessions: [
              {
                id: `${name}…main`,
                cId: "00000000",
                label: "idle",
                state: "idle",
                age: "1h 53m",
              },
            ],
          },
        ],
      };
    }
  ),
];

const STATE_LABEL: Record<AgentState, string> = {
  working: "working",
  "needs-attention": "needs attn",
  available: "available",
  idle: "idle",
  offline: "offline",
  error: "error",
};

// The only state that earns a signal: an agent actively alive on the work.
const isLiveState = (s: AgentState) =>
  s === "working" || s === "needs-attention";

// Calm by default; accent only where an operator must look.
function stateLabelColor(state: AgentState): string {
  if (isLiveState(state)) return "var(--scout-accent)";
  if (state === "available") return "var(--studio-ink-muted)";
  return "var(--studio-ink-faint)";
}

// ── Flatten the tree into the visible-row list nav walks ─────────────

type Row =
  | { kind: "project"; key: string; depth: 0; project: Project; live: number }
  | { kind: "agent"; key: string; depth: 1; project: Project; agent: Agent }
  | {
      kind: "session";
      key: string;
      depth: 2;
      project: Project;
      agent: Agent;
      session: Session;
    };

const pKey = (p: Project) => `p:${p.id}`;
const aKey = (a: Agent) => `a:${a.id}`;
const sKey = (a: Agent, s: Session) => `s:${a.id}:${s.id}:${s.cId}`;

const norm = (s: string | undefined) => (s ?? "").toLowerCase();
const liveCount = (p: Project) =>
  p.agents.filter(
    (a) => a.state === "working" || a.state === "needs-attention"
  ).length;

function sessionMatch(s: Session, f: string) {
  return norm(s.id).includes(f) || norm(s.cId).includes(f) || norm(s.label).includes(f);
}
function agentSelfMatch(a: Agent, f: string) {
  return [a.name, a.branch, a.role, a.harness, a.transport].some((x) =>
    norm(x).includes(f)
  );
}
function agentMatch(a: Agent, f: string) {
  return agentSelfMatch(a, f) || a.sessions.some((s) => sessionMatch(s, f));
}
function projectMatch(p: Project, f: string) {
  return (
    norm(p.name).includes(f) ||
    norm(p.path).includes(f) ||
    p.agents.some((a) => agentMatch(a, f))
  );
}

function buildRows(expanded: Set<string>, filter: string): Row[] {
  const f = filter.trim().toLowerCase();
  const rows: Row[] = [];
  for (const project of PROJECTS) {
    if (f && !projectMatch(project, f)) continue;
    rows.push({
      kind: "project",
      key: pKey(project),
      depth: 0,
      project,
      live: liveCount(project),
    });
    const projOpen = f ? true : expanded.has(pKey(project));
    if (!projOpen) continue;
    for (const agent of project.agents) {
      if (f && !agentMatch(agent, f)) continue;
      rows.push({ kind: "agent", key: aKey(agent), depth: 1, project, agent });
      const agentOpen = f ? true : expanded.has(aKey(agent));
      if (!agentOpen) continue;
      const showAll = !f || agentSelfMatch(agent, f);
      for (const session of agent.sessions) {
        if (!showAll && !sessionMatch(session, f)) continue;
        rows.push({
          kind: "session",
          key: sKey(agent, session),
          depth: 2,
          project,
          agent,
          session,
        });
      }
    }
  }
  return rows;
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

// ── Live numerals — the "settling" embellishment ─────────────────────

function SettleNum({ value }: { value: string }) {
  const [k, setK] = useState(0);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      setK((x) => x + 1);
    }
  }, [value]);
  return (
    <span
      key={k}
      className="inline-block tabular-nums"
      style={{ animation: "at-settle 150ms cubic-bezier(.16,1,.3,1)" }}
    >
      {value}
    </span>
  );
}

function StateDot({ state, size = 7 }: { state: AgentState; size?: number }) {
  const color = AGENT_STATE_COLOR[state];
  const live = state === "working" || state === "needs-attention";
  return (
    <span
      aria-label={STATE_LABEL[state]}
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: color,
        animation: live ? "at-pulse 1.9s ease-in-out infinite" : undefined,
      }}
    />
  );
}

// ── Page-header atoms — the identity-bar vocabulary every main surface
//    shares (lifted from the native Repos header: title · Live · counts) ──

function LivePill() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-studio-edge px-1.5 py-[1px] font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-muted">
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{
          background: "var(--scout-accent)",
          boxShadow:
            "0 0 0 2px color-mix(in oklab, var(--scout-accent) 22%, transparent)",
        }}
      />
      Live
    </span>
  );
}

function HeadCount({
  n,
  label,
  tone,
}: {
  n: React.ReactNode;
  label: string;
  tone?: string;
}) {
  return (
    <span className="inline-flex shrink-0 items-baseline gap-1">
      <span
        className="font-mono text-[12px] font-semibold tabular-nums"
        style={{ color: tone ?? "var(--studio-ink)" }}
      >
        {n}
      </span>
      <span className="font-sans text-[11px] text-studio-ink-faint">{label}</span>
    </span>
  );
}

// ── Page ─────────────────────────────────────────────────────────────

export default function AgentsTreePage() {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set([...PROJECTS.map(pKey), aKey(PROJECTS[0]!.agents[0]!)])
  );
  const [filter, setFilter] = useState("");
  const [selectedKey, setSelectedKey] = useState<string>(
    aKey(PROJECTS[0]!.agents[0]!)
  );
  const [flash, setFlash] = useState<string | null>(null);

  const rows = useMemo(() => buildRows(expanded, filter), [expanded, filter]);
  const selIndex = Math.max(
    0,
    rows.findIndex((r) => r.key === selectedKey)
  );
  const selRow = rows[selIndex];

  // Keep selection valid as rows appear/disappear (filter, collapse).
  useEffect(() => {
    if (rows.length && !rows.some((r) => r.key === selectedKey)) {
      setSelectedKey(rows[clamp(selIndex, 0, rows.length - 1)]!.key);
    }
  }, [rows, selectedKey, selIndex]);

  // Live tick — drives the settling numeral on working rows.
  const [sec, setSec] = useState(7);
  useEffect(() => {
    const t = setInterval(() => setSec((s) => (s + 1) % 60), 1000);
    return () => clearInterval(t);
  }, []);
  const liveAge = (base: string) => {
    const m = base.match(/(\d+)m/);
    return `${m ? m[1] : "0"}m ${String(sec).padStart(2, "0")}s`;
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowEls = useRef<Record<string, HTMLElement | null>>({});
  const pending = useRef<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    rowEls.current[selectedKey]?.scrollIntoView({ block: "nearest" });
  }, [selectedKey]);

  const doFlash = useCallback((msg: string) => {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1700);
  }, []);

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const collapsibleKey = (r: Row | undefined): string | null =>
    r?.kind === "project" ? pKey(r.project) : r?.kind === "agent" ? aKey(r.agent) : null;
  const parentKey = (r: Row | undefined): string | null =>
    r?.kind === "session" ? aKey(r.agent) : r?.kind === "agent" ? pKey(r.project) : null;

  const select = useCallback(
    (i: number) => {
      const r = rows[clamp(i, 0, rows.length - 1)];
      if (r) setSelectedKey(r.key);
    },
    [rows]
  );

  const activate = useCallback(
    (r: Row | undefined) => {
      if (!r) return;
      if (r.kind === "project") toggle(pKey(r.project));
      else if (r.kind === "agent") doFlash(`↵   Open DM · ${r.agent.name}`);
      else doFlash(`↵   Observe · ${r.agent.name} · ${r.session.id}`);
    },
    [toggle, doFlash]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      const k = e.key;

      // two-key chords (gg / zM / zR)
      if (pending.current === "g") {
        pending.current = null;
        if (k === "g") {
          e.preventDefault();
          select(0);
        }
        return;
      }
      if (pending.current === "z") {
        pending.current = null;
        if (k === "M") {
          e.preventDefault();
          setExpanded(new Set());
        } else if (k === "R") {
          e.preventDefault();
          setExpanded(
            new Set([
              ...PROJECTS.map(pKey),
              ...PROJECTS.flatMap((p) => p.agents.map(aKey)),
            ])
          );
        }
        return;
      }

      switch (k) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          select(selIndex + 1);
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          select(selIndex - 1);
          break;
        case "l":
        case "ArrowRight": {
          e.preventDefault();
          const ck = collapsibleKey(selRow);
          if (ck && !filter && !expanded.has(ck)) toggle(ck);
          else select(selIndex + 1);
          break;
        }
        case "h":
        case "ArrowLeft": {
          e.preventDefault();
          const ck = collapsibleKey(selRow);
          if (ck && !filter && expanded.has(ck)) {
            toggle(ck);
          } else {
            const par = parentKey(selRow);
            const pi = par ? rows.findIndex((r) => r.key === par) : -1;
            if (pi >= 0) setSelectedKey(rows[pi]!.key);
          }
          break;
        }
        case "Enter":
        case "o":
          e.preventDefault();
          activate(selRow);
          break;
        case " ": {
          e.preventDefault();
          const ck = collapsibleKey(selRow);
          if (ck && !filter) toggle(ck);
          break;
        }
        case "i":
          e.preventDefault();
          if (selRow) doFlash(`inspect · ${rowTitle(selRow)}`);
          break;
        case "O":
          e.preventDefault();
          if (selRow) doFlash(`observe · ${rowTitle(selRow)}`);
          break;
        case "n":
          e.preventDefault();
          if (selRow) doFlash(`new session · ${selRow.project.name}`);
          break;
        case "/":
          e.preventDefault();
          inputRef.current?.focus();
          break;
        case "{":
        case "}":
        case "[":
        case "]": {
          e.preventDefault();
          const dir = k === "{" || k === "[" ? -1 : 1;
          const projRows = rows
            .map((r, idx) => ({ r, idx }))
            .filter((x) => x.r.kind === "project");
          const curProj = selRow?.project.id;
          const at = projRows.findIndex((x) => x.r.project.id === curProj);
          const target = projRows[clamp(at + dir, 0, projRows.length - 1)];
          if (target) setSelectedKey(target.r.key);
          break;
        }
        case "g":
        case "z":
          pending.current = k;
          break;
        case "Escape":
          if (filter) {
            e.preventDefault();
            setFilter("");
          }
          break;
        default:
          if (/^[1-9]$/.test(k)) {
            e.preventDefault();
            const projRows = rows.filter((r) => r.kind === "project");
            const target = projRows[Number(k) - 1];
            if (target) setSelectedKey(target.key);
          }
      }
    },
    [
      rows,
      selIndex,
      selRow,
      expanded,
      filter,
      select,
      toggle,
      activate,
      doFlash,
    ]
  );

  const total = PROJECTS.reduce((n, p) => n + p.agents.length, 0);
  const working = PROJECTS.reduce((n, p) => n + liveCount(p), 0);

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <style>{STYLES}</style>

      <header className="mb-7 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · macos · agents-tree
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Agents tree
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The Agents view, reshaped from a flat card grid into the fleet&rsquo;s
          real hierarchy — <span className="text-studio-ink-muted">project · agent · session</span>.
          The inspector slaves to the cursor; the whole tree flies from the
          keyboard. Click in and try <Kbd>j</Kbd>/<Kbd>k</Kbd>,{" "}
          <Kbd>h</Kbd>/<Kbd>l</Kbd>, <Kbd>/</Kbd>, <Kbd>g g</Kbd>/<Kbd>G</Kbd>.
        </p>
      </header>

      {/* Mock app window: tree + inspector */}
      <div className="flex overflow-hidden rounded-lg border border-studio-edge bg-studio-canvas-alt shadow-[0_18px_50px_-20px_rgba(0,0,0,0.6)]">
        {/* Tree column */}
        <div className="flex min-w-0 flex-1 flex-col border-r border-studio-edge">
          {/* Page header — the identity bar every main surface speaks:
              title · Live · counts | filter. Ported from the native Repos
              header so Agents reads as the same system. */}
          <div className="flex items-center gap-3 border-b border-studio-edge px-3 py-2">
            <span className="shrink-0 font-sans text-[14px] font-semibold leading-none text-studio-ink">
              Agents
            </span>
            <LivePill />
            <span className="flex items-center gap-3">
              <HeadCount n={PROJECTS.length} label="repos" />
              <HeadCount n={total} label="agents" />
              {working ? (
                <HeadCount
                  n={working}
                  label="live"
                  tone="var(--scout-accent)"
                />
              ) : null}
            </span>
            <div className="relative ml-auto w-[230px]">
              <input
                ref={inputRef}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setFilter("");
                    containerRef.current?.focus();
                  } else if (e.key === "Enter" || e.key === "ArrowDown") {
                    e.preventDefault();
                    containerRef.current?.focus();
                  }
                }}
                placeholder="Filter projects · agents · sessions"
                className="focus-ring w-full rounded-[4px] border border-studio-edge bg-studio-canvas px-2 py-1 font-mono text-[11px] text-studio-ink placeholder:text-studio-ink-faint"
              />
              {!filter ? (
                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-studio-ink-faint">
                  /
                </span>
              ) : null}
            </div>
          </div>

          {/* Column header — the spine label + the trailing UPDATED column,
              mirroring the Repos table head so the timestamps read as a column.
              pl-[30px] aligns the spine under the project name (8 base + 14
              chevron + 8 gap); pr-3 + w-[68px] aligns UPDATED over the Age cell. */}
          <div className="flex items-center border-b border-studio-edge py-1 pl-[30px] pr-3 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            <span>Project · Agent · Session</span>
            <span className="ml-auto w-[68px] text-right">Updated</span>
          </div>

          {/* Rows */}
          <div
            ref={containerRef}
            tabIndex={0}
            onKeyDown={onKeyDown}
            className="relative max-h-[560px] min-h-[420px] overflow-y-auto py-1.5 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[var(--scout-accent)]"
          >
            {rows.map((row) => (
              <TreeRow
                key={row.key}
                row={row}
                selected={row.key === selectedKey}
                expanded={expanded.has(collapsibleKey(row) ?? "")}
                onSelect={() => setSelectedKey(row.key)}
                onToggle={() => {
                  const ck = collapsibleKey(row);
                  if (ck) toggle(ck);
                }}
                liveAge={liveAge}
                bindEl={(el) => (rowEls.current[row.key] = el)}
              />
            ))}
            {rows.length === 0 ? (
              <div className="px-4 py-6 font-mono text-[11px] text-studio-ink-faint">
                no matches for &ldquo;{filter}&rdquo;
              </div>
            ) : null}

            {flash ? (
              <div
                className="pointer-events-none sticky bottom-2 mx-3 mt-2 rounded-[5px] border px-3 py-1.5 font-mono text-[10.5px]"
                style={{
                  animation: "at-flash 200ms cubic-bezier(.16,1,.3,1)",
                  background: "var(--scout-accent-soft)",
                  borderColor: "color-mix(in oklab, var(--scout-accent) 40%, transparent)",
                  color: "var(--studio-ink)",
                }}
              >
                {flash}
              </div>
            ) : null}
          </div>

          {/* Footer hint, echoing the app's status bar */}
          <div className="flex items-center gap-3 border-t border-studio-edge px-3 py-1.5 font-mono text-[9px] text-studio-ink-faint">
            <span><Kbd>j</Kbd>/<Kbd>k</Kbd> move</span>
            <span><Kbd>h</Kbd>/<Kbd>l</Kbd> fold</span>
            <span><Kbd>↵</Kbd> open</span>
            <span><Kbd>/</Kbd> filter</span>
            <span className="ml-auto opacity-70">
              {selIndex + 1}/{rows.length}
            </span>
          </div>
        </div>

        {/* Inspector — slaves to selection */}
        <div className="w-[320px] shrink-0 bg-studio-canvas px-4 py-3">
          <Inspector row={selRow} liveAge={liveAge} />
        </div>
      </div>

      {/* Keyboard map */}
      <section className="mt-10 max-w-prose">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · keyboard
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 font-mono text-[11px]">
          {KEYMAP.map(([keys, action]) => (
            <div key={action} className="flex items-baseline gap-2">
              <span className="w-[88px] shrink-0 text-studio-ink">{keys}</span>
              <span className="text-studio-ink-faint">{action}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Ports to */}
      <section className="mt-10 max-w-prose">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · ports to
        </div>
        <ul className="font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
          <li>
            <code className="font-mono text-[11px] text-studio-ink">
              apps/macos/Sources/Scout/ScoutRootView.swift
            </code>{" "}
            — the Agents section + trailing inspector
          </li>
          <li>
            <code className="font-mono text-[11px] text-studio-ink">
              apps/macos/Sources/Scout/ScoutObserveSidecarPanel.swift
            </code>{" "}
            — observe / peek from a session row
          </li>
        </ul>
      </section>
    </main>
  );
}

// ── Row ──────────────────────────────────────────────────────────────

function rowTitle(r: Row): string {
  return r.kind === "project"
    ? r.project.name
    : r.kind === "agent"
      ? r.agent.name
      : r.session.id;
}

function TreeRow({
  row,
  selected,
  expanded,
  onSelect,
  onToggle,
  liveAge,
  bindEl,
}: {
  row: Row;
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggle: () => void;
  liveAge: (base: string) => string;
  bindEl: (el: HTMLElement | null) => void;
}) {
  const collapsible = row.kind !== "session";
  const padLeft = 8 + row.depth * 16;

  return (
    <div
      ref={bindEl}
      data-rowkey={row.key}
      role="treeitem"
      aria-selected={selected}
      onClick={onSelect}
      className="group relative flex cursor-pointer items-center gap-2 py-1 pr-3 transition-colors duration-75 hover:bg-studio-surface"
      style={{
        paddingLeft: padLeft,
        background: selected
          ? "color-mix(in oklab, var(--scout-accent) 10%, transparent)"
          : undefined,
        boxShadow: selected ? "inset 2px 0 0 var(--scout-accent)" : undefined,
      }}
    >
      {/* disclosure */}
      {collapsible ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="grid h-3.5 w-3.5 shrink-0 place-items-center text-studio-ink-faint hover:text-studio-ink"
          aria-label={expanded ? "collapse" : "expand"}
        >
          <span
            className="text-[9px] leading-none transition-transform duration-150"
            style={{
              transform: expanded ? "rotate(90deg)" : "none",
              transitionTimingFunction: "cubic-bezier(.16,1,.3,1)",
            }}
          >
            ▶
          </span>
        </button>
      ) : (
        <span className="h-3.5 w-3.5 shrink-0" />
      )}

      {row.kind === "project" ? (
        <>
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] font-semibold text-studio-ink">
            {row.project.name}
            <span className="ml-2 font-normal text-studio-ink-faint">
              {row.project.path}
            </span>
          </span>
          <span className="shrink-0 font-mono text-[9.5px] tabular-nums text-studio-ink-faint">
            {row.project.agents.length} agent
            {row.project.agents.length === 1 ? "" : "s"}
          </span>
          {row.live ? (
            <StateDot state="working" size={6} />
          ) : (
            <span className="h-1.5 w-1.5" />
          )}
        </>
      ) : row.kind === "agent" ? (
        <>
          {/* The creature carries identity; a live agent earns a single
              accent pulse on its shoulder — no categorical gray dot. */}
          <SpriteAvatar
            name={row.agent.name}
            size={18}
            className="shrink-0"
            corner={
              isLiveState(row.agent.state)
                ? "var(--scout-accent)"
                : undefined
            }
            cornerPulse={isLiveState(row.agent.state)}
          />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-sans text-[13px] font-medium text-studio-ink">
              {row.agent.name}
            </span>
            <span className="ml-2 font-mono text-[10px] text-studio-ink-faint">
              {row.agent.role.toLowerCase()} · {row.agent.harness}
            </span>
          </span>
          <span
            className="shrink-0 font-mono text-[9px] font-semibold uppercase tracking-eyebrow"
            style={{ color: stateLabelColor(row.agent.state) }}
          >
            {STATE_LABEL[row.agent.state]}
          </span>
          <Age age={row.agent.age} live={row.agent.live} liveAge={liveAge} />
        </>
      ) : (
        <>
          <span
            className="ml-0.5 h-1 w-1 shrink-0 rounded-full"
            style={{ background: "var(--studio-ink-faint)" }}
          />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-mono text-[11px] text-studio-ink-muted">
              {row.session.id}
            </span>
            <span className="ml-2 font-mono text-[10px] text-studio-ink-faint">
              {row.session.label}
            </span>
          </span>
          <span className="shrink-0 font-mono text-[9px] text-studio-ink-faint">
            cId {row.session.cId}
          </span>
          <Age age={row.session.age} live={row.session.live} liveAge={liveAge} />
        </>
      )}
    </div>
  );
}

function Age({
  age,
  live,
  liveAge,
}: {
  age: string;
  live?: boolean;
  liveAge: (base: string) => string;
}) {
  return (
    <span className="w-[68px] shrink-0 text-right font-mono text-[10px] tabular-nums text-studio-ink-faint">
      {live ? <SettleNum value={liveAge(age)} /> : age}
    </span>
  );
}

// ── Inspector ────────────────────────────────────────────────────────

function ISection({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4 first:mt-0">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-[2px] bg-studio-edge-strong" />
          <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            {title}
          </span>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function IRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <span className="shrink-0 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        {label}
      </span>
      <span className="truncate text-right font-mono text-[11px] text-studio-ink">
        {value}
      </span>
    </div>
  );
}

function Inspector({
  row,
  liveAge,
}: {
  row: Row | undefined;
  liveAge: (base: string) => string;
}) {
  if (!row) return null;

  if (row.kind === "project") {
    const p = row.project;
    return (
      <div>
        <div className="mb-3 flex items-center justify-between">
          <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            Project
          </span>
        </div>
        <div className="font-mono text-[15px] font-semibold text-studio-ink">
          {p.name}
        </div>
        <div className="mt-0.5 font-mono text-[10px] text-studio-ink-faint">
          {p.path}
        </div>
        <ISection title="Fleet">
          <IRow label="Agents" value={String(p.agents.length)} />
          <IRow label="Live" value={String(row.live)} />
        </ISection>
        <ISection title="Agents">
          <div className="flex flex-col gap-1.5">
            {p.agents.map((a) => (
              <div key={a.id} className="flex items-center gap-2">
                <StateDot state={a.state} size={6} />
                <span className="min-w-0 flex-1 truncate font-sans text-[12px] text-studio-ink">
                  {a.name}
                </span>
                <span className="font-mono text-[9px] text-studio-ink-faint">
                  {a.branch}
                </span>
              </div>
            ))}
          </div>
        </ISection>
      </div>
    );
  }

  const a = row.kind === "agent" ? row.agent : row.agent;
  const activeSession =
    row.kind === "session"
      ? row.session
      : a.sessions.find((s) => s.live) ?? a.sessions[0];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          Agent
        </span>
        <span
          className="rounded-[3px] px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-[0.18em]"
          style={{
            color: stateLabelColor(a.state),
            background: "color-mix(in oklab, currentColor 14%, transparent)",
          }}
        >
          {STATE_LABEL[a.state].toUpperCase()}
        </span>
      </div>

      <div className="flex items-center gap-2.5">
        <span
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full font-mono text-[12px]"
          style={{ background: "oklch(0.42 0.008 80)", color: "var(--studio-canvas)" }}
        >
          {a.name[0]}
        </span>
        <div className="min-w-0">
          <div className="truncate font-sans text-[14px] font-semibold text-studio-ink">
            {a.name}
          </div>
          <div className="truncate font-mono text-[9px] text-studio-ink-faint">
            {a.handle}
          </div>
        </div>
      </div>

      <ISection title="Runtime">
        <IRow label="Role" value={a.role} />
        <IRow label="Harness" value={a.harness} />
        <IRow label="Transport" value={a.transport} />
        <IRow label="Model" value={a.model} />
        <IRow label="Node" value={a.node} />
      </ISection>

      <ISection title="Workspace">
        <IRow label="Branch" value={a.branch} />
        <IRow label="Path" value={row.project.path} />
        <IRow label="cId" value={`cId ${activeSession?.cId ?? "—"}`} />
      </ISection>

      <ISection
        title="Session"
        action={
          <button className="focus-ring font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint hover:text-studio-ink">
            ◎ Observe
          </button>
        }
      >
        {row.kind === "session" ? (
          <>
            <IRow label="Id" value={row.session.id} />
            <IRow label="State" value={STATE_LABEL[row.session.state]} />
            <IRow
              label="Active"
              value={
                row.session.live ? (
                  <SettleNum value={liveAge(row.session.age)} />
                ) : (
                  row.session.age
                )
              }
            />
          </>
        ) : (
          <>
            <IRow label="Id" value={activeSession?.id ?? "—"} />
            <IRow
              label="Active"
              value={
                activeSession?.live ? (
                  <SettleNum value={liveAge(activeSession.age)} />
                ) : (
                  activeSession?.age ?? "—"
                )
              }
            />
            <button className="focus-ring mt-1.5 font-mono text-[10px] text-studio-ink-faint hover:text-studio-ink">
              + New session
            </button>
          </>
        )}
      </ISection>
    </div>
  );
}

// ── Atoms / static ───────────────────────────────────────────────────

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-[3px] border border-studio-edge bg-studio-canvas px-1 py-px font-mono text-[10px] text-studio-ink-muted">
      {children}
    </kbd>
  );
}

const KEYMAP: [string, string][] = [
  ["j / k  ↓ ↑", "move through visible rows"],
  ["l / →", "expand, or descend to first child"],
  ["h / ←", "collapse, or jump to parent"],
  ["↵ / o", "activate — Open DM / Observe"],
  ["space", "toggle fold"],
  ["i · O · n", "Inspect · Observe · New session"],
  ["/", "filter; tree auto-expands to matches"],
  ["{ } / [ ]", "previous / next project"],
  ["1 – 9", "jump to Nth project"],
  ["g g / G", "top / bottom"],
  ["z M / z R", "collapse all / expand all"],
  ["esc", "clear filter"],
];

const STYLES = `
@keyframes at-settle {
  from { transform: translateY(-0.34em); opacity: 0.35; }
  to   { transform: translateY(0); opacity: 1; }
}
@keyframes at-pulse {
  0%, 100% { box-shadow: 0 0 0 2px color-mix(in oklab, var(--scout-accent) 30%, transparent); }
  50%      { box-shadow: 0 0 0 5px color-mix(in oklab, var(--scout-accent) 6%, transparent); }
}
@keyframes at-flash {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  [style*="at-settle"], [style*="at-pulse"], [style*="at-flash"] { animation: none !important; }
}
`;
