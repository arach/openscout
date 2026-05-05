# OpenScout Mesh Front Door

Cloudflare Worker rendezvous service for OpenScout Mesh.

This service stores short-lived node presence only. It does not store broker
messages, conversations, flights, collaboration records, or replay state.

## Routes

- `GET /health`
- `GET /v1/auth/github/start`
- `GET /v1/auth/github/callback`
- `GET /v1/auth/session`
- `POST /v1/auth/logout`
- `GET /v1/meshes`
- `POST /v1/presence`
- `GET /v1/nodes?meshId=openscout`
- `GET /v1/nodes/:nodeId?meshId=openscout`
- `DELETE /v1/nodes/:nodeId?meshId=openscout`
- `GET /v1/push/health` (unauthenticated)
- `POST /v1/push/devices/register` (session)
- `POST /v1/push/devices/unregister` (session)
- `GET /v1/push/devices` (session)
- `POST /v1/push` (session)
- `GET /v1/push/usage` (session)
- `GET /v1/push/audit` (session)

`/v1/push/*` (other than `/health`) require an authenticated OpenScout session
bearer: `Authorization: Bearer osn_session_<token>`. The session is minted by
the existing GitHub OAuth flow (`/v1/auth/github/start`). All push-relay
operations are scoped to the session's GitHub user — a user can only register,
list, and notify their own devices. There is no shared admin token.

The managed OSN auth path uses GitHub OAuth first. The Worker asks GitHub for
only the `user:email` scope so it can read a verified account email, then stores
an OpenScout-signed session cookie. GitHub access tokens are used only during
the callback and are not stored.

Cloudflare Access is still supported for internal/admin deployments, but it
should not be the default customer auth path because Access is seat-billed. The
Worker also supports a shared bearer token for the initial node publisher path
via `OPENSCOUT_MESH_SHARED_TOKEN`.

`OPENSCOUT_MESH_DIRECTORY_OWNER` makes this first deployment intentionally
single-tenant: human Access requests and node publisher token requests share the
same directory. Remove that var later when managed multi-tenant account scoping
lands.

Use Wrangler secrets for sensitive values:

```bash
bunx wrangler secret put OPENSCOUT_GITHUB_CLIENT_ID
bunx wrangler secret put OPENSCOUT_GITHUB_CLIENT_SECRET
bunx wrangler secret put OPENSCOUT_SESSION_SECRET
bunx wrangler secret put OPENSCOUT_MESH_SHARED_TOKEN
bunx wrangler secret put OPENSCOUT_MESH_SHARED_OWNER
bunx wrangler secret put OPENSCOUT_PUSH_TOKEN_ENCRYPTION_KEY
bunx wrangler secret put OPENSCOUT_APNS_TEAM_ID
bunx wrangler secret put OPENSCOUT_APNS_KEY_ID
bunx wrangler secret put OPENSCOUT_APNS_PRIVATE_KEY < AuthKey_XXXX.p8
```

`OPENSCOUT_PUSH_TOKEN_ENCRYPTION_KEY` must be a base64url-encoded 32-byte key.
The Push Relay stores APNs device tokens encrypted in D1 and sends generic APNs
alert text only; detailed Scout state remains behind the user's paired local
broker.

### Push Relay defensive controls

All limits below have sensible defaults and are tunable via `vars` in
`wrangler.jsonc` — set them to override:

| Var | Default | What it caps |
|---|---|---|
| `OPENSCOUT_PUSH_MAX_DEVICES_PER_USER` | 50 | Devices a single GitHub user can register |
| `OPENSCOUT_PUSH_RATE_PER_MINUTE` | 10 | Sends per user per minute |
| `OPENSCOUT_PUSH_RATE_PER_HOUR` | 100 | Sends per user per hour |
| `OPENSCOUT_PUSH_RATE_PER_DAY` | 500 | Sends per user per day |
| `OPENSCOUT_PUSH_DEVICE_RATE_PER_MINUTE` | 3 | Sends per device per minute |
| `OPENSCOUT_PUSH_MAX_BODY_BYTES` | 16384 | Request body size (`Content-Length`) |
| `OPENSCOUT_PUSH_MAX_CUSTOM_PAYLOAD_BYTES` | 1024 | Sanitized `scout` payload size |
| `OPENSCOUT_PUSH_AUDIT_RETENTION_DAYS` | 30 | Days the audit log is retained |

When a rate limit trips, the relay returns `429` with a `Retry-After` header,
an `x-ratelimit-window` header (`user_minute` / `user_hour` / `user_day` /
`device_minute`), and a JSON body with `retryAfterSeconds`. Every register,
unregister, send, and denial is recorded in `osn_push_audit_log` and is
visible to the authenticated user via `GET /v1/push/audit`.

The GitHub OAuth app callback URL should be:

```text
https://mesh.oscout.net/v1/auth/github/callback
```

For iOS, start GitHub sign-in with:

```text
https://mesh.oscout.net/v1/auth/github/start?return_to=/v1/auth/native/complete
```

GitHub still returns to the single HTTPS callback above; the Worker then returns
the OpenScout session to the app with `openscout://osn-auth`.
