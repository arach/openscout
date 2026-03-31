## Dispatch

`dispatch/` is the product home for OpenScout communication surfaces.

Semantic split:
- `Scout` is the partner.
- `Relay` is the control plane.
- `Dispatch` is the operator-facing communication surface.

Current layout:
- `dispatch/ios`
  - imported donor slice from the former Plexus iOS app
  - intentionally kept close to the source layout first
- `dispatch/cli`
  - future product-facing command surface for Dispatch workflows
- `dispatch/electron`
  - future product-facing desktop surface layered on the existing Electron app

Near-term refactor goals:
- rebrand user-facing iOS copy from Plexus to Dispatch
- introduce a primary partner surface instead of a purely session-first home
- align bridge, work-state, and inbox flows with OpenScout semantics
- define how Dispatch shows up inside Electron without creating a second desktop lineage
