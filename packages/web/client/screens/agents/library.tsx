import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from "react";
import "./agents-project.css";
import { api } from "../../lib/api.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { timeAgo } from "../../lib/time.ts";
import { openContent } from "../../scout/slots/openContent.ts";
import { useScout } from "../../scout/Provider.tsx";
import { SpriteAvatar } from "../../components/SpriteAvatar.tsx";
import { HarnessMark } from "../../components/HarnessMark.tsx";
import { NewChatComposer } from "./NewChatComposer.tsx";
import {
  branchesInFlightForProject,
  groupsForProject,
  isEphemeralAgent,
  partitionGroups,
  type ProjectAgentGroup,
} from "./agents-project-model.ts";
import type {
  Agent,
  AgentObservePayload,
  FleetAsk,
  FleetState,
  HarnessTopologySnapshot,
  ObserveEvent,
  Route,
  SessionEntry,
  TailDiscoverySnapshot,
} from "../../lib/types.ts";
import {
  buildDirProjects,
  buildNativeSessionRows,
  dirProjectSessionCount,
  dirProjectWorking,
  rowForAgentInventory,
  type AgentInventoryRow,
  type DirProject,
  type ProjectTreeAgentNode,
  type ProjectTreeSessionNode,
} from "./model.ts";

/* ──────────────────────────────────────────────────────────────────────────
   Agents · Project view — the DETAIL pane when you focus ONE project.

   Ported from the signed-off studio study (design/studio/.../agents-project):
   the project's broker rows collapse up by agent NAME (one recognizable agent
   surfaces under many rows — branch, worktree, clone, session), the ephemeral
   tail folds away, and decorations are stripped so type weight, spacing, and a
   single accent dot carry the hierarchy. One accent as a precedence ladder:
   needs-you ▸ live ▸ idle.

   The projects rail lives in the left lane (AgentsLeft); this renders the
   focused project's content bands (masthead · digest · resume · find · roster)
   plus a context rail (Recently · Place). Selection rides route.projectSlug.
   ────────────────────────────────────────────────────────────────────────── */

const LIVE_WINDOW = 30 * 60_000;

const HARNESS_HUE: Record<string, number> = {
  claude: 28,
  codex: 210,
  grok: 280,
  pi: 280,
  gemini: 150,
  cursor: 330,
  openai: 200,
  general: 220,
};

const harnessOf = (h: string) => (h === "pi" ? "grok" : h);
const shortModel = (m: string | null) =>
  m ? m.replace(/^claude-/, "").replace(/-\d{8}$/, "") : null;
const fmtK = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : `${n}`;

// Process internals aren't a useful "what it's doing" line. Strip bootstrap
// commands, raw pids, binary paths, and bare harness launches; keep real tasks.
const TASK_COMMAND = /^(claude|codex|grok|gemini|cursor|openai|bash|sh|zsh|fish|node|deno|bun|npm|pnpm|yarn|python3?)\b(.*)$/i;
function cleanTask(task: string | null): string | null {
  const t = task?.trim();
  if (!t) return null;
  if (/--append-system-prompt|--system-prompt|relay agent for/i.test(t)) return null;
  if (/^pid-\d+$/i.test(t)) return null;
  if (t.startsWith("/") || /\/(?:Applications|usr|opt|bin|Library)\//.test(t)) return null;
  const cmd = t.match(TASK_COMMAND);
  if (cmd) {
    const rest = cmd[2].trim();
    if (!rest || rest.length < 6 || rest.startsWith("-") || rest.startsWith("/")) return null;
  }
  return t;
}

// Render one observe event as a compact LOG line — "read foo.ts", "edited bar",
// the agent's message — a changelog line, never the raw lane/stream chrome.
function observeLogText(e: ObserveEvent): string {
  let s: string;
  if (e.kind === "tool") {
    const what = e.arg?.trim() || e.text?.trim() || "";
    s = `${e.tool ?? "tool"}${what ? ` ${what}` : ""}`.trim();
  } else {
    s = e.text?.trim() || e.kind;
  }
  // a log line is a glance, not the payload — keep it to one tight clause
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
}

export function AgentsLibrary({
  agents,
  fleet,
  sessionByAgentId,
  conversationByAgentId,
  sessions,
  discovery,
  navigate,
}: {
  agents: Agent[];
  fleet: FleetState | null;
  sessionByAgentId: Map<string, SessionEntry>;
  conversationByAgentId: Map<string, string>;
  sessions: SessionEntry[];
  discovery: TailDiscoverySnapshot | null;
  topologySnapshot: HarnessTopologySnapshot | null;
  navigate: (r: Route) => void;
}) {
  const { route } = useScout();
  const selectedSlug = route.view === "agents" ? route.projectSlug : undefined;

  const activeAsksByAgent = useMemo(() => {
    const byAgent = new Map<string, FleetAsk[]>();
    for (const ask of fleet?.activeAsks ?? []) {
      const list = byAgent.get(ask.agentId) ?? [];
      list.push(ask);
      byAgent.set(ask.agentId, list);
    }
    return byAgent;
  }, [fleet?.activeAsks]);

  const rows = useMemo(
    () =>
      agents.map((agent) =>
        rowForAgentInventory(
          agent,
          sessionByAgentId.get(agent.id) ?? null,
          activeAsksByAgent.get(agent.id) ?? [],
        ),
      ),
    [activeAsksByAgent, agents, sessionByAgentId],
  );

  const nativeSessions = useMemo(() => buildNativeSessionRows(discovery, Date.now()), [discovery]);
  const projects = useMemo(
    () => buildDirProjects(rows, sessions, nativeSessions),
    [rows, sessions, nativeSessions],
  );

  const selected = useMemo(
    () => projects.find((p) => p.slice.slug === selectedSlug) ?? projects[0] ?? null,
    [projects, selectedSlug],
  );

  const [composerAgentId, setComposerAgentId] = useState<string | null>(null);

  // Primary gesture: open the agent (its profile / activity).
  const openAgent = (row: AgentInventoryRow) => {
    const convo = conversationByAgentId.get(row.agent.id);
    navigate({ view: "agents", agentId: row.agent.id, ...(convo ? { conversationId: convo } : {}) });
  };
  // Needs-you: land directly in the conversation where the ask is waiting.
  const respondAgent = (row: AgentInventoryRow) => {
    const convo = conversationByAgentId.get(row.agent.id);
    navigate({
      view: "agents",
      agentId: row.agent.id,
      ...(convo ? { conversationId: convo } : {}),
      tab: "message",
    });
  };
  // Take over the agent's terminal (mirrors the agent right-rail action).
  const takeoverAgent = (row: AgentInventoryRow) => {
    openContent(navigate, { view: "terminal", agentId: row.agent.id, mode: "takeover" }, { returnTo: route });
  };
  // Start a fresh session on this agent — the composer POSTs /api/sessions.
  const startSession = (row: AgentInventoryRow) => setComposerAgentId(row.agent.id);
  const openSession = (node: ProjectTreeSessionNode) => {
    if (node.route) openContent(navigate, node.route, { returnTo: route });
  };

  // A project that rolls up to a single real agent gets the focus treatment —
  // the directory chrome (digest, find, roster, aside) has nothing to organize.
  // Computed before the early return below so the hook order stays stable.
  const selectedSparse = useMemo(
    () => (selected ? partitionGroups(groupsForProject(selected)).primary.length <= 1 : false),
    [selected],
  );

  if (!selected) {
    return (
      <div className="s-aproj">
        <div className="ap-empty">
          No agents discovered yet — they appear here as harnesses register and work.
        </div>
      </div>
    );
  }

  return (
    <div className="s-aproj">
      <ProjectDetail
        project={selected}
        autoFocus={selectedSparse}
        openAgent={openAgent}
        openSession={openSession}
        startSession={startSession}
        respondAgent={respondAgent}
        takeoverAgent={takeoverAgent}
      />
      {composerAgentId ? (
        <NewChatComposer
          agents={agents}
          navigate={navigate}
          initialAgentId={composerAgentId}
          onClose={() => setComposerAgentId(null)}
        />
      ) : null}
    </div>
  );
}

type Gestures = {
  openAgent: (row: AgentInventoryRow) => void;
  openSession: (node: ProjectTreeSessionNode) => void;
  startSession: (row: AgentInventoryRow) => void;
  respondAgent: (row: AgentInventoryRow) => void;
  takeoverAgent: (row: AgentInventoryRow) => void;
};

/* ── icons (kept to two, hairline weight) ──────────────────────────────── */
function IcoSearch() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
function IcoOpen() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M9 3h4v4M13 3 7.5 8.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11 9.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

function Dot({ tone }: { tone: "needs" | "live" | "idle" }) {
  if (tone === "idle") return null;
  return <span className="ap-dot" data-tone={tone} aria-hidden />;
}

/* ── one agent (rolled up from the project's broker rows) ───────────────── */
function AgentRow({
  g,
  gestures,
  selected,
  cursor,
  rowRef,
  onDrill,
}: {
  g: ProjectAgentGroup;
  gestures: Gestures;
  selected: boolean;
  cursor: boolean;
  rowRef: (el: HTMLDivElement | null) => void;
  onDrill: (node: ProjectTreeAgentNode) => void;
}) {
  const [open, setOpen] = useState(false);
  const live = Date.now() - g.lastActivityAt < LIVE_WINDOW;
  const tone: "needs" | "live" | "idle" = g.needs ? "needs" : live ? "live" : "idle";
  const branchLine = g.branches.slice(0, 2).join("  ·  ");
  const lead = g.nodes[0];
  if (!lead) return null;

  // Opening drills the session pane in place (master-detail) — needs-you reads
  // "Approve", a live agent "Steer", an idle one "Resume", but all open the
  // same in-frame panel rather than navigating away.
  const primaryLabel = g.needs ? "Approve" : live ? "Steer" : "Resume";

  return (
    <div
      ref={rowRef}
      tabIndex={-1}
      className="ap-row"
      data-tone={tone}
      data-open={open || undefined}
      data-selected={selected || undefined}
      data-cursor={cursor || undefined}
    >
      <div className="ap-rowMain" onClick={() => setOpen((v) => !v)}>
        <SpriteAvatar name={g.name} size={26} hue={HARNESS_HUE[g.harness]} tile cornerPulse={live} />
        <div className="ap-rowBody">
          <div className="ap-rowTop">
            <Dot tone={tone} />
            <span className="ap-rowName" data-idle={tone === "idle" || undefined}>
              <span className="ap-sigil" aria-hidden>@</span>{g.name}
            </span>
            <span className="ap-rowMark" aria-hidden>
              <HarnessMark harness={harnessOf(g.harness)} size={11} />
            </span>
            {g.needs ? <span className="ap-needsWord">needs you</span> : null}
          </div>
          <div className="ap-rowMeta">
            {branchLine ? (
              <span className="ap-rowBranch">{branchLine}</span>
            ) : (
              <span className="ap-rowBranch" data-dim>main</span>
            )}
            {g.branches.length > 2 ? <span className="ap-rowDim">+{g.branches.length - 2}</span> : null}
            <span className="ap-rowDivider" aria-hidden />
            <span className="ap-rowDim">
              {g.nodes.length} instance{g.nodes.length === 1 ? "" : "s"}
              {g.sessionCount ? ` · ${g.sessionCount} conv` : ""}
            </span>
          </div>
        </div>

        {/* tail lane — reserved width; ago/model by default, actions on hover/needs */}
        <div className="ap-rowTail">
          <div className="ap-tailMeta" aria-hidden={tone === "needs" || undefined}>
            <span className="ap-rowAgo">{g.lastActivityAt ? timeAgo(g.lastActivityAt) : "—"}</span>
            {shortModel(g.model) ? <span className="ap-rowModel">{shortModel(g.model)}</span> : null}
          </div>
          <div className="ap-rowActions">
            <button
              type="button"
              className="ap-act ap-actPrimary"
              onClick={(e) => {
                e.stopPropagation();
                onDrill(lead);
              }}
            >
              {primaryLabel}
            </button>
            <button
              type="button"
              className="ap-act"
              onClick={(e) => {
                e.stopPropagation();
                gestures.startSession(lead.row);
              }}
            >
              ＋ Session
            </button>
            <button
              type="button"
              className="ap-actIcon"
              title="Open full page ↗"
              onClick={(e) => {
                e.stopPropagation();
                gestures.openAgent(lead.row);
              }}
            >
              ⋯
            </button>
          </div>
        </div>
      </div>

      {open ? (
        <div className="ap-instances">
          {g.nodes.map((node, i) => {
            const nodeLive = Date.now() - (node.row.lastActivityAt ?? 0) < LIVE_WINDOW;
            return (
              <button
                key={i}
                type="button"
                className="ap-inst"
                data-active={nodeLive || undefined}
                onClick={() => onDrill(node)}
              >
                <span className="ap-instBranch">
                  {node.row.branch && node.row.branch !== "—" ? node.row.branch : "main"}
                </span>
                <span className="ap-instWhat">
                  {node.sessions.length
                    ? `${node.sessions.length} session${node.sessions.length === 1 ? "" : "s"}`
                    : node.row.stateLabel || "registered"}
                </span>
                <span className="ap-instAgo">
                  {node.row.lastActivityAt ? timeAgo(node.row.lastActivityAt) : "—"}
                </span>
                <span className="ap-instOpen" aria-hidden>
                  <IcoOpen />
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* ── recent activity (real, derived from the project's nodes) ───────────── */
type RecentItem = { key: string; who: string; task: string | null; at: number; open: () => void };
function recentForProject(project: DirProject, openAgent: (row: AgentInventoryRow) => void): RecentItem[] {
  return [...project.agents]
    .filter((node) => !isEphemeralAgent(node.row.agent.name))
    .sort((a, b) => (b.row.lastActivityAt ?? 0) - (a.row.lastActivityAt ?? 0))
    .slice(0, 5)
    .map((node) => {
      // Keep the studio's two-line who/ago + detail rhythm: when there's no
      // clean task line, fall back to the agent's branch (or its state label)
      // so the row never flattens to a single line.
      const branch = node.row.branch && node.row.branch !== "—" ? node.row.branch : null;
      const task = cleanTask(node.row.activeTask) ?? branch ?? node.row.stateLabel ?? null;
      return {
        key: node.key,
        who: node.row.agent.name,
        task,
        at: node.row.lastActivityAt ?? 0,
        open: () => openAgent(node.row),
      };
    });
}

/* ── project view ──────────────────────────────────────────────────────── */
function ProjectDetail({
  project,
  autoFocus = false,
  ...gestures
}: { project: DirProject; autoFocus?: boolean } & Gestures) {
  const [q, setQ] = useState("");
  const [harness, setHarness] = useState<string | null>(null);
  const [showEph, setShowEph] = useState(false);
  const [drill, setDrill] = useState<{ group: ProjectAgentGroup; node: ProjectTreeAgentNode } | null>(null);
  const [cursor, setCursor] = useState(-1);
  const findRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const backRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Drilling is scoped to one project; switching projects closes the pane.
  // Sparse projects (one real agent) auto-drill that agent so the same skeleton
  // opens straight onto its session detail — no inverted bespoke layout.
  useEffect(() => {
    if (!autoFocus) {
      setDrill(null);
      return;
    }
    const g = partitionGroups(groupsForProject(project)).primary[0];
    setDrill(g && g.nodes[0] ? { group: g, node: g.nodes[0] } : null);
  }, [project, autoFocus]);

  const groups = useMemo(() => groupsForProject(project), [project]);
  const { primary: primaryGroups, ephemeral: ephGroups } = useMemo(
    () => partitionGroups(groups),
    [groups],
  );
  const flight = useMemo(() => branchesInFlightForProject(project), [project]);
  const recent = useMemo(() => recentForProject(project, gestures.openAgent), [project, gestures.openAgent]);
  const harnesses = useMemo(
    () => [...new Set(primaryGroups.map((g) => harnessOf(g.harness)))],
    [primaryGroups],
  );

  const query = q.trim().toLowerCase();
  const match = (g: ProjectAgentGroup) =>
    (!harness || harnessOf(g.harness) === harness) &&
    (!query ||
      g.name.toLowerCase().includes(query) ||
      g.branches.some((b) => b.toLowerCase().includes(query)) ||
      g.harness.includes(query));

  const primary = primaryGroups.filter(match);
  const ephemeral = ephGroups.filter(match);
  const filtering = Boolean(query || harness);
  const lead = primary.find((g) => g.needs) ?? primary[0];
  const needsAgent = primary.some((g) => g.needs);

  const working = dirProjectWorking(project);
  const sessionCount = dirProjectSessionCount(project);
  const liveHarnesses = [
    ...new Set(
      project.agents
        .filter((n) => Date.now() - (n.row.lastActivityAt ?? 0) < LIVE_WINDOW)
        .map((n) => harnessOf(n.row.harness)),
    ),
  ];

  // keyboard layer — j/k or ↑/↓ scrub a cursor down the roster (live-loading the
  // drill pane when one is open), ↵ drills the cursor row, ⌘↵ jumps to whoever
  // needs you, ⌘K // / focuses search, Esc closes the pane. Inputs are guarded.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

      if ((e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        findRef.current?.focus();
        findRef.current?.select();
        return;
      }
      if (e.key === "Escape") {
        if (typing) { el?.blur(); return; }
        if (drill) { e.preventDefault(); setDrill(null); }
        return;
      }
      if (typing) return;

      const max = primary.length;
      if (!max) return;
      const moveTo = (i: number) => {
        setCursor(i);
        if (drill) setDrill({ group: primary[i], node: primary[i].nodes[0] });
      };

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        moveTo(cursor < 0 ? 0 : Math.min(max - 1, cursor + 1));
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        moveTo(cursor < 0 ? 0 : Math.max(0, cursor - 1));
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        const target = primary.find((g) => g.needs) ?? primary[0];
        e.preventDefault();
        setCursor(primary.indexOf(target));
        setDrill({ group: target, node: target.nodes[0] });
      } else if (e.key === "Enter") {
        const i = cursor < 0 ? 0 : cursor;
        e.preventDefault();
        setCursor(i);
        setDrill({ group: primary[i], node: primary[i].nodes[0] });
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drill, primary, cursor]);

  // keep the cursor in range as filtering shrinks the roster, and reveal it.
  useEffect(() => {
    if (cursor < 0) return;
    if (cursor >= primary.length) { setCursor(primary.length - 1); return; }
    rowRefs.current.get(primary[cursor]?.name ?? "")?.scrollIntoView({ block: "nearest" });
  }, [cursor, primary]);

  // focus hand-off — into the pane's Back button when it opens, back to the
  // cursor row when it closes, so the keyboard never strands focus.
  useEffect(() => {
    const open = !!drill;
    if (open && !wasOpen.current) backRef.current?.focus();
    else if (!open && wasOpen.current) rowRefs.current.get(primary[cursor]?.name ?? "")?.focus();
    wasOpen.current = open;
  }, [drill, primary, cursor]);

  return (
    <div className="ap-view" data-detail={drill ? true : undefined}>
      <div className="ap-content">
        {/* masthead */}
        <header className="ap-head">
          <SpriteAvatar name={project.slice.title} size={40} tile />
          <div className="ap-headIdent">
            <div className="ap-headTop">
              <h1 className="ap-headName"><span className="ap-sigil" aria-hidden>/</span>{project.slice.title}</h1>
              <span className="ap-headState" data-tone={working > 0 ? "live" : undefined}>
                {working > 0 ? (
                  <>
                    <span className="ap-dot" data-tone="live" aria-hidden /> {working} live
                  </>
                ) : (
                  <>idle · {project.lastActivityAt ? timeAgo(project.lastActivityAt) : "—"}</>
                )}
              </span>
            </div>
            {project.slice.root ? <span className="ap-headRoot">{project.slice.root}</span> : null}
          </div>
          <div className="ap-headActions">
            <button
              type="button"
              className="ap-headGhost"
              disabled={!lead}
              onClick={() => lead && gestures.openAgent(lead.nodes[0].row)}
            >
              Steer all
            </button>
            <button
              type="button"
              className="ap-headCta"
              disabled={!lead}
              onClick={() => lead && gestures.startSession(lead.nodes[0].row)}
            >
              ＋ New agent
            </button>
          </div>
        </header>

        {/* digest — one quiet stat line, no box */}
        <div className="ap-digest">
          <span className="ap-stat">
            <span className="ap-statNum">{primaryGroups.length}</span>
            <span className="ap-statLbl">agents</span>
          </span>
          <span className="ap-stat">
            <span className="ap-statNum">{sessionCount}</span>
            <span className="ap-statLbl">conversations</span>
          </span>
          <span className="ap-stat">
            <span className="ap-statNum">{flight.length}</span>
            <span className="ap-statLbl">branches in flight</span>
          </span>
          <span className="ap-statMarks">
            {harnesses.map((h) => (
              <span key={h} title={h} aria-hidden>
                <HarnessMark harness={h} size={13} />
              </span>
            ))}
          </span>
        </div>

        {/* resume line — pick up where it left off (no box, accent dot) */}
        {lead && !filtering && !autoFocus ? (
          <div className="ap-resume" data-tone={lead.needs ? "needs" : "live"} aria-live="polite">
            <span className="ap-dot" data-tone={lead.needs ? "needs" : "live"} aria-hidden />
            <span className="ap-resumeLbl">{lead.needs ? "Waiting on you" : "Most recent"}</span>
            <span className="ap-resumeWho">{lead.name}</span>
            <span className="ap-resumeMeta">
              {lead.branches[0] ?? "main"} · {lead.lastActivityAt ? timeAgo(lead.lastActivityAt) : "—"}
            </span>
            <span className="ap-resumeActions">
              <button
                type="button"
                className="ap-linkAccent"
                onClick={() => {
                  setCursor(primary.indexOf(lead));
                  setDrill({ group: lead, node: lead.nodes[0] });
                }}
              >
                {lead.needs ? "Approve & continue" : "Resume"}
              </button>
              <button type="button" className="ap-link" onClick={() => gestures.openAgent(lead.nodes[0].row)}>
                Open ↗
              </button>
            </span>
          </div>
        ) : null}

        {/* find — underline field + plain harness toggles (hidden when there's
            only one agent to organize) */}
        {!autoFocus ? (
          <div className="ap-find">
            <span className="ap-findIco" aria-hidden>
              <IcoSearch />
            </span>
            <input
              ref={findRef}
              className="ap-findInput"
              placeholder="Find an agent, branch, or harness…  (⌘K)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="ap-findFilters">
              {harnesses.map((h) => (
                <button
                  key={h}
                  type="button"
                  className="ap-filter"
                  data-on={harness === h || undefined}
                  onClick={() => setHarness((cur) => (cur === h ? null : h))}
                >
                  <HarnessMark harness={h} size={11} />
                  {h.charAt(0).toUpperCase() + h.slice(1)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* roster */}
        <div className="ap-main">
          <div className="ap-sectionHead">
            <span className="ap-sectionTitle">Agents</span>
            <span className="ap-sectionMeta">
              {primary.length} shown{filtering ? " · filtered" : ""}
            </span>
            <span className="ap-kbdHint" aria-hidden>
              ↑↓ move · ↵ open{needsAgent ? " · ⌘↵ needs" : ""} · esc close
            </span>
          </div>

          <div className="ap-roster">
            {primary.map((g, idx) => (
              <AgentRow
                key={g.name}
                g={g}
                gestures={gestures}
                selected={drill?.group.name === g.name}
                cursor={cursor === idx}
                rowRef={(el) => {
                  if (el) rowRefs.current.set(g.name, el);
                  else rowRefs.current.delete(g.name);
                }}
                onDrill={(node) => {
                  setCursor(idx);
                  setDrill({ group: g, node });
                }}
              />
            ))}
            {primary.length === 0 ? (
              <div className="ap-empty">
                {filtering
                  ? "No agents match."
                  : ephemeral.length
                    ? "No primary agents — workflow & clone agents are in the fold below."
                    : "No agents in this project yet."}
              </div>
            ) : null}
          </div>

          {ephemeral.length ? (
            <div className="ap-ephBlock">
              <button type="button" className="ap-ephToggle" onClick={() => setShowEph((v) => !v)}>
                <span className="ap-ephCount">{ephemeral.length}</span> ephemeral · workflow &amp; clone agents
                <span className="ap-ephCaret">{showEph ? "▴" : "▾"}</span>
              </button>
              {showEph ? (
                <div className="ap-ephList">
                  {ephemeral.map((g) => (
                    <button
                      key={g.name}
                      type="button"
                      className="ap-ephRow"
                      onClick={() => gestures.openAgent(g.nodes[0].row)}
                    >
                      <span className="ap-ephMark" aria-hidden>
                        <HarnessMark harness={harnessOf(g.harness)} size={10} />
                      </span>
                      <span className="ap-ephName">{g.name}</span>
                      <span className="ap-ephBranch">{g.branches[0] ?? "main"}</span>
                      <span className="ap-ephAgo">{g.lastActivityAt ? timeAgo(g.lastActivityAt) : "—"}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <button
            type="button"
            className="ap-newAgent"
            disabled={!lead}
            onClick={() => lead && gestures.startSession(lead.nodes[0].row)}
          >
            ＋ New agent on this project
          </button>
        </div>
      </div>

      {drill ? (
        <SessionDetail
          key={drill.node.key}
          group={drill.group}
          node={drill.node}
          gestures={gestures}
          onBack={() => setDrill(null)}
          backRef={backRef}
        />
      ) : (
      <aside className="ap-aside">
        <div className="ap-group">
          <div className="ap-groupHead">Recently</div>
          {recent.length ? (
            recent.map((r) => (
              <button key={r.key} type="button" className="ap-recent" onClick={r.open}>
                <span className="ap-recentWho">{r.who}</span>
                <span className="ap-recentAgo">{r.at ? timeAgo(r.at) : "—"}</span>
                <span className="ap-recentTask">{r.task}</span>
              </button>
            ))
          ) : (
            <div className="ap-groupDim">No recent activity.</div>
          )}
        </div>

        <div className="ap-group">
          <div className="ap-groupHead">Place</div>
          <div className="ap-kv">
            <span className="ap-kvKey">root</span>
            <span className="ap-kvVal">{project.slice.root}</span>
          </div>
          <div className="ap-kv">
            <span className="ap-kvKey">live</span>
            <span className="ap-kvVal">
              {working} process{working === 1 ? "" : "es"}
              {liveHarnesses.length ? <span className="ap-kvDim"> · {liveHarnesses.join(", ")}</span> : null}
            </span>
          </div>
          <div className="ap-kv">
            <span className="ap-kvKey">in flight</span>
            <span className="ap-kvBranches">
              {flight.slice(0, 5).map((b) => (
                <span key={b} className="ap-kvBranch">{b}</span>
              ))}
              {flight.length === 0 ? <span className="ap-kvDim">—</span> : null}
            </span>
          </div>
        </div>
      </aside>
      )}
    </div>
  );
}

/* ── session detail (master–detail drill, in place of the aside) ─────────────
   Opens in the right column — the project frame (masthead · digest · find ·
   roster) stays put, the column grows 264→480, and the resume band folds away,
   so it reads as a panel opening, not a page change. The transcript is the REAL
   /observe stream (SessionObserve), not a synthesized trace. */
function SessionDetail({
  group,
  node,
  gestures,
  onBack,
  backRef,
}: {
  group: ProjectAgentGroup;
  node: ProjectTreeAgentNode;
  gestures: Gestures;
  onBack: () => void;
  backRef?: Ref<HTMLButtonElement>;
}) {
  // One agent name rolls up many parallel instances (branch · worktree), each a
  // distinct agent id with its own transcript. The switcher flips between them
  // without leaving the pane; the prop `node` seeds the initial selection (the
  // pane remounts when the roster drills a different agent, re-seeding it).
  const [selNode, setSelNode] = useState(node);
  const agentId = selNode.row.agent.id;
  const [observe, setObserve] = useState<AgentObservePayload | null>(null);

  const load = useCallback(async () => {
    const o = await api<AgentObservePayload>(
      `/api/agents/${encodeURIComponent(agentId)}/observe`,
    ).catch(() => null);
    setObserve(o);
  }, [agentId]);
  useEffect(() => {
    setObserve(null);
    void load();
  }, [load]);
  useBrokerEvents(() => {
    void load();
  });

  const live = Date.now() - (selNode.row.lastActivityAt ?? group.lastActivityAt) < LIVE_WINDOW;
  const tone: "needs" | "live" | "idle" = group.needs ? "needs" : live ? "live" : "idle";
  const branch = selNode.row.branch && selNode.row.branch !== "—" ? selNode.row.branch : "main";
  const model = shortModel(selNode.row.agent.model ?? group.model);
  const status = selNode.row.stateLabel || (live ? "active" : "idle");
  const eventCount = observe?.data.events.length ?? 0;

  // Meta strip readout, derived from the REAL /observe stream (the studio reads
  // these off a parsed launch command + synthetic usage; here they're live):
  //   tools  — distinct tool kinds exercised this session
  //   ctx    — context-window fill % (contextInput / contextWindow)
  //   tokens — input · output token counts
  //   changes— summed +adds / −dels across the session's edit diffs
  const usage = observe?.data.metadata?.usage ?? null;
  const toolCount = useMemo(() => {
    const events = observe?.data.events ?? [];
    const kinds = new Set<string>();
    for (const e of events) if (e.kind === "tool" && e.tool) kinds.add(e.tool.toLowerCase());
    return kinds.size;
  }, [observe]);
  const ctxPct = useMemo(() => {
    const win = usage?.contextWindowTokens ?? 0;
    const used = usage?.contextInputTokens ?? 0;
    if (!win || win <= 0 || used <= 0) return null;
    return Math.min(100, Math.max(0, Math.round((used / win) * 100)));
  }, [usage]);
  const changes = useMemo(() => {
    let adds = 0;
    let dels = 0;
    for (const e of observe?.data.events ?? []) {
      if (e.diff) {
        adds += e.diff.add ?? 0;
        dels += e.diff.del ?? 0;
      }
    }
    return { adds, dels };
  }, [observe]);

  // The rail is a SUMMARY — a few recent changelog lines + the files this
  // session touched. The full transcript / messages / chat is the engage step
  // (Open ↗), not something we replay inline here.
  const files = observe?.data.files ?? [];
  const logLines = (observe?.data.events ?? []).slice(-7).map((e) => ({
    t: e.at ?? e.t ? timeAgo(e.at ?? e.t) : "",
    text: observeLogText(e),
    kind: e.kind,
  }));

  return (
    <section className="ap-detail" aria-label="Session detail">
      <header className="ap-detailHead">
        <button ref={backRef} type="button" className="ap-detailBack" title="Back to roster (esc)" onClick={onBack} aria-label="Back">
          ‹
        </button>
        <SpriteAvatar name={group.name} size={34} hue={HARNESS_HUE[group.harness]} tile cornerPulse={live} />
        <div className="ap-detailIdent">
          <div className="ap-detailTop">
            <span className="ap-detailName"><span className="ap-sigil" aria-hidden>@</span>{group.name}</span>
            <span className="ap-rowMark" aria-hidden>
              <HarnessMark harness={harnessOf(group.harness)} size={13} />
            </span>
            <span className="ap-headState" data-tone={tone}>
              {tone === "needs" ? (
                <>
                  <span className="ap-dot" data-tone="needs" aria-hidden /> needs you
                </>
              ) : tone === "live" ? (
                <>
                  <span className="ap-dot" data-tone="live" aria-hidden /> live
                </>
              ) : (
                <>idle · {selNode.row.lastActivityAt ? timeAgo(selNode.row.lastActivityAt) : "—"}</>
              )}
            </span>
          </div>
          <span className="ap-detailSub">
            {branch}
            {model ? `  ·  ${model}` : ""}
          </span>
        </div>
        <div className="ap-headActions">
          <button type="button" className="ap-headGhost" onClick={() => gestures.takeoverAgent(selNode.row)}>
            Take over
          </button>
          <button
            type="button"
            className="ap-headCta"
            onClick={() => (group.needs ? gestures.respondAgent(selNode.row) : gestures.openAgent(selNode.row))}
          >
            {group.needs ? "Continue" : "Open ↗"}
          </button>
        </div>
      </header>

      {/* meta strip — the right-rail readout folded into one row */}
      <div className="ap-metaStrip">
        <span className="ap-metaItem">
          <span className="ap-metaKey">status</span>
          <span className="ap-metaVal">{status}</span>
        </span>
        <span className="ap-metaItem">
          <span className="ap-metaKey">model</span>
          <span className="ap-metaVal">{model ?? "—"}</span>
        </span>
        <span className="ap-metaItem">
          <span className="ap-metaKey">tools</span>
          <span className="ap-metaVal">{observe && toolCount ? toolCount : "—"}</span>
        </span>
        <span className="ap-metaItem">
          <span className="ap-metaKey">ctx</span>
          <span className="ap-metaVal">{ctxPct != null ? `${ctxPct}%` : "—"}</span>
        </span>
        <span className="ap-metaItem">
          <span className="ap-metaKey">tokens</span>
          <span className="ap-metaVal">
            {usage && (usage.inputTokens || usage.outputTokens)
              ? `${fmtK(usage.inputTokens ?? 0)} in · ${fmtK(usage.outputTokens ?? 0)} out`
              : "—"}
          </span>
        </span>
        {changes.adds || changes.dels ? (
          <span className="ap-metaChanges">
            <span className="ap-add">+{changes.adds}</span> <span className="ap-del">−{changes.dels}</span>
          </span>
        ) : null}
      </div>

      {/* instance switcher — flip between the agent's parallel branches in place */}
      {group.nodes.length > 1 ? (
        <div className="ap-sessTabs" role="tablist" aria-label="Instances">
          {group.nodes.map((n) => {
            const nLive = Date.now() - (n.row.lastActivityAt ?? 0) < LIVE_WINDOW;
            const nBranch = n.row.branch && n.row.branch !== "—" ? n.row.branch : "main";
            return (
              <button
                key={n.key}
                type="button"
                role="tab"
                aria-selected={n.key === selNode.key}
                className="ap-sessTab"
                data-on={n.key === selNode.key || undefined}
                onClick={() => setSelNode(n)}
                title={nBranch}
              >
                <span className="ap-sessDot" data-on={nLive || undefined} aria-hidden />
                {nBranch}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* session summary — recent changelog lines + the files this session
          touched. NOT a transcript replay; that's the engage step (Open ↗). */}
      <div className="ap-detailBody">
        <div className="ap-sectionHead">
          <span className="ap-sectionTitle">Session log</span>
          <span className="ap-sectionMeta">{observe ? `${observe.source} · ${eventCount} events` : "loading…"}</span>
        </div>
        <div className="ap-log">
          {observe === null ? (
            <div className="ap-traceLoading">Resolving the most recent session…</div>
          ) : logLines.length === 0 ? (
            <div className="ap-traceLoading">No activity captured for this session yet.</div>
          ) : (
            logLines.map((l, i) => (
              <div key={i} className="ap-logLine" data-kind={l.kind}>
                <span className="ap-logT">{l.t}</span>
                <span className="ap-logText">{l.text}</span>
              </div>
            ))
          )}
        </div>

        {files.length ? (
          <div className="ap-sessFiles">
            <span className="ap-logHeadTitle ap-sessFilesHead">
              Files touched <span className="ap-sectionMeta">{files.length}</span>
            </span>
            {files.slice(0, 8).map((f) => (
              <div key={f.path} className="ap-fileRow">
                <span className="ap-fileTag" data-state={f.state}>{f.state}</span>
                <span className="ap-fileName" title={f.path}>{f.path.split("/").pop()}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
