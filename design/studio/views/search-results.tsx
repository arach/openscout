/**
 * Search Results — design study.
 *
 * The brief (operator follow-up): the shipped Knowledge Search surface
 * reads like an index dump — chunk titles ("Events window 3"), raw
 * snippets with `[0234] command_or_tool` markers, "Index rank 0.000",
 * and a wall of raw JSONL. People bounce off it. This study is the
 * design answer, rendered in the studio instead of a standalone HTML
 * page so it lives next to the other web studies and inherits the real
 * token theme.
 *
 * The idiom this study commits to: **a result is a moment in a
 * conversation, not a chunk in an index.** Every surface leads with
 * human content; the index machinery (score, chunk, QMD, raw JSONL) is
 * always exactly one disclosure away, never the headline.
 *
 * Four moves carry the whole redesign:
 *   1. One card per *session*, not per chunk (collapse the repetition).
 *   2. A conversation-first inspector — rendered turns, tools folded.
 *   3. Rendered by default; raw JSONL is one deliberate click deep.
 *   4. Always a next move — "Open conversation" + "Fork from here".
 *
 * Everything here is static. No props change, no motion. Each cell is a
 * frozen frame so the change reads at a glance against the "before".
 *
 * Companion spec: docs/eng/reviews/knowledge-search-redesign-dewey.md
 * Maps to: packages/web/client/screens/KnowledgeSearchScreen.tsx,
 *          packages/web/client/screens/KnowledgeSearchInspector.tsx
 */

import type { CSSProperties, ReactNode } from "react";

// ── shared style fragments ──────────────────────────────────────────

const PANEL: CSSProperties = {
  background:
    "linear-gradient(180deg, color-mix(in oklab, var(--studio-surface) 70%, transparent), transparent 180px), var(--studio-surface)",
};
const SELECTED_CARD: CSSProperties = {
  borderLeft: "2px solid var(--scout-accent)",
  background: "color-mix(in oklab, var(--scout-accent) 7%, var(--studio-surface))",
};
const MARK: CSSProperties = {
  background: "color-mix(in oklab, var(--scout-accent) 26%, transparent)",
  borderRadius: 3,
  padding: "0 2px",
  color: "var(--studio-ink)",
};
const PRIMARY_BTN: CSSProperties = {
  background: "var(--scout-accent)",
  color: "oklch(0.2 0.05 145)",
  borderColor: "var(--scout-accent)",
};

// ── atoms ───────────────────────────────────────────────────────────

function Mark({ children }: { children: ReactNode }) {
  return <mark style={MARK}>{children}</mark>;
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
    <div className={`mb-5 border-b border-studio-edge/60 pb-2 ${className}`}>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-display text-[17px] font-medium tracking-tight text-studio-ink">
          {children}
        </h2>
        {hint && (
          <span className="font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink-faint">
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}

function Pips({ level, tone = "accent" }: { level: 1 | 2 | 3 | 4; tone?: "accent" | "warm" }) {
  const onColor = tone === "warm" ? "var(--status-warn-fg)" : "var(--scout-accent)";
  return (
    <span className="tracking-[2px] text-[10px]">
      {[1, 2, 3, 4].map((i) => (
        <span key={i} style={{ color: i <= level ? onColor : "var(--studio-edge-strong)" }}>
          {i <= level ? "●" : "○"}
        </span>
      ))}
    </span>
  );
}

function Chip({ children, primary = false }: { children: ReactNode; primary?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-[5px] border px-2 py-1 text-[11px]"
      style={
        primary
          ? { borderColor: "color-mix(in oklab, var(--scout-accent) 45%, transparent)", background: "color-mix(in oklab, var(--scout-accent) 16%, transparent)", color: "var(--studio-ink)" }
          : { borderColor: "var(--studio-edge)", background: "var(--studio-canvas-alt)", color: "var(--studio-ink-muted)" }
      }
    >
      {children}
    </span>
  );
}

function CalloutDot({ letter }: { letter: string }) {
  return (
    <span
      className="inline-grid h-[15px] w-[15px] flex-none place-items-center rounded-full font-mono text-[9px] font-bold"
      style={{ background: "var(--scout-accent)", color: "oklch(0.2 0.05 145)" }}
    >
      {letter}
    </span>
  );
}

// ── result cards ────────────────────────────────────────────────────

/** The "before" — what ships today: chunk title, raw event-window
 *  snippet with record markers, index-rank reason. Flat, machine-ish. */
function BeforeCard() {
  return (
    <div
      className="rounded-md border border-studio-edge p-3 text-studio-ink-muted"
      style={{ background: "var(--studio-canvas-alt)" }}
    >
      <div className="mb-1.5 flex items-center gap-2 font-mono text-[11px] text-studio-ink-faint">
        <span>📄</span>
        <strong className="font-semibold text-studio-ink">Events window 3</strong>
      </div>
      <p className="m-0 mb-2 font-mono text-[11.5px] leading-relaxed text-studio-ink-faint">
        - [0313] `command_or_tool` (tool_use) - we should embed selected QMD chunks, not raw
        source files {"{"}"provider":"…"{"}"}
      </p>
      <div className="text-[11px] text-studio-ink-faint">Matched 2 query terms in indexed QMD</div>
      <div className="mt-1.5 flex flex-wrap gap-2 font-mono text-[10.5px] text-studio-ink-faint">
        <span>openscout</span>
        <span>claude</span>
        <span>records 312..340</span>
      </div>
      <code className="mt-1.5 block font-mono text-[10px] text-studio-ink-faint">
        ~/.../3f9c…session.jsonl
      </code>
    </div>
  );
}

interface MomentRow {
  idx: string;
  kind: string;
  quote: string;
  level: 1 | 2 | 3 | 4;
}

/** The "after" — a session card. Headline is the session, the match is
 *  a clean rendered quote, the reason names term + role, machinery is a
 *  qualitative strength. Multi-moment cards collapse the repetition. */
function SessionCard({
  harness,
  glyph,
  collection,
  fresh,
  title,
  quote,
  reasonTerm,
  reasonRole,
  strength,
  level,
  moments,
  selected = false,
  expanded = false,
  showActions = false,
}: {
  harness: string;
  glyph: string;
  collection: string;
  fresh: string;
  title: string;
  quote: ReactNode;
  reasonTerm: string;
  reasonRole: string;
  strength: string;
  level: 1 | 2 | 3 | 4;
  moments?: MomentRow[];
  selected?: boolean;
  expanded?: boolean;
  showActions?: boolean;
}) {
  const tone = level >= 3 ? "accent" : "warm";
  return (
    <div
      className="rounded-md border border-studio-edge p-3 text-studio-ink"
      style={selected ? { ...PANEL, ...SELECTED_CARD } : PANEL}
    >
      <div className="mb-1.5 flex items-center gap-2 text-[11.5px] text-studio-ink-muted">
        <span>{glyph}</span>
        <strong className="font-semibold text-studio-ink">{harness}</strong>
        <span className="text-studio-ink-faint">·</span>
        <span>{collection}</span>
        <span className="ml-auto font-mono text-[11px] text-studio-ink-faint">{fresh}</span>
      </div>
      <p className="m-0 mb-1.5 text-[14.5px] font-semibold leading-snug text-studio-ink">{title}</p>
      <p className="m-0 mb-2 text-[13px] leading-relaxed text-studio-ink-muted">{quote}</p>
      <div className="flex items-center gap-2 text-[12px] text-studio-ink-muted">
        <span>
          Matched <strong className="font-semibold text-studio-ink">“{reasonTerm}”</strong> in {reasonRole}
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-studio-ink-faint">
          {strength} <Pips level={level} tone={tone} />
        </span>
      </div>

      {moments && moments.length > 0 && (
        <>
          <div className="mt-2 text-[12px] text-scout-accent">
            {expanded ? "▾" : "▸"} {moments.length} matches in this session
          </div>
          {expanded && (
            <div className="mt-2 flex flex-col gap-1.5 border-t border-dashed border-studio-edge pt-2">
              {moments.map((m) => (
                <div key={m.idx} className="flex items-center gap-2.5 text-[12px]">
                  <span className="font-mono text-studio-ink-faint">{m.idx}</span>
                  <span className="min-w-[104px] font-mono text-studio-ink">{m.kind}</span>
                  <span className="flex-1 truncate text-studio-ink-muted">{m.quote}</span>
                  <Pips level={m.level} tone={m.level >= 3 ? "accent" : "warm"} />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {showActions && (
        <div className="mt-2.5 flex gap-1.5">
          <Chip primary>▸ Open conversation</Chip>
          <Chip>⤴ Fork</Chip>
          <Chip>⧉ Copy ref</Chip>
          <Chip>⋯</Chip>
        </div>
      )}
    </div>
  );
}

// ── inspector ───────────────────────────────────────────────────────

function Turn({
  role,
  id,
  matched = false,
  children,
}: {
  role: "user" | "assistant";
  id: string;
  matched?: boolean;
  children: ReactNode;
}) {
  const edge = matched
    ? "var(--scout-accent)"
    : role === "user"
      ? "oklch(0.6 0.12 270)"
      : "color-mix(in oklab, var(--scout-accent) 45%, var(--studio-edge))";
  return (
    <div className="pl-3" style={{ borderLeft: `2px solid ${edge}` }}>
      <div className="mb-1 flex items-center gap-2 font-mono text-[11px] text-studio-ink-muted">
        <span className="font-semibold text-studio-ink">{role}</span>
        <span className="text-studio-ink-faint">{id}</span>
        {matched && (
          <span className="ml-auto inline-flex items-center gap-1 text-[10.5px] text-scout-accent">
            ● matched
          </span>
        )}
      </div>
      <div className="text-[13.5px] leading-relaxed text-studio-ink">{children}</div>
    </div>
  );
}

function ToolFold() {
  return (
    <div
      className="flex items-center gap-2 rounded-md border border-studio-edge px-2.5 py-2 font-mono text-[12px] text-studio-ink-faint"
      style={{ background: "var(--studio-canvas-alt)" }}
    >
      ▸ 3 tool steps&nbsp;&nbsp;(Read, Bash, Edit)
    </div>
  );
}

function Disclosure({
  summary,
  meta,
  open = false,
  children,
}: {
  summary: ReactNode;
  meta?: ReactNode;
  open?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className="overflow-hidden rounded-[7px] border border-studio-edge"
      style={{ background: "var(--studio-canvas-alt)" }}
    >
      <div
        className={`flex items-center gap-2 px-3 py-2.5 text-[12.5px] text-studio-ink ${open ? "border-b border-studio-edge" : ""}`}
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>{summary}</span>
        {meta && <span className="ml-auto font-mono text-[11.5px] text-studio-ink-faint">{meta}</span>}
      </div>
      {open && <div className="px-3 py-3">{children}</div>}
    </div>
  );
}

const RAW_USER = `{ "type":"message","role":"user",
  "content":[{"type":"text",
  "text":"how should we store embeddings for the chunks?"}] }`;
const RAW_ASSISTANT = `{ "type":"message","role":"assistant",
  "content":[{"type":"text","text":"We should embed selected
  QMD chunks, not raw source files, and record provider,
  model, and dimensions…"}] }`;

function Inspector() {
  return (
    <div className="overflow-hidden rounded-lg border border-studio-edge" style={PANEL}>
      {/* head */}
      <div className="border-b border-studio-edge px-4 py-3">
        <div className="mb-1.5 flex items-center gap-2 font-mono text-[11px] text-studio-ink-muted">
          <span>◆ claude</span>
          <span className="text-studio-ink-faint">·</span>
          <span>openscout</span>
          <span className="text-studio-ink-faint">·</span>
          <span>2d ago</span>
          <span className="ml-auto grid h-6 w-6 place-items-center rounded-[5px] border border-studio-edge text-studio-ink-faint">
            ✕
          </span>
        </div>
        <h3 className="mb-2.5 text-[16px] font-semibold text-studio-ink">
          Designing the QMD knowledge search index
        </h3>
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px] font-semibold"
            style={PRIMARY_BTN}
          >
            ▸ Open conversation
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-studio-edge px-3 py-1.5 text-[12.5px] text-studio-ink" style={{ background: "var(--studio-canvas-alt)" }}>
            ⤴ Fork from here
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-studio-ink-muted">
            ⧉ Copy ref
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-studio-ink-muted">
            ⤓ Raw
          </span>
        </div>
      </div>

      {/* conversation excerpt */}
      <div className="flex items-center gap-2 px-4 pb-1.5 pt-3 font-mono text-[10.5px] uppercase tracking-eyebrow text-scout-accent">
        Conversation
        <span className="ml-auto font-mono text-[10.5px] normal-case tracking-normal text-studio-ink-faint">
          records 308–340
        </span>
      </div>
      <div className="flex flex-col gap-3 px-4 pb-2 pt-1">
        <Turn role="user" id="0312">
          how should we store <Mark>embeddings</Mark> for the chunks?
        </Turn>
        <Turn role="assistant" id="0313" matched>
          We should <Mark>embed</Mark> selected QMD chunks, not raw source files, and record
          provider, model, and dimensions so the index stays rebuildable when the chunk policy
          changes.
        </Turn>
        <ToolFold />
        <Turn role="assistant" id="0339">
          …that keeps the index rebuildable without re-embedding everything when only the
          lexical layer changes.
        </Turn>
      </div>

      {/* collapsed disclosures */}
      <div className="flex flex-col gap-2 px-3 py-2">
        <Disclosure summary="Why this matched" meta="Strong · exact words" />
        <Disclosure summary={<>Raw evidence <span className="text-studio-ink-faint">(advanced)</span></>} meta="records 308–344" />
      </div>

      {/* provenance footer */}
      <div className="mx-4 mb-3.5 border-t border-studio-edge pt-2.5 text-[11.5px] text-studio-ink-faint">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <span className="rounded-[5px] border border-studio-edge px-1.5 py-0.5 font-mono text-[10.5px] text-studio-ink-muted">derived</span>
          <span className="rounded-[5px] border border-studio-edge px-1.5 py-0.5 font-mono text-[10.5px] text-studio-ink-muted">observed source</span>
          <span>indexed 2d ago · mechanical extraction</span>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px] text-studio-ink-muted">
          ~/.claude/projects/openscout/3f9c…session.jsonl
          <span className="ml-auto cursor-default text-studio-ink-faint">⧉ copy</span>
        </div>
      </div>
    </div>
  );
}

// ── page ────────────────────────────────────────────────────────────

export default function SearchResultsStudy() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-10 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · studies · web · search results
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Search results
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          The shipped Search surface reads like an index dump — chunk titles, raw event-window
          snippets, “index rank 0.000”, a wall of JSONL. This study commits to one idea: a
          result is <em className="text-studio-ink">a moment in a conversation</em>, not a chunk
          in an index. Human content leads; the machinery (score, chunk, QMD, raw JSONL) is
          always one disclosure away. Four moves carry it — one card per{" "}
          <em className="text-studio-ink">session</em>, a conversation-first inspector,{" "}
          <em className="text-studio-ink">rendered by default</em>, and always a next move.
        </p>
      </header>

      {/* 1 — before / after */}
      <SectionTitle hint="Same hit, two framings">Before → after</SectionTitle>
      <div className="mb-16 grid gap-5 lg:grid-cols-2">
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink-faint">
            today — the index shows through
          </div>
          <BeforeCard />
          <p className="mt-2.5 max-w-prose font-sans text-[12px] leading-relaxed text-studio-ink-faint">
            The chunk title is the document H1. The snippet is raw event-window text with{" "}
            <code className="text-studio-ink-muted">[0313] command_or_tool</code> markers. The
            reason speaks index-ese. Four near-identical chunk hits from one session stack as
            four of these.
          </p>
        </div>
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-eyebrow text-scout-accent">
            redesign — the conversation shows through
          </div>
          <SessionCard
            harness="claude"
            glyph="◆"
            collection="openscout · knowledge index"
            fresh="2d ago"
            title="Designing the QMD knowledge search index"
            quote={
              <>
                “…we should <Mark>embed</Mark> selected QMD chunks, not raw source files, and
                record the provider, model, and dimensions so the index stays rebuildable…”
              </>
            }
            reasonTerm="embeddings"
            reasonRole="an assistant reply"
            strength="Strong"
            level={3}
            moments={[
              { idx: "0313", kind: "assistant reply", quote: "…embed selected QMD chunks, not raw…", level: 3 },
              { idx: "0420", kind: "tool output", quote: "embeddings provider model dimensions", level: 2 },
              { idx: "0511", kind: "your message", quote: "should embeddings be opt-in?", level: 1 },
            ]}
            selected
            expanded
            showActions
          />
          <p className="mt-2.5 max-w-prose font-sans text-[12px] leading-relaxed text-studio-ink-faint">
            One card per session. Headline is the session, not the chunk. The match is a clean
            rendered quote; the reason names the term and the role; rank becomes a qualitative
            strength. The four chunk hits collapse into three labelled moments.
          </p>
        </div>
      </div>

      {/* 2 — card anatomy */}
      <SectionTitle hint="Lettered callouts on the strongest specimen">The result card</SectionTitle>
      <div className="mb-16 grid items-start gap-7 lg:grid-cols-[minmax(0,420px)_1fr]">
        <SessionCard
          harness="claude"
          glyph="◆"
          collection="openscout · knowledge index"
          fresh="2d ago"
          title="Designing the QMD knowledge search index"
          quote={
            <>
              “…we should <Mark>embed</Mark> selected QMD chunks, not raw source files, and record
              the provider, model, and dimensions…”
            </>
          }
          reasonTerm="embeddings"
          reasonRole="an assistant reply"
          strength="Strong"
          level={3}
          moments={[
            { idx: "0313", kind: "assistant reply", quote: "…embed selected QMD chunks, not raw…", level: 3 },
            { idx: "0420", kind: "tool output", quote: "embeddings provider model dimensions", level: 2 },
          ]}
          showActions
        />
        <ol className="flex list-none flex-col gap-3 text-[12.5px] leading-relaxed text-studio-ink-muted">
          {[
            ["A", "Identity row", "harness glyph · project · collection, freshness right-aligned. Muted — context, not headline."],
            ["B", "Headline = session title", "New sessionTitle field (AI title → first user prompt → project·topic). Never the chunk H1."],
            ["C", "Rendered match quote", "One clean sentence of renderedText, terms highlighted. No [NNNN] markers — rendered server-side."],
            ["D", "Reason + strength", "“Matched ‘x’ in an assistant reply” + qualitative Strong/Good/Weak pips. Never the raw bm25 float."],
            ["E", "Moments toggle", "Multiple chunk hits from one session collapse here; expand to labelled moment rows."],
            ["F", "Hover actions", "Open conversation (primary) · Fork · Copy ref · ⋯. The card always offers a next move."],
          ].map(([letter, title, body]) => (
            <li key={letter} className="flex gap-3">
              <CalloutDot letter={letter} />
              <span>
                <strong className="font-semibold text-studio-ink">{title}</strong> — {body}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* 3 — card states */}
      <SectionTitle hint="Frozen frames, side by side">Card states</SectionTitle>
      <div className="mb-16 grid gap-4 lg:grid-cols-3">
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink-faint">collapsed · multi-moment</div>
          <SessionCard
            harness="codex" glyph="◇" collection="openscout · runtime" fresh="4d ago"
            title="Vector store choice for local semantic search"
            quote={<>“brute-force cosine over <Mark>embeddings</Mark> in knowledge.sqlite is fine under ~100k chunks…”</>}
            reasonTerm="embeddings" reasonRole="2 assistant replies" strength="Good" level={2}
            moments={[
              { idx: "0088", kind: "assistant reply", quote: "brute-force cosine…", level: 2 },
              { idx: "0142", kind: "assistant reply", quote: "sqlite-vec vs in-memory…", level: 2 },
            ]}
          />
        </div>
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-eyebrow text-scout-accent">selected · expanded · hover</div>
          <SessionCard
            harness="claude" glyph="◆" collection="openscout · knowledge index" fresh="2d ago"
            title="Designing the QMD knowledge search index"
            quote={<>“…we should <Mark>embed</Mark> selected QMD chunks, not raw source files…”</>}
            reasonTerm="embeddings" reasonRole="an assistant reply" strength="Strong" level={3}
            moments={[
              { idx: "0313", kind: "assistant reply", quote: "…embed selected QMD chunks…", level: 3 },
              { idx: "0420", kind: "tool output", quote: "embeddings provider model…", level: 2 },
            ]}
            selected expanded showActions
          />
        </div>
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink-faint">single moment · no toggle</div>
          <SessionCard
            harness="claude" glyph="◆" collection="dewey · docs" fresh="6d ago"
            title="Opt-in policy for embedding cost"
            quote={<>“keep <Mark>embeddings</Mark> disabled by default until the user enables semantic search…”</>}
            reasonTerm="embeddings" reasonRole="your message" strength="Weak" level={1}
          />
        </div>
      </div>

      {/* 4 — the inspector */}
      <SectionTitle hint="Conversation first, machinery folded">The selected-result inspector</SectionTitle>
      <p className="mb-6 max-w-prose font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
        Reads top-to-bottom as a conversation with zero clicks. Header carries the session title
        and the next-action bar; the body is the rendered slice around the match with tool steps
        folded; “Why this matched” and “Raw evidence” sit collapsed beneath; a quiet provenance
        footer holds the trust signals (origin, ownership, path).
      </p>
      <div className="mb-16 max-w-[560px]">
        <Inspector />
      </div>

      {/* 5 — rendered vs raw */}
      <SectionTitle hint="One record, two renderings">Rendered vs. raw JSONL</SectionTitle>
      <div className="mb-16 grid gap-5 lg:grid-cols-2">
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-eyebrow text-scout-accent">default — rendered</div>
          <div className="flex flex-col gap-3 rounded-lg border border-studio-edge p-4" style={PANEL}>
            <Turn role="user" id="0312">how should we store <Mark>embeddings</Mark> for the chunks?</Turn>
            <Turn role="assistant" id="0313" matched>
              We should <Mark>embed</Mark> selected QMD chunks, not raw source files, and record
              provider, model, and dimensions.
            </Turn>
            <ToolFold />
          </div>
          <p className="mt-2.5 max-w-prose font-sans text-[12px] leading-relaxed text-studio-ink-faint">
            Role-labelled turns from <code className="text-studio-ink-muted">renderedText</code>;
            matched turn highlighted and auto-scrolled; tool/process records folded, never
            inline-equal.
          </p>
        </div>
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink-faint">one click deep — raw evidence (advanced)</div>
          <Disclosure
            summary={<>Raw evidence <span className="text-studio-ink-faint">(advanced)</span></>}
            meta="records 308–344"
            open
          >
            <div className="font-mono text-[11px]">
              <div className="flex items-center gap-2 border-b border-studio-edge py-1.5 text-studio-ink-faint">
                <span>0312</span><span className="min-w-[72px] text-studio-ink">user</span>
                <span className="truncate">how should we store embeddings…</span>
              </div>
              <div className="border-b border-studio-edge py-1.5">
                <div className="flex items-center gap-2 text-studio-ink">
                  <span className="text-studio-ink-faint">0313</span>
                  <span className="min-w-[72px] text-scout-accent">assistant</span>
                  <span className="truncate text-studio-ink-muted">We should embed selected QMD chunks…</span>
                </div>
                <pre className="mt-1.5 overflow-x-auto rounded-md border border-studio-edge p-2.5 text-[10.5px] leading-relaxed text-studio-ink-muted" style={{ background: "var(--studio-canvas)" }}>{RAW_ASSISTANT}</pre>
              </div>
              <div className="flex items-center gap-2 py-1.5 text-studio-ink-faint">
                <span>0314</span><span className="min-w-[72px] text-studio-ink">tool_use</span>
                <span className="truncate">Read provider.ts</span>
              </div>
            </div>
          </Disclosure>
          <p className="mt-2.5 max-w-prose font-sans text-[12px] leading-relaxed text-studio-ink-faint">
            The existing record window, kept verbatim for trust — but behind one deliberate
            disclosure, with the matched record auto-open. Never the default lower half.
          </p>
        </div>
      </div>

      {/* 6 — ranking explanation */}
      <SectionTitle hint="Plain language up top, numbers under details">Why this matched</SectionTitle>
      <div className="mb-16 grid gap-5 lg:grid-cols-2">
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-eyebrow text-studio-ink-faint">collapsed</div>
          <Disclosure summary="Why this matched" meta="Strong · exact words" />
        </div>
        <div>
          <div className="mb-2 font-mono text-[10px] uppercase tracking-eyebrow text-scout-accent">expanded</div>
          <Disclosure summary="Why this matched" meta="Strong · exact words" open>
            <div className="grid grid-cols-[120px_1fr] gap-x-3.5 gap-y-2 text-[12.5px]">
              <span className="font-mono text-[11.5px] text-studio-ink-faint">Relevance</span>
              <span className="text-studio-ink">Strong <span className="ml-1"><Pips level={3} /></span></span>
              <span className="font-mono text-[11.5px] text-studio-ink-faint">Found in</span>
              <span className="text-studio-ink">assistant reply (2×) · session title</span>
              <span className="font-mono text-[11.5px] text-studio-ink-faint">Match type</span>
              <span className="text-studio-ink">Exact words: “embeddings”, “QMD”</span>
              <span className="font-mono text-[11.5px] text-studio-ink-faint">details</span>
              <span className="font-mono text-[11.5px] text-studio-ink-faint">bm25 −8.42 · fts over title + body</span>
            </div>
          </Disclosure>
          <p className="mt-2.5 max-w-prose font-sans text-[12px] leading-relaxed text-studio-ink-faint">
            Field names humanised (“session title”, “assistant reply”), not “QMD title/body”. For
            vector/hybrid this line becomes “Similar in meaning (not exact words)”.
          </p>
        </div>
      </div>

      {/* 7 — next actions */}
      <SectionTitle hint="The fix for “what do I do now?”">Next actions</SectionTitle>
      <div className="mb-16 grid gap-6 lg:grid-cols-[minmax(0,520px)_1fr]">
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-studio-edge p-4" style={PANEL}>
          <span className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12.5px] font-semibold" style={PRIMARY_BTN}>▸ Open conversation</span>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-studio-edge px-3 py-1.5 text-[12.5px] text-studio-ink" style={{ background: "var(--studio-canvas-alt)" }}>⤴ Fork from here</span>
          <span className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-studio-ink-muted">⧉ Copy ref</span>
          <span className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-studio-ink-muted">⤓ Raw</span>
          <span className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-studio-ink-muted">⋯</span>
        </div>
        <ul className="flex list-none flex-col gap-2 text-[12.5px] leading-relaxed text-studio-ink-muted">
          <li><strong className="text-studio-ink">Open conversation</strong> (primary) — deep-link into the existing tail view at the matched record. Today’s only action (“Open file”) dumps raw JSONL; this is the move people expect.</li>
          <li><strong className="text-studio-ink">Fork from here</strong> — seed a new session from this context (sco-049 / sco-062). Stub allowed; the affordance sets direction.</li>
          <li><strong className="text-studio-ink">Copy ref</strong> · <strong className="text-studio-ink">Raw</strong> · overflow holds Open transcript file & Search-within-session.</li>
          <li>Card default click = preview; <strong className="text-studio-ink">Enter</strong> = Open conversation.</li>
        </ul>
      </div>

      {/* how to read */}
      <section className="max-w-prose">
        <div className="mb-2 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · how to read this study
        </div>
        <p className="font-sans text-[12.5px] leading-relaxed text-studio-ink-faint">
          Every frame is static — frozen so the redesign reads against the “before” without
          motion. The only required backend addition is a human{" "}
          <code className="text-studio-ink-muted">sessionTitle</code> on the hit plus a
          server-rendered card snippet; everything else reorders or renames fields that already
          exist on <code className="text-studio-ink-muted">KnowledgeHit</code> and the source
          preview. Build order and field mappings live in the companion spec,{" "}
          <code className="text-studio-ink-muted">docs/eng/reviews/knowledge-search-redesign-dewey.md</code>.
          Append <code className="text-studio-ink-muted">?focus=1</code> to the URL for a
          chrome-free screenshot frame.
        </p>
      </section>
    </main>
  );
}
