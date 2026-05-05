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
- `GET /v1/push/health`
- `POST /v1/push/devices/register`
- `POST /v1/push/devices/unregister`
- `GET /v1/push/devices`
- `POST /v1/push`
- `GET /v1/push/usage`

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
bunx wrangler secret put OPENSCOUT_PUSH_RELAY_TOKEN
bunx wrangler secret put OPENSCOUT_PUSH_TOKEN_ENCRYPTION_KEY
bunx wrangler secret put OPENSCOUT_APNS_TEAM_ID
bunx wrangler secret put OPENSCOUT_APNS_KEY_ID
bunx wrangler secret put OPENSCOUT_APNS_PRIVATE_KEY
```

`OPENSCOUT_PUSH_TOKEN_ENCRYPTION_KEY` must be a base64url-encoded 32-byte key.
The Push Relay stores APNs device tokens encrypted in D1 and sends generic APNs
alert text only; detailed Scout state remains behind the user's paired local
broker.

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
