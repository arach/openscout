# Dev Instructions

- Always solve root cause before looking for workarounds and quick fixes.
- For iOS device build and deploy flows, do not guess the "latest build" by scanning DerivedData.
- If a script needs to reuse a prior iOS build, use an explicit, stable `xcodebuild -derivedDataPath` owned by the repo workflow so the output path is deterministic.
