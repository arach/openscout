# Landing Site

This is the public OpenScout landing and docs site. It is a Next.js app that
publishes product pages, docs pages, generated Open Graph images, and public
agent-facing context files.

## Main Paths

| Path | Purpose |
| --- | --- |
| `src/app` | Next.js routes and page UI |
| `content` | Markdown content used by the site |
| `public` | Static assets, generated LLM context, and public metadata |
| `scripts` | Site-specific generation scripts |
| `patches` | Package patches applied by Bun |

## Common Commands

```bash
bun install
bun run dev
bun run build
```

From the repo root, use:

```bash
bun run landing:dev
bun run landing:build
```

## Related Docs

- [`../docs/README.md`](../docs/README.md) for the product documentation map
- [`../docs/current-posture.md`](../docs/current-posture.md) for maturity and trust boundaries
- [`../docs/integrations.md`](../docs/integrations.md) for standalone host integrations
