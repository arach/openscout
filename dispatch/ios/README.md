## Dispatch iOS

This directory contains the imported iOS donor app that previously lived in the
Plexus repo.

Status:
- imported intact first to preserve behavior
- still contains many `Plexus` internal type and path names
- being soft-rebranded toward `Dispatch` from the outside in

Expected migration order:
1. user-facing copy and product identity
2. product semantics such as partner surface and inbox/work-state flows
3. deeper internal renames once behavior is stable in OpenScout

Project notes:
- XcodeGen project definition: [project.yml](/Users/arach/dev/openscout/dispatch/ios/project.yml)
- donor source root: [Plexus](/Users/arach/dev/openscout/dispatch/ios/Plexus)
