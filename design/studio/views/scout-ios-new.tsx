"use client";

// Scout iOS · New session — the DESTINATION picker lab.
//
// This screen was built straight in Swift and never designed, so this study
// goes back and does the studio pass properly: three genuinely different
// answers to "how do you choose a Mac and a project on a phone", each shown
// against the three fleets it actually has to survive.

import { useState } from "react";
import {
  DestinationCalm,
  DestinationReadout,
  DestinationRule,
  DestinationSheet,
  DestinationShipped,
  DetailHeader,
  Seg,
  SurfaceLab,
  type DestFleet,
} from "@/components/scout-ios";

/** The three worlds. Solo is the common case by a mile — and since 2026-07-28
 *  it is the REAL one, transcribed off the phone the day pairing started
 *  working: 57 rows, of which a third are worktree clones, /tmp checkouts and
 *  the folders those live in. Stress breaks list-first designs; empty is what
 *  a new user sees first. */
const FLEETS: { id: DestFleet; label: string }[] = [
  { id: "solo", label: "1 Mac · 57 (real)" },
  { id: "stress", label: "3 Macs · 221" },
  { id: "empty", label: "Fresh · 0" },
];

export default function ScoutIOSNewStudy() {
  const [fleet, setFleet] = useState<DestFleet>("solo");
  const [kb, setKb] = useState(false);

  // Remount on every control change so each state opens in its resting posture
  // rather than inheriting the last treatment's query.
  const k = `${fleet}-${kb}`;
  const props = { fleet, keyboard: kb };

  return (
    <SurfaceLab
      surface="new"
      title="Scout iOS · New session — destination"
      blurb={
        <>
          Which Mac the work lands on, and which project it runs in — the two
          decisions that gate Start, on a phone, above a composer. Three
          different architectures for that choice, each against the fleet you
          actually have (one Mac, forty checkouts), the fleet that breaks
          list-first designs (three Macs, two hundred workspaces), and the one
          every new user sees (nothing yet).
        </>
      }
      source="apps/ios/Scout/NewSessionSurface.swift"
      header={<DetailHeader title="New session" subtitle="start work on a paired Mac" />}
      showChrome={false}
      controls={
        <>
          <Seg label="Fleet" value={fleet} onChange={(v) => setFleet(v as DestFleet)} options={FLEETS} />
          <Seg label="Keyboard" value={kb ? "up" : "down"} onChange={(v) => setKb(v === "up")}
            options={[{ id: "down", label: "Down" }, { id: "up", label: "Up" }]} />
        </>
      }
      treatments={[
        {
          id: "calm-standing",
          label: "Calm · standing search",
          body: <DestinationCalm key={`cs-${k}`} {...props} search="standing" />,
          note: (
            <>
              <b>The Home-shaped frame, with search always there.</b> Air on
              top, one quiet lane hugging the composer, the composer docked, the
              keyboard toggle on its own line beneath it — the same room as the
              Entry front door, with the two decisions that gate Start as the
              furniture: <b>① host</b> (one line; with one Mac it is a readout
              and costs the common case nothing) and <b>② project</b> (three
              rows, device-recent first). The foot carries the count and names
              what is being held back.
              <br /><br />
              Three rows is only livable because the list is <b>curated</b>: on
              the real inventory, 20 of 57 rows are worktree clones under{" "}
              <code>~/.codex/worktrees</code>, <code>/tmp</code> checkouts, and
              the umbrella folders (<code>Art</code>, <code>Dev</code>) those
              live in. They are kept and labelled, not deleted — but they are
              not peers of <code>openscout</code>.
              <br /><br />
              <b>Search costs one permanent row.</b> Typing replaces the three
              rows with curated matches in place; nothing moves, nothing opens.{" "}
              <b>Gives up</b> the cleanest possible resting screen: a control
              you use maybe one visit in five is on screen every visit, and it
              is the row directly under the host line, which is where the eye
              lands first.
            </>
          ),
        },
        {
          id: "calm-picker",
          label: "Calm · picker page",
          body: <DestinationCalm key={`cp-${k}`} {...props} search="picker" />,
          note: (
            <>
              <b>Same frame; search is somewhere you go.</b> At rest the lane is
              four lines total — host, three projects, and a foot that reads{" "}
              <em>All 57 projects · 12 worktrees · 5 scratch · 3 folders</em>.
              No field, no query, nothing to read past. Tap the foot and a page
              owns the screen: a real search field (legal here for one reason —
              while it exists, the pill does not), durable roots first, and the
              swept-up pile under its own head rather than interleaved.
              <br /><br />
              <b>Optimises for</b> the resting screen, which is the one you see
              every time: it is as calm as Home, and the three rows are almost
              always the answer.{" "}
              <b>Gives up</b> a tap and a modal on the four-visits-in-five where
              you do need a different repo — and the destination is out of sight
              while the page is up. Flip Keyboard to Up to see the page.
            </>
          ),
        },
        {
          id: "calm-expand",
          label: "Calm · expand in place",
          body: <DestinationCalm key={`ce-${k}`} {...props} search="expand" />,
          note: (
            <>
              <b>Same frame; the lane grows into the air instead of opening a
              page.</b> At rest it is identical to the picker take — four lines,
              no field. Tap the foot and the section takes the breathing room
              above it: a query line appears at its head, the list grows to
              eight, and the composer never moves. The foot becomes{" "}
              <em>Close</em>. No modal, no context switch, and the destination
              stays visible the whole time.
              <br /><br />
              <b>Optimises for</b> reversibility — expanding and collapsing is
              free, so an operator who is not sure whether they need to search
              never pays for finding out. It is also the only take where the
              composer is reachable while searching.{" "}
              <b>Gives up</b> height: eight rows on a phone with the keyboard up
              is about four, so at 57 rows you are still typing. And a surface
              that changes shape under the thumb needs the motion to teach it —
              this is the take that most depends on the spring being right.
            </>
          ),
        },
        {
          id: "rule",
          label: "Rule",
          body: <DestinationRule key={`rule-${k}`} {...props} />,
          note: (
            <>
              <b>The destination is the page.</b> Host readout on top, a bare
              query line between two hairlines, then the inventory — nothing
              behind a tap, and changing your mind costs one tap from anywhere.
              This is the shipped native structure, designed rather than
              reasoned into place: the count moves onto the query line where the
              narrowing happens (one whole eyebrow row reclaimed), and the list
              gains structure — a short <em>Where you&apos;re working</em> band
              derived from the live agent inventory, then the rest grouped under
              their parent directories, so <code>~/dev</code> is said once above
              twenty-six rows instead of repeated on every one of them.
              <br /><br />
              <b>Optimises for</b> never hiding the decision, and for the
              operator who genuinely picks a different repo each time.{" "}
              <b>Gives up</b> the screen: two-thirds of a phone spent on a list
              you leave alone four times out of five. Keyboard up it holds about
              eight rows, which is fine at forty and useless at two hundred —
              flip Fleet to the stress case and watch the group heads become the
              only thing keeping it navigable. Empty, the whole plane is one
              notice, which reads as a broken screen rather than a new one.
            </>
          ),
        },
        {
          id: "readout",
          label: "Readout",
          body: <DestinationReadout key={`readout-${k}`} {...props} />,
          note: (
            <>
              <b>The destination is one line, and that line is the search
              field.</b> At rest: a dot-led mono readout pinned above the
              composer — <code>studio · ~/dev/openscout</code> — and a whisper
              of where you last worked. Tap it and it takes the caret; matches
              rise <em>above</em> it, nearest the thumb, the way a quick-open
              does. The composer visibly stands down while the line is live, so
              there is exactly one field taking text at any moment and it is
              never ambiguous which — the constraint solved by sequencing rather
              than by styling.
              <br /><br />
              <b>Optimises for</b> the phone being for steering: you already
              know where the work goes, so the destination costs one line and
              the rest of the screen is composing. It is the only treatment that
              scales flat — six rows at forty workspaces, six rows at two
              hundred.{" "}
              <b>Gives up</b> discovery: a query of nothing shows recents, not
              the inventory, so an operator who cannot remember the repo&apos;s
              name has to fish. And the standby state is a rule you have to
              learn once — a dimmed composer under a live line is unusual enough
              that it needs the animation to teach it.
            </>
          ),
        },
        {
          id: "sheet",
          label: "Sheet",
          body: <DestinationSheet key={`sheet-${k}`} {...props} />,
          note: (
            <>
              <b>The destination is a place you go.</b> At rest it is a line
              inside the composer&apos;s own header slot — an attribute of the
              message, not a control beside it — so the resting screen is pure
              front door. Tapping it opens a page that owns the screen: host
              plates, a real field, the inventory grouped by parent, 44pt rows
              all the way down. Picking a row dismisses; Done leaves it alone.
              <br /><br />
              Note what the separation buys: this is the only treatment whose
              search control is a proper filled <code>HudField</code>, and it is
              legal for exactly one reason — while it exists, the pill does not.
              That is the ambiguity dissolved in time rather than in styling.
              <br /><br />
              <b>Optimises for</b> the stress case and for first use — the
              picker can afford to teach (host presence, parent grouping,
              counts) because it isn&apos;t competing with a composer for
              height.{" "}
              <b>Gives up</b> a tap and a modal on a screen you may open twenty
              times a day, and the destination is out of sight while you write
              the task — mitigated only by that one header line, which is doing
              a lot of work for its eleven pixels.
            </>
          ),
        },
        {
          id: "shipped",
          label: "Shipped (native)",
          body: <DestinationShipped key={`shipped-${k}`} {...props} />,
          note: (
            <>
              <b>What is on the phone today,</b> ported faithfully so the three
              proposals have something to be measured against. What it gets
              wrong, and what each treatment above does about it:
              <br /><br />
              · <b>No ranking.</b> Forty rows in whatever order{" "}
              <code>listWorkspaces</code> returned, with a dim <code>~/dev</code>{" "}
              repeated on every single one. The one fact that would order them —
              where your agents actually are — is a join away (<code>listAgents</code>,
              which the Agents surface already fetches) and the New surface never
              asks for it.
              <br />
              · <b>The count is its own row.</b> <code>PROJECT · 12 of 40</code>{" "}
              spends a full eyebrow line saying what fits on the query line.
              <br />
              · <b>Host is charged full price in the common case.</b> One paired
              Mac is not a choice, but it still takes an eyebrow, a row and a
              rule at the top of the screen.
              <br />
              · <b>No empty-state design.</b> A fresh install gets one dim mono
              sentence in the middle of an otherwise blank plane.
            </>
          ),
        },
      ]}
    />
  );
}
