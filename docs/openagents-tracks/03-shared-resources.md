# Shared Resources Track

## Purpose

This track defines how OpenScout should model broker-owned resources that multiple agents and humans can safely share over time. The goal is to move browser sessions, persistent contexts, files, notes, and later credential handles out of harness-specific state and into durable runtime records owned by the local broker.

This is a local-first OpenScout track. The broker is the source of truth. Surfaces can project state, but they should not invent resource ownership or lifecycle rules on their own.

## Goals

- Make shared resources first-class broker objects with stable IDs, ownership, permissions, and lifecycle state.
- Support browser sessions that can survive shell restarts and be reopened from a persistent context.
- Support shared files and artifacts as durable broker records, not just files on disk.
- Add a lightweight notes layer for operator and agent collaboration without forcing a full document system.
- Reserve a clean path for future credential handles and other sensitive broker-managed resources.
- Keep the implementation aligned with the existing local broker/runtime model in `packages/runtime` and the shell/helper split in `docs/ARCHITECTURE.md`.

## Non-Goals

- Do not build a generic remote asset manager.
- Do not make the shell or harness the owner of resource state.
- Do not turn every file on disk into a broker resource.
- Do not solve collaborative editing or full document CRDT semantics in this track.
- Do not add cross-machine syncing before the local broker model is stable.

## Proposed Resource Model

The broker should own one normalized `resources` concept, with typed records underneath it.

### Core Fields

- `id`: stable unique ID
- `kind`: `browser_session`, `browser_context`, `file`, `artifact`, `note`, `credential_handle`
- `title`: human-readable label
- `owner_id`: actor or agent that created or owns the resource
- `workspace_id`: current broker/workspace scope
- `state`: lifecycle state
- `visibility`: `private`, `workspace`, `shared`, `restricted`
- `access_policy`: explicit access rule set
- `created_at`, `updated_at`, `last_used_at`
- `metadata`: JSON for type-specific details

### Type-Specific Payloads

- Browser session: `session_id`, `browser_provider`, `live_url`, `context_id`, `tab_ids`
- Browser context: `origin`, `domain`, `cookie_scope`, `storage_scope`, `bb_context_id` or equivalent backend handle
- File/artifact: `mime_type`, `size_bytes`, `sha256`, `storage_key`, `source_message_id`, `source_invocation_id`
- Note: `body`, `markdown`, `linked_record_id`, `pinned`
- Credential handle: `provider`, `secret_ref`, `scope`, `rotation_state`, `redacted_preview`

### Suggested State Machine

- `creating`
- `active`
- `idle`
- `expired`
- `closed`
- `archived`
- `revoked` for sensitive handles

The important rule is that state transitions are broker-owned and observable. A browser tab closing or a shell exiting should not implicitly delete the record.

## Lifecycle And Ownership

### Browser Sessions

- A browser session is created when an agent or human opens a shared browser surface through the broker.
- A browser session may reference a persistent browser context, but the context must be separate from the live session.
- Closing the last visible tab should not necessarily destroy the persistent context.
- If the browser backend dies or the shell restarts, the broker should be able to reopen the session from the durable context.
- Session usage should be tracked separately from session existence so billing, auditing, and cleanup can be added later.

### Persistent Browser Contexts

- Contexts are the durable login/storage boundary.
- Contexts are named and workspace-scoped.
- A context should be reattachable by any authorized actor, but only if policy allows it.
- Duplicate context names should be rejected or require explicit replacement semantics.

### Files And Artifacts

- Shared files are immutable broker records once published.
- If a user or agent wants a new version, create a new artifact record and link it to the prior version.
- The broker should preserve source provenance: who uploaded it, from which message or work item, and under what resource scope.
- Long-term storage can live in the support directory or object storage later, but the broker record stays canonical.

### Notes

- Notes are lightweight broker records attached to work, browser resources, or workspace scope.
- Notes should support pinning, linking, and search, but not full freeform document editing in v1.
- A note can summarize a browser context, a debugging session, or a decision trail.

### Credential Handles

- Credential handles should never expose raw secret material to the shell surface.
- They should point to a secret reference or secure local store entry.
- The broker may surface status and ownership, but only the owning actor or an explicitly authorized actor should be able to rebind or revoke them.
- This track should define the placeholder schema now so credential support can be added later without changing the resource model.

## Access Rules

- The broker is the only writer for resource state.
- A resource has exactly one canonical owner, even if many actors can view it.
- Visibility should be explicit and default to the least permissive reasonable scope.
- A resource may be shared by policy, but sharing must be represented as data, not inferred from a UI list.
- Read access should be cheap and broad enough for the shell to render inventory.
- Write access should be narrow and enforced in the broker, not in the client.

### Practical Policy Rules

- The creator owns the initial resource unless the broker assigns ownership through workflow.
- Workspace members can read workspace-visible resources unless the resource kind is restricted.
- Sensitive handles are never broadcast in full; only metadata and access status may be shown.
- The broker should preserve an audit trail of share, revoke, reopen, and archive actions.

## Runtime And Schema Direction

The current runtime schema in `packages/runtime/src/schema.ts` already has the right shape to extend:

- `conversations`
- `messages`
- `invocations`
- `flights`
- `bindings`
- `deliveries`
- `collaboration_records`
- `events`

This track should add a resource layer adjacent to those records, not replace them.

### Suggested Tables

- `resources`
- `resource_events`
- `resource_acl_entries`
- `browser_sessions`
- `browser_contexts`
- `resource_versions`

### Suggested Normalization

- `resources` stores the stable identity and lifecycle.
- `browser_sessions` stores live-session fields and backend handles.
- `browser_contexts` stores persistent login/storage contexts.
- `resource_versions` links artifacts and notes over time.
- `resource_acl_entries` records explicit sharing and revocation.

The broker should expose resource records through the same local API surface that already serves conversations and work items.

## CLI Implications

The CLI should make resource ownership visible without forcing users into the desktop shell.

Recommended commands:

- `scout resources list`
- `scout resources open <id>`
- `scout resources share <id> --with <agent-or-actor>`
- `scout resources revoke <id> --from <agent-or-actor>`
- `scout resources archive <id>`
- `scout resources notes add <id>`
- `scout browser contexts list`
- `scout browser contexts reopen <name>`

The first pass should prioritize read and inspect commands over mutation commands. If a resource can be opened or reused, the CLI should show the path to do that quickly.

## UI Implications

### Native Shell

- The sidebar should surface a resource inventory summary, not just agent status.
- Browser contexts should be visible as reusable operational assets, not hidden implementation details.
- Shared files and artifacts should be searchable and filterable by kind, owner, and recency.
- Notes should appear as attached context on work items, browser contexts, and files.

### Electron Or Web Surfaces

- Surface the current state of shared browser sessions and persistent contexts.
- Show whether a resource is active, idle, expired, or revoked.
- Make ownership and sharing clear enough that the user can trust what will persist across restarts.

### Operator Experience

- The UI should answer: what do I have, who owns it, who can see it, and can I reuse it?
- Resource creation should be an explicit action, not a side effect of opening a tool.
- If a browser context is reused, the user should see that it is the same context, not a fresh anonymous tab.

## Rollout Phases

### Phase 1

- Add read-only broker inventory for resources.
- Add resource IDs and metadata plumbing.
- Model browser contexts separately from browser sessions.
- Render resource inventory in the shell.

### Phase 2

- Add create/share/revoke flows for browser contexts and shared files.
- Attach provenance to artifacts and notes.
- Add cleanup and expiration policies for idle browser sessions.

### Phase 3

- Add credential handle records and redacted status views.
- Add versioned artifacts and richer notes linking.
- Add broker-level auditing for access changes.

## Testing And Verification

- Verify resource records survive broker restarts.
- Verify a persistent browser context can be reopened after the shell is closed.
- Verify revocation removes access without deleting canonical history.
- Verify shared files and notes preserve provenance and ownership.
- Verify the shell renders a consistent inventory from broker state alone.
- Add regression tests for duplicate context naming, stale session recovery, and revoked access.

## Risks

- Browser backend semantics may differ between local and remote implementations, so the resource model must stay backend-agnostic.
- If ownership is not explicit, shared resources will become ambiguous and hard to clean up.
- If files and artifacts are conflated, versioning will become brittle.
- If notes become a document editor too early, the track will sprawl.
- Credential handles can leak sensitive data if the redaction boundary is not enforced in the broker.

## Open Questions

- Should browser contexts live in the same broker database as collaboration records, or in a dedicated resource store with foreign keys back to the core tables?
- What is the minimum access policy language needed for v1: owner-only, workspace-visible, or named grants?
- Should shared files be immutable by default, or can certain artifact kinds be updated in place?
- How much of the notes model should be attached to collaboration records versus separate resource records?
- Should credential handles be designed around local OS keychain primitives from the start, or abstracted behind a broker secret reference first?

## Implementation Guidance

The root architectural rule is simple: shared resources should feel like durable broker records with a UI, not like tool output that happened to persist somewhere.

If a user can reopen it, share it, revoke it, or inspect it later, it belongs in the broker model.

