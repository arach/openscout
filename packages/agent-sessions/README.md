# OpenScout Agent Sessions

`@openscout/agent-sessions` is the shared session capability substrate for
OpenScout.

It owns:

- protocol primitives and adapter types
- adapter implementations
- in-memory session state and replay helpers
- `SessionRegistry`
- a browser-safe `./client` boundary for trace consumers

`./client` is intentionally narrower than the package root. It exposes only
browser-safe protocol, snapshot, event, and approval helper types so web and
mobile trace consumers can avoid pulling in registry or adapter code paths.
