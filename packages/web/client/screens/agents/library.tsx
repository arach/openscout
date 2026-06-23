import { useMemo, useState } from "react";
import "./agents-project.css";
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
  FleetAsk,
  FleetState,
  HarnessTopologySnapshot,
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
function AgentRow({ g, gestures }: { g: ProjectAgentGroup; gestures: Gestures }) {
  const [open, setOpen] = useState(false);
  const live = Date.now() - g.lastActivityAt < LIVE_WINDOW;
  const tone: "needs" | "live" | "idle" = g.needs ? "needs" : live ? "live" : "idle";
  const branchLine = g.branches.slice(0, 2).join("  ·  ");
  const lead = g.nodes[0]?.row;
  if (!lead) return null;

  const primaryLabel = g.needs ? "Approve" : live ? "Steer" : "Resume";
  const onPrimary = () => (g.needs ? gestures.respondAgent(lead) : gestures.openAgent(lead));

  return (
    <div className="ap-row" data-tone={tone} data-open={open || undefined}>
      <div className="ap-rowMain" onClick={() => setOpen((v) => !v)}>
        <SpriteAvatar name={g.name} size={30} hue={HARNESS_HUE[g.harness]} tile cornerPulse={live} />
        <div className="ap-rowBody">
          <div className="ap-rowTop">
            <Dot tone={tone} />
            <span className="ap-rowName" data-idle={tone === "idle" || undefined}>
              {g.name}
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
                onPrimary();
              }}
            >
              {primaryLabel}
            </button>
            <button
              type="button"
              className="ap-act"
              onClick={(e) => {
                e.stopPropagation();
                gestures.startSession(lead);
              }}
            >
              ＋ Session
            </button>
            <button
              type="button"
              className="ap-actIcon"
              title="Open agent"
              onClick={(e) => {
                e.stopPropagation();
                gestures.openAgent(lead);
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
            const sess = node.sessions.find((s) => s.route) ?? null;
            const nodeLive = Date.now() - (node.row.lastActivityAt ?? 0) < LIVE_WINDOW;
            return (
              <button
                key={i}
                type="button"
                className="ap-inst"
                data-active={nodeLive || undefined}
                onClick={() => (sess ? gestures.openSession(sess) : gestures.openAgent(node.row))}
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
    .map((node) => ({
      key: node.key,
      who: node.row.agent.name,
      task: cleanTask(node.row.activeTask),
      at: node.row.lastActivityAt ?? 0,
      open: () => openAgent(node.row),
    }));
}

/* ── project view ──────────────────────────────────────────────────────── */
function ProjectDetail({
  project,
  ...gestures
}: { project: DirProject } & Gestures) {
  const [q, setQ] = useState("");
  const [harness, setHarness] = useState<string | null>(null);
  const [showEph, setShowEph] = useState(false);

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

  const working = dirProjectWorking(project);
  const sessionCount = dirProjectSessionCount(project);
  const liveHarnesses = [
    ...new Set(
      project.agents
        .filter((n) => Date.now() - (n.row.lastActivityAt ?? 0) < LIVE_WINDOW)
        .map((n) => harnessOf(n.row.harness)),
    ),
  ];

  return (
    <div className="ap-view">
      <div className="ap-content">
        {/* masthead */}
        <header className="ap-head">
          <SpriteAvatar name={project.slice.title} size={40} tile />
          <div className="ap-headIdent">
            <div className="ap-headTop">
              <h1 className="ap-headName">{project.slice.title}</h1>
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
          {lead ? (
            <div className="ap-headActions">
              <button type="button" className="ap-headGhost" onClick={() => gestures.openAgent(lead.nodes[0].row)}>
                Steer
              </button>
              <button type="button" className="ap-headCta" onClick={() => gestures.startSession(lead.nodes[0].row)}>
                ＋ New agent
              </button>
            </div>
          ) : null}
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
        {lead && !filtering ? (
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
                onClick={() => (lead.needs ? gestures.respondAgent(lead.nodes[0].row) : gestures.openAgent(lead.nodes[0].row))}
              >
                {lead.needs ? "Approve & continue" : "Resume"}
              </button>
              <button type="button" className="ap-link" onClick={() => gestures.openAgent(lead.nodes[0].row)}>
                Open
              </button>
            </span>
          </div>
        ) : null}

        {/* find — underline field + plain harness toggles */}
        <div className="ap-find">
          <span className="ap-findIco" aria-hidden>
            <IcoSearch />
          </span>
          <input
            className="ap-findInput"
            placeholder="Find an agent, branch, or harness…"
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
                {h}
              </button>
            ))}
          </div>
        </div>

        {/* roster */}
        <div className="ap-main">
          <div className="ap-sectionHead">
            <span className="ap-sectionTitle">Agents</span>
            <span className="ap-sectionMeta">
              {primary.length} shown{filtering ? " · filtered" : ""}
            </span>
          </div>

          <div className="ap-roster">
            {primary.map((g) => (
              <AgentRow key={g.name} g={g} gestures={gestures} />
            ))}
            {primary.length === 0 ? <div className="ap-empty">No agents match.</div> : null}
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

          {lead ? (
            <button
              type="button"
              className="ap-newAgent"
              onClick={() => gestures.startSession(lead.nodes[0].row)}
            >
              ＋ New agent on this project
            </button>
          ) : null}
        </div>
      </div>

      <aside className="ap-aside">
        <div className="ap-group">
          <div className="ap-groupHead">Recently</div>
          {recent.length ? (
            recent.map((r) => (
              <button key={r.key} type="button" className="ap-recent" onClick={r.open}>
                <span className="ap-recentWho">{r.who}</span>
                <span className="ap-recentAgo">{r.at ? timeAgo(r.at) : "—"}</span>
                {r.task ? <span className="ap-recentTask">{r.task}</span> : null}
              </button>
            ))
          ) : (
            <div className="ap-groupDim">No recent activity.</div>
          )}
        </div>

        <div className="ap-group">
          <div className="ap-groupHead">Place</div>
          {project.slice.root ? (
            <div className="ap-kv">
              <span className="ap-kvKey">root</span>
              <span className="ap-kvVal">{project.slice.root}</span>
            </div>
          ) : null}
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
    </div>
  );
}
