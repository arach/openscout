# Terminal Durable Workspaces: Current-State Assessment

Date: 2026-07-27

Scope: `packages/protocol/src/terminal-sessions.ts`, `packages/runtime`
(`local-agents.ts`, `system-probes/`, `sqlite-store.ts`), `packages/web`
(terminal server relay, discovery, `/terminal` client), `apps/desktop`
(`cli/commands/session.ts`), `apps/macos` (`ScoutTerminalEmbedView.swift`),
`apps/ios` (`TerminalSurface.swift`), `crates/scoutd/src/probes.rs`, and the
held Herdr strand snapshotted at `held-terminal-lane.patch`.

Method: direct reads plus four parallel sub-agent surveys (web server stack,
runtime tmux machinery, client surfaces, held patch). No source files were
edited. Local tool versions checked live: `herdr 0.7.3`, `tmux 3.6a`,
`zellij 0.44.3` — all three installed.

## The Ask

Durable workspaces whose tiles are primarily agent CLI sessions, mixing tmux,
Zellij, and Herdr, with an effectively unbounded number of tiles per workspace —
and Scout managing those multiplexers well enough that an operator who does not
know tmux never has to learn it.

This document answers three questions: is the start decent, what is the
low-hanging fruit, and what are the real building blocks.

## Summary Verdict

**The start is better than it looks in any single file, and worse than it looks
on paper.** The product model is right and was proven end to end. The durable
storage exists. macOS already ships named, restorable workspaces. But the
durable half and the product half are not wired to each other: the registry has
exactly one writer, every product surface runs on a 5-second live probe instead,
and each of the three clients invented its own private workspace store.

**Mix-and-match does not exist below the CLI.** There is no backend interface
anywhere in the repo — 35 branch sites and 19 union declarations across three
languages. tmux is fully driveable, Zellij is read-only, Herdr is a menu item.

**Infinite-ish tiles are one small edit away in the runtime and one real design
away in the persistence layer.** The grid array is unbounded; the authoring path
truncates to four.

**Approachability is the strongest part of the current work** and should be
defended rather than rebuilt.

## Current-State Map

### The two lanes

The single most important structural fact: there are two terminal lanes in this
repo and they do not touch.

| | Lane A — agent delivery | Lane B — terminal surfaces |
| --- | --- | --- |
| Purpose | broker sends a prompt to a running agent CLI | operator attaches to / observes a terminal |
| Owner | `packages/runtime/src/local-agents.ts` (5432 lines) | `packages/protocol/src/terminal-sessions.ts`, `apps/desktop/src/cli/commands/session.ts`, `packages/web/server/terminal-relay-*` |
| Backend abstraction | none — `tmux` is a literal string | partial — a `TerminalBackend` union with per-backend dispatch |
| Zellij | zero occurrences in the file | materialize, attach, observe, discover |
| Herdr | absent | absent (committed); added as a third branch in the held patch |

The held patch is the clearest evidence of where the seam is: it adds Herdr to
Lane B across 21 files and never opens `local-agents.ts`.

### The protocol contract states the right thesis

`packages/protocol/src/terminal-sessions.ts:1-17` is worth quoting because it is
the correct product model, written down before the code drifted:

> The durable noun is a HARNESS SESSION — a stable agent session identified by
> its harness-native source id and resumable via a resume command. A harness
> session is *materialized* through one or more disposable TERMINAL SURFACES
> (tmux, zellij, future ssh/host-control). Backends are interchangeable.

`docs/specs/terminal-session-intake-surfaces.md` (2026-06-17) proved the claim
for real, not by dry-run: a live Claude session was driven in tmux, detached,
and re-materialized in Zellij, and the harness answered from the new surface
with full prior context (`terminal-session-intake-surfaces.md:152-202`). That is
a genuine result and the foundation everything else should sit on.

The shape immediately below the thesis does not honor it:

```ts
// packages/protocol/src/terminal-sessions.ts:19-31
export type TerminalBackend = "tmux" | "zellij";

/** Backend-neutral relay descriptor for one surface. */
export type TerminalSurfaceRelay = {
  backend: TerminalBackend;
  sessionName: string;
  tmuxSession?: string;
  zellijSession?: string;
  zellijPaneId?: string;
};
```

The comment says backend-neutral; the type is a union-by-optional-field, one
field per backend. Adding Herdr means adding `herdrSession?`, which is exactly
what the held patch does. Three backends, three optional strings, and no way for
a consumer to handle a surface it does not already know about.

### Durability today: what actually survives

| Event | Survives? | Why |
| --- | --- | --- |
| Web page reload | Workspace *definitions* yes, *session* no | `localStorage` key `openscout.terminal.workspaces.v1` (`Terminal.tsx:161`), but `workspaceView`/`activeWorkspaceId`/`tiles` all init empty (`Terminal.tsx:1070-1081`), so you land back on the library |
| Web server / relay restart | tmux + Zellij sessions yes, Scout state no | `destroy()` kills only the bridge PTY, deliberately (`terminal-relay-session.ts:952-971`); Scout persists no relay id, no reconnect token, no tile binding |
| macOS app restart | Yes — fully | Six UserDefaults keys: workspaces, selection, per-workspace native tiles and web tabs, plus `restoreCommandLine` replay (`ScoutTerminalEmbedView.swift:424-425, 1522-1528, 4059-4065, 3652`) |
| iOS app restart | N/A | One hardcoded session: `tmux new -A -s scout` (`TerminalSurface.swift:624`) |
| Machine reboot | No | tmux/Zellij die; nothing re-materializes them |

Durability today is **entirely delegated to the multiplexer**, plus per-device
layout memory. Scout itself remembers a workspace only as a browser
`localStorage` blob or a macOS `UserDefaults` blob. There is no server-side
notion of a terminal workspace at all — verified: no table, no route, no type.
Every server-side `workspace` hit is a different noun (repo roots, agent
addressing qualifiers, mobile project lists).

The one thing macOS gets right that web does not: commit `27c2ba6a` (#477) gave
local shells **stable per-slot session names** so a tile reattaches to the tmux
session it had before rather than opening a fresh one. Web mints a new id from
`Date.now()` on every entry (`Terminal.tsx:983-1001`, called at `:1147`), so
fresh web tiles are not durable at all — only `registered` cells reattach.

### The registry exists and is nearly orphaned

There *is* a durable table, and its design is correct:

```sql
-- packages/runtime/src/schema.ts:127-143
CREATE TABLE IF NOT EXISTS terminal_session_registry (
  id TEXT PRIMARY KEY, harness TEXT NOT NULL, source_session_id TEXT NOT NULL,
  cwd TEXT NOT NULL, resume_command TEXT NOT NULL,
  surfaces_json TEXT NOT NULL DEFAULT '[]', metadata_json TEXT, ...);
```

Deterministic ids (`ts.${stableHash(harness + sourceSessionId)}`,
`sqlite-store.ts:561-563`) so re-intaking one harness session updates one row.

**It has exactly one writer in the entire repo**:
`apps/desktop/src/cli/commands/session.ts:471`. The web server is read-only
against it and treats it as optional — `db/terminal-sessions.ts:95-98` swallows
`no such table` and returns `[]`. On a stock install where nobody has run
`scout session intake`, `/api/terminal-sessions` returns *only* live-probe
results.

So the product runs on the ephemeral path instead, and that path fabricates
records to fit the durable type:

```ts
// packages/web/server/terminal-session-discovery.ts:174-181
const id = `discovered.${input.backend}.${sha1(input.name).slice(0, 16)}`;
return {
  id,
  harness: input.backend,                              // backend stuffed into `harness`
  sourceSessionId: input.name,
  resumeCommand: input.surface.attachCommand.join(" "), // attach cmd stuffed into `resumeCommand`
  ...
```

Two type lies in five lines. `harness` is meant to be `claude`/`codex`/`pi`;
`resumeCommand` is meant to be `claude --resume <id>`. The Herdr proposal
already flagged this (`docs/proposals/herdr-terminal-host-integration.md:122-127`)
and it is the concrete reason a discovered pane cannot be told apart from a real
harness session. Identity is also derived from the *name*, so renaming a session
changes its Scout id.

### Backend reach, measured

| Capability | tmux | Zellij | Herdr |
| --- | --- | --- | --- |
| Probe / list | yes (`system-probes/tmux.ts:179`) | yes (`:209`) | no (committed) |
| Create surface | yes | yes (CLI only, `session.ts:581-594`) | no |
| Attach / observe | yes | yes | macOS menu item only |
| Send input | yes | **no** | no |
| Capture output | yes | **no** | no |
| Surface control API | yes | **400** | no |
| Agent delivery (Lane A) | yes | **no** | no |

The asymmetry has a single crisp number. The exec-verb allowlist — the
security-reviewed RPC seam that spans TypeScript and Rust — is 8 for 8 tmux:

```ts
// packages/runtime/src/system-probes/scout-host-catalog.ts:21-32
export const SCOUT_HOST_EXEC_VERB_SCHEMA_VERSIONS = {
  "tmux.sendKeys": 1, "tmux.sendKeysLiteral": 1, "tmux.loadBuffer": 1,
  "tmux.pasteBuffer": 1, "tmux.deleteBuffer": 1, "tmux.killSession": 1,
  "tmux.newSession": 1, "tmux.detachClient": 1,
  "tailscale.cert": 1, "reveal.open": 1,
} as const;
```

Mirrored in `crates/scoutd/src/probes.rs:86-93`. There are zero `zellij.*` and
zero `herdr.*` verbs. Both daemons can *enumerate* Zellij and cannot *act* on it.
The relay files tell the same story by size: `terminal-relay-session.ts` is 1088
lines, `terminal-relay-zellij.ts` is 57 — and those 57 lines are pure argv and
KDL-layout construction, no lifecycle.

The API is honest about it, which is to its credit, but the honesty is a
dead end rather than a capability:

```ts
// packages/web/server/create-openscout-web-server.ts:6699
return c.json({ error: `${backend} surface control is not available yet` }, 400);
```

### There is no backend abstraction — 35 branch sites

Verified absent repo-wide: no `Record<TerminalBackend, …>`, no adapter table, no
`TerminalBackendAdapter` interface. Adding a backend means editing N sites.

- **19 union declaration sites** across `packages/protocol`, `packages/web/server`
  (13), and `packages/web/client` (5) — on two unrelated axes that are never
  related by a type: `"tmux" | "zellij"` (protocol, discovery, DB) and
  `"pty" | "tmux" | "zellij"` (relay wire, `terminal-relay-session.ts:24, :161`).
  macOS invents a third: `ScoutTerminalDefaultBackend` with five cases including
  `.herdr` and `.automatic` (`ScoutTerminalEmbedView.swift:181-230`).
- **35 server-side branch sites.** The densest is `createSession()`, which
  branches on backend eight times in 130 lines (`terminal-relay-session.ts:679,
  723, 730, 731, 764, 776, 826, 831`).
- Backends also fan out *structurally* — per-backend optional fields on `Session`
  (`:152-153, :165, :167, :169, :171`), on `SessionInitMessage` (`:28, :30, :32`),
  and on `TerminalSurfaceRelay` (protocol `:25-31`). Three copies of the same idea.

Two constraints on any fix:

1. **17 of the 35 branches live in a vendored file.** `terminal-relay-session.ts:1-3`
   and `terminal-relay-zellij.ts:1-2` are generated from Hudson and fenced by
   `packages/web/scripts/sync-terminal-relay-session.mjs --check` in the server
   build. `terminal-relay-session.ts:3` already warns *"OpenScout local overlay:
   SCO-078 probe/async discipline; do not regenerate blindly."* An adapter must
   sit **above** the relay, or land in Hudson. This is consistent with SCO-076's
   decision that Hudson owns the reusable terminal primitive.
2. **The precedent already exists in the same package.**
   `packages/web/server/db/internal/paths.ts:152-164` uses exactly the registry
   pattern this needs — `HARNESS_SESSION_RESOLVERS: Record<string, Resolver>`
   with a `?? default` fallback. Transports got a registry; terminal backends got
   if/else.

### The deepest coupling is not to tmux

`local-agents.ts` shells out to tmux at 13 sites across 9 verbs. But roughly 200
of its ~320 tmux-band lines are not tmux-specific at all — they are **TUI
screen-scraping of the harness's composer**:

`tmuxPaneTailShowsReadyComposer` (`:3464`), `tmuxPaneTailContainsPromptFragment`
(`:3482`), `tmuxPaneTailShowsClaudePromptAccepted` (`:3494`),
`tmuxPaneTailShowsClaudeQueuedAcceptance` (`:3522`),
`findActiveTmuxComposerAnchor` (`:3552`), `extractActiveTmuxComposerText`
(`:3564`), `isTmuxComposerBoundary` (`:3619`), `tmuxPaneTailShowsHarnessActivity`
(`:3646`). These regex over `❯`, `│`, `⏺`, and `esc to interrupt`.

Delivery is confirmed by capturing the last 20 rendered rows and pattern-matching
Claude Code's UI chrome. That coupling is to the *harness's rendering*, not to the
multiplexer — it would be identical under Zellij or Herdr, and it breaks whenever
Claude Code restyles its composer. Commit `0d6d4031` (#479) made the deadlines
env-tunable (`OPENSCOUT_TMUX_VERIFY_IDLE_DEADLINE_MS` 4000,
`OPENSCOUT_TMUX_VERIFY_BUSY_DEADLINE_MS` 15000, `local-agents.ts:3282-3289`)
precisely because the fixed budget was misreading busy agents as stalled and
latching their endpoints offline. That is a good fix to a symptom of inference.

Worth naming plainly: verification also **fails open**.

```ts
// packages/runtime/src/local-agents.ts:3417-3423
if (!paneTail) {
  // Capture failed (session gone, tmux unavailable). Treat as verified ...
  return true;
}
```

A dead session, a missing tmux binary, and a capture timeout all read as
"delivered." It is a best-effort stall detector, not a delivery guarantee, and
the code says so.

Two more structural notes on Lane A: `record.tmuxSession` appears 48 times and
leaks into `apps/desktop/src/core/broker/service.ts:2193` and
`apps/desktop/src/app/desktop/shell.ts:568` — a field name doing an interface's
job. And tmux is the **fallthrough default**, not a case: `invokeLocalAgentEndpoint`
(`:5395`), `stopLocalAgent` (`:4704`), `restartLocalAgent` (`:4167`), and
`isLocalAgentRecordOnline` (`:2641`) all fall off the end into the tmux path, so
a new host must be inserted before four separate sites or it silently gets tmux.

### Tiles: unbounded at runtime, capped at four in the authoring path

Web already has a real tiled workspace (`Terminal.tsx`, 2862 lines): a
library → builder → grid state machine (`:159`, dispatched `:1519/1532/1573`),
drag-and-drop, a session picker, and — genuinely good — an `unavailable` tile
variant (`:127-132`) that renders a tombstone for a saved cell whose session
died and rehydrates it live when the session returns (`:1241-1270`).

The `tiles` array is an unbounded `T[]`. `attachAllLiveTerminals` (`:1382-1396`)
appends every live session at once. The only ceilings are authoring-time:

```ts
// packages/web/client/screens/terminal/Terminal.tsx:163-168
const TERMINAL_GRID_PRESETS = [
  { id: "solo",  ... slots: 1 }, { id: "split", ... slots: 2 },
  { id: "trio",  ... slots: 3 }, { id: "quad",  ... slots: 4 },
];
```

`saveWorkspaceDraft` slices to `preset.slots` (`:1224`) and the builder renders
`cells.slice(0, selectedPreset.slots)` (`:1944`), while the autosave path
(`:1272-1282`) writes all tiles uncapped. So a 9-tile session saves 9 cells, and
reopening the builder snaps back to `quad` (`:1193-1196`) and silently truncates
to 4 on the next save. Column choice is capped at 3 on both clients
(`Terminal.tsx:1430-1432`; `ScoutTerminalEmbedView.swift:1234-1239`).

**A complete, tested, versioned workspace-deck library already exists and is
dead code.** `packages/web/client/lib/terminal-workspace.ts` (276 lines) has
`TerminalWorkspaceDeck<T>` with `version: 1`, a schema-validating
`normalizeTerminalWorkspaceDeck`, add/select/close/rename/updateTiles, and
edge-aware `moveTerminalWorkspaceItem` — strictly better than the inline
swap-only `swapTiles` in `Terminal.tsx:1402-1412`. Its only importer in the repo
is its own test (`terminal-workspace.test.ts:14`). It *was* imported by
`Terminal.tsx` in `7e9180e9` and `e527bc29` and was orphaned by a later rewrite.

### Addressing: four separator conventions, one parser

| Form | Site |
| --- | --- |
| `${backend}:${sessionName}` | `terminal-session-discovery.ts:161`, `terminal-relay-session.ts:1000`, `client/lib/terminal-sessions.ts:43` |
| `${session.id}:${surfaceKey}` | `client/lib/terminal-sessions.ts:211` (three colons deep, no parser) |
| `registered:` / `unavailable:` prefixed tile ids | `Terminal.tsx:1005`, `:1155` |
| `${session.id}::${backend}::${sessionName}` | `ScoutTerminalEmbedView.swift:2599` |
| `${session.id}::${backend}:${sessionName}` | `ScoutTerminalEmbedView.swift:3696-3697` |
| hyphen-joined relay storage keys over hyphen-containing fields | `client/lib/terminal-relay.ts:24, 95, 97, 99` |

The only real parser is `surfacePartsFromKey` (`client/lib/terminal-sessions.ts:63-73`),
client-side only — the server constructs surface keys and never parses one. It
works by luck: session names are constrained to `/^[A-Za-z0-9_][A-Za-z0-9_-]*$/`
by an unrelated validator (`terminal-relay-session.ts:201`) which happens to
exclude `:`. `left.tsx:84` already matches on `item.id || item.key` defensively,
and `resolveRegisteredTerminalTarget` (`client/lib/terminal-sessions.ts:84-108`)
already needs two lookup strategies to compensate for the ambiguity.

For durable workspaces this is the load-bearing risk: **a persisted cell is only
as stable as the string you rehydrate it from.**

### Approachability: what is hidden well, what leaks

Hidden well — defend these:

- `ScoutTerminalDefaultBackend` (`ScoutTerminalEmbedView.swift:181-230`) resolves
  "Automatic → Herdr, then tmux, then Zellij when installed" by probing PATH,
  falls back to a plain shell, and describes options by the property that matters
  (`"Persistent Herdr session"` vs `"Disposable local PTY"`) rather than by tool
  identity. Surfaced as `Button("Default — \(defaultBackendTitle)")` (`:785`) so
  the common path never requires choosing a multiplexer. This is the model for
  the whole feature.
- `"A workspace is a locally saved terminal layout that reopens with Scout"`
  (`:540`) — the concept explained in product language with zero jargon.
- `compactTerminalName` (`client/lib/terminal-sessions.ts:245-250`) strips
  `relay-` and the `-arts-mac-mini-local-claude` host suffix.
- `Enter` / `Observe` as the two verbs instead of attach / read-only attach.
- The unavailable-tile copy: *"This saved session is not currently live."*
- `docs/eng/no-dead-end-ui.md` already exists as a standard; the Zellij 400s
  violate it.

Leaks — the inspector is the worst offender:

- `right.tsx:135-143` renders a copyable `tmux attach -t <raw name>` and
  `env ZELLIJ_SOCKET_DIR=… zellij attach …` as primary inspector content under
  `label="Attach command"`.
- `Terminal.tsx:2327, 2423` print the raw session name
  (`relay-openscout-main-arts-mac-mini-local-claude`) directly beneath
  `compactTerminalName`'s cleaned-up version, undoing it.
- `Terminal.tsx:476, 496` put raw session names in `window.confirm` modals.
- `"Replace with Tmux"` / `"Replace with Zellij"` (`:1461-1462`),
  `"Detach Terminal Clients"` (`:522`), `"Open as xterm tile"`
  (`ScoutTerminalEmbedView.swift:908`) — renderer internals as user verbs.
- `ScoutTerminalEmbedView.swift:2601-2613` concatenates the joined `attachCommand`
  argv into a target's hover subtitle.
- iOS leaks almost nothing, but only because it does almost nothing.

## Verdict On The Start

### Genuinely good

1. **The product model is correct and was validated with a real end-to-end test**,
   not a mock — a live Claude session moved tmux → Zellij and kept its context
   (`docs/specs/terminal-session-intake-surfaces.md:152-202`). Most projects get
   this backwards and make the multiplexer the noun.
2. **The durable registry is well-designed** — deterministic ids, surfaces as a
   list on a stable harness session, scrollback explicitly excluded from Scout
   messages.
3. **macOS already ships the target feature**: named, renamable, restorable
   workspaces × renamable, restorable tiles, with restore-command replay and a
   merge guard written specifically so discovery cannot eat saved layout
   (`ScoutTerminalEmbedView.swift:1491-1520`, comment at `:1500-1502`).
4. **The approachability instinct is right and already partly shipped** — the
   automatic-backend resolver is exactly "we manage the multiplexer for you."
5. **Real operational discipline exists**: server-side observe enforcement
   (`terminal-relay-session.ts:277`), constant-time reconnect tokens (`:192`),
   multiplexer name validation before CLI interpolation (`:203`), origin
   rejection (`terminal-relay-node.ts:411-417`), the SCO-077 probe/exec-verb
   census, and the deliberate choice that destroying a relay never kills the
   multiplexer session (`:950-971`).
6. **The Herdr proposal is a genuinely good document.** Its core calls —
   discriminated transports, capabilities instead of backend conditionals,
   opaque server-issued surface ids, one Mac-local adapter — are the right calls
   and are reused below.

### Structurally wrong

1. **The durable model and the product are not connected.** One writer for the
   registry; every surface reads live probes. This is the central defect.
2. **`harness` and `resumeCommand` are overloaded to carry backend and attach
   command** (`terminal-session-discovery.ts:177-180`), which destroys the very
   distinction the protocol header asserts.
3. **No backend abstraction.** 35 branch sites, 19 union declarations, three
   languages, two unrelated union axes, three copies of the per-backend optional
   field bag.
4. **Three clients, three private workspace stores, no server truth.**
   `openscout.terminal.workspaces.v1` in `localStorage`,
   `scout.terminals.workspaces.v1` in `UserDefaults`, and nothing on iOS. Same
   version number, same idea, separately implemented, never synchronized. A
   workspace cannot follow you to another device or be reasoned about by the
   broker.
5. **Delivery verification is TUI screen-scraping that fails open.** The
   coupling is to Claude Code's rendering, not to tmux.
6. **Session identity is stringly-typed and non-durable.** Derived from the
   session *name*, composed with four separator conventions, parsed in one place
   on one side of the wire.
7. **`packages/web` is not typechecked.** Root `package.json:34` `check` runs
   protocol, desktop, runtime, cloud, and mesh — not web — and `build:server`
   uses `bun build`, which strips types without checking them. A live example
   sits in the tree: `sessionMatchesSurface` (`terminal-relay-node.ts:233-242`)
   tests `session.terminalSession`, a property that does not exist on `Session`,
   so that clause has always been dead. This is the gap that let the held lane
   accumulate its type errors.

## The Held Lane, Critiqued

`held-terminal-lane.patch` is 7496 lines over 55 files, and it is four unrelated
strands braided into one snapshot: Herdr as a third backend, a macOS terminal
rollback, chat-history pagination, and a broker/comms delivery strand. Roughly
40% is terminal work; ~200 lines of it are an unrelated ASCII orb animation. It
cannot be landed or reverted piecewise as-is, and `git apply` will not create the
seven untracked files it depends on (they are appended raw, not as diffs).

Independent of style, three findings make it non-viable in its current form, and
they confirm the Codex hold:

- **Three dangling Swift symbols.** `ScoutTerminalLaunchCommand` is called twice
  and defined nowhere; `ScoutTerminalOpener.terminalDefaultsKey` is referenced by
  a new Settings `@AppStorage` and does not exist; `ScoutThreadLoadingSkeleton` is
  deleted while its call site at `ScoutRootView.swift:2459` is untouched. The
  macOS app cannot compile.
- **The `MessageComposer` barrel replaces rather than extends its exports**,
  orphaning `ComposerAttachmentStrip` / `useComposerAttachments` /
  `ComposerAttachmentsState` while `ConversationScreen.tsx:15` and
  `ConversationComposer.tsx:9,11` still import them through it.
- **The macOS change is deletion-only.** `ScoutTerminalEmbedView.swift` is
  +200/−839.

| Strand | Call | Why |
| --- | --- | --- |
| `runtime/system-probes/herdr.ts` — CLI shell-out probe over `herdr session list --json` | **Adopt** | Clean, tested, correctly refuses client-supplied socket paths and keeps `sessionDir` off the wire. The right shape for discovery. |
| `INHERITED_CLAUDE_SESSION_ENV_KEYS` generalization in `terminal-environment.ts` | **Adopt** | Real bug fix, replaces an ad-hoc `delete env.CLAUDECODE`. Note its Swift counterpart is the missing `ScoutTerminalLaunchCommand` and must actually be written. |
| Herdr control restricted to detach / force-quit-bridge | **Adapt** | Correct instinct — Herdr host sessions outlive Scout clients and Scout must not kill them. But express it as a capability descriptor, not a 400 on a route the UI still offers. |
| `preferred-terminal-backend.ts` (server + client copies) | **Adapt** | The resolver ordering is fine and tested. Delete the byte-identical client duplicate, expose the *server* probe over an endpoint, and remove both unconditioned Herdr defaults. |
| Protocol change: `"herdr"` added to the union plus `herdrSession?: string` | **Skip** | The entire protocol delta is +5/−3. It makes `TerminalSurfaceRelay` *more* backend-coupled, and it is the change that forces the other 34 edits. Do the identity and adapter work instead. |
| `tmuxSession`-as-`herdrSession` transport hack | **Skip** | Written three times across two files with the same apologetic comment (`terminal-relay.ts` and two inline sites in `Terminal.tsx`). Fix at the Hudson boundary or via the adapter; do not duplicate a workaround. |
| Client defaults to Herdr on empty inventory | **Skip** | `if (backends.length === 0) return "herdr"` fires on cold load and on fetch error, and `addDurableTile` overrides a `"pty"` result — meaning *no durable backend installed* — back to `"herdr"`. Meanwhile `probePreferredDurableBackend` has zero call sites and `isHerdrAvailable()` is never called. The answer was computable server-side and was discarded. |
| `materializeHerdrSurface` returning `created: true` without creating anything | **Skip** | An unbacked affordance in the intake path. |
| The macOS deletion | **Revert** | See below. |

**On the macOS removals specifically.** This is not a defensible rollback in a
branch about durable workspaces. It deletes the persisted workspace store and
both UserDefaults keys, per-workspace tile and tab layout persistence, all three
rename paths, `restoreCommandLine` replay, the entire `ScoutTerminalDefaultBackend`
resolver and its Settings picker, and web Herdr creation. Replacements are a
hardcoded in-memory `"Main"`, a hardcoded `addLocalShell(mode: "shell")`, and a
UI label that advertises the regression (`persistenceNote: "kept while Scout
runs"`).

The load-bearing loss the review did not name: `persistentSessionName(workspaceID:slot:)`
is deleted and local shell ids become

```swift
- let id = "local-terminal-\(mode)-\(session)"
+ let id = "local-shell-\(UUID().uuidString)"
```

A `UUID()` in an identity key is the definition of non-durable. This deletes
exactly the mechanism that commit `27c2ba6a` (#477) shipped ten days earlier to
make tiles reattach to their own sessions.

If the AppKit drag-handle simplification (89 lines → SwiftUI coordinate space) is
independently wanted, take that hunk alone.

## Low-Hanging Fruit

Ordered by payoff per unit effort. Items 1–3 are the ones an operator would feel
tomorrow.

| # | What | Where | Effort | Payoff |
| --- | --- | --- | --- | --- |
| 1 | Give web tiles stable per-slot session names, as macOS already does | `Terminal.tsx:983-1001` (id minting), `:1147` (`enterWorkspace`) | S | The single change that makes web tiles durable at all. Today every re-entry opens a brand-new tmux session and abandons the old one. |
| 2 | Persist `activeWorkspaceId` + `workspaceView` alongside the definitions | `Terminal.tsx:1070-1071` | XS | Reload returns you to your workspace instead of the library card grid. |
| 3 | Lift the 4-slot authoring cap; let the builder author N cells | `Terminal.tsx:163-168, 1224, 1944` | S | Removes the only real bound on "infinite-ish tiles"; also fixes the silent truncation of a 9-tile workspace back to 4. |
| 4 | Adopt the orphaned deck library instead of the weaker inline model | `client/lib/terminal-workspace.ts` → `Terminal.tsx` | S | Already written, already tested, versioned, normalizing, with real reordering. Deleting the inline `swapTiles` is a net line reduction. |
| 5 | Add `packages/web` to the root `check` script | `package.json:34` | S | Will surface a real backlog (see the SCO-078 note in `docs/eng`), but it is the control that would have caught the held lane's barrel break and cast holes before review. |
| 6 | Delete the dead `session.terminalSession` clause | `terminal-relay-node.ts:239` | XS | Removes a permanently-false condition in surface matching. |
| 7 | Demote raw attach commands from primary inspector content to a disclosure | `right.tsx:135-143, 68, 85` | XS | The single biggest jargon leak. Keep copy-to-clipboard; stop leading with it. |
| 8 | Stop printing the raw session name directly under `compactTerminalName` | `Terminal.tsx:2327, 2423, 476, 496` | XS | The cleanup function already exists and is being undone one line later. |
| 9 | Hide control actions for surfaces that cannot perform them instead of 400ing | `create-openscout-web-server.ts:6694-6699`, `Terminal.tsx:522-526` | S | Honors `docs/eng/no-dead-end-ui.md`. Natural precursor to capability descriptors. |
| 10 | Write the registry from the paths that actually create sessions | `terminal-relay-session.ts:571-667`, `create-openscout-web-server.ts:1438` | M | Makes the durable table reflect reality rather than only CLI intake. Cheapest step toward retiring the fabricated `harness: backend` records. |

## Building Blocks

### 1. A surface identity primitive

*Shape*: opaque, server-issued surface ids; exactly one constructor and one
parser, shared by TypeScript and Swift; never split on a separator in a client or
a URL. Identity derived from (node, backend, host session, pane) — not from the
mutable display name.

*Unlocks*: durable workspace cells that survive a rename; deep links that do not
encode backend syntax; the ability to point a SCO-092 route alias at a tile
(`scout alias set left --to surface:…`) using a primitive that already exists and
is implemented.

*Replaces*: four separator conventions, two defensive lookup strategies, and the
`sha1(name)`-derived discovery id.

### 2. A terminal host adapter interface plus registry

*Shape*: `probe() / list() / create() / open(mode) / control(action) / capabilities()`,
with tmux, Zellij, and Herdr as implementations behind a
`Record<string, TerminalHostAdapter>` and a `?? default` fallback — the pattern
`HARNESS_SESSION_RESOLVERS` (`db/internal/paths.ts:152-164`) already uses one file
away.

*Constraint*: it must sit **above** `terminal-relay-session.ts`, which is vendored
from Hudson under a sync fence and holds 17 of the 35 branch sites. Per SCO-076,
Hudson owns the reusable terminal primitive; Scout owns the registry and routing.

*Unlocks*: Herdr and Zellij at parity without a 21-file edit; a fourth backend
(SSH, host-control) as an implementation rather than a migration.

*Depends on*: 1 (adapters return surfaces; surfaces need stable ids).

### 3. Capability descriptors instead of backend conditionals

*Shape*: each surface advertises what it supports — `observe`, `takeover`,
`sendInput`, `capture`, `closePane`, `restartAgent`, `resize`. Clients render
supported actions only. This is the Herdr proposal's call
(`herdr-terminal-host-integration.md:166-183`) and it is right.

*Unlocks*: the Zellij dead ends disappear without special-casing; new backends
need no UI edits; the correct Herdr policy ("Scout detaches, Scout never kills
the host session") becomes a declared capability instead of a 400.

*Depends on*: 2.

### 4. A server-owned workspace record

*Shape*: a broker/runtime table — workspace id, name, purpose, ordered cells,
each cell holding a surface reference plus the *intent* needed to re-materialize
it (backend preference, cwd, harness, resume command). Note the shape already
exists on the client, twice: `TerminalWorkspaceDefinition` (`Terminal.tsx:150-157`)
and `SavedWorkspace`/`SavedTile` (`ScoutTerminalEmbedView.swift:419, 1300-1343`).
Promote one of them rather than designing a third.

*Unlocks*: one workspace visible on web, macOS, and iOS; survives device loss;
addressable by the broker; the actual literal ask.

*Depends on*: 1. Should absorb 4 from the fruit list rather than duplicating it.

### 5. Reconciliation between saved cells and live surfaces

*Shape*: a server-side resolver that maps each saved cell to a live surface,
a restorable-but-dead surface, or an unavailable one — and re-materializes on
request. The client-side prior art is already good: the `unavailable` tile
tombstone and its rehydration effect (`Terminal.tsx:127-132, 1241-1270`), and
macOS's merge guard that refuses to let discovery replace a Scout-created tile
(`ScoutTerminalEmbedView.swift:1491-1520`). Move that judgment to the server so
all three clients inherit it.

*Unlocks*: the only honest answer to reboot. tmux and Zellij sessions do not
survive a restart; a workspace that stores intent can rebuild itself, and one
that stores only a session name cannot.

*Depends on*: 4.

### 6. Host-neutral delivery in Lane A

*Shape*: replace `record.tmuxSession` (48 uses, leaking into desktop shell and
broker service) with a host-neutral surface descriptor; make tmux an explicit
case rather than the fallthrough at `local-agents.ts:2641, 4167, 4704, 5395`;
generalize the exec-verb namespace from `tmux.*` to backend-parameterized surface
verbs across both `scout-host-catalog.ts` and `crates/scoutd/src/probes.rs`.

*Unlocks*: agents that Scout dispatches to can run under Zellij or Herdr. Today
they cannot, which is the reason "mix and match" is currently untrue for the
sessions Scout itself starts.

*Note*: the paste protocol is the real port cost. `load-buffer` +
`paste-buffer -dpr` gives bracketed-paste semantics without keystroke racing;
Zellij's `action write-chars` is not equivalent. Expect a per-backend input
strategy, not a shared one.

### 7. Observed agent state where the host provides it

*Shape*: keep composer scraping as the tmux fallback; prefer a host-reported
agent state when one exists.

This is the steal-don't-chase call, and it is unusually clear-cut. Herdr is not a
generic multiplexer — its own help text calls it a *"terminal workspace manager
for AI coding agents"*, and it already ships the primitives this project is
building:

```
herdr workspace create [--cwd PATH] [--label TEXT] [--focus]
herdr agent start <name> [--cwd PATH] [--workspace ID] [--tab ID] [--split right|down]
herdr agent send <target> <text>
herdr agent read <target> [--source visible|recent] [--format text|ansi]
herdr agent wait <target> --status <idle|working|blocked|unknown> [--timeout MS]
```

`herdr agent wait --status` is an observed answer to the question
`local-agents.ts:3464-3648` infers from ~200 lines of regex over rendered TUI
frames — and misreading that question is precisely what #479 had to paper over
with tunable deadlines. It is not a drop-in replacement (Scout also needs "did my
specific prompt get submitted", which is narrower than "is the agent working"),
but it converts the fragile half from inference to observation.

The strategic point is worth stating plainly: **Herdr already is a durable
agent-CLI workspace manager.** Scout should not rebuild workspace layout,
tabs, and panes to compete with it. Scout's layer is coordination — which agent,
which work, which project, who needs you — projected over whatever host is
present. Building blocks 1–5 are the parts Scout must own because they are about
Scout's identity model; workspace layout mechanics are the part to delegate where
a host offers them.

*Depends on*: 2.

For tmux, prior art is `tmux-resurrect`/`continuum` — worth noting only because
it settles one decision: they persist *intent* (program, cwd, layout) and replay
it, not process state. Block 4 should store the same, which is what macOS's
`restoreCommandLine` already does in a cruder form.

## Recommended Sequence

**Phase 0 — make what exists actually durable, and typechecked.**
Fruit 1, 2, 3, 5, 6, then 4. No new architecture. After this, a web workspace
reopens where you left it, with tiles that reattach to their own sessions, and
`packages/web` is under type control. Fruit 1 alone closes the largest gap
between the web and macOS clients.

**Phase 1 — identity and honesty.**
Building block 1 (surface identity), then fruit 7, 8, 9 and building block 3
(capabilities) on top of it. Ship capability descriptors before adding any
backend, so the third backend does not add a fourth set of dead-end buttons.

**Phase 2 — the adapter, and Herdr through it.**
Building block 2. Land Herdr as an adapter implementation, not as a third branch —
adopting the held lane's `herdr.ts` probe and env-key fix, and skipping its
protocol edit and transport hack. Bring Zellij to parity in the same pass; it is
currently the strongest argument that the seam is missing. Revert the macOS
deletion first so this phase does not build on a regression.

**Phase 3 — the workspace becomes a Scout object.**
Building blocks 4 and 5. Clients become views over a server record. iOS gets
workspaces for the first time without a third private store.

**Phase 4 — close Lane A.**
Building blocks 6 and 7. This is the largest and the most deferrable: nothing
above depends on it, and it is the only phase that touches the prompt-delivery
path that currently works.

One sequencing warning: do not start at Phase 2. Adding a backend is the visible
work, and it is the reason the held lane produced 7496 lines with a net loss of
durability on macOS. The identity primitive is unglamorous and everything else
rests on it.

## References

- [`docs/proposals/herdr-terminal-host-integration.md`](../proposals/herdr-terminal-host-integration.md) — the target architecture; its capability and opaque-id calls are adopted here
- [`docs/specs/terminal-session-intake-surfaces.md`](../specs/terminal-session-intake-surfaces.md) — the original model and the tmux → Zellij validation
- [`docs/eng/sco-076-xterm-super-component.md`](./sco-076-xterm-super-component.md) — Hudson owns the terminal primitive; Scout hosts it
- [`docs/eng/sco-077-system-probe-discipline.md`](./sco-077-system-probe-discipline.md) — the probe/exec-verb census the adapter should extend
- [`docs/eng/sco-092-post-hoc-route-aliases.md`](./sco-092-post-hoc-route-aliases.md) — the alias primitive that can name tiles once they have stable ids
- [`docs/eng/no-dead-end-ui.md`](./no-dead-end-ui.md) — the standard the Zellij control 400s violate
- `held-terminal-lane.patch` (worktree root, untracked) — the held strand critiqued above
