# SCO-041: Extension Packs And Project Overlays

## Status

Proposed.

## Proposal ID

`sco-041`

## Intent

Define a local-first packaging model for project, team, and machine-specific
OpenScout behavior without requiring forks of the core repository.

The goal is to let users add skills, prompts, agent profiles, capability
declarations, routing hints, and lightweight workflow definitions as explicit
extension packs that the broker can inspect, mount, enable, disable, and report.

## Context

OpenScout already uses file-based configuration, skills, agent cards, local
project hints, and runtime profiles. Those mechanisms are useful, but the
installation boundary is not yet a product concept. Users should be able to say
"this project adds these Scout behaviors" and inspect exactly what changed.

An extension pack is not a plugin marketplace. It is a local package shape for
declaring Scout behavior in a way that can be composed without mutating core
files.

## Decision

OpenScout SHOULD support extension packs.

An extension pack is a directory or package with a manifest and optional
subdirectories for known OpenScout extension points:

```text
openscout-pack/
|-- scout-pack.json
|-- skills/
|   `-- incident-review/
|       `-- SKILL.md
|-- agents/
|   `-- reviewer.json
|-- prompts/
|   `-- project-context.md
|-- capabilities/
|   `-- repository-search.json
|-- workflows/
|   `-- daily-check.json
`-- docs/
    `-- README.md
```

The broker SHOULD discover configured packs, validate manifests, and project
their contents into existing Scout registries. The pack itself remains external
source material; the broker records what it loaded and from where.

## Principles

1. Core behavior and project behavior should be separable.
2. Pack loading must be explicit and inspectable.
3. Later packs may override earlier packs only through declared precedence.
4. Packs should degrade gracefully when an extension point is unsupported.
5. A pack should not silently mutate harness-owned configuration.
6. The broker should report active packs in diagnostics and session context.
7. Pack manifests should use stable schemas and avoid executable install hooks
   in the first milestone.

## Manifest Shape

```json
{
  "schema": "openscout.pack.v1",
  "name": "acme-project",
  "displayName": "ACME Project Pack",
  "version": "0.1.0",
  "description": "Project-specific Scout behavior.",
  "appliesTo": {
    "projectRoots": ["/Users/example/dev/acme"],
    "branches": ["main"]
  },
  "exports": {
    "skills": ["skills/*"],
    "agents": ["agents/*.json"],
    "prompts": ["prompts/*.md"],
    "capabilities": ["capabilities/*.json"],
    "workflows": ["workflows/*.json"]
  },
  "permissions": {
    "capabilities": ["repository-search"],
    "requiresApproval": []
  }
}
```

The first version SHOULD support local directories only. Future versions may
support npm packages, git repositories, signed archives, or organization-managed
indexes.

## Discovery

Scout SHOULD discover packs from:

1. project-local `.openscout/packs/*`
2. user config under the OpenScout support directory
3. explicit CLI flags or environment variables for temporary sessions
4. future organization or mesh policy sources

Project-local discovery should not automatically enable arbitrary executable
code. In v1, pack contents should be declarative or existing skill documents.

## Precedence

When multiple packs provide the same extension id, the broker SHOULD resolve
using declared precedence:

1. explicit session override
2. project pack
3. user pack
4. machine pack
5. built-in default

Conflicts SHOULD be visible in diagnostics.

## Broker Projection

The broker SHOULD project pack contents into these registries:

| Pack export | Scout registry |
|---|---|
| `skills` | skill discovery and prompt context |
| `agents` | agent card/profile candidates |
| `prompts` | runtime prompt blocks |
| `capabilities` | SCO-040 capability registry |
| `workflows` | future lightweight schedule or action templates |

The broker SHOULD record:

- pack id
- version
- source path
- manifest hash
- enabled exports
- validation warnings
- conflicts

## Runtime Context

When Scout launches or attaches an agent session, it SHOULD be able to include a
small active-pack summary:

```text
Active OpenScout packs:
- acme-project@0.1.0: skills, prompts, capabilities
- user-defaults@0.3.0: skills
```

This summary should identify behavior sources without injecting unbounded pack
contents.

## Non-Goals

- creating a marketplace
- executing arbitrary install scripts
- replacing Codex, Claude, or other harness-native config systems
- mutating `.claude`, `.codex`, or other harness-owned files without an explicit
  operator action
- solving remote organization policy distribution in v1
- replacing existing skills or agent cards

## Implementation Sequence

1. Define `openscout.pack.v1` manifest schema.
2. Add pack discovery for project-local `.openscout/packs/*`.
3. Add broker diagnostics for active packs and validation warnings.
4. Load skill exports without changing current skill semantics.
5. Load agent/profile exports as candidates, not automatic running sessions.
6. Load capability declarations after SCO-040.
7. Add CLI commands:

```bash
scout pack list
scout pack inspect <name>
scout pack enable <path-or-name>
scout pack disable <name>
```

## Acceptance Criteria

- A project can declare Scout behavior without editing OpenScout core files.
- Active packs are listed in broker diagnostics.
- Pack conflicts and validation errors are visible.
- Pack loading does not execute arbitrary code.
- Harness-owned files are not mutated by pack discovery.
- Skills, prompts, agent profiles, and capability declarations have a common
  packaging boundary.
