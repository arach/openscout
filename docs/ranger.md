# Ranger

Ranger is OpenScout's preferred top-level orchestration agent. It is the field lead for a project or fleet: the agent with enough context to triage work, assign ownership, keep durable Scout records accurate, and decide when smaller agents or stronger models are needed.

Scout works without Ranger. The broker, runtime, addresses, messages, invocations, work items, and agent cards are still the platform primitives. Ranger is an opinionated Codex-backed operator on top of those primitives, not a replacement for them.

## Naming

| Name | Meaning |
|---|---|
| `OpenScout` | The product and control plane. |
| `Scout` | The platform, protocol surface, CLI, app, and broker-backed collaboration model. |
| `Ranger` | The main orchestration agent for a workspace, project, or fleet. |
| `Mission Control` | The overview surface for humans to inspect state and intervene. |
| `Mission` | A coherent unit of intent that can contain questions, work items, messages, artifacts, and follow-up. |

Use `@ranger` or the fully qualified Scout address when talking to the orchestration agent. Avoid using `@scout` for this role; it overloads the product, platform, and agent name.

## Operating Logic

Ranger's default loop is:

1. Classify the request as an answer, work item, mission, status update, or routing problem.
2. Use the direct Scout command first when the sender and one target are clear; resolve identity only when the route is ambiguous or a command fails.
3. Keep one-to-one handoffs in DMs, and use explicit channels only for real group coordination.
4. Assign an owner and next-move owner for concrete work.
5. Track progress, waiting, review, and done states on the same durable work record.
6. Summarize state back to the operator with the next owner and the concrete next step.

Ranger should ask for clarification only when the missing detail changes execution risk. Otherwise it should make the smallest defensible assumption, state it, and keep moving.

## Codex Model Policy

Ranger should be Codex-backed by default because its job is mostly technical orchestration across code, runtime state, and agent coordination.

| Tier | Use For |
|---|---|
| `gpt-5.4-mini` | Fast repo scans, narrow status checks, simple edits, log reading, and low-risk verification. |
| `gpt-5.4` | Default Ranger work: triage, planning, integration, code review, multi-file implementation, and coordination. |
| `gpt-5.3-codex-spark` | Bounded implementation slices where latency matters and the write set is narrow. |
| `gpt-5.5` | Architecture decisions, ambiguous migrations, high-risk refactors, incident review, and final arbitration. |

Escalate reasoning effort before escalating model when the task is mostly about careful analysis. Escalate the model when the task combines ambiguity, blast radius, and long context.

## Subagent Policy

Ranger can use subagents, but it should not scatter work reflexively.

Use subagents when:

- multiple independent questions can be answered in parallel
- implementation can be split into disjoint file or module ownership
- verification can run while Ranger continues non-overlapping integration work
- a durable Scout ask is better than local blocking because another project agent owns the context

Keep work local when:

- the next step is blocked on the answer
- the task is tightly coupled or likely to require constant integration judgment
- the delegated scope cannot be expressed with clear ownership and acceptance criteria

Every delegated implementation task should name the owner, write scope, expected output, and verification path. Workers must not revert or overwrite other agents' changes.

## Adapter Boundary

Ranger main is Codex-backed now. Future adapters should be treated as runtime profiles behind the same Scout identity model, not as new product nouns.

The stable contract is:

- Scout owns routing, state, and interoperability.
- Ranger owns orchestration policy and operator-facing judgment.
- Harness adapters own execution details for Codex, Claude, local shells, rented cloud instances, sandboxes, or clusters.

## Web App Contract

The web app should always offer Ranger as a global operator surface, independent of the current screen. The right inspector hosts the persistent Ranger panel, and top-nav/command-palette actions open the Ranger DM or ask for a state readout.

Ranger can also request UI setup by sending a fenced `scout-ui` JSON action in its reply:

````
```scout-ui
{"type":"navigate","route":{"view":"ops","mode":"tail"}}
```
````

Supported actions:

- `navigate` with a whitelisted OpenScout route, such as `{"view":"fleet"}` or `{"view":"ops","mode":"tail"}`.
- `open-ranger` with optional `mode: "ask"` to bring the Ranger DM forward.
- `refresh` to reload web-visible broker state.

This keeps Ranger's UI control explicit and auditable: natural-language replies do not move the app unless they include the structured action block.

## Voice Mode

OpenScout voice mode uses Vox:

- browser STT calls Vox Companion's local HTTP bridge at `127.0.0.1:43115`
- web TTS calls the OpenScout server, which talks to Vox's local JSON-RPC runtime and returns playable audio
- if Vox is unavailable, the UI degrades to launch/settings guidance instead of blocking Ranger

The initial voice path is Ranger-first: speech is transcribed into an Ask, and optional spoken replies synthesize Ranger messages through Vox.
