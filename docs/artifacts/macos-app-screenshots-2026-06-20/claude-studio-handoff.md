# Claude / Studio design handoff: Scout macOS current-state capture

Project: `/Users/arach/dev/openscout`

Screenshot index: `docs/artifacts/macos-app-screenshots-2026-06-20/README.md`

Screenshots:

- `docs/artifacts/macos-app-screenshots-2026-06-20/01-comms.jpeg`
- `docs/artifacts/macos-app-screenshots-2026-06-20/02-agents.jpeg`
- `docs/artifacts/macos-app-screenshots-2026-06-20/03-repos.jpeg`
- `docs/artifacts/macos-app-screenshots-2026-06-20/04-tail.jpeg`
- `docs/artifacts/macos-app-screenshots-2026-06-20/05-settings-appearance.jpeg`
- `docs/artifacts/macos-app-screenshots-2026-06-20/06-settings-about.jpeg`

Request:

Bring these current-state Scout macOS screenshots into Studio as a design baseline and help plan a step-by-step augmentation of the app's beauty and quality level.

Focus:

1. Start high-level: compare the five surfaces as one product shell, not isolated screens.
2. Identify the most visible quality gaps in hierarchy, density, spacing, typography, contrast, selection states, and right-side context panels.
3. Propose an ordered improvement path that can be applied incrementally without broad churn.
4. Treat Agents and Repos as contextual captures: each intentionally has a selected row so the right-side inspector/context panel is visible.
5. Treat Tail as a live-state capture: it includes the screenshot workflow in the event stream.
6. Treat the stale `Starting` pending row in Comms as a live-state artifact; source has already been patched so completed pending rows clear.

Output requested:

- A concise design-review brief with ranked opportunities.
- A Studio-oriented step plan: first pass, second pass, third pass.
- Concrete per-surface recommendations tied to the screenshots.
- Any implementation cautions before changing SwiftUI/HudsonShell styling.

Do not modify files yet unless the operator explicitly asks for an implementation pass.
