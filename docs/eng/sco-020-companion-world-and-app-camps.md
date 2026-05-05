# SCO-020: Companion World and App Camps

## Status

Proposed.

## Proposal ID

`sco-020`

## Intent

Define a shared companion layer for Scout-adjacent apps without making those
apps depend on each other.

The product idea is a small virtual world where apps, agents, and active work
have places. A Scout companion can move between those places, react to work
state, and make background coordination feel visible without turning the
desktop into another dashboard.

The clearest home for the world is Lattices:

- Lattices already thinks spatially about windows, spaces, overlays, and
  desktop context.
- Scout already owns agent identity, routing, work state, and event history.
- Talkie has its own voice and conversational state, and can use the same
  Lattices canvas when available.

The first metaphor should be **app camps**: each app or agent family gets a
small tent, radio post, workbench, or field station on a Lattices canvas. Scout
Ranger is the first resident.

## Problem

Scout, Lattices, Talkie, and Codex all expose useful state, but that state is
mostly textual, tabular, or notification-shaped. Users have to inspect the right
app to answer simple questions:

- is Scout doing something right now?
- which agent has the next move?
- is a task waiting on me?
- did a background action fail?
- which app or workspace is the center of gravity?

Codex pets prove that tiny animated companions can make ambient work feel more
alive. But Codex pets are local to Codex. They do not know about Scout work
items or the user's desktop map.

The goal is not to make a game. The goal is to create a low-friction spatial
status layer that makes the agent system feel like a place.

The product risk is asking users to understand a three-app chain when a two-app
relationship is enough. Scout should not require Talkie to explain its
personality, and Talkie should not require Scout to express itself. Each app
should integrate directly with Lattices as the shared spatial layer.

## What This Is Not

- Not a replacement for Scout channels, inbox, work items, or activity feeds.
- Not a full simulation engine.
- Not a generic plugin system for arbitrary executable pets.
- Not an always-interactive overlay that steals focus or clicks.
- Not a requirement that every app render companions itself.

## What This Is

A companion world composed of:

1. A Lattices-hosted visual canvas.
2. A local world model of camps, actors, and routes.
3. A small Scout companion event protocol.
4. Reusable sprite assets compatible with Codex-style pet sheets.

Other apps can publish their own companion events to Lattices, but they are
siblings on the canvas rather than layers inside Scout.

## Design Principles

1. **Lattices owns space.** It renders the world and decides layout,
   animation, hit testing, and overlay behavior.
2. **Scout owns Scout facts.** It emits durable companion events derived from
   agent status, work items, messages, invocations, and channel activity.
3. **Integrations are pairwise.** Scout uses Lattices when available. Talkie
   uses Lattices when available. Scout and Talkie do not need to mediate each
   other.
4. **Decoration cannot affect execution.** A failed pet renderer must not block
   a Scout delivery, tool call, automation, or Lattices action.
5. **The MVP should feel alive before it feels complete.** Start with one actor,
   a few camps, and five states.

## Product Model

### Camps

A camp is a spatial representation of an app, workspace, team, or function.

Examples:

| Camp | Meaning |
|---|---|
| Scout camp | Broker, agents, channels, work items |
| Talkie radio tent | Voice input, spoken responses, conversational presence |
| Codex workbench | Coding sessions, review, command execution |
| Lattices map table | Desktop state, windows, spaces, app context |

V1 camps should be static or gently arranged by Lattices. Users can later move
or pin camps.

### Actors

An actor is an animated companion with a home camp and current intent.

The first actor is `scout-ranger`: a cute field-general companion. It should
read as friendly and tactical, not militarized in a hard-edged way.

Actors can:

- idle near their home camp
- walk to a target camp
- display a small status badge
- play a state animation
- briefly surface a label or speech bubble

### States

V1 should use a small shared state set:

| State | Meaning |
|---|---|
| `idle` | No urgent activity. |
| `running` | Work is actively executing. |
| `waiting` | The system needs user input or another actor's response. |
| `review` | Something is ready to inspect. |
| `failed` | A task failed or needs attention. |
| `completed` | A short flourish, then return to idle. |

Codex-style sprite sheets already provide most of these rows. Lattices can map
missing states to the nearest available row.

## Architecture

```
Scout broker                         Talkie
├── work items                       ├── voice state
├── messages                         ├── conversations
├── invocations/flights              └── companion event projection
└── companion event projection              │
        │                                  │
        └──────── local socket / HTTP / SSE┘
                           │
                           ▼
                 Lattices companion world
                 ├── world store
                 ├── camp layout
                 ├── actor state machine
                 ├── sprite renderer
                 └── passive overlay canvas
```

This architecture deliberately avoids a Scout -> Talkie -> Lattices chain.
Scout and Talkie each talk to Lattices directly.

## Scout Integration

Scout should expose a companion event stream as a projection over existing
broker facts. The event stream should be lossy for rendering but grounded in
durable records.

### Event Shape

```ts
type CompanionEvent = {
  id: string;
  createdAt: string;
  source: "scout";
  actorId?: string;
  campId?: string;
  workspaceId?: string;
  conversationId?: string;
  workId?: string;
  sessionId?: string;
  state: "idle" | "running" | "waiting" | "review" | "failed" | "completed";
  priority: "ambient" | "notice" | "attention";
  title?: string;
  detail?: string;
  ttlMs?: number;
};
```

### Event Sources

Scout can derive companion events from:

| Scout fact | Companion event |
|---|---|
| invocation starts | `running` at the target app/agent camp |
| invocation completes | `completed`, then `idle` |
| invocation fails | `failed` |
| work item enters `waiting` | `waiting` |
| work item enters `review` | `review` |
| unread mention for user | `waiting` or `attention` |
| channel mission update | actor moves to the channel or app camp |

### Broker API

V1 should avoid adding a new transport. Use the same local broker connection
patterns as other Scout surfaces:

- HTTP/SSE for simple development and cross-process integration.
- Local socket when the local desktop path is ready.

Possible endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /v1/companion/world` | Return camps, actors, and current state. |
| `GET /v1/companion/events` | SSE stream of Scout-projected companion events. |

The broker should keep the event contract semantic. It should not send sprite
coordinates, animation frames, or visual layout decisions.

## Lattices Integration

Lattices should render the companion world as a passive overlay or canvas layer.

The smallest viable implementation is:

1. `CompanionWorldStore` reads `~/.lattices/companions/world.json`.
2. `CompanionEventClient` subscribes to Scout companion events.
3. `CompanionOverlayLayer` renders camps, actors, and badges.
4. `CompanionActorController` maps semantic events to movement and animation.
5. The overlay is click-through by default.

### World File

```json
{
  "version": 1,
  "camps": [
    {
      "id": "scout-camp",
      "label": "Scout",
      "kind": "tent",
      "anchor": { "x": 220, "y": 160 },
      "appBundleId": "com.openscout.desktop"
    },
    {
      "id": "talkie-radio",
      "label": "Talkie",
      "kind": "radio-tent",
      "anchor": { "x": 460, "y": 220 }
    }
  ],
  "actors": [
    {
      "id": "scout-ranger",
      "asset": "assets/pets/scout-ranger/pet.json",
      "homeCampId": "scout-camp"
    }
  ]
}
```

### Rendering Rules

- Keep the overlay passive and non-blocking.
- Cap animation work; drop frames before stealing UI responsiveness.
- Cache sprites before showing the actor.
- Treat missing assets as a silent fallback to simple native shapes.
- Keep visual labels short and temporary.

## Sibling Integrations

Talkie and other apps can use the same Lattices companion world, but that work
should be specified as separate app-to-Lattices integrations.

For example:

- Talkie -> Lattices can render voice state at a radio tent.
- Scout -> Lattices can render coordination state at Scout camp.
- Codex -> Lattices can render coding session state at a workbench.

Those integrations can share the same world file, sprite format, and event
vocabulary, but they should not make users understand Scout, Talkie, and
Lattices as one mandatory three-part feature. Each pair should be useful on its
own.

## Asset Format

V1 should reuse the Codex pet package shape:

```text
pet.json
spritesheet.webp
```

Minimal manifest:

```json
{
  "id": "scout-ranger",
  "displayName": "Scout Ranger",
  "description": "A tiny field-general companion for Scout sessions.",
  "spritesheetPath": "spritesheet.webp"
}
```

Lattices may add optional fields later:

```json
{
  "states": {
    "idle": { "row": 0, "frames": 6 },
    "running": { "row": 7, "frames": 6 },
    "waiting": { "row": 6, "frames": 6 },
    "review": { "row": 8, "frames": 6 },
    "failed": { "row": 5, "frames": 8 }
  }
}
```

V1 should support the known Codex sheet dimensions:

- `1536 x 1872`
- `8` columns
- `9` rows
- `192 x 208` per frame
- transparent WebP

## MVP

### Phase 1: Static Local Prototype

- Add one world file.
- Render Scout camp and an optional Talkie radio tent in Lattices.
- Render `scout-ranger` from a local pet package.
- Animate idle/running/waiting/review/failed using timer-driven rows.
- No Scout broker integration yet.

### Phase 2: Scout Event Projection

- Add broker-side companion event projection.
- Emit events for invocation start/finish/failure and work item state changes.
- Subscribe from Lattices.
- Move Scout Ranger to the relevant camp based on event source.

### Phase 3: Mission Channels and Camps

- Connect mission channels to temporary camps or camp badges.
- Show next-move ownership as the companion's destination.
- Add user attention badges for work waiting on the operator.

### Phase 4: Sibling App Integrations

- Let Talkie publish its own Lattices companion events.
- Let Codex sessions publish their own Lattices companion events.
- Keep each app's Lattices integration separately understandable.

## Safety and Privacy

- Do not render sensitive message contents by default.
- Use short titles such as "waiting on review" instead of transcript snippets.
- Treat local custom pet assets as data only, not executable code.
- Do not load remote assets in the hot path.
- Do not let companion events trigger work actions without an explicit command.

## Open Questions

- Should world layout live under `~/.lattices`, `~/.openscout`, or both?
- Should Scout camps be broker-generated, user-authored, or discovered from
  app registrations?
- Should actors be globally unique, per-app, or per-workspace?
- How much should the companion world appear in Scout's web UI versus only in
  Lattices?
- Should mission channels automatically create temporary camps?
- Should Lattices expose a reusable embedded canvas component that Scout can
  host later, or should Scout only link out to Lattices for v1?

## Recommendation

Build this first in Lattices as a passive companion canvas, backed by a small
Scout event projection. Keep the first actor and first world deliberately
simple: Scout camp, Talkie radio tent, Codex workbench, and Scout Ranger.

The important architectural split is:

- Lattices makes the system feel spatial.
- Scout makes Scout's companion truthful.
- Other apps can bring their own truth to the same canvas through their own
  pairwise Lattices integrations.

That split keeps the feature charming without making it fragile.
