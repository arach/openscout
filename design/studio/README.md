# OpenScout Studio

Internal planning + design surface for OpenScout. Sits next to the
codebase, not in front of the public landing site. A sibling to
`talkie/design/studio` — same shell, same vocabulary, scout-flavored
content.

Three buckets:

- **Plans** — markdown plans under `plans/` at the repo root. Frontmatter
  drives status pill + sidebar dot. Add a file, refresh, it appears.
- **Studies** — inline React mockups for openscout UI exploration. Each
  study is a Next route; surfaces ground them (web / iOS / macOS).
- **Atoms** — live-rendered web primitives. The home for proposed shared
  components (e.g. `InspectorSection`) before they land in
  `packages/web/client`.

## Running

```sh
cd design/studio
bun install
bun run dev        # → http://localhost:3030
```

`?focus=1` on any page strips the sidebar + page strip for screenshots /
presentation.

## Layout

```
design/studio/
├── app/
│   ├── layout.tsx                    # root shell, reads plans/
│   ├── globals.css                   # studio prose + chrome tokens
│   ├── page.tsx                      # landing — plans + studies + atoms
│   ├── plans/
│   │   ├── page.tsx                  # plans index
│   │   └── [slug]/page.tsx           # render a single plan
│   ├── studies/
│   │   └── inspector-bar/page.tsx    # seed study
│   └── atoms/
│       ├── page.tsx
│       └── inspector-section/page.tsx
├── components/
│   ├── StudioShell.tsx
│   ├── StudioSidebar.tsx             # 220px persistent left rail
│   └── PageStrip.tsx                 # per-page header strip
└── lib/
    ├── studio-pages.ts               # static page registry
    ├── plans.ts                      # filesystem reader for ../../plans/
    └── utils.ts
```

## Adding content

### A new plan

1. Create `plans/<slug>.md` at the repo root.
2. Frontmatter (all optional):

   ```yaml
   ---
   title: Inspector atom rollout
   status: in-flight        # draft | in-flight | shipped | shelved | concept
   blurb: Two-PR plan to extract shared inspector atoms.
   source:
     - docs/inspector-bar-audit.md
   order: 10                # ascending; lower floats to top
   ---
   ```

3. That's it — the sidebar picks it up server-side on next render.

### A new study

1. Create `app/studies/<slug>/page.tsx`.
2. Append a `StudioPage` entry to `lib/studio-pages.ts` with
   `bucket: "studies"` and a `surface`.

### A new atom

1. Create `app/atoms/<slug>/page.tsx`.
2. Append a `StudioPage` entry to `lib/studio-pages.ts` with
   `bucket: "atoms"`.

## Conventions

- **Display = Newsreader, body = Inter, chrome = JetBrains Mono.** Loaded
  from Google Fonts in `app/layout.tsx`.
- **Status vocabulary.** `draft → in-flight → shipped`, with `shelved`
  and `concept` as side states. Use these consistently across plans,
  studies, and atoms so the sidebar dots read predictably.
- **Source refs.** When a plan or study mirrors something concrete in
  the codebase, add `source: [path/to/file.tsx]` so the page strip
  shows it. The studio is for picking; the codebase is for shipping.
- **No public bundle leak.** This is internal. Do not link to it from
  the public landing — it shares no dependencies with `landing/` on
  purpose.
