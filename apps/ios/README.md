## Scout iOS

This directory contains the restored iOS app that is now being refactored into
the Scout mobile client.

Status:
- restored intact first to preserve behavior
- product identity is now Scout
- deeper internal renames will land in-place

Expected migration order:
1. user-facing copy and product identity
2. product semantics such as partner surface and inbox/work-state flows
3. deeper internal renames once behavior is stable in Scout

Project notes:
- XcodeGen project definition: [project.yml](/Users/arach/dev/openscout/apps/ios/project.yml)
- source root: [Scout](/Users/arach/dev/openscout/apps/ios/Scout)
