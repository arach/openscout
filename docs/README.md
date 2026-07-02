# Docs

This folder is the working documentation set for OpenScout. Read it top-down:
the spine below gives the whole model in a few stops, the reference layer under
it serves specific audiences, and `eng/` holds implementation-facing design
docs, proposals, and archived planning material.

## The Spine

Read these in order the first time:

1. [`../README.md`](../README.md) — what OpenScout is and how to run it locally
2. [`../install.md`](../install.md) — choosing published CLI vs repo-local setup
3. [`quickstart.md`](./quickstart.md) — the first healthy local run and first meaningful commands
4. [`architecture.md`](./architecture.md) — the system shape, the data model (what Scout owns vs observes), agent identity and addressing, and the integration boundary
5. [`agents-and-collaboration.md`](./agents-and-collaboration.md) — how agents reach each other and move owned work: questions, work items, delegation, waking
6. [`concepts.md`](./concepts.md) — what every core noun means: the concepts Scout brings, and where it deliberately maps to open protocols (A2A, ACP, MCP)

Keep the posture straight while reading: OpenScout is for high-trust local
developer pilots today, not enterprise or multi-tenant deployment. The
boundaries live in [`current-posture.md`](./current-posture.md).

## Reference By Audience

**Building a client, plugin, or adapter:**

- [`scout-comms.md`](./scout-comms.md) — the front door: records, workflows, routing, receipts
- [`agent-integration-contract.md`](./agent-integration-contract.md) — the minimum contract for plugging a harness or agent into Scout
- [`mcp-api-posture.md`](./mcp-api-posture.md) — the core vs pro MCP tool tiers
- [`chat-model.md`](./chat-model.md) — the Chat/Conversation model and its invariants
- [`runtime-sessions.md`](./runtime-sessions.md) — session lifecycle detail

**Operating Scout as a human:**

- [`ask-scout.md`](./ask-scout.md) — how you reach your agents through Scout
- [`ask-scout-implementation.md`](./ask-scout-implementation.md) — implementation detail for the ask flow
- [`operator-attention-and-unblock.md`](./operator-attention-and-unblock.md) — how "needs the human" reaches you
- [`scoutbot.md`](./scoutbot.md) — the `@scoutbot` assistant handle
- [`tail-firehose.md`](./tail-firehose.md) — watching harness activity across the machine

**Interop and posture:**

- [`current-posture.md`](./current-posture.md) — maturity, trust, install footprint, license boundaries
- [`protocol-readiness-a2a-acp.md`](./protocol-readiness-a2a-acp.md) — the dated A2A/ACP readiness matrix
- [`integrations.md`](./integrations.md) — host-specific Scout integrations and why they live in sibling repos

**Configuration and operations:**

- [`local-ports.md`](./local-ports.md) — the Scout-owned local TCP port range
- [`settings.md`](./settings.md) and [`user-config.md`](./user-config.md) — where settings and operator identity live
- [`local-secrets.md`](./local-secrets.md) — local secret handling
- [`releases.md`](./releases.md) — the coordinated npm, DMG, and GitHub release path
- [`native-runtime.md`](./native-runtime.md) — historical context for the desktop-host/runtime split

## Agent-Optimized Docs

- [`../llms.txt`](../llms.txt) — the compact repo-wide LLM index
- [`../llms-full.txt`](../llms-full.txt) — the larger generated copy/paste context bundle
- [`agent/README.agent.md`](./agent/README.agent.md) — dense project context for coding agents
- [`agent/current-posture.agent.md`](./agent/current-posture.agent.md) — dense maturity and trust summary
- [`agent/integration-contract.agent.md`](./agent/integration-contract.agent.md) — dense adapter and agent integration checklist
- [`agent/scout-comms.agent.md`](./agent/scout-comms.agent.md) — dense comms integration checklist

## Engineering Docs And Proposals

[`eng/README.md`](./eng/README.md) indexes implementation-facing design docs,
proposals, and archived planning material (including the retired
OpenAgents-inspired tracks).

## Reading By Question

- "What is OpenScout trying to be?" — [`../README.md`](../README.md), then [`architecture.md`](./architecture.md)
- "What exactly does this noun mean?" — [`concepts.md`](./concepts.md)
- "What data does Scout own?" — the Data Model section of [`architecture.md`](./architecture.md)
- "How do I address or route to an agent?" — the identity sections of [`architecture.md`](./architecture.md)
- "How does work differ from conversation?" — [`agents-and-collaboration.md`](./agents-and-collaboration.md)
- "How should an agent integrate?" — [`agent-integration-contract.md`](./agent-integration-contract.md)
- "How should a client or adapter understand Scout communication?" — [`scout-comms.md`](./scout-comms.md)
- "Which MCP tools are core versus pro integration?" — [`mcp-api-posture.md`](./mcp-api-posture.md)
- "How does Scout relate to A2A?" — [`concepts.md`](./concepts.md), then [`protocol-readiness-a2a-acp.md`](./protocol-readiness-a2a-acp.md)
- "Is this enterprise-ready?" — [`current-posture.md`](./current-posture.md)
- "How do I get to a first healthy run?" — [`quickstart.md`](./quickstart.md)
- "Which local ports does Scout own?" — [`local-ports.md`](./local-ports.md)
- "How do I ship npm and the macOS DMG together?" — [`releases.md`](./releases.md)
- "Where do proposals and implementation plans live?" — [`eng/README.md`](./eng/README.md)
