# Flat Session Dispatch — review of the refined summary

Status: review note (no code changes)
Date: 2026-08-03
Author: Fable (session-msdi6u4i-qmlws6)
Reviews: [flat-session-dispatch.md](./flat-session-dispatch.md) against Art + Grok's refined summary

The summary is the current product intent and supersedes parts of the proposal. This note says
where I agree, where I push back, what must be fixed before P0 ships, and what the proposal doc
should become.

---

## Agree

1. **One bus, two addressing modes beats a hard dual-plane split.** My §1 was over-built. The two
   real deltas — no Scout identity attached to the endpoint, and mediated rather than initiated as
   a Scout-agent conversation — are attributes of a *delivery*, not a justification for a parallel
   record type with its own vocabulary table. Concede.
2. **`ask` only when the caller depends on a reply; otherwise `send`.** This is already Scout's
   stated idiom, not a new rule — `apps/desktop/src/cli/commands/send.ts:30-31` says exactly this in
   the help text. Making flat dispatch obey it keeps one grammar instead of two.
3. **No new `scout reply` verb.** Correct, and for a stronger reason than the summary gives — see
   Pushback 1.
4. **Envelope only when Scout cannot observe the answer natively.** Unchanged from D4(a). Confines
   CLI boilerplate to genuinely blind surfaces.
5. **Never fall through to another card or project worker.** This is the whole fix. The Blink
   mis-route must be impossible by assertion.
6. **Visible as a dispatch, not a peer relationship.** Log entry with initiator, endpoint, state,
   ref. Not an inbox row.

---

## Pushback

### P1 — "no new verb" is right, and the reason is better than stated

`--ref` is **already polymorphic across record types**. `normalizeScoutWaitRef`
(`apps/desktop/src/core/broker/service.ts:4546`) strips `ref:` / `flight:` / `invocation:` /
`message:`, and `buildWaitResolution` (`:4555`) carries
`kind: "invocation" | "flight" | "message" | "ref"`. Ref resolution is a multi-record resolver
today.

So my D3 argument — that overloading `send --ref` would make `--ref` polymorphic across two record
types — was wrong on the facts. It already is. Adding a session-dispatch backing record is
*consistent with the existing design*, not an overload of it. Adopt D3(b); strike D3(a).

### P2 — dropping the separate record type is not the same as dropping the separate rendering

Collapsing the planes is right at the *addressing* layer. It is dangerous at the *storage* layer.
If a flat dispatch is written as an ordinary `MessageRecord`, then by default it materializes a
conversation, an inbox row, and a `from`/`to` — which is the pollution the whole exercise exists to
avoid. "Same machinery minus identity" only holds if *minus identity* is enforced on the record
(a flag that suppresses conversation creation, inbox membership, `scout who`, and fleet counts),
not merely on the renderer. Otherwise the first UI query written straight off `MessageRecord`
turns every dispatch back into a DM, and nobody notices until the next Blink.

The record can be lighter than my `SessionDispatch` — but the suppression must be structural.

### P3 — "Codex = harness, not editor" is right as product framing, wrong as implementation framing

Drop the VS Code *product* section; agreed. But the VS Code fact is not an editor story, it is a
**surface-ownership** fact: the live process belongs to the extension host, so Scout cannot inject
into it. It can only resume the rollout into a Scout-owned surface — same context, new process.
That is a continuity fork, and the receipt has to say so (`surfaceChanged`, `vscode → tmux`).

If that line disappears with the VS Code framing, the operator believes they reached the live pane.
Keep one row in the harness/surface table and one receipt requirement; delete the rest.

---

## Must-fix

### M1 — ref matching is suffix-based today; a bearer ref must not inherit that

`flightReferenceMatches` (`service.ts:4584`) matches on
`flight.id.toLowerCase().endsWith(lowerRef)`. An 8-char dispatch ref resolved through the same path
can suffix-collide with an unrelated flight id.

Requirements: dispatch refs resolve by **exact equality on a dedicated index**, and ref lookup
**fails closed on multi-record match** instead of taking the first hit. This is the same failure
class as the Blink mis-route — loose match landing on the wrong target — one layer down.

### M2 — `scoutDispatch` is already taken

`message.metadata.scoutDispatch` already means *broker delivery dispatch*
(`service.ts:4574-4577`). If the flat-session feature also calls itself "dispatch", two different
things share a name in the same table. Either namespace the new key explicitly or rename the
feature. Decide before the record lands, not after.

### M3 — P0 scope so the cold-Codex command actually works

For `scout ask --to session:codex:<id> --project <cwd> "…"` on a cold but resumable session, P0
must include:

- **T3 locator** over `~/.codex/sessions/**/rollout-*.jsonl` → `(cwd, lastActivityAt)`, wired into
  `resolveSessionTarget` **before** the `{ kind: "unknown" }` return.
- **Broker-internal wake** via the existing intake primitive and `buildHarnessResumeCommand`,
  registering a cardless endpoint (SCO-070 plumbing) that is excluded from `scout who`, fleet
  counts, agent listings, and inbox.
- **`terminal_session_registry` upsert** on wake, so the second dispatch resolves at T2 instead of
  re-walking disk.
- **Ref minted and returned before resolution**, so a 40-second wake still hands the caller a
  durable handle.
- **Envelope on terminal-backed surfaces only**, prefilling `scout send --ref <ref> "…"`.
- **Hard assertion** that exact-session failure returns `unavailable` with candidates as text and
  never routes, plus a regression test named for the Blink incident.
- **Three fail-closed cases at P0, not P1**: `session_ambiguous_harness`, `session_cwd_conflict`,
  `session_not_resumable`. Without these, "never fall through" is narrow rather than safe — a
  cross-harness id collision or a cwd mismatch silently resumes the wrong context.

### M4 — `ask --ref` continuation needs the same exactness guarantee

The summary makes continuation the original sender's choice: `send --ref` or `ask --ref`. Whichever
is used, continuing on a dispatch ref must re-resolve to **that session**, and must fail closed when
the session is gone — never re-target the project or the branch-named worker. Otherwise the Blink
bug simply reappears on turn two.

### M5 — the envelope template in the proposal is now wrong

§4's template and §7's P0 list both name `scout reply --ref`. Replace both with:

```text
scout send --ref <receipt> "YOUR ANSWER HERE"
```

Keep the surrounding guardrails verbatim — multi-line via `--message-file`, `blocked:` prefix,
explicit expiry, ref printed twice, and above all *do not open a new ask and do not invent `--to`*.
That last line is the one that stops Scout-aware sessions from helpfully recreating the social
plane.

---

## Suggested doc delta

| Section | Change |
|---|---|
| Title / §1 | Retitle away from "two planes". §1 becomes "one bus, two addressing modes"; the two deltas (no identity attached, mediated) are delivery attributes. Keep the vocabulary table — it is still what stops dispatches rendering as DMs — but drop the "flat plane" framing around it. |
| §1b record | Keep the fields; drop the claim that this is a second plane. Add the structural-suppression requirement from P2. |
| §2 "VS Code caveat" | Delete as a product section. Fold the surface-ownership fact into the §3 harness/surface table as one row plus one receipt requirement. |
| §2 ladder + fail-closed matrix | **Unchanged.** Orthogonal to the simplification and still the core of the fix. |
| §4 "Recommended CLI" | Strike entirely. Replace with: replies use `scout send --ref`; Scout-managed turns use native capture / final_response / MCP reply. |
| §4 template | Rewrite per M5. |
| §4 semantics + security | **Unchanged** — idempotency, late-reply-as-notification, expiry, bearer-token honesty all survive. |
| §5 "must not happen" | Add: ref resolution never matches by suffix, and never picks among multi-record hits. |
| §6 observability | **Unchanged.** |
| §7 P0 | Replace `scout reply --ref` with `send --ref`; promote the three fail-closed cases from P1 into P0 (M3). |
| §8 D3 | Resolved as (b), overload `send --ref`. Record my earlier recommendation as withdrawn and why. |
| §8 D2 | Reframe: not a VS Code decision, a surface-ownership decision. Answer stands — resume into a Scout surface, label it loudly. |
| §8 D6 | Still open. Needs Art's two numbers (inline wait, ref expiry). |
| Doc deltas 1–3 | **All stand.** `docs/runtime-sessions.md:330` broker-known → harness-known; the explicit wake-vs-unreachable matrix; and scoping `scout-comms.agent.md:152`'s "observed evidence" to runtime dimensions. |

---

## Consensus rewrite

Scout is one bus with two ways to address work: a Scout identity, or an exact harness session
`session:<harness>:<native-id>`. The second is not a second plane — it is the same delivery
machinery with two deltas, no Scout identity attached to the endpoint and mediation rather than
initiation, and those deltas must be enforced structurally (no conversation, no inbox row, no
`scout who` entry) rather than only in the renderer. Exact-session targets resolve down a ladder
from the live registry through stale endpoints and the Scout terminal-session registry to the
harness's own on-disk stores, waking through the existing intake primitive at whichever rung hits,
and they **fail closed** — on unknown, ambiguous harness, cwd conflict, or unresumable — never
degrading into project, label, or capability routing. Replies use the verb that already exists:
`scout send --ref <receipt>`, with `ask` reserved for turns whose caller genuinely blocks on an
answer, and an envelope injected only where Scout cannot observe the reply itself. The result is
that knowing a harness-native session id, its harness, and its cwd is enough to reach it; reaching
it costs the session nothing but an answer; and the wrong worker can never receive the payload.

---

## Open, and who owns it

- **D6 timeouts** — Art. Two numbers: inline wait, ref expiry.
- **M2 naming** — whoever writes the record. Pick before it lands.
- **P0 implementation** — unassigned. The boundary test is the Blink command returning a real answer
  from `019fbee7-2a7f-7eb0-84bf-da22717c74d0`'s context, with the wrong-worker outcome impossible by
  assertion rather than by luck.
