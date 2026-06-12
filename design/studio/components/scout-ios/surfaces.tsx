"use client";

// Scout iOS — the four study surfaces, faithful to the app source:
//   Home    apps/ios/Scout/HomeSurface.swift
//   Agents  apps/ios/Scout/AgentsSurface.swift
//   Comms   apps/ios/Scout/CommsSurface.swift
//   Tail    apps/ios/Scout/TailSurface.swift
// Each renders the `.iBody` scroll region only — the phone chrome (status bar,
// masthead, tab bar, cockpit status bar) is supplied by <PhoneShell>.

import { Glyph } from "./Glyph";
import { SectionHeader, TreeRail, CommsTypeGlyph, CommsStatusGlyph } from "./primitives";
import {
  FLEET, MACHINES, ACTIVITY, COMMS, TAIL, INBOX, TERMINAL_LINES,
  groupByProject, ageRank, workingMeta, soloLabel, leafTitle,
  type Agent, type Convo, type InboxItem,
} from "./data";

// ── Needs-you band (Home's attention layer) ───────────────────────────────
//
// Home stays Home — the ambient survey of the swarm (what's being worked on,
// which agents are running, the activity). But anything *tagged to you* takes
// precedence, so Home leads with a compact "needs you" band: blocked approvals
// + pending questions (an agent is paused — steer it inline), replies, errors;
// each one a steering point. The reality we're building toward is agents doing
// most of the work and the talking, with us rarely solicited — so the band is
// the exception, not the spine. When it's empty Home is just the calm swarm,
// no inbox-zero ceremony. The two top items are the live approval + question
// from the CONVERSATION fixture, surfaced from the transcript so you can steer
// without digging.

/** One inbox item — no status dot, no color-coding: agent·project · KIND · age,
 *  then the demand and its inline decision (approve/deny · option chips · the
 *  awaiting command). Kind reads from the mono label; risk reads from contrast
 *  (high = ink-bright, lower = dim), not a colored pill. */
function InboxRow({ it }: { it: InboxItem }) {
  return (
    <div className="iNeedRow">
      <div className="iNeedBody">
        <div className="iNeedTop">
          <span className="iNeedAgent">{it.agent}</span>
          <span className="iNeedProj">{it.project}</span>
          <span className="iNeedKind">{it.kind.toUpperCase()}</span>
          <span className="iNeedAge">{it.age}</span>
        </div>
        <div className="iNeedSummary">{it.summary}</div>
        {it.command && (
          <div className="iNeedCmd">
            <span className="iNeedCmdText">{it.command}</span>
            {it.risk && (
              <span className="iNeedRisk" style={{ color: it.risk === "high" ? "var(--i-ink)" : "var(--i-dim)" }}>
                {it.risk.toUpperCase()}
              </span>
            )}
          </div>
        )}
        {it.kind === "approval" && (
          <div className="iNeedActions">
            <span className="iNeedBtn deny">Deny</span>
            <span className="iNeedBtn approve">Approve</span>
          </div>
        )}
        {it.kind === "question" && it.options && (
          <div className="iNeedActions">
            {it.options.map((o) => <span key={o} className="iNeedOpt">{o}</span>)}
          </div>
        )}
      </div>
    </div>
  );
}

/** Home's attention layer — the "needs you" queue, rendered as a precedence
 *  band at the top of Home. Returns null when nothing is tagged to you (the
 *  ideal: un-solicited, so Home is just the ambient swarm — no empty-inbox
 *  ceremony). Each row is a steering point: approve/deny, pick a direction,
 *  reply, or jump to a stuck agent. */
export function NeedsYouBand() {
  if (!INBOX.length) return null;
  return (
    <>
      <div className="iNeedHead">
        <span className="iNeedHeadLabel">Needs you</span>
        <span className="iNeedCount">{INBOX.length}</span>
        <span className="iNeedClear">Clear</span>
      </div>
      <div className="iCard">
        {INBOX.map((it, i) => (
          <div key={it.id}>
            {i > 0 && <div className="iRowSep" />}
            <InboxRow it={it} />
          </div>
        ))}
      </div>
    </>
  );
}

// ── Home ──────────────────────────────────────────────────────────────────
//
// Projects-first fleet landing: machine rail · search · currently working ·
// projects (one-child compression + tree leaves) · latest activity.

export function HomeSurface({ attention = true }: { attention?: boolean } = {}) {
  const live = FLEET.filter((a) => a.state === "live");
  const groups = groupByProject(FLEET);

  return (
    <div className="iBody">
      {/* Machine rail */}
      <div className="iRail">
        <span className="iRailCap">MACHINES</span>
        <div className="iRailScroll">
          {MACHINES.map((m) => (
            <span key={m.name} className={`iChip ${m.state === "connected" ? "on" : "off"}`}>
              {/* machine availability — the one sanctioned state dot */}
              <span className="iDot" style={{ background: m.state === "connected" ? "var(--i-accent)" : "var(--i-dim)" }} />
              <span className="iChipName">{m.name}</span>
            </span>
          ))}
          <span className="iChip off iChipAdd">
            <Glyph kind="plus" size={9} /><span className="iChipName">Add</span>
          </span>
        </div>
      </div>

      {/* Needs-you band — anything tagged to you takes precedence over the
          ambient swarm below. Omitted entirely when nothing needs you. */}
      {attention && <NeedsYouBand />}

      {/* Search the fleet */}
      <div className="iField">
        <Glyph kind="search" size={15} /><span>Search the fleet</span>
      </div>

      {/* Currently working */}
      <SectionHeader label={`Currently working · ${live.length} live`} />
      <div className="iWorkScroll">
        {live.map((a) => (
          <div className="iWorkCard" key={a.id}>
            <div className="iWorkTop">
              <span className="iWorkName">{a.title}</span>
            </div>
            <div className="iWorkAction">{a.action ?? "working"}<span className="iCaret" /></div>
            <div className="iWorkMeta">{workingMeta(a)}</div>
          </div>
        ))}
      </div>

      {/* Projects — inside a scoutCard, one-child compression + tree leaves */}
      <SectionHeader label="Projects" all />
      <div className="iCard">
        {groups.map((g, gi) => {
          const solo = g.agents.length === 1 ? g.agents[0] : null;
          const liveCount = g.agents.filter((a) => a.state === "live").length;
          return (
            <div key={g.name}>
              {gi > 0 && <div className="iRowSep" />}
              <div className="iRow">
                <span className="iFolder"><Glyph kind="folder" size={15} /></span>
                <span className="iProjName">{g.name}</span>
                <span className="iSlash">/</span>
                {solo ? (
                  <span className="iLeaf">
                    <span className="glyf"><Glyph kind="agent" size={12} /></span>
                    {soloLabel(solo)}
                    {solo.harness && <span className="iPill">{solo.harness}</span>}
                  </span>
                ) : (
                  <span className="iLeaf">
                    <span className="glyf"><Glyph kind="agents" size={13} /></span>
                    {g.agents.length} agents
                  </span>
                )}
                <span className="iSpacer" />
                <span className={`iAge ${liveCount > 0 ? "live" : ""}`}>{g.age}</span>
                {solo
                  ? <span className="iChev"><Glyph kind="arrow" size={13} /></span>
                  : <span className="iChev"><Glyph kind="chevron" size={13} /></span>}
              </div>
              {/* multi-agent projects expand to leaves */}
              {!solo && g.agents.map((a, ai) => (
                <div key={a.id}>
                  <div className="iRowSep inset" />
                  <div className="iLeafRow">
                    <TreeRail last={ai === g.agents.length - 1} />
                    <span className="iFolder" style={{ color: "var(--i-dim)" }}>
                      <Glyph kind="agent" size={13} />
                    </span>
                    <span className={`iAgentName ${a.state === "live" ? "" : "dim"}`}>{leafTitle(a, g.name)}</span>
                    {a.harness && <><span className="iAgentTok">·</span><span className="iAgentTok">{a.harness}</span></>}
                    <span className="iSpacer" />
                    <span className={`iAge ${a.state === "live" ? "live" : ""}`}>{a.age}</span>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Latest activity — inside a scoutCard */}
      <SectionHeader label="Latest activity" all />
      <div className="iCard">
        {ACTIVITY.map((e, i) => (
          <div key={e.id}>
            {i > 0 && <div className="iRowSep" />}
            <div className="iActRow">
              <div className="iActBody">
                <div className="iActSummary">{e.summary}</div>
                <div className="iActMeta">{e.source} · {e.kind} · {e.age}</div>
              </div>
              <span className="iChev" style={{ marginTop: 3 }}><Glyph kind="chevron" size={13} /></span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Agents ──────────────────────────────────────────────────────────────────
//
// Bridge directory as a project navigator: search · a summary bar with a
// PROJECT|RECENT sort toggle · project sections (tree) or a flat recent list.

export function AgentsSurface({ sort, onSort }: { sort: "project" | "recent"; onSort: (s: "project" | "recent") => void }) {
  const liveCount = FLEET.filter((a) => a.state === "live").length;
  const groups = groupByProject(FLEET);
  const summary = liveCount > 0
    ? `${FLEET.length} agents · ${liveCount} live`
    : `${FLEET.length} agents · ${groups.length} projects`;
  const recents = [...FLEET].sort((a, b) =>
    (a.state === "live" ? 0 : 1) - (b.state === "live" ? 0 : 1) || ageRank(a.age) - ageRank(b.age));

  return (
    <div className="iBody">
      <div className="iField">
        <Glyph kind="search" size={15} /><span>Search agents</span>
      </div>

      <div className="iSummary">
        <span className="iSecLabel">{summary.toUpperCase()}</span>
        <div className="iSort">
          <span className={`iSortBtn ${sort === "project" ? "on" : ""}`} onClick={() => onSort("project")}>PROJECT</span>
          <span className={`iSortBtn ${sort === "recent" ? "on" : ""}`} onClick={() => onSort("recent")}>RECENT</span>
        </div>
      </div>

      {sort === "project" ? agentsProjectGroups() : (
        recents.map((a, i) => (
          <div key={a.id}>
            <AgentLeaf agent={a} />
            {i < recents.length - 1 && <div className="iADivider" />}
          </div>
        ))
      )}
    </div>
  );
}

/** The project·agent·session tree body — shared by the Agents surface and the
 *  merged Agents hub's Tree lens. */
function agentsProjectGroups() {
  return groupByProject(FLEET).map((g) => {
    const solo = g.agents.length === 1 ? g.agents[0] : null;
    const liveN = g.agents.filter((a) => a.state === "live").length;
    if (solo) {
      return (
        <div key={g.name}>
          <AgentLeaf agent={solo} showProject />
          <div className="iADivider" />
        </div>
      );
    }
    return (
      <div key={g.name}>
        <div className="iProjHead">
          <span className="iProjGlyph"><i /><i /><i /><i /></span>
          <span className="iProjHeadName">{g.name}</span>
          <span className="iSpacer" />
          <span className="iCount" style={liveN > 0 ? { color: "var(--i-accent)" } : undefined}>{g.agents.length}</span>
          <span className="iChev"><Glyph kind="chevron" size={13} /></span>
        </div>
        {g.agents.map((a, ai) => (
          <AgentLeaf key={a.id} agent={a} tree={{ last: ai === g.agents.length - 1 }} />
        ))}
        <div className="iADivider" />
      </div>
    );
  });
}

/** One AgentRow: optional tree rail, state dot, name, session line (project · branch), age, harness. */
export function AgentLeaf({ agent, tree, showProject }: { agent: Agent; tree?: { last: boolean }; showProject?: boolean }) {
  const parts = [showProject ? agent.project : null, agent.branch].filter(Boolean);
  const sessionLine = parts.length ? parts.join(" · ") : null;
  return (
    <div className="iLeafRow" style={{ background: "transparent", paddingLeft: tree ? 13 : 16 }}>
      {tree && <TreeRail last={tree.last} />}
      <div className="iAgentMain">
        <span className={`iAgentName ${agent.state === "live" ? "" : "dim"}`} style={{ fontWeight: tree ? 400 : 500 }}>{agent.title}</span>
        {sessionLine && <span className="iSessionLine">{sessionLine}</span>}
      </div>
      <span className="iSpacer" />
      {agent.age && <span className="iAge" style={{ color: agent.state === "live" ? "var(--i-accent)" : "var(--i-dim)" }}>{agent.age}</span>}
      {agent.harness && <span className="iHarness">{agent.harness}</span>}
    </div>
  );
}

// ── Comms ───────────────────────────────────────────────────────────────────
//
// Operator's window into the mesh: search · one interleaved list of channels +
// DMs, each: type glyph · name (fixed col) · status separator · preview · age ·
// unread capsule. Unread rows get a neutral tint + accent rail.

// Identity marks (the "Marks" treatment): a deterministic accent tile per DM,
// geometric — initials in mono, tinted by name hash. No emoji (house rule).
const MARK_TONES = ["var(--i-accent)", "var(--i-info)", "var(--i-ok)"];
function markTone(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return MARK_TONES[h % MARK_TONES.length];
}
function initials(name: string) {
  return name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 1).toUpperCase() || "•";
}

function CommsRowItem({ c, marks }: { c: Convo; marks?: boolean }) {
  return (
    <div className={`iCommsRow ${c.unread ? "unread" : ""}`}>
      {c.unread && <span className="iCommsRail" />}
      {marks ? (
        <span className="iCommsMark" style={c.kind === "direct" ? { color: markTone(c.name) } : undefined}>
          {c.kind === "direct" ? initials(c.name) : <CommsTypeGlyph kind={c.kind} />}
        </span>
      ) : (
        <span className="iCommsType"><CommsTypeGlyph kind={c.kind} /></span>
      )}
      <span className={`iCommsName ${c.unread ? "unread" : ""}`}>{c.name}</span>
      <span className="iCommsStatus"><CommsStatusGlyph status={c.status} /></span>
      <span className="iCommsPreview">{c.preview}</span>
      <span className="iCommsAge">{c.age}</span>
      {c.unread ? <span className="iUnread">{c.unread}</span> : null}
    </div>
  );
}

function commsList(list: Convo[], marks?: boolean) {
  return list.map((c, i) => (
    <div key={c.id}>
      <CommsRowItem c={c} marks={marks} />
      {i < list.length - 1 && <div className="iCommsSep" />}
    </div>
  ));
}

export function CommsSurface({ sectioned, marks }: { sectioned?: boolean; marks?: boolean } = {}) {
  const channels = COMMS.filter((c) => c.kind !== "direct");
  const directs = COMMS.filter((c) => c.kind === "direct");
  return (
    <div className="iBody">
      <div className="iField">
        <Glyph kind="search" size={15} /><span>Search conversations</span>
      </div>
      {sectioned ? (
        <>
          <SectionHeader label={`Channels · ${channels.length}`} />
          {commsList(channels, marks)}
          <SectionHeader label={`Direct · ${directs.length}`} />
          {commsList(directs, marks)}
        </>
      ) : (
        commsList(COMMS, marks)
      )}
    </div>
  );
}

// ── Tail ────────────────────────────────────────────────────────────────────
//
// The live firehose: a "Tail" header + a live indicator pill; event rows in
// inset cards — attribution badge · source · kind · time, then the summary line.

export function TailSurface() {
  return (
    <div className="iBody">
      <div className="iTailHead">
        <span className="iSecLabel">TAIL</span>
        <span className="iLiveInd">
          <span>live</span>
        </span>
      </div>
      {TAIL.map((e) => (
        <div className="iEv" key={e.id}>
          <div className="iEvTop">
            <span className="iBadge" style={{ color: "var(--i-dim)" }}>{e.attr}</span>
            <span className="iEvSource">{e.source}</span>
            <span className="iEvKind" data-kind={e.kind}>{e.kind}</span>
            <span className="iEvTime">{e.time}</span>
          </div>
          <div className="iEvText">{e.summary}</div>
        </div>
      ))}
    </div>
  );
}

// ── Ops ─────────────────────────────────────────────────────────────────────
//
// One "raw truth" destination that folds Tail + Terminal: opens on Tail (the
// live firehose) with a Terminal toggle — both are where you drop when the
// abstraction stops being trustworthy, so they share a home. New is contextual,
// so it isn't here (and the masthead compose "+" hides on Ops).

export function OpsSurface({ view = "tail", onView }: { view?: "tail" | "terminal"; onView?: (v: "tail" | "terminal") => void }) {
  return (
    <div className="iBody">
      <div className="iTailHead">
        <span className="iSecLabel">OPS</span>
        <div className="iSort">
          <span className={`iSortBtn ${view === "tail" ? "on" : ""}`} onClick={() => onView?.("tail")}>TAIL</span>
          <span className={`iSortBtn ${view === "terminal" ? "on" : ""}`} onClick={() => onView?.("terminal")}>TERMINAL</span>
        </div>
      </div>
      {view === "tail" ? (
        TAIL.map((e) => (
          <div className="iEv" key={e.id}>
            <div className="iEvTop">
              <span className="iBadge" style={{ color: "var(--i-dim)" }}>{e.attr}</span>
              <span className="iEvSource">{e.source}</span>
              <span className="iEvKind" data-kind={e.kind}>{e.kind}</span>
              <span className="iEvTime">{e.time}</span>
            </div>
            <div className="iEvText">{e.summary}</div>
          </div>
        ))
      ) : (
        <div className="iTermScreen" style={{ minHeight: 520 }}>
          {TERMINAL_LINES.map((l, i) => (
            <div key={i} className={`iTermLine iTermLine-${l.kind}`}>
              {l.kind === "prompt" && <span className="iTermSigil">$ </span>}{l.text}
            </div>
          ))}
          <div className="iTermLine"><span className="iTermSigil">$ </span><span className="iTermCursor" /></div>
        </div>
      )}
    </div>
  );
}
