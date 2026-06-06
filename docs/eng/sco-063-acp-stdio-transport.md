# SCO-063: ACP Stdio Transport

## Status

Accepted. First local runtime slice implemented.

The implemented slice adds `acp_stdio` to the shared transport vocabulary,
local-agent setup normalization, broker/direct-session routing, and the
runtime wrapper around the existing ACP stdio adapter. It includes a fake ACP
endpoint test that warms, invokes, snapshots, and shuts down through the
local-agent runtime.

## Proposal ID

`sco-063`

## Intent

Add `acp_stdio` as the generic Scout runtime transport for local coding agents
that implement the Agent Client Protocol over stdio.

This is the protocol-shaped successor to one-off local harness shims such as
`cursor_exec`, and the concrete integration path for the managed-process
contract in [SCO-056](./sco-056-managed-process-adapter-contract.md).

## Context

OpenScout now has several local harness paths:

- interactive TUI harnesses through tmux or direct stream JSON
- app-server/direct execution harnesses
- RPC-backed local harnesses
- one-shot CLI harnesses such as the current `cursor_exec` path
- lower-level session adapters in `@openscout/agent-sessions`

The common shape is always the same: start or find a harness, send a task,
observe progress, surface permission or unblock requests, capture the final
answer, and keep Scout-owned coordination records in the broker.

ACP gives us a standard wire protocol for the subset of harnesses that can
serve as local coding agents over stdio. The official ACP docs describe local
agents as editor subprocesses communicating with JSON-RPC over stdio, and
remote agents as future HTTP/WebSocket peers. It is not owned by any one agent
framework or host application.

OpenScout already has a lower-level ACP adapter in
`packages/agent-sessions/src/adapters/acp.ts`. This SCO is about promoting that
capability into the broker-facing local agent transport model.

## Decision

OpenScout SHOULD add `acp_stdio` as a managed local-agent transport.

`acp_stdio` is a Scout runtime adapter, not a new broker protocol. The broker
continues to own messages, invocations, flights, deliveries, and agent
registration. The ACP process owns its own session transcript and harness
state. The runtime sits between them and maps:

| Scout concept | ACP concept |
| --- | --- |
| endpoint warmup | spawn process, `initialize`, optional `authenticate`, `session/new` or `session/load` |
| invocation | `session/prompt` |
| cancellation | `session/cancel` |
| endpoint shutdown | `session/close` when advertised, then process shutdown |
| final answer | buffered text from `agent_message_chunk` and prompt completion |
| observed events | `session/update` notifications |
| permission unblock | `session/request_permission` |
| workspace file reads/writes | `fs/read_text_file` and `fs/write_text_file`, gated by Scout policy |
| external session id | ACP `sessionId` |

## Is ACP Vendor-Specific?

No.

ACP is an external protocol for coding-agent clients and agents. The ACP docs
frame it as an interoperability layer between editors/IDEs and coding agents,
similar in spirit to LSP for language servers. OpenScout should treat ACP as a
protocol boundary, not as a dependency on any one framework.

The practical implication: OpenScout can implement `acp_stdio` directly against
ACP, using `@openscout/agent-sessions` as the shared adapter substrate.

## Transport Profile

```ts
export type RelayRuntimeTransport =
  | "claude_stream_json"
  | "codex_app_server"
  | "pi_rpc"
  | "tmux"
  | "cursor_exec"
  | "acp_stdio";

export interface AcpStdioRuntimeProfile {
  transport: "acp_stdio";
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  sessionId?: string;
  sessionMode?: "auto" | "new" | "resume" | "load";
  authMethodId?: string;
  additionalDirectories?: string[];
  mcpServers?: unknown[];
  readTextFile?: boolean;
  writeTextFile?: boolean;
  startupTimeoutMs?: number;
  requestTimeoutMs?: number;
  promptTimeoutMs?: number;
}
```

Profiles should live under existing harness profile config, for example:

```json
{
  "runtime": {
    "profiles": {
      "cursor": {
        "transport": "acp_stdio",
        "cwd": "/Users/art/dev/openscout",
        "sessionId": "openscout-cursor-acp",
        "launchArgs": []
      }
    }
  }
}
```

The exact executable command should be explicit per harness until discovery
solidifies. The adapter must not assume every harness has ACP today. It should
expose clear not-ready diagnostics when the configured command is absent or
does not complete the ACP handshake.

## State Model

For the user-facing agent vocabulary from
[SCO-036](./sco-036-agent-state-vocabulary.md), `acp_stdio` maps as:

| Adapter condition | Display state |
| --- | --- |
| command configured and handshake succeeds, no active prompt | `ready` |
| active `session/prompt` in progress | `working` |
| missing command, bad cwd, auth required with no method, handshake failure, incompatible protocol | `not_ready` |

`offline` and generic `available` should not be reintroduced for ACP endpoints.
When more detail is useful, attach a readiness reason:

```ts
type AcpReadinessReason =
  | "missing_command"
  | "bad_cwd"
  | "spawn_failed"
  | "handshake_failed"
  | "auth_required"
  | "unsupported_protocol_version"
  | "session_unavailable"
  | "permission_pending";
```

`permission_pending` is not a base state. It is `working` with an operator
attention item.

## Runtime Lifecycle

### Warmup

1. Resolve the profile command, cwd, and environment.
2. Spawn the process with stdio pipes.
3. Send `initialize` with client info and capabilities.
4. If `authMethodId` is configured, call `authenticate`.
5. Create or restore a session using `session/new`, `session/load`, or
   `session/resume`, depending on profile and advertised capabilities.
6. Register/update the local endpoint with:
   - `transport: "acp_stdio"`
   - `externalSessionId: <acp session id>`
   - protocol version
   - agent info
   - advertised capabilities

### Invocation

1. Build the normal Scout direct invocation prompt.
2. Send `session/prompt`.
3. Project `session/update` into observed session events and optional flight
   progress metadata.
4. Buffer final text for broker reply delivery.
5. On stop reason:
   - `end_turn` or equivalent terminal success -> complete flight
   - cancellation -> cancel or fail based on caller action
   - auth/protocol/process error -> fail with remediation

### Shutdown

1. If the agent advertises session close support, call `session/close`.
2. Reject pending requests.
3. Kill the process if still running.
4. Mark endpoint not resident, but keep profile configured.

## Workspace And Permission Policy

`acp_stdio` should default to conservative workspace mediation:

- `fs/read_text_file`: enabled for files under `cwd` and configured
  `additionalDirectories`.
- `fs/write_text_file`: disabled unless profile policy enables it.
- terminal capability: disabled in the first Scout runtime integration.
- permission requests: turned into Scout operator-attention records when they
  are actionable; otherwise default to deny with an explanatory adapter event.

This keeps the distinction clear:

- ACP is the harness protocol.
- Scout is the local policy and coordination authority.
- The broker does not become a filesystem proxy unless the runtime deliberately
  exposes that policy.

## Relationship To Existing Transports

`acp_stdio` should not delete concrete harness paths immediately.

| Existing transport | Relationship |
| --- | --- |
| `cursor_exec` | Keep as one-shot fallback and smoke path. Prefer `acp_stdio` when an ACP command is configured and working. |
| `codex_app_server` | Keep for app-server semantics. ACP may become an alternate profile when the harness exposes a stable ACP command. |
| `claude_stream_json` | Keep for direct stream JSON and host-specific behavior. ACP can be an alternate profile. |
| `pi_rpc` | Keep; ACP only applies if the harness or a wrapper offers an ACP server. |
| `tmux` | Legacy/dev fallback for interactive TUIs that lack a structured protocol. Do not route ACP through tmux. |

## Implementation Plan

1. Extend shared protocol/setup types with `acp_stdio`.
2. Add a local runtime wrapper around `createAcpAdapter` from
   `@openscout/agent-sessions`.
3. Teach `normalizeLocalAgentTransport` to select `acp_stdio` only when
   explicitly configured. Do not silently switch existing profiles to ACP.
4. Add endpoint lifecycle functions:
   - `ensureAcpStdioAgentOnline`
   - `isAcpStdioAgentAlive`
   - `invokeAcpStdioAgent`
   - `shutdownAcpStdioAgent`
5. Map adapter session events into the existing observed session/event stream.
6. Store ACP session id and protocol metadata in endpoint metadata, not as a
   Scout conversation id.
7. Add readiness diagnostics to `scout runtimes`, `scout ps`, and the agent
   configuration UI.
8. Add one fake ACP fixture executable test that exercises:
   - initialize
   - session/new
   - session/prompt
   - streamed text
   - terminal completion
9. Add one permission fixture test for `session/request_permission`.
10. Add one failure fixture test for missing command or unsupported protocol
    version.

## Migration Path

Phase 1 keeps the current defaults:

- profiles currently using `cursor_exec` keep that transport.
- app-server harnesses keep their existing app-server transport.
- direct stream harnesses keep their existing direct/tmux path.

Phase 2 allows explicit per-profile ACP:

```bash
scout up --harness <harness> --transport acp_stdio --command <acp-agent-command>
```

Phase 3 can promote ACP per harness after there is real local evidence that the
ACP command is installed, authenticated, and stable.

## Open Questions

- Which current harnesses expose stable ACP commands on this machine today?
- Should `acp_stdio` processes be per invocation, per endpoint, or per session
  by default? Lean: per endpoint/session, matching ACP's session model.
- Should OpenScout use the existing hand-rolled adapter or pull the official
  TypeScript ACP SDK as a dependency? Lean: keep the current adapter unless the
  SDK materially reduces maintenance or improves spec conformance.
- How should ACP model selection map into Scout harness profiles?
- Should ACP `mcpServers` be passed from Scout project config, from harness
  profile config, or both?
- Should file writes be broker-gated in v1, or adapter-mediated under cwd with
  an explicit write flag?

## Non-Goals

- Do not make OpenScout itself an ACP agent server in this SCO.
- Do not replace Scout broker messages with ACP session transcript material.
- Do not require all harnesses to speak ACP.
- Do not remove `cursor_exec`, `codex_app_server`, `claude_stream_json`,
  `pi_rpc`, or `tmux`.
- Do not claim remote ACP support until ACP remote transport support and Scout
  mesh semantics are both clearer.

## Acceptance Criteria

- A configured fake ACP executable can be warmed, invoked, and shut down through
  the local-agent runtime.
- `scout ask --project <repo> --harness <profile using acp_stdio>` completes
  with a broker-visible reply.
- A missing or incompatible ACP command produces `not_ready` with an actionable
  readiness reason.
- ACP session id is visible as external session metadata and is not treated as
  a Scout-owned conversation id.
- Permission requests create a Scout attention/unblock surface or are denied
  with a clear adapter event.
- No ACP transcript is bulk-imported as Scout messages.

## References

- [SCO-047: Transport Spike](./sco-047-cursor-transport-spike.md)
- [SCO-056: Managed Process Adapter Contract](./sco-056-managed-process-adapter-contract.md)
- [SCO-036: Agent State Vocabulary](./sco-036-agent-state-vocabulary.md)
- [Agent Client Protocol introduction](https://agentclientprotocol.com/get-started/introduction)
- [Agent Client Protocol schema](https://agentclientprotocol.com/protocol/v1/schema)
- `packages/agent-sessions/src/adapters/acp.ts`
- `packages/agent-sessions/src/adapters/acp/adapter.spec.json`
