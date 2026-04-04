---
name: url-endpoints
description: >-
  Defines how URL and HTTP endpoint strings should appear in code: centralize
  literals, separate configurable bases from fixed paths, and avoid secrets in
  source. Use when adding fetch/axios clients, WebSocket URLs, webhooks, OpenAPI
  bases, reviewing PRs for hardcoded URLs, or when the user asks about URL
  configuration policy.
---

# URL and endpoint literals in code

## Principle

**“Never hardcode URLs”** means: no **scattered** magic strings and no **deployment-specific** hosts in random files. Some literals are normal when they are **stable, documented, and singular**.

## Categories

### 1. Configurable “where” (never duplicate in logic)

- Broker / backend **host and port**
- API **base URL** per environment (staging, prod)
- **WebSocket** origins
- **Redirect / webhook** URLs that change per deploy

**Pattern:** read from environment, config file, or dependency-injected options; build requests with `new URL(relativePath, base)` or the client’s base URL option.

### 2. Fixed “what path” (your contract)

- REST paths on **your** server (`/v1/snapshot`, `/health`)
- GraphQL single endpoint path if fixed

**Pattern:** one exported `const` object (e.g. `brokerPaths.v1.snapshot`) or a `paths.ts` module used by all callers. Document alignment with the server implementation (file path or comment).

### 3. Stable vendor URLs

- Public **documented** endpoints (`https://api.openai.com/v1/...`)

**Pattern:** one named constant per vendor surface (`openAiAudioSpeechUrl`). Optional: later move to a small `vendor-urls.ts` if many accumulate.

### 4. Product / marketing URLs

- Canonical site, docs, repo links in UI

**Pattern:** constants or a `links.ts` / content module so copy and URLs stay consistent.

## Anti-patterns

- Same `https://…` string in three files—**consolidate**.
- `localhost` or internal hostnames in non-test production code without reading from config.
- Building URLs by string concat of user input without validation (`URL` or allowlist).

## Review checklist

1. Grep the change for `http://` and `https://`.
2. Each hit: single definition, test-only, or documented exception?
3. New paths to **your** API: added next to existing path constants and matched to server routes?
4. No credentials or long-lived tokens in URL strings in source.

## Related patterns in this repo

- Scout broker HTTP paths: `apps/scout/src/core/broker/paths.ts` aligned with `packages/runtime/src/broker-daemon.ts` routing.
