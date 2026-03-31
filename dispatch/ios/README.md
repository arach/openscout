## Dispatch iOS

This directory contains the imported iOS donor app that previously lived in an
external repo.

Status:
- imported intact first to preserve behavior
- internal names are now Dispatch-aligned
- additional product refactors will land in-place

Expected migration order:
1. user-facing copy and product identity
2. product semantics such as partner surface and inbox/work-state flows
3. deeper internal renames once behavior is stable in OpenScout

Project notes:
- XcodeGen project definition: [project.yml](/Users/arach/dev/openscout/dispatch/ios/project.yml)
- donor source root: [Dispatch](/Users/arach/dev/openscout/dispatch/ios/Dispatch)
