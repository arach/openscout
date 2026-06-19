# SCO-XXX: Session identity (v0 — simplified)

## Status

**Decided — v0 simplified** (2026-06-19). Three-id segmentation (`scoutSessionId`, `refSessionId`, `harnessSessionId`) deferred.

## Problem

OpenScout conflates provider session ids with transport attach refs in one field:

| Today | Often holds |
| --- | --- |
| `harnessSessionId` (web `Agent`) | Claude uuid **or** tmux/`relay-*` name |
| `externalSessionId` (runtime metadata) | Harness provider id (better, wrong name) |
| `terminalSurface.sessionName` | tmux/zellij attach ref (right place, underused) |

Lanes bound the wrong slot → duplicate columns. Fleet warnings used `relay-*` regex instead of a clear invariant.

**Terminal relay** (web ↔ PTY) is unrelated — keep that name only there.

## v0 decision: two fields + existing identity

No new `scoutSessionId` or `refSessionId` for local pilots.

| Field | Role |
| --- | --- |
| **`agent.id`** | Scout-owned durable identity (existing) |
| **`harnessSessionId`** | Provider conversation id only (Claude, Codex, Grok). Nullable until known. |
| **`terminalSurface`** | Structured attach ref (`sessionName`, `backend`, …) for tmux/zellij |

### Invariants (enforce in code)

1. **`harnessSessionId` is provider truth** — never tmux name, never `relay-*`.
2. **Transport attach** lives in **`terminalSurface`** (or `endpoint.sessionId` at broker), not `harnessSessionId`.
3. **Lanes / tail / observe** bind on `harnessSessionId` + `harnessLogPath` only.
4. **Unattached is normal** — `harnessSessionId` null until harness exposes an id.
5. **Fleet diagnostics** — warn when agents lack a provider harness session or pollution is detected; no lanes dedup.

### Migration (when touched)

| Current | v0 target |
| --- | --- |
| `externalSessionId` | Read/write as **`harnessSessionId`** (rename opportunistically; shim on read) |
| `relay-*` / tmux name in `harnessSessionId` | Move to **`terminalSurface.sessionName`**; clear harness slot |
| Web broker projection | Stop copying `endpoint.sessionId` into `harnessSessionId` when it is transport-only |

**Implemented (web projection):** `resolveHarnessSessionId` in `db/internal/paths.ts`; broker cards use it; Claude cwd resolution runs on all `/api/agents` rows.

## Cleanup sweep (2026-06-19)

Stage-set for v0 pilots:

| Area | Done |
| --- | --- |
| Web projection | `harnessSessionId` null for tmux/zellij; `terminalSurface` carries attach ref |
| Tail registry | Cursor monitor logs path-keyed; no collision issues emitted |
| Lanes roster | Diagnostics scoped to live fleet (`isLaneRosterFleetAgent`); no placeholder-card noise |
| Roster warnings | `harness_session_unbound` only for `in_flight` provider transports; cursor collisions suppressed |
| Broker | Restart broker after tail/runtime changes (tail discovery runs in broker, not web) |

**Forward (operational, not code):**

- Retire stale configured cards: `scout card retire <id>` (no bulk CLI yet)
- Prune one-time cards: `scout card cleanup --all`
- Refresh tail: `curl 'http://127.0.0.1:65535/v1/tail/discover?force=1'`
- Hard-refresh `/ops/lanes` after client changes (`Cmd+Shift+R`)

## Deferred (post-v0)

- `scoutSessionId` — only if `agent.id` proves insufficient for binding layer (see SCO-004)
- `refSessionId` + `refKind` — only when attach refs exist that do not fit `terminalSurface` (remote node, non-terminal)
- Full sqlite column rename in one shot

## Adversarial review summary

- **Codex (advocate):** three ids fix semantic conflation; adopt-with-changes.
- **Skeptic / author gut:** asking the question is the tell — **too much for v0**. Rename + split harness vs terminal surface is enough.

## Non-goals

- Terminal relay rename
- Lanes remediation / dedup
- Bulk transcript import into broker