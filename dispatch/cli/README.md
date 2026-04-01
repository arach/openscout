## Dispatch CLI

`dispatch/cli` is reserved for product-facing command surfaces that belong to
Dispatch itself.

This is distinct from:
- Relay infrastructure CLIs
- OpenScout maintenance CLIs
- harness-specific developer tools

Current starter slice:
- `bun run dispatch:status`
  - reads the canonical Dispatch config and identity paths under `~/.dispatch`
- `bun run dispatch:config`
  - prints the current Dispatch config JSON
- `bun run dispatch:pair`
  - starts pair mode, emits a fresh QR payload, and keeps the relay room live

This is the backend control layer for the Electron Dispatch tab.

Near-term direction:
- checking active asks
- watching work state
- jumping into partner or inbox contexts
- surfacing agent communication status without exposing raw broker mechanics
