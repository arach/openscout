# Docs

This folder is the working documentation set for OpenScout. Use it as a map after the top-level README: the first group explains the current product shape, including the human surfaces that sit on the same broker/runtime as the agents, and the later groups are for deeper implementation detail, historical context, or proposals.

## Start Here

If you want the shortest path to understanding the project:

1. [`../README.md`](../README.md) for what OpenScout is and how to run it locally
2. [`quickstart.md`](./quickstart.md) for the first healthy local run and first meaningful commands
3. [`architecture.md`](./architecture.md) for the system-level control-plane model
4. [`agent-identity.md`](./agent-identity.md) for how agent names stay unambiguous
5. [`ask-scout.md`](./ask-scout.md) for the human-facing ask flow over the same system
6. [`collaboration-workflows-v1.md`](./collaboration-workflows-v1.md) for the current workflow semantics above messages and invocations
7. [`scout-agent-delegation.md`](./scout-agent-delegation.md) for the intended DM and actor-preservation pattern for one-to-one agent handoffs

## Current Orientation Docs

### Core Concepts

- [`quickstart.md`](./quickstart.md) gives the first-success path and defines the main operator-facing terms
- [`architecture.md`](./architecture.md) explains the broker-first system shape and the main control-plane terms
- [`agent-identity.md`](./agent-identity.md) explains canonical and minimal agent addresses
- [`ask-scout.md`](./ask-scout.md) explains how a human reaches their agents through Scout
- [`collaboration-workflows-v1.md`](./collaboration-workflows-v1.md) explains the question vs work-item model
- [`scout-agent-delegation.md`](./scout-agent-delegation.md) explains the correct one-to-one agent delegation workflow
- [`user-config.md`](./user-config.md) covers operator identity and local config

## Deeper Product Docs

- [`ask-scout-implementation.md`](./ask-scout-implementation.md) adds implementation detail for the ask flow
- [`native-runtime.md`](./native-runtime.md) captures historical context for the desktop-host/runtime split

## Engineering Docs And Proposals

- [`eng/README.md`](./eng/README.md) indexes implementation-facing design docs and proposals
- [`openagents-tracks/README.md`](./openagents-tracks/README.md) breaks the current OpenAgents-inspired work into implementation tracks

## Reading By Question

- "What is OpenScout trying to be?" Start with [`../README.md`](../README.md) and [`architecture.md`](./architecture.md).
- "How do I get to a first healthy run?" Start with [`quickstart.md`](./quickstart.md).
- "How do I address or route to an agent?" Read [`agent-identity.md`](./agent-identity.md).
- "How does work differ from conversation?" Read [`collaboration-workflows-v1.md`](./collaboration-workflows-v1.md).
- "Where do proposals and implementation plans live?" Start in [`eng/README.md`](./eng/README.md).
- "What should I read first as a newcomer?" Use the current orientation docs, then move to deeper product docs only if you need implementation or historical context.
