# External Runtime Inventory and Handoff

## Purpose

Capture the highest-signal ideas in an external runtime that feel relevant to
OpenScout, grouped into three buckets:

- human in the loop
- connect + tool use
- productionize

Then turn that inventory into a handoff brief for a follow-up runtime research
pass.

This is not a proposal yet. It is a framework note intended to keep the next
comparison pass focused.

## Inventory

### 1. Human In The Loop

Some runtimes support human approval before tool execution.

Why it matters:

- this is the closest equivalent to "ask before acting"
- it keeps approval close to the dangerous action, not buried in app logic
- it gives a clean trust boundary for commands, writes, sends, and deletes

Scout relevance:

- we already have approval and question primitives in trace
- the missing question is where approval should live in the product model:
  trace-only, workflow-level, or broker-owned action records

High-value idea to steal:

- explicit distinction between ordinary tool calls and tool calls that require
  approval

Some workflows can suspend and resume, including HITL examples where a human
decision pauses the flow and later resumes it.

Why it matters:

- approval is not only a tool concern
- some waits are really workflow waits: review gates, human clarification,
  release approval, content sign-off

Scout relevance:

- this lines up strongly with run graphs, wait states, and activation triggers
- it suggests Scout should treat "approval" as both an action-level and a
  run-level primitive

High-value idea to steal:

- the placement question itself: approval can live at different layers
  depending on whether the system is pausing a tool, a run step, or an entire
  workflow

### 2. Connect + Tool Use

A typed runtime injection mechanism can carry per-request values such as role,
model, prompt context, or toolset changes.

Why it matters:

- real systems need dynamic context that should not be hardcoded into prompts
- it is a clean way to pass privileged or user-specific context without making
  it part of the durable prompt blob

Scout relevance:

- this maps well to context blocks, loadouts, auth-scoped tool access, and
  surface-specific capabilities
- Scout likely needs a broker-owned equivalent to runtime context that can be
  projected into harness prompts or tool capability filters

High-value idea to steal:

- typed runtime injection for models, tools, and instructions

Ordinary tools and MCP integration should both be first-class.

Why it matters:

- it is not only "call tools"
- it is "connect to external tool ecosystems, resources, and prompt catalogs"

Scout relevance:

- OpenScout already has skills, broker resources, and interest in MCP as the
  extension boundary
- the noteworthy idea is the unified connection model rather than a separate
  MCP product

High-value idea to steal:

- one cohesive way to attach local tools, remote MCP tools, resources, and
  prompts to an agent/runtime

Some runtimes can expose agents as MCP-callable tools, effectively turning
agents into composable capabilities.

Why it matters:

- this is cleaner than bespoke "ask another agent" glue
- it creates a standardized outward-facing capability model

Scout relevance:

- very aligned with compat mode, delegation, and shared capability surfaces
- this is especially interesting if Scout wants agents to be reachable both as
  chat peers and as callable capabilities

High-value idea to steal:

- a standard "agent as tool" boundary instead of only message-based delegation

Agent networks can pair with workflows instead of forcing one universal
execution model.

Why it matters:

- some problems want explicit graphs
- some want a team of specialized agents
- some want both

Scout relevance:

- this supports the idea that Scout should keep separate nouns for:
  collaboration, runs, tools, and capability routing

### 3. Productionize

A strong server/runtime boundary exposes agents, workflows, tools, and MCP
servers as APIs.

Why it matters:

- this is more production-ready than "run a library in your app and improvise"
- it creates a stable operational target

Scout relevance:

- Scout should decide where its own runtime boundary lives when it grows beyond
  local-only harness control

High-value idea to steal:

- a crisp server/runtime product boundary

Some runtimes support both a standalone server model and server adapters for
running inside an existing app.

Why it matters:

- teams want optionality
- platform adoption is easier when the runtime can either stand alone or embed

Scout relevance:

- this is a good model for any future Scout cloud/runtime surface
- useful precedent for "hosted mode" vs "BYOK inside your infra"

High-value idea to steal:

- one protocol, multiple hosting postures

Traces, logs, evals, and production monitoring should be core platform
features.

Why it matters:

- most agent systems fail in operations before they fail in demos
- productionization requires a visible execution model

Scout relevance:

- Scout already has good instincts here with flights, trace, and broker state
- this reinforces that evals and runtime inspection should sit near the core
  product story

High-value idea to steal:

- bundling execution visibility with deployment, not as a separate afterthought

Some runtimes have a broad deployment story:

- own server
- cloud deployment
- server adapters
- multiple storage backends
- auth and middleware at the runtime edge

Why it matters:

- this is what "framework becomes platform" looks like

Scout relevance:

- especially relevant if Scout gets both hosted connectivity and hosted compat
  runtime modes

## Ideas Worth Stealing

If we compress the inventory to the most Scout-relevant ideas, the top set is:

1. Approval at multiple layers:
   tool-level approval plus workflow-level suspension.

2. Typed runtime context:
   dynamic injection of role, auth, model, tools, and other request-scoped
   data.

3. Agent-as-tool boundary:
   agents exposed as capabilities, not only as chat peers.

4. Clear runtime/server boundary:
   one operational surface for deployment, auth, middleware, and APIs.

5. Productionization as a first-class feature:
   traces, evals, logs, and deployment live together.

## Follow-Up Handoff

## Goal

Investigate whether the candidate runtime can match or improve on the ideas
above in the same three buckets:

- human in the loop
- connect + tool use
- productionize

This handoff is specifically about the runtime as a strategic framework
comparison, not about hosting providers generally.

## What To Investigate First

### 1. Human In The Loop

Key question:

- does the candidate runtime support both action/tool-level approval and
  workflow-level human input, or mostly workflow-level HITL?

Known signal:

- some runtimes have graph workflow human input nodes, but those surfaces may
  still be maturing.

Research questions:

- is there any stable tool-approval primitive, or only workflow pause/input?
- how resumable is human input in deployed environments?
- how does HITL show up in session history, state, and traces?

### 2. Connect + Tool Use

Key question:

- does the candidate runtime have a clean equivalent to runtime context plus
  tool and agent-as-tool integration?

Known signals:

- candidate runtimes may have `Session`, `State`, `Memory`, and `Artifact`
- candidate runtimes may have function tools and agent tools
- candidate runtimes may have workflow agents and graph workflows

Research questions:

- what is the best equivalent to typed runtime context?
- how are user auth, capability gating, and request-scoped tool access handled?
- how strong is the "agent as tool" composition model in practice?
- what external protocol boundaries matter most: APIs, MCP, live transports,
  or event triggers?

### 3. Productionize

Key question:

- is the runtime mostly a build framework, or does it provide a coherent
  runtime and deployment posture comparable to a standalone platform?

Known signals:

- deploy targets may include managed runtimes and other containers
- deployment can optionally include a web UI
- auth and security are handled largely at the deployment level
- the runtime may have artifacts, streaming, and event-triggered or ambient
  agents

Research questions:

- where is the real runtime boundary: API server, managed service, or custom
  container?
- how much is portable outside the managed host without losing the good parts?
- what is the operational story for traces, evals, sessions, artifacts, and
  long-running triggers?
- which parts are mature and which are still shaped around a specific provider?

## Comparison Rubric For The Pass

Use this rubric when comparing the runtime candidates for Scout relevance:

### Human In The Loop

- tool approval
- workflow pause/resume
- structured human input
- durability of waiting state

### Connect + Tool Use

- request-scoped runtime context
- capability gating
- tool composition
- agent-as-tool or subagent composition
- MCP or equivalent protocol boundary
- artifact and non-text object handling

### Productionize

- standalone runtime boundary
- deployment flexibility
- embedding vs standalone hosting
- auth and middleware
- traces/logs/evals
- cloud dependence vs portability

## Working Thesis

The most interesting contribution is not a single feature.

It is the packaging:

- agent runtime
- workflows
- dynamic context
- tools + MCP
- observability
- deployment

inside one coherent product story.

The follow-up pass should answer:

- does the candidate offer an equally coherent story?
- is it better in orchestration and runtime than the alternatives?
- is it more cloud-shaped than Scout should want?
- which ideas are worth stealing even if the whole framework is not
