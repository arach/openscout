"use client";

// Scout iOS — Entry: the composer-first Home.
//
// The front door inverted. Every prior Home treatment (and shipped native)
// greets with instrumentation — chart, quotas, lanes, logs — and buries
// dispatch at the bottom. The entry flips it: the phone is for STEERING, the
// Mac is for monitoring. One breath of pulse as the greeting, recents as a
// whisper, and one obvious action — the kit Composer docked above a realistic
// raised keyboard. Grammar lifted from the Steering Loop study's compose dock
// (views/scout-steering-loop.tsx, Block C): tapping the well opens the
// message-first compose sheet, routing as corrections.

import { Glyph } from "./Glyph";
import { Composer, RuntimeChip } from "./composer";
import { InboxRow } from "./surfaces";
import { TABS } from "./theme";
import { FLEET, COMMS, INBOX, groupByProject, inboxBlocking, type InboxItem } from "./data";

/** Sidebar/places mark — the way OUT of the front door, into the rest of
 *  Scout. Same stroke voice as <Glyph>. */
export function PlacesGlyph({ size = 18 }: { size?: number }) {
  const sw = Math.max(1, size * (2.1 / 24));
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="4.5" width="17" height="15" rx="3.5" />
      <path d="M9.75 4.5v15" />
    </svg>
  );
}

/** Keyboard toggle mark — a key slab with a chevron leaving it. One slab both
 *  ways so the pair reads as a single toggle; only the chevron turns. */
export function KeyboardToggleGlyph({ size = 18, up = false }: { size?: number; up?: boolean }) {
  const sw = Math.max(1, size * (1.5 / 24));
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="3.5" width="19" height="11" rx="2.6" />
      <path d="M6.6 7.4h1.2M11.4 7.4h1.2M16.2 7.4h1.2M7.6 11.2h8.8" />
      <path d={up ? "M8.4 21 12 17.4l3.6 3.6" : "m8.4 17.4 3.6 3.6 3.6-3.6"} />
    </svg>
  );
}

/** Entry masthead — places (the main Scout navigation) leads top-LEFT, the
 *  host you're steering sits beside it, gear trails. NO wordmark: on the
 *  composer-first front door the app's name is the one thing on the row that
 *  answers no question you have (the Fleet home, read at arm's length, keeps
 *  it). Both discs are ONE complication family: the crown study's machined
 *  plate at the crown's own seat scale (36px), never the accent. */
export function EntryMast() {
  return (
    <div className="iHead">
      <div className="iMast iMastEntry">
        <span className="iComplication"><PlacesGlyph size={16} /></span>
        <span className="iHostChip"><span className="iHostDot" />Arts Mac mini</span>
        <span className="iMastGap" />
        <span className="iComplication"><Glyph kind="gear" size={16} /></span>
      </div>
      <div className="iMastRule" />
    </div>
  );
}

/** The Places map — what the disc opens. The new-user's answer to "where can I
 *  go": every important destination with the one line that says what you'd do
 *  there. Every row is REAL navigation the shell already performs. */
const PLACES = [
  { kind: "agent", name: "Agents", blurb: "Who's working, and on what" },
  { kind: "comms", name: "Comms", blurb: "Conversations with your agents" },
  { kind: "pulse", name: "Tail", blurb: "Watch the work stream live" },
  { kind: "plus", name: "New session", blurb: "Start an agent on something" },
  { kind: "terminal", name: "Terminal", blurb: "A shell on your paired Mac" },
  { kind: "inbox", name: "Notifications", blurb: "What asked for you" },
  { kind: "gear", name: "Settings", blurb: "Connection, appearance, what Home shows" },
] as const;

export function EntryPlacesSheet() {
  return (
    <div className="iPlacesScrim">
      <div className="iPlacesSheet">
        <div className="iPlacesGrab" />
        <div className="iPlacesTitle">Places</div>
        <div className="iPlacesList">
          {PLACES.map((p) => (
            <div key={p.name} className="iPlaceRow">
              <span className="iPlaceGlyph"><Glyph kind={p.kind} size={19} /></span>
              <span className="iPlaceText">
                <span className="iPlaceName">{p.name}</span>
                <span className="iPlaceBlurb">{p.blurb}</span>
              </span>
              <span className="iPlaceCaret"><Glyph kind="chevron" size={12} /></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The pulse — kept ONLY for the documented exception-state study below. The
 *  shipped ambient entry has no headline and no stats: a greeting you have to
 *  read before you can type is a tax on the one thing this screen is for, and
 *  attention already lives in the bell / Notifications. */
function EntryPulse({ needs }: { needs: InboxItem[] }) {
  const live = FLEET.filter((a) => a.state === "live");
  const projects = groupByProject(FLEET);
  const paused = new Set(needs.map((n) => n.agent)).size;
  return (
    <div className="iEntryPulse">
      <div className="iEntryHeadline">
        {paused > 0
          ? `${paused} agents are paused on you.`
          : "Nothing needs you."}
      </div>
      <div className="iEntrySub">
        {FLEET.length} agents · {live.length} working · {projects.length} projects
      </div>
    </div>
  );
}

/** The attention interrupt — ONLY the blocking items (an agent is stopped
 *  until you move), settled inline. FYI kinds wait in Notifications; no
 *  "Clear" (deciding, or letting it wait, are the honest exits). */
function EntryNeeds({ items, rest }: { items: InboxItem[]; rest: number }) {
  return (
    <>
      <div className="iNeedHead">
        <span className="iNeedHeadLabel">Needs you</span>
        <span className="iNeedCount">{items.length}</span>
      </div>
      <div className="iCard">
        {items.map((it, i) => (
          <div key={it.id}>
            {i > 0 && <div className="iRowSep" />}
            <InboxRow it={it} />
          </div>
        ))}
      </div>
      {rest > 0 && <div className="iEntryMore">{rest} more in Notifications</div>}
    </>
  );
}

/** Recent conversations — a whisper, not a lane: the composer is the page,
 *  recency is just the shortest path back. Names muted, previews dim, no
 *  bold anywhere. When attention is up they yield to one row. */
function EntryRecents({ count = 3 }: { count?: number }) {
  const recent = COMMS.slice(0, count);
  return (
    <div className="iEntryRecents">
      {recent.map((c) => (
        <div key={c.id} className="iEntryRecent">
          <span className="iEntryConvName">{c.name}</span>
          <span className="iEntryConvPrev">{c.preview}</span>
          <span className="iEntryConvAge">{c.age}</span>
        </div>
      ))}
    </div>
  );
}

/** Smart actions — the app's best guess at your next steer, derived from real
 *  state (broker-smith asked you something · the swarm has a recap to give ·
 *  voice tray errored 12m ago), never canned prompts. One tap prefills the
 *  composer with the steer and hands you the keyboard. */
const SMART_ACTIONS = [
  { id: "reply", label: "Reply to broker-smith" },
  { id: "recap", label: "Catch me up" },
  { id: "voice", label: "Check on voice tray" },
  { id: "status", label: "Status on openscout" },
];

/** The line the system's QuickType strip used to own — now OURS. Smart-action
 *  pills scroll on the left (fading out before the pinned slot), the keyboard
 *  TOGGLE sits pinned right: down while the keyboard is up, up while it isn't,
 *  so the row can bring back what it dismissed. Persistent in both states.
 *
 *  Native note: this is a row in the surface's own dock stack, never a
 *  `.toolbar(placement: .keyboard)` — that placement merges across mounted
 *  surfaces and iOS 26 renders it as glass capsules. */
function AccessoryLine({
  actions,
  keyboardUp,
}: {
  actions: { id: string; label: string }[];
  keyboardUp: boolean;
}) {
  return (
    <div className="iAcc">
      <div className="iAccScroll">
        <div className="iAccPills">
          {actions.map((a) => (
            <span key={a.id} className="iAccPill">{a.label}</span>
          ))}
        </div>
      </div>
      <span className="iAccToggle">
        <KeyboardToggleGlyph size={18} up={!keyboardUp} />
      </span>
    </div>
  );
}

/** A realistic iOS keyboard slab. No QuickType strip: the composer declares
 *  `predictions: false`, so the system bar is gone and the accessory line above
 *  takes its place. Exported because every surface that raises the keyboard has
 *  to show what half the screen actually looks like — see the New-session
 *  destination study. */
export function EntryKeyboard() {
  return (
    <div className="iKb" aria-hidden>
      <div className="iKbRow">
        {"qwertyuiop".split("").map((c) => <span key={c} className="iKey">{c}</span>)}
      </div>
      <div className="iKbRow indent">
        {"asdfghjkl".split("").map((c) => <span key={c} className="iKey">{c}</span>)}
      </div>
      <div className="iKbRow">
        <span className="iKey iKeyMod iKeyShift">⇧</span>
        {"zxcvbnm".split("").map((c) => <span key={c} className="iKey">{c}</span>)}
        <span className="iKey iKeyMod iKeyBksp">⌫</span>
      </div>
      <div className="iKbRow iKbRowLast">
        <span className="iKey iKeyMod iKey123">123</span>
        <span className="iKey iKeySpace">space</span>
        <span className="iKey iKeyMod iKeyGo">return</span>
      </div>
    </div>
  );
}

/** The retired-cockpit bottom chrome: a floating liquid-glass capsule of the
 *  four kit tabs, no status ticker. The current tab sits on the SAME machined
 *  plate the masthead complications are cut from, so the top-left and the
 *  bottom read as one system — glass rail, graphite instruments. Staleness
 *  surfaces only when stale, as one dim line above the bar (`note`).
 *
 *  Native: `RootView.glassTabBar`, real `.glassEffect(.regular, in: .capsule)`
 *  via HudsonKit's `hudLiquidBarMaterial`. */
function EntryTabs({ note }: { note?: string } = {}) {
  return (
    <div className="iGlassRail">
      {note && <span className="iGlassNote">{note}</span>}
      <div className="iGlassBar">
        {TABS.map((t) => (
          <div className="iGlassTab" key={t.label} data-on={t.label === "Home"}>
            <span className="iGlassSeat">
              <Glyph kind={t.kind} size={19} />
              <span className="iGlassLabel">{t.label}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The composer-first Home, v2. The resting body is AIR, then the whisper of
 *  recents, then the composer — nothing that asks to be read before you can
 *  type. No headline, no stats, no needs-you lane: attention lives in the
 *  masthead bell / Notifications and in the classic Fleet Home, and duplicating
 *  it here only taxed the one thing this screen is for.
 *
 *  Below the composer sits OUR accessory line (smart-action pills + the
 *  keyboard toggle), then the keyboard — which covers the tab bar, standard
 *  iOS. `attention` keeps the documented exception-state study: the same front
 *  door with the blocking interrupt, kept as a design record of what we
 *  deliberately did not ship. */
export function EntrySurface({
  attention = false,
  resting = false,
}: { attention?: boolean; resting?: boolean } = {}) {
  const blocking = attention ? INBOX.filter(inboxBlocking) : [];
  if (attention) {
    return (
      <>
        <div className="iBody iEntry">
          <EntryPulse needs={blocking} />
          {blocking.length > 0 && <EntryNeeds items={blocking} rest={INBOX.length - blocking.length} />}
          <div className="iEntryAir" />
          <EntryRecents count={1} />
        </div>
        <div className="iEntryDock"><Composer tools={<RuntimeChip />} /></div>
        <AccessoryLine actions={SMART_ACTIONS} keyboardUp={false} />
        <EntryTabs />
      </>
    );
  }
  return (
    <>
      <div className="iBody iEntry">
        <div className="iEntryAir" />
        <EntryRecents count={5} />
      </div>
      {/* autoFocus, not a mock "focused" flag: the ambient entry's resting
          state is keyboard-up, so the field really does hold focus. */}
      <div className="iEntryDock"><Composer autoFocus={!resting} tools={<RuntimeChip />} /></div>
      <AccessoryLine actions={SMART_ACTIONS} keyboardUp={!resting} />
      {/* Keyboard down, the glass bar is what the screen ends on; keyboard up,
          the keys COVER it (standard iOS) and it isn't drawn at all. */}
      {resting ? <EntryTabs /> : <EntryKeyboard />}
    </>
  );
}

/** First run — the screen every new user actually sees, designed rather than
 *  a fallback card: one promise, one action (the LAN pairing that already
 *  ships), one hint. No composer yet — nothing to ask until a Mac is paired. */
export function EntryFirstRun() {
  return (
    <>
      <div className="iBody iEntry">
        <div className="iEntryWelcome">
          <div className="iEntryHeadline big">Your agents, one&nbsp;tap&nbsp;away.</div>
          <p className="iEntryPromise">
            Scout pairs with your Mac and puts the coding agents running there
            in your pocket — watch them work, answer when they ask, start new
            work from anywhere.
          </p>
          <div className="iEntryConnect">Connect your Mac</div>
          <div className="iEntryHint">Scout finds Macs on your Wi-Fi — pairing is one tap.</div>
        </div>
      </div>
      <EntryTabs />
    </>
  );
}
