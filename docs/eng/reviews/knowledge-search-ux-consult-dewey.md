# UX Consult: OpenScout Knowledge Search results

Reviewer: **dewey** (Claude-backed UX consult, requested by operator). No source mutations.

Reviewed live: `http://127.0.0.1:3210/search` against
`packages/web/client/screens/KnowledgeSearchScreen.tsx`,
`KnowledgeSearchInspector.tsx`, `lib/knowledge-search.ts`, `knowledge-search.css`.

## Root cause (one sentence)

The data model is already rich — each hit carries `origin`, `ownership`, `freshness`,
`facets`, structured `sourceRefs`, and the preview exposes `renderedText` + per-record
`kind`/`role`/`matched` — but the **UI promotes the index's internal vocabulary to
primary content**: chunk titles like *"Events window 3"*, *"Indexed snippet"*, *"Index
rank 0.000 — lower sorts earlier"*, *"Raw JSONL evidence"*, *"matching chunks"*, *"derived
QMD chunks"*. Users see the machine that found the answer instead of the answer. Every fix
below is the same move: **lead with meaning, demote machinery to on-demand.**

The good news: almost none of this needs new backend data. It's hierarchy, framing, and one
new field (a human session title on the hit).

---

## 1. Result cards

**Now:** title = raw QMD chunk H1 (`KnowledgeSearchScreen.tsx:252`, e.g. "Events window 3"
/ "Files touched" / "Tool calls"); snippet = event-window text still carrying
`- [0234] \`command_or_tool\`` markers that `displaySnippet()` tries to strip with a brittle
regex (`:95`); reason = "Matched N query terms in indexed QMD" (`:88`); a `<code>` path block
competes with the content (`:264`).

**Target card (top → bottom):**

1. **Identity line** — the *session* title, not the chunk title: AI/derived session title →
   else first user prompt → else `project · topic`. Prefix a harness icon (Claude/Codex) and a
   freshness chip ("2d ago", from `hit.freshness`). If the chunk title is an event-window
   label, never show it as the headline.
2. **The match as a clean quote** — one rendered sentence of the best matched *turn*
   (`renderedText`), not the raw event-window line. Push the inspector's rendering into the hit
   so the card is humanized server-side and `displaySnippet`'s regex can go away. Highlight terms.
3. **Context chips** — `project · harness · "in your message" | "in assistant reply" | "in tool
   output" · freshness`. Naming *what kind of record matched* (from the matched record's
   `kind`/`role`) is the cheapest way to make a card feel like a moment, not a row.
4. **Reason** — replace "Matched N query terms in indexed QMD" with "Matched **'embeddings'**
   in an assistant reply." Name the term + the role; drop "indexed QMD."
5. **Path** — demote to muted/hover-only; it should not be a `<code>` block at card altitude.

**Dedupe by session.** Multiple chunk hits from one session currently render as N near-identical
cards — a primary driver of "feels like index records." Collapse to **one card per session**
with "3 matches · best: '…'"; expand to per-moment matches. Card = conversation, not chunk.

## 2. Inspector

**Now** (`KnowledgeSearchInspector.tsx`): Rendered hits (flat top-4, `:304`) → "Indexed
snippet" (`:324`) → "Why ranked here" with raw score + "lexical index over QMD title/body"
(`:329`) → transcript path → **Raw JSONL `<details>` list that occupies the whole lower panel**
(`:370`). It opens fine but slides into index-ese fast and raw JSONL dominates the viewport.

**Target hierarchy (top → bottom):**

1. **Header** — human session title + `harness · project · freshness` + the primary next-action
   buttons (§5). Not "Selected result / <chunk title>".
2. **Conversation excerpt (default, rendered)** — show the matched moment *in conversational
   context*: the matched turn plus ~2 surrounding turns as role-labeled bubbles, terms
   highlighted, **tool/system records folded** into "▸ 3 tool steps (Bash, Read)". This replaces
   the flat top-4 "Rendered message hits" list and is the single highest-impact change — make the
   default look like a conversation, not a record dump. You already have `renderedText`,
   `recordKindLabel()`, and `recordPriority()` to drive the fold.
3. **Why this matched (collapsed)** — one plain line: "Matched 'embeddings' in 2 assistant
   replies and 1 tool call." Expand for mechanics. See §4.
4. **Raw evidence (collapsed, advanced)** — keep the existing `<details>` record window; it's
   great for trust, but it must be opt-in, not the default lower half. Keep matched record
   auto-open (`firstOpenRecord`, `:166`).
5. **Provenance footer (persistent, small)** — `origin` (mechanical vs enrichment), `ownership`
   (derived/observed), indexed-at, transcript path + copy. These fields already exist on the hit
   and are exactly the trust signals to surface quietly.

Drop the standalone "Indexed snippet" block — it's the chunk's raw text and reads as an index
artifact; the conversation excerpt supersedes it.

## 3. Rendered vs raw JSONL

- **Default is always rendered.** Cards and inspector lead with `renderedText` / conversation
  rendering; raw JSONL is never the first thing shown.
- **Raw is explicit, on-demand.** Keep the `<details>` raw view behind a collapsed "Raw evidence
  (advanced)" disclosure. Within it, matched record stays auto-expanded.
- **Tool/process noise** is the other half of the complaint. In the rendered excerpt, fold
  tool/system records into a one-line summary ("▸ ran 3 tools") and expand on demand — don't
  render tool calls as equal-weight bubbles. `recordPriority()` already ranks `assistant`/`user`
  above `system` above tools; use it to *hide*, not just sort.
- Offer a per-record "rendered ⇄ raw" toggle for power users, but the panel-level default stays
  rendered.

## 4. Ranking explanation

**Now:** "Index rank **0.000** — lower values sort earlier in lexical search"; "Matched in:
title, indexed snippet — lexical index over QMD title/body" (`:334`–`:349`). Accurate but
speaks index-ese, and the raw BM25 float as the headline is meaningless to a user.

**Target:**
- Lead with a **plain sentence** built from matched terms + matched record roles: "Top match —
  'embeddings' appears in an assistant reply and the session title."
- Show a **qualitative strength** chip (Strong / Good / Weak) bucketed from normalized score; the
  raw float lives only under "details."
- Translate fields to human terms: QMD `title`/`body` → "session title" / "your message" /
  "assistant reply" / "tool output." Never show "QMD title/body."
- When `scoreSource` becomes `vector`/`hybrid`, say **"Similar in meaning (not exact words)"** vs
  **"Exact words matched"** — that is the one ranking distinction users actually care about.
- Keep it to a single collapsed block, not the current three-column score panel.

## 5. Next actions (the "unclear what to do after clicking" fix)

**Now:** the only real action is "Open file" (`openTranscript`, `:246`) which dumps the raw
transcript, plus the Indexer tab. There is no "take me to the conversation" path — the most
expected action is missing.

Per the SCO-062 thesis (search = retrieval **and** launch), give a clear primary + a small set,
in the inspector header and as the card's click intent:

- **Open conversation** (primary) — open the session in the existing tail/conversation view, deep
  linked to the matched record via `recordRange` / `firstOpenRecord`. This is the natural "I found
  it, take me there." Today's click only fills the inspector; "Open file" gives raw JSONL instead.
- **Continue / fork from here** — seed a new session from this context (the context-pack/fork path
  from sco-049 / sco-062). Even stubbed, the affordance answers "what now" and sets product
  direction.
- **Open raw transcript** — today's "Open file," demoted to secondary.
- **Copy reference** — path + record range, for pasting into an agent.
- **Search within this session** — scope the query to this collection.

Make the card communicate its primary destination ("Open conversation"), not just "select."

## 6. Vocabulary cleanup (cheap, cross-cutting, high impact)

The internal terms *are* the "feels like index records" feeling. Rename user-facing strings:

| Now | Use |
| --- | --- |
| "N matching chunks" / "derived QMD chunks" (`:228`) | "N matches" / "N moments" |
| "Indexed snippet" (`:324`) | drop (replaced by excerpt) |
| "Raw JSONL evidence" (`:371`) | "Raw evidence (advanced)" |
| "Index rank — lower sorts earlier" (`:336`) | "Relevance: Strong/Good/Weak" |
| placeholder "Search QMD, embeddings… raw log drilldown" (`:185`) | "Search your sessions — topics, files, decisions…" |
| sample queries "QMD / MCP / context pack" (`:25`) | real recent topics/projects |

## Priority order

1. **Conversation excerpt + fold tool noise** in the inspector (§2.2, §3) — kills most of the
   "raw record" feeling.
2. **Session-level human title + render the card snippet server-side** (§1.1–1.2) — fixes the
   first thing users read.
3. **"Open conversation" primary action + deep-link** (§5) — answers "what now."
4. **Dedupe cards by session** (§1) — removes repetitive index-row feel.
5. **Vocabulary pass + qualitative ranking** (§4, §6) — low effort, broad polish.

None of 1–5 requires new index data beyond adding a human session title to the hit; everything
else is reordering and renaming fields that already exist.
