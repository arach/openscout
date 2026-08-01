---
name: delegate-and-monitor
description: Delegate work through Scout or host-native collaboration, preserve the returned lifecycle handles, and conditionally create a tiny read-only watcher for exception-only monitoring. Use for requests such as "delegate this and watch it," "hand this off and monitor it," "create a tiny agent to babysit this," or "follow this flight until it finishes."
---

# Delegate and Monitor

Delegate first. Prefer native lifecycle waiting or notification. Create a
separate watcher only when it adds value that the native mechanism does not.
Call the small monitoring agent a **watcher**, **sentinel**, or **monitor**.
Reserve **Scout** for the OpenScout product, CLI, broker, invocations, flights,
refs, and sessions.

## 1. Choose the coordination verb

- Use **send** for a tell, constraint, correction, or status update when no
  ownership or reply is expected.
- Use **ask** for delegated work, investigation, review, or any request that
  means "do this and get back to me."
- Route fresh capability work by project plus optional harness. Do not guess
  identities such as `claude.main`.
- Continue related work with a returned `ref`, `flightId`, `conversationId`,
  `workId`, situated target, or `session:<id>`. Use an exact session only when
  preserving that concrete harness context is intentional.

## 2. Choose the reply mode

| Mode | Choose when |
| --- | --- |
| `inline` | The acknowledgement or answer should be quick and the caller must receive it before continuing. |
| `notify` | Work may run longer; return promptly and let the native completion callback notify the caller. |
| `none` / `--no-wait` | The caller explicitly wants detached launch, or another reliable lifecycle observer is already responsible. |

Do not add a watcher to a quick synchronous ask. Do not add one when `notify`,
`invocations_wait`, `scout wait`, or a host-native wait already fully satisfies
the user's intent.

## 3. Delegate and retain the receipt

Keep the complete receipt, not just the human-readable result. Capture, when
present:

- invocation id and flight id
- short `ref`
- conversation id and message id
- target agent and target session id
- work id
- project path and requested harness

Treat the broker-returned route as authoritative. Use those handles for
inspection, continuation, cancellation, and the final handoff.

### Scout CLI

```bash
# Tell only; no lifecycle ownership.
scout send --to "$TARGET" "Constraint: keep the public API unchanged."

# Fresh capability-routed work.
scout --json ask \
  --project "$PROJECT" \
  --harness "$HARNESS" \
  --reply-mode notify \
  --prompt-file "$PROMPT_FILE"

# Exact continuity after a prior receipt.
scout --json ask --ref "$REF" --reply-mode inline \
  "Apply the requested revision and report the checks."

# Bounded observation by invocation, flight, message, or ref.
scout --json wait "$HANDLE" --timeout 45
scout --json flight get "$FLIGHT_ID"
```

Use `--reply-mode none` or `--no-wait` only with an explicit detached-work
decision. Prefer `notify` for ordinary long work; it usually eliminates the
need for a watcher.

### Scout MCP

Use the installed tool schemas rather than assuming field names:

```text
ask({ projectPath, harness, replyMode: "notify", ... })
invocations_get({ invocationId or flightId, ... })
invocations_wait({ invocationId or flightId, timeoutSeconds: 45, ... })
```

An ask creates the invocation and flight. The `invocations_*` calls only observe
them. Preserve every handle returned by `ask`.

### Codex collaboration subagents

```text
worker = spawn_agent(
  task_name=<short stable name>,
  message=<bounded delegated work>,
  fork_turns=<only needed context>
)
retain worker id and canonical task name

# Default: monitor directly.
wait_agent(timeout_ms=45000)
list_agents() only when a state snapshot is needed
```

Use `followup_task` to steer the existing worker rather than spawning a
replacement for related work. A collaboration watcher is exceptional: use it
only when the parent must continue other useful work and the host lacks an
equivalent exception-only notification. Give it `fork_turns="none"` (or the
smallest supported fork), the cheapest model that can reliably parse lifecycle
state, and only the worker id/task name, project, timing policy, and report
route. A concrete host-native shape is
`spawn_agent(task_name="watcher", message=<parameterized watcher prompt>,
fork_turns="none", model=<cheapest capable model>)`; omit `model` when the host
does not expose an explicit low-cost choice. Do not copy the delegated task body
unless needed to recognize a real attention request.

## 4. Decide whether a watcher is justified

Create a watcher only when all are true:

1. The delegated work is expected to outlive a convenient synchronous wait.
2. The user asked for monitoring, or unattended delay has a material cost.
3. A stable observable handle exists.
4. Native wait/notification does not already deliver the required behavior.
5. A free agent/runtime slot exists and the watcher costs less than keeping the
   main agent blocked.

Do not create one to decorate ordinary delegation, duplicate a native
notification, or poll work with no actionable outcome.

Choose the smallest capable model/runtime. Make the watcher read-only. Deny it
editing, implementation, tests, task steering, retries, replacement delegation,
or interpretation of ordinary silence as failure.

For example, completion-only monitoring with `replyMode: "notify"` needs no
watcher. A long task whose user explicitly requests evidence-based stall
detection may justify one because completion notification alone cannot detect
that exception.

## 5. Run an exception-only monitoring loop

Give every wait a timeout below 60 seconds; prefer 45 seconds. After each wait:

1. Normalize the state into a fingerprint such as
   `state|updatedAt|attentionKind|result/error`.
2. If unchanged, emit nothing and wait again.
3. Report only:
   - terminal completion, failure, cancellation, or expiry;
   - a real permission, approval, credential, or operator-input request;
   - a meaningful blocker with a named next-move owner;
   - suspicious stalling supported by evidence.
4. Treat stalling as suspicious only after the configured silence threshold and
   multiple unchanged windows. Distinguish "still running" from "no evidence of
   progress."
5. At a watcher terminal state, emit the lifecycle completion note defined
   below, then exit. If the parent observes the worker terminal state first,
   tell the watcher to close as `superseded`; do not leave it polling.

Never paste raw transcripts as status. Report a compact state, the relevant
handle, the evidence timestamp, and the one required action. Do not surface
routine progress or repeated copies of the same blocker.

### Close the watcher lifecycle explicitly

Treat watcher completion as a separate event from the worker result. Before
every watcher exit, send one parent-facing terminal note that includes all of:

- `Watcher: done/stopped`
- exactly one terminal reason: `completed`, `blocked`, `cancelled`, `timed out`,
  or `superseded`
- the final observed worker state and observation timestamp
- `Further polling: none`

Map successful worker completion to `completed`; worker failure or an
unresolvable blocker to `blocked`; cancellation to `cancelled`; worker expiry or
exhausted monitoring budget to `timed out`; and monitoring taken over elsewhere
to `superseded`.

Use `timed out` only when the overall monitoring budget expires, not when a
single bounded wait returns unchanged. Use `superseded` when native notification
or the parent has already taken over or reported the terminal observation. This
note must be explicit even if the worker result was already forwarded.

After emitting the note, terminate the watcher and verify it is no longer
running. Never let it remain silently alive. If the watcher crashes or cannot
emit its own note, the parent must stop it and emit the equivalent terminal note
with reason `blocked` and the last known worker state.

## Reusable watcher prompt

Substitute the parameters and omit unavailable optional handles:

```text
You are a tiny read-only watcher, not the delegated worker and not Scout.

Observe only:
- INVOCATION: {{invocation_id}}
- FLIGHT: {{flight_id}}
- REF: {{ref}}
- WORKER: {{worker_id_or_task_name}}
- PROJECT: {{project_path}}
- SESSION: {{session_id}}

Report to: {{report_target}}
Expected duration: {{expected_duration}}
Suspicious-silence threshold: {{stall_threshold}}

Use the surface's native lifecycle read/wait operation. Wait in bounded
intervals of {{wait_seconds}} seconds, where wait_seconds is less than 60
(prefer 45). Keep the last normalized state fingerprint and suppress unchanged
results.

You are read-only. Do not edit files, run implementation or validation, steer
or retry the worker, spawn replacements, duplicate the delegated task, or claim
ownership of it.

Surface only:
1. a terminal result;
2. a real permission, approval, credential, or human-input request;
3. a meaningful blocker with the next-move owner;
4. suspicious stalling after the configured threshold and multiple unchanged
   windows.

For an exception, send one compact report with handle, state, timestamp,
evidence, and required action. Do not repeat it unless the fingerprint changes.

Before every exit, emit a separate parent-facing watcher lifecycle note in this
exact shape:

  Watcher: done/stopped
  Terminal reason: {{completed|blocked|cancelled|timed out|superseded}}
  Final observed worker state: {{state plus observation timestamp}}
  Further polling: none

Choose exactly one terminal reason. A single bounded wait timing out is not a
watcher terminal timeout. Use `superseded` if the parent or native notification
has already taken over the final observation. On completion, failure,
cancellation, expiry, exhausted monitoring budget, supersession, or loss of the
observation handle, emit the appropriate note, then terminate yourself. Do not
forward a worker result and remain alive.
```

## 6. Return the handoff

Report the delegated target, selected mode, preserved handles, whether a watcher
was created and why, and the terminal result or current owner. When a watcher
was created, include its explicit lifecycle completion note and confirm its
process/subagent is stopped. Do not imply that watcher creation itself makes
delivery reliable; the Scout broker or host-native collaboration lifecycle
remains the source of truth.
