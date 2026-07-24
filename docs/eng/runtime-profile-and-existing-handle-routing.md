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
launch. A caller may add `--effort <level>` to Fable or Opus. Kimi and Grok
currently reject effort overrides because their ACP transports expose no
reasoning-effort control. Profiles own their harness, model, and fresh-session
defaults.

## Reserved broker profiles

| Profile | Harness | Model | Session | Effort override |
| --- | --- | --- | --- | --- |
| `fable` | `claude` | `fable` | fresh | supported |
| `kimi` | `kimi` | broker/harness default | fresh | rejected until ACP support exists |
| `grok` | `grok` | broker/harness default | fresh | rejected until ACP support exists |
| `opus` | `claude` | `opus` | fresh | supported |

The protocol publishes only the reserved names needed for deterministic client
recognition. The execution definitions above are owned and applied by the
broker. Clients MUST NOT duplicate or override those mappings.

## Natural-language grammar

Reserved profiles are recognized only in leading position:

```text
Grok to review the parser
Fable xhigh to fix the tests
Opus with high effort to review the patch
```

The `to` token is optional for profiles because the leading word is reserved.
For Fable and Opus, an optional effort may be written directly after the
profile or as `with <effort> effort`. Accepted efforts are `none`, `minimal`,
`low`, `medium`, `high`, `xhigh`, `max`, and `ultra`. Kimi and Grok fail
closed when either natural or flag-based effort is supplied.

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
references to already known targets, not mutable pointers. Implemented
post-hoc route aliases remain a separate broker-owned `route_alias` concept
with scope, revision, ownership, and repointing semantics. Alias lookup never
absorbs an unknown `runtime_profile` or `existing_handle`: explicit
`alias:<name>` and direct `--to` bare-alias fallback remain separate routes.

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
