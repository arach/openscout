"use client";

/**
 * Brief Author — static study.
 *
 * Companion to /studies/operator-brief. That study shows the brief at
 * rest. This one shows the MAKING of one — but the mental model is
 * different from the v2 of this study. There is no bench, no
 * compose pane, no chunk shells with rails. The brief is a single
 * continuous readable document, like the operator-brief specimen.
 * The operator works on it IN PLACE.
 *
 * The whole surface is built around one move:
 *
 *   1. The operator reads the brief.
 *   2. They click anywhere on it — a phrase, a sentence, a clause.
 *   3. An inline mic+text dock summons just below that line, anchored
 *      to the clicked span by a thin warm dashed under-line + a small
 *      anchor glyph in the right gutter.
 *   4. They speak or type feedback addressed to that span.
 *   5. They commit with one of two verbs:
 *        · send — the agent acts now (processing veil → delta-marked
 *                  rewrite of the span)
 *        · save — the feedback becomes a persistent inline annotation
 *                  visible in the right gutter, connected to its
 *                  anchor by a faint hairline. Multiple annotations
 *                  stack. They are handed to the agent as a batch
 *                  via the single quiet "→ hand annotations to agent"
 *                  action in the top right of the brief.
 *
 * The operator never edits the brief text. They never drag, never
 * pick from a grid. The agent translates spoken/typed feedback into
 * structural changes to a richly-typed underlying brief.
 *
 * Frames:
 *   1. Brief at rest — a memo you'd read.
 *   2. Click summons the dock — anchor mark visible, dock floats
 *      below the line.
 *   3. Dictating feedback — mic lit, transcript in the field.
 *   4. Save — three annotations now sit in the gutter.
 *   5. Send — processing veil over the span; delta-marked result.
 *   6. Batch resolution — three annotations handed off; resolved
 *      brief shows the deltas inline (and one "noted, not changed").
 *
 * Conventions:
 *   • no /N opacity on studio-* tokens (broken under Turbopack+TW3.4)
 *   • dividers via border-studio-edge — never white-with-alpha
 *   • hand-drawn SVG glyphs only
 *   • one warm element rule — accent reserved for the active
 *     anchor under-line, the new-prose delta under-line, the mic-on
 *     dot, and the small batch handoff arrow. Saved annotation marks
 *     do NOT carry warm; they sit in ink-faint.
 *   • the brief column reads editorially — narrative paragraphs, no
 *     widget-stacked feel. Margin annotations live in a real ~220px
 *     right gutter.
 */

import {
  InputDock,
  type SteerAction,
  type SteerEvent,
} from "@/components/QuickSteer";
import type { CSSProperties, ReactNode, SVGProps } from "react";

// ── Shared task — same flavour as operator-brief so the studies rhyme.

const TASK = {
  id: "task-0331",
  agent: "hudson",
  agentHue: 210,
  filed: "2026-05-24 · 09:14 PT",
  title: "Audit our auth middleware for compliance gaps",
} as const;

// Agent hue table — kept in step with arrangements + role-builder.
const HUE = {
  scout: 125,
  hudson: 210,
  qb: 25,
  cody: 85,
  pike: 25,
  drover: 50,
  quill: 295,
  atlas: 210,
} as const;

function agentColor(name: keyof typeof HUE, alpha = 1) {
  return `oklch(0.74 0.15 ${HUE[name]} / ${alpha})`;
}

// Pre/post Mission prose — carried forward from v2 unchanged. The
// "settled" Mission across Frames 1–4 + Frame 6 reads as the pre;
// Frame 5 (send) shows the same span resolving into the post via
// delta marks. Same SOC 2 auth-review tasking as the v2 storyboard.
const MISSION_PRE =
  "Walk the auth middleware end-to-end and surface every place we're out of step with SOC 2 controls — token rotation, session expiry, audit log gaps, anything that would fail a November review. A read of where we stand. Not a fix.";

const MISSION_POST =
  "Every gap in our auth middleware is a path an attacker can walk — token rotation, session expiry, audit log holes. Find them before the November SOC 2 review does. A read of where we stand. Not a fix.";

const MISSION_CRITIQUE =
  "lead with user impact — the security gap is the why, not the what.";

// ╔══════════════════════════════════════════════════════════════════╗
// ║ Page                                                              ║
// ╚══════════════════════════════════════════════════════════════════╝

export default function BriefAuthorPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <Eyebrow />
      <h1 className="mt-1 font-display text-[32px] font-medium leading-none tracking-tight text-studio-ink">
        Brief author
      </h1>
      <p className="mt-3 max-w-prose font-sans text-[13.5px] leading-relaxed text-studio-ink-faint">
        Companion to{" "}
        <a
          href="/studies/operator-brief"
          className="text-studio-ink underline decoration-studio-edge-strong underline-offset-4 hover:decoration-[color:var(--scout-accent)]"
        >
          /studies/operator-brief
        </a>{" "}
        which shows the brief in flight and at hand-back. This study is
        about working on one. The brief is a continuous readable
        document — a memo, not a form. The operator works on it{" "}
        <em>in place</em>: click anywhere on the page, drop feedback
        into an inline mic+text dock, and commit with one of two
        verbs. <span className="text-studio-ink">Send</span> ships the
        feedback to the agent now and the affected span re-renders
        with the rewrite. <span className="text-studio-ink">Save</span>
        {" "}leaves the feedback as a persistent annotation in the
        margin; several can accumulate and be handed to the agent as
        one batch. The operator never edits the prose by hand.
      </p>
      <p
        className="mt-2 max-w-prose font-sans text-[12px] leading-relaxed text-studio-ink-faint"
        style={{ opacity: 0.8 }}
      >
        Cross-study primitives:{" "}
        <a
          href="/studies/arrangements"
          className="text-studio-ink underline decoration-studio-edge-strong underline-offset-4 hover:decoration-[color:var(--scout-accent)]"
        >
          /studies/arrangements
        </a>{" "}
        for the named collaboration shapes the agent can snap in;{" "}
        <a
          href="/studies/role-builder"
          className="text-studio-ink underline decoration-studio-edge-strong underline-offset-4 hover:decoration-[color:var(--scout-accent)]"
        >
          /studies/role-builder
        </a>{" "}
        for the role dossiers it lifts by codename.
      </p>

      {/* ── Frame 1 ─────────────────────────────────────────────── */}
      <SectionTitle
        hint="A continuous, readable document — the surface the operator works on in place"
        className="mt-12"
      >
        Frame 1 · The brief at rest
      </SectionTitle>
      <p className="mt-2 max-w-prose font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
        Editorial column, narrative sections, the same SOC 2 tasking
        from the operator-brief specimen. No chunk shells, no rails,
        no widgets. Every span is clickable — the only affordance hint
        is a small italic note above the document.
      </p>
      <div className="mt-6">
        <BriefSurface frame="rest" />
      </div>

      {/* ── Frame 2 ─────────────────────────────────────────────── */}
      <SectionTitle
        hint="The dock summons inline, anchored to the clicked span"
        className="mt-16"
      >
        Frame 2 · Click summons the dock
      </SectionTitle>
      <p className="mt-2 max-w-prose font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
        The clicked span carries a warm 1px dashed under-line; a small
        anchor glyph sits in the right gutter on the same baseline.
        The dock floats just below the line containing the span, empty
        and ready. Two commit verbs — <em>send</em> ships now,{" "}
        <em>save</em> leaves the feedback as an annotation. The
        operator picks; the dock chrome doesn&apos;t decide for them.
      </p>
      <div className="mt-6">
        <BriefSurface frame="clicked" />
      </div>

      {/* ── Frame 3 ─────────────────────────────────────────────── */}
      <SectionTitle
        hint="Operator describes the change; they don't write it"
        className="mt-16"
      >
        Frame 3 · Dictating feedback
      </SectionTitle>
      <p className="mt-2 max-w-prose font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
        Mic lit with the warm recording dot, transcript filling the
        field. The clicked span keeps its anchor mark so the channel
        is unambiguous — this feedback is addressed to <em>this</em>
        line.
      </p>
      <div className="mt-6">
        <BriefSurface frame="dictating" />
      </div>

      {/* ── Frame 4 ─────────────────────────────────────────────── */}
      <SectionTitle
        hint="Save leaves the feedback where it was left — three saved at different spans"
        className="mt-16"
      >
        Frame 4 · Save — annotations accumulate
      </SectionTitle>
      <p className="mt-2 max-w-prose font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
        The dock collapses. Each saved span carries a small ink-faint
        annotation mark in the gutter; the operator&apos;s text sits
        beside it as a margin note, connected by a barely-there
        hairline. Annotations live where they were left — not in a
        separate inbox.
      </p>
      <div className="mt-6">
        <BriefSurface frame="annotated" />
      </div>

      {/* ── Frame 5 ─────────────────────────────────────────────── */}
      <SectionTitle
        hint="Send commits one feedback now — glass veil holds the old, delta marks land the new"
        className="mt-16"
      >
        Frame 5 · Send — immediate regeneration
      </SectionTitle>
      <p className="mt-2 max-w-prose font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
        A different branch from the same Mission feedback. The
        operator hit <em>send</em>. The affected span goes into
        processing — the prior prose held under a glass veil with the
        agent-thinking glyph centered on top. A beat later the span
        re-renders with delta marks: struck-through removals at ink
        faint, a thin warm under-line on the new prose.
      </p>
      <div className="mt-6">
        <SendStoryboard />
      </div>
      <p
        className="mt-4 max-w-prose font-sans text-[12px] italic leading-relaxed text-studio-ink-faint"
        style={{ opacity: 0.85 }}
      >
        <em>Send</em> commits one feedback now. <em>Save</em> lets
        several accumulate before the agent reads them. The dock
        offers both because the operator&apos;s rhythm changes — one
        precise rewrite, or a sweep of marginalia first.
      </p>

      {/* ── Frame 6 ─────────────────────────────────────────────── */}
      <SectionTitle
        hint="One envelope, three annotations — addressed, deferred, acknowledged"
        className="mt-16"
      >
        Frame 6 · Batch resolution
      </SectionTitle>
      <p className="mt-2 max-w-prose font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
        With three annotations saved on the brief, a single quiet
        action sits in the top-right of the document — the only chrome
        on the surface. The operator hands the batch to the agent in
        one envelope. The resolved brief sits beside it: each
        previously-marked span now shows its delta inline. One
        annotation remains visible with a small{" "}
        <em>noted · not changed</em> pip — the agent read it and chose
        not to act, with a one-line reason in the margin.
      </p>
      <div className="mt-6">
        <BatchStoryboard />
      </div>

      {/* ── Snap-in vocabulary ─────────────────────────────────── */}
      <SectionTitle
        hint="The agent's vocabulary for interpreting spoken/typed feedback — never a chooser for the operator"
        className="mt-16"
      >
        Snap-in vocabulary
      </SectionTitle>
      <p className="mt-2 max-w-prose font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
        Some spans of the brief reference a named artifact — a
        collaboration shape or a role dossier. The operator never
        opens a picker. They say{" "}
        <em>&ldquo;consult two reviewers, one decider&rdquo;</em> and
        the agent snaps in{" "}
        <code className="font-mono text-[11px] text-studio-ink">
          Consult
        </code>
        ; they say <em>&ldquo;put Drover on the adversarial review
        instead of Pike&rdquo;</em> and the agent swaps the dossier.
        The two strips below are the glossary the agent draws from —
        the agent&apos;s vocabulary for interpreting feedback like{" "}
        <em>&ldquo;consult two reviewers&rdquo;</em> or{" "}
        <em>&ldquo;put Drover on this instead&rdquo;</em>. It is not a
        chooser.
      </p>
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SnapInFrame
          title="Arrangements vocabulary · from /studies/arrangements"
          caption="four named topologies the agent can snap in by name"
        >
          <ArrangementsGlossary />
        </SnapInFrame>
        <SnapInFrame
          title="Role dossiers · from /studies/role-builder"
          caption="agents the operator can name when reshaping the division of focus"
        >
          <RolesGlossary />
        </SnapInFrame>
      </div>

      {/* ── Anatomy ────────────────────────────────────────────── */}
      <SectionTitle
        hint="Lettered callouts on the annotated brief — where every affordance lives"
        className="mt-16"
      >
        Anatomy
      </SectionTitle>
      <p className="mt-2 max-w-prose font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
        The annotated frame shows the most state at once — anchors,
        margin notes, the dock, and the batch handoff sitting together
        on one document.
      </p>
      <div className="mt-6">
        <Anatomy />
      </div>

      {/* ── How to read ────────────────────────────────────────── */}
      <section className="mt-16 max-w-prose border-t border-studio-edge pt-6">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · how to read this study
        </div>
        <p className="font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
          Every frame is static. The brief is the surface. The dock is
          the channel. Annotations live where they were left. The
          single rule that holds the whole study up: the operator
          never edits the prose directly. The only edit channel is the
          production{" "}
          <code className="font-mono text-[11px] text-studio-ink">
            InputDock
          </code>{" "}
          from{" "}
          <code className="font-mono text-[11px] text-studio-ink">
            components/QuickSteer.tsx
          </code>{" "}
          in its{" "}
          <code className="font-mono text-[11px] text-studio-ink">
            inline
          </code>{" "}
          mode, summoned at a clicked span. Lifecycle (lock, version,
          seal, draft state) is deferred — the brief is always
          editable here.
        </p>
      </section>
    </main>
  );
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║ Brief surface                                                     ║
// ║                                                                   ║
// ║ The one composition that renders every frame except the send and  ║
// ║ batch storyboards (which need a side-by-side comparison). A       ║
// ║ readable editorial column on the left, a real 220px right         ║
// ║ gutter for anchor glyphs + margin annotations.                    ║
// ╚══════════════════════════════════════════════════════════════════╝

type BriefFrame =
  | "rest" // Frame 1
  | "clicked" // Frame 2 — empty dock open under Mission
  | "dictating" // Frame 3 — same with mic recording + transcript
  | "annotated" // Frame 4 — three saved annotations in the margin
  | "anatomy"; // Frame 4 with callouts overlaid (used by Anatomy)

function BriefSurface({ frame }: { frame: BriefFrame }) {
  return (
    <article
      className="mx-auto rounded-md border border-studio-edge bg-studio-surface shadow-[0_8px_30px_-12px_rgba(0,0,0,0.4)]"
      style={{ maxWidth: 1020 }}
    >
      {/* The hint sits above the document column, deliberately light.
          Doubles as a clickable affordance signal — the only one the
          surface needs. */}
      <div className="flex items-baseline justify-between gap-4 border-b border-studio-edge px-7 py-3 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        <span>
          brief · {TASK.id} ·{" "}
          <span className="text-studio-ink-muted">filed {TASK.filed}</span>
        </span>
        {/* The batch handoff lives here on every frame that has saved
            annotations; on the others it stays as a quiet inert
            placeholder so the chrome layout doesn't shift between
            frames. */}
        {frame === "annotated" || frame === "anatomy" ? (
          <BatchHandoffAction count={3} />
        ) : (
          <span className="text-studio-ink-faint" style={{ opacity: 0.55 }}>
            no annotations
          </span>
        )}
      </div>

      <div
        className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_220px]"
      >
        {/* ── Reading column ──────────────────────────────────── */}
        <div className="px-9 py-8">
          <div className="mx-auto" style={{ maxWidth: 640 }}>
            {/* affordance hint above the document — italic, ink-faint,
                no chrome. The only thing telling the operator the
                document is interactive. */}
            <p
              className="m-0 mb-5 text-center font-sans text-[11.5px] italic leading-relaxed text-studio-ink-faint"
              style={{ opacity: 0.78 }}
            >
              click anywhere to leave feedback — speak or type
            </p>

            {/* Document masthead — looks like a sheet of paper. */}
            <header className="border-b border-studio-edge pb-5">
              <h2 className="font-display text-[26px] font-medium leading-[1.15] tracking-tight text-studio-ink">
                {TASK.title}
              </h2>
              <div className="mt-3 flex items-baseline gap-3 font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink-faint">
                <span>
                  for <AgentHandle name={TASK.agent} hue={TASK.agentHue} />
                </span>
                <Dot />
                <span>from @arach</span>
                <Dot />
                <span>latitude · decide &amp; log</span>
              </div>
            </header>

            {/* ── Mission — narrative paragraph. The clicked span
                lives inside this one in Frames 2/3 and 4. */}
            <BriefSection label="Mission">
              <MissionParagraph frame={frame} />
              {/* In the click/dictate frames, the inline dock floats
                  on the next baseline after the line containing the
                  anchor. We render it inline at the end of the
                  Mission paragraph — close enough to the anchor that
                  the reading eye can follow. */}
              {frame === "clicked" || frame === "dictating" ? (
                <div className="mt-3">
                  <SpanDock
                    actionId="span-mission"
                    transcript={
                      frame === "dictating" ? MISSION_CRITIQUE : ""
                    }
                    recording={frame === "dictating"}
                  />
                </div>
              ) : null}
            </BriefSection>

            {/* ── Collaboration shape ─────────────────────────── */}
            <BriefSection label="Collaboration shape">
              <p className="m-0 font-sans text-[13px] leading-[1.65] text-studio-ink">
                <Anchored
                  on={frame === "annotated" || frame === "anatomy"}
                  // No live click frame on this span — only the saved
                  // annotation lights up its anchor.
                  saved
                >
                  Consult with two reviewers — <CodeInline>@pike</CodeInline>{" "}
                  on the runtime side, <CodeInline>@quill</CodeInline> on
                  the auditor copy
                </Anchored>
                . <CodeInline>@qb</CodeInline> decides; tie =
                re-consult once, then commit.
              </p>
              <div className="mt-3 rounded-[3px] border border-studio-edge bg-studio-canvas-alt p-3">
                <div className="mb-2 flex items-baseline justify-between gap-3 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
                  <span>
                    <span className="text-studio-ink">consult</span> ·
                    two advisors in, decider commits
                  </span>
                  <span style={{ opacity: 0.75 }}>
                    snap-in from /studies/arrangements
                  </span>
                </div>
                <ConsultMiniDiagram />
              </div>
            </BriefSection>

            {/* ── Decider ──────────────────────────────────────── */}
            <BriefSection label="Decider">
              <p className="m-0 font-sans text-[13px] leading-[1.65] text-studio-ink">
                <CodeInline>@qb</CodeInline> holds the call. Tie =
                re-consult once, then commit. Blocker = halt and ask{" "}
                <CodeInline>@arach</CodeInline> in{" "}
                <CodeInline>#scout-security</CodeInline> before
                continuing.
              </p>
            </BriefSection>

            {/* ── Division of focus ───────────────────────────── */}
            <BriefSection label="Division of focus">
              <p className="m-0 mb-2.5 font-sans text-[13px] leading-[1.65] text-studio-ink">
                Three lanes, each held by one role dossier. No
                overlap; if a finding crosses a seam, surface it in
                the debrief rather than wiring around it.
              </p>
              <div className="flex flex-col gap-1.5">
                <PartitionRow
                  agent="pike"
                  label="@pike"
                  slice="backend & middleware — packages/runtime/auth/**"
                  held="security-review · debug"
                />
                <PartitionRow
                  agent="quill"
                  label="@quill"
                  slice="findings copy — the lede paragraph for the auditor"
                  held="humanizer · ux-audit"
                />
                <PartitionRow
                  agent="hudson"
                  label="@hudson"
                  slice="frontend surfaces — packages/web/auth/**"
                  held="design-audit · design-fix"
                />
              </div>
            </BriefSection>

            {/* ── Boundaries ──────────────────────────────────── */}
            <BriefSection label="Boundaries">
              <p className="m-0 font-sans text-[13px] leading-[1.65] text-studio-ink">
                In the lane: <CodeInline>packages/web/server/auth/</CodeInline>{" "}
                and everything it imports; a read-only sweep of{" "}
                <CodeInline>packages/runtime/session/</CodeInline>.
                Off-limits: the OAuth client (that&apos;s
                <CodeInline> @vault</CodeInline>&apos;s lane) and no
                PRs — findings only.
              </p>
            </BriefSection>

            {/* ── Latitude ────────────────────────────────────── */}
            <BriefSection label="Latitude">
              <p className="m-0 mb-2 font-sans text-[13px] leading-[1.65] text-studio-ink">
                <Anchored
                  on={frame === "annotated" || frame === "anatomy"}
                  saved
                >
                  Decide and log
                </Anchored>{" "}
                — rank findings without asking; surface ranking
                rationale in the debrief. Ask back on policy
                interpretation: what counts as a SOC 2 violation
                vs. a recommendation goes to{" "}
                <CodeInline>@arach</CodeInline> first.
              </p>
              <LatitudeStrip dial={2} />
            </BriefSection>

            <footer className="mt-7 border-t border-studio-edge pt-4 font-mono text-[9.5px] uppercase tracking-eyebrow text-studio-ink-faint">
              countersign on dispatch · est. 4–6h
            </footer>
          </div>
        </div>

        {/* ── Right gutter — anchor glyphs + margin annotations.
             Stays present at all frames so the document column
             doesn't widen between frames. */}
        <aside
          className="relative border-t border-studio-edge px-4 py-8 lg:border-l lg:border-t-0"
          style={{ background: "var(--studio-canvas)" }}
        >
          {/* Anchor glyph + margin annotation cluster. The vertical
              positioning is hand-tuned to ride the same baseline as
              the anchored span on the left. Static study — no
              measurement, just an honest approximation. */}
          {frame === "clicked" || frame === "dictating" ? (
            <MarginAnchor topPct={20} kind="active" />
          ) : null}
          {frame === "annotated" || frame === "anatomy" ? (
            <>
              <MarginAnnotation
                topPct={20}
                excerpt='lead with user impact — the security gap is the *why*, not the *what*.'
                byline="@arach"
                tag="mission"
              />
              <MarginAnnotation
                topPct={42}
                excerpt='can Pike actually do adversarial reviews? Drover might be better.'
                byline="@arach"
                tag="collab"
              />
              <MarginAnnotation
                topPct={87}
                excerpt='widen this — let them ask back only on token-rotation choices.'
                byline="@arach"
                tag="latitude"
              />
            </>
          ) : null}
        </aside>
      </div>
    </article>
  );
}

// ── Mission paragraph (varies per frame) ───────────────────────────

function MissionParagraph({ frame }: { frame: BriefFrame }) {
  // Frame 2/3 — the active click. Frame 4/anatomy — saved annotation.
  // Frame 1 — plain.
  const clickActive = frame === "clicked" || frame === "dictating";
  const savedActive = frame === "annotated" || frame === "anatomy";

  return (
    <p
      className="m-0 font-sans text-[13.5px] leading-[1.7] text-studio-ink"
      style={{ textWrap: "pretty" as CSSProperties["textWrap"] }}
    >
      Walk the auth middleware end-to-end and surface every place
      we&apos;re out of step with SOC 2 controls — token rotation,
      session expiry, audit log gaps, anything that would{" "}
      <Anchored on={clickActive} active={clickActive}>
        fail a November review
      </Anchored>
      .{" "}
      <Anchored on={savedActive} saved>
        A read of where we stand. Not a fix.
      </Anchored>
    </p>
  );
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║ Anchored span — the click anchor mark                             ║
// ║                                                                   ║
// ║ Visible signal that connects a span to the dock currently         ║
// ║ addressing it (active = warm dashed under-line, the one warm      ║
// ║ element on the column) or to a saved annotation in the gutter     ║
// ║ (saved = ink-faint solid under-line, no warm).                    ║
// ╚══════════════════════════════════════════════════════════════════╝

function Anchored({
  on,
  active,
  saved,
  children,
}: {
  on: boolean;
  active?: boolean;
  saved?: boolean;
  children: ReactNode;
}) {
  if (!on) return <>{children}</>;
  // active = warm dashed (the live click target — the one warm element
  // on the column). saved = ink-faint solid (a remembered mark, not
  // demanding attention).
  const style: CSSProperties = active
    ? {
        backgroundImage:
          "linear-gradient(to right, var(--scout-accent) 0, var(--scout-accent) 3px, transparent 3px, transparent 6px)",
        backgroundRepeat: "repeat-x",
        backgroundSize: "6px 1px",
        backgroundPosition: "0 100%",
        paddingBottom: 1,
      }
    : {
        backgroundImage:
          "linear-gradient(to top, var(--studio-ink-faint) 0, var(--studio-ink-faint) 1px, transparent 1px)",
        backgroundRepeat: "repeat-x",
        backgroundSize: "100% 1px",
        backgroundPosition: "0 100%",
        paddingBottom: 1,
      };
  return <span style={style}>{children}</span>;
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║ Margin gutter atoms                                               ║
// ╚══════════════════════════════════════════════════════════════════╝

/** A bare anchor glyph in the gutter — used when a click is live and
 *  the dock is open below the line, but nothing has been saved yet.
 *  Sits at the same vertical position as the anchored span. */
function MarginAnchor({
  topPct,
  kind,
}: {
  topPct: number;
  kind: "active" | "saved";
}) {
  const warm = kind === "active";
  return (
    <div
      className="absolute left-4 flex items-center gap-2"
      style={{ top: `${topPct}%` }}
    >
      {/* hairline reaching toward the column edge — barely there */}
      <span
        aria-hidden
        className="block h-px"
        style={{
          width: 14,
          background: warm
            ? "var(--scout-accent)"
            : "var(--studio-edge-strong)",
          opacity: warm ? 0.55 : 0.6,
        }}
      />
      <AnchorGlyph warm={warm} />
    </div>
  );
}

/** A saved margin annotation — anchor glyph + a two-line excerpt with
 *  the operator's byline. Connected to the anchored span on the left
 *  by a faint hairline. Stays ink-only; no warm. */
function MarginAnnotation({
  topPct,
  excerpt,
  byline,
  tag,
  state,
}: {
  topPct: number;
  excerpt: string;
  byline: string;
  tag: string;
  state?: "addressed" | "deferred" | "ack";
}) {
  return (
    <div
      className="absolute left-3 right-3"
      style={{ top: `${topPct}%` }}
    >
      <div className="flex items-start gap-2">
        {/* hairline crossing into the gutter from the anchored span */}
        <span
          aria-hidden
          className="mt-2 block h-px shrink-0"
          style={{
            width: 12,
            background: "var(--studio-edge-strong)",
            opacity: 0.6,
          }}
        />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-baseline gap-1.5">
            <AnnotationMarkGlyph />
            <span className="font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink">
              {byline}
            </span>
            <span className="font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
              · {tag}
            </span>
          </div>
          <p
            className="m-0 font-sans text-[11.5px] italic leading-[1.5] text-studio-ink"
            style={{ textWrap: "pretty" as CSSProperties["textWrap"] }}
          >
            &ldquo;{excerpt}&rdquo;
          </p>
          {state ? <AnnotationStateLine state={state} /> : null}
        </div>
      </div>
    </div>
  );
}

function AnnotationStateLine({
  state,
}: {
  state: "addressed" | "deferred" | "ack";
}) {
  const text =
    state === "addressed"
      ? "addressed — rewritten in place"
      : state === "deferred"
        ? "deferred — kept for follow-up"
        : "noted · not changed";
  const color =
    state === "addressed"
      ? "var(--status-ok-fg)"
      : state === "deferred"
        ? "var(--studio-ink-faint)"
        : "var(--studio-ink-faint)";
  return (
    <div
      className="mt-1 flex items-baseline gap-1.5 font-mono text-[8.5px] uppercase tracking-eyebrow"
      style={{ color }}
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: color, opacity: 0.85 }}
      />
      <span>{text}</span>
    </div>
  );
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║ Batch handoff action                                              ║
// ║                                                                   ║
// ║ Quiet single action in the brief's top-right strip. Only chrome   ║
// ║ on the document. The small warm arrow is the one accent on the    ║
// ║ surface chrome (annotation marks stay ink).                       ║
// ╚══════════════════════════════════════════════════════════════════╝

function BatchHandoffAction({ count }: { count: number }) {
  return (
    <span className="inline-flex items-baseline gap-1.5 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink">
      <SendArrowGlyph warm />
      <span>hand annotations to agent</span>
      <span className="text-studio-ink-faint">({count})</span>
    </span>
  );
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║ Span dock                                                         ║
// ║                                                                   ║
// ║ The production InputDock in `inline` mode, configured with the    ║
// ║ second commit verb (onSave) so the operator sees both send and    ║
// ║ save side-by-side. This is the new prop we added to QuickSteer.   ║
// ╚══════════════════════════════════════════════════════════════════╝

function SpanDock({
  actionId,
  transcript,
  recording,
  hideSave,
}: {
  actionId: string;
  transcript?: string;
  recording?: boolean;
  /** When true, drop the save verb — used in the Send storyboard
   *  where the operator is committing immediately, not annotating. */
  hideSave?: boolean;
}) {
  const evt: SteerEvent = {
    id: `dock-${actionId}`,
    agent: TASK.agent,
    agentHue: TASK.agentHue,
    kind: "message",
    label: "feedback",
    time: "",
  };
  const action: SteerAction = {
    id: actionId,
    label: "feedback",
    glyph: "mic",
    needsInput: true,
    inputPlaceholder: "speak or type…",
  };
  const color = agentColor(TASK.agent as keyof typeof HUE);
  const keyframeId = `ba-${actionId}`;
  return (
    <div className="relative">
      <ClusterKeyframes id={keyframeId} />
      <InputDock
        evt={evt}
        action={action}
        color={color}
        keyframeId={keyframeId}
        onSend={() => {}}
        onCancel={() => {}}
        onSave={hideSave ? undefined : () => {}}
        initialText={transcript ?? ""}
        initialRecording={!!recording}
        inline
      />
    </div>
  );
}

function ClusterKeyframes({ id }: { id: string }) {
  return (
    <style>{`
      @keyframes qs-chip-in-${id} {
        from { opacity: 0; transform: translateY(3px); }
        to   { opacity: 1; transform: translateY(0); }
      }
    `}</style>
  );
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║ Send storyboard                                                   ║
// ║                                                                   ║
// ║ Two-frame side-by-side: processing (glass veil + thinking glyph)  ║
// ║ then resolved (delta marks on the span).                          ║
// ╚══════════════════════════════════════════════════════════════════╝

function SendStoryboard() {
  return (
    <div className="rounded-md border border-studio-edge bg-studio-canvas-alt p-5">
      <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-studio-edge pb-3">
        <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink">
          · send · one feedback now
        </span>
        <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          for
        </span>
        <AgentHandle name={TASK.agent} hue={TASK.agentHue} />
        <span className="ml-auto font-mono text-[9px] italic text-studio-ink-faint">
          processing → resolved · same span
        </span>
      </header>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch lg:gap-0">
        <StoryFrame label="processing">
          <SpanCard>
            <p
              className="m-0 font-sans text-[12.5px] leading-[1.65] text-studio-ink"
              style={{ textWrap: "pretty" as CSSProperties["textWrap"] }}
            >
              <span style={{ opacity: 0.55 }}>{MISSION_PRE}</span>
            </p>
            {/* Glass veil over the span — does not erase the text. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-[3px]"
              style={{
                background:
                  "linear-gradient(180deg, color-mix(in oklab, var(--studio-canvas) 84%, transparent) 0%, color-mix(in oklab, var(--studio-canvas) 70%, transparent) 100%)",
                backdropFilter: "blur(1.5px) saturate(0.95)",
                WebkitBackdropFilter: "blur(1.5px) saturate(0.95)",
              }}
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <ProcessingBadge />
            </div>
          </SpanCard>
        </StoryFrame>
        <FrameConnector />
        <StoryFrame label="resolved · delta">
          <SpanCard>
            <MissionDeltaProse />
          </SpanCard>
        </StoryFrame>
      </div>
    </div>
  );
}

/** A single storyboard frame — eyebrow + body. Same shell as the v2
 *  LoopFrame but stripped of the inline caption so the prose carries
 *  more weight at the wider 2-up rhythm. */
function StoryFrame({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span
          aria-hidden
          className="block h-1.5 w-1.5 rounded-full"
          style={{ background: "var(--studio-ink-faint)" }}
        />
        <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink">
          {label}
        </span>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** A span-shaped card — the body of a single feedback turn, narrowed
 *  to the line(s) under review. Used by both the send and batch
 *  storyboards. */
function SpanCard({ children }: { children: ReactNode }) {
  return (
    <section
      className="relative overflow-hidden rounded-[3px] border border-studio-edge bg-studio-canvas px-4 py-3.5"
      style={{ minHeight: 110 }}
    >
      {/* Tiny eyebrow naming the span we're addressing */}
      <div className="mb-1.5 flex items-baseline justify-between gap-2 font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
        <span>· mission · &ldquo;a read of where we stand.&rdquo;</span>
      </div>
      {children}
    </section>
  );
}

function FrameConnector() {
  return (
    <div
      aria-hidden
      className="hidden items-center justify-center px-3 lg:flex"
      style={{ alignSelf: "center" }}
    >
      <svg width={22} height={10} viewBox="0 0 22 10">
        <line
          x1={1}
          y1={5}
          x2={18}
          y2={5}
          stroke="var(--studio-edge-strong)"
          strokeWidth={1.1}
          strokeLinecap="round"
        />
        <path
          d="M15.5 2 L19 5 L15.5 8"
          stroke="var(--studio-edge-strong)"
          strokeWidth={1.1}
          fill="none"
          strokeLinejoin="miter"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

/** The delta render of the regenerated Mission — same hand-curated
 *  diff as v2 (removed at ink-faint with strikethrough, added with a
 *  thin warm under-line). The diff is hand-laid rather than computed
 *  from MISSION_PRE / MISSION_POST so the prose reads cleanly; the
 *  two constants stay at module top as the canonical pre/post pair
 *  for source-inspection. */
function MissionDeltaProse() {
  // Reference the canonical post-edit text so the constant stays
  // load-bearing — the diff below is the inline render of the same
  // transformation MISSION_PRE → MISSION_POST.
  void MISSION_POST;
  return (
    <p
      className="m-0 font-sans text-[12.5px] leading-[1.7] text-studio-ink"
      style={{ textWrap: "pretty" as CSSProperties["textWrap"] }}
    >
      <DeltaIn>Every gap in our auth middleware is a path an attacker can walk</DeltaIn>{" "}
      <DeltaOut>
        Walk the auth middleware end-to-end and surface every place
        we&apos;re out of step with SOC 2 controls
      </DeltaOut>{" "}
      — token rotation, session expiry, <DeltaIn>audit log holes</DeltaIn>{" "}
      <DeltaOut>
        audit log gaps, anything that would fail a November review
      </DeltaOut>
      .{" "}
      <DeltaIn>Find them before the November SOC 2 review does.</DeltaIn>{" "}
      A read of where we stand. Not a fix.
    </p>
  );
}

function DeltaIn({ children }: { children: ReactNode }) {
  return (
    <span
      className="text-studio-ink"
      style={{
        backgroundImage:
          "linear-gradient(to top, var(--scout-accent) 0, var(--scout-accent) 1.2px, transparent 1.2px)",
        backgroundRepeat: "repeat-x",
        backgroundSize: "100% 1.2px",
        backgroundPosition: "0 100%",
        paddingBottom: 1,
      }}
    >
      {children}
    </span>
  );
}

function DeltaOut({ children }: { children: ReactNode }) {
  return (
    <span
      className="text-studio-ink-faint"
      style={{
        textDecoration: "line-through",
        textDecorationThickness: "1px",
        opacity: 0.65,
      }}
    >
      {children}
    </span>
  );
}

function ProcessingBadge() {
  return (
    <span
      className="flex items-center gap-2 rounded-full border border-studio-edge px-2.5 py-1 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink"
      style={{
        background:
          "color-mix(in oklab, var(--studio-canvas) 88%, transparent)",
        boxShadow: "0 1px 2px color-mix(in oklab, black 18%, transparent)",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
      }}
    >
      <AgentThinkingGlyph />
      <span>@hudson · rewriting</span>
    </span>
  );
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║ Batch storyboard                                                  ║
// ║                                                                   ║
// ║ Saved-annotated brief on the left, resolved brief on the right.   ║
// ║ Each annotation lands as one of three outcomes — addressed,       ║
// ║ deferred, acknowledged-but-not-changed.                           ║
// ╚══════════════════════════════════════════════════════════════════╝

function BatchStoryboard() {
  return (
    <div className="rounded-md border border-studio-edge bg-studio-canvas-alt p-5">
      <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-studio-edge pb-3">
        <span className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink">
          · save · several at once, handed in one envelope
        </span>
        <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          for
        </span>
        <AgentHandle name={TASK.agent} hue={TASK.agentHue} />
        <span className="ml-auto font-mono text-[9px] italic text-studio-ink-faint">
          three annotations → addressed · deferred · acknowledged
        </span>
      </header>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_auto_1fr]">
        <StoryFrame label="before · three annotations saved">
          <BatchMiniBrief mode="before" />
        </StoryFrame>
        <FrameConnector />
        <StoryFrame label="after · agent has worked the batch">
          <BatchMiniBrief mode="after" />
        </StoryFrame>
      </div>
    </div>
  );
}

/** Slimmed brief used inside the batch storyboard — narrower than the
 *  main BriefSurface so two fit side-by-side. Same three spans get the
 *  treatment shown in the main annotated frame.
 *
 *  Before: anchors + margin notes, all in ink.
 *  After: deltas inline (addressed), one annotation persists with
 *         "deferred" state, one with "noted · not changed". */
function BatchMiniBrief({ mode }: { mode: "before" | "after" }) {
  return (
    <article
      className="overflow-hidden rounded-md border border-studio-edge bg-studio-surface"
    >
      <div className="flex items-baseline justify-between gap-3 border-b border-studio-edge px-3 py-2 font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
        <span>brief · {TASK.id}</span>
        {mode === "before" ? (
          <BatchHandoffAction count={3} />
        ) : (
          <span className="flex items-baseline gap-1.5 text-studio-ink">
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--status-ok-fg)" }}
            />
            <span>envelope worked · 2 addressed · 1 noted</span>
          </span>
        )}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_180px]">
        <div className="px-4 py-4">
          <div className="space-y-3.5">
            {/* Mission */}
            <section>
              <h3 className="mb-1 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
                · mission
              </h3>
              {mode === "before" ? (
                <p
                  className="m-0 font-sans text-[11.5px] leading-[1.6] text-studio-ink"
                  style={{ textWrap: "pretty" as CSSProperties["textWrap"] }}
                >
                  Walk the auth middleware end-to-end and surface every
                  place we&apos;re out of step with SOC 2 controls.{" "}
                  <Anchored on saved>
                    A read of where we stand. Not a fix.
                  </Anchored>
                </p>
              ) : (
                <p
                  className="m-0 font-sans text-[11.5px] leading-[1.65] text-studio-ink"
                  style={{ textWrap: "pretty" as CSSProperties["textWrap"] }}
                >
                  <DeltaIn>Every gap is a path an attacker can walk</DeltaIn>{" "}
                  <DeltaOut>
                    Walk the auth middleware end-to-end and surface
                    every place we&apos;re out of step with SOC 2
                    controls
                  </DeltaOut>
                  . A read of where we stand. Not a fix.
                </p>
              )}
            </section>

            {/* Collaboration */}
            <section>
              <h3 className="mb-1 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
                · collaboration shape
              </h3>
              {mode === "before" ? (
                <p
                  className="m-0 font-sans text-[11.5px] leading-[1.6] text-studio-ink"
                  style={{ textWrap: "pretty" as CSSProperties["textWrap"] }}
                >
                  Consult with{" "}
                  <Anchored on saved>
                    <CodeInline>@pike</CodeInline> on the runtime side
                  </Anchored>
                  ; <CodeInline>@qb</CodeInline> decides.
                </p>
              ) : (
                <p
                  className="m-0 font-sans text-[11.5px] leading-[1.65] text-studio-ink"
                  style={{ textWrap: "pretty" as CSSProperties["textWrap"] }}
                >
                  Consult with{" "}
                  <DeltaIn>
                    <CodeInline>@drover</CodeInline> on adversarial
                    review
                  </DeltaIn>{" "}
                  <DeltaOut>
                    <CodeInline>@pike</CodeInline> on the runtime side
                  </DeltaOut>
                  ; <CodeInline>@qb</CodeInline> decides.
                </p>
              )}
            </section>

            {/* Latitude */}
            <section>
              <h3 className="mb-1 font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
                · latitude
              </h3>
              <p
                className="m-0 font-sans text-[11.5px] leading-[1.6] text-studio-ink"
                style={{ textWrap: "pretty" as CSSProperties["textWrap"] }}
              >
                <Anchored on saved>Decide and log</Anchored> — rank
                findings without asking; surface rationale in the
                debrief.
              </p>
            </section>
          </div>
        </div>
        <aside
          className="relative border-l border-studio-edge px-3 py-4"
          style={{ background: "var(--studio-canvas)" }}
        >
          {mode === "before" ? (
            <>
              <MarginAnnotation
                topPct={0}
                excerpt="lead with user impact — the security gap is the *why*."
                byline="@arach"
                tag="mission"
              />
              <MarginAnnotation
                topPct={36}
                excerpt="can Pike actually do adversarial reviews? Drover might be better."
                byline="@arach"
                tag="collab"
              />
              <MarginAnnotation
                topPct={72}
                excerpt="widen this — let them ask back only on token-rotation choices."
                byline="@arach"
                tag="latitude"
              />
            </>
          ) : (
            <>
              <MarginAnnotation
                topPct={0}
                excerpt="lead with user impact — the security gap is the *why*."
                byline="@arach"
                tag="mission"
                state="addressed"
              />
              <MarginAnnotation
                topPct={36}
                excerpt="can Pike actually do adversarial reviews? Drover might be better."
                byline="@arach"
                tag="collab"
                state="addressed"
              />
              <MarginAnnotation
                topPct={72}
                excerpt="widen this — let them ask back only on token-rotation choices."
                byline="@arach"
                tag="latitude"
                state="ack"
              />
            </>
          )}
        </aside>
      </div>
      {mode === "after" ? (
        <div className="border-t border-studio-edge px-4 py-2 font-mono text-[9px] italic text-studio-ink-faint">
          @hudson · &ldquo;held latitude as-is — token-rotation
          carve-out is narrower than the existing `decide &amp; log`
          posture; ask-backs would multiply for no win.&rdquo;
        </div>
      ) : null}
    </article>
  );
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║ Anatomy                                                           ║
// ╚══════════════════════════════════════════════════════════════════╝

function Anatomy() {
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.4fr_minmax(280px,420px)]">
      <div className="relative">
        <BriefSurface frame="anatomy" />
        {/* Callouts overlay — absolute positioned circled letters.
            Positioned against the BriefSurface layout: top-right of
            the document chrome (F), the Mission saved span (B + C),
            the saved margin note (D), and the dock would-be slot
            (E — points where the dock summons in clicked/dictating
            frames). A is the column itself. */}
        <div className="pointer-events-none absolute inset-0 hidden lg:block">
          <Marker letter="A" style={{ top: "12%", left: "12%" }} />
          <Marker letter="B" style={{ top: "21%", left: "32%" }} />
          <Marker letter="C" style={{ top: "21%", right: "32%" }} />
          <Marker letter="D" style={{ top: "21%", right: "10%" }} />
          <Marker letter="E" style={{ top: "30%", left: "42%" }} />
          <Marker letter="F" style={{ top: "3%", right: "8%" }} />
        </div>
      </div>
      <dl className="m-0 space-y-3 font-mono text-[10.5px]">
        <AnatomyItem letter="A" label="Readable brief body">
          A single editorial column, narrative paragraphs, the same
          shape as the operator-brief specimen. The operator reads it
          like a memo. Every span is clickable.
        </AnatomyItem>
        <AnatomyItem letter="B" label="Anchor under-line">
          The thin ink-faint solid under-line on a span tells the
          operator a saved annotation lives in the gutter beside it.
          Active clicks light up with a warm dashed under-line
          instead — the one warm element on the column.
        </AnatomyItem>
        <AnatomyItem letter="C" label="Gutter hairline">
          A barely-there horizontal hairline crosses from the anchored
          span into the gutter, landing on its margin note. Connection
          is honest but quiet — not a wire.
        </AnatomyItem>
        <AnatomyItem letter="D" label="Margin annotation">
          A two-line excerpt of the saved feedback with the
          operator&apos;s byline and a section tag. Stays ink, no
          warm — annotations are remembered, not demanding.
        </AnatomyItem>
        <AnatomyItem letter="E" label="Inline dock slot">
          On the click and dictate frames, the InputDock summons here
          — just below the line of the anchored span. Two commit
          verbs in one chrome: <em>send</em> ships to the agent now,{" "}
          <em>save</em> drops a margin annotation.
        </AnatomyItem>
        <AnatomyItem letter="F" label="Batch handoff">
          The single quiet action on the surface chrome — hand the
          annotation envelope to the agent. The small warm arrow is
          the only accent on this strip.
        </AnatomyItem>
      </dl>
    </div>
  );
}

function AnatomyItem({
  letter,
  label,
  children,
}: {
  letter: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span
        aria-hidden
        className="grid h-5 w-5 shrink-0 place-items-center rounded-full border font-mono text-[9px] font-semibold"
        style={{
          borderColor: "var(--scout-accent)",
          color: "var(--scout-accent)",
        }}
      >
        {letter}
      </span>
      <div className="flex flex-col gap-0.5">
        <dt className="uppercase tracking-eyebrow text-studio-ink">
          {label}
        </dt>
        <dd className="font-sans text-[12px] leading-relaxed text-studio-ink-faint">
          {children}
        </dd>
      </div>
    </div>
  );
}

function Marker({
  letter,
  style,
}: {
  letter: string;
  style: CSSProperties;
}) {
  return (
    <span
      aria-hidden
      className="absolute grid h-5 w-5 place-items-center rounded-full font-mono text-[9.5px] font-semibold"
      style={{
        background: "var(--studio-canvas)",
        border: "1.2px solid var(--scout-accent)",
        color: "var(--scout-accent)",
        ...style,
      }}
    >
      {letter}
    </span>
  );
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║ Snap-in glossary (carried forward from v2)                       ║
// ╚══════════════════════════════════════════════════════════════════╝

function SnapInFrame({
  title,
  caption,
  children,
}: {
  title: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border border-studio-edge bg-studio-canvas-alt">
      <div className="flex items-baseline justify-between border-b border-studio-edge px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink">
          {title}
        </span>
        <span className="font-mono text-[9px] text-studio-ink-faint">
          {caption}
        </span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function ArrangementsGlossary() {
  const items: Array<{ name: string; gloss: string; diagram: ReactNode }> = [
    { name: "Consult", gloss: "advisory in, decider commits", diagram: <ConsultTile /> },
    { name: "Fan-out", gloss: "one trigger, N parallel", diagram: <FanoutTile /> },
    { name: "Pipeline", gloss: "sequential, baton handed", diagram: <PipelineTile /> },
    { name: "Quorum", gloss: "N converge, majority commits", diagram: <QuorumTile /> },
  ];
  return (
    <div>
      <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0">
        {items.map((it) => (
          <li
            key={it.name}
            className="rounded-[3px] border border-studio-edge bg-studio-canvas px-2.5 py-2"
          >
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink">
                {it.name}
              </span>
              <span className="font-mono text-[8.5px] italic text-studio-ink-faint">
                {it.gloss}
              </span>
            </div>
            <div className="mt-1.5">{it.diagram}</div>
          </li>
        ))}
      </ul>
      <p
        className="mt-2.5 m-0 font-sans text-[11.5px] italic leading-relaxed text-studio-ink-faint"
        style={{ opacity: 0.85 }}
      >
        Reference. The operator says{" "}
        <span className="not-italic text-studio-ink">
          &ldquo;consult two reviewers, one decider&rdquo;
        </span>{" "}
        and the agent snaps in{" "}
        <span className="not-italic font-mono text-[11px] text-studio-ink">
          Consult
        </span>
        . There is no tile to click.
      </p>
    </div>
  );
}

function RolesGlossary() {
  const roles: Array<{
    codename: string;
    hue: number;
    classification: string;
    oneline: string;
  }> = [
    {
      codename: "Pike",
      hue: 25,
      classification: "Security · Reviewer",
      oneline:
        "Suspicious by default. Reads diffs for what they let attackers do.",
    },
    {
      codename: "Drover",
      hue: 50,
      classification: "Adversarial · Red-team",
      oneline:
        "Walks the seams. Tries the move you didn't think a user would.",
    },
    {
      codename: "Quill",
      hue: 295,
      classification: "Copy · Voice",
      oneline: "House voice. Cuts AI tells, ships short.",
    },
    {
      codename: "Hudson",
      hue: 210,
      classification: "Design · Cross-surface",
      oneline: "Holds the design system in working memory.",
    },
  ];
  return (
    <div>
      <ul className="m-0 list-none space-y-2 p-0">
        {roles.map((r) => (
          <li
            key={r.codename}
            className="overflow-hidden rounded-[3px] border border-studio-edge bg-studio-canvas"
          >
            <div
              className="flex items-baseline gap-3 px-2.5 py-1.5"
              style={{
                background: `linear-gradient(180deg, color-mix(in oklab, oklch(0.78 0.14 ${r.hue}) 14%, var(--studio-canvas)) 0%, var(--studio-canvas) 100%)`,
              }}
            >
              <DossierMark hue={r.hue} />
              <span
                className="font-display text-[14px] leading-none tracking-tight"
                style={{ color: `oklch(0.94 0.06 ${r.hue})` }}
              >
                {r.codename}
              </span>
              <span className="font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-muted">
                {r.classification}
              </span>
            </div>
            <p className="m-0 px-2.5 py-1.5 font-sans text-[12px] leading-snug text-studio-ink">
              {r.oneline}
            </p>
          </li>
        ))}
      </ul>
      <p
        className="mt-2.5 m-0 font-sans text-[11.5px] italic leading-relaxed text-studio-ink-faint"
        style={{ opacity: 0.85 }}
      >
        Reference. The operator says{" "}
        <span className="not-italic text-studio-ink">
          &ldquo;put Drover on this instead of Pike&rdquo;
        </span>{" "}
        and the agent swaps the dossier. No grid of cards, no drag.
      </p>
    </div>
  );
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║ Brief section + supporting atoms                                  ║
// ╚══════════════════════════════════════════════════════════════════╝

function BriefSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 font-mono text-[9.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · {label}
      </h3>
      {children}
    </section>
  );
}

function CodeInline({ children }: { children: ReactNode }) {
  return (
    <code className="font-mono text-[12px] text-studio-ink">{children}</code>
  );
}

function PartitionRow({
  agent,
  label,
  slice,
  held,
}: {
  agent: keyof typeof HUE;
  label: string;
  slice: string;
  held: string;
}) {
  return (
    <div
      className="grid grid-cols-[18px_92px_1fr_auto] items-baseline gap-2.5 rounded-[3px] border border-studio-edge px-2.5 py-1.5"
      style={{ background: "var(--studio-canvas-alt)" }}
    >
      <DossierMark hue={HUE[agent]} />
      <span className="font-mono text-[10.5px] uppercase tracking-eyebrow text-studio-ink">
        {label}
      </span>
      <span className="font-sans text-[12px] leading-snug text-studio-ink">
        {slice}
      </span>
      <span className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        held: {held}
      </span>
    </div>
  );
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║ Latitude strip (lifted from operator-brief; rendered inline)     ║
// ╚══════════════════════════════════════════════════════════════════╝

function LatitudeStrip({ dial }: { dial: number }) {
  const stops = [
    { label: "ask first" },
    { label: "ask if surprised" },
    { label: "decide & log" },
    { label: "decide & summarize" },
    { label: "full autonomy" },
  ];
  return (
    <div className="relative pb-6 pt-1">
      <div className="absolute left-0 right-0 top-[12px] h-px bg-studio-edge" />
      <div className="relative flex justify-between">
        {stops.map((s, i) => {
          const active = i === dial;
          return (
            <div
              key={s.label}
              className="relative flex flex-col items-center"
              style={{ width: 0 }}
            >
              <span
                aria-hidden
                className="relative z-10 block rounded-full"
                style={{
                  width: active ? 9 : 5,
                  height: active ? 9 : 5,
                  marginTop: active ? -2 : 0,
                  background: active
                    ? "var(--scout-accent)"
                    : "var(--studio-edge-strong)",
                  boxShadow: active
                    ? "0 0 0 2.5px color-mix(in oklab, var(--scout-accent) 22%, transparent)"
                    : "none",
                }}
              />
              <span
                className="absolute top-4 whitespace-nowrap font-mono text-[8.5px] uppercase tracking-eyebrow"
                style={{
                  color: active
                    ? "var(--studio-ink)"
                    : "var(--studio-ink-faint)",
                }}
              >
                {s.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║ Mini schematic diagrams (lifted from /studies/arrangements)      ║
// ╚══════════════════════════════════════════════════════════════════╝

const PAD_W = 64;
const PAD_H = 18;
const PAD_STROKE = 1.1;
const EDGE = "var(--studio-edge-strong)";
const INK_FAINT = "var(--studio-ink-faint)";
const WARM = "var(--scout-accent)";

function MiniPad({
  x,
  y,
  label,
  hue,
  commit,
  trigger,
}: {
  x: number;
  y: number;
  label: string;
  hue?: number;
  commit?: boolean;
  trigger?: boolean;
}) {
  const w = commit ? PAD_W + 8 : PAD_W;
  const fill = trigger
    ? "color-mix(in oklab, var(--scout-accent) 22%, transparent)"
    : "var(--studio-canvas-alt)";
  const stroke = trigger ? WARM : EDGE;
  const ink = trigger ? WARM : "var(--studio-ink)";
  const pinFill = hue ? `oklch(0.74 0.15 ${hue})` : INK_FAINT;
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect
        x={-w / 2}
        y={-PAD_H / 2}
        width={w}
        height={PAD_H}
        rx={1.5}
        fill={fill}
        stroke={stroke}
        strokeWidth={trigger ? 1.4 : PAD_STROKE}
        strokeDasharray={commit ? "2.5 2.5" : undefined}
      />
      <circle cx={-w / 2} cy={0} r={1.6} fill={pinFill} />
      <circle cx={w / 2} cy={0} r={1.6} fill={pinFill} />
      <text
        x={-w / 2 + 6}
        y={2.5}
        fontSize={8}
        fontFamily="JetBrains Mono, ui-monospace"
        fill={ink}
        letterSpacing="0.03em"
      >
        {label}
      </text>
    </g>
  );
}

function MiniTrace({
  from,
  to,
  dashed,
}: {
  from: [number, number];
  to: [number, number];
  dashed?: boolean;
}) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const midX = x1 + (x2 - x1) * 0.5;
  const d = `M ${x1} ${y1} H ${midX} V ${y2} H ${x2}`;
  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={EDGE}
        strokeWidth={PAD_STROKE}
        strokeDasharray={dashed ? "2.5 2.5" : undefined}
      />
      <path
        d={`M ${x2 - 3} ${y2 - 2.4} L ${x2} ${y2} L ${x2 - 3} ${y2 + 2.4}`}
        fill="none"
        stroke={EDGE}
        strokeWidth={PAD_STROKE}
        strokeLinejoin="miter"
      />
    </g>
  );
}

function ConsultMiniDiagram() {
  const W = 320;
  const H = 110;
  const TRIG_X = 50;
  const ADV_X = 160;
  const DEC_X = 270;
  const T_Y = 55;
  const A1_Y = 26;
  const A2_Y = 84;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" aria-hidden>
      <MiniPad x={TRIG_X} y={T_Y} label="Trigger" trigger />
      <MiniPad x={ADV_X} y={A1_Y} label="@pike" hue={HUE.pike} />
      <MiniPad x={ADV_X} y={A2_Y} label="@quill" hue={HUE.quill} />
      <MiniPad x={DEC_X} y={T_Y} label="@qb" hue={HUE.qb} commit />
      <MiniTrace from={[TRIG_X + PAD_W / 2, T_Y]} to={[ADV_X - PAD_W / 2, A1_Y]} />
      <MiniTrace from={[TRIG_X + PAD_W / 2, T_Y]} to={[ADV_X - PAD_W / 2, A2_Y]} />
      <MiniTrace from={[ADV_X + PAD_W / 2, A1_Y]} to={[DEC_X - (PAD_W + 8) / 2, T_Y]} dashed />
      <MiniTrace from={[ADV_X + PAD_W / 2, A2_Y]} to={[DEC_X - (PAD_W + 8) / 2, T_Y]} dashed />
    </svg>
  );
}

function ConsultTile() {
  return (
    <svg viewBox="0 0 100 56" className="block w-full" aria-hidden>
      <circle cx={10} cy={28} r={4} fill={WARM} />
      <rect x={42} y={6} width={16} height={10} rx={1.5} fill="none" stroke={EDGE} strokeWidth={1.1} />
      <rect x={42} y={40} width={16} height={10} rx={1.5} fill="none" stroke={EDGE} strokeWidth={1.1} />
      <rect x={78} y={22} width={18} height={12} rx={1.5} fill="none" stroke={EDGE} strokeWidth={1.1} strokeDasharray="2 2" />
      <path d="M14 28 H30 V11 H42" stroke={EDGE} strokeWidth={1.1} fill="none" />
      <path d="M14 28 H30 V45 H42" stroke={EDGE} strokeWidth={1.1} fill="none" />
      <path d="M58 11 H68 V28 H78" stroke={EDGE} strokeWidth={1.1} fill="none" strokeDasharray="2 2" />
      <path d="M58 45 H68 V28 H78" stroke={EDGE} strokeWidth={1.1} fill="none" strokeDasharray="2 2" />
    </svg>
  );
}

function FanoutTile() {
  return (
    <svg viewBox="0 0 100 56" className="block w-full" aria-hidden>
      <circle cx={10} cy={28} r={4} fill={WARM} />
      <line x1={14} y1={28} x2={40} y2={28} stroke={EDGE} strokeWidth={1.1} />
      <line x1={40} y1={8} x2={40} y2={48} stroke={EDGE} strokeWidth={2} />
      {[8, 22, 36, 50].map((y) => (
        <g key={y}>
          <line x1={40} y1={y} x2={62} y2={y} stroke={EDGE} strokeWidth={1.1} />
          <rect x={62} y={y - 4} width={28} height={8} rx={1.5} fill="none" stroke={EDGE} strokeWidth={1.1} />
        </g>
      ))}
    </svg>
  );
}

function PipelineTile() {
  return (
    <svg viewBox="0 0 100 56" className="block w-full" aria-hidden>
      <circle cx={8} cy={28} r={4} fill={WARM} />
      {[24, 50, 76].map((x, i) => (
        <rect
          key={x}
          x={x}
          y={22}
          width={16}
          height={12}
          rx={1.5}
          fill="none"
          stroke={EDGE}
          strokeWidth={1.1}
          strokeDasharray={i === 2 ? "2 2" : undefined}
        />
      ))}
      {[12, 40, 66].map((x) => (
        <line key={x} x1={x} y1={28} x2={x + 12} y2={28} stroke={EDGE} strokeWidth={1.1} />
      ))}
    </svg>
  );
}

function QuorumTile() {
  return (
    <svg viewBox="0 0 100 56" className="block w-full" aria-hidden>
      <circle cx={8} cy={28} r={4} fill={WARM} />
      {[8, 28, 48].map((y) => (
        <rect key={y} x={36} y={y - 4} width={16} height={8} rx={1.5} fill="none" stroke={EDGE} strokeWidth={1.1} />
      ))}
      <rect x={74} y={22} width={20} height={12} rx={1.5} fill="none" stroke={EDGE} strokeWidth={1.1} strokeDasharray="2 2" />
      {[8, 28, 48].map((y) => (
        <g key={y}>
          <path d={`M12 28 H24 V${y} H36`} stroke={EDGE} strokeWidth={1.1} fill="none" />
          <path d={`M52 ${y} H64 V28 H74`} stroke={EDGE} strokeWidth={1.1} fill="none" />
        </g>
      ))}
    </svg>
  );
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║ Glyphs (hand-drawn, match Ticker geometry)                       ║
// ╚══════════════════════════════════════════════════════════════════╝

/** Anchor glyph — a tiny pin-drop shape pointing inward to the gutter
 *  edge. Used in the right gutter to mark where a clicked span lives
 *  in the column. Warm when the click is live; ink-faint otherwise. */
function AnchorGlyph({ warm }: { warm?: boolean }) {
  const stroke = warm ? "var(--scout-accent)" : "var(--studio-ink-faint)";
  return (
    <svg width={10} height={12} viewBox="0 0 10 12" fill="none" aria-hidden>
      {/* drop body */}
      <path
        d="M5 11 L1.5 6 A3.5 3.5 0 1 1 8.5 6 Z"
        stroke={stroke}
        strokeWidth={1.2}
        strokeLinejoin="miter"
        fill="none"
      />
      {/* warm dot in the bell when active */}
      <circle
        cx={5}
        cy={5}
        r={1.2}
        fill={warm ? "var(--scout-accent)" : "transparent"}
        stroke={warm ? "none" : stroke}
        strokeWidth={warm ? 0 : 1}
      />
    </svg>
  );
}

/** Margin annotation marker — small angle bracket, ink only. Stays
 *  quiet so the saved feedback list doesn't compete with the brief
 *  body or the active click anchor. */
function AnnotationMarkGlyph() {
  return (
    <svg
      width={9}
      height={10}
      viewBox="0 0 10 12"
      fill="none"
      aria-hidden
      className="shrink-0"
    >
      <path
        d="M2 2 L7 6 L2 10"
        stroke="var(--studio-ink-faint)"
        strokeWidth={1.2}
        strokeLinejoin="miter"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/** Send arrow glyph for the top-right batch handoff action. The
 *  optional warm variant is the one accent on the surface chrome. */
function SendArrowGlyph({ warm }: { warm?: boolean }) {
  const color = warm ? "var(--scout-accent)" : "var(--studio-ink)";
  return (
    <svg width={11} height={9} viewBox="0 0 14 10" fill="none" aria-hidden>
      <line
        x1={1}
        y1={5}
        x2={11}
        y2={5}
        stroke={color}
        strokeWidth={1.3}
        strokeLinecap="round"
      />
      <path
        d="M8 1.5 L12 5 L8 8.5"
        stroke={color}
        strokeWidth={1.3}
        fill="none"
        strokeLinejoin="miter"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Radial dot-cluster glyph — the agent's "thinking" mark from v2.
 *  Centre dot is warm (the one accent in the processing badge);
 *  satellites are ink-faint; dashed orbit around all of it. */
function AgentThinkingGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width={12} height={12} viewBox="0 0 14 14" aria-hidden {...props}>
      <circle cx={7} cy={7} r={1.6} fill="var(--scout-accent)" />
      <circle cx={2.5} cy={7} r={1} fill="var(--studio-ink-faint)" />
      <circle cx={11.5} cy={7} r={1} fill="var(--studio-ink-faint)" />
      <circle cx={7} cy={2.5} r={1} fill="var(--studio-ink-faint)" />
      <circle cx={7} cy={11.5} r={1} fill="var(--studio-ink-faint)" />
      <circle
        cx={7}
        cy={7}
        r={5.5}
        fill="none"
        stroke="var(--studio-edge-strong)"
        strokeWidth={0.8}
        strokeDasharray="1.5 1.5"
      />
    </svg>
  );
}

function DossierMark({ hue }: { hue: number }) {
  // 2×3 micro-grid — same family as role-builder's CodenameMark
  const on = `oklch(0.78 0.14 ${hue})`;
  const off = "var(--studio-edge-strong)";
  const cells = [1, 0, 1, 1, 1, 0];
  return (
    <svg width={10} height={14} aria-hidden className="shrink-0">
      {cells.map((c, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        return (
          <rect
            key={i}
            x={col * 5}
            y={row * 5 + 0.5}
            width={4}
            height={4}
            rx={0.8}
            fill={c ? on : off}
          />
        );
      })}
    </svg>
  );
}

function AgentHandle({ name, hue }: { name: string; hue: number }) {
  return (
    <span
      className="font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink"
      style={{
        background: `linear-gradient(90deg, oklch(0.74 0.15 ${hue}) 0 5px, transparent 5px)`,
        paddingLeft: 9,
      }}
    >
      @{name}
    </span>
  );
}

function Dot() {
  return <span className="text-studio-ink-faint">·</span>;
}

// ╔══════════════════════════════════════════════════════════════════╗
// ║ Shared chrome                                                     ║
// ╚══════════════════════════════════════════════════════════════════╝

function Eyebrow() {
  return (
    <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
      · studies · web · operator-brief · brief-author
    </div>
  );
}

function SectionTitle({
  children,
  hint,
  className = "",
}: {
  children: ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={`flex items-baseline gap-3 ${className}`}>
      <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        · {children}
      </div>
      {hint ? (
        <div className="font-mono text-[10px] text-studio-ink-faint">
          {hint}
        </div>
      ) : null}
      <div className="ml-3 h-px flex-1 bg-studio-edge" />
    </div>
  );
}

