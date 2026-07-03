# SCO-073: Session SID Lookup (Stable Handoff Codes)

## Status

Amended (2026-07-02). The provisional alias-table direction below is superseded
for default project-routed sessions: Scout now mints a broker-owned `sid`
metadata value and returns it as the shareable handoff token. Agents should pass
`sid:<code>` or the raw sid code as `targetSessionId` to continue the exact
session. Provisional `sessionAlias` / `project-*` handles remain compatibility
or explicit-handle affordances, not the default handoff primitive.

Originally proposed (2026-06-27) — captures operator feedback after confusing
`Project Chopin` cardless spawns with configured agents such as
`scope.main.arts-mac-mini-local`.

## Proposal ID

`sco-073`

## Date

2026-06-27

## Intent

Make session handoffs explicit without minting agent cards or noisy provisional
agent-like names. The current default handoff is a stable broker-owned `sid`:

```
sid:<code>  →  session_id  (+ project, harness, endpoint metadata)
```

The sid is routable for orchestrators and humans, but it is **not** an agent
identity. Under the hood, delivery resolves through the cardless session actor
and endpoint from SCO-070. Cardless sessions stay cardless; we stop dressing
them up as named agents.

This extends [SCO-070](./sco-070-scout-initiated-cardless-sessions.md) (cardless
sessions belong to a project path) and narrows the binding layer from
[SCO-004](./sco-004-addressable-identities-and-session-bindings-proposal.md)
(provisional alias as a live binding, not a new identity class).

## Problem

Today a project-path ask can mint a cardless worker that surfaces as
`Project Chopin`:

| What the user sees | What actually exists |
| ------------------ | -------------------- |
| `Project Chopin acknowledged via spawn` | Actor `session-mqvw7fgy-…` |
| Handle `project-chopin` (sometimes) | Metadata on the session actor |
| `ref:n-gca1nz` | Last 8 chars of `flight` id — wait shorthand, not semantic |
| `scope.main.arts-mac-mini-local` | Unrelated configured **agent card** |

Pain points:

1. **Aliases look like agents** but the product contract says they are disposable
   (`new-agent-model.ts`: "Not addressable later").
2. **Routing is inconsistent** — `project-chopin` may work while live;
   `chopin` does not; `--ref` works for `scout wait` but not reliably for
   `scout ask`.
3. **Orchestrators lack a stable handle bundle** — parent agents must either
   embed raw session UUIDs or guess `@project` again and risk a new spawn.
4. **No invalidation story** — recycling a composer name for a different session
   without clearing the old pointer is ambiguous.

Configured agent cards (`scope.main…`) solve durability; this proposal solves the
**middle tier** between "raw session id" and "promoted card."

## Decision

Default project-routed cardless sessions store `metadata.sid` on both the
session actor and endpoint. `endpointMatchesTargetSession` resolves raw sid
codes and `sid:<code>` values alongside broker session ids, harness thread ids,
and other endpoint aliases.

The older first-class **`session_aliases`** table idea below remains a possible
compatibility/promotion feature, but it is not the default handoff path. Each
row would be a **provisional routable pointer**, not an agent.

### Alias record (minimal)

```ts
type SessionAliasRecord = {
  alias: string;              // normalized, e.g. "project-chopin"
  sessionId: string;          // broker session actor id or harness session id policy (see below)
  projectRoot: string;        // resolved absolute path
  harness: AgentHarness;
  nodeId: string;             // owning node for local resolution
  kind: "provisional" | "promoted";
  createdAt: number;
  expiresAt: number | null;   // null only when kind === "promoted" or pinned
  flightId?: string;          // optional: alias dies with flight
  conversationId?: string;    // thread that minted the alias
  displayLabel?: string;      // "project-chopin · scope · codex" — not "Agent Chopin"
};
```

**Canonical target** for dispatch remains the session actor / endpoint binding
from SCO-070. The alias row is indirection only.

### Two routing tiers (unchanged third tier)

| Tier | Example | Lifetime | Resolves via |
| ---- | ------- | -------- | ------------ |
| **A. Session alias** | `project-chopin` | Ephemeral (TTL / flight / session end) | alias table → `session:<id>` |
| **B. Agent card** | `scope.main.arts-mac-mini-local` | Durable until pruned | agent registry → endpoint/session |
| **C. Bare session** | `session:019eff52-…` | Harness thread continuity | `resolveSessionTarget` |

Tier A is new as an **explicit** table; tier B and C already exist.

### Resolution order

When `scout ask --to <label>` (or MCP `ask` with `to`):

1. **Exact agent card** — configured / registered `AgentDefinition`
2. **Session alias** — `session_aliases.alias` (normalized)
3. **Binding ref / flight suffix** — existing flight metadata (unchanged)
4. **Bare `session:<id>`** — `resolveSessionTarget`
5. **Project + harness spawn** — mint cardless session **and** a new alias row

Never treat a provisional alias as a discoverable agent in `scout who` search
results beyond a short "live pointers" section (opt-in).

### Minting rules

On cardless project spawn (`broker-daemon.ts` materialization path):

1. Allocate display token from provisional pool (`project-{name}` today).
2. Insert alias row: `alias → sessionId`, scoped to `projectRoot + harness + nodeId`.
3. Invalidate any prior **provisional** alias with the same `alias` on the same
   `(projectRoot, harness, nodeId)` tuple before insert (or reject collision).
4. Return receipt that states the pointer explicitly:

   ```text
   alias project-chopin → session-mqvw7fgy-ineuic · scope · codex
   acknowledged via spawn
   ```

Do **not** print copy that implies a new agent joined the fleet.

### Expiry / GC

Provisional aliases expire when **any** of:

- `expiresAt` (default TTL, e.g. 24h soft / 7d hard — tunable)
- bound `flightId` reaches terminal state + grace period
- session endpoint marked stale/offline per SCO-070 reaper
- explicit `alias revoke` / session complete

**Soft delete:** mark alias `inactive`; keep row for transcript provenance. Do not
reuse the same alias string for a different `sessionId` until inactive + cooldown.

Promoted aliases (`kind: "promoted"`) are created only via explicit operator or
agent action: "Save as card" / `scout card promote` — out of scope for v1 but
the schema reserves `kind`.

### Orchestrator / parent-agent context

Higher-level agents should receive a compact **handle bundle** in ask receipts
and MCP `ask` responses:

```json
{
  "targetAgentId": "session-mqvw7fgy-ineuic",
  "sessionAlias": "project-chopin",
  "projectRoot": "/Users/art/dev/scope",
  "harness": "codex",
  "continuity": {
    "session": "session-mqvw7fgy-ineuic",
    "harnessSession": "019eff52-9347-7470-ba5c-6bfe99d8dd83"
  }
}
```

Parent prompts can say `@project-chopin` or `project-chopin` knowing the broker
resolves the pointer; they should not need flight suffixes or composer surnames.

### CLI / receipt changes

| Today | Target |
| ----- | ------ |
| `Project Chopin acknowledged via spawn` | `project-chopin → session-mqvw7fgy-… (scope, codex)` |
| `ref:n-gca1nz` only in wait hints | Keep for wait; **also** print `alias project-chopin` |
| `scout ask --ref n-gca1nz` unreliable | `--ref` resolves flight → alias → session (or deprecate ref-for-ask) |
| `scout ask --to chopin` fails | Fail with hint: `did you mean project-chopin?` |

Suggested commands:

```bash
scout alias list --project ~/dev/scope
scout alias resolve project-chopin
scout ask --to project-chopin "continue"
scout ask --to session:019eff52-… "continue exact harness thread"
```

### UI changes (follow-on)

- Composer / session list: show **alias → session** not faux agent names.
- Agent roster: configured cards only; live aliases under project detail.
- macOS / web inspect surfaces: copy buttons for `alias`, `session`, `harnessSession`.

## Non-goals (v1)

- Replacing agent cards or `scope.main`-style configured identities.
- Cross-node alias routing without owner forwarding (SCO-070 gap remains until
  `(nodeId, sessionId)` forward exists).
- Global alias namespace across projects (aliases are scoped by default).
- Letting LLMs invent alias strings; broker allocates from pool unless operator
  supplies an explicit sticky name at card creation time.

## Implementation seams

| Seam | Location | Work |
| ---- | -------- | ---- |
| 1. Storage | `broker-cardless-session.ts` | persist `sid` on session actor + endpoint metadata |
| 2. Mint | `broker-daemon.ts` cardless materialization | mint `sid` on spawn; only use handles when explicit |
| 3. Resolve | `broker-endpoint-selection.ts` | match raw sid and `sid:<code>` in session target lookup |
| 4. Receipt | `apps/desktop/src/cli/commands/ask.ts` | render `sid:<code>` before legacy aliases |
| 5. API | broker HTTP / MCP `ask` | return `sid` in ids payload |
| 6. Compatibility | runtime/CLI | keep `sessionAlias` as fallback for old explicit handles |

## Current Acceptance Tests

1. `scout ask --project ~/dev/scope --harness codex` returns `sid` and
   `targetSessionId`; receipt shows `sid:<code>`, not "Project {Composer}."
2. `targetSessionId: "sid:<code>"` and raw `targetSessionId: "<code>"` both
   deliver to the **same** session without re-spawn while the session is live.
3. Stale sessions fail closed with session-reference diagnostics; `--project`
   mints a **new** sid-backed session.
4. `scope.main.arts-mac-mini-local` routing unchanged (card tier unaffected).
5. Orchestrator receipt JSON includes `sid` for parent-agent handoff.

## Open questions

1. Should `sessionId` in the alias row be the broker actor (`session-…`) or the
   harness thread (`019eff52-…`) when both exist? **Recommendation:** store
   both in `continuity`; alias primary key targets broker actor; harness id is
   secondary for exact resume.
2. Default TTL for provisional aliases — flight-bound only vs 24h wall clock?
3. Should `scout who` list active aliases, or only `scout alias list`?

## Related

- [SCO-070](./sco-070-scout-initiated-cardless-sessions.md) — cardless sessions
- [SCO-004](./sco-004-addressable-identities-and-session-bindings-proposal.md) —
  identity vs session vs binding
- `packages/runtime/src/provisional-agent-names.ts` — name pool (display tokens)
- `packages/runtime/src/broker-cardless-session.ts` — session actor without card
- `packages/web/client/screens/projects/new-agent-model.ts` — disposable vs sticky copy
