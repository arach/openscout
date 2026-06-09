# SCO-066: Actor-Bound Credentials And AgentX Auth UX

## 1. Status

- **Status:** Draft
- **Owner:** OpenScout
- **Scope:** Credentials, actor identity, sender resolution, machine pairing, token UX, audit
- **Intent:** Replace giant shared secrets with actor-bound credentials that make Scout easier to use across agents, machines, and future multi-user surfaces.

## 2. Summary

OpenScout should treat auth as an identity and capability layer, not as one
giant secret passed around the mesh. A credential should answer three questions
before the broker routes anything:

1. Who is calling?
2. What actions can that caller perform?
3. Which resources can that caller touch?

That should make the product simpler, not heavier. If the broker knows the
actor from the credential, current session, and project context, ordinary
commands should not need `--as` or older `--from`-style sender flags. Those
flags should become explicit override and simulation tools, not normal
collaboration ceremony.

The target UX is:

```bash
scout whoami
scout ask --to hudson "review the auth module"
scout send --channel runtime "heads up: pairing is ready"
```

not:

```bash
scout ask --from premotion.master.mini --to hudson "review the auth module"
```

Auth should carry enough context for Scout, AgentX, CLI, native apps, bridges,
and adapters to do the obvious thing by default.

## 3. Context

The current CLI docs already push toward `scout whoami` and default sender
inference. That is the right product direction. As Scout grows across machines,
surfaces, webhooks, bridges, and multiple operators, the auth model should make
that direction more reliable.

The risk is adding "real auth" in a way that makes every command harder:
manual token selection, repeated sender flags, unclear impersonation, and
opaque route failures. This proposal goes the other way. Credentials should be
small, named, scoped records that let the broker infer the acting sender and
explain ambiguity.

OpenScout remains a high-trust local developer pilot. This proposal is not an
enterprise RBAC claim. It is a practical identity model that avoids shared
secrets and keeps room for future team and organization scoping.

## 4. Principles

1. Actor identity is established before routing target identity.
2. Credentials should remove routine flags, not add them.
3. Use actor-bound credentials instead of one broker-wide bearer secret.
4. Separate credential classes for operators, agents, nodes, surfaces,
   webhooks, and bridges.
5. Scope by action and by resource.
6. Node and machine identity should be keypair-based where possible.
7. Webhook signing secrets are not API tokens.
8. Rotation should be boring: create pending credential, verify or approve it,
   then atomically replace the active credential.
9. Recovery flows should avoid account enumeration when there is a user-facing
   account surface.
10. Every request should include a useful `User-Agent`.
11. Token use should create audit records with the actor, token prefix, route,
    scope, and authorization decision.

## 5. Vocabulary

| Term | Meaning |
| --- | --- |
| **Actor** | The entity taking an action: operator, agent, node, surface, bridge, or webhook endpoint. |
| **Credential** | A bearer token, signed key credential, session, or webhook secret bound to one actor and purpose. |
| **Caller** | The authenticated actor making the broker request. |
| **Sender** | The actor represented as the author of a Scout message, ask, or work item. Often the caller, but not always. |
| **Target** | The addressed recipient, project, channel, conversation, machine, sink, or work item. |
| **Delegation** | Permission for one caller to send as another sender. |
| **Surface** | A user-facing client such as CLI, AgentX, desktop, iOS, or web. |

This separation matters. A desktop surface may call the broker using a surface
session for operator Arach. An adapter may call the broker using an agent token
for `@hudson`. A bridge may call using a bridge credential while creating a
message whose sender is an external Telegram participant projection. These are
different decisions and should not be hidden inside one `apiKey`.

## 6. Credential Classes

Start with these credential classes:

| Class | Subject | Typical use | Should act as |
| --- | --- | --- | --- |
| `operator` | Human operator | CLI login, native app session, AgentX operator session | That operator, plus explicit delegated agents if granted |
| `agent` | Scout agent identity or endpoint | Agent adapter sends updates, asks peers, observes its own work | Only that agent by default |
| `node` | Machine or broker authority | Mesh pairing, machine presence, remote route acceptance | That node, not arbitrary agents |
| `surface` | Installed client surface | Desktop, iOS, web, AgentX shell session | The logged-in or paired operator subject |
| `webhook` | Event sink or inbound endpoint | Sign outbound events or authenticate later inbound writes | No broad API actor by default |
| `bridge` | External transport bridge | Telegram, Slack, email, voice, future external systems | Bridge subject plus constrained mapped participants |

Do not use one token class for all of these. The action surface and blast
radius are different.

## 7. Action And Resource Scopes

Action scopes should be explicit:

```ts
type CredentialActionScope =
  | "send"
  | "ask"
  | "read"
  | "observe"
  | "manage_agents"
  | "manage_sinks"
  | "pair_machines"
  | "rotate_credentials"
  | "recover_credentials"
  | "delegate_sender";
```

Resource scopes should be explicit too:

```ts
type CredentialResourceScope =
  | { kind: "project"; projectPath: string }
  | { kind: "agent"; agentId: string }
  | { kind: "conversation"; conversationId: string }
  | { kind: "machine"; nodeId: string }
  | { kind: "event_sink"; sinkId: string }
  | { kind: "organization"; organizationId: string }
  | { kind: "team"; teamId: string };
```

Organization and team scopes are future-facing. Local project, agent,
conversation, and machine scopes are the useful v0.

## 8. Credential Record Shape

A broker-owned credential record can be modeled as metadata plus a verifier.
The secret itself should be stored only as a hash, secure-storage reference, or
public key, depending on credential kind.

```ts
type CredentialClass =
  | "operator"
  | "agent"
  | "node"
  | "surface"
  | "webhook"
  | "bridge";

type CredentialSubject =
  | { kind: "operator"; operatorId: string }
  | { kind: "agent"; agentId: string }
  | { kind: "node"; nodeId: string }
  | { kind: "surface"; surfaceId: string; operatorId?: string }
  | { kind: "webhook"; sinkId: string }
  | { kind: "bridge"; bridgeId: string };

type ScoutCredential = {
  id: string;
  class: CredentialClass;
  subject: CredentialSubject;
  audience: string;
  actionScopes: CredentialActionScope[];
  resourceScopes: CredentialResourceScope[];
  tokenPrefix?: string;
  publicKeyRef?: string;
  secretHashRef?: string;
  status: "pending" | "active" | "rotating" | "revoked" | "expired";
  expiresAt?: string;
  createdBy: string;
  createdAt: string;
  lastUsedAt?: string;
};
```

The `audience` field prevents a token minted for one broker, mesh, bridge, or
event sink from being replayed as a general API credential.

## 9. Sender Resolution

Authentication should establish the caller first. Sender resolution should then
choose who the command is speaking as.

Recommended sender resolution:

1. Explicit command sender, such as `--as <agent>` or compatibility
   `--from <agent>`, if present and authorized.
2. Active conversation, session, or reply binding when the command is clearly a
   continuation.
3. Project-scoped actor binding from the current working directory.
4. Credential subject, when the credential subject can speak directly.
5. Operator default when outside a project context.
6. Fail with concrete candidates and remediation commands.

The important rule: explicit sender override is not magic. If an agent-bound
token for `@hudson` sends `--as @premotion`, the broker should reject it unless
that credential has a narrow delegated sender scope. If an operator credential
has delegation for a project, the override can be allowed and audited.

This turns `--as` or `--from` into a power-user feature:

```bash
scout auth use @premotion --project .
scout ask --to hudson "build the patch"
```

instead of:

```bash
scout ask --as premotion.master.mini --to hudson "build the patch"
```

## 10. AgentX UX

AgentX should present auth as "who am I acting as here?" rather than "which
token string am I using?"

Useful AgentX affordances:

- a visible actor line: `Acting as @premotion in openscout on mini`
- a `whoami` equivalent that explains actor source: credential, project
  binding, session binding, or operator default
- one-click project actor binding: "Use @premotion for this project"
- token list showing names, prefixes, scopes, last used time, and expiry, never
  full token values after creation
- rotation and revoke controls grouped by actor, not by raw secret
- conflict prompts that show the exact reason: "This token is bound to @hudson
  and cannot send as @premotion"
- a dry-run authorization view for advanced debugging: action, resource,
  decision, and matching scope

AgentX should also help agents avoid auth ceremony. If an adapter is launched
for `@hudson`, the generated adapter credential should already be bound to
`@hudson`. The adapter should send:

```ts
messages_send({
  to: "@premotion",
  body: "I found the issue."
});
```

not:

```ts
messages_send({
  from: "@hudson",
  to: "@premotion",
  body: "I found the issue."
});
```

The broker can fill the sender from the credential and return it in the receipt.

## 11. CLI UX

The CLI should keep auth operationally boring:

```bash
scout auth status
scout whoami
scout auth use @premotion --project .
scout auth list
scout auth rotate <credential-id>
scout auth revoke <credential-id>
```

Agent and adapter setup should mint constrained credentials:

```bash
scout token create --agent @hudson --project . --actions send,ask,observe
scout token create --surface cli --project . --actions send,ask,read
```

Machine pairing should mint a node credential, preferably backed by a generated
keypair:

```bash
scout pair
scout node list
scout node revoke <node-id>
```

The CLI should show the resolved actor before risky operations when ambiguity
exists, but it should not require repeated flags after a project binding is
clear.

## 12. Machine And Node Auth

Machine or node auth should not be just another long bearer string copied into
multiple places. A paired node should generate a keypair locally and register
the public key with the broker or mesh authority.

Pairing should create:

- a node identity
- a public key verifier
- an explicit audience, such as one mesh or authority broker
- expiry or refresh policy
- allowed machine actions, such as presence publish, route accept, route
  forward, and delivery receipt write

Node credentials should not grant agent messaging by default. A node can prove
"this delivery reached machine X" without also being able to speak as every
agent on that machine.

## 13. Agent Adapter Credentials

Agent adapter tokens should act only as the agent or endpoint they are minted
for. They should be able to:

- send as that agent
- ask as that agent when granted
- observe delivery and flight state relevant to that agent
- write adapter health and endpoint presence
- receive broker guidance for routing and remediation

They should not manage other agents, pair machines, configure webhooks, or read
unrelated conversations by default.

This makes adapter setup simpler. A generated adapter environment can hold one
credential:

```bash
OPENSCOUT_AGENT_TOKEN=os_agent_...
```

The adapter does not also need `OPENSCOUT_AGENT=@hudson` just to tell the
broker who it is, though that value can remain useful as a local sanity check
or startup assertion.

## 14. Webhook And Bridge Secrets

Webhook secrets should be independent from API credentials. Outbound webhooks
use a signing secret tied to one `event_sink`. They verify payload authenticity;
they do not grant general broker access.

Inbound webhooks, if added later, should use their own credential class and a
small action scope such as `send` or `ask` into a specific project,
conversation, or work item. They should not reuse outbound signing secrets.

Bridge credentials should be similarly constrained. A Telegram bridge, Slack
bridge, or email bridge needs to authenticate the bridge process and map
external participants into Scout-owned records. It should not receive a broad
operator token just because it can post messages.

## 15. Rotation And Recovery

Rotation should be a normal state machine:

1. Create a pending replacement credential.
2. Verify possession, operator approval, or device pairing proof.
3. Atomically mark the new credential active.
4. Move the old credential to rotating, revoked, or expired state.
5. Keep a bounded overlap window only where a transport needs it.

For webhook signing, the receiver may need an overlap window where both old and
new secrets verify. For agent and operator credentials, overlap should be as
short as possible and visible in `scout auth list`.

Recovery should avoid enumeration for user-facing account surfaces. A recovery
request should have the same public response whether or not the email exists.
The broker or hosted surface can still audit the attempt internally.

## 16. User-Agent And Request Metadata

Every authenticated request should include a useful `User-Agent`:

```txt
openscout-cli/0.6.0 node/24.0 darwin-arm64 surface/cli machine/local
```

Agent and bridge clients can add their class:

```txt
openscout-agent-adapter/0.6.0 runtime/codex node/mini class/agent
openscout-telegram-bridge/0.6.0 node/mini class/bridge
```

The point is diagnostics, not fingerprinting theater. When audit says a token
was denied, the operator should be able to tell whether it came from CLI,
AgentX, desktop, iOS, an adapter, a node, or a bridge.

## 17. Audit Records

Credential usage should create a broker-owned audit record:

```ts
type CredentialUsageAudit = {
  id: string;
  credentialId: string;
  tokenPrefix?: string;
  actor: CredentialSubject;
  action: string;
  resource?: CredentialResourceScope;
  route?: {
    senderId?: string;
    targetId?: string;
    conversationId?: string;
    projectPath?: string;
  };
  decision: "allowed" | "denied";
  reason?: string;
  userAgent?: string;
  createdAt: string;
};
```

Audit should capture the authorization decision, not raw secrets or full
message bodies. It should be queryable enough to answer:

- why was this send denied?
- which credential sent this ask?
- when did this node last use its pairing credential?
- which webhook secret is still active?
- which project binding caused this command to speak as this agent?

## 18. Error UX

Auth failures should be typed and remediable:

```txt
Denied: this credential is bound to @hudson and cannot send as @premotion.

Try:
  scout whoami
  scout auth use @premotion --project .
  scout token create --agent @premotion --project . --actions send,ask
```

Ambiguous sender failures should be similarly concrete:

```txt
Scout does not know who should speak from this directory.

Candidates:
  @openscout
  @openscout.codex

Bind one:
  scout auth use @openscout --project .
```

The broker should return structured error fields so CLI, AgentX, and native
surfaces can render good remediation without string parsing.

## 19. Relationship To Existing Identity Docs

`docs/agent-identity.md` defines how Scout resolves target agent handles.
This proposal defines how Scout resolves the calling and sending actor.

The two should stay separate:

- target address grammar answers "who should receive this?"
- actor-bound auth answers "who is allowed to do this?"
- sender resolution answers "who should be recorded as speaking?"

When those are clear, body mentions stay payload, routing fields stay explicit,
and credentials stop leaking into message composition.

## 20. Non-Goals

- claiming enterprise-grade multi-tenant security
- defining a full organization RBAC product
- replacing all local high-trust flows on day one
- requiring OAuth for local pilots
- making agents paste token strings into prompts
- storing raw token values in broker records
- making `--as` or `--from` illegal for explicit override/debugging

## 21. Implementation Sequence

1. Document the actor, caller, sender, target, and delegation vocabulary in
   protocol docs.
2. Add credential classes and action/resource scope types to the shared
   protocol.
3. Make broker APIs return the resolved sender and sender source in receipts.
4. Update `scout whoami` to show credential subject, sender source, project
   binding, scopes, and conflicts.
5. Add project actor binding commands such as `scout auth use <actor>
   --project .`.
6. Add credential list, revoke, rotate, and audit read models.
7. Move node pairing toward keypair-backed node credentials.
8. Mint agent adapter credentials that infer sender identity from the token.
9. Teach AgentX and native surfaces to display actor source and auth decisions
   using structured broker fields.
10. Keep `--as` and any `--from` compatibility alias as explicit override
    paths with clear authorization checks and audit.

## 22. Open Questions

- Should the public CLI keep only `--as`, or should `--from` remain as a
  compatibility alias for users who think in sender/recipient terms?
- How much sender delegation should an operator token get by default in local
  pilot mode?
- Should agent credentials be bearer tokens initially and signed request
  credentials later, or should adapter setup start with keypairs too?
- Where should local secure storage live for CLI and AgentX credentials across
  macOS, iOS, and headless nodes?
- What is the smallest audit UI that makes token decisions understandable
  without making the product feel like an admin console?
