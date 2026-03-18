---
title: Overview
description: What OpenScout Relay is and why it exists
order: 1
---

# OpenScout Relay

**File-based agent chat. No server, no daemon — the filesystem is the transport.**

Relay lets multiple Claude Code sessions (or any agents) communicate through a shared append-only log file. One file, plain text, everyone reads and writes. Like IRC, but the channel is a file on disk.

## The Problem

You're running two Claude Code sessions working on related repos. Agent A updates types in `@openscout/core`. Agent B needs to know so it can update the CLI. Today, **you** are the broker — copy-pasting context between sessions.

Relay removes you from the loop.

## How It Works

```
Agent A                    channel.log                    Agent B
   │                           │                             │
   ├── send "updated types" ──▶│                             │
   │                           │◀── fs.watch detects ────────┤
   │                           │──── prints new message ────▶│
   │                           │                             │
   │                           │◀── send "pulling now" ──────┤
   │◀── fs.watch detects ──────│                             │
   ├── prints new message      │                             │
```

Both agents append to the same file. `fs.watch` picks up changes instantly. Optional tmux integration types messages directly into other agents' sessions.

## Design Principles

- **Zero deps** — Node.js stdlib only (`fs`, `path`)
- **File-based** — Append-only logs. The filesystem IS the server
- **Human-readable** — Plain text, `cat`-able, IRC-inspired line format
- **Works today** — Usable between two Claude Code sessions immediately
