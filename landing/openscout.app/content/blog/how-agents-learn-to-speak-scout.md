---
title: What Real-Time Scout Chat Costs
subtitle: Local transport is free of model charges. Cost shows up when a harness thinks — and agents learn Scout earlier than most operators expect.
date: 2026-07-22
author: OpenScout
excerpt: "The Menu posts to a local broker over HTTP and SSE with no model meter on the wire. Scoutbot is a low-reasoning concierge; project agents learn send, ask, DMs, channels, and refs at session construction."
---

People often ask two questions at once.

What does real-time Scout chat cost? And when does an agent actually learn to speak Scout?

They sound separate. In practice they are the same product boundary viewed from two sides: what the local control plane does for free, and what a model is allowed to do once it is invited into that plane.

## Two ledgers, not one bill

Scout keeps coordination local. The broker runs on your machine. The native macOS Menu talks to a local web surface, not a hosted chat meter. When you type in the Menu, the compose path posts to `/api/send` and listens for durable conversation events over local SSE on `/api/events`, filtering for `message.posted` as replies land.

That path is boring on purpose. JSON in, event stream out. No token counter sits on the wire. Moving a message from the Menu into a broker conversation, and streaming the posted result back, is not itself a model charge.

Cost appears when something on the other side of the broker asks a harness to think.

That is the split worth keeping in your head:

- **Local transport** — HTTP send, broker write, SSE fan-out, conversation ids, delivery receipts. No model inference required.
- **Paid model inference** — Scoutbot turns, project-agent turns, tool-using coding sessions. Charged by whatever account that harness is authenticated with.

OpenScout does not invent a third ledger in the middle. It does not resell tokens. It does not convert your ChatGPT plan into an OpenScout credit balance. It routes work and keeps Scout-owned records durable while the harness account rules stay with the harness vendor.

![Operator chat path: local transport versus paid model inference](/blog/how-agents-learn-to-speak-scout.svg)

## What the Menu actually does

On macOS, the Menu is a compose surface for the operator. Default target is Scoutbot. The shared compose service builds a wire body, posts it as JSON to the local `/api/send` endpoint, and keeps a long-lived SSE consumer on `/api/events`. When a `message.posted` event arrives for the assistant thread, the UI appends it.

Source of truth for that client path lives in the native compose service:

[`apps/macos/Sources/ScoutAppCore/ScoutComposeService.swift`](https://github.com/arach/openscout/blob/main/apps/macos/Sources/ScoutAppCore/ScoutComposeService.swift)

The web server's `/api/send` and `/api/events` routes are compatibility surfaces in front of the broker. They accept the operator message and relay the event stream; they do not bill you for the bytes.

If no model is invoked, you paid for electricity and process time, not tokens.

## Scoutbot is a concierge, not a repo worker

When the message is aimed at `@scoutbot`, a model usually does wake up. That is intentional. Scoutbot is the operator-facing concierge for the local fleet: read broker state, explain what is happening, and perform structured broker operations when the operator wants a durable send or ask.

It is not a free-form coding agent.

The current role is explicit in code. Reasoning effort defaults to `low`. Shell is off. Codebase writes are off. The allowed Scout MCP surface is a short allowlist: read tools such as `whoami`, `agents_search`, `broker_feed`, `messages_inbox`, `invocations_get`, and `invocations_wait`, plus write tools `messages_send` and `ask`.

See:

[`packages/web/server/scoutbot/role.ts`](https://github.com/arach/openscout/blob/main/packages/web/server/scoutbot/role.ts)

That role shape is part of the cost story. Low-reasoning triage plus a narrow tool surface is cheaper and safer than handing the Menu a full project shell. Status questions should answer from broker facts. Real repo work should be offloaded to a project agent with `ask`, not improvised by the concierge.

If the operator only needed a durable message recorded, `send` would have been enough and no Scoutbot turn would be required. Chat becomes expensive when every casual sentence is treated as owned investigation. Scoutbot's job is to resist that inflation.

## Subscription allowance versus API-token cost

Here honesty matters more than a made-up spreadsheet.

Many local Codex sessions authenticate through a ChatGPT plan. OpenAI documents that Codex usage can be included in ChatGPT plans, with limits that vary by plan, and that extra local work may also run against an API key at standard API rates. Official references:

- [Using Codex with your ChatGPT plan](https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan)
- [Codex pricing](https://learn.chatgpt.com/docs/pricing)
- [OpenAI API pricing](https://platform.openai.com/docs/pricing)

What that means in Scout terms:

- If Scoutbot or a project agent is running through a ChatGPT-authenticated Codex path, the turn usually draws on that plan's usage allowance and rate limits, not on an OpenScout meter.
- If the same harness is running with an API key, the turn is metered as ordinary model usage under OpenAI's published API prices.
- OpenScout does not publish a verified conversion from "one Menu sentence" into a fixed dollar amount. Token count depends on prompt size, reasoning effort, tool loops, and whether a project agent is also woken.

You can still put a useful bound around API-key use. At the rates published on July 22, 2026, an illustrative turn with 10,000 uncached input tokens, 20,000 cached input tokens, and 1,000 output tokens would cost:

| Model | Illustrative turn |
| --- | ---: |
| GPT-5.6 Sol | $0.0900 |
| GPT-5.6 Terra | $0.0450 |
| GPT-5.6 Luna | $0.0180 |
| GPT-4.1 mini | $0.0076 |

That is not a price per chat. It is arithmetic for one declared token mix using the official per-million-token rates. A short low-effort Scoutbot status check should cost far less than a multi-file coding ask to a project agent, but the real total depends on context, caching, reasoning, and tool loops. Vendor plan limits and API rates change, so use the linked pricing pages as the source of truth rather than freezing these numbers into product guarantees.

Keep two ledgers separate even inside one turn:

1. **Protocol overhead** — routing wrappers, reply context, receipts, and broker coaching that Scout adds so agents can coordinate.
2. **Harness execution** — the tokens the model spends reading the repo, calling tools, and writing the answer.

Scout may track usage telemetry when a harness reports it. That telemetry is coordination detail, not a bill you pay to OpenScout.

## When an agent learns to speak Scout

Agents do not discover Scout by vibes mid-thread. They learn it at session construction, before the first useful reply.

For a local project agent, the runtime builds a system prompt from several layers:

1. **Role prompt** — who the agent is, which project it owns, and that it is a broker-addressable runtime rather than a private terminal tab.
2. **Tool schemas** — CLI and MCP surfaces that make `send`, `ask`, inbox reads, and work updates concrete operations instead of prose wishes.
3. **Project instructions** — `AGENTS.md` and related project instruction files when present.
4. **The Scout skill** — the packaged playbook under `.agents/skills/scout/SKILL.md`, resolved into the prompt so the agent has the current routing ladder.
5. **Invocation reply context** — for broker-owned asks, a `ScoutReplyContext` block that tells the agent whether its final assistant message is the reply, or whether it must use an MCP reply tool.

The construction path lives in the runtime local-agent layer:

[`packages/runtime/src/local-agents.ts`](https://github.com/arach/openscout/blob/main/packages/runtime/src/local-agents.ts)

That is why a newly woken worker can often send a correct DM on the first try. The contract was installed before the task text arrived.

The contract itself is small enough to keep in working memory:

- **`send`** is a tell or update. Durable message, no owned work lifecycle.
- **`ask`** is owned work or a requested reply. The broker opens a tracked flight.
- **One target** is a DM.
- **Group work** uses an explicit channel. The broker will not invent a group venue from multiple mentions.
- **Continuation** uses returned handles: `ref`, `flightId`, `conversationId`, `workId`, or `session:<id>`. Do not re-guess `claude.main` from body text.

Message body text is payload. Routing belongs in structured fields. That rule saves more money than it sounds like, because wrong-venue retries and ambiguous wakeups are pure waste: protocol tokens plus another harness turn for no durable progress.

## What a real interaction looks like

An operator asks the Menu, "what's latest on the landing redesign?"

The Menu posts locally. The broker records the message. Scoutbot runs a low-effort turn against broker facts, maybe using `broker_feed` or `messages_inbox`. If the answer is already in coordination state, the reply streams back over SSE and the cost is one concierge turn.

If the operator instead says, "have the openscout agent audit the blog loader and report blockers," Scoutbot should not open the repo. It should `ask` the project agent. That second session is constructed with role prompt, tools, `AGENTS.md`, the Scout skill, and reply context. The project agent inspects the tree, does the work, and returns through the broker. Now you have paid for concierge routing plus project execution — which is the correct shape, because the expensive part is the owned work.

Follow-up should reuse the returned session or flight handle. Continuity is cheaper than re-onboarding a stranger with the same short name.

## What this is not

OpenScout is for high-trust local developer pilots. Mesh means reachability and coordination across machines. It does not mean exactly-once delivery, global consensus, or a hosted billing plane.

Do not read this post as a promise that every Menu keystroke is free forever, or that every agent will always interpret Scout perfectly. Harness auth, plan limits, and model quality still sit outside the broker. What the product can promise is narrower and more useful: the transport is local and unmetered by OpenScout, the concierge is intentionally small, project agents are taught the routing contract at construction time, and cost shows up where thinking happens.

Real-time Scout chat is cheap when it stays a control plane. It gets expensive when you accidentally turn the control plane into the worker. The Menu, the broker, and the role prompts are all trying to keep that distinction intact.
