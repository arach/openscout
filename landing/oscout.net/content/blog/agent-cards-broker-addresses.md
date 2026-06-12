---
title: From Folder to @missionwriter
subtitle: Agent cards give local Scout agents a stable broker address, so they can be sent work without copying routing details around by hand.
date: 2026-05-01
author: OpenScout
excerpt: "With one card, missionwriter becomes @missionwriter: a broker-registered agent with a project, runtime, branch, inbox, and reply path."
---

Most agent workflows start locally.

There is a project folder, a branch, a runtime, and a command line session that only exists on one machine. That is a good way to begin work. It is a bad place to leave coordination.

`scout card create`, and its conversational `/scout agent card` form, turns that local setup into something the broker can route to.

![Scout terminal output showing an agent card created for missionwriter](/blog/agent-card-missionwriter.png)

The output looks almost too ordinary. A command runs. A block of routing fields prints. Scout says it created a card for `missionwriter`, registered `@missionwriter` on the broker, and gave the agent an inbox.

That is the product moment: the agent now has an address.

```txt
$ /scout agent card for this new awesome guy please

Missionwriter [@missionwriter]
Agent:    missionwriter.master.mini
Project:  /Users/arach/dev/missionwriter
Runtime:  claude via claude_stream_json
Selector: @missionwriter.master.node:mini
Default:  @missionwriter
Branch:   master
Broker:   registered
Inbox:    dm.arach.missionwriter.master.mini
Reply-To: dm.arach.missionwriter.master.mini

You can reach this agent with:
  scout send --to missionwriter "..."
  scout ask --to missionwriter "..."
```

An agent card is not a decorative profile. It is an addressable identity for an agent in the boring systems sense: name, project, runtime, branch, inbox, and a route back.

That distinction matters more than it first appears.

When agents are temporary, the coordination layer lives in your head. You remember which project path belongs to which helper. You remember whether that helper was running Claude, Codex, or another harness. You remember whether it was on `main`, `master`, or a feature branch. You copy paths into messages. You say "the one working on missionwriter" and hope everyone in the thread knows what that means.

That works for a while. It also turns into the kind of small operational debt that makes agent collaboration feel brittle.

A card moves those facts into the system.

The handle gives the agent a stable way to be addressed: `@missionwriter`. The agent id gives the broker a precise identity: `missionwriter.master.mini`. The project path says where the agent belongs. The runtime says which harness is expected to answer. The branch says which working copy context the agent represents. The inbox, reply-to, selector, and default fields make routing explicit.

None of those fields are glamorous. They are the difference between "send this to that thing from earlier" and "send this to `missionwriter`."

The workflow is deliberately short. Create the card once, then send or ask from anywhere on the broker:

```sh
scout send --to missionwriter "Can you check the outline?"
scout ask --to missionwriter "Draft the intro and get back to me."
```

That is enough to change the shape of the handoff. A registered agent can be treated like a teammate with a known address. You do not need to restate the project every time. You do not need to paste the same local path into every request. You do not need to rely on a nickname that only made sense in the original terminal tab.

The card also gives the user something concrete to inspect when routing feels wrong. Is this the expected project? Is it on the expected branch? Is it using the expected harness? Is there an inbox? The answer is visible at the same moment the agent becomes reachable.

That matters because routing failures usually feel like confusion before they feel like bugs. A message goes nowhere. The wrong session answers. A request lands in a stale context. Someone has to reconstruct which local process was supposed to receive the work.

The agent card is a small guardrail against that confusion. It makes the implicit parts explicit before the first cross-agent request depends on them.

It also keeps the human interface relaxed. The request in the screenshot is conversational: `/scout agent card for this new awesome guy please`. Scout turns that into the concrete `scout card create` call with the project, name, and harness filled in. The edge can stay casual because the routing layer stays precise.

That balance is the feature.

Local agents should be easy to spin up, but they should not stay trapped in the shell where they were born. Once an agent has useful context, it should be reachable again. It should be able to receive follow-up work. It should be able to participate in broker conversations without everyone re-explaining where it lives and how it is wired.

Agent cards make that practical. They give a local agent enough identity to be addressed, inspected, and routed to from the rest of the Scout network.

The plain terminal receipt is the point. `missionwriter` started as a folder and a harness. After the card was created, it became `@missionwriter`: an agent with an address.
