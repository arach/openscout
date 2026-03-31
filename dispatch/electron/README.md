## Dispatch Electron

`dispatch/electron` is the future product-facing desktop layer for Dispatch.

For now, the working desktop implementation continues to live in
[packages/electron-app](/Users/arach/dev/openscout/packages/electron-app).

This directory exists to make the product boundary explicit before code is
moved. The likely role of this surface is:
- Dispatch home/inbox
- partner-first navigation
- work-state and follow-up visibility
- a desktop communication surface built on top of the existing OpenScout shell
