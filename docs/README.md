# Docs

This folder is the working documentation set for OpenScout. Use it as a map after the top-level README: the first group explains the current product shape, including the human surfaces that sit on the same broker/runtime as the agents, and the later groups are for deeper implementation detail, historical context, or proposals.

## Start Here

If you want the shortest path to understanding the project:

1. [`../README.md`](../README.md) for what OpenScout is and how to run it locally
2. [`quickstart.md`](./quickstart.md) for the first healthy local run and first meaningful commands
3. [`current-posture.md`](./current-posture.md) for maturity, trust, install footprint, and license-status boundaries
4. [`architecture.md`](./architecture.md) for the system-level control-plane model
5. [`data-ownership.md`](./data-ownership.md) for what Scout owns, observes, and intentionally does not import
6. [`agent-integration-contract.md`](./agent-integration-contract.md) for the minimum contract expected from agents and adapters
7. [`integrations.md`](./integrations.md) for the current host integration map and sibling repository policy
8. [`glossary.md`](./glossary.md) for the definitive Scout vocabulary
9. [`ranger.md`](./ranger.md) for the preferred top-level orchestration agent contract
10. [`a2a-alignment.md`](./a2a-alignment.md) for Scout's A2A positioning and term mapping
11. [`agent-identity.md`](./agent-identity.md) for how agent names stay unambiguous
12. [`ask-scout.md`](./ask-scout.md) for the human-facing ask flow over the same system
13. [`collaboration-workflows-v1.md`](./collaboration-workflows-v1.md) for the current workflow semantics above messages and invocations
14. [`scout-agent-delegation.md`](./scout-agent-delegation.md) for the intended DM and actor-preservation pattern for one-to-one agent handoffs
15. [`eng/sco-015-pi-scout-integration.md`](../docs/eng/sco-015-pi-scout-integration.md) for the pi extension that makes Scout coordination native to pi sessions

## Current Orientation Docs

### Core Concepts

- [`quickstart.md`](./quickstart.md) gives the first-success path and defines the main operator-facing terms
- [`current-posture.md`](./current-posture.md) states the current maturity, trust, install-footprint, mesh, and license boundaries
- [`architecture.md`](./architecture.md) explains the broker-first system shape and the main control-plane terms
- [`data-ownership.md`](./data-ownership.md) defines the boundary between Scout-owned coordination state and observed harness source material
- [`agent-integration-contract.md`](./agent-integration-contract.md) gives coding agents and adapter authors the minimum contract for plugging into Scout
- [`integrations.md`](./integrations.md) maps host-specific Scout integrations and explains why they are linked rather than vendored by default
- [`glossary.md`](./glossary.md) defines the canonical meanings of Scout's core nouns
- [`ranger.md`](./ranger.md) defines Ranger as the preferred Codex-backed orchestration agent
- [`a2a-alignment.md`](./a2a-alignment.md) explains where Scout intentionally aligns with A2A and where it does not
- [`agent-identity.md`](./agent-identity.md) explains canonical and minimal agent addresses
- [`ask-scout.md`](./ask-scout.md) explains how a human reaches their agents through Scout
- [`collaboration-workflows-v1.md`](./collaboration-workflows-v1.md) explains the question vs work-item model
- [`scout-agent-delegation.md`](./scout-agent-delegation.md) explains the correct one-to-one agent delegation workflow
- [`user-config.md`](./user-config.md) covers operator identity and local config

## Deeper Product Docs

- [`ask-scout-implementation.md`](./ask-scout-implementation.md) adds implementation detail for the ask flow
- [`tail-firehose.md`](./tail-firehose.md) explains the machine-wide harness transcript stream for observing agent activity
- [`native-runtime.md`](./native-runtime.md) captures historical context for the desktop-host/runtime split
- [`releases.md`](./releases.md) explains the coordinated npm, DMG, GitHub release, and optional iOS ship path

## Agent-Optimized Docs

- [`../llms.txt`](../llms.txt) is the compact repo-wide LLM index
- [`../llms-full.txt`](../llms-full.txt) is the larger generated copy/paste context bundle
- [`../install.md`](../install.md) is the install/bootstrap guide with success criteria and support footprint
- [`agent/README.agent.md`](./agent/README.agent.md) is the dense project context for coding agents
- [`agent/current-posture.agent.md`](./agent/current-posture.agent.md) is the dense maturity and trust summary
- [`agent/integration-contract.agent.md`](./agent/integration-contract.agent.md) is the dense adapter and agent integration checklist

## Engineering Docs And Proposals

- [`eng/README.md`](./eng/README.md) indexes implementation-facing design docs and proposals
- [`openagents-tracks/README.md`](./openagents-tracks/README.md) breaks the current OpenAgents-inspired work into implementation tracks

## Reading By Question

- "What is OpenScout trying to be?" Start with [`../README.md`](../README.md) and [`architecture.md`](./architecture.md).
- "What data does Scout own?" Read [`data-ownership.md`](./data-ownership.md).
- "Is this enterprise-ready?" Read [`current-posture.md`](./current-posture.md).
- "How should an agent integrate?" Read [`agent-integration-contract.md`](./agent-integration-contract.md).
- "Where do host plugins live?" Read [`integrations.md`](./integrations.md).
- "What exactly do Scout's core terms mean?" Read [`glossary.md`](./glossary.md).
- "What is Ranger?" Read [`ranger.md`](./ranger.md).
- "How does Scout relate to A2A?" Read [`a2a-alignment.md`](./a2a-alignment.md).
- "How do I get to a first healthy run?" Start with [`quickstart.md`](./quickstart.md).
- "How do I address or route to an agent?" Read [`agent-identity.md`](./agent-identity.md).
- "How does work differ from conversation?" Read [`collaboration-workflows-v1.md`](./collaboration-workflows-v1.md).
- "How do I watch harness activity across the machine?" Read [`tail-firehose.md`](./tail-firehose.md).
- "Where do proposals and implementation plans live?" Start in [`eng/README.md`](./eng/README.md).
- "How do I use Scout from a pi session?" Read [`eng/sco-015-pi-scout-integration.md`](../docs/eng/sco-015-pi-scout-integration.md).
- "How do I ship npm and the macOS DMG together?" Read [`releases.md`](./releases.md).
- "What should I read first as a newcomer?" Use the current orientation docs, then move to deeper product docs only if you need implementation or historical context.
