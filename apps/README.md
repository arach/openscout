# Apps Directory Map

This folder currently mixes product surfaces with different roles:

- `api` — Next.js API app used for OpenScout feedback ingestion and review UI (`/api/feedback`, `/feedback`).
- `ios` — Scout iOS client app.
- `macos` — native macOS menu bar shell for broker state, pairing, and launch affordances.
- `scout` — Scout desktop app + host/runtime integration.

## Why this feels uneven

`scout` is a product name, while `api` and `ios` are platform/function names.
That makes navigation harder because naming categories are mixed.

## Suggested naming direction

Use one naming scheme consistently:

- Option A (platform-first):
  - `desktop`
  - `ios`
  - `api`
- Option B (product-first):
  - `scout-desktop`
  - `scout-ios`
  - `scout-api`

Until rename is complete, treat:

- `apps/desktop` as desktop
- `apps/ios` as iOS
- `apps/cloud` as feedback API surface
