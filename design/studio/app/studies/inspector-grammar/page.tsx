/**
 * Inspector Grammar — the unified design language for the right-rail
 * inspector across Scout macOS, and any future Scout surface that
 * needs the same right-rail pattern.
 *
 * Why this page exists
 * --------------------
 * Today the three macOS inspectors (Agent, Repo, Tail) read like three
 * designers' work: each has a different section-title mark (bare /
 * leading-dot / overline), a different label-value layout (inline row /
 * stacked), different divider policy (hairlines / spacing / spacing),
 * and different status-badge weight (ghost / filled / inline). The
 * scaffolding is shared (title rule, dark surface, mono body) but the
 * *grammar* isn't, so the operator can't scan across surfaces and
 * know where to look.
 *
 * What this page is
 * -----------------
 * §1  The grammar.  Nine specimens, each demonstrating one rule.
 * §2  Policy.       The rules in prose, so a future implementer can
 *                   follow the spec without re-reading the specimens.
 * §3  In the wild.  The three inspectors rebuilt from the grammar so
 *                   you can verify the same rules produce coherent
 *                   treatments in all three contexts.
 * §4  Token map.    Which CSS var backs which part.
 *
 * Once this study is approved, the same grammar goes back into
 * `apps/macos/Sources/Scout/{ScoutRootView,ScoutReposView,ScoutTailView}.swift`
 * as a shared inspector component, with the studio's `--studio-*` and
 * `--status-*` vars mapped to the native `--hud-*` palette at the edge.
 *
 * Status: draft.
 */

import { EyebrowLabel } from "@/components/EyebrowLabel";
import { StatusPill } from "@/components/StatusPill";

/* ────────────────────────────────────────────────────────────────────
   Specimens — §1
   Each specimen renders one rule in isolation. The label above tells
   you what to look for. The specimen below is the live artifact.
   ──────────────────────────────────────────────────────────────────── */

function SpecimenCard({
  label,
  note,
  children,
}: {
  label: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-studio-edge bg-studio-canvas-alt p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink">
          {label}
        </div>
        <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          {note}
        </div>
      </div>
      <div className="rounded-md border border-studio-edge bg-studio-surface p-4 text-studio-ink">
        {children}
      </div>
    </div>
  );
}

/* 1.1  Title rule + eyebrow.  2px vertical bar in --scout-accent, full
   height of the eyebrow row, with a mono uppercase eyebrow to the
   right. The bar is the *only* place the accent lives in chrome. */
function SpecTitleRule() {
  return (
    <div className="flex items-center gap-2.5">
      <div
        aria-hidden
        className="h-3.5 w-0.5 rounded-[1px]"
        style={{ background: "var(--scout-accent)" }}
      />
      <EyebrowLabel bullet={false} size="sm">
        AGENT
      </EyebrowLabel>
    </div>
  );
}

/* 1.2  Identity block.  Large display name + secondary mono line.
   No leading dot — identity is the entity name, dots are reserved
   for state. */
function SpecIdentity() {
  return (
    <div>
      <div className="font-sans text-[16px] font-semibold leading-tight tracking-tight text-studio-ink">
        Action
      </div>
      <div className="mt-0.5 font-mono text-[10px] text-studio-ink-faint">
        action.codex-polished-mira-demo.arts-mac-mini-local
      </div>
    </div>
  );
}

/* 1.3  Status badge.  Filled tinted pill, one weight, three tones.
   Always filled — never a ghost dot+label, never an inline coloured
   word. Lets the operator scan across surfaces for ATTENTION. */
function SpecStatusBadge() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusPill tone="ok" label="AVAILABLE" />
      <StatusPill tone="warn" label="WORKING" />
      <StatusPill tone="error" label="ATTENTION" />
      <StatusPill tone="info" label="IDLE" />
      <StatusPill tone="neutral" label="OFFLINE" />
    </div>
  );
}

/* 1.4  Section title.  Mono uppercase 9px faint with a 16px-wide
   hairline overline rule above it. The rule is the *only* anchor;
   no leading dot, no leading bullet. Same shape on every surface. */
function SpecSectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <div
        aria-hidden
        className="mb-1.5 h-px w-3.5"
        style={{ background: "var(--studio-edge-strong)" }}
      />
      <EyebrowLabel bullet={false} size="sm">
        {children}
      </EyebrowLabel>
    </div>
  );
}

/* 1.5  Section content.  No divider below the section. Spacing only.
   Stacked label-on-top, value right-aligned below. 2 of 3 current
   inspectors already use this; the third (Agent) collapses to it. */
function SpecKeyValue({
  rows,
}: {
  rows: { k: string; v: string; emphasis?: boolean }[];
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <div
          key={r.k}
          className="grid grid-cols-[1fr_auto] items-baseline gap-x-3"
        >
          <span className="truncate font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
            {r.k}
          </span>
          <span
            className={[
              "truncate font-mono text-[10.5px] text-right",
              r.emphasis ? "text-studio-ink" : "text-studio-ink-muted",
            ].join(" ")}
          >
            {r.v}
          </span>
        </div>
      ))}
    </div>
  );
}

/* 1.6  Stat callout.  1px border, label-on-top in mono uppercase
   faint, big mono number below. Used only when a number *is* the
   point — never decorative, never paired with a label whose value
   is just text. */
function SpecStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[5px] border border-studio-edge bg-studio-canvas-alt px-2.5 py-1.5">
      <div className="font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[18px] font-medium tabular-nums leading-none text-studio-ink">
        {value}
      </div>
    </div>
  );
}

function SpecStatGrid() {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      <SpecStat label="Logs" value="40" />
      <SpecStat label="Processes" value="19" />
      <SpecStat label="Sessions" value="4" />
      <SpecStat label="Buffered" value="700" />
    </div>
  );
}

/* 1.7  Trailing description.  Faint mono one-liner under a section
   title or under a list — used when the section needs a one-sentence
   definition, or when a list group's contents need a primer. */
function SpecDescription() {
  return (
    <div className="flex flex-col gap-1.5">
      <SpecSectionTitle>Tracks</SpecSectionTitle>
      <div className="flex flex-col gap-0.5">
        <div className="font-sans text-[11px] font-semibold text-studio-ink">
          Transcript logs
        </div>
        <div className="font-mono text-[9.5px] leading-snug text-studio-ink-faint">
          Claude and Codex JSONL files discovered on disk.
        </div>
      </div>
    </div>
  );
}

/* 1.8  Action row.  Primary filled button + secondary ghost button.
   Render only when there is a primary action; never reserve
   whitespace for an empty row. Primary uses --scout-accent for fg. */
function SpecActionRow() {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="rounded-[5px] border px-2.5 py-1 font-mono text-[9.5px] font-semibold uppercase tracking-eyebrow"
        style={{
          background: "var(--scout-accent-soft)",
          borderColor: "var(--scout-accent)",
          color: "var(--scout-accent)",
        }}
      >
        Message
      </button>
      <button
        type="button"
        className="rounded-[5px] border border-studio-edge bg-transparent px-2.5 py-1 font-mono text-[9.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-muted"
      >
        + New conversation
      </button>
    </div>
  );
}

/* 1.9  Spacing rhythm.  Section to section: 12px. Section title to
   first row: 6px. Row to row inside a section: 6px. Section header
   to overline: 6px. Hard-coded numbers are fine — they describe one
   inspector width, not a system. */
function SpecRhythm() {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div
          aria-hidden
          className="mb-1.5 h-px w-3.5"
          style={{ background: "var(--studio-edge-strong)" }}
        />
        <EyebrowLabel bullet={false} size="sm">
          Section A
        </EyebrowLabel>
        <div className="mt-1.5 flex flex-col gap-1.5">
          <SpecKeyValue rows={[{ k: "Role", v: "Relay agent" }]} />
        </div>
      </div>
      <div>
        <div
          aria-hidden
          className="mb-1.5 h-px w-3.5"
          style={{ background: "var(--studio-edge-strong)" }}
        />
        <EyebrowLabel bullet={false} size="sm">
          Section B
        </EyebrowLabel>
        <div className="mt-1.5 flex flex-col gap-1.5">
          <SpecKeyValue rows={[{ k: "Branch", v: "main" }]} />
        </div>
      </div>
      <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        ↑ 12px between sections · 6px title→row · 6px row→row
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   In-the-wild inspector frame — §3 helper
   The single shared chrome all three inspectors get. Width locked
   to 300px to match the live macOS inspector column.
   ──────────────────────────────────────────────────────────────────── */

function InspectorFrame({
  kind,
  status,
  children,
}: {
  kind: string;
  status?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="w-[300px] rounded-md border border-studio-edge bg-studio-surface">
      {/* title row: title rule + eyebrow + (optional) status badge */}
      <div className="flex items-center justify-between border-b border-studio-edge px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <div
            aria-hidden
            className="h-3.5 w-0.5 rounded-[1px]"
            style={{ background: "var(--scout-accent)" }}
          />
          <EyebrowLabel bullet={false} size="sm">
            {kind}
          </EyebrowLabel>
        </div>
        {status ?? null}
      </div>
      {/* body — 14px outer padding; sections handle their own internal spacing */}
      <div className="flex flex-col gap-3 px-3.5 py-3">{children}</div>
    </div>
  );
}

/* Section is the universal building block. Title + overline + spacing,
   no divider, no leading dot, no inline rule. */
function InspectorSection({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div>
        <div
          aria-hidden
          className="mb-1.5 h-px w-3.5"
          style={{ background: "var(--studio-edge-strong)" }}
        />
        <EyebrowLabel bullet={false} size="sm">
          {label}
        </EyebrowLabel>
      </div>
      {children}
      {description ? (
        <div className="font-mono text-[9.5px] leading-snug text-studio-ink-faint">
          {description}
        </div>
      ) : null}
    </div>
  );
}

/* Identity block — no leading dot, big name + secondary mono line. */
function InspectorIdentity({
  name,
  sub,
}: {
  name: string;
  sub: string;
}) {
  return (
    <div>
      <div className="truncate font-sans text-[16px] font-semibold leading-tight tracking-tight text-studio-ink">
        {name}
      </div>
      <div className="truncate font-mono text-[10px] text-studio-ink-faint">
        {sub}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   In-the-wild specimens — §3
   Each inspector is built from the same primitives. Compare them
   to the three live screenshots from the macOS app — the scaffolding
   reads the same; the grammar is the part that's now consistent.
   ──────────────────────────────────────────────────────────────────── */

function AgentInspector() {
  return (
    <InspectorFrame
      kind="AGENT"
      status={<StatusPill tone="ok" label="AVAILABLE" />}
    >
      <InspectorIdentity
        name="Action"
        sub="action.codex-polished-mira-demo.arts-mac-mini-local"
      />
      <div className="-mx-1 flex items-center gap-2 px-1">
        <button
          type="button"
          className="rounded-[5px] border px-2.5 py-1 font-mono text-[9.5px] font-semibold uppercase tracking-eyebrow"
          style={{
            background: "var(--scout-accent-soft)",
            borderColor: "var(--scout-accent)",
            color: "var(--scout-accent)",
          }}
        >
          Message
        </button>
        <button
          type="button"
          className="rounded-[5px] border border-studio-edge bg-transparent px-2.5 py-1 font-mono text-[9.5px] font-semibold uppercase tracking-eyebrow text-studio-ink-muted"
        >
          + New conversation
        </button>
      </div>
      <InspectorSection label="Runtime">
        <SpecKeyValue
          rows={[
            { k: "Role", v: "Relay agent" },
            { k: "Harness", v: "claude" },
            { k: "Transport", v: "claude_stream_json" },
            { k: "Model", v: "—" },
            { k: "Node", v: "Arts-Mac-mini.local" },
          ]}
        />
      </InspectorSection>
      <InspectorSection label="Workspace">
        <SpecKeyValue
          rows={[
            { k: "Branch", v: "codex/polished-mira-demo" },
            { k: "Path", v: "~/dev/action" },
            { k: "cId", v: "c.ab3fd029-807a-4aff-…" },
          ]}
        />
      </InspectorSection>
      <InspectorSection label="Session">
        <SpecKeyValue
          rows={[
            { k: "Id", v: "relay-action-claude" },
            { k: "Active", v: "1d" },
          ]}
        />
      </InspectorSection>
    </InspectorFrame>
  );
}

function RepoInspector() {
  return (
    <InspectorFrame
      kind="REPO"
      status={<StatusPill tone="warn" label="ATTENTION" />}
    >
      <InspectorIdentity name="lattices" sub="/Users/art/dev/lattices" />
      <InspectorSection label="Why">
        <div className="font-mono text-[10.5px] text-studio-ink-muted">
          Dirty main
        </div>
      </InspectorSection>
      <InspectorSection label="Worktrees">
        <SpecKeyValue
          rows={[
            { k: "Total", v: "1" },
            { k: "Dirty", v: "1" },
          ]}
        />
      </InspectorSection>
      <InspectorSection label="Changes">
        <SpecKeyValue
          rows={[
            { k: "Staged", v: "0" },
            { k: "Unstaged", v: "2" },
            { k: "Untracked", v: "0" },
          ]}
        />
      </InspectorSection>
      <InspectorSection label="Attached">
        <SpecKeyValue
          rows={[
            { k: "Agents", v: "2" },
            { k: "Sessions", v: "2" },
          ]}
        />
      </InspectorSection>
    </InspectorFrame>
  );
}

function TailInspector() {
  return (
    <InspectorFrame kind="OVERVIEW">
      <InspectorSection label="Coverage">
        <div className="grid grid-cols-2 gap-1.5">
          <SpecStat label="Logs" value="40" />
          <SpecStat label="Processes" value="19" />
          <SpecStat label="Sessions" value="4" />
          <SpecStat label="Buffered" value="700" />
        </div>
      </InspectorSection>
      <InspectorSection
        label="Sources"
        description="Which harnesses are writing to the tail."
      >
        <SpecKeyValue
          rows={[
            { k: "codex", v: "515", emphasis: true },
            { k: "claude", v: "185" },
          ]}
        />
      </InspectorSection>
      <InspectorSection label="Origins">
        <SpecKeyValue
          rows={[
            { k: "native", v: "626", emphasis: true },
            { k: "scout", v: "74" },
          ]}
        />
      </InspectorSection>
      <InspectorSection label="Kinds">
        <SpecKeyValue
          rows={[
            { k: "System", v: "197" },
            { k: "Tool result", v: "185" },
            { k: "Tool", v: "168" },
            { k: "Assistant", v: "93" },
            { k: "Other", v: "52" },
            { k: "User", v: "5" },
          ]}
        />
      </InspectorSection>
      <InspectorSection label="Tracks">
        <div className="flex flex-col gap-1.5">
          <div>
            <div className="font-sans text-[11px] font-semibold text-studio-ink">
              Transcript logs
            </div>
            <div className="font-mono text-[9.5px] leading-snug text-studio-ink-faint">
              Claude and Codex JSONL files discovered on disk.
            </div>
          </div>
          <div>
            <div className="font-sans text-[11px] font-semibold text-studio-ink">
              Live processes
            </div>
            <div className="font-mono text-[9.5px] leading-snug text-studio-ink-faint">
              Harness process inventory and parent attribution.
            </div>
          </div>
          <div>
            <div className="font-sans text-[11px] font-semibold text-studio-ink">
              Sessions
            </div>
            <div className="font-mono text-[9.5px] leading-snug text-studio-ink-faint">
              Session IDs and short row links.
            </div>
          </div>
          <div>
            <div className="font-sans text-[11px] font-semibold text-studio-ink">
              Projects
            </div>
            <div className="font-mono text-[9.5px] leading-snug text-studio-ink-faint">
              Current working directory and project labels.
            </div>
          </div>
        </div>
      </InspectorSection>
      <InspectorSection
        label="Defaults"
        description="Metadata includes records like model, title, permission-mode, and last-prompt."
      >
        <label className="flex items-center gap-2 font-mono text-[10.5px] text-studio-ink-muted">
          <input
            type="checkbox"
            defaultChecked
            className="h-3 w-3 accent-scout-accent"
          />
          Show transcript metadata
        </label>
      </InspectorSection>
    </InspectorFrame>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Mini diff — §3 lead-in
   Three concrete before/after strips that show the most
   load-bearing changes in isolation. Saves a paragraph of prose.
   ──────────────────────────────────────────────────────────────────── */

function MiniDiff({
  before,
  after,
  caption,
}: {
  before: React.ReactNode;
  after: React.ReactNode;
  caption: string;
}) {
  return (
    <div>
      <div className="mb-2 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
        {caption}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-md border border-studio-edge bg-studio-canvas-alt p-3">
          <div className="mb-2 font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
            Before
          </div>
          <div className="rounded-md border border-studio-edge bg-studio-surface p-3 text-studio-ink">
            {before}
          </div>
        </div>
        <div className="rounded-md border border-studio-edge bg-studio-canvas-alt p-3">
          <div className="mb-2 font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
            After
          </div>
          <div className="rounded-md border border-studio-edge bg-studio-surface p-3 text-studio-ink">
            {after}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Page
   ──────────────────────────────────────────────────────────────────── */

export default function InspectorGrammarPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-10 max-w-prose">
        <EyebrowLabel size="sm">· studies · macos · inspector-grammar</EyebrowLabel>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Inspector grammar
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The unified design language for the Scout macOS right-rail
          inspector — and any future Scout surface that needs the same
          pattern. One set of rules, applied to the Agent, Repo, and Tail
          inspectors. Built first in the studio so we can audit the
          grammar by looking at it; the same rules then port to{" "}
          <code className="text-studio-ink-muted">apps/macos/Sources/Scout/</code>{" "}
          as a shared <em>InspectorFrame</em> component.
        </p>
      </header>

      {/* ──────────────────────────────────────────────────────────────
          §1 — The grammar
          ────────────────────────────────────────────────────────────── */}
      <section className="mb-14">
        <h2 className="mb-1 font-display text-[18px] font-medium tracking-tight text-studio-ink">
          §1 · The grammar
        </h2>
        <p className="mb-5 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Nine rules. Each specimen below shows one rule in isolation. The
          first three — title rule, identity block, status badge — belong
          to the inspector's <em>chrome</em>. The next three — section
          title, key-value, stat callout — belong to its <em>body</em>.
          The last three — description, action row, spacing rhythm — are
          the optional / structural pieces.
        </p>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SpecimenCard label="1.1 Title rule + eyebrow" note="chrome">
            <SpecTitleRule />
          </SpecimenCard>
          <SpecimenCard label="1.2 Identity block" note="chrome">
            <SpecIdentity />
          </SpecimenCard>
          <SpecimenCard label="1.3 Status badge" note="chrome · always filled">
            <SpecStatusBadge />
          </SpecimenCard>
          <SpecimenCard label="1.4 Section title" note="body · overline rule">
            <SpecSectionTitle>Runtime</SpecSectionTitle>
          </SpecimenCard>
          <SpecimenCard label="1.5 Key-value pair" note="body · stacked">
            <SpecKeyValue
              rows={[
                { k: "Role", v: "Relay agent" },
                { k: "Harness", v: "claude" },
                { k: "Transport", v: "claude_stream_json" },
              ]}
            />
          </SpecimenCard>
          <SpecimenCard label="1.6 Stat callout" note="body · when a number is the point">
            <SpecStatGrid />
          </SpecimenCard>
          <SpecimenCard label="1.7 Trailing description" note="body · optional">
            <SpecDescription />
          </SpecimenCard>
          <SpecimenCard label="1.8 Action row" note="chrome · conditional">
            <SpecActionRow />
          </SpecimenCard>
          <SpecimenCard label="1.9 Spacing rhythm" note="structural">
            <SpecRhythm />
          </SpecimenCard>
        </div>
      </section>

      {/* ──────────────────────────────────────────────────────────────
          §2 — Policy
          ────────────────────────────────────────────────────────────── */}
      <section className="mb-14">
        <h2 className="mb-1 font-display text-[18px] font-medium tracking-tight text-studio-ink">
          §2 · Policy
        </h2>
        <p className="mb-5 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The rules, in order of how much they affect the look. Each one
          has a "why" — that's the part that survives if a future
          implementer wants to bend it.
        </p>

        <ol className="flex max-w-prose flex-col gap-4 font-sans text-[13px] leading-relaxed text-studio-ink">
          <Policy
            n="1"
            title="Section title is a hairline overline + mono uppercase. Always."
            body="No leading dot, no leading bullet, no inline rule. A 16px-wide hairline (--studio-edge-strong) sits 6px above a mono uppercase 9px label (--studio-ink-faint). This is the single most-seen piece of inspector chrome; making it identical across surfaces is what makes the inspector feel like one product."
          />
          <Policy
            n="2"
            title="Status badge is always filled. Tone changes, weight doesn't."
            body="Use --status-{ok|warn|error|info|neutral}-{bg,fg}. AVAILABLE, ATTENTION, IDLE, OFFLINE — all the same pill weight, all the same height, only the color differs. The operator should be able to scan across three inspectors and pick out the ATTENTION ones by color alone."
          />
          <Policy
            n="3"
            title="Label-value pairs are stacked. Always."
            body="Mono uppercase label on top, value right-aligned below. The label column is 100% width, the value column is auto. This holds at 300px inspector width; the inline 72px-label-row pattern collapses to it."
          />
          <Policy
            n="4"
            title="No dividers between sections. Spacing only."
            body="12px between sections, 6px title-to-first-row, 6px row-to-row. The body of the inspector is a column of sections; the rhythm is what separates them, not hairlines."
          />
          <Policy
            n="5"
            title="Identity block has no leading dot."
            body="A large display name + a secondary mono line. The accent dot is reserved for the title rule (chrome) and for state markers (avatar context, list bullets that mean 'this row is attention-worthy'). Putting it in front of the entity name is a stray accent — kill it."
          />
          <Policy
            n="6"
            title="The orange accent lives in two places: the title rule and the primary action."
            body="That's it. Not in identity. Not in section titles. Not as decoration on every WHY / WORKTREES / CHANGES row. Accent is expensive; spend it on the title rule (so the inspector is locatable) and on the primary CTA (so it's findable)."
          />
          <Policy
            n="7"
            title="Stat callouts are used when a number is the point."
            body="Boxed, label-on-top, big mono number. Reach for it when you have 1–8 numbers to surface (logs · processes · sessions · buffered). Don't reach for it when the value is just text or when the value appears inside a key-value list. Repos could use one for DIRTY count; Agents could use one for SESSION count."
          />
          <Policy
            n="8"
            title="Trailing description is one faint mono line, used when a section needs a definition."
            body="Use it under a list group whose categories aren't obvious (Tail's TRACKS). Don't use it as filler. Don't use it under a single key-value row."
          />
          <Policy
            n="9"
            title="Action row renders only when there's a primary action."
            body="Primary uses --scout-accent-soft bg + --scout-accent border + --scout-accent fg. Secondary uses a ghost border in --studio-edge. Don't reserve whitespace for an empty row — the other two inspectors have nothing here and that's correct."
          />
        </ol>
      </section>

      {/* ──────────────────────────────────────────────────────────────
          §3 — In the wild
          ────────────────────────────────────────────────────────────── */}
      <section className="mb-14">
        <h2 className="mb-1 font-display text-[18px] font-medium tracking-tight text-studio-ink">
          §3 · In the wild
        </h2>
        <p className="mb-5 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The three inspectors rebuilt from the grammar, at the real
          300px inspector width. The same primitives; the same chrome.
          Compare them to the live macOS screenshots — what's changed is
          the grammar, not the content.
        </p>

        <div className="mb-10 flex flex-wrap items-start gap-8">
          <div>
            <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-scout-accent">
              Agent inspector
            </div>
            <AgentInspector />
          </div>
          <div>
            <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-scout-accent">
              Repo inspector
            </div>
            <RepoInspector />
          </div>
          <div>
            <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-scout-accent">
              Tail inspector
            </div>
            <TailInspector />
          </div>
        </div>

        <h3 className="mb-3 font-display text-[15px] font-medium tracking-tight text-studio-ink">
          Concrete diffs
        </h3>
        <p className="mb-5 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Three of the rule changes, side by side. The point is to show
          that the diffs are local — single-element swaps, not a
          redesign of each inspector.
        </p>

        <div className="flex flex-col gap-6">
          <MiniDiff
            caption="Section title: leading-dot (Repos) → overline rule (all three)"
            before={
              <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
                <span className="mr-1.5 text-scout-accent">●</span>
                Why
              </div>
            }
            after={<SpecSectionTitle>Why</SpecSectionTitle>}
          />
          <MiniDiff
            caption="Key-value: inline row with 72px label column (Agent) → stacked (all three)"
            before={
              <div className="grid grid-cols-[72px_1fr] items-baseline gap-x-2 font-mono text-[10.5px]">
                <span className="uppercase tracking-eyebrow text-studio-ink-faint">
                  Role
                </span>
                <span className="truncate text-right text-studio-ink">
                  Relay agent
                </span>
                <span className="uppercase tracking-eyebrow text-studio-ink-faint">
                  Harness
                </span>
                <span className="truncate text-right text-studio-ink">claude</span>
              </div>
            }
            after={
              <SpecKeyValue
                rows={[
                  { k: "Role", v: "Relay agent" },
                  { k: "Harness", v: "claude" },
                ]}
              />
            }
          />
          <MiniDiff
            caption="Status badge: weight varies by state (ghost for AVAILABLE, filled for ATTENTION) → always filled"
            before={
              <div className="flex items-center gap-3">
                <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-status-ok-fg">
                  <span className="mr-1.5">●</span>
                  Available
                </span>
                <span
                  className="rounded-[3px] px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-[0.18em]"
                  style={{
                    background: "var(--status-warn-bg)",
                    color: "var(--status-warn-fg)",
                  }}
                >
                  ATTENTION
                </span>
              </div>
            }
            after={
              <div className="flex items-center gap-2">
                <StatusPill tone="ok" label="AVAILABLE" />
                <StatusPill tone="warn" label="ATTENTION" />
              </div>
            }
          />
        </div>
      </section>

      {/* ──────────────────────────────────────────────────────────────
          §4 — Token map
          ────────────────────────────────────────────────────────────── */}
      <section className="mb-8">
        <h2 className="mb-1 font-display text-[18px] font-medium tracking-tight text-studio-ink">
          §4 · Token map
        </h2>
        <p className="mb-5 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          What backs what. The macOS app's <code className="text-studio-ink-muted">ScoutTheme</code>{" "}
          owns the same role-set under the <code className="text-studio-ink-muted">--hud-*</code>{" "}
          prefix; the studio values here are the ones that ship in the
          next studio build, mapped 1:1.
        </p>

        <div className="overflow-hidden rounded-md border border-studio-edge">
          <table className="w-full border-collapse font-mono text-[11px]">
            <thead>
              <tr className="bg-studio-canvas-alt text-left text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
                <th className="px-3 py-2">Part</th>
                <th className="px-3 py-2">Studio token</th>
                <th className="px-3 py-2">macOS native token</th>
                <th className="px-3 py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {TOKEN_MAP.map((row, i) => (
                <tr
                  key={row.part}
                  className={[
                    "align-top",
                    i % 2 === 0 ? "bg-studio-surface" : "bg-studio-canvas-alt",
                  ].join(" ")}
                >
                  <td className="px-3 py-2 text-studio-ink">{row.part}</td>
                  <td className="px-3 py-2 text-studio-ink-muted">
                    {row.studio}
                  </td>
                  <td className="px-3 py-2 text-studio-ink-muted">
                    {row.macos}
                  </td>
                  <td className="px-3 py-2 text-studio-ink-faint">
                    {row.notes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="border-t border-studio-edge pt-4 font-mono text-[9.5px] uppercase tracking-eyebrow text-studio-ink-faint">
        Status · draft ·{" "}
        <span className="text-studio-ink-muted">ports to</span>{" "}
        apps/macos/Sources/Scout/{`{ScoutRootView,ScoutReposView,ScoutTailView}.swift`}
      </footer>
    </main>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────────────── */

function Policy({
  n,
  title,
  body,
}: {
  n: string;
  title: string;
  body: string;
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] border border-studio-edge bg-studio-canvas-alt font-mono text-[10px] font-semibold text-studio-ink">
        {n}
      </span>
      <div>
        <div className="font-medium text-studio-ink">{title}</div>
        <div className="mt-0.5 text-studio-ink-faint">{body}</div>
      </div>
    </li>
  );
}

const TOKEN_MAP: {
  part: string;
  studio: string;
  macos: string;
  notes: string;
}[] = [
  {
    part: "Inspector surface",
    studio: "--studio-surface",
    macos: "--hud-surface",
    notes: "Card body. One step above canvas.",
  },
  {
    part: "Inspector edge",
    studio: "--studio-edge",
    macos: "--hud-edge",
    notes: "Title-row separator, stat-callout border.",
  },
  {
    part: "Title rule",
    studio: "--scout-accent",
    macos: "--hud-accent",
    notes: "2px vertical bar at the inspector's left.",
  },
  {
    part: "Section overline",
    studio: "--studio-edge-strong",
    macos: "--hud-edge-strong",
    notes: "16px-wide hairline above every section title.",
  },
  {
    part: "Eyebrow / section title",
    studio: "--studio-ink-faint",
    macos: "--hud-ink-faint",
    notes: "Mono uppercase 9px.",
  },
  {
    part: "Identity / value text",
    studio: "--studio-ink / --studio-ink-muted",
    macos: "--hud-ink / --hud-ink-muted",
    notes: "Identity uses ink; values use muted (unless emphasized).",
  },
  {
    part: "Status badge — ok",
    studio: "--status-ok-fg / --status-ok-bg",
    macos: "--hud-status-ok",
    notes: "Available, idle, ok.",
  },
  {
    part: "Status badge — warn",
    studio: "--status-warn-fg / --status-warn-bg",
    macos: "--hud-status-warn",
    notes: "Working, attention.",
  },
  {
    part: "Status badge — error",
    studio: "--status-error-fg / --status-error-bg",
    macos: "--hud-status-error",
    notes: "Failed, blocked.",
  },
  {
    part: "Status badge — info",
    studio: "--status-info-fg / --status-info-bg",
    macos: "--hud-status-info",
    notes: "Live, following.",
  },
  {
    part: "Primary action",
    studio: "--scout-accent-soft / --scout-accent",
    macos: "--hud-accent-soft / --hud-accent",
    notes: "Filled CTA, scout accent.",
  },
];
