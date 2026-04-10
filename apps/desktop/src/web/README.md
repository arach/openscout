The desktop renderer web app lives here.

Subareas:
- `app/` routing, shell composition, and renderer-local modules
- `features/` renderer feature modules

Rules:
- `web/` is the canonical home for React renderer code.
- Shared product logic still belongs in `src/core`.
- Electron and host integration stay in `src/app`.
