## Dispatch

`dispatch/` is the new home for the mobile communication surface that is being
brought into OpenScout.

Current status:
- `dispatch/ios` is an imported donor slice from the former Plexus iOS app.
- The import is intentionally kept close to the source layout first so the app
  can be refactored in-place without losing working behavior.
- Product semantics will shift toward:
  - `Scout` as the partner
  - `Relay` as the control plane
  - `Dispatch` as the mobile/operator surface

Near-term refactor goals:
- rebrand user-facing iOS copy from Plexus to Dispatch
- introduce a primary partner surface instead of a purely session-first home
- align bridge, work-state, and inbox flows with OpenScout semantics
