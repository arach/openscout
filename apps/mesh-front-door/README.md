# OpenScout Mesh Front Door

Cloudflare Worker rendezvous service for OpenScout Mesh.

This service stores short-lived node presence only. It does not store broker
messages, conversations, flights, collaboration records, or replay state.

## Routes

- `GET /health`
- `POST /v1/presence`
- `GET /v1/nodes?meshId=openscout`
- `GET /v1/nodes/:nodeId?meshId=openscout`
- `DELETE /v1/nodes/:nodeId?meshId=openscout`

Cloudflare Access should protect the deployed hostname. The Worker trusts Access
identity headers and also supports a shared bearer token for the initial node
publisher path via `OPENSCOUT_MESH_SHARED_TOKEN`.

`OPENSCOUT_MESH_DIRECTORY_OWNER` makes this first deployment intentionally
single-tenant: human Access requests and node publisher token requests share the
same directory. Remove that var later when managed multi-tenant account scoping
lands.

Use Wrangler secrets for sensitive values:

```bash
bunx wrangler secret put OPENSCOUT_MESH_SHARED_TOKEN
bunx wrangler secret put OPENSCOUT_MESH_SHARED_OWNER
```
