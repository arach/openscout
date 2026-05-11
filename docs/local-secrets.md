# Local secrets

Credentials this project needs at the workstation live in the macOS login
keychain via the `secret` CLI (`/Users/arach/.local/bin/secret`). The
keychain is the source of truth; `.env` is only for ad-hoc overrides.

| Key                     | Used by                  | What it is                                  |
| ----------------------- | ------------------------ | ------------------------------------------- |
| `OPENSCOUT_NPM_TOKEN`   | `scripts/ship-npm.sh`    | npm registry token for publishing `@openscout/scout` (no 2FA prompt) |

## Conventions

- Project-scoped keys are prefixed with the project name in upper-case
  (e.g. `OPENSCOUT_NPM_TOKEN`). Workstation-wide credentials skip the prefix.
- Scripts that need a project secret should fall back to `secret get` when
  the corresponding env var is unset, e.g.

  ```bash
  if [[ -z "${NPM_TOKEN:-}" ]] && command -v secret >/dev/null 2>&1; then
    NPM_TOKEN="$(secret get OPENSCOUT_NPM_TOKEN 2>/dev/null || true)"
  fi
  ```

## Common operations

```bash
secret list                          # show all stored keys
secret get OPENSCOUT_NPM_TOKEN       # print value to stdout
secret set OPENSCOUT_NPM_TOKEN       # interactive prompt (no echo)
secret unset OPENSCOUT_NPM_TOKEN     # delete from keychain
```

When you rotate a token at its source, re-run `secret set` to overwrite the
stored value. When you add a new project secret, append a row to the table
above.
