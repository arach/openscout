# Harness Topology Observation

OpenScout needs to see when a harness has created its own helper agents,
teammates, tasks, or child sessions without pretending Scout owns that
coordination. This note defines the first read-only shape and the Claude Code
agent-team reader.

Status: implementation note for local developer pilots.

## Principle

Scout observes harness topology as source material.

- Adapters may read harness-owned topology.
- Adapters must not write harness-owned topology.
- Observed harness agents are not automatically Scout agents.
- Promotion to a Scout-routable agent requires a separate stable route or
  explicit attach flow.

## Normalized Shape

`ObservedHarnessTopology` lives in `@openscout/agent-sessions` protocol
primitives and can be attached to `Session.providerMeta.observedTopology`.

Normalize around topology, not around one vendor's nouns. A "team", "crew",
"workflow", "graph", "group chat", and "thread tree" are all coordination
containers. A "teammate", "agent", "node", "participant", and "child thread"
are all actors or actor definitions. A "task", "handoff", "tool call", and
"workflow step" are all work or routing events.

The shape is intentionally small:

- `groups`: harness-native coordination containers, such as an agent team
- `agents`: lead, teammate, subagent, helper, or child-session nodes
- `tasks`: harness-native task list items
- `relationships`: edges such as `member_of`, `leads`, `assigned_to`, and
  `depends_on`
- `sourceRefs`: files, directories, events, or provider references that explain
  where the observation came from
- `ownership: "harness_observed"` to keep the boundary visible

Future harnesses should produce the same shape rather than adding one-off UI
payloads.

## Normalization Lens

Use these buckets when adding a new harness reader:

| Normalized concept | Meaning | Common vendor names |
| --- | --- | --- |
| Coordination container | Harness-owned scope that organizes multi-agent activity | team, crew, flow, workflow, graph, group chat, thread, swarm |
| Actor definition | Reusable declared agent/persona/node, not necessarily running | agent definition, role, participant, worker node, custom agent |
| Active actor | Live actor-like execution entity | teammate, child thread, spawned subagent, manager, worker, node run |
| Work item | Unit of delegated or scheduled work | task, step, tool call, handoff, job row, routed message |
| Control edge | Relationship that explains execution or authority | leads, supervises, hands off to, selects speaker, routes to, depends on |
| Source ref | Original harness material that produced the observation | config file, trace event, log line, checkpoint, run id |

Do not count definitions as active actors. A CrewAI `Agent`, AutoGen
`AssistantAgent`, or Codex custom agent definition becomes routable only if
there is a live execution route or an explicit Scout attach/promote flow.

Observed topology should also preserve the mode of evidence:

- `declared`: read from config or code definitions
- `observed`: read from runtime events, logs, traces, or checkpoints
- `inferred`: Scout connected two harness facts
- `promoted`: an operator or Scout flow attached it to a Scout endpoint

## Communication-First Boundary

Scout's reason for being is the communication layer: who can talk to whom, what
was asked, what reply is expected, and how a human or agent can unblock the next
move. Multi-agent systems do expose a more ops-shaped world, but Scout should
treat that as supporting context rather than as a second product center.

Product decision: Scout is a builder-centric communication layer, not an
agent-ops console. A builder is anyone personally responsible for an agentic
workflow: someone hanging out with agents, steering intent, judging outputs, and
turning work into artifacts. This includes professional developers, founders,
operators, designers, PMs, researchers, analysts, and other knowledge workers.
If an operator wants fleet health, run analytics, workflow tuning, deployment
controls, or production observability, that belongs in a dedicated ops surface.
Scout may link to or annotate those systems, but should not become them.

Scout understands action in the context of creation: developing products,
coordinating coding agents, moving a solo or small-team project forward, and
turning intent into useful work. It should retain enough runtime awareness to
support someone's day-to-day agentic work: who is running, who is blocked, what
needs a reply, and where a follow-up should go. It should not position itself as
the system for productionizing agent infrastructure, operating developer
platforms, or managing agent runtime fleets.

Keep these concerns distinct even when the same external agent appears in both:

| Plane | Question it answers | Scout-owned records | External source material |
| --- | --- | --- | --- |
| Communication | Who can talk to whom, what was asked, and what reply is expected? | messages, invocations, deliveries, bindings, questions, work items created through Scout | harness chat messages, tool-call prompts, handoff text |
| Communication context | What external agentic machinery affects the next message, reply, or unblock? | observed snapshots attached to sessions | teams, subagents, runs, workflow steps, background jobs, task files, traces |

The communication plane is where Scout should be opinionated. It owns routing
semantics, reply modes, explicit targets, questions, asks, replies, and the
broker's delivery records.

Communication context should be observational by default. It answers questions
that make communication sharper: "who am I waiting on?", "which external agent
owns the next reply?", "where should a follow-up go?", "what is blocked on
human input?", and "what source material explains this status?". Adapters can
read and normalize those facts, but they should not claim ownership unless there
is an explicit attach or promote flow.

This keeps Scout from pretending every observed helper is a Scout participant.
An observed actor can become communication-addressable only after Scout has a
stable route to it.

Non-goals:

- run dashboards for every external agent execution
- fleet health, utilization, cost analytics, or SLA monitoring
- editing vendor-owned teams, workflows, subagent definitions, or task state
- replacing framework-native observability such as LangSmith, Mastra tracing,
  Cursor background-agent dashboards, or Claude/Codex local run views

## Claude Code Agent Teams

The Claude Code agent-teams documentation gives these read surfaces:

- team config: `~/.claude/teams/{team-name}/config.json`
- task list: `~/.claude/tasks/{team-name}/`
- config members: teammate name, agent id, and agent type
- runtime state: session ids and pane ids when Claude records them

The current reader is
`packages/agent-sessions/src/adapters/claude-code/team-topology.ts`.

Detection strategy:

1. Scan `~/.claude/teams/*/config.json`.
2. Match teams to the current adapter session by Claude session id or cwd.
3. Normalize matching team members into `agents`.
4. Add the current Claude session as a `lead` node when its session id is known.
5. Read `~/.claude/tasks/{team-name}/` task files opportunistically.
6. Map assignment and dependency fields into topology relationships when they
   are present.

The reader is deliberately tolerant because Claude agent teams are experimental
and local file shapes may change.

## Current Harness Comparison

Claude Code has the richest local team topology surface today because its agent
teams document team config and task-list files. Scout now reads those files
without mutating them.

Codex has related native concepts, but the surface is different:

- built-in subagents such as `default`, `worker`, and `explorer`
- custom agent definitions under `~/.codex/agents/` or `.codex/agents/`
- project `[agents]` settings such as `max_threads` and `max_depth`
- app-server thread source kinds such as `subAgent`,
  `subAgentThreadSpawn`, and related review/compact variants
- app-server item events such as `collabToolCall` with sender/receiver thread
  ids when collaboration tools run
- experimental CSV fan-out jobs with SQLite-backed job state

The current reader/tracker is
`packages/agent-sessions/src/adapters/codex/topology.ts`.

Detection strategy:

1. Read project `.codex/config.toml` for `[agents]` limits such as
   `max_threads` and `max_depth`.
2. Read project `.codex/agents/*.toml` and user `~/.codex/agents/*.toml` as
   custom-agent definitions.
3. Observe app-server `subagent` items as live subagent agents plus assigned
   tasks.
4. Observe app-server `collabToolCall` items as thread-to-thread collaboration,
   including sender/receiver thread ids and prompt-backed tasks.
5. Attach the result to `session.providerMeta.observedTopology`.

This follows the same rule as Claude: read `.codex` and app-server state, do
not mutate it from the adapter.

## Cursor

Cursor has both local harness subagents and remote background agents.

Local subagents are closer to Claude/Codex subagents than to autonomous Scout
participants. The parent Agent can launch subagents automatically, explicitly by
`/name`, or in parallel through multiple Task tool calls. Subagents run with a
clean context, return results to the parent, and can run in foreground or
background mode. Background subagents write state under `~/.cursor/subagents/`,
and completed subagents can be resumed by agent id.

Custom subagents are markdown files with YAML frontmatter. Cursor reads project
and user locations including `.cursor/agents/` and `~/.cursor/agents/`, plus
compatibility locations for `.claude/agents/`, `.codex/agents/`, and their user
equivalents. Project definitions take precedence; `.cursor/` takes precedence
over compatibility locations. Cursor also has built-in `explore`, `bash`, and
`browser` subagents for context-heavy codebase search, shell-command output,
and browser MCP work.

Remote background agents are a different surface. They are asynchronous agents
that work in remote isolated environments, can be listed and followed up through
Cursor's API, and expose ops metadata such as id, name, status, source
repository/ref, target branch, PR URL, creation time, and summary.

Mapping:

| Cursor concept | OpenScout observed topology |
| --- | --- |
| foreground subagent invocation | work item plus `assigned_to` edge |
| background subagent invocation | active actor plus background work item |
| built-in subagent | actor definition with `providerMeta.builtin = true` |
| custom `.cursor/agents/*.md` | actor definition |
| compatibility `.claude/agents` / `.codex/agents` | actor definition with compatibility source ref |
| nested subagent launch | `spawned` or `delegated_to` edge |
| `~/.cursor/subagents/` state | source ref and run/status metadata |
| remote background agent | active actor with `group.kind = "remote_background_agents"` |
| background-agent branch / PR URL | task artifact metadata |

Likely reader sources:

- project `.cursor/agents/*.md`
- user `~/.cursor/agents/*.md`
- compatibility agent-definition directories
- `~/.cursor/subagents/` background state
- Cursor background-agent API, when explicitly configured
- local Cursor chat or CLI events if a stable read-only source is available

## Other Multi-Agent Systems To Account For

These systems are not harness adapters yet, but their concepts should shape the
normalization contract.

### CrewAI

CrewAI has first-class `Agent`, `Task`, `Crew`, `Flow`, and `Process` concepts.
Its docs distinguish crews and flows, with flows handling start/listen/router
steps, state persistence, and resume. CrewAI processes can be sequential or
hierarchical; hierarchical mode uses a manager agent to delegate tasks, validate
results, and coordinate worker agents.

Mapping:

| CrewAI concept | OpenScout observed topology |
| --- | --- |
| `Crew` | `group.kind = "crew"` |
| `Flow` | `group.kind = "flow"` |
| `Agent` | `agent.role = "definition"` unless a live run exists |
| Manager agent | active actor with `role = "manager"` |
| `Task` | `task` |
| Hierarchical delegation | `leads`, `assigned_to`, maybe `reported_to` |
| Sequential process order | `depends_on` or ordered task metadata |

Likely reader sources:

- Python project definitions if statically discoverable
- CrewAI tracing/export integrations
- checkpoint/replay metadata
- runtime event listeners, if a project installs Scout-side listeners

### AutoGen And Microsoft Agent Framework

AutoGen AgentChat explicitly models teams. Team presets include
`RoundRobinGroupChat`, `SelectorGroupChat`, `MagenticOneGroupChat`, and
`Swarm`, with `Swarm` using handoff messages to move control. Microsoft Agent
Framework is the successor direction and separates agents from graph-based
workflows with session state, middleware, telemetry, checkpointing, and
human-in-the-loop support.

Mapping:

| AutoGen / Agent Framework concept | OpenScout observed topology |
| --- | --- |
| Team / group chat | `group.kind = "team"` or `"group_chat"` |
| Participant agent | actor definition or active actor |
| Round-robin speaker order | relationship metadata on `member_of` or `routes_to` |
| Selector group chat | `leads`/`routes_to` edge from selector/controller |
| Swarm handoff | `handoff_to` or `routes_to` control edge |
| Workflow graph | `group.kind = "workflow"` |
| Workflow node | actor or function node |
| Checkpoint/session | source ref and run metadata |

Likely reader sources:

- AutoGen event streams or trace logs
- serialized component/team definitions
- Microsoft Agent Framework workflow graph definitions and telemetry
- checkpoint/session state

### LangGraph / LangChain Multi-Agent

LangGraph models multi-agent systems as graph state, nodes, conditional edges,
and commands. Handoffs can be implemented with multiple agent subgraphs, where
distinct agents are graph nodes and handoff tools return commands that choose
the next node. LangGraph emphasizes explicit context engineering around what
messages move between agents.

Mapping:

| LangGraph concept | OpenScout observed topology |
| --- | --- |
| `StateGraph` / compiled graph | `group.kind = "graph"` |
| node / subgraph | actor or function node |
| active agent state | active actor metadata |
| conditional edge | `routes_to` relationship |
| handoff command | `handoff_to` relationship plus work/event source |
| checkpoint | source ref and resume metadata |

Likely reader sources:

- graph definitions where accessible
- LangSmith traces
- checkpointer state
- runtime stream events

### LangChain Deep Agents

Deep Agents add a more harness-like subagent model on top of LangGraph and
LangChain agents. Synchronous subagents are called through a `task` tool: the
supervisor blocks until the subagent returns, which makes the pattern closer to
Claude/Codex subagent actions than to free-running teams. Async subagents cover
long-running workstreams, mid-flight steering, and cancellation.

Subagents can be declared in code with a dictionary spec, as compiled LangGraph
graphs, as CLI `AGENTS.md` files, or as deploy-time `subagents/` directories
with `deepagents.toml` and `AGENTS.md`. A default synchronous
`general-purpose` subagent is added unless disabled or replaced.

Mapping:

| Deep Agents concept | OpenScout observed topology |
| --- | --- |
| parent deep agent | active actor with `role = "supervisor"` |
| `SubAgent` dictionary | actor definition |
| `CompiledSubAgent` | actor definition with `providerMeta.runnable = "compiled_graph"` |
| default `general-purpose` subagent | actor definition with `providerMeta.default = true` |
| `task()` call | work item plus `assigned_to` edge |
| sync subagent result | terminal task state and optional result metadata |
| async subagent | active actor plus cancellable work item |
| `lc_agent_name` trace metadata | source signal for actor attribution |
| subagent `skills`, tools, model, permissions | actor definition metadata |

Likely reader sources:

- `create_deep_agent(..., subagents=...)` declarations when statically visible
- CLI `AGENTS.md` subagent files
- deploy `subagents/*/deepagents.toml` and `AGENTS.md`
- LangSmith traces with `lc_agent_name`
- task-tool call events and ToolMessage results

### Mastra

Mastra is a TypeScript application framework rather than a coding harness. It
models agents, supervisor agents, workflows, background tasks, approvals,
storage-backed memory, and observability as application primitives.

An `Agent` is a reusable actor definition registered on a `Mastra` instance.
Supervisor agents coordinate multiple subagents through an `agents` property,
using each subagent's description to decide delegation. Delegation hooks can
accept, reject, modify, or inspect subagent calls. Mastra also isolates
subagent memory: the subagent can receive supervisor context, but only scoped
delegation prompts and responses are saved to the subagent's memory. Subagent
invocations are dispatched as tool calls and can be opted into background
tasks.

Workflows are graph-like execution definitions with explicit steps, branching,
parallelism, suspend/resume, snapshots, and registration on the Mastra instance.
Older agent networks route among agents, workflows, and tools, but Mastra docs
mark them deprecated in favor of supervisor agents.

Mapping:

| Mastra concept | OpenScout observed topology |
| --- | --- |
| `Mastra` instance | group with registry metadata |
| registered `Agent` | actor definition |
| supervisor agent | active actor with `role = "supervisor"` |
| supervisor `agents` map | `can_delegate_to` or `uses_definition` edges |
| subagent delegation | work item plus `assigned_to` edge |
| delegation hook rejection | task state or event with blocked/declined metadata |
| background task | async work item with timeout/retry/concurrency metadata |
| workflow | `group.kind = "workflow"` |
| workflow step | task or function node |
| suspend / approval | waiting state with human-input source ref |
| deprecated network | `group.kind = "routing_network"` |

Likely reader sources:

- `src/mastra/index.ts` registry declarations
- `src/mastra/agents/*` and `src/mastra/workflows/*` definitions
- Mastra storage snapshots and background-task rows
- streaming events, especially delegation, approval, suspend, and workflow
  events
- observability traces or OpenTelemetry bridges

## Model Pressure From These Systems

The current `ObservedHarnessTopology` is enough for Claude and Codex, but these
frameworks suggest near-term improvements:

- split active `agents` from reusable `agentDefinitions`
- add explicit `runs` or `executions` for crew/flow/workflow instances
- add relationship kinds: `routes_to`, `handoff_to`, `reports_to`,
  `uses_definition`, `selects_next`, `can_delegate_to`
- add `evidence` or `sourceKind`: declared, observed, inferred, promoted
- add `confidence` and `lastSeenAt` for observations derived from logs/traces
- distinguish actor nodes from deterministic function/tool nodes
- classify each observation by whether it affects communication routing,
  follow-up, or unblock decisions

## Surfacing Strategy

Surface observed topology only where it improves communication:

- attach topology to `session.providerMeta.observedTopology`
- explicit Scout targets and channels
- ask/reply lifecycle
- human questions and unblock requests
- promoted external actors that have stable reply routes
- short status labels like waiting, running, blocked, or ready to reply
- source refs visible enough to explain why Scout thinks a follow-up is valid

Avoid agent-ops surfaces in Scout:

- fleet graphs whose primary purpose is monitoring
- teammate/task dashboards independent of a communication flow
- workflow run analytics
- mutation controls for external teams, tasks, subagents, or jobs

Do not make observed teammates routable by body mentions alone. Routing still
needs explicit Scout endpoint metadata.
