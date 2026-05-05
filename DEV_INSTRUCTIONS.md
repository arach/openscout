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

The other configured machine already has the Cloudflare/APNs secrets. If you are
continuing deployment there, verify these Worker secrets exist:

```bash
bunx wrangler secret list --cwd apps/mesh-front-door
```

Required secrets:

- `OPENSCOUT_PUSH_RELAY_TOKEN`
- `OPENSCOUT_PUSH_TOKEN_ENCRYPTION_KEY`
- `OPENSCOUT_APNS_TEAM_ID`
- `OPENSCOUT_APNS_KEY_ID`
- `OPENSCOUT_APNS_PRIVATE_KEY`

`OPENSCOUT_PUSH_TOKEN_ENCRYPTION_KEY` is a base64url-encoded 32-byte AES-GCM key.
The local broker/runtime opts into the relay with:

- `OPENSCOUT_PUSH_RELAY_URL`, usually `https://push.oscout.net` or the deployed
  push route on `oscout.net`
- `OPENSCOUT_PUSH_RELAY_TOKEN`, matching the Worker secret
- `OPENSCOUT_PUSH_RELAY_MESH_ID`, defaulting to `openscout`

Before deployment or handoff, run:

```bash
bun run --cwd apps/mesh-front-door check
bun test apps/mesh-front-door/test/*.test.ts
npm --prefix packages/runtime run check
bun test packages/runtime/src/mobile-push.test.ts
```

Cloudflare migration to apply: `apps/mesh-front-door/migrations/0002_push_relay.sql`.
Operational docs live in `apps/mesh-front-door/README.md`.
