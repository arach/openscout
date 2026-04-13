# Telegram Bridge Ownership

Status: accepted and implemented

## Problem

Telegram polling is singleton external I/O. When two OpenScout nodes poll the same bot token, Telegram terminates one poller with a `getUpdates` conflict. That creates a mesh bug where external comms can work once and then silently stop.

## Narrow Decision

For Telegram only, OpenScout now uses a single bridge owner:

- `bridges.telegram.ownerNodeId`
  - if set, only that node is allowed to poll Telegram
- if unset, nodes derive the same owner automatically
  - choose the lexicographically smallest recently-seen node in the mesh
- non-owner nodes stay enabled but enter standby
  - they do not poll Telegram
  - they still show status in the app

## Why This Slice

- fixes the real failure mode without inventing a full bridge-leasing protocol first
- stays close to current Relay semantics
- leaves room for a later first-class bridge lease/authority model

## Implementation

- canonical settings: `packages/runtime/src/setup.ts`
- desktop settings UI: `apps/desktop/src/web/app/components/communication-settings-view.tsx`
- desktop Telegram bridge owner election: `apps/desktop/src/core/telegram/bindings.ts`

## Follow-Up

If this pattern holds, generalize it into a first-class mesh bridge authority mechanism for Telegram, webhooks, voice, and other singleton external transports.
