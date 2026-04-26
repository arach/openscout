# SCO-008: Intent Briefs and Trusted Environments

## Status

Proposed.

## Proposal ID

`sco-008`

## Intent

Define a durable way to keep the human's objective explicit while letting
agents coordinate safely across personal machines, headless nodes, cloud
workers, and sensitive running systems.

At any point, the system should be able to answer five simple questions:

1. What is the human trying to accomplish?
2. What outcome counts as success?
3. Which active work items serve that goal?
4. Which environment is appropriate for each action?
5. Who or what owns the next move?

This proposal does not replace conversations, messages, invocations, flights,
work items, or missions. It gives them two missing layers:

- a durable intent layer above ongoing work
- a trusted environment layer around where that work runs

## Problem

The system is increasingly good at capturing what was said and what work is in
flight. It is still too easy for the human's actual objective to dissolve into
chat history, scattered prompts, linked docs, and implicit assumptions.

That creates several failures:

1. Agents can complete locally sensible tasks without enough parent context.
2. The system can infer intent from prompts and docs, but not state that
   intent back in a crisp, durable, inspectable form.
3. Missions help group work, but they do not yet guarantee one explicit answer
   to "what are we trying to do right now?"
4. As more work spans personal machines, remote nodes, cloud workers, and
   running systems, environment choice becomes a safety question, not just a
   routing question.
5. Production awareness is increasingly valuable, but unsafe if treated as the
   same kind of access as an ordinary local workspace.

The root issue is not missing chat, missing tasks, or missing machines. The
root issue is missing durable intent and missing first-class trust boundaries.

## Decision

OpenScout SHOULD adopt two new first-class concepts:

- `intent_brief`: a durable statement of the human's goal, desired outcomes,
  constraints, non-goals, and preferred collaborators or environments
- `environment`: an addressable runtime surface with capabilities, trust
  policy, sensitivity, health, and access rules

These concepts SHOULD shape planning, delegation, execution, observation, and
safety.

## Proposal

### 1. Introduce a durable intent brief

Each meaningful effort SHOULD be able to carry one current intent brief.

An intent brief is the plain-language answer to:

- what we are trying to achieve
- why it matters
- what success looks like
- what should not happen
- what constraints must be respected

The intent brief should be readable by humans, legible to agents, and durable
enough to survive restarts, session changes, and partial handoffs.

### 2. Keep intent human-authored first and machine-maintained second

The system SHOULD be allowed to synthesize an intent brief from prompts, docs,
messages, and existing work. It MUST make that synthesis inspectable.

Every meaningful statement in an intent brief SHOULD carry provenance such as:

- human-authored
- imported from a document
- inferred from history
- later confirmed by the human

Inference is useful. Silent replacement of human intent is not.

### 3. Make work items and missions children of intent, not substitutes for it

Missions, work items, questions, and delegated tasks SHOULD link back to one
intent brief whenever they are part of the same effort.

That means an agent should not only receive a local assignment such as "review
this" or "fix that," but also the parent objective that explains:

- why the work exists
- how it contributes to the broader outcome
- what tradeoffs are acceptable
- which constraints are global rather than local

The system should never have to reconstruct the operator's goal by scraping old
messages when a durable parent record could say it directly.

### 4. Make the system deterministically answer "what are we doing?"

At any moment, the system SHOULD be able to state:

- the current intent brief
- the active work items attached to it
- the current owner of each next move
- the environments involved
- the current risks, waits, and open decisions

This answer should come from durable records, not prompt archaeology.

If the system cannot answer the question clearly, that is a modeling failure,
not just a UX failure.

### 5. Make planning and routing intent-aware

Planning and routing SHOULD use the intent brief as a first-class input.

That means the system should consider:

- desired outcome
- allowed autonomy level
- preferred agents or skills
- forbidden environments
- safety and trust constraints
- time sensitivity
- review requirements

The human should be able to say, in plain language, "here is what I want these
agents to accomplish," and have the system turn that into durable work rather
than a one-off prompt.

### 6. Model environments as first-class runtime surfaces

An environment SHOULD not just be a host string or working directory. It should
be a durable, addressable record that answers:

- what kind of place it is
- who owns it
- what it can do
- what data it can see
- how sensitive it is
- whether it is healthy
- what actions are allowed there

At minimum, the model should distinguish between:

- personal workstations
- always-on helper nodes
- cloud worker environments
- build or CI environments
- deployed or production-adjacent instances

No environment should be treated as "just another machine" once trust and
consequence differ.

### 7. Separate awareness from authority

Cross-environment awareness SHOULD arrive before broad cross-environment
authority.

The system should be able to know that a remote environment exists, is healthy,
is running a particular build, or exposes a specific service without implying
that every agent may change it.

Read access, observation access, diagnostic access, write access, and deploy
access SHOULD be modeled separately.

The default stance for sensitive environments SHOULD be:

- observable first
- writable only by explicit policy
- auditable always

### 8. Make trusted bridges explicit and narrow

When the system crosses from one environment into another, it SHOULD do so
through an explicit bridge with scoped authority.

A bridge should make clear:

- which environment is being reached
- which credentials or trust grant are in use
- whether the access is read-only or mutating
- which actions are permitted
- how the action will be audited

This is especially important for build systems, cloud workers, and running
instances where the cost of a mistaken action is much higher than in a local
worktree.

### 9. Give each work item a casefile, not just a chat thread

Each durable work item SHOULD accumulate a casefile that includes the evidence
needed to understand and review it.

That casefile should be able to hold:

- the parent intent brief
- acceptance criteria
- environment touches
- plan and progress
- artifacts and diffs
- checks, reviews, and validation results
- decisions, waits, and handoffs

The point is not to create ceremony. The point is that durable work should
carry durable evidence.

### 10. Require policy before autonomy in sensitive environments

The system SHOULD support autonomous execution across trusted environments, but
only after policy is explicit.

Policy should answer questions such as:

- may this agent read from this environment?
- may it write there?
- may it run commands there?
- may it trigger deploys or restarts?
- what review or approval is required first?

Autonomy without policy is just hidden authority.

### 11. Keep the human in control of the objective, not every step

The desired product behavior is:

1. The human states the goal clearly once.
2. The system materializes that goal into a durable intent brief.
3. The system creates or updates the right work items beneath it.
4. The system chooses the appropriate agents and environments within policy.
5. The system reports back in terms of progress toward the goal, not just raw
   activity.

This keeps the human responsible for intent and tradeoffs while letting the
system take on more coordination work.

### 12. Roll this out in phases

The implementation SHOULD be phased.

Phase 1:

- introduce `intent_brief` as a durable record
- allow manual authoring plus machine-generated drafts
- link work items and missions back to the brief
- surface a simple "current objective" read model

Phase 2:

- introduce first-class `environment` records
- model health, capability, sensitivity, and trust policy
- add remote observation surfaces that preserve environment boundaries

Phase 3:

- make routing and planning intent-aware
- attach environment policy to execution and delegation
- add safer cross-environment automation for approved pathways

## Non-Goals

This proposal is intentionally narrower than a full project management system.

It does not require:

- replacing the existing conversation and work model
- turning every task into a large hierarchy
- giving every agent broad production authority
- removing human approval from high-consequence actions
- pretending inferred intent is equivalent to confirmed intent

## Design Principles

1. The human objective must be explicit.
2. Durable work must stay attached to durable purpose.
3. Environment choice is a safety decision, not only a scheduling decision.
4. Awareness may cross boundaries before authority does.
5. Sensitive environments must be observable without becoming casually mutable.
6. The system should summarize intent from evidence, but never hide the fact
   that it inferred it.
7. The system should report progress toward outcomes, not just activity.
8. Trust must be modeled directly instead of being smuggled through hostnames,
   credentials, or implicit operator knowledge.

## Open Questions

1. Should an intent brief be scoped primarily to a conversation, a mission, or
   a higher-level operator objective that can span both?
2. How much of the intent brief should be editable freeform text versus
   structured fields with explicit provenance?
3. What is the minimum safe environment model that is still useful on day one?
4. Which cross-environment actions should remain permanently read-only without
   an explicit higher-trust bridge?
5. How should the system represent "this environment is production-adjacent"
   versus "this environment is safe to mutate freely" in operator-facing
   language?
