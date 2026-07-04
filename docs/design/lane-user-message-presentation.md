# Lane/trace: user-message presentation + technical-collapse toggle

Implementation-oriented UI guidance for `SessionObserve` lane mode
(`packages/web/client/screens/sessions/SessionObserve.tsx` +
`session-observe.css`). Grounded in the current class names.

## The core problem (from the screenshot)

Every row is a left-edged block in one column. Human "incoming ask", agent
"message", and tool cards (`sed`, `rg`, `git`) differ only in tint, not in
*structural position*. The eye can't separate **conversation** (human ↔ agent
prose) from **work** (tools/events). Two aggravators, both fixable now:

1. **Agent prose is literally rendered in the terminal font.** `session-observe.css:961`
   forces `.s-observe--lane .s-observe-message-text` to `font-mono / text-xs`.
   That is the single biggest reason agent speech dissolves into the tool
   stream. Move message text to `font-sans / text-sm / line-height 1.55` (it
   already is for `.s-observe-ask-text`; mirror it).
2. **Picket-fence spines.** Human (amber), agent (neutral), and every tool each
   carry their own left border at the same x-origin, so nothing reads as
   subordinate. Fix with an **indent hierarchy**, not more spines.

## Design principle: two registers

Split the lane into two visual registers and let position carry the hierarchy:

- **Speech register** — human asks + agent messages. Full width at the outer
  margin, sans-serif, `--ink`, speaker attribution. This is the spine of the story.
- **Work register** — tools, thinks, notes, system/boot. **Indented** ~`var(--space-lg)`
  (16–20px), mono, `--dim`. A "machine margin" running inboard of the speech.

One structural move — indent the work register — does most of the work. Once
tools sit inset, you can *remove* the per-tool and agent-message left spines
(`session-observe.css:829`, `:976`); reserve a spine for the human ask only.

## User-message (incoming ask) card — the priority

The ask is the highest-value object in the lane: it's the human. Current amber
treatment (`:767`) is the right direction; sharpen it:

- **Attribution, not a generic "Ask" eyebrow.** Replace the `"Ask"` label with an
  identity row: human glyph + name (`you` / handle) + relative time. Use the
  agent-sprite system for the *agent* side; the human gets a distinct neutral
  glyph, never a harness-hued sprite. Keep it one line, `text-2xs`.
- **Amber is the human, exclusively.** Audit `KIND_COLOR` and CSS: no non-human
  element should use `--amber`. Then the amber spine unambiguously means "a
  person is speaking." Title stays `--ink`, weight 500 (`:785` is good).
- **Two ask shapes, not one.** The screenshot's second ask is a bare URL + "this
  message went nowhere" rendered as a full slab identical to the first. Detect
  short / URL-only / single-line asks (`ask.preview === ask.title` already
  signals this) and render a **compact one-line variant** — glyph + text + time,
  no title/preview split, no interior padding block. Kills the "two identical
  amber blocks" read.
- **Answer as a reply.** The `↳ answer` sub-block (`:805`) should indent *under*
  the human card as a quiet reply, `text-xs`, `--dim`. Good already; keep.

## Agent-message card

- Body → `font-sans / text-sm` (undo the mono override at `:961`).
- Replace the cryptic `→ message → you` (`MessageLine`, line 1023) with sprite +
  agent name at `text-2xs --dim`. The direction ("→ you") is implicit once it
  sits in the speech register; drop it or demote to a hover detail.
- Remove the neutral left spine (`:829`); let the outer-margin position + type
  weight distinguish it from the indented tool run.

## Turn grouping

Wrap each turn's rows in a lightweight container introduced by the existing
`GrokTurnLaneLine` (turn N · model). Group that turn's tools/thinks under it.
This gives the collapse toggle a *unit* to act on, and lets spacing express
rhythm: `var(--space-lg)` **between** turns, `var(--space-2xs)` **within** a
tool run. Today the gap is uniform — that flatness is half the noise.

## Lane-level collapse toggle

A segmented control in the lane header: **Talk · All** (add **Work** later if
wanted). Store per-lane in `localStorage` keyed by session/lane id.

- **All** (current behavior): full trace, every event.
- **Talk** (collapsed): show only the speech register + *important tool status*.
  Collapse routine tool spam into one per-turn chip: `▸ 7 steps · 2 files changed`.
  Clicking the chip expands that turn inline (reuse the `LaneExpandable`
  mechanics already in the file).

**Always preserved in Talk mode** (never collapsed):
- every human ask (the whole point);
- turn headers/boundaries;
- **important tool status**, by heuristic:
  - errors / failed tools (the only place `--red` is earned);
  - permission decisions (`GrokPermissionLaneLine`);
  - tools that changed files (`event.diff` present);
  - tools that surfaced a `result`/`answer`;
  - the **last** tool of a completed turn (shows where it landed).

**Collapsed** (folded into the chip): reads, greps, navigations, `cat`/`ls`/
`sed` — the connective tissue.

## States

- **Live turn never collapses.** Only fold *completed* turns (mirrors the
  existing `collapseCompletedReasoning` option). You always want to watch the
  in-progress tail work.
- **Default per context, not global.** A "needs you" lane opens in **Talk**; a
  lane you opened to debug an active agent opens in **All**. User's explicit
  toggle then persists and wins.
- **Chip vs toggle scope.** Chip expands one turn; the header toggle flips the
  whole lane. Expanding all turns manually shouldn't silently flip the toggle.

## Colors / tokens (single-accent discipline)

- `--amber` = human voice only.
- `--ink` full for human title + agent prose; `--dim` for the machine margin.
- No categorical hues. Differentiate by **contrast + indent + weight**, not
  color. `--red` only for genuine errors.
- Spines: keep amber 2px on the human ask; drop the agent and tool spines in
  favor of indent.

## Spacing

- Between turns: `var(--space-lg)`. Within a tool run: `var(--space-2xs)`.
- Speech cards: generous internal padding (`space-sm`/`space-md`).
- Tools: compact single-line rows, indented into the machine margin.

## Edge cases

- **URL-only / "went nowhere" asks** → compact variant; optional faint "no
  reply" marker when the ask has no following agent message.
- **Consecutive human asks with no reply between** → stack tightly as one human
  burst (single attribution, shared spine).
- **Streaming ask/message** → keep the `s-observe-cursor`; never collapse the
  live turn.
- **Turn with only tools, no speech** → in Talk mode still show the turn header +
  status chip so the turn can't vanish.
- **System / boot / instructions** → dimmest register; hide entirely in Talk
  mode (neither speech nor important status).
- **Notes** (`turn_started` / `turn_ended`) → render as turn delimiters, not
  inline rows.
- **Very long ask/message** → existing `LaneExpandableText` clamp is correct; keep.

## Suggested implementation order (fastest signal first)

1. Undo the mono override on message text (`:961`) → agent prose reads as prose.
2. Indent the work register + drop agent/tool spines → speech vs work separates.
3. Compact one-line ask variant → the "two identical amber slabs" go away.
4. Sprite + name attribution on ask and message.
5. Turn grouping + between/within spacing.
6. Talk/All toggle with the per-turn status chip + heuristic.
