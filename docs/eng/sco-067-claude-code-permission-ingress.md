# SCO-067: Claude Code Permission Ingress

## Status

Proposed.

## Proposal ID

`sco-067`

## Intent

Make Claude Code permission prompts visible to OpenScout as durable operator
attention without reviving Scout's deprecated `PreToolUse` permission router.

The goal is narrow:

- detect that Claude Code is waiting for user permission
- capture structured prompt details when Claude exposes them
- notify the operator without over-notifying
- preserve Claude Code's native approval UI unless OpenScout has an explicit,
  safe control path

## Context

The current failure mode is easy to reproduce: a Claude Code session in tmux can
be visibly waiting on a permission prompt, while `scout tail` and transcript
search only expose surrounding metadata such as `permission-mode`. That metadata
is useful evidence, but it does not mean a permission prompt is currently
pending.

OpenScout already has the right durable target: broker-owned
`unblock_request` records with `kind: "permission"`. The missing piece is a
Claude Code host ingress that converts native permission prompt events into
those records.

OpenScout also has history here. The old Scout `PreToolUse` hook tried to act as
a permission-routing gate and has since been removed by
`packages/runtime/bin/migrate-remove-permission-hook.mjs`. This proposal does
not bring that pattern back.

Claude Code currently exposes several relevant primitives:

- `PermissionRequest` hook: fires when a permission dialog appears and includes
  structured fields such as `session_id`, `transcript_path`, `cwd`,
  `permission_mode`, `tool_name`, and `tool_input`.
- `Notification` hook with matcher `permission_prompt`: fires when Claude Code
  sends a permission notification, but carries less structured detail.
- `PostToolUse`, `PostToolUseFailure`, `PermissionDenied`, `Stop`, and
  `SessionEnd`: useful as best-effort lifecycle and cleanup signals, not as
  primary prompt detection.
- `--include-hook-events`: useful for Scout-managed `stream-json` sessions as
  secondary evidence.
- `--permission-prompt-tool`: useful for non-interactive permission handling,
  but it makes another tool part of the approval path and is not the right V1
  primitive for passive interactive-session attention.

References:

- Claude Code hooks reference:
  <https://code.claude.com/docs/en/hooks>
- Claude Code CLI reference:
  <https://code.claude.com/docs/en/cli-reference>
- OpenScout operator attention model:
  `docs/operator-attention-and-unblock.md`
- OpenScout agent integration boundary:
  `docs/agent-integration-contract.md`

## Decision

OpenScout SHOULD add a Claude Code host permission ingress built around
`PermissionRequest` and `Notification(permission_prompt)` hooks.

The ingress SHOULD write broker-owned `unblock_request` records. It SHOULD NOT
write harness transcripts into Scout as first-party messages, and it SHOULD NOT
mutate Claude Code project settings from ordinary adapter runtime code.

### Evidence Tiers

Use evidence in this order:

| Tier | Source | Purpose | Confidence |
|---|---|---|---|
| A | `PermissionRequest` hook | Create or update the durable permission unblock request | High |
| B | `Notification(permission_prompt)` hook | Notify or create a low-detail fallback if tier A does not arrive | Medium |
| C | `--include-hook-events` stream output | Improve Scout-managed session traces | Medium |
| D | transcript/tmux/process observation | Diagnostic evidence and stalled-session inference | Low |

Only tier A SHOULD be the normal source for structured permission details.
Tier B is a backup notification signal. Tier D must remain an observed or
inferred status, not an authoritative permission record by itself.

### Hook Behavior

The `PermissionRequest` hook SHOULD be observer-only in V1:

- read the hook JSON from stdin
- forward a compact ingress event to OpenScout
- return no decision
- exit zero

It SHOULD NOT return `hookSpecificOutput.decision.behavior` in V1. Claude Code
supports hook-driven allow and deny decisions, but OpenScout should not expose
approve or deny buttons until it can guarantee that the action is delivered to
the live Claude Code permission prompt and that failure modes are clear.

The hook SHOULD be configured as a command hook with a short timeout. If Claude
Code's async hook mode is available for the installed version, observer-only
permission and notification hooks SHOULD run async so Claude's native prompt is
not delayed by broker availability.

The `Notification` hook SHOULD match `permission_prompt`. It SHOULD send a
lower-detail event and SHOULD NOT create repeated push notifications when a
matching `PermissionRequest` record is already open.

### Minimal Hook Shape

The setup artifact can be a Claude Code plugin or an explicit user-level hooks
entry. A plugin is preferable because Claude Code can show it as a plugin source
in `/hooks`, and it is easier to remove without touching project files.

Minimal V1 shape:

```json
{
  "description": "Forward Claude Code permission prompts to OpenScout",
  "hooks": {
    "PermissionRequest": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "scout host claude-permission ingest --event permission_request",
            "timeout": 1,
            "async": true
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "permission_prompt",
        "hooks": [
          {
            "type": "command",
            "command": "scout host claude-permission ingest --event permission_notification",
            "timeout": 1,
            "async": true
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "scout host claude-permission ingest --event session_end",
            "timeout": 1,
            "async": true
          }
        ]
      }
    ]
  }
}
```

This is illustrative. The final hook command name can change, but the contract
should remain: stdin JSON in, no Claude decision out, fast success even when the
broker is unavailable.

`PostToolUse`, `PostToolUseFailure`, `PermissionDenied`, and `Stop` can be added
as optional cleanup evidence after the minimal ingress is working. They should
not be required for V1 prompt detection because wildcard post-tool hooks run on
ordinary tool calls too. If added, they should only update already-open Claude
permission records or feed the stale sweeper; they should not create operator
notifications by themselves.

## Ingress Helper

Add a small host helper instead of putting broker logic directly in hook JSON:

```text
scout host claude-permission ingest --event <event-name>
```

Responsibilities:

1. Read Claude Code hook JSON from stdin.
2. Normalize it into a `ClaudeCodePermissionIngressEvent`.
3. Classify severity and notification intent.
4. Upsert or update an `unblock_request` through the local broker HTTP API.
5. Append an unblock request event when the state changes.
6. If the broker is unavailable, append the ingress event to a local spool and
   exit zero.

The helper must be hook-safe:

- no interactive prompts
- no dependency on `/dev/tty`
- no long network waits
- no model calls
- no project file writes
- bounded input size
- deterministic redaction for secrets and very large command text

Suggested spool path:

```text
~/Library/Application Support/OpenScout/host-ingress/claude-code-permissions.jsonl
```

The broker or desktop app can drain this spool later. Spooling is a reliability
fallback, not a second source of truth.

## Event Shape

The helper SHOULD normalize raw Claude hook payloads into a host-ingress event:

```ts
export type ClaudeCodePermissionIngressKind =
  | "permission_request"
  | "permission_notification"
  | "tool_succeeded"
  | "tool_failed"
  | "permission_denied"
  | "stop"
  | "session_end";

export interface ClaudeCodePermissionIngressEvent {
  schemaVersion: 1;
  provider: "claude-code";
  event: ClaudeCodePermissionIngressKind;
  observedAt: number;
  sessionId: string;
  transcriptPath?: string;
  transcriptSize?: number;
  cwd?: string;
  permissionMode?: string;
  toolName?: string;
  toolInput?: unknown;
  notificationType?: string;
  title?: string;
  message?: string;
  promptFingerprint: string;
  rawHookEventName?: string;
}
```

Claude Code's current `PermissionRequest` input does not expose a stable
`tool_use_id`. The helper therefore needs a prompt fingerprint. The fingerprint
SHOULD hash:

- `session_id`
- `transcript_path`
- transcript file size at hook time, when available
- `cwd`
- `tool_name`
- canonicalized `tool_input`
- normalized notification message, for notification-only fallback records

If transcript file size cannot be read, the helper may include a short observed
time bucket in the fingerprint and mark the record as lower confidence.

## Unblock Mapping

The tier A event maps to an existing `UnblockRequestRecord`:

```ts
const request = {
  kind: "permission",
  state: "open",
  source: "host",
  sourceRef: `claude-code:${event.sessionId}:${event.promptFingerprint}`,
  sourceLabel: "Claude Code permission",
  title: "Claude Code needs permission",
  summary: summarizePermission(event),
  detail: redactAndFormatToolInput(event.toolInput),
  ownerId: "operator",
  createdById: "scout-host",
  severity: classifySeverity(event),
  actions: [
    {
      kind: "open",
      label: "Open Claude session",
      route: { view: "session", provider: "claude-code", sessionId: event.sessionId }
    },
    { kind: "dismiss", label: "Dismiss" }
  ],
  metadata: {
    provider: "claude-code",
    confidence: "high",
    cwd: event.cwd,
    transcriptPath: event.transcriptPath,
    permissionMode: event.permissionMode,
    toolName: event.toolName,
    promptFingerprint: event.promptFingerprint
  }
};
```

V1 SHOULD NOT include `approve` or `deny` actions for Claude Code permissions.
The correct V1 operator action is to open the native Claude session and answer
the Claude Code prompt there.

## Notification Policy

The notification router SHOULD derive delivery from severity plus attention
intent:

| Severity | Examples | Default delivery |
|---|---|---|
| `critical` | destructive file commands, broad `rm`, `git reset`, `git clean`, credential/keychain access, `kill`, production deploy/release, out-of-workspace writes | web banner, desktop/mobile urgent if enabled |
| `warning` | package install, external network command, Git write operation, unknown state-changing shell command | web banner, mobile badge or push depending on mode |
| `info` | known safe read/build/test command that still triggered Claude permission | feed or badge only |

Notification rules:

1. A `PermissionRequest` creates or updates one open unblock request.
2. A `Notification(permission_prompt)` updates that request if a matching tier A
   record exists.
3. If only a notification arrives, wait a short grace window, then create a
   lower-confidence unblock request if no tier A record appears.
4. Notify once per open `sourceRef`, then rely on record updates until
   `repeatAfterMinutes` from the operator policy.
5. Push relay payloads must contain opaque IDs only. Do not put command text,
   file paths, prompt text, or tool input into APNs payloads.

This keeps `rm`-class prompts visible without training the user to ignore every
ordinary permission notification.

## Lifecycle

Expected flow:

1. Claude Code reaches a native permission prompt.
2. `PermissionRequest` hook fires with structured prompt details.
3. The Scout hook helper forwards or spools the event and exits.
4. The broker upserts an open `unblock_request`.
5. The operator attention surface renders the item and routes notifications.
6. The user opens the Claude session and answers the native prompt.
7. A later lifecycle signal resolves or updates the request when possible.
8. A stale sweep expires any still-open prompt that has no confirming evidence
   after its TTL.

Resolution is best-effort because Claude Code does not guarantee that every
permission prompt will produce a uniquely matchable terminal event. The sweeper
is therefore required.

Suggested defaults:

- open permission TTL: 30 minutes
- notification-only grace window: 1 to 2 seconds
- repeated critical notification: no more than once every 10 minutes
- repeated warning notification: no more than once every 30 minutes
- notification-only records: expire sooner than structured records unless
  refreshed by another signal

## Scout-Managed Claude Sessions

For Scout-managed non-interactive Claude Code sessions that already use
`--output-format stream-json`, the adapter SHOULD add `--include-hook-events`
where supported. Those hook lifecycle events should improve trace visibility but
should not replace the host ingress:

- interactive tmux sessions still need the hook/helper path
- stream events are observed evidence, not broker-owned unblock records
- `--permission-prompt-tool` should remain a separate future design for
  explicitly Scout-controlled non-interactive approval flows

## Setup Boundary

Ordinary Claude Code adapters MUST NOT write `.claude` project settings or
Claude plugin state while starting or observing sessions.

OpenScout MAY provide an explicit setup command, for example:

```text
scout setup claude-permission-ingress
```

That command may install or update a user-approved Claude Code plugin or
user-level hook entry. It must be reversible and must show the exact files it
will write before applying changes.

Project-level setup is allowed only when the operator explicitly requests it
for that project. It should never be an implicit side effect of viewing or
routing a Claude Code session.

## Non-Goals

- no `PreToolUse` permission router
- no automatic approve or deny in V1
- no hook that waits on the broker before Claude can show the native prompt
- no tmux-first parser as the product primitive
- no bulk import of Claude Code transcripts into Scout messages
- no adapter runtime writes to `.claude` project files
- no claim that prompts are captured when hooks are disabled, blocked by policy,
  absent from the installed Claude Code version, or bypassed by session mode

## Open Questions

1. Should V1 setup prefer a Claude Code plugin, a user-level settings hook, or
   both?
2. What final CLI namespace should the hook helper use?
3. Should risk classification be hard-coded initially or driven by an operator
   profile?
4. Should V2 expose remote approve/deny through `PermissionRequest` decisions,
   or should OpenScout keep Claude Code approvals native-only?
5. What is the right UI distinction between high-confidence hook records and
   low-confidence tmux/transcript stalled-state inference?

## Implementation Slices

1. Add the hook-safe ingress helper and spool fallback.
2. Add tests for event normalization, fingerprinting, severity classification,
   redaction, and broker-unavailable behavior.
3. Map normalized events to existing broker `unblock_request` records and
   events.
4. Add the explicit setup command or plugin artifact for Claude Code.
5. Add notification-router rules for Claude Code permission records.
6. Add lifecycle cleanup and stale sweeping.
7. Add optional `--include-hook-events` support for Scout-managed Claude Code
   `stream-json` sessions.
