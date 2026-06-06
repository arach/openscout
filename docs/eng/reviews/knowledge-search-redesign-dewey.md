# Design: OpenScout Knowledge Search result experience

Author: **dewey**. Status: proposal for implementation. No production source mutated.
Companion mock: [`knowledge-search-redesign-mock.html`](./knowledge-search-redesign-mock.html)
(open in a browser). Source critique this builds on:
[`knowledge-search-ux-consult-dewey.md`](./knowledge-search-ux-consult-dewey.md).

This is the "give us a design" follow-up: concrete layouts, states, copy, and field mappings
an implementer can build against `KnowledgeSearchScreen.tsx` / `KnowledgeSearchInspector.tsx`
without inventing structure.

---

## Design principles

1. **A result is a moment in a conversation, not a chunk in an index.** Every surface leads
   with human content; index machinery (score, chunk, QMD, raw JSONL) is one disclosure away.
2. **One card per session.** Collapse the N near-identical chunk hits into a single
   session card with expandable moments. Repetition is what makes it read like a log.
3. **Rendered by default, raw on demand.** `renderedText` everywhere first; raw JSONL behind a
   collapsed "advanced" disclosure; tool/process records folded, never inline equals.
4. **Always offer a next move.** The card and inspector both answer "what now" with a primary
   *Open conversation* and a *Fork from here*.

---

## Information model

A search returns chunk-level `KnowledgeHit`s today. The UI should group them into **session
results** client-side (key = `collectionId`), each holding 1..n **moments** (the individual
hits, each anchored to a `recordRange`).

```
SessionResult
  collectionId
  sessionTitle      ← NEW backend field (see §8). Fallbacks: AI title → first user prompt → "project · topic"
  harness, project, freshness        (from hit.facets / hit.freshness)
  bestMoment        ← highest-ranked hit
  moments[]         ← all hits in this collection, sorted by score
  matchCount        ← moments.length
```

Everything below renders from fields that already exist on `KnowledgeHit` /
`KnowledgeSourcePreviewRecord` except `sessionTitle` (§8).

---

## 1. Result card

### Anatomy

```
┌────────────────────────────────────────────────────────────────────┐
│ ◆ claude    openscout · knowledge index                   2d ago    │  identity row
│ Designing the QMD knowledge search index                            │  headline = sessionTitle
│ “…we should embed selected QMD chunks, not raw source files, and     │  rendered match quote
│  record the provider, model, and dimensions…”                       │  (bestMoment.renderedText)
│ Matched “embeddings” in an assistant reply              Strong ●●●○  │  reason + strength
│ ▸ 3 matches in this session                                         │  moments toggle (n>1 only)
└────────────────────────────────────────────────────────────────────┘
        hover ▸  [ Open conversation ]   ⤴ Fork    ⧉ Copy ref    ⋯
```

### Field mapping

| Slot | Source | Notes |
| --- | --- | --- |
| harness icon + label | `facetText(hit,"harness")` | `◆`=claude, `◇`=codex; muted |
| project · collection | `facetText(hit,"project")` + collection title | middle-dot separated, muted |
| freshness | `hit.freshness` | right-aligned chip ("2d ago") |
| **headline** | `sessionTitle` (§8) | never the chunk H1 ("Events window 3") |
| match quote | `bestMoment.renderedText`, cleaned | strip `[NNNN] \`kind\`` markers server-side (§8); `<mark>` terms |
| reason | matched term + matched record role | "Matched **'x'** in an assistant reply" |
| strength | bucketed score | `●●●○` Strong / Good / Weak; never raw float |
| moments toggle | `moments.length` | only when > 1; expands inline to a compact moment list |

### Expanded moments (inline, when card has >1 match)

```
 ▾ 3 matches in this session
    0313  assistant reply   “…embed selected QMD chunks, not raw…”      ●●●○
    0420  tool output       “embeddings provider model dimensions”      ●●○○
    0511  your message      “should embeddings be opt-in?”              ●○○○
```

Each moment row is itself selectable → opens the inspector deep-linked to that `recordRange`.

---

## 2. Selected-result inspector

### Anatomy

```
┌─ INSPECTOR ────────────────────────────────────────────────────────┐
│ ◆ claude · openscout · 2d ago                                 [ ✕ ] │  context + close
│ Designing the QMD knowledge search index                           │  sessionTitle
│ [ Open conversation ]   ⤴ Fork from here     ⧉ Copy ref   ⤓ Raw     │  ACTION BAR (primary left)
├─────────────────────────────────────────────────────────────────────┤
│  CONVERSATION  ·  records 308–340                                   │
│                                                                     │
│   ┌ user · 0312                                                    │
│   └ how should we store embeddings for the chunks?                 │
│                                                                     │
│   ┌ assistant · 0313                                  ● matched    │
│   └ We should **embed selected QMD chunks**, not raw source files, │  highlighted
│     and record provider, model, and dimensions so the index …      │
│                                                                     │
│   ▸ 3 tool steps  (Read, Bash, Edit)                               │  folded tool noise
│                                                                     │
│   ┌ assistant · 0339                                              │
│   └ …that keeps the index rebuildable without re-embedding.        │
│                                                                     │
│  ▸ Why this matched                          Strong · exact words   │  collapsed
│  ▸ Raw evidence (advanced)                                          │  collapsed
│                                                                     │
│  derived · observed source · indexed 2d ago                         │  provenance footer
│  ~/.claude/projects/openscout/<session>.jsonl                  ⧉    │
└─────────────────────────────────────────────────────────────────────┘
```

### Sections, top → bottom

1. **Context + close** — `harness · project · freshness`, close `✕` → `clearKnowledgeHit()`.
2. **Headline** — `sessionTitle`. Replaces "Selected result / <chunk title>".
3. **Action bar** — see §5. Primary action is a filled button, left-most.
4. **Conversation excerpt** (default body) — the rendered slice; the centerpiece. See §4.
5. **Why this matched** — collapsed; one-line summary in the header row; expands to detail (§6).
6. **Raw evidence (advanced)** — collapsed; the existing `<details>` record window (§4).
7. **Provenance footer** — `origin` (mechanical/enrichment), `ownership` (derived/observed),
   indexed-at, transcript path + copy. Small, persistent, monospace path.

The **Indexer tab** stays as-is (it's an operator surface, not a result surface) — but move it
out of the per-result inspector into a top-level "Index" affordance so the result inspector is
purely about the selected result. (Optional, lower priority.)

---

## 3. Interaction states

| State | Trigger | Card list | Inspector |
| --- | --- | --- | --- |
| **No index** | `status.chunks === 0` | empty-state w/ "Build 3-day index" | "Select a result" placeholder |
| **Indexing** | `status.activeJobs[0]` present | skeleton cards + "Indexing… 42/260" | progress note |
| **Searching** | `searching` | keep prior results dimmed + top bar "Searching…" | keep prior selection |
| **Results** | hits > 0 | session cards | auto-select bestMoment of top card |
| **Empty query result** | hits === 0 | "No matches — try a project, file, or topic" | placeholder |
| **Card hover** | pointer | reveal action row, raise elevation | — |
| **Card selected** | click | `aria-pressed`, accent left-border | inspector populated |
| **Preview loading** | `loadingPreview` | — | excerpt skeleton ("Loading conversation…") |
| **No preview** | preview null (non-transcript ref) | — | show indexed snippet + "Raw evidence unavailable" |
| **Raw expanded** | user opens disclosure | — | record `<details>` list, matched auto-open |
| **Error** | `error` | inline `role="alert"` | inline alert, keep last good content |

Keyboard: `↑/↓` move card selection, `Enter` = Open conversation, `Space` = expand moments,
`Esc` = clear selection. (Cards are already `<button>`s — add roving tabindex.)

---

## 4. Rendered conversation vs raw JSONL

This is the heart of the fix. Two distinct renderings of the same `recordRange`:

### Conversation excerpt (default)

- Input: `KnowledgeSourcePreview.records` (already fetched by the inspector).
- Render each record by `recordKindLabel()` as a **role block** (user / assistant / system),
  using `record.renderedText` (fallback `summary`, never `raw` here).
- **Fold tool/process records.** Consecutive records where `recordPriority() === 2`
  (`command_or_tool`, `response_item`, etc.) collapse into a single line:
  `▸ N tool steps (Bash, Read, Edit)` — distinct tool names from `recordKindLabel`. Expanding
  reveals each tool's one-line summary; the tool's raw args/output stay in §Raw.
- **Anchor + highlight.** Auto-scroll to the matched record (`firstOpenRecord`); `<mark>` query
  terms via `highlightParts`; show a subtle `● matched` tag on matched role blocks.
- **Context window.** Show the matched record ± a few turns (the inspector already requests
  `contextRecords: 4`); offer "show more context" to widen rather than dumping all 80.

### Raw evidence (advanced, collapsed)

- Keep the current `<details>` list verbatim (`raw` in `<pre>`, matched record
  `ks-jsonl-record--matched`, summary line) — it's good for trust.
- Gate it behind a collapsed `▸ Raw evidence (advanced)` with the range caption
  ("records 308–344 · earlier hidden · later hidden"). Never the default lower half.
- Per-record `rendered ⇄ raw` toggle is fine for power users; the panel default stays rendered.

**Rule of thumb:** the inspector should be readable as a conversation with zero clicks; raw
JSONL should take exactly one deliberate click to reach.

---

## 5. Next-action placement

Currently the only action is "Open file" (dumps raw transcript) — the expected action (go to
the conversation) is missing. Provide:

**Inspector action bar (primary, always visible under the headline):**

| Action | Behavior | Priority |
| --- | --- | --- |
| **Open conversation** | open existing tail/conversation view at matched record (`recordRange[0]` / `firstOpenRecord`) | primary, filled |
| **Fork from here** | seed a new session from this context (sco-049 / sco-062 path); stub allowed | secondary |
| **Copy ref** | copy `pathLabel(path)` + `records a..b` to clipboard | secondary, icon |
| **Raw** | jump-scroll to / expand Raw evidence disclosure | tertiary, icon |
| **Open transcript file** | today's `openTranscript()` | overflow `⋯` |
| **Search within session** | re-run query scoped to `collectionId` | overflow `⋯` |

**Card hover actions** (compact mirror): `Open conversation` · `⤴ Fork` · `⧉ Copy` · `⋯`.
**Default card click** = open inspector (cheap preview); **double-click / Enter** = Open
conversation (commit). Make the card's intent legible ("Click to preview · Enter to open").

---

## 6. Ranking explanation

Collapsed header line: `Strong · exact words`. Expanded:

```
 ▾ Why this matched
    Relevance     Strong            ●●●○        ← bucketed from normalized score
    Found in      assistant reply (2×) · session title
    Match type    Exact words: “embeddings”, “QMD”      (or: “Similar in meaning” for vector/hybrid)
    details ▸     bm25 −8.42 · fts over title + body    ← raw numbers only here
```

- Bucket `hit.score` into Strong/Good/Weak (normalize per result set; FTS bm25 is negative and
  unbounded, so rank-relative bucketing beats absolute thresholds).
- Translate field names: `title`→"session title", `body`→"assistant reply / your message / tool
  output" (from matched record role). Never show "QMD title/body" to users.
- Branch on `scoreSource`: `fts`→"Exact words", `vector`→"Similar in meaning (not exact words)",
  `hybrid`→"Words + meaning". This is the one ranking fact users actually want.

---

## 7. Labels & copy (drop-in string set)

| Location | Now | New |
| --- | --- | --- |
| list head | "N matching chunks" | "N matches across M sessions" |
| list head | "{n} indexed" / "derived QMD chunks" | "{n} moments indexed" |
| search placeholder | "Search QMD, embeddings, API work, raw log drilldown…" | "Search your sessions — topics, files, decisions…" |
| empty hits | "No hits for this query…" | "No matches. Try a project, file path, or topic from recent work." |
| inspector eyebrow | "Selected result" | drop (headline stands alone) |
| section | "Rendered message hits" | "Conversation" |
| section | "Indexed snippet" | drop (excerpt replaces) |
| section | "Why ranked here" / "Index rank — lower sorts earlier" | "Why this matched" / "Relevance: Strong" |
| section | "Raw JSONL evidence" | "Raw evidence (advanced)" |
| empty inspector | "…inspect its QMD chunk, source record window, and raw JSONL evidence" | "Pick a result to read the conversation around the match." |
| sample queries | "QMD / MCP / context pack" | recent real projects/topics (derive from index facets) |

Principle: zero occurrences of "chunk", "QMD", "JSONL", or "index rank" in default (non-advanced)
copy. Those words are correct internally and wrong in the primary surface.

---

## 8. Component & data mapping (what to build)

**Frontend (`packages/web/client`):**
- `KnowledgeSearchScreen.tsx` — group hits by `collectionId` into session cards; new
  `SessionCard` + inline `MomentRow`; remove `displaySnippet()` regex once snippets arrive
  pre-rendered; replace reason/labels per §7.
- `KnowledgeSearchInspector.tsx` — reorder to §2; new `ConversationExcerpt` component (role
  blocks + tool fold) replacing the flat "Rendered message hits"; wrap Why/Raw in collapsibles;
  add the action bar; keep Indexer tab (consider hoisting it out).
- `knowledge-search.css` — reuse the `ks-*` namespace; add `ks-session-card`, `ks-moment`,
  `ks-convo`, `ks-role-block`, `ks-tool-fold`, `ks-actionbar`, `ks-strength` classes.

**Backend (small, enables the design):**
- Add `sessionTitle` (and optional `topic`) to `KnowledgeHit` — derive at index time: QMD
  `overview.md` AI title → first user prompt → `project · top facet`. *This is the one required
  data addition; everything else maps to existing fields.*
- Have the search endpoint return the **bestMoment snippet already rendered** (run the same
  `renderedText` path used by source-preview) so cards don't post-process raw event-window text.
- Optional: include `matchedRecordRole` per hit so the card reason ("in an assistant reply") and
  strength don't require the preview round-trip.

---

## 9. Build order

1. **Inspector: ConversationExcerpt + tool fold** (§2, §4) — biggest perceived change.
2. **Backend: `sessionTitle` + pre-rendered snippet** (§8) — unblocks the card headline.
3. **Cards: session grouping + new anatomy + copy** (§1, §7).
4. **Action bar: Open conversation deep-link + Fork stub** (§5).
5. **Ranking: qualitative strength + humanized "Why"** (§6).

1–2 alone remove the "raw JSONL / index records" feeling; 3–5 make it feel like a product.

See the companion HTML mock for the visual target.
