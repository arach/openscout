---
title: Agent Model
description: Project, agent definition, and agent instance model for relay routing and mesh promotion
order: 3
---

# Agent Model

Relay started with a flatter assumption:

- one project
- one relay agent id
- one runtime session

That was enough to prove local coordination, but it is too coarse for the real workflow.

The actual use case is:

- the same project on different branches or worktrees
- the same logical agent running on different machines
- different compute envelopes for different instances
- agent-to-agent coordination across those related runtimes

The cleaner model is:

1. **Project**
2. **Agent Definition**
3. **Agent Instance**

## Project

A project is the repo or work domain.

Examples:

- `openscout`
- `fabric`
- `arc`

Project identity is about code, workspace, and durable context.

## Agent Definition

An agent definition is the logical role and instruction set for that project.

Examples:

- `fabric`
- `hudson`
- `openscout`

This is the stable thing a human usually means when they write `@fabric`.

An agent definition is not a concrete tmux pane, not a specific machine, and not a specific branch.

## Agent Instance

An agent instance is a concrete runtime of an agent definition.

Examples:

- `fabric@mac-mini/main`
- `fabric@laptop/feature-x`
- `fabric@gpu-box/exp-branch`

An instance captures where the agent is actually running:

- node or machine
- branch or worktree
- runtime or harness
- current project root

This is the thing messages, invocations, and mesh routing ultimately need to target.

## Routing Grammar

Relay now has an instance-aware selector grammar:

- `@fabric`
- `@fabric@laptop`
- `@fabric#feature-x`
- `@fabric@laptop#feature-x`

The intended meaning is:

- `@fabric`
  route to the default or home instance for that definition

- `@fabric@laptop`
  route to the instance on that node

- `@fabric#feature-x`
  route to the instance attached to that branch or worktree

- `@fabric@laptop#feature-x`
  route to that exact concrete instance

This keeps human-facing targeting simple while still giving the runtime a precise destination when needed.

## Resolution Rules

The routing model should be:

1. Parse the selector into:
   - definition id
   - optional node qualifier
   - optional workspace qualifier

2. Resolve against known instances.

3. If the selector is unqualified and multiple instances exist:
   - prefer the default or home instance
   - otherwise ask or surface ambiguity

4. If the selector is qualified:
   - require a unique matching instance
   - do not silently drop to the wrong target

5. Messages and invocations ultimately target the resolved instance.

This is the important distinction:

- people usually mention **definitions**
- the runtime routes to **instances**

## Local To Mesh Promotion

Conversation scope should not stay hard-coded.

The intended rule is:

- a conversation starts as `local`
- it promotes to `shared` when a remote participant or explicit mesh-visible target joins

That means:

- a purely local DM stays local
- a DM to an agent owned by another broker becomes shared
- a channel with only local participants stays local
- a channel that includes remote agent instances becomes shared

One broker still owns the conversation metadata through `authorityNodeId`, but the message history is replicated to the relevant participant brokers.

## Persistence Direction

The durable source of truth remains the normalized runtime store:

- `nodes`
- `actors`
- `agents`
- `agent_endpoints`
- `conversations`
- `conversation_members`
- `messages`
- `invocations`
- `flights`
- `deliveries`
- `events`

Other representations are derived:

- mesh bundles for broker-to-broker replication
- relay JSONL for compatibility and debugging
- UI projections for desktop and CLI surfaces

The rule is:

- store once in normalized form
- derive other views and formats from that canonical store

## Current Implementation Direction

The first slice of this model is now in the codebase:

- selector parsing supports definition, node-qualified, and workspace-qualified agent mentions
- resolved relay agents now carry instance metadata
- broker-registered relay agents advertise definition and instance selectors in metadata
- non-shared conversations can promote to `shared` when remote participants are present

This is not the full multi-instance runtime yet.

Today, most configured relay agents are still one concrete instance per definition on a broker. The point of this slice is to create the routing seam now so future cross-broker and multi-worktree behavior lands on a coherent model instead of growing as special cases.
