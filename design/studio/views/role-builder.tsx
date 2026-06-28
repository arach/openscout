/**
 * Role Builder — static design study.
 *
 * The brief: agents get roles, and roles come with context (skills,
 * prompts, tools, permissions, file references). What does a
 * *constructed* agent look like as an artifact, and what does the
 * *act of construction* feel like?
 *
 * The idiom this study commits to: the **dossier**.
 *
 * A finished role is rendered as a personnel file — a masthead with
 * codename + classification, then a stack of typeset sections that
 * the eye reads top-to-bottom like a printed brief. Distinct from a
 * dashboard tile (telemetry) or a settings sheet (form fields):
 * this is identity as document.
 *
 * The act of construction is shown as a **bench** — the half-built
 * dossier on the left, a wall of labeled component drawers on the
 * right, and the verb is *mount* (HIG mounts; design tokens mount;
 * a file ref mounts). Nothing is "selected" or "checked" — pieces
 * physically attach.
 *
 * Everything here is static. No props change. No motion. Each cell
 * is a frozen frame so the operator can compare states side by side
 * before we go figure out how to make it real.
 */

import type { CSSProperties, ReactNode, SVGProps } from "react";

// ── Tokens / shared style fragments ─────────────────────────────────

const GLASS_PANEL: CSSProperties = {
  background: "color-mix(in oklab, var(--studio-canvas) 72%, transparent)",
  backdropFilter: "blur(14px) saturate(140%)",
  WebkitBackdropFilter: "blur(14px) saturate(140%)",
  boxShadow: "0 6px 24px -8px rgba(0,0,0,0.45)",
};

// Attachment "kinds" each get a distinct visual signature so a glance
// across a stack tells the operator what they're looking at.
type AttachmentKind =
  | "file" // single file in the repo
  | "tokens" // a token set (colors, type ramp)
  | "url" // external doc / link
  | "snippet" // a prompt-snippet / voice instruction
  | "tool" // a tool grant ([bash], [edit])
  | "skill" // a named skill module
  | "permission"; // a scoped permission

interface Attachment {
  kind: AttachmentKind;
  label: string;
  /** Sub-detail rendered smaller. Optional. */
  detail?: string;
  /** Hue 0-360. Optional — used by `tokens` swatch grids. */
  swatchHues?: number[];
}

// Constructed agents (the "dossier" instances) ──────────────────────

interface Dossier {
  codename: string;
  classification: string; // small uppercase line under the codename
  hue: number; // identity hue used in masthead band
  oneline: string; // one-sentence disposition
  disposition: string; // 3-5 line prompt fragment (italic in display)
  skills: Attachment[];
  tools: Attachment[];
  context: Attachment[]; // file refs, token sets, URLs, snippets
  permissions: Array<{ label: string; scope: string }>;
}

const DESIGN_AGENT: Dossier = {
  codename: "Atlas",
  classification: "Design · Cross-surface",
  hue: 210,
  oneline:
    "House designer. Holds the design system in working memory and answers in token names.",
  disposition:
    "Speak in tokens, not hex. Apple HIG is the spine; the studio palette is the skin. If a spec is asked for, return the smallest fully-typeset frame. Never invent a glyph when one exists.",
  skills: [
    { kind: "skill", label: "design-audit", detail: "HIG compliance pass" },
    { kind: "skill", label: "design-fix", detail: "apply token corrections" },
    { kind: "skill", label: "liquid-glass", detail: "iOS 26 glass idiom" },
    { kind: "skill", label: "validate-themes", detail: "dark / light parity" },
  ],
  tools: [
    { kind: "tool", label: "read" },
    { kind: "tool", label: "edit" },
    { kind: "tool", label: "grep" },
  ],
  context: [
    {
      kind: "tokens",
      label: "studio-palette",
      detail: "62 oklch tokens",
      swatchHues: [80, 125, 25, 155, 220, 280],
    },
    {
      kind: "tokens",
      label: "scout-hues",
      detail: "16 agent identity hues",
      swatchHues: [125, 210, 25, 85, 175, 340, 295, 280],
    },
    { kind: "url", label: "developer.apple.com/design/hig" },
    { kind: "file", label: "design/studio/app/globals.css" },
    { kind: "file", label: "packages/web/client/scout/Provider.tsx" },
    {
      kind: "snippet",
      label: "voice.design.md",
      detail: "house tone for design notes",
    },
  ],
  permissions: [
    { label: "read", scope: "design/**, packages/web/**" },
    { label: "write", scope: "design/studio/**" },
    { label: "bash", scope: "bun run build · bun lint" },
  ],
};

const SECURITY_AGENT: Dossier = {
  codename: "Pike",
  classification: "Security · Reviewer",
  hue: 25,
  oneline:
    "Suspicious by default. Reads diffs for what they let attackers do, not what they ship.",
  disposition:
    "Assume an adversary. Quote line numbers when you flag. Threat-model in three sentences max; full STRIDE only when asked. Never approve auth changes without a re-read 30 seconds later.",
  skills: [
    { kind: "skill", label: "security-review", detail: "branch-scoped audit" },
    { kind: "skill", label: "debug", detail: "5-phase root cause" },
  ],
  tools: [
    { kind: "tool", label: "read" },
    { kind: "tool", label: "grep" },
    { kind: "tool", label: "git" },
  ],
  context: [
    { kind: "file", label: "packages/runtime/src/auth/**" },
    { kind: "file", label: "apps/cloud/src/middleware/**" },
    {
      kind: "snippet",
      label: "threat-model.md",
      detail: "shared assumptions",
    },
    { kind: "url", label: "owasp.org/Top10/2025" },
    { kind: "url", label: "cwe.mitre.org/top25" },
  ],
  permissions: [
    { label: "read", scope: "all" },
    { label: "write", scope: "(none) — read-only reviewer" },
    { label: "bash", scope: "git log · git diff · gh pr view" },
  ],
};

const MIGRATION_AGENT: Dossier = {
  codename: "Drover",
  classification: "Migration · Operator",
  hue: 125,
  oneline:
    "Moves schemas and data without losing anyone. Carries the runbook in its head.",
  disposition:
    "Always dry-run first. Print the row count before and after. If a column rename, write the rollback in the same PR. Never run a destructive statement without confirmation in the response.",
  skills: [
    { kind: "skill", label: "schema-diff", detail: "drizzle introspect" },
    { kind: "skill", label: "rollback-plan", detail: "generate inverse" },
  ],
  tools: [
    { kind: "tool", label: "read" },
    { kind: "tool", label: "edit" },
    { kind: "tool", label: "bash" },
    { kind: "tool", label: "psql" },
  ],
  context: [
    { kind: "file", label: "packages/runtime/db/schema.ts" },
    { kind: "file", label: "packages/runtime/db/migrations/" },
    {
      kind: "snippet",
      label: "runbook.migrations.md",
      detail: "dry-run · apply · verify · rollback",
    },
    {
      kind: "permission",
      label: "staging.db.write",
      detail: "scoped to staging only",
    },
  ],
  permissions: [
    { label: "read", scope: "packages/runtime/db/**" },
    { label: "write", scope: "packages/runtime/db/migrations/**" },
    { label: "bash", scope: "drizzle-kit · psql --host=staging" },
  ],
};

const COPY_AGENT: Dossier = {
  codename: "Quill",
  classification: "Copy · Voice",
  hue: 295,
  oneline:
    "House voice. Cuts AI tells, ships short, lands the brand without saying its name.",
  disposition:
    "No em-dash overuse. No 'in conclusion'. Concrete nouns over abstract. The product is the operator's, not the assistant's — speak in second person, never first-person plural.",
  skills: [
    { kind: "skill", label: "humanizer", detail: "strip AI signatures" },
    { kind: "skill", label: "ux-audit", detail: "copy lint pass" },
  ],
  tools: [
    { kind: "tool", label: "read" },
    { kind: "tool", label: "edit" },
  ],
  context: [
    { kind: "file", label: "landing/app/**/*.tsx" },
    { kind: "file", label: "docs/agent/README.agent.md" },
    {
      kind: "snippet",
      label: "voice.house.md",
      detail: "tone · vocabulary · forbidden phrases",
    },
    { kind: "snippet", label: "examples.before-after.md" },
    { kind: "url", label: "linear.app/method" },
  ],
  permissions: [
    { label: "read", scope: "landing/**, docs/**" },
    { label: "write", scope: "landing/app/**/*.tsx (copy only)" },
    { label: "bash", scope: "(none)" },
  ],
};

const ROSTER: Dossier[] = [
  DESIGN_AGENT,
  SECURITY_AGENT,
  MIGRATION_AGENT,
  COPY_AGENT,
];

// ── Page ────────────────────────────────────────────────────────────

export default function RoleBuilderPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-10 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · role builder
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Role builder
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          A role is what an agent <em className="text-studio-ink">is</em>, not what it{" "}
          <em className="text-studio-ink">does</em>. This study explores
          how that identity could read as a finished artifact (
          <em className="text-studio-ink">the dossier</em>) and how an
          operator might assemble one (
          <em className="text-studio-ink">the bench</em>). Verbs are
          deliberate: skills are <em className="text-studio-ink">held</em>,
          context is <em className="text-studio-ink">mounted</em>, a role
          is <em className="text-studio-ink">instantiated</em>.
        </p>
      </header>

      <SectionTitle hint="Four roles, four dispositions, one form">
        The roster
      </SectionTitle>
      <p className="mt-3 mb-6 max-w-prose font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
        Each card is a constructed agent rendered as a personnel
        dossier. Masthead carries identity; sections below stack like
        clipped-in pages. The form is the same across all four — what
        differs is what&apos;s mounted to it.
      </p>
      <RosterGrid />

      <SectionTitle hint="Lettered callouts on the strongest specimen" className="mt-16">
        Anatomy of a dossier
      </SectionTitle>
      <p className="mt-3 mb-6 max-w-prose font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
        Atlas, taken apart. Every part is load-bearing: the masthead
        names you, the disposition speaks for you, the mounted context
        is what you can reach for without asking.
      </p>
      <Anatomy />

      <SectionTitle hint="Three stations: empty slate → mounted → ready" className="mt-16">
        The construction bench
      </SectionTitle>
      <p className="mt-3 mb-6 max-w-prose font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
        On the bench, the half-built dossier sits to the left and the
        drawers of components line up to the right. Operators don&apos;t
        select or check — they pull a part out of a drawer and{" "}
        <em className="text-studio-ink">mount</em> it. The dossier
        accretes. When the masthead settles and the four sections each
        have at least one mount, the role is instantiable.
      </p>
      <Bench />

      <SectionTitle hint="Each kind reads at a glance" className="mt-16">
        Mounted context, by kind
      </SectionTitle>
      <p className="mt-3 mb-6 max-w-prose font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
        The dossier is only as useful as what&apos;s mounted to it. Six
        kinds, each with a distinct silhouette so a glance across a
        column tells you what an agent reaches for.
      </p>
      <AttachmentKinds />

      <section className="mt-16 max-w-prose">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · how to read this study
        </div>
        <p className="font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Nothing here is interactive — no drag, no drop, no real
          mount. Every state is a frozen frame, drawn at full opacity
          so the design can be inspected as a system. If the dossier
          form holds across all four roles, and the bench reads as
          assembly rather than configuration, the idiom is worth
          building for real.
        </p>
      </section>
    </main>
  );
}

// ── Roster ──────────────────────────────────────────────────────────

function RosterGrid() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-4">
      {ROSTER.map((d) => (
        <Dossier key={d.codename} dossier={d} />
      ))}
    </div>
  );
}

// ── Dossier (the constructed-agent artifact) ────────────────────────

function Dossier({ dossier }: { dossier: Dossier }) {
  const accent = `oklch(0.78 0.14 ${dossier.hue})`;
  const accentInk = `oklch(0.94 0.06 ${dossier.hue})`;
  return (
    <article className="relative flex flex-col rounded-md border border-studio-edge bg-studio-surface">
      <Masthead dossier={dossier} accent={accent} accentInk={accentInk} />

      <DossierSection label="Disposition" sub="how it speaks">
        <p
          className="font-display text-[14px] italic leading-snug text-studio-ink"
          style={{ textWrap: "pretty" as CSSProperties["textWrap"] }}
        >
          &ldquo;{dossier.disposition}&rdquo;
        </p>
      </DossierSection>

      <DossierSection label="Skills" sub={`${dossier.skills.length} held`}>
        <AttachmentStack items={dossier.skills} accent={accent} />
      </DossierSection>

      <DossierSection label="Tools" sub={`${dossier.tools.length} granted`}>
        <div className="flex flex-wrap gap-1">
          {dossier.tools.map((t) => (
            <AttachmentChip key={t.label} item={t} accent={accent} />
          ))}
        </div>
      </DossierSection>

      <DossierSection
        label="Context · mounted"
        sub={`${dossier.context.length} parts`}
      >
        <AttachmentStack items={dossier.context} accent={accent} />
      </DossierSection>

      <DossierSection label="Permissions" sub="scope summary" last>
        <ul className="m-0 list-none space-y-1 p-0">
          {dossier.permissions.map((p) => (
            <li
              key={p.label}
              className="flex items-baseline gap-2 font-mono text-[10px]"
            >
              <span
                className="uppercase tracking-eyebrow"
                style={{ color: accent }}
              >
                {p.label}
              </span>
              <span className="text-studio-ink-faint">·</span>
              <span className="text-studio-ink-muted">{p.scope}</span>
            </li>
          ))}
        </ul>
      </DossierSection>
    </article>
  );
}

function Masthead({
  dossier,
  accent,
  accentInk,
}: {
  dossier: Dossier;
  accent: string;
  accentInk: string;
}) {
  return (
    <header
      className="relative overflow-hidden rounded-t-md border-b border-studio-edge px-4 pb-3 pt-3"
      style={{
        background: `linear-gradient(180deg, color-mix(in oklab, ${accent} 14%, var(--studio-surface)) 0%, var(--studio-surface) 100%)`,
      }}
    >
      {/* identity band — a single load-bearing color stripe */}
      <div
        aria-hidden
        className="absolute left-0 top-0 h-full w-[3px]"
        style={{ background: accent }}
      />
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <CodenameMark hue={dossier.hue} />
          <div className="flex flex-col gap-0.5">
            <div
              className="font-display text-[20px] leading-none tracking-tight"
              style={{ color: accentInk }}
            >
              {dossier.codename}
            </div>
            <div className="font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-muted">
              {dossier.classification}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <div className="font-mono text-[8px] uppercase tracking-eyebrow text-studio-ink-faint">
            Role file
          </div>
          <div className="font-mono text-[9px] tabular-nums text-studio-ink-muted">
            R-{dossier.codename.slice(0, 2).toUpperCase()}-
            {String(dossier.hue).padStart(3, "0")}
          </div>
        </div>
      </div>
      <p className="mt-3 font-sans text-[12px] leading-snug text-studio-ink">
        {dossier.oneline}
      </p>
    </header>
  );
}

/** A small hand-drawn mark used as the codename's left glyph — six
 *  cells in a 2×3 grid, lit by hue. Distinct per role because the
 *  literal hue differs; the shape is constant so it reads as the
 *  same family.  */
function CodenameMark({ hue }: { hue: number }) {
  const on = `oklch(0.78 0.14 ${hue})`;
  const off = "var(--studio-edge-strong)";
  // a fixed pattern; hue is the only difference
  const cells = [1, 0, 1, 1, 1, 0];
  return (
    <svg width={18} height={26} aria-hidden className="shrink-0">
      {cells.map((c, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        return (
          <rect
            key={i}
            x={col * 9}
            y={row * 9 + 1}
            width={7}
            height={7}
            rx={1.2}
            fill={c ? on : off}
          />
        );
      })}
    </svg>
  );
}

function DossierSection({
  label,
  sub,
  children,
  last = false,
}: {
  label: string;
  sub?: string;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <section
      className={`px-4 py-3 ${last ? "" : "border-b border-studio-edge"}`}
    >
      <div className="mb-2 flex items-baseline justify-between">
        <div className="font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink">
          {label}
        </div>
        {sub ? (
          <div className="font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
            {sub}
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

// ── Attachments — the load-bearing primitive ────────────────────────

function AttachmentStack({
  items,
  accent,
}: {
  items: Attachment[];
  accent: string;
}) {
  return (
    <ul className="m-0 list-none space-y-1 p-0">
      {items.map((it, i) => (
        <li key={i}>
          <AttachmentChip item={it} accent={accent} expanded />
        </li>
      ))}
    </ul>
  );
}

/** AttachmentChip — every mounted thing renders through this. The
 *  silhouette differs per `kind`: file gets a folder-tab notch, tokens
 *  get a swatch grid, url gets a link bracket, snippet gets a left
 *  quote rail, tool gets bracketed mono, skill gets a plaque, perm
 *  gets a key glyph. Differentiation through SHAPE, not color — only
 *  one warm element rule means we save accent for the masthead. */
function AttachmentChip({
  item,
  accent,
  expanded = false,
}: {
  item: Attachment;
  accent: string;
  expanded?: boolean;
}) {
  if (item.kind === "tokens") {
    return (
      <div className="flex items-center gap-2 rounded-[3px] border border-studio-edge bg-studio-canvas-alt py-1 pl-1 pr-2">
        <SwatchGrid hues={item.swatchHues ?? [80]} />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-mono text-[10.5px] text-studio-ink">
            {item.label}
          </span>
          {expanded && item.detail ? (
            <span className="truncate font-mono text-[9px] text-studio-ink-faint">
              {item.detail}
            </span>
          ) : null}
        </div>
        <KindBadge kind="tokens" />
      </div>
    );
  }
  if (item.kind === "file") {
    return (
      <div className="relative flex items-center gap-2 rounded-[3px] border border-studio-edge bg-studio-canvas-alt py-1 pl-3 pr-2">
        {/* folder-tab notch */}
        <span
          aria-hidden
          className="absolute -left-px top-1/2 h-3 w-1.5 -translate-y-1/2 rounded-r-[2px]"
          style={{ background: accent, opacity: 0.55 }}
        />
        <FileGlyph />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-mono text-[10.5px] text-studio-ink">
            {item.label}
          </span>
          {expanded && item.detail ? (
            <span className="truncate font-mono text-[9px] text-studio-ink-faint">
              {item.detail}
            </span>
          ) : null}
        </div>
        <KindBadge kind="file" />
      </div>
    );
  }
  if (item.kind === "url") {
    return (
      <div className="flex items-center gap-2 rounded-[3px] border border-studio-edge bg-studio-canvas-alt py-1 pl-2 pr-2">
        <LinkGlyph />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-mono text-[10.5px] text-studio-ink">
            {item.label}
          </span>
          {expanded && item.detail ? (
            <span className="truncate font-mono text-[9px] text-studio-ink-faint">
              {item.detail}
            </span>
          ) : null}
        </div>
        <KindBadge kind="url" />
      </div>
    );
  }
  if (item.kind === "snippet") {
    return (
      <div className="flex items-stretch gap-2 rounded-[3px] border border-studio-edge bg-studio-canvas-alt pr-2">
        {/* left quote rail */}
        <span
          aria-hidden
          className="w-[3px] rounded-l-[2px]"
          style={{ background: accent, opacity: 0.4 }}
        />
        <div className="flex flex-1 items-center gap-2 py-1 pl-1">
          <SnippetGlyph />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-mono text-[10.5px] italic text-studio-ink">
              {item.label}
            </span>
            {expanded && item.detail ? (
              <span className="truncate font-mono text-[9px] text-studio-ink-faint">
                {item.detail}
              </span>
            ) : null}
          </div>
          <KindBadge kind="snippet" />
        </div>
      </div>
    );
  }
  if (item.kind === "tool") {
    return (
      <span className="inline-flex items-baseline gap-0.5 rounded-[3px] border border-studio-edge bg-studio-canvas-alt px-1.5 py-0.5 font-mono text-[10px] text-studio-ink">
        <span className="text-studio-ink-faint">[</span>
        {item.label}
        <span className="text-studio-ink-faint">]</span>
      </span>
    );
  }
  if (item.kind === "permission") {
    return (
      <div className="flex items-center gap-2 rounded-[3px] border border-studio-edge bg-studio-canvas-alt py-1 pl-2 pr-2">
        <KeyGlyph />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-mono text-[10.5px] text-studio-ink">
            {item.label}
          </span>
          {expanded && item.detail ? (
            <span className="truncate font-mono text-[9px] text-studio-ink-faint">
              {item.detail}
            </span>
          ) : null}
        </div>
        <KindBadge kind="permission" />
      </div>
    );
  }
  // skill → plaque
  return (
    <div className="flex items-center gap-2 rounded-[3px] border border-studio-edge-strong bg-studio-canvas-alt py-1 pl-2 pr-2">
      <SkillGlyph />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-mono text-[10.5px] text-studio-ink">
          /{item.label}
        </span>
        {expanded && item.detail ? (
          <span className="truncate font-mono text-[9px] text-studio-ink-faint">
            {item.detail}
          </span>
        ) : null}
      </div>
      <KindBadge kind="skill" />
    </div>
  );
}

function KindBadge({ kind }: { kind: AttachmentKind }) {
  const KIND_TEXT: Record<AttachmentKind, string> = {
    file: "FILE",
    tokens: "TKNS",
    url: "URL",
    snippet: "SNPT",
    tool: "TOOL",
    skill: "SKL",
    permission: "PERM",
  };
  return (
    <span className="shrink-0 font-mono text-[8px] uppercase tracking-eyebrow text-studio-ink-faint">
      {KIND_TEXT[kind]}
    </span>
  );
}

// ── Glyphs — all hand-drawn, geometric, match Ticker's vocabulary ───

function SwatchGrid({ hues }: { hues: number[] }) {
  // 2×3 grid of 4px swatches; cycles through provided hues
  const cells = Array.from({ length: 6 }, (_, i) => hues[i % hues.length]);
  return (
    <svg width={14} height={14} aria-hidden className="shrink-0">
      {cells.map((h, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        return (
          <rect
            key={i}
            x={col * 5}
            y={row * 5 + 2}
            width={4}
            height={4}
            rx={0.5}
            fill={`oklch(0.74 0.14 ${h})`}
          />
        );
      })}
    </svg>
  );
}

function FileGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width={10} height={12} aria-hidden className="shrink-0" {...props}>
      <path
        d="M1 1 L6 1 L9 4 L9 11 L1 11 Z"
        fill="none"
        stroke="var(--studio-ink-muted)"
        strokeWidth={1}
      />
      <path d="M6 1 L6 4 L9 4" fill="none" stroke="var(--studio-ink-muted)" strokeWidth={1} />
    </svg>
  );
}

function LinkGlyph() {
  return (
    <svg width={14} height={10} aria-hidden className="shrink-0">
      <rect x={1} y={3} width={5} height={4} rx={2} fill="none" stroke="var(--studio-ink-muted)" strokeWidth={1} />
      <rect x={8} y={3} width={5} height={4} rx={2} fill="none" stroke="var(--studio-ink-muted)" strokeWidth={1} />
      <line x1={5} y1={5} x2={9} y2={5} stroke="var(--studio-ink-muted)" strokeWidth={1} />
    </svg>
  );
}

function SnippetGlyph() {
  return (
    <svg width={10} height={12} aria-hidden className="shrink-0">
      <path d="M2 2 L2 8 M2 5 L5 5" stroke="var(--studio-ink-muted)" strokeWidth={1} fill="none" />
      <path d="M7 4 L7 10 M7 7 L9 7" stroke="var(--studio-ink-muted)" strokeWidth={1} fill="none" />
    </svg>
  );
}

function KeyGlyph() {
  return (
    <svg width={14} height={10} aria-hidden className="shrink-0">
      <circle cx={4} cy={5} r={2.5} fill="none" stroke="var(--studio-ink-muted)" strokeWidth={1} />
      <line x1={6.5} y1={5} x2={13} y2={5} stroke="var(--studio-ink-muted)" strokeWidth={1} />
      <line x1={11} y1={5} x2={11} y2={7.5} stroke="var(--studio-ink-muted)" strokeWidth={1} />
    </svg>
  );
}

function SkillGlyph() {
  // a small "plaque" — diamond + horizontal underline
  return (
    <svg width={12} height={12} aria-hidden className="shrink-0">
      <rect x={2} y={2} width={8} height={8} rx={1} fill="none" stroke="var(--studio-ink-muted)" strokeWidth={1} />
      <rect x={4} y={4} width={4} height={4} fill="var(--studio-ink-muted)" />
    </svg>
  );
}

// ── Anatomy ─────────────────────────────────────────────────────────

function Anatomy() {
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(280px,1fr)_minmax(280px,360px)]">
      <div className="relative">
        {/* Labeled-anatomy markers floating to the left of the dossier */}
        <AnatomyDossier />
      </div>
      <dl className="m-0 space-y-3 font-mono text-[10.5px]">
        <AnatomyItem letter="A" label="Masthead · identity">
          Codename + classification + the one-line disposition. The
          left-edge stripe carries the agent&apos;s hue; everything else
          is studio neutrals so different roles share the same masthead
          shape.
        </AnatomyItem>
        <AnatomyItem letter="B" label="Disposition · italic display">
          A 1-3 line voice fragment in serif italic. Not a system
          prompt — the part of a prompt that&apos;s about{" "}
          <em>how</em> to speak, separated from <em>what</em> the
          agent can do.
        </AnatomyItem>
        <AnatomyItem letter="C" label="Skills · held">
          Named skill modules the agent runs as first-class verbs.
          Rendered as plaques because they&apos;re distinct executables,
          not file references.
        </AnatomyItem>
        <AnatomyItem letter="D" label="Tools · granted">
          Bracketed mono chips. Each is a runtime permission to invoke
          a tool ({`[bash]`}, {`[edit]`}). Read as a compact grant
          list, not a sentence.
        </AnatomyItem>
        <AnatomyItem letter="E" label="Context · mounted">
          The brief&apos;s load-bearing section. File references, token
          sets, URLs, prompt snippets — each rendered with a distinct
          silhouette (folder-tab, swatch grid, link bracket, quote
          rail).
        </AnatomyItem>
        <AnatomyItem letter="F" label="Permissions · scope">
          A summary, not the full ACL. Three rows — read, write, bash
          — each with a scoped glob. Detail lives off-dossier; this is
          the at-a-glance.
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
        <dt className="uppercase tracking-eyebrow text-studio-ink">{label}</dt>
        <dd className="font-sans text-[12px] leading-relaxed text-studio-ink-faint">
          {children}
        </dd>
      </div>
    </div>
  );
}

function AnatomyDossier() {
  const d = DESIGN_AGENT;
  const accent = `oklch(0.78 0.14 ${d.hue})`;
  const accentInk = `oklch(0.94 0.06 ${d.hue})`;
  return (
    <div className="relative">
      {/* the dossier itself */}
      <article className="relative flex flex-col rounded-md border border-studio-edge bg-studio-surface">
        <div className="relative">
          <Masthead dossier={d} accent={accent} accentInk={accentInk} />
          <Marker letter="A" top={26} side="left" />
        </div>
        <div className="relative">
          <DossierSection label="Disposition" sub="how it speaks">
            <p
              className="font-display text-[14px] italic leading-snug text-studio-ink"
              style={{ textWrap: "pretty" as CSSProperties["textWrap"] }}
            >
              &ldquo;{d.disposition}&rdquo;
            </p>
          </DossierSection>
          <Marker letter="B" top={36} side="left" />
        </div>
        <div className="relative">
          <DossierSection label="Skills" sub={`${d.skills.length} held`}>
            <AttachmentStack items={d.skills} accent={accent} />
          </DossierSection>
          <Marker letter="C" top={36} side="left" />
        </div>
        <div className="relative">
          <DossierSection label="Tools" sub={`${d.tools.length} granted`}>
            <div className="flex flex-wrap gap-1">
              {d.tools.map((t) => (
                <AttachmentChip key={t.label} item={t} accent={accent} />
              ))}
            </div>
          </DossierSection>
          <Marker letter="D" top={32} side="left" />
        </div>
        <div className="relative">
          <DossierSection
            label="Context · mounted"
            sub={`${d.context.length} parts`}
          >
            <AttachmentStack items={d.context} accent={accent} />
          </DossierSection>
          <Marker letter="E" top={36} side="left" />
        </div>
        <div className="relative">
          <DossierSection label="Permissions" sub="scope summary" last>
            <ul className="m-0 list-none space-y-1 p-0">
              {d.permissions.map((p) => (
                <li
                  key={p.label}
                  className="flex items-baseline gap-2 font-mono text-[10px]"
                >
                  <span
                    className="uppercase tracking-eyebrow"
                    style={{ color: accent }}
                  >
                    {p.label}
                  </span>
                  <span className="text-studio-ink-faint">·</span>
                  <span className="text-studio-ink-muted">{p.scope}</span>
                </li>
              ))}
            </ul>
          </DossierSection>
          <Marker letter="F" top={32} side="left" />
        </div>
      </article>
    </div>
  );
}

function Marker({
  letter,
  top,
  side,
}: {
  letter: string;
  top: number;
  side: "left" | "right";
}) {
  const sideStyle: CSSProperties =
    side === "left" ? { left: -28 } : { right: -28 };
  return (
    <div
      className="absolute"
      style={{ top: `${top}px`, ...sideStyle }}
      aria-hidden
    >
      <span
        className="grid h-5 w-5 place-items-center rounded-full border font-mono text-[9px] font-semibold"
        style={{
          borderColor: "var(--scout-accent)",
          color: "var(--scout-accent)",
          background: "var(--studio-canvas)",
        }}
      >
        {letter}
      </span>
    </div>
  );
}

// ── The bench — three assembly stations ─────────────────────────────

function Bench() {
  return (
    <div className="space-y-8">
      <BenchStation
        n={1}
        label="Empty slate"
        sub="A new role file. Masthead seeded with a placeholder codename, all sections vacant. Drawers laid out to the right."
      >
        <BenchSurface
          slate={
            <Slate
              codename="—"
              classification="Unassigned · draft"
              hue={80}
              oneline="A blank role. Pick a codename and start mounting."
              filled={{ disposition: false, skills: 0, tools: 0, context: 0, permissions: 0 }}
            />
          }
          drawers={<DrawerWall highlighted="skills" />}
        />
      </BenchStation>

      <BenchStation
        n={2}
        label="Partial assembly"
        sub="Codename committed (Atlas). Disposition drafted in the rail. Three skills pulled out of the /design drawer; one token set mounted to context. The dossier accretes."
      >
        <BenchSurface
          slate={
            <Slate
              codename="Atlas"
              classification="Design · Cross-surface"
              hue={210}
              oneline="House designer. Holds the design system in working memory."
              dispositionDraft="Speak in tokens, not hex. Apple HIG is the spine; the studio palette is the skin."
              partialSkills={DESIGN_AGENT.skills.slice(0, 3)}
              partialTools={[{ kind: "tool", label: "read" }, { kind: "tool", label: "edit" }]}
              partialContext={[DESIGN_AGENT.context[0]]}
              filled={{ disposition: true, skills: 3, tools: 2, context: 1, permissions: 0 }}
            />
          }
          drawers={<DrawerWall highlighted="context" />}
        />
      </BenchStation>

      <BenchStation
        n={3}
        label="Ready to instantiate"
        sub="All sections mounted. The form clears the bar (≥1 in each section, disposition committed). The instantiate plate lights up — this is the only place the warm accent gets to land."
      >
        <BenchSurface
          slate={
            <Slate
              codename="Atlas"
              classification="Design · Cross-surface"
              hue={210}
              oneline={DESIGN_AGENT.oneline}
              dispositionDraft={DESIGN_AGENT.disposition}
              partialSkills={DESIGN_AGENT.skills}
              partialTools={DESIGN_AGENT.tools}
              partialContext={DESIGN_AGENT.context}
              partialPermissions={DESIGN_AGENT.permissions}
              filled={{
                disposition: true,
                skills: DESIGN_AGENT.skills.length,
                tools: DESIGN_AGENT.tools.length,
                context: DESIGN_AGENT.context.length,
                permissions: DESIGN_AGENT.permissions.length,
              }}
              instantiable
            />
          }
          drawers={<DrawerWall highlighted={null} dimmed />}
        />
      </BenchStation>
    </div>
  );
}

function BenchStation({
  n,
  label,
  sub,
  children,
}: {
  n: number;
  label: string;
  sub?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-baseline gap-3">
        <div
          className="grid h-5 w-5 place-items-center rounded-full font-mono text-[9px] font-semibold"
          style={{
            background: "var(--studio-canvas-alt)",
            color: "var(--studio-ink)",
            border: "1px solid var(--studio-edge-strong)",
          }}
        >
          {n}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink">
          {label}
        </div>
        {sub ? (
          <div className="font-sans text-[12px] leading-snug text-studio-ink-faint">
            {sub}
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** BenchSurface — the wooden bench. Tinted canvas, a faint grid for
 *  the "ruled work surface" feel, slate on the left, drawers on the
 *  right. */
function BenchSurface({
  slate,
  drawers,
}: {
  slate: ReactNode;
  drawers: ReactNode;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-md border border-studio-edge"
      style={{
        background:
          "repeating-linear-gradient(0deg, var(--studio-canvas) 0px, var(--studio-canvas) 23px, var(--studio-canvas-alt) 23px, var(--studio-canvas-alt) 24px)",
      }}
    >
      <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-[minmax(320px,1fr)_minmax(280px,360px)]">
        <div>{slate}</div>
        <div>{drawers}</div>
      </div>
    </div>
  );
}

/** Slate — the in-progress dossier on the bench. Same form as the
 *  finished Dossier but with placeholder slots where nothing is
 *  mounted yet (rendered as outlined wells). */
function Slate({
  codename,
  classification,
  hue,
  oneline,
  dispositionDraft,
  partialSkills = [],
  partialTools = [],
  partialContext = [],
  partialPermissions = [],
  filled,
  instantiable = false,
}: {
  codename: string;
  classification: string;
  hue: number;
  oneline: string;
  dispositionDraft?: string;
  partialSkills?: Attachment[];
  partialTools?: Attachment[];
  partialContext?: Attachment[];
  partialPermissions?: Array<{ label: string; scope: string }>;
  filled: {
    disposition: boolean;
    skills: number;
    tools: number;
    context: number;
    permissions: number;
  };
  instantiable?: boolean;
}) {
  const accent = `oklch(0.78 0.14 ${hue})`;
  const accentInk = `oklch(0.94 0.06 ${hue})`;
  return (
    <article
      className="relative flex flex-col rounded-md border border-studio-edge bg-studio-surface"
      style={GLASS_PANEL}
    >
      {/* slate header — same masthead but slightly subdued until codename is committed */}
      <Masthead
        dossier={{
          codename,
          classification,
          hue,
          oneline,
          disposition: "",
          skills: [],
          tools: [],
          context: [],
          permissions: [],
        }}
        accent={accent}
        accentInk={accentInk}
      />

      <SlateSection
        label="Disposition"
        sub={filled.disposition ? "drafted" : "vacant"}
      >
        {dispositionDraft ? (
          <p
            className="font-display text-[14px] italic leading-snug text-studio-ink"
            style={{ textWrap: "pretty" as CSSProperties["textWrap"] }}
          >
            &ldquo;{dispositionDraft}&rdquo;
          </p>
        ) : (
          <VacantWell hint="Pull a voice snippet, or draft inline." />
        )}
      </SlateSection>

      <SlateSection label="Skills" sub={`${filled.skills} held`}>
        {filled.skills > 0 ? (
          <AttachmentStack items={partialSkills} accent={accent} />
        ) : (
          <VacantWell hint="Mount /design-audit, /humanizer, /debug…" />
        )}
      </SlateSection>

      <SlateSection label="Tools" sub={`${filled.tools} granted`}>
        {filled.tools > 0 ? (
          <div className="flex flex-wrap gap-1">
            {partialTools.map((t) => (
              <AttachmentChip key={t.label} item={t} accent={accent} />
            ))}
          </div>
        ) : (
          <VacantWell hint="Grant [read], [edit], [bash]…" small />
        )}
      </SlateSection>

      <SlateSection label="Context · mounted" sub={`${filled.context} parts`}>
        {filled.context > 0 ? (
          <AttachmentStack items={partialContext} accent={accent} />
        ) : (
          <VacantWell hint="Mount files, token sets, doc URLs, prompt snippets." />
        )}
      </SlateSection>

      <SlateSection
        label="Permissions"
        sub={filled.permissions > 0 ? "scoped" : "default"}
        last
      >
        {partialPermissions.length > 0 ? (
          <ul className="m-0 list-none space-y-1 p-0">
            {partialPermissions.map((p) => (
              <li
                key={p.label}
                className="flex items-baseline gap-2 font-mono text-[10px]"
              >
                <span
                  className="uppercase tracking-eyebrow"
                  style={{ color: accent }}
                >
                  {p.label}
                </span>
                <span className="text-studio-ink-faint">·</span>
                <span className="text-studio-ink-muted">{p.scope}</span>
              </li>
            ))}
          </ul>
        ) : (
          <VacantWell hint="Defaults inherited from project. Override per scope." small />
        )}
      </SlateSection>

      {/* instantiate plate — only lights up when ready */}
      <div
        className="flex items-center justify-between border-t border-studio-edge px-4 py-2.5"
        style={
          instantiable
            ? {
                background:
                  "color-mix(in oklab, var(--scout-accent) 12%, var(--studio-surface))",
              }
            : undefined
        }
      >
        <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
          {instantiable ? "ready" : "incomplete"}
        </div>
        <div
          className="font-mono text-[10px] uppercase tracking-eyebrow"
          style={{
            color: instantiable
              ? "var(--scout-accent)"
              : "var(--studio-ink-faint)",
          }}
        >
          {instantiable ? "instantiate →" : "mount more to instantiate"}
        </div>
      </div>
    </article>
  );
}

function SlateSection({
  label,
  sub,
  children,
  last = false,
}: {
  label: string;
  sub?: string;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <section
      className={`px-4 py-3 ${last ? "" : "border-b border-studio-edge"}`}
    >
      <div className="mb-2 flex items-baseline justify-between">
        <div className="font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-studio-ink">
          {label}
        </div>
        {sub ? (
          <div className="font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
            {sub}
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function VacantWell({ hint, small = false }: { hint: string; small?: boolean }) {
  return (
    <div
      className={`flex items-center justify-center rounded-[3px] border border-dashed border-studio-edge-strong bg-studio-canvas px-3 ${
        small ? "py-1.5" : "py-3"
      }`}
    >
      <span className="font-mono text-[10px] italic text-studio-ink-faint">
        {hint}
      </span>
    </div>
  );
}

// ── DrawerWall — the labeled component drawers on the right ─────────

interface Drawer {
  id: string;
  label: string;
  sub: string;
  contents: Attachment[];
}

const DRAWERS: Drawer[] = [
  {
    id: "skills",
    label: "Skills",
    sub: "named modules",
    contents: [
      { kind: "skill", label: "design-audit" },
      { kind: "skill", label: "design-fix" },
      { kind: "skill", label: "validate-themes" },
      { kind: "skill", label: "humanizer" },
      { kind: "skill", label: "debug" },
      { kind: "skill", label: "security-review" },
    ],
  },
  {
    id: "tools",
    label: "Tools",
    sub: "runtime grants",
    contents: [
      { kind: "tool", label: "read" },
      { kind: "tool", label: "edit" },
      { kind: "tool", label: "bash" },
      { kind: "tool", label: "grep" },
      { kind: "tool", label: "git" },
      { kind: "tool", label: "psql" },
    ],
  },
  {
    id: "context",
    label: "Context",
    sub: "files · tokens · urls · snippets",
    contents: [
      {
        kind: "tokens",
        label: "studio-palette",
        detail: "62 oklch tokens",
        swatchHues: [80, 125, 25, 155, 220],
      },
      { kind: "file", label: "design/studio/app/globals.css" },
      { kind: "url", label: "developer.apple.com/design/hig" },
      { kind: "snippet", label: "voice.house.md" },
    ],
  },
  {
    id: "permissions",
    label: "Permissions",
    sub: "scope envelopes",
    contents: [
      { kind: "permission", label: "read-all" },
      { kind: "permission", label: "write-scoped" },
      { kind: "permission", label: "staging.db.write" },
    ],
  },
];

function DrawerWall({
  highlighted,
  dimmed = false,
}: {
  highlighted: string | null;
  dimmed?: boolean;
}) {
  return (
    <div
      className="rounded-md border border-studio-edge bg-studio-canvas-alt"
      style={dimmed ? { opacity: 0.65 } : undefined}
    >
      <div className="flex items-center justify-between border-b border-studio-edge px-3 py-2">
        <div className="font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink">
          Drawers
        </div>
        <div className="font-mono text-[8.5px] uppercase tracking-eyebrow text-studio-ink-faint">
          pull · mount
        </div>
      </div>
      <ul className="m-0 list-none p-0">
        {DRAWERS.map((drawer, i) => (
          <li
            key={drawer.id}
            className={`${i === DRAWERS.length - 1 ? "" : "border-b border-studio-edge"} px-3 py-2`}
          >
            <DrawerHeader
              drawer={drawer}
              open={highlighted === drawer.id}
            />
            {highlighted === drawer.id ? (
              <div className="mt-2 space-y-1">
                {drawer.contents.map((c, j) => (
                  <AttachmentChip
                    key={`${drawer.id}-${j}`}
                    item={c}
                    accent="var(--scout-accent)"
                  />
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DrawerHeader({ drawer, open }: { drawer: Drawer; open: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <DrawerGlyph open={open} />
        <div className="flex flex-col">
          <span className="font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink">
            {drawer.label}
          </span>
          <span className="font-mono text-[8.5px] text-studio-ink-faint">
            {drawer.sub}
          </span>
        </div>
      </div>
      <span className="font-mono text-[8.5px] tabular-nums text-studio-ink-faint">
        {drawer.contents.length}
      </span>
    </div>
  );
}

function DrawerGlyph({ open }: { open: boolean }) {
  return (
    <svg width={14} height={10} aria-hidden className="shrink-0">
      <rect
        x={1}
        y={1}
        width={12}
        height={6}
        rx={1}
        fill="none"
        stroke="var(--studio-ink-muted)"
        strokeWidth={1}
      />
      <line
        x1={6}
        y1={4}
        x2={8}
        y2={4}
        stroke="var(--studio-ink-muted)"
        strokeWidth={1}
      />
      {open ? (
        <line
          x1={1}
          y1={9}
          x2={13}
          y2={9}
          stroke="var(--scout-accent)"
          strokeWidth={1}
        />
      ) : null}
    </svg>
  );
}

// ── Attachment kinds gallery ────────────────────────────────────────

function AttachmentKinds() {
  const samples: Array<{ title: string; kind: AttachmentKind; items: Attachment[]; note: string }> = [
    {
      title: "File reference",
      kind: "file",
      note: "A path into the repo. Folder-tab notch on the left edge says 'this is a place, not a thing'.",
      items: [
        { kind: "file", label: "design/studio/app/globals.css" },
        { kind: "file", label: "packages/runtime/db/schema.ts", detail: "drizzle source of truth" },
        { kind: "file", label: "landing/app/page.tsx" },
      ],
    },
    {
      title: "Token set",
      kind: "tokens",
      note: "A named bundle of design tokens. The swatch grid previews the palette without quoting hex.",
      items: [
        {
          kind: "tokens",
          label: "studio-palette",
          detail: "62 oklch tokens",
          swatchHues: [80, 125, 25, 155, 220, 280],
        },
        {
          kind: "tokens",
          label: "scout-hues",
          detail: "16 agent identity hues",
          swatchHues: [125, 210, 25, 85, 175, 340],
        },
      ],
    },
    {
      title: "External URL",
      kind: "url",
      note: "A doc page, RFC, or reference site. Link bracket glyph reads as 'jumps elsewhere'.",
      items: [
        { kind: "url", label: "developer.apple.com/design/hig" },
        { kind: "url", label: "owasp.org/Top10/2025" },
        { kind: "url", label: "linear.app/method", detail: "house voice reference" },
      ],
    },
    {
      title: "Prompt snippet",
      kind: "snippet",
      note: "A voice / disposition fragment. Italic label + left quote rail mark it as 'something the agent says or is told'.",
      items: [
        { kind: "snippet", label: "voice.house.md", detail: "tone · vocabulary" },
        { kind: "snippet", label: "runbook.migrations.md" },
        { kind: "snippet", label: "threat-model.md", detail: "shared assumptions" },
      ],
    },
    {
      title: "Tool grant",
      kind: "tool",
      note: "Bracketed mono. Densest treatment — a grant is a one-word permission, no metadata needed.",
      items: [
        { kind: "tool", label: "read" },
        { kind: "tool", label: "edit" },
        { kind: "tool", label: "bash" },
        { kind: "tool", label: "grep" },
        { kind: "tool", label: "git" },
      ],
    },
    {
      title: "Skill module",
      kind: "skill",
      note: "Named executable verb. Heavier border + plaque glyph because a skill is a first-class capability, not a reference.",
      items: [
        { kind: "skill", label: "design-audit", detail: "HIG compliance pass" },
        { kind: "skill", label: "humanizer", detail: "strip AI signatures" },
        { kind: "skill", label: "security-review" },
      ],
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
      {samples.map((s) => (
        <div
          key={s.title}
          className="flex flex-col rounded-md border border-studio-edge bg-studio-surface p-4"
        >
          <div className="mb-1 flex items-baseline justify-between">
            <div className="font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink">
              {s.title}
            </div>
            <KindBadge kind={s.kind} />
          </div>
          <p className="mb-3 font-sans text-[11.5px] leading-snug text-studio-ink-faint">
            {s.note}
          </p>
          <div className={s.kind === "tool" ? "flex flex-wrap gap-1" : "space-y-1.5"}>
            {s.items.map((it, i) => (
              <AttachmentChip
                key={i}
                item={it}
                accent="var(--scout-accent)"
                expanded
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Section title (matches other studies) ───────────────────────────

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
        <div className="font-mono text-[10px] text-studio-ink-faint">{hint}</div>
      ) : null}
      <div className="ml-3 h-px flex-1 bg-studio-edge" />
    </div>
  );
}
