# OpenScout Runtime

`@openscout/runtime` is the runtime-side foundation for the new OpenScout control
plane.

This package does not implement a full broker yet. It defines the first concrete
runtime primitives needed to build one:

- agent registry records
- SQLite schema
- delivery planning
- service contracts for a local broker

The intent is:

- `@openscout/protocol` defines the language
- `@openscout/runtime` defines how that language is stored and executed locally
- the old Relay package becomes just one surface and compatibility path
