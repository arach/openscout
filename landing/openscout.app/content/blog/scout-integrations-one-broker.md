---
title: One Broker, Many Agent Homes
subtitle: Scout integrations for Codex, Claude Code, pi, and Hermes let agents keep their native host while sharing the same routing, identity, and work handoff model.
date: 2026-05-07
author: OpenScout
excerpt: "The integration layer is intentionally thin: each host feels native, while Scout keeps the broker, agent cards, messages, asks, and work records consistent."
---

Agents do not all live in the same shell.

Some work happens in Codex. Some work happens in Claude Code. Some happens in pi. Now Hermes has a Scout plugin too. Each host has its own way of presenting tools, commands, permissions, and session state. That variety is useful. It lets agents meet the user inside the environment where the work already has momentum.

The risk is that every host turns coordination into a different product.

If one integration has its own idea of identity, another has its own message semantics, and a third treats long-running work as a private convention, then the user has to remember the quirks of every surface. The integration layer starts to become a set of adapters in name only. Underneath, there are several different coordination systems wearing the same badge.

Scout should not work that way.

The integration model is simple: hosts can be different, but the coordination contract should stay the same. A Codex plugin, a Claude Code command, a pi extension, and a Hermes MCP bridge should all route through the same broker-backed concepts: agent cards, explicit targets, messages, asks, replies, flights, and work items.

That is why the host integrations live as focused packages beside OpenScout instead of being folded into the main product repo.

The OpenScout repository owns the control plane: broker, runtime, protocol, CLI, desktop app, web package, landing site, and product docs. The host packages own the last mile into a particular agent environment. They do not need to vendor the whole product. They need to speak the public Scout surface cleanly.

That separation keeps the shape honest.

Codex Scout can feel like a Codex plugin. Claude Scout can expose slash commands in the way Claude Code users expect. pi-scout can follow pi's extension model. Hermes Scout can bridge Scout MCP tools into Hermes Agent sessions through the host's plugin system.

Those differences matter. A good integration should not make every host feel like the same generic terminal wrapper. It should preserve the host's local texture: how tools are named, how results are shown, how sessions end, how the model decides what to call.

But the differences should stop at the edge.

When a user sends a message, it should be a Scout message. When an agent asks another agent to do owned work, it should become a Scout invocation. When the work needs to continue without blocking the current session, it should have a flight that can be checked, waited on, and reported back. When an agent needs a durable identity, it should use an agent card instead of a pasted folder path or a nickname that only one terminal remembers.

Hermes Scout is a useful test of that boundary.

The plugin is not trying to recreate Scout inside Hermes. It starts a Scout MCP bridge, exposes the current Scout tools to Hermes, and lets Hermes sessions participate in the same broker model as the other hosts. The interesting part is not that Hermes can call a tool. The interesting part is that a Hermes session can use the same coordination primitives as everyone else.

That includes the less glamorous details that make integrations trustworthy.

Tool handlers need to return the shape the host expects. Optional arguments should not be sent as null noise. Session cleanup should close the bridge it opened. The exposed tool list should track the current Scout MCP surface, including non-blocking ask helpers like `invocations_get` and `invocations_wait`. A direct agent id should be usable without inventing a label.

Those are implementation details, but they are also product details. Small mismatches at the integration edge are exactly where "same system" starts to feel like "similar systems." When those details are right, the host disappears a little. The user can think in Scout terms again.

That is the larger point of the integrations page.

It is not a directory of side projects. It is a map of the places Scout can already meet agents:

`arach/codex-scout` brings Scout into Codex.

`arach/claude-scout` brings Scout into Claude Code.

`arach/pi-scout` brings Scout into pi.

`arach/hermes-scout` brings Scout into Hermes Agent.

Each repo can have its own release cadence, install flow, and host-specific polish. OpenScout does not have to absorb every host package into one monorepo to make them official. The shared contract is the broker and protocol, not a shared folder tree.

That is important for development too.

The recommended local setup is boring on purpose:

```txt
~/dev/
|-- openscout/
|-- codex-scout/
|-- claude-scout/
|-- pi-scout/
`-- hermes-scout/
```

Sibling checkouts make it easy to work across the product and the host packages without pretending they are the same thing. If a protocol change is needed, it belongs in OpenScout. If a host needs a better command description, manifest, install path, or lifecycle hook, it belongs in that host integration.

That boundary gives the project room to grow without making the core repo carry every host's packaging concerns.

The current posture is still intentionally local and high-trust. Scout is for developer pilots, not a claim of hardened multi-tenant infrastructure or guaranteed distributed delivery. The integrations follow that same posture. They make local agents easier to reach, coordinate, and hand work to. They do not turn every host into a managed cloud service.

That restraint is part of the design.

The goal is not to make the user leave Codex for Scout, or leave Claude Code for Scout, or leave Hermes for Scout. The goal is to let each agent stay where it works best while giving the user one reliable coordination layer across them.

One broker. Many agent homes.

That is the integration story.
