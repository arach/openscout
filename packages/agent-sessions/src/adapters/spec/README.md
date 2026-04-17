# Adapter Spec v1

This directory holds the formal OpenScout adapter contract.

The intent is to keep a machine-readable canonical spec for each adapter while
still allowing adapter-specific references and upstream evidence to live next to
the implementation.

## Files

- Schema:
  [adapter-spec.v1.schema.json](./adapter-spec.v1.schema.json)
- Validator:
  [tools/validate-adapter-specs.mjs](./tools/validate-adapter-specs.mjs)

Each adapter can ship an `adapter.spec.json` in its support directory:

- Codex:
  [../codex/adapter.spec.json](../codex/adapter.spec.json)
- Claude Code:
  [../claude-code/adapter.spec.json](../claude-code/adapter.spec.json)

## How To Use It

The formal spec is the canonical adapter contract for:

- capability comparison across adapters
- drift checks against implementation
- generated docs later
- future conformance tests

The human references and extractor output are inputs to the spec, not the spec itself.

## Validate

```bash
npm --prefix /Users/arach/dev/openscout/packages/agent-sessions run adapter:validate-specs
```
