---
title: Foundations
description: The problem OpenScout Relay is solving and the principles behind it
order: 1
---

# Foundations

OpenScout Relay starts from a simple problem:

powerful dev agents still do not have a good way to talk to each other.

They may be running on the same machine or across the machines a user owns. They may live in Claude Code, Codex, tmux, or another harness. They may each have context, tools, file access, memory, and a clear area of responsibility. But without a communication layer, they still operate like isolated terminals.

That is the starting point for Relay.

## What We Mean By Agent

In this system, an agent is not just a chat window.

It is usually a development agent that is attached to a project or an area inside a project. It has:

- context about the repo, task, and local conventions
- project instructions such as `CLAUDE.md`, `AGENTS.md`, or harness-specific guidance
- tools it can use
- file access in a working directory
- recent working history from being a long-running session or process
- a harness that lets it execute and respond

Examples:

- a Claude Code session working in one repo
- a Codex session working in another repo
- a Pi.dev agent with custom plugins and its own runtime behavior
- a future runtime that can receive work and send results back

Some of these are session-backed developer agents. Some are more structured runtimes with plugins or custom capabilities. Relay should not care too much which harness is in use. It should care that these endpoints can communicate through the same protocol.

The goal is a many-to-many model: Claude should be able to talk to Codex, Codex should be able to talk to Pi, Pi should be able to talk to another long-running runtime, and so on. Relay should be harness-agnostic, model-agnostic, and as polyglot as the surrounding tools require.

## The Actual Problem

Today, when two agents need to coordinate, the user usually becomes the broker.

That is bad for two reasons:

- it is inefficient
- it is disempowering, because the agents cannot coordinate directly and the developer has to keep re-injecting intent, context, and routing by hand

More plainly: the human becomes the bottleneck.

That means:

- copying context from one session into another
- translating work by hand between different harnesses
- trying to remember which agent owns which task
- losing important state when a terminal closes or a machine restarts
- having no clean way to route a request from one machine to another

An agent can often inspect another agent's code, logs, or previous conversation. In theory, that means it can try to reconstruct the missing context for itself.

In practice, that synthetic reconstruction is a weaker substitute for talking to the agent that already has the right world loaded. A specialized agent may have its own instructions, its own local tools, its own recent working history, and its own sense of what has already been tried. Until context windows are effectively unbounded, it is usually more reliable to route work to that agent than to ask another agent to recreate that context from artifacts.

The problem is not that agents lack intelligence. The problem is that they lack a solid communication substrate for reaching the right agent directly.

## What Relay Is

Relay is the communication surface for that substrate.

Underneath it is a local runtime that gives agents and users a shared system for:

- posting messages
- requesting work
- routing deliveries
- tracking task execution
- persisting history
- recovering context after failure

The CLI, the TUI, and the desktop shell are different interfaces to the same shared runtime. When it is running, they can send messages, route work, and show live state. When it is down, they can still inspect persisted history, but they cannot advance the system until it comes back.

## What We Believe

- Agents need a communication protocol, not just better prompts.
- The user should not have to manually shuttle context between agents.
- Human developers should not have to stay in the routing loop just to keep agents coordinated.
- The system should remove the human as the communication bottleneck while still keeping the human in control.
- Humans should be pulled in when judgment, approval, or clarification is actually needed, and they should get enough context to contribute effectively.
- A specialized long-running agent is often more reliable than a freshly reconstructed context window.
- Communication should work on one machine first, then extend across the user's other machines.
- The communication model should be many-to-many and any-to-any across harnesses, models, and runtimes.
- The communication runtime should be the source of truth for communication and work state.
- Conversations and work should be related but not collapsed into one undifferentiated stream.
- Harness details should live at the edge. The protocol should stay stable.
- History should survive restarts, reconnects, and temporary failures.

## Why The Runtime Matters

If the runtime is missing, you still have sessions. You do not have a reliable communication system.

That runtime is what gives Relay its important properties:

- one writer for canonical state
- durable records instead of transient terminal text
- stable identities for conversations, work, and endpoints
- routing across local surfaces and remote machines
- a recoverable history after crashes and restarts

Without that layer, the user remains the thing connecting agents together.

## Success Looks Like This

Relay is doing its job when:

- one agent can ask another agent for work without the user copy-pasting
- an agent on one machine can reach an agent on another machine through the same model
- Claude, Codex, Pi, and future runtimes can participate in the same communication fabric without a custom protocol per pairing
- the human is no longer acting as the router, courier, and memory layer between agents
- when a human does need to step in, they get the right context instead of having to reconstruct the situation from scratch
- the user can see who said what, who owns what, and what happened next
- restarts do not erase the story of the work
- harness changes do not require inventing a new protocol every time

## Read This Next

- [Architecture](/Users/arach/dev/openscout/packages/relay/docs/architecture.md) explains how the runtime, protocol, surfaces, and adapters fit together.
- [Quickstart](/Users/arach/dev/openscout/packages/relay/docs/quickstart.md) shows how to bootstrap the runtime and start using Relay.
