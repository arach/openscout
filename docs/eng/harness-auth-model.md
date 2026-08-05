# Harness auth model: the portability seam

**Status:** descriptor landed for claude / opencode / grok / grok-acp; readiness
and redaction derive from it. Remaining harnesses still carry hand-written
readiness blocks.
**Companions:** [secret-redaction-audit.md](./secret-redaction-audit.md) (leak
paths), [secret-redaction-brief.md](./secret-redaction-brief.md) (incidents).

## Why this exists

Scout's design center is **delegated auth**. Seven of nine catalog harnesses
point at a vendor's own login (`claude login`, `cursor-agent login`) and Scout
only checks that a credential file exists. We deliberately stayed out of the
auth loop.

But we entered it incrementally without deciding to. `SCOUT_<VENDOR>_API_KEY`
is a namespace Scout invented, and it now has members for xAI, OpenCode,
OpenRouter and Cursor. `flue` has no `loginCommand` at all because there is no
CLI to log into — Scout *is* the runtime there. `pi` bridges seven vendors'
keys.

That split matters more than it looks:

> **Both 2026-08-04 credential leaks came from the brokered set.** Not
> coincidence — structural. A delegated harness cannot leak a key through
> Scout, because Scout never holds one.

## The failure this fixes

Auth facts lived in three places that disagreed:

| List | Location | Purpose |
| --- | --- | --- |
| `readiness.anyOf` | `runtime/src/harness-catalog.ts` | is this harness authenticated? |
| `ENVIRONMENT_CREDENTIAL_NAMES` | `runtime/src/secret-redaction-bootstrap.ts` | what must be scrubbed? |
| `PROVIDER_CREDENTIAL_ENV` | `agent-sessions/src/adapters/pi/adapter.ts` | what gets injected? |

They drifted, and the drift was not cosmetic. Claude Code reads
`CLAUDE_CODE_OAUTH_TOKEN` (123 references in the binary). The redaction list
named `ANTHROPIC_OAUTH_TOKEN` — a name inherited from pi's provider map — and
the readiness block named only `ANTHROPIC_API_KEY`. Net effect:

- the credential a cloud instance is **most likely to hold** was not redacted;
- a box authenticated correctly via `claude setup-token` reported **not
  authenticated**.

One missing declaration, two bugs, in opposite subsystems. That is the argument
for a single source.

## Shape

**Descriptor** — `packages/agent-sessions/src/auth/`. Declarative, and
deliberately in a **zero-dependency leaf package**: a descriptor there *cannot*
reach varlock, a keychain, or the filesystem. The separation is enforced by the
package graph rather than by discipline.

- `CredentialDomain` — a vendor's credential (`anthropic`, `xai`, `opencode`…).
  Keyed by vendor, not harness, because the mapping is not 1:1: `grok` and
  `grok-acp` share one xAI credential, and `pi` spans seven vendors.
- `HarnessAuthModel` — mode, the domains it draws from, an **ordered**
  credential list, `login`, and `provision`.

**Resolver** — `CredentialResolver`, implemented outside the package: process
env, macOS keychain via the `secret` CLI, a varlock `.env.schema`, or a cloud
secret manager. **Varlock is one implementation behind this interface, never
the architecture.** Swapping resolvers per environment touches no adapter.

### Fields that carry weight

- **`credentials` order is the contract, not documentation.** OpenCode reads
  `auth.json` ahead of `OPENCODE_API_KEY`, so a cloud image with a seeded
  auth.json silently ignores an injected key and runs on the wrong account with
  no error. Declaring the order makes that testable instead of folklore.
- **`portable`** — does this credential still work on another machine? An env
  var does by construction; a login cache keyed to a local OAuth flow does not.
  This is the field that decides what a cloud instance must be seeded with.
- **`billing`** — `claude setup-token` mints a *subscription*-billed token;
  `ANTHROPIC_API_KEY` bills API rates for the same harness. An operator-visible
  difference, not a label.
- **`secret`** — drives redaction. AWS regions and Azure endpoint names travel
  with credentials but are configuration; marking them `secret: false` keeps
  `us-east-1` from being scrubbed out of unrelated log lines.
- **`readinessSignal`** — a refresh token proves a prior login happened but
  cannot authenticate a request. Redacted, never counted as ready.

## What derives from it

- **Redaction** — `secretEnvKeys()` replaces the hand-maintained array.
- **Readiness** — `readinessFromAuthModel()` in `harness-catalog.ts`.
- **Cloud seeding** — `portableCredentialManifest()`.

Verified: OAuth token alone → ready; refresh token alone → not ready; nothing →
not ready. A test asserts the derived secret list is a superset of the array it
replaced, so the migration cannot silently lose coverage.

## Cloud

**In a cloud instance, `delegated` does not exist.** There is no
`~/.claude/.credentials.json` on a fresh box, no macOS keychain, and nobody to
run an interactive login. Every delegated harness becomes brokered the moment
it is not the operator's laptop — so `authModel` is the manifest of what has to
be seeded, which is why it is a portability seam and not a secrets cleanup.

Target: **stable, long-lived instances.** `claude setup-token` mints a
long-lived credential delivered through `CLAUDE_CODE_OAUTH_TOKEN`, which
collapses OAuth refresh from a runtime problem into one-time provisioning. Two
consequences:

- A long-lived token is a long-lived blast radius. Nothing expires it out from
  under an attacker — which is why redaction landed first.
- Expiry must surface as a **readiness failure, not silence.** OpenCode already
  reports provider rejection as a *successful empty turn* (`end_turn`, zero
  tokens, no text); a lapsed token would look identical to an agent with
  nothing to say. `invokeOpencodeAcpAgent` guards this for one harness; the
  pattern should generalize.

`apiKeyHelper` (declared as `kind: "helper"`) is the cleanest option where a
harness supports it: the credential never lands in a file or an env dict.

### Explicitly out of scope

**Ephemeral instances.** Varlock resolves the env graph at **boot** — it is a
load-time declaration, not a runtime credential provider. A short-TTL
credential that expires mid-session is never re-resolved. Fine for long-lived
tokens; it is the constraint that would need revisiting for per-instance
short-lived credentials.

**Provisioning.** OAuth device flows, subscription-tier detection, refresh —
the vendor's job. Becoming a credential broker makes Scout a target for no
gain.

## Open

- Only claude / opencode / grok / grok-acp are ported. codex, kimi and cursor
  still carry hand-written readiness and are the remaining porting candidates.
- **`pi` and `flue` are deliberately off the porting list.** Their credentials
  stay in the domain table — `buildPiProcessEnv()` injects eighteen providers'
  keys today, and dropping those entries would silently remove redaction
  coverage for keys that are still being handled — but no `HarnessAuthModel`
  is declared for either, and none should be added without a decision to
  invest there.

  `flue` is the harness that most needs one eventually: it has no
  `loginCommand` at all, which makes it purely brokered and therefore the only
  entry that *cannot* fall back to a vendor login in a cloud instance. Noted,
  not scheduled.
- Readiness still evaluates raw env presence — it does not yet ask a resolver,
  so a launchd-started broker whose keys live in the keychain still
  misreports. Wiring `CredentialResolver` into `evaluateRequirement` is the
  fix, and it is what makes readiness correct in cloud too.
- Whether other CLIs have a `setup-token` / `apiKeyHelper` equivalent is
  **unsurveyed**, and it decides whether cloud is one uniform story or nine
  per-harness ones.
- `claude setup-token` says "long-lived" without stating a duration. Confirm
  before depending on a specific lifetime.
