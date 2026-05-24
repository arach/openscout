# SCO-044: Operator Attention Policy And Progress Monitoring

## Status

Proposed.

## Proposal ID

`sco-044`

## Intent

Define a user-configurable operator attention policy for long-running work.

The goal is to let operators monitor and steer parallel agent work without
opening every session, interrupting active turns, or turning every useful update
into a blocking approval.

## Context

OpenScout already has broker-visible work, invocations, flights, session
attention, mobile inbox items, and push notification plumbing. These pieces can
surface blocked work, approvals, failed actions, and session errors.

Longer runs need a broader attention model. During a large audit, release
preparation run, migration, or multi-agent investigation, the operator often
wants periodic situational awareness:

- which agents are active
- what phase each stream of work is in
- what decisions were made by default
- which findings or reports have landed
- where input would be useful but is not required
- which items truly need an answer before work can continue

The operator may also be away from the main workstation and want a mobile-first
monitoring mode. The policy should support that without making agents wait at
every checkpoint.

## Decision

OpenScout SHOULD model operator attention as intent plus delivery policy.

The work state says what is happening. The attention intent says what the
operator is being invited to do. The operator policy decides where and how that
intent is delivered.

## Attention Intents

| Intent | Meaning | Default next mover |
|---|---|---|
| `fyi` | Progress or context only. No response expected. | Current worker |
| `consult` | Feedback is welcome. Work continues with a stated default. | Current worker |
| `steer` | Operator input may change direction. Work continues unless redirected. | Current worker |
| `unblock` | Work cannot responsibly continue without operator input. | Operator |

Only `unblock` should transfer the next move to the operator. `fyi`, `consult`,
and `steer` are monitoring and steering signals, not blocking states.

## Operator Policy

The operator card or profile SHOULD include an attention policy.

```ts
export type ScoutAttentionIntent = "fyi" | "consult" | "steer" | "unblock";
export type ScoutAttentionSurface = "web" | "desktop" | "mobile" | "digest";
export type ScoutAttentionDelivery = "off" | "feed" | "badge" | "banner" | "push" | "urgent";

export interface ScoutOperatorAttentionPolicy {
  version: 1;
  defaultMode: string;
  modes: Record<string, ScoutOperatorAttentionMode>;
}

export interface ScoutOperatorAttentionMode {
  id: string;
  displayName: string;
  intents: Record<ScoutAttentionIntent, ScoutAttentionIntentPolicy>;
  quietHours?: ScoutQuietHoursPolicy;
}

export interface ScoutAttentionIntentPolicy {
  delivery: Partial<Record<ScoutAttentionSurface, ScoutAttentionDelivery>>;
  digestIntervalMinutes?: number;
  repeatAfterMinutes?: number;
  defaultOnSilence: "continue" | "stop" | "wait";
}
```

The policy is user-configurable. "Operator" is an identity and return address,
but the human behind that identity owns the delivery preferences.

## Suggested Default Modes

### Normal

| Intent | Web | Mobile | Default on silence |
|---|---|---|---|
| `fyi` | feed | off | continue |
| `consult` | feed | badge | continue |
| `steer` | banner | push | continue |
| `unblock` | banner | urgent | wait |

### Run Mode

Run mode is for cases where the operator is away from the workstation but still
wants periodic awareness.

| Intent | Web | Mobile | Digest | Default on silence |
|---|---|---|---|---|
| `fyi` | feed | off | 15 minutes | continue |
| `consult` | feed | badge | 15 minutes | continue |
| `steer` | banner | push | 10 minutes | continue |
| `unblock` | banner | urgent | off | wait |

This mode supports a long run, walk, commute, or other period where the operator
wants progress summaries without dipping into individual sessions.

### Audit Mode

Audit mode is for many parallel agents working on one high-level goal.

| Intent | Web | Mobile | Digest | Default on silence |
|---|---|---|---|---|
| `fyi` | feed | off | 10 minutes | continue |
| `consult` | feed | badge | 10 minutes | continue |
| `steer` | banner | push | 5 minutes | continue |
| `unblock` | banner | urgent | off | wait |

Audit mode should favor structured rollups over raw message volume.

## Event Shape

An operator attention event SHOULD carry a stable intent and enough routing
metadata for the broker and surfaces to make consistent decisions.

```ts
export interface ScoutOperatorAttentionEvent {
  id: ScoutId;
  intent: ScoutAttentionIntent;
  title: string;
  summary: string;
  subject: {
    kind: "session" | "invocation" | "flight" | "work_item" | "message" | "unblock_request";
    id: ScoutId;
  };
  ownerId: ScoutId;
  nextMoveOwnerId?: ScoutId;
  defaultAction?: {
    label: string;
    executeAfterMs?: number;
  };
  progress?: ScoutProgressSnapshot;
  createdAt: number;
  updatedAt: number;
}
```

For `consult` and `steer`, `defaultAction` is important. It tells the operator
what happens if they do nothing.

## Progress Snapshots

Long-running work SHOULD emit structured progress snapshots in addition to
ordinary messages.

```ts
export interface ScoutProgressSnapshot {
  phase?: string;
  percent?: number;
  completedSteps?: number;
  totalSteps?: number;
  checkpoint?: string;
  latestFinding?: string;
  latestArtifactId?: ScoutId;
  nextCheckpoint?: string;
  nextCheckpointAt?: number;
}
```

These snapshots should be compact enough for mobile notifications and rich
enough for web rollups.

## Surface Behavior

### Web

The web surface should provide:

- attention policy settings in the operator settings surface
- an attention feed that separates FYI, consult, steer, and unblock items
- multi-agent run rollups for active audits and releases
- banners only when the active policy asks for them
- clear default-on-silence text for consult and steer items

### Mobile App

The mobile app should provide:

- attention policy settings for mobile delivery
- a run mode toggle or preset
- inbox display for consult, steer, and unblock items
- digest summaries for FYI and consult items when configured
- urgent push for unblock items when allowed by policy and system permissions

### Desktop

Desktop notifications should follow the same policy once desktop notification
sinks are implemented. Until then, the web surface is the primary desktop
operator surface.

## Routing Rules

1. The broker remains the canonical writer for Scout-owned attention records.
2. Runtime and harness adapters may project candidate attention events.
3. The notification router resolves candidate event plus operator policy into
   surface delivery.
4. `fyi`, `consult`, and `steer` must not set the operator as next mover unless
   the work is also actually waiting.
5. `unblock` must create or reference a durable unblock request or equivalent
   waiting record.
6. Push payloads should remain opaque and point back to broker-owned records.
7. Quiet hours and per-surface settings should be applied before sending push
   or desktop notifications.

## Relationship To Existing Work

This proposal extends the current operator attention and unblock model. It does
not replace session attention, work item progress, invocation flights, mobile
inbox items, or APNs delivery. It adds a policy layer above them.

Existing records can map into intents:

| Existing source | Default intent |
|---|---|
| work progress update | `fyi` |
| work checkpoint with a declared default | `consult` |
| approach fork with a declared default | `steer` |
| approval request | `unblock` |
| question awaiting answer | `unblock` |
| failed action needing review | `steer` or `unblock`, depending on recoverability |
| session error | `unblock` |

## Non-Goals

- requiring every agent update to notify the operator
- turning consult or steer into blocking approvals
- replacing broker-owned unblock records
- making mobile push delivery mandatory
- sending detailed private context in APNs payloads
- claiming guaranteed delivery or cross-device consensus

## Implementation Sequence

1. Add protocol types for attention intent, policy, delivery, and progress
   snapshots.
2. Store the operator attention policy in the user profile or operator card
   metadata.
3. Add web settings for normal, run, and audit modes plus per-intent delivery.
4. Add mobile settings for mobile delivery preferences and run mode.
5. Include mobile policy in device registration or a dedicated policy sync
   route so the primary can filter APNs before sending.
6. Extend session attention and work progress projection to emit intent.
7. Add a notification router that maps event intent plus policy to web, mobile,
   desktop, and digest delivery.
8. Add rollup views for long-running multi-agent audits.

## Acceptance Criteria

- Operators can configure different delivery behavior for FYI, consult, steer,
  and unblock.
- Web and mobile can use different delivery policies.
- Run mode provides periodic mobile progress awareness without blocking agents.
- Parallel audits show structured progress and decisions without requiring the
  operator to open each session.
- Consult and steer items declare what happens on silence.
- Only true unblock items transfer next move ownership to the operator.
- Push payloads remain opaque and link back to broker-owned records.
