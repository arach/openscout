# Scout Settings Contract

Scout settings are intentionally split by ownership, but each layer should follow
the precedence below. When adding a public setting, update this document and the
reader that owns the setting.

## Definition Points

| Layer | File | Owner |
| --- | --- | --- |
| Product settings | `~/Library/Application Support/OpenScout/settings.json` | `packages/runtime/src/setup.ts` via `readOpenScoutSettings` / `writeOpenScoutSettings` |
| Machine host and ports | `~/.openscout/config.json` | `packages/runtime/src/local-config.ts` |
| User identity and preferences | `~/.openscout/user.json` | `packages/runtime/src/user-config.ts` and `user-config-fields.ts` |
| Project-local agent metadata | `.openscout/project.json` | `packages/runtime/src/setup.ts`; ignored by git |
| Pairing runtime legacy overlay | `~/.scout/pairing/config.json` | Pairing runtime only; lower priority than `~/.openscout/config.json` for ports |
| Runtime host snapshot | `~/Library/Application Support/OpenScout/.host-info` | Broker/base runtime writes; native apps may read as a freshness cache |

## Declaration And Precedence

`scout setup` is the primary bootstrap command. It creates missing product
settings, local config, project metadata, and service state. `scout init` is the
focused low-level command for writing only `~/.openscout/config.json`, mostly for
manual host or port changes.

Machine service coordinates use this order:

1. Command-specific flags when a command exposes them.
2. Environment variables such as `OPENSCOUT_BROKER_PORT`,
   `OPENSCOUT_WEB_PORT`, `SCOUT_WEB_PORT`, `OPENSCOUT_PAIRING_PORT`, and
   `SCOUT_PAIRING_PORT`.
3. `~/.openscout/config.json`.
4. Legacy subsystem config when a subsystem has one, such as
   `~/.scout/pairing/config.json`.
5. Built-in defaults from `OPENSCOUT_PORTS`.

Broker clients that need the same-machine control endpoint should use
`resolveScoutBrokerControlUrl()` or `resolveScoutBrokerUrl()`, which preserves an
explicit `OPENSCOUT_BROKER_URL` and otherwise resolves through local config. The
broker service may still advertise a different mesh-reachable URL.

Operator identity uses this order:

1. `~/.openscout/user.json` `name` / `handle`.
2. `OPENSCOUT_OPERATOR_NAME` / `OPENSCOUT_OPERATOR_HANDLE`.
3. `settings.json` `profile.operatorName` for compatibility with older setup
   flows.
4. `$USER`.
5. The hardcoded `"operator"` fallback.

## Documentation Rule

Public settings need docs in the nearest user-facing file plus this contract.
Internal build, test, and harness-probe environment variables do not need to be
listed here unless they are expected to be used by operators.
