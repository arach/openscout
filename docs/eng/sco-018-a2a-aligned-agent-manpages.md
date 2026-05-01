# SCO-018: A2A-Aligned Agent Manpages

## Status

Proposed.

## Context

SCO-016 added an external agent registration direction built around
`ScoutAgentCard`. That card is already intentionally close to A2A's Agent Card
shape: it carries provider metadata, skills, supported interfaces, security
hints, default input/output modes, documentation, and Scout-local routing state.

The `missionwriter` card exposed the next product need. An agent can be
reachable through Scout and still be hard to use correctly unless the operator
and other agents know what it is for.

`@missionwriter` is not a general chat target. It is closer to an agentic CLI:

- it expects a `.mission.md` file
- it supports known mission shapes such as `review`, `write`, and
  `review-rewrite`
- it writes predictable outputs such as review reports and draft files
- it has runtime requirements such as `CURSOR_API_KEY`

Scout should make this callable surface legible without inventing a separate
schema that conflicts with A2A.

## Problem

1. `scout card create` makes an agent addressable, but it does not make the
   agent's callable surface obvious.
2. Operators can ask `@missionwriter` for work, but they have to learn the
   required input format, outputs, and examples out of band.
3. Other agents cannot reliably decide when to delegate to `@missionwriter`
   from card data alone unless `skills` are populated and rendered.
4. Scout currently treats simple capability lists such as `chat`, `invoke`, and
   `deliver` differently from richer A2A-style skills, so the UI and CLI do not
   yet have a single discovery story.
5. A bespoke `manpage` schema would duplicate A2A's `AgentSkill` concept and
   make future A2A projection harder.

## Goals

- Add an operator-facing "agent manpage" surface for Scout agents.
- Keep the data model A2A-aligned by rendering from `ScoutAgentCard` fields:
  `description`, `documentationUrl`, `skills`, `defaultInputModes`,
  `defaultOutputModes`, `supportedInterfaces`, `securitySchemes`, and
  `securityRequirements`.
- Make `skills` the function-level discovery primitive.
- Preserve Scout-local routing fields such as `handle`, `selector`,
  `defaultSelector`, `inboxConversationId`, and `returnAddress`.
- Support both humans and agents: the same source card should power CLI output,
  UI details, and future delegation/routing hints.
- Make `@missionwriter` the reference example.

## Non-goals

- Implementing the full A2A wire protocol.
- Renaming `ScoutAgentCard` to A2A `AgentCard`.
- Replacing Scout's broker routing, invocations, flights, questions, or work
  items with A2A tasks.
- Creating a separate `AgentManual` document type in the first implementation.
- Building typed forms for every skill in this proposal.

## Proposal

Add an A2A-aligned agent manual surface backed by `ScoutAgentCard`.

The product command is:

```bash
scout man <agent>
```

Aliases may be added for discoverability:

```bash
scout skills <agent>
scout inspect <agent> --manual
```

The command resolves the agent through the normal Scout address rules, fetches
or builds its `ScoutAgentCard`, and renders a manual-style view.

`scout man` reads broker-stored card metadata only. It never wakes an agent.
If no card is found for the resolved address, the command prints a clear
message and exits cleanly — for example:

```text
No card registered for @missionwriter. Run `scout card create` to register one.
```

Skill ids in the rendered output are discovery metadata only. They are not
routable selectors. A future SCO will define skill invocation (e.g. `scout ask
--skill <id>`) if that proves necessary. Until then, skill ids serve as stable
identifiers for display, delegation hints, and tag-based search.

## A2A Alignment

A2A has two relevant layers:

| A2A Field | Scout Field | Use In This SCO |
| --- | --- | --- |
| `AgentCard.name` | `ScoutAgentCard.displayName` | Manual title. |
| `AgentCard.description` | `ScoutAgentCard.description` | Purpose text. |
| `AgentCard.documentationUrl` | `ScoutAgentCard.documentationUrl` | Link to full docs. |
| `AgentCard.defaultInputModes` | `ScoutAgentCard.defaultInputModes` | Default accepted input formats. |
| `AgentCard.defaultOutputModes` | `ScoutAgentCard.defaultOutputModes` | Default output formats. |
| `AgentCard.skills` | `ScoutAgentCard.skills` | Callable functions / manpage sections. |
| `AgentSkill.id` | `ScoutAgentSkill.id` | Stable function id. |
| `AgentSkill.name` | `ScoutAgentSkill.name` | Human-readable function name. |
| `AgentSkill.description` | `ScoutAgentSkill.description` | What the function does. |
| `AgentSkill.tags` | `ScoutAgentSkill.tags` | Discovery and routing hints. |
| `AgentSkill.examples` | `ScoutAgentSkill.examples` | Example invocations/prompts. |
| `AgentSkill.inputModes` | future `ScoutAgentSkill.inputModes` | Skill-specific input formats. |
| `AgentSkill.outputModes` | future `ScoutAgentSkill.outputModes` | Skill-specific output formats. |
| `AgentCard.additionalInterfaces` | `ScoutAgentCard.supportedInterfaces` | Alternate protocol/transport endpoints. |
| `AgentCard.securitySchemes` | `ScoutAgentCard.securitySchemes` | Auth requirements. |
| `AgentCard.security` | `ScoutAgentCard.securityRequirements` | Required auth combinations. |

`ScoutAgentCard` remains the Scout-local type because it also contains routing
state A2A does not model directly, including `handle`, `selector`,
`defaultSelector`, `projectRoot`, `currentDirectory`, `harness`, `transport`,
`inboxConversationId`, and `returnAddress`.

> **Scout extension — `"in": "env"`:** A2A's `apiKey` security scheme allows
> `"in": "header" | "query" | "cookie"`. Scout additionally allows `"in":
> "env"` to describe environment-variable credentials. This value is
> Scout-local and will not project to strict A2A clients. It is noted in the
> table above as a Scout-local convention.

## Data Model Changes

The existing `ScoutAgentSkill` is close to A2A but lacks per-skill input/output
modes. Extend it:

```ts
export interface ScoutAgentSkill {
  id?: string;
  name: string;
  description?: string;
  tags?: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}
```

This keeps the Scout type structurally compatible with A2A `AgentSkill` while
remaining permissive for local cards.

No separate manual schema is needed for the first version. The manual is a
rendering of the card.

Skills are rendered in insertion order from the stored card. The renderer does
not sort alphabetically. Operators who curate skill order for discoverability
or priority reasons retain that ordering in all output surfaces.

Skill `examples` entries are bare prompts — the payload the operator or agent
would type after addressing the agent. They are not full `scout ask` commands.
The `SYNOPSIS` section of the manual is the canonical form for a full
invocation. For example:

```text
SYNOPSIS
  scout ask --to missionwriter "run /path/to/file.mission.md"

SKILLS
  review
    Example:
      run /path/to/review.mission.md          ← bare prompt, not a full command
```

## CLI UX

### `scout man missionwriter`

Example output:

```text
MISSIONWRITER(1)               Scout Agent Manual               MISSIONWRITER(1)

NAME
  missionwriter - structured writing and review mission runner

ADDRESS
  Handle:   @missionwriter
  Agent:    missionwriter.master.mini
  Selector: @missionwriter.master.node:mini
  Project:  /Users/arach/dev/missionwriter
  Runtime:  claude via claude_stream_json
  Inbox:    dm.arach.missionwriter.master.mini

SYNOPSIS
  scout ask --to missionwriter "run /path/to/file.mission.md"

DESCRIPTION
  Executes structured writing missions defined in markdown files.

SKILLS
  review
    Reads source files and writes structured critique.
    Input:  text/markdown
    Output: text/markdown
    Example:
      run /path/to/review.mission.md

  write
    Synthesizes a brief into named output files.

  review-rewrite
    Runs editorial, strategic, and technical-precision reviewers, then writes
    a revised draft.

INPUT MODES
  text/markdown
  application/yaml

OUTPUT MODES
  text/markdown

REQUIRES
  CURSOR_API_KEY  (cursorApiKey — env)

INTERFACES
  (none)

SEE ALSO
  scout ask, scout send, scout card create
```

### Empty or sparse cards

If an agent has no `skills`, the command should still render addressability and
say:

```text
SKILLS
  No skills advertised.

HINT
  Add A2A-style skills to this agent card metadata so Scout can render its
  callable surface.
```

This makes missing metadata visible without blocking use.

### REQUIRES section derivation

The `REQUIRES` section lists credentials the agent needs at runtime. It is
derived from `securitySchemes` and `securityRequirements` on the card:

1. Collect all scheme keys named in `securityRequirements` (any position in
   any requirement array).
2. For each collected scheme, if its `"in"` field is `"env"`, emit the
   scheme's `name` value as a required environment variable, followed by the
   scheme key in parentheses.
3. Schemes not referenced in `securityRequirements` are omitted.

Example: the `cursorApiKey` scheme has `"in": "env"` and `"name":
"CURSOR_API_KEY"` and appears in `securityRequirements`. The renderer emits:

```text
REQUIRES
  CURSOR_API_KEY  (cursorApiKey — env)
```

If no env-backed security requirements exist, the `REQUIRES` section is
suppressed.

### INTERFACES section

The `INTERFACES` section lists entries from `supportedInterfaces`. If the
field is absent or empty, render:

```text
INTERFACES
  (none)
```

The section is always present so operators know to look there, even when the
agent does not advertise alternate transports.

### Machine-readable output

Add:

```bash
scout man missionwriter --json
```

The JSON response is the resolved `ScoutAgentCard` with no lossy manual
formatting. That lets other agents inspect the same A2A-aligned data without
parsing text.

**Privacy note:** The full `ScoutAgentCard` may include `projectRoot`,
`currentDirectory`, and skill `examples` strings that contain absolute local
filesystem paths. In v1 this is acceptable for single-operator deployments.
Future versions should consider a `--strip-routing` flag or a separate
projection that omits routing-only fields (`projectRoot`, `currentDirectory`,
`inboxConversationId`, `returnAddress`, `selector`, `defaultSelector`) for
external or multi-operator contexts.

## Card Metadata For `missionwriter`

The `missionwriter` card should advertise skills like this:

```json
{
  "description": "Structured writing and review mission runner.",
  "defaultInputModes": ["text/markdown", "application/yaml"],
  "defaultOutputModes": ["text/markdown"],
  "skills": [
    {
      "id": "review",
      "name": "Review document",
      "description": "Read input files and produce a structured critique. Does not rewrite sources.",
      "tags": ["writing", "review", "editing"],
      "examples": [
        "run /Users/arach/dev/project/missions/blog-review.mission.md"
      ],
      "inputModes": ["text/markdown", "application/yaml"],
      "outputModes": ["text/markdown"]
    },
    {
      "id": "write",
      "name": "Write draft",
      "description": "Synthesize a brief into one or more named output files.",
      "tags": ["writing", "drafting"],
      "examples": [
        "run /Users/arach/dev/project/missions/announcement.mission.md"
      ],
      "inputModes": ["text/markdown", "application/yaml"],
      "outputModes": ["text/markdown"]
    },
    {
      "id": "review-rewrite",
      "name": "Review and rewrite",
      "description": "Run editorial, strategic, and technical-precision reviewers in parallel, consolidate reports, and write a revised draft.",
      "tags": ["writing", "review", "rewrite"],
      "examples": [
        "run /Users/arach/dev/project/missions/blog-review-rewrite.mission.md"
      ],
      "inputModes": ["text/markdown", "application/yaml"],
      "outputModes": ["text/markdown"]
    }
  ],
  "securitySchemes": {
    "cursorApiKey": {
      "type": "apiKey",
      "name": "CURSOR_API_KEY",
      "in": "env",
      "description": "Cursor API key required by missionwriter."
    }
  },
  "securityRequirements": [["cursorApiKey"]]
}
```

## UI UX

Agent detail views should render an "Agent Manual" section when card data is
available:

- purpose
- address and selectors
- skills
- examples
- input/output modes
- documentation URL
- security requirements
- supported interfaces

If skills exist, the UI can later grow a "Run skill" action. That is out of
scope for the first implementation, but the data model should not block it.

## Implementation Plan

### Phase 1: Protocol and card metadata

1. Extend `ScoutAgentSkill` with `inputModes?: string[]` and
   `outputModes?: string[]`.
2. Update `buildScoutAgentCard()` and tests to preserve those fields from agent
   metadata.
3. Ensure external card registration can accept and store A2A-aligned skill
   metadata.

### Phase 2: CLI manual renderer

1. Add `scout man <agent>` to the CLI.
2. Reuse existing agent resolution and agent-card fetching paths.
3. Render a stable text format with sections:
   - `NAME`
   - `ADDRESS`
   - `SYNOPSIS`
   - `DESCRIPTION`
   - `SKILLS`
   - `INPUT MODES`
   - `OUTPUT MODES`
   - `REQUIRES`
   - `INTERFACES`
   - `SEE ALSO`
4. Add `--json` to return the resolved `ScoutAgentCard`.
5. Add focused tests for:
   - agent with skills
   - agent without skills
   - skill-specific input/output modes
   - security requirement rendering

### Phase 3: UI rendering

1. Add an Agent Manual section to the agent detail screen.
2. Prefer the same formatting order as the CLI.
3. Keep missing data quiet except for missing skills, where the empty-state hint
   is useful.

### Phase 4: Discovery and delegation

1. Let `scout who` or future search surfaces filter by skill tag.
2. Add a broker-side helper for agents to request card/manual JSON for a target.
3. Consider future `scout ask --to missionwriter --skill review-rewrite ...`
   only after the manual surface is proven useful.

## Acceptance Criteria

- `scout man missionwriter` renders `@missionwriter` as a structured writing
  and review mission runner.
- The manual includes A2A-style skills with ids, names, descriptions, tags,
  examples, and input/output modes.
- Skill examples in the rendered output are bare prompts, not full `scout ask`
  commands. The `SYNOPSIS` section carries the canonical full-command form.
- The `INTERFACES` section is always rendered (showing `(none)` when absent).
- The `REQUIRES` section lists only env-backed schemes that appear in
  `securityRequirements`; it is suppressed when there are none.
- Skills are rendered in card insertion order, not alphabetically.
- `scout man missionwriter --json` returns the underlying `ScoutAgentCard`
  with `defaultInputModes`, `defaultOutputModes`, and per-skill `inputModes`
  and `outputModes` preserved when present. No fields added by the renderer;
  no card fields silently dropped.
- `scout man <agent>` never wakes an offline or on-demand agent. If no card
  is found, it prints a clear message and exits without error.
- Sparse cards render a useful empty state instead of failing.
- No new manual-specific schema duplicates A2A `AgentSkill`.
- The docs continue to state that Scout is A2A-aligned, not an A2A
  implementation.

## Open Questions

- Should `scout card create` infer skills from local files such as
  `README.md`, `package.json`, or a future `.scout/agent-card.json`?
  (Deferred to Phase 4 or a separate SCO.)

## Resolved Questions

The following questions from earlier drafts have been resolved and incorporated
into the proposal:

- **`"in": "env"` in `securitySchemes`:** Adopted as a Scout-local extension.
  Not projected to strict A2A clients. See A2A Alignment note above.
- **Skill examples convention:** Examples are bare prompts (payload only).
  The `SYNOPSIS` section carries the canonical full `scout ask` form.
- **`scout man` and agent wake:** `scout man` is broker-read-only. It never
  wakes an agent. Missing card = clean message and exit.
- **Skill id routing:** Skill ids are discovery metadata only, not routing
  selectors, until a future invocation SCO.

## References

- A2A Agent Card and AgentSkill:
  <https://a2a-protocol.org/v0.2.6/specification/>
- A2A Agent Skills tutorial:
  <https://a2a-protocol.org/latest/tutorials/python/3-agent-skills-and-card/>
- Scout A2A alignment:
  [`docs/a2a-alignment.md`](../a2a-alignment.md)
- Scout Agent Card protocol:
  [`packages/protocol/src/scout-agent-card.ts`](../../packages/protocol/src/scout-agent-card.ts)
- External agent card registration:
  [`docs/eng/sco-016-external-endpoint-registration-api.md`](./sco-016-external-endpoint-registration-api.md)
