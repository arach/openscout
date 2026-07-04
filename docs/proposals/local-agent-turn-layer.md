# Local Agent Turn Layer — Proposal (draft)

> Status: draft for review. Apps (composers, job workers, scripts) are **clients** of this layer; they do not own wire code or transport implementations.

## Problem

OpenScout talks to local coding agents through several transports. The **wire** (spawn process, frame protocol, correlate requests, decode events) is duplicated between:

- `@openscout/agent-sessions` adapters (observe/control → Pairing primitives), and
- `@openscout/runtime` invoke paths (broker dispatch → final text + snapshots).

Confirmed today for **Codex** (`adapters/codex.ts` ↔ `runtime/codex-app-server.ts`). The same consumer-split pattern exists for **Claude** (`claude-code.ts` ↔ `claude-stream-json.ts`) and **pi** (`pi.ts` ↔ `pi-rpc.ts`).

Downstream apps need a **broker-free** way to run local agent turns: warm where possible, harness- and transport-agnostic, without importing reply context, agent cards, or flight semantics.

This proposal names that layer, classifies transports by **modality** (not by Codex), and places it in the package graph.

---

## Vocabulary (load-bearing words)

We reuse OpenScout terms where they already exist in `@openscout/protocol` and `docs/concepts.md`:

| Term | Meaning |
|------|---------|
| **Harness** | Which coding agent product (`codex`, `claude`, `pi`, `grok`, …). Same word as today; “coding agent” and “harness” refer to the same choice in practice. |
| **Transport** | How Scout reaches that harness (`codex_app_server`, `claude_stream_json`, `pi_rpc`, `grok_acp`, `tmux`, …). Already on `AgentEndpoint.transport`. |
| **Binding** | A local **attachment**: warm process (when applicable) + transport client + serialized turn lane. Generic; not Codex-specific. |
| **Turn** | One directed exchange: instructions + user input → accumulated agent text (+ usage). Matches harness-native “turn” where the transport has one. |
| **Endpoint** | Broker-addressable route to an agent. Stays a **runtime/broker** noun — not used for embed clients. |

Avoid: **runner**, **durable agent**, **engine** (except existing `HelperDefinition.engine` in protocol), new package names tied to one vendor.

Do **not** confuse `agent-sessions/src/protocol/` (Pairing/adapter primitives) with `@openscout/protocol` (broker/mesh/cards).

---

## Transport modalities (three families)

Transports are not all the same shape. Embed APIs should target **Family A** first; Families B/C stay broker/runtime paths with different cost and capability profiles.

### Family A — Structured session wire (primary)

Persistent child process, framed bidirectional protocol, explicit turn lifecycle.

| Transport | Harness(es) | Wire character |
|-----------|-------------|----------------|
| `codex_app_server` | codex | JSON-RPC, documented app-server protocol |
| `claude_stream_json` | claude | stream-json stdio |
| `pi_rpc` | pi | Pi RPC command/event stream |
| `grok_acp` | grok-acp | ACP-style JSON-RPC stdio |

**ACP** (`adapters/acp.ts`) and **pi RPC** are not identical implementations, but share the same *modality*: structured messages over a long-lived process, suitable for a shared **transport interface** with per-backend adapters.

**Embed suitability:** high — `runTurn()` / `completeTurn()` maps cleanly.

### Family B — Structured but session-opaque

Resume/exec style transports (`codex_exec`, `claude_resume`, …): structured CLI contracts but not a rich in-process event plane. Higher latency, weaker steer/interrupt. Embed possible later; not PR1.

### Family C — Shell attach

`tmux` (and similar): deliver prompts into a terminal session; scrape or tag replies. Agents that do not expose ACP/app-server/stream-json.

**Embed suitability:** low for `completeTurn()` — different API shape (`deliverPrompt`, polling, no guaranteed usage). Stays in **runtime** broker dispatch; not merged into the same text-turn helper as Family A.

---

## Layer model (split by concern, not by consumer)

```
┌─────────────────────────────────────────────────────────────┐
│  Apps (clients) — composers, workers, scripts               │
│  choose harness + transport + turn vs binding reuse           │
└───────────────────────────┬─────────────────────────────────┘
                            │ runTurn / openBinding
┌───────────────────────────▼─────────────────────────────────┐
│  Local turn API (agent-sessions export, e.g. ./local-turn)    │
│  completeTurn · openBinding · warmup · shutdown               │
└───────────────────────────┬─────────────────────────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         ▼                  ▼                  ▼
┌─────────────────┐ ┌──────────────┐ ┌─────────────────────┐
│ Transport       │ │ Projection   │ │ Orchestration       │
│ (per transport, │ │ PairingEvents│ │ broker: cards,      │
│  shared wire)   │ │ vs text/usage│ │ reply context,      │
│                 │ │              │ │ flights (runtime)   │
└─────────────────┘ └──────────────┘ └─────────────────────┘
```

1. **Transport** — spawn, handshake, request/notify, decode raw harness events. **Dedup target.** Per transport implementation, not per consumer.
2. **Projection** — same byte stream → PairingEvents (adapters) or `{ text, usage }` (embed). Two legitimate consumers; keep both.
3. **Orchestration** — persistent thread policy, registry, broker identity. **Runtime only.**

---

## Public API (harness-agnostic)

Subpath export from `@openscout/agent-sessions` (no new package until an external consumer must avoid observation code):

```ts
// Illustrative — names TBD in review

type LocalTurnRequest = {
  system?: string;
  user: string;
  cwd?: string;
  model?: string;
  sandbox?: string;           // harness-specific; opaque at API edge
  approvalPolicy?: string;
  signal?: AbortSignal;
};

type LocalTurnResult = {
  text: string;
  usage?: { inputTokens: number; outputTokens: number; cachedInputTokens?: number };
  harness: AgentHarness;
  transport: string;
  threadId?: string;          // for clients that want to openBinding next
};

// One-shot: binding owns process for one turn, then releases (or keeps warm pool)
function completeTurn(
  target: { harness: AgentHarness; transport?: string },
  req: LocalTurnRequest,
): Promise<LocalTurnResult>;

// Multi-turn: reuse attachment + thread where transport supports it
function openBinding(
  target: { harness: AgentHarness; transport?: string; profile?: string },
): Promise<LocalBinding>;

interface LocalBinding {
  runTurn(req: LocalTurnRequest): Promise<LocalTurnResult>;
  warmup(): Promise<void>;
  close(): Promise<void>;
}
```

**Tripwire:** `completeTurn` / `LocalTurnRequest` must never grow `replyContext`, `conversationId`, `flightId`, or card fields. That indicates broker leakage.

Default transport resolution: harness catalog / existing runtime defaults (e.g. codex → `codex_app_server`, claude → `claude_stream_json`).

---

## Runtime cost (starting agent calls)

Costs are staged; warmth changes *which stages repeat*:

| Stage | `completeTurn` (ephemeral thread) | `openBinding` (reuse thread) |
|-------|----------------------------------|------------------------------|
| Process spawn | Amortized via binding pool | Once per binding |
| Handshake / initialize | Amortized | Once |
| Thread/session start | Per turn | Once, then reuse |
| Harness boot (MCP, skills, context) | Per new thread | Amortized across turns |
| Model | Per turn | Per turn |

OpenScout should own:

- **Binding pool** — optional warm process per `(harness, transport, profile)` in the transport layer
- **Launch profiles** — MCP/env surface (`codex-launch-config`, harness catalog `launch` / `readiness`)
- **Usage** on `LocalTurnResult`

Clients choose API by workload:

- Rare isolated turns → `completeTurn`
- Several turns per resource (e.g. one composition, one worktree) → `openBinding`

---

## Package placement

| Owns | Package |
|------|---------|
| Transport implementations (`CodexAppServerTransport`, `ClaudeStreamJsonTransport`, `PiRpcTransport`, …) | `agent-sessions` |
| Adapters (transport → Pairing) | `agent-sessions` |
| `completeTurn` / `openBinding` | `agent-sessions` subpath `./local-turn` |
| Broker invoke, reply context, endpoint prewarm (`keep_warm`) | `runtime` |
| Broker record types | `protocol` |
| Job schemas, product modes, output JSON shapes | **Apps (clients)** |

Promote to standalone `@openscout/local-turn` only if a consumer must not depend on observation/registry code.

---

## Implementation order

1. **Extract `CodexAppServerTransport`** — dedupe `adapters/codex.ts` and `runtime/codex-app-server.ts`; no behavior change; existing tests on both sides stay green.
2. **`completeTurn` for codex** — first embed entry on shared transport.
3. **`openBinding` + pool policy** — thread reuse, documented cost tradeoff.
4. **Extract Claude + pi transports** — same pattern.
5. **Defer** — Family B/C embed, standalone package, `HarnessSession` renames.

---

## Non-goals

- Replacing broker or `@openscout/agent-sessions` adapters for Scout UI / Pairing.
- Mastra/Inngest-style workflow engines inside this layer.
- App-owned prompts, job DAGs, or structured-output schemas in agent-sessions.
- Forcing tmux/shell agents through `completeTurn()`.

---

## Open questions for review

1. Is **Binding** the right generic noun (vs Session, Attachment, Handle)?
2. Should `transport` be explicit on every call, or inferred from harness catalog with optional override?
3. For Family A, is one shared `Transport` interface enough across JSON-RPC (Codex/ACP) and stream-json (Claude)?
4. Where should launch profiles live so MCP boot cost is controlled for embed clients?
5. Minimum pool policy: per-process singleton, per-worker, or explicit `warmup()` only?

---

## References

- `packages/agent-sessions/README.md` — adapter substrate boundary
- `packages/runtime/src/local-agent-transports.ts` — direct vs tmux transports
- `packages/protocol/src/actors.ts` — `AgentHarness`, `AgentEndpoint.transport`, `WakePolicy.keep_warm`
- `docs/codex-app-server-harness.md` — broker persistent session plane (orchestration context)
- Prior review: `.data/local-harness-architecture-review.md` (Fable, 2026-07-03)