import { useMemo, useState } from "react";
import "./agents-directory.css";
import { timeAgo } from "../../lib/time.ts";
import { openContent } from "../../scout/slots/openContent.ts";
import { useScout } from "../../scout/Provider.tsx";
import { AgentAvatar } from "../../components/AgentAvatar.tsx";
import { HarnessMark } from "../../components/HarnessMark.tsx";
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
  dirProjectNeeds,
  dirProjectSessionCount,
  dirProjectWorking,
  isAgentRowWorking,
  rowForAgentInventory,
  type AgentInventoryRow,
  type DirProject,
  type ProjectTreeAgentNode,
  type ProjectTreeSessionNode,
} from "./model.ts";

/* ──────────────────────────────────────────────────────────────────────────
   Agents · Directory — the DETAIL pane of a project navigator.

   The project list lives in the left lane (AgentsLeft); this is the selected
   project's command center: its agents collapsed on (project · harness), a peek
   of recent sessions inline (never fully hidden), and a project-info sidebar
   (active now · recent activity) so the pane stays full even when a project is
   sparse. Selection rides the route's `projectSlug`. One accent as a precedence
   ladder. Studio source: design/studio/.../agents-directory.
   ────────────────────────────────────────────────────────────────────────── */

const SESSION_PEEK = 3;

const HARNESS_HUE: Record<string, number> = {
  claude: 28,
  codex: 210,
  grok: 280,
  gemini: 150,
  cursor: 330,
  openai: 200,
};
const hueDot = (harness: string) => `hsl(${HARNESS_HUE[harness.toLowerCase()] ?? 220} 52% 60%)`;

type InstanceSession = {
  key: string;
  harness: string;
  branch: string;
  task: string | null;
  working: boolean;
  needs: boolean;
  lastActivityAt: number | null;
  open: () => void;
};

type HarnessAgent = {
  harness: string;
  lead: AgentInventoryRow;
  working: number;
  needs: boolean;
  lastActivityAt: number;
  sessions: InstanceSession[];
};

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

  const openAgent = (row: AgentInventoryRow) => {
    const convo = conversationByAgentId.get(row.agent.id);
    navigate({ view: "agents", agentId: row.agent.id, ...(convo ? { conversationId: convo } : {}) });
  };
  const openSession = (node: ProjectTreeSessionNode) => {
    if (node.route) openContent(navigate, node.route, { returnTo: route });
  };

  if (!selected) {
    return (
      <div className="s-dir">
        <div className="s-dir-empty">
          No agents discovered yet — they appear here as harnesses register and work.
        </div>
      </div>
    );
  }

  return (
    <div className="s-dir">
      <ProjectDetail project={selected} openAgent={openAgent} openSession={openSession} />
    </div>
  );
}

// Process internals aren't a useful "what it's doing" line. Strip legacy
// bootstrap commands, raw pids, binary paths, and bare harness launches; keep real tasks.
const TASK_COMMAND = /^(claude|codex|grok|gemini|cursor|openai|bash|sh|zsh|fish|node|deno|bun|npm|pnpm|yarn|python3?)\b(.*)$/i;
function cleanTask(task: string | null): string | null {
  const t = task?.trim();
  if (!t) return null;
  if (/--append-system-prompt|--system-prompt|relay agent for/i.test(t)) return null;
  if (/^pid-\d+$/i.test(t)) return null; // raw process id
  if (t.startsWith("/") || /\/(?:Applications|usr|opt|bin|Library)\//.test(t)) return null; // binary path
  const cmd = t.match(TASK_COMMAND);
  if (cmd) {
    const rest = cmd[2].trim();
    if (!rest || rest.length < 6 || rest.startsWith("-") || rest.startsWith("/")) return null;
  }
  return t;
}

function detailFor(node: ProjectTreeSessionNode): string | null {
  if (node.kind === "workflow") return node.subLabel?.trim() || null;
  const detail = node.detail?.trim();
  if (!detail || detail === node.label) return null;
  if (!/\s/.test(detail) && detail.length < 24) return null;
  return detail;
}

function dirNodeRecency(node: ProjectTreeAgentNode): number {
  let m = node.row.lastActivityAt ?? 0;
  for (const s of node.sessions) m = Math.max(m, s.lastActivityAt ?? 0);
  return m;
}

// Collapse a project's per-ID agent nodes into (project · harness) rollups.
function collapseByHarness(
  project: DirProject,
  openAgent: (row: AgentInventoryRow) => void,
  openSession: (node: ProjectTreeSessionNode) => void,
): HarnessAgent[] {
  const groups = new Map<string, ProjectTreeAgentNode[]>();
  for (const node of project.agents) {
    const h = node.row.harness || "agent";
    const list = groups.get(h) ?? [];
    list.push(node);
    groups.set(h, list);
  }

  const agents: HarnessAgent[] = [];
  for (const [harness, nodes] of groups) {
    const list: InstanceSession[] = [];
    for (const node of nodes) {
      if (node.sessions.length > 0) {
        for (const s of node.sessions) {
          list.push({
            key: s.key,
            harness,
            branch: s.label,
            task: cleanTask(detailFor(s)),
            working: s.status === "active",
            needs: false,
            lastActivityAt: s.lastActivityAt,
            open: () => openSession(s),
          });
        }
      } else {
        list.push({
          key: node.key,
          harness,
          branch: node.row.branch && node.row.branch !== "—" ? node.row.branch : node.row.agent.name,
          task: cleanTask(node.row.activeTask),
          working: isAgentRowWorking(node.row),
          needs: node.row.activeAskCount > 0,
          lastActivityAt: node.row.lastActivityAt,
          open: () => openAgent(node.row),
        });
      }
    }
    list.sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));

    const working = list.filter((s) => s.working).length;
    const needs = nodes.some((n) => n.row.activeAskCount > 0);
    const lead =
      nodes.find((n) => n.row.activeAskCount > 0)?.row ??
      nodes.find((n) => isAgentRowWorking(n.row))?.row ??
      nodes.slice().sort((a, b) => dirNodeRecency(b) - dirNodeRecency(a))[0].row;
    const lastActivityAt = Math.max(0, ...nodes.map(dirNodeRecency));
    agents.push({ harness, lead, working, needs, lastActivityAt, sessions: list });
  }

  agents.sort((a, b) => {
    const n = (b.needs ? 1 : 0) - (a.needs ? 1 : 0);
    if (n) return n;
    if (a.working !== b.working) return b.working - a.working;
    return b.lastActivityAt - a.lastActivityAt;
  });
  return agents;
}

function ProjectDetail({
  project,
  openAgent,
  openSession,
}: {
  project: DirProject;
  openAgent: (row: AgentInventoryRow) => void;
  openSession: (node: ProjectTreeSessionNode) => void;
}) {
  const harnessAgents = useMemo(
    () => collapseByHarness(project, openAgent, openSession),
    [project, openAgent, openSession],
  );
  // Sessions/conversations with no currently-registered agent. These are the
  // bulk of any idle project; without surfacing them the pane renders blank.
  const looseSessions = useMemo(
    () => project.unassigned.map((node) => looseSessionRow(node, openSession)),
    [project.unassigned, openSession],
  );
  const working = dirProjectWorking(project);
  const needs = dirProjectNeeds(project);
  const sessionCount = dirProjectSessionCount(project);
  const few = harnessAgents.length <= 3;

  const allSessions = [...harnessAgents.flatMap((a) => a.sessions), ...looseSessions];
  const active = allSessions.filter((s) => s.working);
  const recent = [...allSessions]
    .sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0))
    .slice(0, 7);

  return (
    <div className="s-dir-detail-inner">
      <header className="s-dir-detail-head">
        <span className="s-dir-detail-name">{project.slice.title}</span>
        {project.slice.root ? <span className="s-dir-detail-root">{project.slice.root}</span> : null}
        <span className="s-dir-detail-meta">
          {harnessAgents.length} agent{harnessAgents.length === 1 ? "" : "s"} · {sessionCount} session
          {sessionCount === 1 ? "" : "s"}
        </span>
        {needs ? (
          <span className="s-dir-detail-status" data-tone="needs">
            needs you
          </span>
        ) : working > 0 ? (
          <span className="s-dir-detail-status" data-tone="live">
            <span className="s-dir-livepip" aria-hidden /> {working} working
          </span>
        ) : (
          <span className="s-dir-detail-status" data-tone="idle">
            idle
          </span>
        )}
      </header>

      <div className="s-dir-grid">
        <div className="s-dir-main">
          {harnessAgents.map((agent, i) => (
            <HarnessAgentCard
              key={agent.harness}
              agent={agent}
              project={project.slice.title}
              openAgent={openAgent}
              defaultOpen={agent.needs || few || (i === 0 && working > 0)}
            />
          ))}
          {looseSessions.length > 0 ? (
            <LooseSessionsCard sessions={looseSessions} defaultOpen={harnessAgents.length === 0} />
          ) : null}
          {harnessAgents.length === 0 && looseSessions.length === 0 ? (
            <div className="s-dir-empty">No activity in this project yet.</div>
          ) : null}
        </div>
        <aside className="s-dir-aside">
          <ActivePanel sessions={active} />
          <RecentPanel sessions={recent} />
        </aside>
      </div>
    </div>
  );
}

function HarnessAgentCard({
  agent,
  project,
  openAgent,
  defaultOpen,
}: {
  agent: HarnessAgent;
  project: string;
  openAgent: (row: AgentInventoryRow) => void;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const total = agent.sessions.length;
  const lead = agent.sessions.find((s) => s.needs) ?? agent.sessions.find((s) => s.working) ?? agent.sessions[0];
  const working = agent.working;
  const shown = open ? agent.sessions : agent.sessions.slice(0, SESSION_PEEK);
  const hidden = total - shown.length;
  const toggle = () => setOpen((v) => !v);

  return (
    <div className={`s-dir-agent${agent.needs ? " s-dir-agent--needs" : ""}`} data-state={working > 0 ? "working" : "idle"}>
      <div
        className="s-dir-agentrow"
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <span className={working > 0 ? "s-dir-av-live" : undefined}>
          <AgentAvatar agent={agent.lead.agent} size={36} tile presence={false} />
        </span>
        <div className="s-dir-agent-body">
          <div className="s-dir-agent-top">
            <span className="s-dir-agent-name">{agent.harness}</span>
            <span className="s-dir-agent-hmark" aria-hidden>
              <HarnessMark harness={agent.harness} size={13} />
            </span>
            <span className="s-dir-agent-proj">{project}</span>
            {agent.needs ? (
              <span className="s-dir-needs-chip">needs you</span>
            ) : working > 0 ? (
              <span className="s-dir-working-pip">
                <span className="s-dir-livebars" aria-hidden>
                  {[0.4, 0.9, 0.6, 1, 0.5].map((h, i) => (
                    <span key={i} style={{ height: `${h * 100}%` }} />
                  ))}
                </span>
                {working} live
              </span>
            ) : (
              <span className="s-dir-idle-tag">idle</span>
            )}
          </div>
          {lead ? (
            <div className="s-dir-agent-task">
              {working > 0 ? (
                <span className="s-dir-now" aria-hidden>
                  ❯{" "}
                </span>
              ) : null}
              {lead.task ?? lead.branch}
            </div>
          ) : null}
          <div className="s-dir-agent-metarow">
            <span className="s-dir-agent-metaline">
              {working > 0 ? (
                <>
                  <span className="s-dir-meta-active">
                    <strong>{working}</strong> working
                  </span>
                  <span className="s-dir-meta-dot">·</span>
                </>
              ) : null}
              <strong>{total}</strong> session{total === 1 ? "" : "s"}
              <span className="s-dir-meta-dot">·</span>
              {agent.lastActivityAt ? timeAgo(agent.lastActivityAt) : "—"}
            </span>
            <button
              type="button"
              className="s-dir-start"
              onClick={(e) => {
                e.stopPropagation();
                openAgent(agent.lead);
              }}
            >
              + new
            </button>
          </div>
        </div>
      </div>

      {total > 0 ? (
        <div className="s-dir-sessions">
          {shown.map((s) => (
            <SessionRow key={s.key} session={s} />
          ))}
          {hidden > 0 ? (
            <button
              type="button"
              className="s-dir-more"
              onClick={() => setOpen(true)}
            >
              + {hidden} more session{hidden === 1 ? "" : "s"}
            </button>
          ) : open && total > SESSION_PEEK ? (
            <button type="button" className="s-dir-more" onClick={() => setOpen(false)}>
              show less
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Adapt an unassigned tree node (a conversation / native session with no live
// agent) into the same row shape the agent cards render.
function looseSessionRow(
  node: ProjectTreeSessionNode,
  openSession: (node: ProjectTreeSessionNode) => void,
): InstanceSession {
  return {
    key: node.key,
    harness: node.harness,
    branch: node.label,
    task: cleanTask(detailFor(node)),
    working: node.status === "active",
    needs: false,
    lastActivityAt: node.lastActivityAt,
    open: () => openSession(node),
  };
}

// A project's history when nothing is live: the conversations/sessions that
// aren't attached to a registered agent. Same session list as an agent card,
// minus the agent header.
function LooseSessionsCard({
  sessions,
  defaultOpen,
}: {
  sessions: InstanceSession[];
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const shown = open ? sessions : sessions.slice(0, SESSION_PEEK);
  const hidden = sessions.length - shown.length;
  const lastActivityAt = sessions.reduce((m, s) => Math.max(m, s.lastActivityAt ?? 0), 0) || null;

  return (
    <div className="s-dir-agent" data-state="idle">
      <div className="s-dir-loose-head">
        <span className="s-dir-agent-name">Conversations</span>
        <span className="s-dir-agent-proj">no agent running</span>
        <span className="s-dir-loose-meta">
          <strong>{sessions.length}</strong> session{sessions.length === 1 ? "" : "s"}
          {lastActivityAt ? <> · {timeAgo(lastActivityAt)}</> : null}
        </span>
      </div>
      <div className="s-dir-sessions">
        {shown.map((s) => (
          <SessionRow key={s.key} session={s} />
        ))}
        {hidden > 0 ? (
          <button type="button" className="s-dir-more" onClick={() => setOpen(true)}>
            + {hidden} more session{hidden === 1 ? "" : "s"}
          </button>
        ) : open && sessions.length > SESSION_PEEK ? (
          <button type="button" className="s-dir-more" onClick={() => setOpen(false)}>
            show less
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SessionRow({ session }: { session: InstanceSession }) {
  return (
    <button
      type="button"
      className="s-dir-session"
      data-active={session.working || undefined}
      onClick={session.open}
    >
      <span className="s-dir-session-dot" aria-hidden />
      <span className="s-dir-session-branch">{session.branch}</span>
      <span className="s-dir-session-task">
        {session.working ? (
          <span className="s-dir-now" aria-hidden>
            ❯{" "}
          </span>
        ) : null}
        {session.task ?? ""}
      </span>
      {session.needs ? (
        <span className="s-dir-session-needs">needs you</span>
      ) : session.working ? (
        <span className="s-dir-session-live">live</span>
      ) : null}
      <span className="s-dir-session-ago">
        {session.lastActivityAt ? timeAgo(session.lastActivityAt) : "—"}
      </span>
    </button>
  );
}

/* ── project-info sidebar (fills the pane; real data only) ────────────── */

function ActivePanel({ sessions }: { sessions: InstanceSession[] }) {
  if (sessions.length === 0) return null;
  return (
    <section className="s-dir-panel">
      <div className="s-dir-panel-head">
        <span>Active now</span>
        <span className="s-dir-panel-count">{sessions.length}</span>
      </div>
      <div className="s-dir-panel-body">
        {sessions.map((s) => (
          <button key={s.key} type="button" className="s-dir-active-row" onClick={s.open}>
            <span className="s-dir-active-dot" style={{ background: hueDot(s.harness) }} aria-hidden />
            <span className="s-dir-active-task">
              <span className="s-dir-now" aria-hidden>
                ❯{" "}
              </span>
              {s.task ?? s.branch}
            </span>
            <span className="s-dir-active-ago">
              {s.lastActivityAt ? timeAgo(s.lastActivityAt) : "—"}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function RecentPanel({ sessions }: { sessions: InstanceSession[] }) {
  if (sessions.length === 0) return null;
  return (
    <section className="s-dir-panel">
      <div className="s-dir-panel-head">
        <span>Recent activity</span>
      </div>
      <div className="s-dir-panel-body">
        {sessions.map((s) => (
          <button key={s.key} type="button" className="s-dir-recent-row" onClick={s.open}>
            <span className="s-dir-recent-mark" style={{ background: hueDot(s.harness) }} aria-hidden />
            <span className="s-dir-recent-text">
              <span className="s-dir-recent-branch">{s.branch}</span>
              {s.task ? <span className="s-dir-recent-task">{s.task}</span> : null}
            </span>
            <span className="s-dir-recent-ago">
              {s.lastActivityAt ? timeAgo(s.lastActivityAt) : "—"}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
