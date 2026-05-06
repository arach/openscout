# Dev Instructions

- Always solve root cause before looking for workarounds and quick fixes.
- For iOS device build and deploy flows, do not guess the "latest build" by scanning DerivedData.
- If a script needs to reuse a prior iOS build, use an explicit, stable `xcodebuild -derivedDataPath` owned by the repo workflow so the output path is deterministic.

## OpenScout Push Relay Handoff

OpenScout Push Relay is implemented in `apps/mesh-front-door` under the
`/v1/push/*` routes. It is the official `oscout.net`-mediated APNs path:
APNs provider credentials live in Cloudflare secrets, local machines never get
the APNs private key, and APNs alert text must stay generic. Do not send prompts,
agent output, file paths, command output, or failure details through APNs custom
payloads; send opaque IDs and let the paired local broker provide detail after
the app opens.

### Trust model

`/v1/push/*` (except `/v1/push/health`) require an authenticated OpenScout
session bearer:

```
Authorization: Bearer osn_session_<token>
```

The session is the same one minted by `/v1/auth/github/start` — i.e. the
GitHub OAuth flow already used by the rest of the worker. Every push-relay
operation is scoped to `session.providerUserId` (the immutable GitHub user
id). A user can only register, list, and notify their own devices. There is
no shared admin bearer.

### Required Cloudflare Worker secrets

```bash
bunx wrangler secret put OPENSCOUT_PUSH_TOKEN_ENCRYPTION_KEY   # base64url 32 bytes
bunx wrangler secret put OPENSCOUT_APNS_TEAM_ID
bunx wrangler secret put OPENSCOUT_APNS_KEY_ID
bunx wrangler secret put OPENSCOUT_APNS_PRIVATE_KEY < AuthKey_XXXX.p8
```

Pipe the `.p8` PEM in via stdin so newlines survive — pasting on one line
breaks ECDSA key import.

`OPENSCOUT_SESSION_SECRET` is shared with the rest of the worker (auth, mesh
front door) and is what mints the session bearers the Push Relay validates.

### Defensive controls (all configurable, all enforced server-side)

Defaults are baked in but every limit reads from a Worker var so we can tune
without code changes:

- `OPENSCOUT_PUSH_MAX_DEVICES_PER_USER` (default 50)
- `OPENSCOUT_PUSH_RATE_PER_MINUTE` (default 10)
- `OPENSCOUT_PUSH_RATE_PER_HOUR` (default 100)
- `OPENSCOUT_PUSH_RATE_PER_DAY` (default 500)
- `OPENSCOUT_PUSH_DEVICE_RATE_PER_MINUTE` (default 3)
- `OPENSCOUT_PUSH_MAX_BODY_BYTES` (default 16384)
- `OPENSCOUT_PUSH_MAX_CUSTOM_PAYLOAD_BYTES` (default 1024)
- `OPENSCOUT_PUSH_AUDIT_RETENTION_DAYS` (default 30)

Rate limits return HTTP `429` with a `Retry-After` header, an
`x-ratelimit-window` header naming the window that tripped, and a JSON body
with `retryAfterSeconds`. The broker's `MobilePushBroadcastResult` surfaces
these via `rateLimited`, `rateLimitWindow`, and `retryAfterSeconds`.

Every state-changing call and every denial is written to `osn_push_audit_log`
and is visible to the authenticated user at `GET /v1/push/audit`.

### Local broker config

The local broker opts into the relay with:

- `OPENSCOUT_PUSH_RELAY_URL` — usually `https://mesh.oscout.net`
- `OPENSCOUT_PUSH_RELAY_SESSION` — the user's `osn_session_*` token (mint via
  `https://mesh.oscout.net/v1/auth/github/start?return_to=/v1/auth/native/complete`
  and copy the `session` query param from the resulting `openscout://osn-auth` URL)
- `OPENSCOUT_PUSH_RELAY_MESH_ID` — optional, recorded for routing only; no longer
  the trust boundary

### Deploy checklist

```bash
bun run --cwd apps/mesh-front-door check
bun test apps/mesh-front-door/test/push-relay.test.ts
npm --prefix packages/runtime run check
bun test packages/runtime/src/mobile-push.test.ts

# Apply the migration to D1 (required — the v1 schema is incompatible).
bunx wrangler d1 migrations apply openscout-osn

# Deploy.
bun run --cwd apps/mesh-front-door deploy
```

Migrations to apply:
- `apps/mesh-front-door/migrations/0002_push_relay.sql`
- `apps/mesh-front-door/migrations/0003_push_relay_user_scoping.sql`

Operational docs live in `apps/mesh-front-door/README.md`.
