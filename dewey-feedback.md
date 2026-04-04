# Dewey Integration Feedback

Feedback from integrating `@arach/dewey@0.3.4` into an existing Next.js site (openscout.app).

## What worked well

- **`dewey create` is fast** — one command scaffolded a full Astro docs site with Pagefind search from markdown files.
- **CSS variable namespacing** — `--dw-*` prefix means Dewey tokens don't conflict with the host site's design system. Dark mode picked up via `.dark` class automatically.
- **Component API is clean** — `DocsLayout`, `MarkdownContent`, `Sidebar`, `TableOfContents` have clear typed props.
- **Agent communication via relay** — asking the dewey agent for integration guidance worked perfectly and gave the right answer (use components directly, not `dewey create`).

## Friction points

### 1. No embed path — only standalone sites
`dewey create` generates a standalone Astro or Next.js project. If you already have a site and want to add docs, the answer is "use the component library directly" — but this isn't documented anywhere. Had to ask the dewey agent to learn this.

**Suggestion:** Add an "Embedding into an existing site" guide. The component library approach is the right answer but not discoverable.

### 2. `DocsLayout` export mismatch
The `.d.ts` declares `export default function DocsLayout(...)` but the actual JS exports it as a named export (`export { DocsLayout }`). This causes Turbopack/Next.js to fail with "Export default doesn't exist in target module."

**Fix needed:** Either make the JS match the types (actual default export) or fix the `.d.ts` to declare it as a named export.

### 3. `dewey generate --docs-json` reads scaffold content, not real docs
After `dewey init` + `dewey generate --docs-json`, the output contained the scaffold overview.md and quickstart.md content — not the actual docs in the `docs/` directory. The `sections` config in `dewey.config.ts` controls which docs get included, but it defaults to `['overview', 'quickstart']` and there's no clear mapping between section IDs and filenames.

**Suggestion:** `dewey generate --docs-json` should index all `.md` files in `docs.path` by default, with `sections` as an optional filter.

### 4. `dewey generate -o <dir>` fails if directory doesn't exist
Throws `ENOENT` instead of creating the directory.

**Fix:** `mkdir -p` the output directory before writing.

### 5. No `--source` flag on `dewey generate`
Unlike `dewey create` which accepts `--source`, `dewey generate` always reads from the config's `docs.path`. Inconsistent CLI.

### 6. `dewey create` misses subdirectories
`dewey create --source docs` picked up `docs/*.md` but not `docs/openagents-tracks/*.md`. Had to manually copy those in.

**Fix:** Recurse into subdirectories when scanning the source.

### 7. Static export + client components = wrapper boilerplate
Dewey components use React hooks (client components), but Next.js static export requires `generateStaticParams` (server). This means every page needs a server component wrapper that passes serialized props to a client component. Not a Dewey bug per se, but a "Next.js integration guide" would save time.

### 8. `@arach/dewey/react` re-export is misleading
The `./react` export path suggests it's a React-specific entry point, but it's identical to the main `@arach/dewey` export. This adds confusion when troubleshooting import issues.

## Summary

Dewey is excellent as a standalone docs site generator (`dewey create`). The component library exists and works, but the "embed into existing site" workflow is undocumented and has packaging issues (the DocsLayout export bug). Fixing the export types and adding an embedding guide would make this much smoother.
