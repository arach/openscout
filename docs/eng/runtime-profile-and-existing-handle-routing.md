# Runtime Profile And Existing-Handle Natural Routing

## Status

Implemented for the Scout CLI and broker route boundary (2026-07-23).

## Decision

Natural-language target names have two explicit meanings:

- a bare reserved runtime profile name (`Fable`, `Kimi`, `Grok`, or `Opus`)
  starts a fresh session for the inferred current project through a structured
  `runtime_profile` route; and
- `agent <name> to <request>` addresses one existing agent or live session
  through a structured `existing_handle` route.

The CLI MUST NOT turn either form into a guessed `ask --to` label.

`ask --to <target>` remains the explicit surface for existing target routing.
`ask --profile <profile>` is the explicit surface for a fresh runtime-profile
launch. A caller may add `--effort <level>` to a profile launch. Profiles own
their harness, model, and fresh-session defaults.

## Reserved broker profiles

| Profile | Harness | Model | Session |
| --- | --- | --- | --- |
| `fable` | `claude` | `fable` | fresh |
| `kimi` | `kimi` | broker/harness default | fresh |
| `grok` | `grok` | broker/harness default | fresh |
| `opus` | `claude` | `opus` | fresh |

The protocol publishes only the reserved names needed for deterministic client
recognition. The execution definitions above are owned and applied by the
broker. Clients MUST NOT duplicate or override those mappings.

## Natural-language grammar

Reserved profiles are recognized only in leading position:

```text
Fable to review the parser
Grok xhigh to fix the tests
Opus with high effort to review the patch
```

The `to` token is optional for profiles because the leading word is reserved.
An optional effort may be written directly after the profile or as
`with <effort> effort`. Accepted efforts are `none`, `minimal`, `low`,
`medium`, `high`, `xhigh`, `max`, and `ultra`.

Existing targets require the `agent` prefix and a `to` delimiter so a
multi-word display name has a deterministic boundary:

```text
agent Composer Review to fix the tests
```

The name between `agent` and `to` is normalized by lowercasing, replacing every
run of spaces or punctuation with one dash, collapsing dashes, and trimming
edge dashes. The example becomes the exact handle `@composer-review`.

## Resolution and failure rules

An `existing_handle` lookup is exact after normalization. The broker checks
current agent handles/selectors and live session handles. It MUST NOT use
local-node preference, fuzzy matching, a project-name heuristic, or a fresh
spawn to break a tie. Zero matches returns unknown. Multiple agent matches
return candidate handles; multiple session matches return exact `session:<id>`
choices. Nothing is sent until the caller disambiguates.

A `runtime_profile` route carries the profile id and inferred absolute project
path. The broker validates the profile, applies its execution definition, and
uses the existing cardless current-project fresh-session path. Unknown profiles
or invalid efforts fail closed.

## Alias boundary

Runtime profiles are launch presets, not aliases. Existing handles are exact
references to already known targets, not mutable pointers. Post-hoc route
aliases remain a separate broker-owned `route_alias` concept with scope,
revision, ownership, and repointing semantics. A future alias implementation
must not overload `runtime_profile` or `existing_handle`; explicit
`alias:<name>` and bare-alias precedence remain separate decisions.

## Examples

```bash
scout ask Fable to review the parser
scout ask Opus high to fix the tests
scout ask --profile kimi "review the parser"
scout ask agent Composer Review to fix the tests
scout ask --to fable "continue with the existing target named fable"
```

The last command is intentionally existing-target routing. `--to fable` never
silently becomes a profile launch.
