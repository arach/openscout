# SCO-047: Cursor Transport Spike

Status: spike complete (2026-05-23).

## Goal

Evaluate parallel local Cursor harness transports before picking a single
adapter shape. This spike intentionally keeps multiple transport modes alive so
Scout can compare:

- `cursor_cli_text`
- `cursor_cli_stream_json`
- `cursor_sdk_local`
- `cursor_sdk_local_no_key`

Cloud/background agents are out of scope for this spike.

## Run It

Install SDK deps for the isolated spike workspace, then run:

```bash
npm install --prefix scripts/cursor-transport-spike
npm install --prefix packages/runtime --save-dev @cursor/sdk@1.0.13
```

Then run all default modes:

```bash
bun scripts/cursor-transport-spike.mjs --cwd /Users/arach/dev/openscout
```

Run one mode:

```bash
bun scripts/cursor-transport-spike.mjs \
  --cwd /Users/arach/dev/openscout \
  --mode cursor_cli_stream_json
```

JSON output:

```bash
bun scripts/cursor-transport-spike.mjs --json
```

Auth resolution order:

1. `CURSOR_API_KEY` env var
2. `~/.cursor/api_key.env`
3. explicit no-key modes (`cursor_sdk_local_no_key`, CLI without `--api-key`)

## Findings (local machine)

| Mode | Result | Notes |
| --- | --- | --- |
| `cursor_cli_text` | Works with API key | ~7s one-shot; fails without key (`Authentication required`) |
| `cursor_cli_stream_json` | Works with API key | Claude-like NDJSON; `system/init`, `assistant` deltas, `result/success` |
| `cursor_sdk_local_no_key` | Fails | `AuthenticationError: unauthenticated` |
| `cursor_sdk_local` | Works with API key | Persistent agent id; multi-turn + `Agent.resume()` verified |

### Auth model gap

`cursor-agent status` can report login success, but headless `--print` still
requires either:

- `CURSOR_API_KEY` / `--api-key`, or
- an interactive login flow

For Scout's developer harness path, treat **CLI/API key** and **SDK/API key**
as the reliable local paths today. Subscription login alone is not enough for
headless invoke in this spike.

### Billing question

Both CLI (`--api-key`) and SDK local runs authenticated via user API key
completed successfully. Cursor documents SDK usage as billable under the same
pools as IDE/cloud runs. Treat API-key-backed local spikes as **metered** until
Cursor documents a separate local-subscription bypass.

`Cursor.me()` returned an empty object in this spike, so we did not get a useful
account/budget readback from the SDK.

### Codex-style RPC?

`@cursor/sdk@1.0.13` does not expose a public `CursorClient.launchBridge()`
helper in the published package exports. The practical local RPC analogue is
`Agent.create()` with an auto-managed bridge process. That behaves like Codex
app-server in capability (persistent agent, stream, resume), but not in wire
format (Connect RPC behind the SDK).

## Code

- Protocol transport modes: `packages/protocol/src/cursor-transport.ts`
- Spike runners: `packages/runtime/src/cursor-transport-spike/`
- CLI entrypoint: `scripts/cursor-transport-spike.mjs`

## Next Step

Pick transport defaults per agent card/profile:

- developer local harness default: `cursor_cli_stream_json` when API key present
- persistent multi-turn observer path: `cursor_sdk_local`
- keep `cursor_sdk_local_no_key` as an explicit probe until Cursor documents
  login-backed headless auth
