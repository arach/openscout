import { useEffect, useMemo, useRef, useState } from "react";
import "./agents-project.css";
import { timeAgo } from "../../lib/time.ts";
import { useScout } from "../../scout/Provider.tsx";
import { SpriteAvatar } from "../../components/SpriteAvatar.tsx";
import { HarnessMark } from "../../components/HarnessMark.tsx";
import { NewChatComposer } from "./NewChatComposer.tsx";
import {
  branchesInFlightForProject,
  groupsForProject,
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
} from "./model.ts";

/* ──────────────────────────────────────────────────────────────────────────
   Agents · Project view — the DETAIL pane when you focus ONE project.

   Ported from the signed-off studio study (design/studio/.../agents-project):
   the project's broker rows collapse up by agent NAME (one recognizable agent
   surfaces under many rows — branch, worktree, clone, session), the ephemeral
   tail folds away, and decorations are stripped so type weight, spacing, and a
   single accent dot carry the hierarchy. One accent as a precedence ladder:
   needs-you ▸ live ▸ idle.

   The spine is project → agent → session, rendered through the REAL shell
   slots: the projects rail lives in the left lane (AgentsLeft); this is the
   center master (masthead · digest · find · agents table); and picking an
   agent drives the REAL right inspector (AgentsInspector) via the route —
   no page-local rail. Selection rides route.agentId, the project rides
   route.projectSlug, and the center stays the directory (master-detail).
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

export function AgentsLibrary({
  agents,
  fleet,
  sessionByAgentId,
  sessions,
  discovery,
  navigate,
  selectedAgentId,
}: {
  agents: Agent[];
  fleet: FleetState | null;
  sessionByAgentId: Map<string, SessionEntry>;
  conversationByAgentId: Map<string, string>;
  sessions: SessionEntry[];
  discovery: TailDiscoverySnapshot | null;
  topologySnapshot: HarnessTopologySnapshot | null;
  navigate: (r: Route) => void;
  // The route-selected agent, so the table can highlight the active row while
  // the REAL inspector renders its card + sessions.
  selectedAgentId?: string;
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

  // Two gestures only, both route-driven — no Provider/shell hacks:
  //   selectAgent  — master-detail. Sets route.agentId (project preserved), so
  //                  the shell un-collapses the inspector while the center stays
  //                  the directory and the table highlights the picked row.
  //   openAgentPage — leave the directory for the agent's full profile page.
  const projectSlug = selected?.slice.slug;
  const gestures: Gestures = {
    selectAgent: (row) =>
      navigate({
        view: "agents",
        agentId: row.agent.id,
        ...(projectSlug ? { projectSlug } : {}),
      }),
    openAgentPage: (row) =>
      navigate({ view: "agents", agentId: row.agent.id, tab: "profile" }),
    startSession: (row) => setComposerAgentId(row.agent.id),
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
        selectedAgentId={selectedAgentId}
        gestures={gestures}
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
  // Master-detail select — drive the REAL inspector with the agent's card.
  selectAgent: (row: AgentInventoryRow) => void;
  // Open ↗ — the agent's full profile page.
  openAgentPage: (row: AgentInventoryRow) => void;
  startSession: (row: AgentInventoryRow) => void;
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

function Dot({ tone }: { tone: "needs" | "live" | "idle" }) {
  if (tone === "idle") return null;
  return <span className="ap-dot" data-tone={tone} aria-hidden />;
}

/* ── one agent (rolled up from the project's broker rows) ───────────────────
   The row is the master: a click selects the agent into the REAL inspector
   (the inspector owns the session detail now — no in-place accordion). The
   secondary line is ONE noun (sessions), the branch named once; instances and
   conversation counts are not split out here. */
function AgentRow({
  g,
  gestures,
  selected,
  cursor,
  rowRef,
}: {
  g: ProjectAgentGroup;
  gestures: Gestures;
  selected: boolean;
  cursor: boolean;
  rowRef: (el: HTMLDivElement | null) => void;
}) {
  const live = Date.now() - g.lastActivityAt < LIVE_WINDOW;
  const tone: "needs" | "live" | "idle" = g.needs ? "needs" : live ? "live" : "idle";
  const branch = g.branches[0] ?? "main";
  const lead = g.nodes[0];
  if (!lead) return null;

  return (
    <div
      ref={rowRef}
      tabIndex={-1}
      className="ap-row"
      data-tone={tone}
      data-selected={selected || undefined}
      data-cursor={cursor || undefined}
    >
      <div className="ap-rowMain" onClick={() => gestures.selectAgent(lead.row)}>
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
            <span className="ap-rowBranch" data-dim={branch === "main" || undefined}>{branch}</span>
            {g.sessionCount ? (
              <>
                <span className="ap-rowDivider" aria-hidden />
                <span className="ap-rowDim">
                  {g.sessionCount} session{g.sessionCount === 1 ? "" : "s"}
                </span>
              </>
            ) : null}
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
                gestures.openAgentPage(lead.row);
              }}
            >
              Open ↗
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
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── project view ──────────────────────────────────────────────────────────
   A single center column (masthead · digest · resume · find · agents table).
   No second rail: selection drives the REAL shell inspector via the route. */
function ProjectDetail({
  project,
  selectedAgentId,
  gestures,
}: {
  project: DirProject;
  selectedAgentId?: string;
  gestures: Gestures;
}) {
  const [q, setQ] = useState("");
  const [harness, setHarness] = useState<string | null>(null);
  const [showEph, setShowEph] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const findRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const groups = useMemo(() => groupsForProject(project), [project]);
  const { primary: primaryGroups, ephemeral: ephGroups } = useMemo(
    () => partitionGroups(groups),
    [groups],
  );
  const flight = useMemo(() => branchesInFlightForProject(project), [project]);
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

  // A project that rolls up to a single real agent has nothing to organize —
  // the find + resume bands are noise, so drop them for the lone agent.
  const sparse = primaryGroups.length <= 1;

  const working = dirProjectWorking(project);
  const sessionCount = dirProjectSessionCount(project);

  const isSelected = (g: ProjectAgentGroup) =>
    Boolean(selectedAgentId && g.nodes.some((n) => n.row.agent.id === selectedAgentId));

  // keyboard layer — j/k or ↑/↓ scrub a cursor down the roster, ↵ selects the
  // cursor row into the inspector, ⌘↵ jumps to whoever needs you, ⌘K // / focus
  // search, Esc blurs the field. Inputs are guarded.
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
        if (typing) el?.blur();
        return;
      }
      if (typing) return;

      const max = primary.length;
      if (!max) return;

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setCursor((c) => (c < 0 ? 0 : Math.min(max - 1, c + 1)));
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setCursor((c) => (c < 0 ? 0 : Math.max(0, c - 1)));
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        const target = primary.find((g) => g.needs) ?? primary[0];
        if (target) {
          e.preventDefault();
          setCursor(primary.indexOf(target));
          gestures.selectAgent(target.nodes[0].row);
        }
      } else if (e.key === "Enter") {
        const i = cursor < 0 ? 0 : cursor;
        const target = primary[i];
        if (target) {
          e.preventDefault();
          setCursor(i);
          gestures.selectAgent(target.nodes[0].row);
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [primary, cursor, gestures]);

  // keep the cursor in range as filtering shrinks the roster, and reveal it.
  useEffect(() => {
    if (cursor < 0) return;
    if (cursor >= primary.length) {
      setCursor(primary.length - 1);
      return;
    }
    rowRefs.current.get(primary[cursor]?.name ?? "")?.scrollIntoView({ block: "nearest" });
  }, [cursor, primary]);

  return (
    <div className="ap-view">
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
        {lead && !filtering && !sparse ? (
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
                onClick={() => gestures.selectAgent(lead.nodes[0].row)}
              >
                {lead.needs ? "Approve & continue" : "Resume"}
              </button>
              <button type="button" className="ap-link" onClick={() => gestures.openAgentPage(lead.nodes[0].row)}>
                Open ↗
              </button>
            </span>
          </div>
        ) : null}

        {/* find — underline field + plain harness toggles (hidden when there's
            only one agent to organize) */}
        {!sparse ? (
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

        {/* agents table */}
        <div className="ap-main">
          <div className="ap-sectionHead">
            <span className="ap-sectionTitle">Agents</span>
            <span className="ap-sectionMeta">
              {primary.length} shown{filtering ? " · filtered" : ""}
            </span>
            <span className="ap-kbdHint" aria-hidden>
              ↑↓ move · ↵ open{needsAgent ? " · ⌘↵ needs" : ""}
            </span>
          </div>

          <div className="ap-roster">
            {primary.map((g, idx) => (
              <AgentRow
                key={g.name}
                g={g}
                gestures={gestures}
                selected={isSelected(g)}
                cursor={cursor === idx}
                rowRef={(el) => {
                  if (el) rowRefs.current.set(g.name, el);
                  else rowRefs.current.delete(g.name);
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
                      onClick={() => gestures.openAgentPage(g.nodes[0].row)}
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
    </div>
  );
}
