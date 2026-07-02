# OpenScout Cloud

Small Next.js app for OpenScout-hosted API and review surfaces. Today it handles
feedback reports, intent capture, and lightweight admin views backed by Vercel
Blob. It is not the canonical broker, mesh directory, or local control plane.

Keep claims here aligned with the repo posture: OpenScout is for high-trust
local developer pilots. Cloud-hosted collection endpoints should support that
pilot loop without implying managed enterprise deployment or compliance
readiness.

## What Lives Here

- `src/app/api/feedback` accepts structured feedback reports.
- `src/app/api/report` stores diagnostic reports from app surfaces.
- `src/app/api/intent` captures interest/intent submissions.
- `src/app/feedback` and `src/app/intents` render simple review views.
- `src/lib/feedback*.ts` and `src/lib/intent-capture.ts` normalize and store
  Vercel Blob records.

## Local Commands

From the repo root:

```bash
bun run --cwd apps/cloud dev
bun run --cwd apps/cloud check
bun run --cwd apps/cloud build
```

The development server uses port `3300`.

## Configuration

Storage uses `@vercel/blob`, so local or deployed runs need the Vercel Blob
environment expected by that SDK. Feedback URL helpers read these optional
overrides before falling back to `https://api.openscout.app`:

- `OPENSCOUT_FEEDBACK_BASE_URL`
- `OPENSCOUT_REPORTS_BASE_URL`
- `NEXT_PUBLIC_OPENSCOUT_FEEDBACK_BASE_URL`
- `NEXT_PUBLIC_OPENSCOUT_REPORTS_BASE_URL`

## Read Next

- [Root README](../../README.md) for the product overview.
- [Current posture](../../docs/current-posture.md) for trust and maturity
  limits.
- [Data model](../../docs/architecture.md#the-data-model) before adding persistence that
  could be confused with broker-owned coordination records.
