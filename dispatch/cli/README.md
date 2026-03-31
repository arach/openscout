## Dispatch CLI

`dispatch/cli` is reserved for product-facing command surfaces that belong to
Dispatch itself.

This is distinct from:
- Relay infrastructure CLIs
- OpenScout maintenance CLIs
- harness-specific developer tools

The intent here is a user-facing surface for Dispatch workflows such as:
- checking active asks
- watching work state
- jumping into partner or inbox contexts
- surfacing agent communication status without exposing raw broker mechanics
