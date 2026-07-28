"use client";

// Scout iOS — New session · the DESTINATION picker.
//
// The two decisions that gate Start on a phone: which paired Mac the session
// lands on, and which project it runs in. Three genuinely different answers,
// not three colourways of one:
//
//   · Rule    — the destination IS the page. A plane of host readout, a bare
//               query line on a rule, and a ranked list. Nothing is hidden.
//   · Readout — the destination is ONE line above the composer, and that same
//               line is the search field. Matches rise above it as you type.
//   · Sheet   — the destination is a line in the composer's own header, and it
//               opens a page that owns the screen.
//
// THE CONSTRAINT they all solve. The composer is a filled rounded pill. The
// first native attempt put a filled rounded HudField directly above it and you
// could not tell at a glance which of the two was the one you type the task
// into. So: hairlines and eyebrows carry the structure, the query is a bare
// line rather than a box, and the pill stays the only pill on the glass. The
// one boxed field in the file is treatment 3's, inside the sheet — legal
// exactly because the composer is off-screen while it exists.

import { useState } from "react";
import { Glyph } from "./Glyph";
import { HarnessMark } from "../HarnessMark";
import { Composer, RuntimeChip } from "./composer";
import { EntryKeyboard, KeyboardToggleGlyph } from "./entry-surface";
import {
  MACS_FLEET,
  MACS_SOLO,
  RECENT_ROOTS,
  WORKSPACES,
  WORKSPACES_EMPTY,
  WORKSPACES_STRESS,
  abbreviatePath,
  curateWorkspaces,
  demotedSummary,
  filterWorkspaces,
  groupWorkspaces,
  parentPath,
  promoteWorkspaces,
  typedPath,
  workspaceActivity,
  workspaceKind,
  type PairedMac,
  type Workspace,
} from "./data";

// ── Fixture selection ───────────────────────────────────────────────────────

/** The three fleets every treatment has to survive. */
export type DestFleet = "solo" | "stress" | "empty";

export function destFixture(fleet: DestFleet): { macs: PairedMac[]; workspaces: Workspace[] } {
  if (fleet === "stress") return { macs: MACS_FLEET, workspaces: WORKSPACES_STRESS };
  if (fleet === "empty") return { macs: MACS_SOLO, workspaces: WORKSPACES_EMPTY };
  return { macs: MACS_SOLO, workspaces: WORKSPACES };
}

export interface DestProps {
  fleet?: DestFleet;
  /** The keyboard is up: half the screen is gone, and the surface has to still
   *  be usable. Every treatment renders its focused state here. */
  keyboard?: boolean;
}

/** The default pick — the first workspace with agents in it, else the first. */
function initialPick(workspaces: Workspace[]) {
  return workspaces.find((ws) => workspaceActivity(ws))?.root ?? workspaces[0]?.root ?? "";
}

/** Where you started work most recently — the join that makes a short list
 *  worth showing. Derived from the agent inventory, never a workspace field. */
function recentWorkspaces(workspaces: Workspace[], limit = 3) {
  return workspaces.filter((ws) => workspaceActivity(ws)).slice(0, limit);
}

// ── Shared parts ────────────────────────────────────────────────────────────

/** One project. A flat full-width row — the one shape the house rules let an
 *  edge marker sit on — so the pick is a travelling 2px accent bar, and the
 *  mark on the left is the harness this workspace actually recommends. */
function ProjectRow({
  ws, on, onPick, tail,
}: { ws: Workspace; on: boolean; onPick: () => void; tail?: "activity" | "path" }) {
  const activity = workspaceActivity(ws);
  return (
    <button className="iDestRow" data-on={on || undefined} onClick={onPick}>
      <span className="iDestMark">
        {ws.defaultHarness
          ? <HarnessMark harness={ws.defaultHarness} size={13} title={null} />
          : <Glyph kind="folder" size={12} />}
      </span>
      <span className="iDestName">{ws.projectName}</span>
      <span className="iDestSpacer" />
      {tail === "path" && (
        <span className="iDestTail">{tailPath(abbreviatePath(parentPath(ws.root)))}</span>
      )}
      {tail === "activity" && activity && (
        <span className="iDestMeta" data-live={activity.live || undefined}>
          {activity.count} · {activity.age}
        </span>
      )}
    </button>
  );
}

/** The manual-path escape hatch: a query that IS a path no workspace answers.
 *  The Mac may well hold a checkout its index has never seen. */
function TypedPathRow({ path, on, onPick }: { path: string; on: boolean; onPick: () => void }) {
  const leaf = path.split("/").filter(Boolean).pop() ?? path;
  return (
    <button className="iDestRow" data-on={on || undefined} onClick={onPick}>
      <span className="iDestMark"><Glyph kind="folder" size={12} /></span>
      <span className="iDestName">{leaf}</span>
      <span className="iDestSpacer" />
      <span className="iDestUse">Use this path</span>
    </button>
  );
}

/** Which Mac. ONE paired Mac is a readout, not a choice; several become plates
 *  with the target lit. Every paired Mac shows, including the sleeping one —
 *  hiding it turns "your Mac is asleep" into "you have no Macs" — and an
 *  offline plate simply is not selectable. */
function HostControl({
  macs, macId, onPick, label = true,
}: { macs: PairedMac[]; macId: string; onPick: (id: string) => void; label?: boolean }) {
  const only = macs.length === 1 ? macs[0] : null;
  return (
    <div className="iDestHost">
      {label && <span className="iDestEyebrow">Host</span>}
      {macs.length === 0 && <span className="iDestHostName">Not connected</span>}
      {only && (
        <span className="iDestHostRead">
          {only.isOnline
            ? <span className="iDot" style={{ background: "var(--i-accent)" }} />
            : <span className="iRing" />}
          <span className="iDestHostName">{only.name}</span>
          {!only.isOnline && <span className="iDestHostTag">offline</span>}
        </span>
      )}
      {macs.length > 1 && (
        <div className="iDestHostChips">
          {macs.map((m) => (
            <button key={m.id} className="iDestHostChip"
              data-on={m.id === macId || undefined}
              data-off={!m.isOnline || undefined}
              onClick={() => m.isOnline && onPick(m.id)}>
              {m.isOnline
                ? <span className="iDot" style={{ background: "var(--i-accent)" }} />
                : <span className="iRing" />}
              {m.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Honest about WHICH nothing this is. */
function EmptyNotice({ query, macs }: { query: string; macs: PairedMac[] }) {
  if (macs.every((m) => !m.isOnline)) {
    return <div className="iDestNotice">Every paired Mac is asleep. <b>Wake one</b> to choose a project.</div>;
  }
  if (query.trim()) {
    return <div className="iDestNotice">No project matches <b>{query.trim()}</b>. Type a full path to use one anyway.</div>;
  }
  return (
    <div className="iDestNotice">
      <b>{macs[0]?.name ?? "This Mac"}</b> hasn&apos;t reported any projects yet.<br />
      Open a repo there once, or type its full path above.
    </div>
  );
}

/** The composer dock. A fixed given — the SAME atom the Home front door uses,
 *  in the same pill appearance. This study only decides where it sits and what
 *  stands beside it. */
function Dock({ standby, header }: { standby?: boolean; header?: React.ReactNode }) {
  return (
    <div className={`iEntryDock${standby ? " iDestStandby" : ""}`}>
      <Composer placeholder="Describe the task, or leave blank…" header={header} tools={<RuntimeChip />} />
    </div>
  );
}

// ── Baseline · SHIPPED ──────────────────────────────────────────────────────

/**
 * A faithful port of what is on the phone today (NewSessionSurface.swift, the
 * `destination` region): HOST eyebrow + readout, a rule, the bare search line,
 * a rule, a `PROJECT · n of m` eyebrow, then the machine's inventory in the
 * order `listWorkspaces` returned it — every row carrying the same dim `~/dev`
 * tail. Here to be argued with, not shipped from.
 */
export function DestinationShipped({ fleet = "solo", keyboard = false }: DestProps) {
  const { macs, workspaces } = destFixture(fleet);
  const [macId, setMacId] = useState(macs.find((m) => m.isActive)?.id ?? macs[0]?.id ?? "");
  const [pick, setPick] = useState(workspaces[0]?.root ?? "");
  const [query, setQuery] = useState(keyboard ? "har" : "");

  const matches = filterWorkspaces(workspaces, query);
  const typed = typedPath(workspaces, query);
  const searching = query.trim().length > 0;

  return (
    <>
      <div className="iBody iDest">
        <HostControl macs={macs} macId={macId} onPick={setMacId} />
        <div className="iDestRule" />
        <div className="iDestQuery">
          <Glyph kind="search" size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter projects, or type a path" spellCheck={false} />
          {searching && (
            <button className="iDestQueryClear" onClick={() => setQuery("")} aria-label="Clear search">✕</button>
          )}
        </div>
        <div className="iDestRule" />
        <div className="iDestBand">
          <span className="iDestEyebrow">Project</span>
          {matches.length > 0 && (
            <span className="iDestQueryCount">
              {searching ? `${matches.length} of ${workspaces.length}` : workspaces.length}
            </span>
          )}
        </div>
        <div className="iDestScroll">
          {typed && <TypedPathRow path={typed} on={pick === typed} onPick={() => setPick(typed)} />}
          {matches.map((ws) => (
            <ProjectRow key={ws.id} ws={ws} on={pick === ws.root}
              onPick={() => setPick(ws.root)} tail="path" />
          ))}
          {matches.length === 0 && !typed && <EmptyNotice query={query} macs={macs} />}
        </div>
      </div>
      <Dock />
      {keyboard && <EntryKeyboard />}
    </>
  );
}

// ── Treatment 1 · RULE ──────────────────────────────────────────────────────

/**
 * The destination IS the page. Host readout, a bare query line on a rule, and
 * the whole inventory underneath — nothing hidden behind a tap. Two things the
 * shipped native does not do: the count rides on the query line (where the
 * narrowing happens, saving a whole eyebrow row), and the list is STRUCTURED —
 * a short "where you're working" band derived from the live agents, then the
 * rest grouped under their parent directories, so `~/dev` is said once at the
 * top of a group instead of repeated on all twenty-six of its rows.
 */
export function DestinationRule({ fleet = "solo", keyboard = false }: DestProps) {
  const { macs, workspaces } = destFixture(fleet);
  const [macId, setMacId] = useState(macs.find((m) => m.isActive)?.id ?? macs[0]?.id ?? "");
  const [pick, setPick] = useState(() => initialPick(workspaces));
  const [query, setQuery] = useState(keyboard ? "har" : "");

  const matches = filterWorkspaces(workspaces, query);
  const typed = typedPath(workspaces, query);
  const searching = query.trim().length > 0;
  const recent = recentWorkspaces(workspaces, 4);
  // A project promoted into the band must NOT appear again in its parent group
  // four rows later. Saying the same four names twice in one viewport is the
  // fastest way to make a ranked list read as an unranked one.
  const promoted = new Set(searching ? [] : recent.map((ws) => ws.root));
  const groups = groupWorkspaces(matches.filter((ws) => !promoted.has(ws.root)));

  return (
    <>
      <div className="iBody iDest">
        <HostControl macs={macs} macId={macId} onPick={setMacId} />
        <div className="iDestRule" />
        <div className="iDestQuery">
          <Glyph kind="search" size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter projects, or type a path" spellCheck={false} />
          <span className="iDestQueryCount">
            {searching ? `${matches.length} of ${workspaces.length}` : workspaces.length}
          </span>
          {searching && (
            <button className="iDestQueryClear" onClick={() => setQuery("")} aria-label="Clear search">✕</button>
          )}
        </div>
        <div className="iDestRule" data-soft />

        <div className="iDestScroll">
          {typed && <TypedPathRow path={typed} on={pick === typed} onPick={() => setPick(typed)} />}

          {!searching && recent.length > 0 && (
            <>
              <div className="iDestBand">
                <span className="iDestEyebrow">Where you&apos;re working</span>
                <span className="iDestBandRule" />
                <span className="iDestQueryCount">{recent.length}</span>
              </div>
              {recent.map((ws) => (
                <ProjectRow key={`r-${ws.id}`} ws={ws} on={pick === ws.root}
                  onPick={() => setPick(ws.root)} tail="activity" />
              ))}
            </>
          )}

          {searching
            ? matches.map((ws) => (
                <ProjectRow key={ws.id} ws={ws} on={pick === ws.root}
                  onPick={() => setPick(ws.root)} tail="path" />
              ))
            : groups.map((g) => (
                <div key={g.parent}>
                  <div className="iDestGroup">
                    <span className="iDestGroupPath">{g.parent}</span>
                    <span className="iDestGroupCount">{g.items.length}</span>
                  </div>
                  {g.items.map((ws) => (
                    <ProjectRow key={ws.id} ws={ws} on={pick === ws.root}
                      onPick={() => setPick(ws.root)} />
                  ))}
                </div>
              ))}

          {matches.length === 0 && !typed && <EmptyNotice query={query} macs={macs} />}
        </div>
      </div>
      <Dock />
      {keyboard && <EntryKeyboard />}
    </>
  );
}

// ── Treatment 2 · READOUT ───────────────────────────────────────────────────

/**
 * The destination is ONE line, pinned directly above the composer, and that
 * same line is the search field. Tap it and it takes the caret; matches rise
 * ABOVE it (nearest the thumb, the way a quick-open does) while the composer
 * visibly stands down — so there is exactly one live field on the screen at
 * any moment, and it is never ambiguous which. Scales flat: at 200 workspaces
 * it renders seven rows, same as at forty.
 */
export function DestinationReadout({ fleet = "solo", keyboard = false }: DestProps) {
  const { macs, workspaces } = destFixture(fleet);
  const [macId, setMacId] = useState(macs.find((m) => m.isActive)?.id ?? macs[0]?.id ?? "");
  const [pick, setPick] = useState(() => initialPick(workspaces));
  const [live, setLive] = useState(keyboard);
  const [query, setQuery] = useState(keyboard ? "ha" : "");

  const mac = macs.find((m) => m.id === macId) ?? macs[0];
  const chosen = workspaces.find((ws) => ws.root === pick);
  const matches = filterWorkspaces(workspaces, query);
  const typed = typedPath(workspaces, query);
  const shown = matches.slice(0, 6);
  const rest = matches.length - shown.length;
  const recent = recentWorkspaces(workspaces, 3);

  return (
    <>
      <div className="iBody iDest">
        <div className="iDestRest">
          {!live && recent.length > 0 && (
            <div className="iDestRecents">
              <div className="iDestRecentsHead">
                <span className="iDestEyebrow">Recent</span>
                <span className="iDestBandRule" />
              </div>
              {recent.map((ws) => (
                <ProjectRow key={ws.id} ws={ws} on={pick === ws.root}
                  onPick={() => setPick(ws.root)} tail="activity" />
              ))}
            </div>
          )}
          {!live && recent.length === 0 && <EmptyNotice query="" macs={macs} />}
        </div>
      </div>

      {live && (
        <div className="iDestResults">
          {typed && <TypedPathRow path={typed} on={pick === typed} onPick={() => setPick(typed)} />}
          {shown.map((ws) => (
            <ProjectRow key={ws.id} ws={ws} on={pick === ws.root}
              onPick={() => setPick(ws.root)} tail="path" />
          ))}
          {matches.length === 0 && !typed && <EmptyNotice query={query} macs={macs} />}
          {rest > 0 && <div className="iDestResultsFoot">+{rest} more — keep typing</div>}
        </div>
      )}

      <div className="iDestReadout" data-live={live || undefined} onClick={() => setLive(true)}>
        <span className="iDestReadoutCaret">{live ? "›" : "▸"}</span>
        {live ? (
          <input value={query} autoFocus onChange={(e) => setQuery(e.target.value)}
            placeholder={`${mac?.name ?? ""} · filter projects or type a path`} spellCheck={false} />
        ) : (
          <span className="iDestReadoutText">
            {mac ? `${mac.name} · ` : ""}
            {chosen ? abbreviatePath(chosen.root) : <em>choose a project</em>}
          </span>
        )}
        <span className="iDestReadoutHint">{live ? `${matches.length}/${workspaces.length}` : "Change"}</span>
      </div>

      <Dock standby={live} />
      {keyboard && <EntryKeyboard />}
    </>
  );
}

// ── Treatment 3 · SHEET ─────────────────────────────────────────────────────

/**
 * The destination rides in the composer's OWN header slot — an attribute of the
 * message rather than a control beside it — and opens a page that owns the
 * screen. The resting screen is therefore pure composer, and the picker gets
 * the whole 44pt-per-row budget it wants: host plates, a real search field, the
 * inventory grouped by parent. The boxed field is safe here for one reason
 * only: while it exists, the pill does not.
 */
export function DestinationSheet({ fleet = "solo", keyboard = false }: DestProps) {
  const { macs, workspaces } = destFixture(fleet);
  const [macId, setMacId] = useState(macs.find((m) => m.isActive)?.id ?? macs[0]?.id ?? "");
  const [pick, setPick] = useState(() => initialPick(workspaces));
  const [open, setOpen] = useState(keyboard);
  const [query, setQuery] = useState(keyboard ? "acme" : "");

  const mac = macs.find((m) => m.id === macId) ?? macs[0];
  const chosen = workspaces.find((ws) => ws.root === pick);
  const matches = filterWorkspaces(workspaces, query);
  const typed = typedPath(workspaces, query);
  const searching = query.trim().length > 0;
  const groups = groupWorkspaces(matches);
  const recent = recentWorkspaces(workspaces, 3);

  const headerLine = (
    <div className="iDestHeaderLine" onClick={() => setOpen(true)}>
      {mac?.isOnline
        ? <span className="iDot" style={{ background: "var(--i-accent)" }} />
        : <span className="iRing" />}
      <span className="iDestHeaderPath">
        {mac ? `${mac.name} · ` : ""}
        {chosen ? chosen.projectName : <em>choose a destination</em>}
      </span>
      <span className="iDestHeaderChev"><Glyph kind="chevron" size={11} rotate={90} /></span>
    </div>
  );

  return (
    <>
      <div className="iBody iDest">
        <div className="iDestRest">
          {recent.length > 0 ? (
            <div className="iDestRecents">
              <div className="iDestRecentsHead">
                <span className="iDestEyebrow">Recent</span>
                <span className="iDestBandRule" />
              </div>
              {recent.map((ws) => (
                <ProjectRow key={ws.id} ws={ws} on={pick === ws.root}
                  onPick={() => setPick(ws.root)} tail="activity" />
              ))}
            </div>
          ) : <EmptyNotice query="" macs={macs} />}
        </div>
      </div>

      <Dock header={headerLine} />
      {keyboard && <EntryKeyboard />}

      {open && (
        <div className="iDestSheetScrim" data-kb={keyboard || undefined} onClick={() => setOpen(false)}>
          <div className="iDestSheet" onClick={(e) => e.stopPropagation()}>
            <div className="iDestSheetGrab" />
            <div className="iDestSheetHead">
              <span className="iDestSheetTitle">Destination</span>
              {macs.length === 1 && <span className="iDestSheetSub">{macs[0].name}</span>}
              <button className="iDestSheetDone" onClick={() => setOpen(false)}>Done</button>
            </div>

            {macs.length > 1 && <HostControl macs={macs} macId={macId} onPick={setMacId} />}

            <div className="iField">
              <Glyph kind="search" size={14} />
              <input value={query} autoFocus={keyboard} onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter projects, or type a path" spellCheck={false} />
              <span className="iDestQueryCount">
                {searching ? `${matches.length} of ${workspaces.length}` : workspaces.length}
              </span>
            </div>

            <div className="iDestSheetList">
              {typed && (
                <TypedPathRow path={typed} on={pick === typed}
                  onPick={() => { setPick(typed); setOpen(false); }} />
              )}
              {searching
                ? matches.map((ws) => (
                    <ProjectRow key={ws.id} ws={ws} on={pick === ws.root}
                      onPick={() => { setPick(ws.root); setOpen(false); }} tail="path" />
                  ))
                : groups.map((g) => (
                    <div key={g.parent}>
                      <div className="iDestGroup">
                        <span className="iDestGroupPath">{g.parent}</span>
                        <span className="iDestGroupCount">{g.items.length}</span>
                      </div>
                      {g.items.map((ws) => (
                        <ProjectRow key={ws.id} ws={ws} on={pick === ws.root}
                          onPick={() => { setPick(ws.root); setOpen(false); }} tail="activity" />
                      ))}
                    </div>
                  ))}
              {matches.length === 0 && !typed && <EmptyNotice query={query} macs={macs} />}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Treatment 4 · CALM (the Home-shaped front door) ─────────────────────────
//
// The operator's direction, after feel-testing the shipped surface against a
// Mac that was finally reporting real data:
//
//   "new session should probably be a bit more like home … real diff is that
//    instead of default host and recent chats, we pick host and projects"
//   "we don't need the full screen to be taken up by that. I think three is a
//    good enough amount and that way the host picker and the project picker
//    would be kind of number 1 number 2 in that section of the screen. And we
//    can start with basically a clean view."
//
// So New stops being a picker with a composer stapled underneath and becomes
// the SAME room as the Entry home with different furniture: air on top, one
// quiet lane hugging the composer, the composer docked, and the keyboard
// toggle beneath it. Home's lane is recent conversations under an implied
// host; New's lane is the two things that gate Start — ① which Mac, ② which
// project — and it is three rows deep, not thirty.
//
// Three rows is only livable because the inventory is CURATED (see
// curateWorkspaces): the real list is 57 rows of which more than a third are
// worktree clones, /tmp checkouts and the folders those live in. Those are
// kept and labelled, one tap away, rather than interleaved as peers.
//
// The open question the operator asked for takes on is WHERE SEARCH LIVES when
// the resting list is three rows deep. Three answers, same frame:
//   · standing — a bare query line in the lane, always there.
//   · picker   — no query at rest; the lane's foot opens a page that owns the
//                screen, and that page is where you search.
//   · expand   — no query at rest; the lane grows upward into the air in
//                place, taking a query line with it. No modal.

export type CalmSearch = "standing" | "picker" | "expand";

export interface CalmProps extends DestProps {
  search?: CalmSearch;
}

/** Host — ① of the destination section. ONE Mac is a readout on its own line,
 *  which is the common case and must cost the common case nothing: a label, a
 *  dot and a name, no band, no rule of its own, no row it doesn't earn. More
 *  than one Mac and the same line grows plates — that is when it becomes a
 *  choice, and only then. */
function CalmHost({ macs, macId, onPick }: { macs: PairedMac[]; macId: string; onPick: (id: string) => void }) {
  const only = macs.length === 1 ? macs[0] : null;
  return (
    <div className="iCalmHost">
      <span className="iCalmLabel">Host</span>
      {macs.length === 0 && <span className="iCalmHostName" data-none>Not connected</span>}
      {only && (
        <>
          {only.isOnline
            ? <span className="iDot" style={{ background: "var(--i-accent)" }} />
            : <span className="iRing" />}
          <span className="iCalmHostName">{only.name}</span>
          {!only.isOnline && <span className="iDestHostTag">offline</span>}
        </>
      )}
      {macs.length > 1 && (
        <div className="iCalmHostChips">
          {macs.map((m) => (
            <button key={m.id} className="iDestHostChip"
              data-on={m.id === macId || undefined}
              data-off={!m.isOnline || undefined}
              onClick={() => m.isOnline && onPick(m.id)}>
              {m.isOnline
                ? <span className="iDot" style={{ background: "var(--i-accent)" }} />
                : <span className="iRing" />}
              {m.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One project in the calm lane. Same flat full-width row as everywhere else,
 *  but the name/path collision is designed OUT rather than left to chance: the
 *  name holds a floor width and the path is the side that gives — it shrinks,
 *  truncates from the head (`…/openscout` keeps the meaningful end) and finally
 *  disappears rather than ever colliding with the name. On the shipped surface
 *  `Openscout Work List Wt` and `/private/tmp` overlapped outright. */
/** Cut a path from the HEAD, in code. CSS can only ellipsize the tail, and the
 *  `direction: rtl` trick that fakes a head-cut also reorders the neutrals —
 *  `~/dev` renders as `dev/~`. The end of a path is the part that means
 *  something, so the start is what goes. */
function tailPath(path: string, max = 22) {
  return path.length <= max ? path : `…${path.slice(-(max - 1))}`;
}

function CalmRow({
  ws, on, onPick, path = true, kind,
}: { ws: Workspace; on: boolean; onPick: () => void; path?: boolean; kind?: string }) {
  return (
    <button className="iCalmRow" data-on={on || undefined} onClick={onPick}>
      <span className="iCalmMark">
        {ws.defaultHarness
          ? <HarnessMark harness={ws.defaultHarness} size={13} title={null} />
          : <Glyph kind="folder" size={12} />}
      </span>
      <span className="iCalmName">{ws.projectName}</span>
      {kind && <span className="iCalmKind">{kind}</span>}
      {path && <span className="iCalmPath">{tailPath(abbreviatePath(parentPath(ws.root)))}</span>}
    </button>
  );
}

/** The foot of the lane — ②'s way out to everything else. Carries the count,
 *  so no eyebrow row has to, and says in one dim line what is being kept back,
 *  because a hidden pile you can't name is just a missing list. */
function CalmMore({
  total, demoted, all, onOpen, label,
}: { total: number; demoted: Workspace[]; all: Workspace[]; onOpen: () => void; label?: string }) {
  // The summary names the pile being held BACK, so it is only true while the
  // lane is resting on its shortlist. Once the lane is searching or open,
  // nothing is held back and saying so would be a lie.
  const summary = label ? "" : demotedSummary(demoted, all);
  return (
    <button className="iCalmMore" onClick={onOpen}>
      <span className="iCalmMoreText">{label ?? `All ${total} projects`}</span>
      {summary && <span className="iCalmMoreSub">{summary}</span>}
      {!label && <span className="iCalmMoreChev"><Glyph kind="chevron" size={12} /></span>}
    </button>
  );
}

/** The bare query line — never a box. Used by `standing` in the lane and by
 *  `expand` at the head of the grown lane; the `picker` page uses a real field
 *  instead, legal there because the pill is off-screen. */
function CalmQuery({
  value, onChange, count, autoFocus,
}: { value: string; onChange: (v: string) => void; count?: string; autoFocus?: boolean }) {
  return (
    <div className="iCalmQuery">
      <Glyph kind="search" size={13} />
      <input value={value} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)}
        placeholder="Filter projects, or type a path" spellCheck={false} />
      {count && <span className="iDestQueryCount">{count}</span>}
      {value && (
        <button className="iDestQueryClear" onClick={() => onChange("")} aria-label="Clear search">✕</button>
      )}
    </div>
  );
}

/** The keyboard toggle, BELOW the composer — the seat the operator drew a line
 *  to. Not a `.toolbar(placement: .keyboard)` (that placement merges across
 *  mounted surfaces and iOS 26 renders it as glass capsules), and not Home's
 *  above-composer accessory strip either: New has no honest smart actions to
 *  put on such a strip, so the control gets its own thin line under the dock
 *  and nothing keeps it company. Persistent in both states — it is how the
 *  keyboard comes back. */
function CalmKeyboardBar({ up }: { up: boolean }) {
  return (
    <div className="iCalmKbBar" data-kb={up || undefined}>
      <span className="iCalmKbToggle"><KeyboardToggleGlyph size={17} up={!up} /></span>
    </div>
  );
}

/** The picker page for `picker` — a page that owns the screen, so search can be
 *  a real field. Durable roots lead; the swept-up pile sits under its own head
 *  rather than interleaved. */
function CalmPage({
  macs, workspaces, pick, onPick, onClose, query, setQuery,
}: {
  macs: PairedMac[]; workspaces: Workspace[]; pick: string; onPick: (r: string) => void;
  onClose: () => void; query: string; setQuery: (v: string) => void;
}) {
  const matches = filterWorkspaces(workspaces, query);
  const typed = typedPath(workspaces, query);
  const { durable, demoted } = curateWorkspaces(matches);
  const searching = query.trim().length > 0;
  return (
    <div className="iCalmPage">
      <div className="iCalmPageHead">
        <span className="iCalmPageTitle">Project</span>
        {macs.length === 1 && <span className="iDestSheetSub">{macs[0].name}</span>}
        <button className="iDestSheetDone" onClick={onClose}>Done</button>
      </div>
      <div className="iField">
        <Glyph kind="search" size={14} />
        <input value={query} autoFocus onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter projects, or type a path" spellCheck={false} />
        <span className="iDestQueryCount">
          {searching ? `${matches.length} of ${workspaces.length}` : workspaces.length}
        </span>
      </div>
      <div className="iCalmPageList">
        {typed && <TypedPathRow path={typed} on={pick === typed} onPick={() => { onPick(typed); onClose(); }} />}
        {durable.map((ws) => (
          <CalmRow key={ws.id} ws={ws} on={pick === ws.root} onPick={() => { onPick(ws.root); onClose(); }} />
        ))}
        {demoted.length > 0 && (
          <>
            <div className="iCalmPageBand">
              <span className="iDestEyebrow">Worktrees &amp; scratch</span>
              <span className="iDestBandRule" />
              <span className="iDestQueryCount">{demoted.length}</span>
            </div>
            {demoted.map((ws) => (
              <CalmRow key={ws.id} ws={ws} on={pick === ws.root}
                onPick={() => { onPick(ws.root); onClose(); }}
                kind={workspaceKind(ws, workspaces)} />
            ))}
          </>
        )}
        {matches.length === 0 && !typed && <EmptyNotice query={query} macs={macs} />}
      </div>
    </div>
  );
}

/**
 * The calm New — one frame, three search takes.
 */
export function DestinationCalm({ fleet = "solo", keyboard = false, search = "standing" }: CalmProps) {
  const { macs, workspaces } = destFixture(fleet);
  const [macId, setMacId] = useState(macs.find((m) => m.isActive)?.id ?? macs[0]?.id ?? "");
  const [query, setQuery] = useState(keyboard && search !== "picker" ? "op" : keyboard ? "op" : "");
  const [open, setOpen] = useState(keyboard && search !== "standing");

  const { durable, demoted } = curateWorkspaces(workspaces);
  const shortlist = promoteWorkspaces(durable, RECENT_ROOTS, 3);
  const [pick, setPick] = useState(shortlist[0]?.root ?? durable[0]?.root ?? "");

  const searching = query.trim().length > 0;
  const matches = filterWorkspaces(workspaces, query);
  const typed = typedPath(workspaces, query);
  // Curate the RESULTS too — a search for "openscout" against the real list
  // returns four things called openscout, three of which are clones.
  const curatedMatches = curateWorkspaces(matches);

  // `standing` searches in place; `expand` grows the lane; `picker` leaves the
  // lane alone entirely and opens a page.
  const inlineSearch = search === "standing" || (search === "expand" && open);
  const grown = search === "expand" && open;
  const rows = inlineSearch && searching
    ? [...curatedMatches.durable, ...curatedMatches.demoted].slice(0, grown ? 8 : 4)
    : shortlist;

  return (
    <>
      <div className="iBody iDest iCalm" data-grown={grown || undefined}>
        <div className="iCalmAir" />
        <div className="iCalmSection">
          <CalmHost macs={macs} macId={macId} onPick={setMacId} />
          <div className="iCalmRule" />
          {inlineSearch && (
            <CalmQuery
              value={query}
              onChange={setQuery}
              autoFocus={grown}
              count={searching ? `${matches.length} of ${workspaces.length}` : undefined}
            />
          )}
          <div className="iCalmList">
            {inlineSearch && typed && (
              <TypedPathRow path={typed} on={pick === typed} onPick={() => setPick(typed)} />
            )}
            {rows.map((ws) => (
              <CalmRow key={ws.id} ws={ws} on={pick === ws.root} onPick={() => setPick(ws.root)}
                kind={inlineSearch && searching && workspaceKind(ws, workspaces) !== "project"
                  ? workspaceKind(ws, workspaces) : undefined} />
            ))}
            {rows.length === 0 && !typed && <EmptyNotice query={query} macs={macs} />}
          </div>
          {workspaces.length > 0 && (
            <CalmMore
              total={workspaces.length}
              demoted={demoted}
              all={workspaces}
              onOpen={() => setOpen(true)}
              label={grown ? "Close" : searching && inlineSearch
                ? `${matches.length} of ${workspaces.length} match`
                : undefined}
            />
          )}
        </div>
      </div>

      <div className="iEntryDock">
        <Composer placeholder="Describe the task, or leave blank…" tools={<RuntimeChip />} />
      </div>
      <CalmKeyboardBar up={keyboard} />
      {keyboard && <EntryKeyboard />}

      {search === "picker" && open && (
        <div className="iCalmPageScrim" data-kb={keyboard || undefined}>
          <CalmPage macs={macs} workspaces={workspaces} pick={pick} onPick={setPick}
            onClose={() => setOpen(false)} query={query} setQuery={setQuery} />
        </div>
      )}
    </>
  );
}
