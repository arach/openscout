# SCO-075: Terminal PTY Parity Inventory

## Status

Research inventory and parity target.

## Proposal ID

`sco-075`

## Date

2026-07-01

## Intent

Inventory the concrete PTY and web-terminal techniques used by Orca and compare
them with other mature xterm.js terminal stacks. Use the result as an
OpenScout checklist: parity where the pattern is proven, better where Scout has
native, mobile, broker, or tmux/zellij advantages.

## Working conclusion

OpenScout should keep both terminal lanes, but judge them separately:

- Native Apple surfaces should keep using Termini/Ghostty. That path is strong
  for local macOS PTYs and iOS SSH takeover.
- The web terminal cockpit should be xterm.js-based. For multi-pane, browser,
  Electron, remote, and harness-style terminals, xterm.js has the deepest
  ecosystem and the clearest performance playbook.
- Our current web relay is good enough for a single terminal, but it is not yet
  Orca/VS Code class. The missing pieces are output flow control, ACK-based
  backpressure, active/hidden pane prioritization, renderer scheduling,
  richer xterm add-ons, WebGL policy/recovery, and automated perf gates.

## Source Set

Primary sources reviewed:

- Orca repo: https://github.com/stablyai/orca at commit
  `021cfc4f5d23341f710d711146c73e507780f0b3`
- Orca terminal docs: https://www.onorca.dev/docs/terminal
- xterm.js flow-control guide: https://xtermjs.org/docs/guides/flowcontrol/
- VS Code terminal docs: https://code.visualstudio.com/docs/terminal/advanced
- VS Code terminal process and xterm wrapper:
  https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/node/terminalProcess.ts
  and
  https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/terminal/browser/xterm/xtermTerminal.ts
- Eclipse Theia terminal package:
  https://github.com/eclipse-theia/theia/tree/master/packages/terminal
- JupyterLab terminal widget:
  https://github.com/jupyterlab/jupyterlab/blob/main/packages/terminal/src/widget.ts
- terminado terminal server:
  https://github.com/jupyter/terminado

OpenScout files checked:

- `packages/web/client/scout/slots/Terminal.tsx`
- `packages/web/server/terminal-relay-node.ts`
- `packages/web/server/terminal-relay-session.ts`
- `packages/web/node_modules/hudsonkit/dist/chunk-EIA5Q3GK.js`
- `apps/macos/Sources/Scout/ScoutTerminalEmbedView.swift`
- `apps/ios/Scout/TerminalSurface.swift`
- `/Users/arach/dev/Termini/Sources/Termini/TerminiLocalPTYProcess.swift`
- `/Users/arach/dev/Termini/Sources/Termini/TerminiTerminalController.swift`
- `/Users/arach/dev/Termini/Sources/Termini/TerminiSurfaceView.swift`

## Inventory Model

A high-quality PTY implementation is not one trick. It is a pipeline:

1. Process owner: spawn, env, cwd, resize, kill, child-process detection.
2. Transport: PTY bytes to renderer, renderer bytes to PTY, reconnect, remote
   and mobile paths.
3. Backpressure: bounded queues, ACKs, pause/resume, priority lanes.
4. Renderer: xterm options, add-ons, GPU policy, fit/focus, scrollback.
5. UX/runtime integration: search, links, paste, IME, titles, bells, agent/TUI
   status, snapshots, tests, diagnostics.

Orca touches every layer. OpenScout currently touches several, but the web
path still lacks the heavier control loops.

## Orca PTY Inventory

### Runtime and Dependencies

- Uses `node-pty` for local PTY process ownership.
- Uses xterm.js 6.1 beta and a broad add-on set: `fit`, `search`,
  `serialize`, `unicode11`, `web-links`, `webgl`, `ligatures`, and
  `@xterm/headless`.
- Uses `ssh2` for remote PTY providers.
- Carries patched dependencies for `node-pty`, xterm ligatures, and xterm
  WebGL.
- Has explicit terminal test scripts for rendering golden tests, release
  evidence, typing latency, foreground redraw freeze, hidden TUI restore,
  artificial agent load, scale perf, and report budget checks.

### xterm Construction

Orca's default terminal options include:

- `allowProposedApi: true`.
- Block cursor, blinking cursor, and inactive cursor style derived from active
  cursor style.
- Cross-platform monospace fallback chain with Nerd Font and common terminal
  faces.
- Default desktop scrollback of 5000 rows, with policy clamps elsewhere.
- Font size 14, light font weight, medium bold weight.
- `minimumContrastRatio: 4.5`.
- macOS option behavior tuned for text composition: `macOptionIsMeta: false`.
- `drawBoldTextInBrightColors: true`.
- Slim scrollbar width of 7.
- `vtExtensions.kittyKeyboard: true`.
- Scroll sensitivity and fast-scroll sensitivity normalized to bounded ranges.

### xterm Add-ons

Orca loads:

- `FitAddon` for geometry fitting.
- `SearchAddon` for terminal search.
- `SerializeAddon` for renderer-owned buffer snapshots and restore.
- `Unicode11Addon`, activated before terminal writes.
- `WebLinksAddon` for URL interaction.
- `LigaturesAddon`, with WebGL atlas refresh/recreation when ligatures change.
- `WebglAddon`, behind an explicit policy and fallback path.

This is meaningfully beyond OpenScout's current web surface, which loads only
`fit` and optionally `webgl` through HudsonKit.

### Renderer and WebGL Policy

Orca treats WebGL as fast but fallible:

- GPU setting supports `on`, `off`, and `auto`.
- `auto` allows WebGL on non-Linux by default.
- On Linux, `auto` disables WebGL on Wayland, when WebGL2 is unavailable, when
  renderer identity cannot be read, or when renderer/vendor looks software
  backed (`swiftshader`, `llvmpipe`, `softpipe`, `software rasterizer`,
  `basic render`, `virgl`, `svga3d`).
- One failed WebGL attach in auto mode suggests DOM for new panes until the
  GPU setting changes.
- Context loss falls back to DOM for that pane until remount instead of trying
  to recreate WebGL in a loop.
- Attach calls repaint immediately so WebGL canvases do not appear blank until
  new PTY output arrives.
- Renderer teardown refits because DOM and WebGL cell metrics can differ.
- WebGL texture atlas recovery clears and refreshes atlases on the next frame,
  then again after 120 ms and 500 ms. This covers glyph-atlas corruption without
  relying on context-loss events.
- Hidden panes can suspend rendering to conserve Chromium GPU contexts.

### Pane Lifecycle

Orca's pane lifecycle does more than `terminal.open()`:

- Opens xterm, loads add-ons, activates Unicode 11, fits, focuses, and wires
  event handlers as a pane-owned lifecycle.
- Tracks mouse wheel input and scroll intent so output writes do not yank the
  viewport unexpectedly.
- Handles IME composition edge cases by syncing the xterm helper textarea.
- Cleans up add-ons, resize observers, scroll tracking, pending rafs, WebGL,
  and terminal objects on dispose.
- Recreates WebGL when ligatures or renderer-relevant options change.

### Provider Registry and PTY Ownership

Orca centralizes PTY ownership in main-process IPC:

- Local provider plus SSH provider registry.
- `ptyOwnership` maps PTY id to provider/connection id so write, resize, kill,
  foreground-process, and child-process calls route correctly after spawn.
- `ptySizes` tracks last known geometry for mobile and detached clients.
- Pane keys map to PTY ids and back to avoid duplicate shells during races.
- Pending spawn reservations by pane key let the loser of a mobile/renderer
  race adopt the winner's PTY instead of spawning another process.
- Provider cleanup clears PTY-owned state from agent hooks, URL watchers,
  startup color query replies, active/visible sets, migration state, and
  memory registries.
- Daemon-backed PTYs can survive renderer restarts by design, while
  main-process local PTYs can be killed as orphans on renderer reload.

### Spawn and Environment

Orca's spawn path includes:

- Command, cwd, env, shell, project runtime, agent, and auth-context handling.
- `TERM=xterm-256color`.
- WSL-aware env selection and Codex/Claude account home handling.
- Cleanup of stale Orca-owned env vars before spawn.
- Optional attribution shims applied only to Orca-owned PTYs.
- Agent hook env injection where appropriate.
- Folder workspace path validation before spawning.
- SSH session expiry and provider-not-available handling.

### Main-to-Renderer Output Batching

Orca batches PTY data before renderer IPC:

- Batch interval: 8 ms.
- Continuation delay: 1 ms.
- Chunk size: 16 KB.
- Max writes per flush: 2.
- Per-PTY in-flight high water: 512 KB.
- Total renderer in-flight high water: 8 MB.
- Interactive reserve: 256 KB global plus 512 KB for active PTY.
- Recent-input window: 100 ms.
- Interactive output budget: 32 KB.
- Small interactive output bypasses the batch timer when safe.
- ANSI redraws up to 16 KB can be treated as interactive.
- Active PTYs flush before background PTYs.
- Background/hidden data is marked in metadata.
- Debug snapshots expose pending chars, in-flight chars, max per PTY, active
  PTY count, peak values, and ACK-gated skip counts.

This is the biggest architectural difference from OpenScout's current web
relay, which sends each PTY data event as a JSON websocket message.

### Renderer ACK Backpressure

Orca has explicit ACKs:

- Renderer calls `pty:ackData` after accepting a payload into the dispatcher.
- ACKs include the raw length when data was transformed.
- Main subtracts ACKed chars from per-PTY and total in-flight counters.
- ACK handling schedules another flush when space opens.
- ACK happens in a `finally` block after sidecar handlers so a throwing sidecar
  cannot permanently backpressure a PTY.

This follows the xterm.js flow-control principle: data accepted into xterm or
the renderer should be acknowledged, and the producer must stop when the
consumer is behind.

### Renderer Output Scheduler

Orca has a second scheduling layer inside the renderer before `xterm.write()`:

- Background flush delay: 50 ms.
- Background drain interval: 16 ms.
- High-priority interval: 1 ms.
- Background chunk size: 16 KB.
- Max writes per drain: 2.
- High-priority max writes per drain: 16.
- Large backlog threshold: 512 KB.
- Synchronous foreground flush cap: 256 KB.
- Max background queue: 2 MB.
- Max background chunks: 4096.
- Hidden/background backlog is lossy above the cap, with a terminal-visible
  warning that hidden output was skipped.
- Foreground writes can be coalesced or held for TUI redraw settle.
- Latency-sensitive coalesce and hold windows are shorter.
- Scroll intent is captured before write and enforced after write.
- Debug API tracks enqueue counts, write counts, drain writes, queue peaks,
  and dropped backlog count.

The two-layer design matters: main-process backpressure protects IPC and
process memory; renderer scheduling protects xterm parsing, paint, scroll, and
input responsiveness.

### Input and Paste

Orca bounds terminal input:

- Max input payload: 16 MB.
- Max input chunk: 16 KB.
- Byte measurement is UTF-8 aware and can yield for huge clipboard text.
- Large input is chunked by code point, not split in the middle of multibyte
  characters.
- Pending input writes drain asynchronously with event-loop yields.
- `writeAccepted` exists for operations that need truthful acceptance, such as
  Ctrl-C/Escape and large startup/draft paste flows.
- SSH paths can report fire-and-forget limitations separately from local PTYs.
- Paste coordination uses bracketed-paste-aware scanners and rejects oversized
  payloads before touching xterm or the PTY.

### Resize and Geometry

Orca separates resize semantics:

- `pty:resize` resizes the real PTY.
- `pty:reportGeometry` records measured geometry without resizing. This lets
  mobile or hidden/driver-controlled paths report dimensions without fighting
  the real PTY owner.
- Hidden resize output is tracked so a resize-induced TUI repaint can be
  delivered and recovered when the pane becomes visible.
- Resize calls are provider-routed, not hardcoded to local PTYs.
- Mobile/desktop driver locks prevent unrelated surfaces from resizing each
  other at the wrong time.

### Visibility and Hidden Panes

Orca gives foreground panes priority and treats hidden panes as bounded:

- Renderer reports active PTY id.
- Renderer reports visible PTY id.
- Main prioritizes active PTYs in flush order and gives active PTYs extra
  interactive reserve.
- Hidden/known-invisible output is marked as background.
- Hidden background queue can be dropped above 2 MB with a terminal-visible
  warning.
- On visible resume, Orca drains a bounded 256 KB before fitting and lets the
  rest continue asynchronously.
- On window wake, Orca drains a bounded 64 KB and refreshes WebGL atlases.
- Hidden panes can suspend rendering but keep xterm state and output flow.

### Reconnect, Replay, and Scrollback

Orca has several restore paths:

- Renderer-owned serialization through `SerializeAddon`.
- Headless/runtime snapshot paths for mobile and daemon use.
- Pending serializer handshake by pane key so renderer-owned scrollback wins
  when appropriate.
- Eager pre-handler buffers for bytes that arrive before a pane handler mounts.
- Eager buffer cap: 512 KB.
- Eager buffer uses a head index instead of `Array.shift()` to avoid
  quadratic behavior under many small chunks.
- Replay uses a separate IPC channel so xterm auto-replies can be suppressed
  during replay.
- Replay suppresses attention side effects such as stale bells and completion
  notifications.
- Local session scrollback store and replay caps are separate:
  512 KB session buffer, 512 KB replay, 5 MB store.

### Remote and Mobile Streaming

Orca's runtime terminal RPC has a binary-framed streaming path:

- Mobile subscribe scrollback rows: 1000.
- Mobile snapshot budget: 512 KB.
- Requested snapshot budget: 2 MB.
- Stream chunk size: 48 KB.
- Output flush: 5 ms.
- Output batch max: 64 KB.
- Multiplex pending max: 256 KB.
- Output chunks carry sequence metadata where possible.
- Mobile input lock rules are explicit.
- Snapshots include scrollback, dimensions, alternate-screen behavior, and
  truncation metadata.

### Agent and TUI Metadata

Orca parses side effects without letting them block rendering:

- OSC titles are extracted in order because an 8 ms batch can contain multiple
  title updates.
- Bells are detected.
- Agent status OSC data is parsed before xterm sees it.
- Status/title/bell side effects are deferred with `setTimeout(0)`.
- Side-effect drain is capped at 64 effects per tick.
- Side-effect queues keep compact derived facts, not raw PTY chunks.
- Stale working titles are cleared after a timeout.
- Replay suppresses side effects so old buffers do not produce fresh
  notifications.

### Keyboard, IME, Mouse, and Links

Orca's terminal stack handles:

- Kitty keyboard protocol advertisement.
- Physical-key terminal encoding where compatibility requires it.
- Mac Option behavior tuned for composing characters.
- IME composition fixups around xterm's helper textarea.
- Mouse wheel sensitivity, fast scroll, and scroll intent tracking.
- Web links via xterm add-on.
- Search via xterm add-on.
- Copy and serialized HTML via serialize add-on.

### Diagnostics and Tests

Orca holds terminal quality with dedicated tests:

- Golden rendering for raw emoji/table/scroll-restore cases.
- Release evidence for emoji table and long table restore.
- Typing latency.
- Foreground redraw freeze.
- Output scheduler behavior.
- Hidden TUI visual restore.
- Artificial agent terminal load.
- Scale perf report and budget checks.
- SSH docker perf.
- Unit tests for input chunking, paste coordination, scrollback limits,
  provider/daemon behavior, and dispatcher edge cases.

## External Examples

### VS Code / Codespaces Class

What VS Code contributes:

- Clear process owner around `node-pty`.
- `TERM=xterm-256color` on POSIX.
- Windows ConPTY handling, including delayed resize for early resize bugs and
  resize clamps to at least 1 row/column.
- Shell integration injection and nonce/env handling.
- Child-process monitoring and process title/shell type tracking.
- Flow control with `_unacknowledgedCharCount`.
- Pause PTY when chars exceed `FlowControlConstants.HighWatermarkChars`.
- Resume PTY when ACKed chars fall below `FlowControlConstants.LowWatermarkChars`.
- Explicit `acknowledgeDataEvent(charCount)` and `clearUnacknowledgedChars()`.
- xterm options driven by user config: scrollback, contrast, font, cursor,
  mac option behavior, word separators, bracketed paste behavior, kitty keyboard,
  win32 input mode, image/transparency options.
- Add-ons for shell integration, decorations, clipboard, serialize, unicode,
  WebGL, images, links/search in the broader terminal stack.
- WebGL fallback: if attach fails, suggest DOM renderer; if context is lost,
  dispose WebGL; refresh dimensions because renderer metrics differ.
- Unicode version selection through `Unicode11Addon`.
- Serialize-as-HTML and buffer serialization helpers.

Best practices to copy:

- Treat flow control as a first-class terminal API, not a debug patch.
- ACK by chars/bytes and pause the PTY, not merely drop websocket messages.
- Keep resize defensive across platforms.
- Use xterm configuration as product surface: fonts, contrast, cursor,
  keyboard protocol, paste, scrolling, renderer.
- Treat WebGL as an optimization with safe fallback.

### Eclipse Theia

What Theia contributes:

- A clean frontend/backend terminal extension boundary.
- Backend terminal server creates shell processes through a process manager.
- xterm, fit, search, and webgl dependencies are declared as part of the
  terminal package.
- Frontend contribution owns command registration: new terminal, profiles,
  split, clear, kill, search, paste, copy, scroll commands, terminal toggle.
- Context keys identify terminal focus and search visibility.
- Profile/default-shell selection is preference-driven and platform-aware.
- Environment variable collections can be persisted and restored.
- Server validates terminal options from the client: shell must be executable,
  root URI must be an existing directory, cols/rows must be sane positive
  integers within bounds, args must have expected type.
- Invalid options fall back to defaults instead of hard failing, so users with
  bad prefs still get a terminal.

Best practices to copy:

- Make terminal creation extensible and profile-driven.
- Validate client-supplied shell/cwd/geometry before spawn.
- Keep terminal commands integrated with global command/keybinding contexts.
- Persist terminal env collections when the product supports extension-like
  process customization.

### JupyterLab + terminado

What JupyterLab contributes:

- xterm widget is created asynchronously and buffers server output while xterm
  add-ons load, preventing first-output loss.
- Uses `allowProposedApi` for search coloring.
- Loads fit, search, web-links, and either WebGL or Canvas renderer.
- Detects WebGL support and falls back to Canvas.
- WebGL context loss disposes the renderer and reinitializes renderer add-on.
- Sends input as `stdin` messages.
- Sends `set_size` messages with rows, cols, pixel height, and pixel width.
- Updates title from xterm title changes.
- Handles Shift+Enter specially while respecting IME composition.
- Offers shutdown-on-close and close-on-exit behavior.
- Integrates terminal sessions into running-session management.

What terminado contributes:

- Server-side `PtyWithClients` model with multiple websocket clients.
- Rolling `read_buffer` for reconnect replay, capped by count.
- `TERM=xterm-256color` and `COLUMNS`/`LINES` env setup.
- Named terminals that can be reattached by URL/session name.
- Unique-terminal manager and named-terminal manager as separate lifecycle
  policies.
- Resizes a shared PTY to the smallest connected client so the terminal does
  not render beyond any viewer's viewport.
- PTY reads are event-loop-driven and read up to 64 KB.
- Websocket protocol is small: `setup`, `stdout`, `stdin`, `set_size`,
  `disconnect`.
- Blocking PTY writes are explicitly kept off the primary event loop.

Best practices to copy:

- Buffer output while the renderer/add-ons initialize.
- Make named-session reconnect a first-class server concept.
- Keep protocol simple but bounded.
- Include pixel dimensions in resize paths where renderer/PTY features need
  them.
- Decide shared-viewer resize policy explicitly.

## Current OpenScout Inventory

### Web Terminal Surface

Current strengths:

- `packages/web` depends on `@xterm/xterm`, `@xterm/addon-fit`,
  `@xterm/addon-webgl`, `@lydell/node-pty`, `hudsonkit`, and `ws`.
- `ScoutTerminal` uses HudsonKit's `useTerminalRelay` and `TerminalRelay`.
- HudsonKit persists a session id in localStorage under
  `hudson.relay.${sessionKey}`.
- HudsonKit buffers pending output up to 512 KB until a terminal data callback
  is attached.
- HudsonKit sends `session:init` with cols, rows, cwd, workspace files,
  orphan TTL, backend, tmux session, agent, provider, and model.
- HudsonKit's web terminal creates xterm with font, theme,
  `minimumContrastRatio`, blinking bar cursor, transparency, scrollback 5000,
  `convertEol: false`, and `allowProposedApi: true`.
- HudsonKit loads `FitAddon`, optionally loads `WebglAddon`, and fits/resizes
  through `ResizeObserver`.
- The relay server supports `session:init`, `session:reconnect`,
  `terminal:input`, and `terminal:resize`.
- Server sessions have a 512 KB rolling output buffer.
- Detached sessions are kept alive by orphan TTL, default 30 minutes.
- Relay supports `pty`, `tmux`, and `zellij` backends.
- tmux attach bridge does not kill the tmux session when the bridge is
  destroyed.
- zellij attach bridge supports a persistent socket directory.
- Spawn env includes `TERM=xterm-256color` and `FORCE_COLOR=1`.
- Crash handling surfaces early-exit output as a user-readable reason.

Current gaps:

- No ACK from browser to relay after data is accepted or written.
- No server-side pause/resume based on renderer or websocket pressure.
- No PTY output batching; each `onData` is forwarded as one JSON websocket
  message.
- No active/visible terminal hints.
- No hidden-pane priority, hidden backlog cap, or lossy warning.
- No renderer-side output scheduler around `term.write`.
- No search, serialize, unicode11, web-links, ligatures, clipboard add-on, or
  shell-integration layer in the current web terminal.
- WebGL is tried when import succeeds, but there is no Linux/Wayland/software
  renderer policy, no suggested DOM fallback, no atlas recovery, and no
  dimensions refresh after fallback.
- Reconnect replay is raw bytes only, not renderer-owned serialization.
- No eager pre-handler buffer distinct from reconnect buffer.
- No binary terminal stream path, sequence metadata, or mobile snapshot protocol
  in the web relay.
- No input size cap, UTF-8 chunking, paste coordination, or truthful
  `writeAccepted`.
- Resize is a direct PTY resize, with no separate measured-geometry report.
- No dedicated terminal perf/regression test suite.

### Native Apple Surface

Current strengths:

- macOS can use Termini/Ghostty-backed local PTYs when `HUDSON_TERMINAL` is
  enabled.
- Native macOS terminal grid supports multiple tiles, refresh, new shell,
  open web, header toggle, shape controls, and plain shell vs tmux mode.
- iOS terminal uses `HudTerminalSurface`/TerminiSSH for a real SSH PTY into
  the paired Mac.
- iOS uses a startup command equivalent to `tmux new -A -s scout` for
  persistence.
- iOS pins the Mac host key and uses a provisioned device identity.
- Termini local macOS PTY uses `forkpty`, nonblocking master fd, 4096-byte read
  buffer, `DispatchSourceRead`, process exit source, `ioctl(TIOCSWINSZ)` resize,
  and retry-on-EAGAIN writes.
- Termini controller buffers pending output before the surface binds.
- Termini/Ghostty surface updates backing scale, size, focus, key/mouse
  forwarding, visible text, diagnostics, and scheduled drawing.

Current gaps relative to the web cockpit:

- Native Ghostty does not automatically solve web multi-pane relay behavior.
- Termini local PTY has good OS-level mechanics, but does not provide Orca-like
  browser ACKs, xterm add-ons, or web-hidden-pane scheduling.
- iOS SSH/tmux path is excellent for one active takeover terminal, not a
  replacement for dense web operator panes.

## Parity Table

| Area | Mature baseline | OpenScout current | Target |
| --- | --- | --- | --- |
| PTY spawn | Provider registry, validated cwd/env/shell, cleanup | Direct relay sessions plus tmux/zellij | Add provider-owned session model and validated options |
| Output transport | 8 ms batching, 16 KB chunks, active priority | Raw JSON per PTY event | Batch, sequence, and prioritize |
| Backpressure | ACK, high/low water, pause/resume | None | Browser ACK plus server pause/resume |
| Renderer scheduling | Separate xterm write queue, hidden cap | Direct `term.write` | Foreground/background scheduler |
| Hidden panes | Visible/active hints, lossy cap, resume flush | None | Explicit active/visible hints and bounded hidden backlog |
| xterm add-ons | Fit, search, serialize, unicode11, links, ligatures, WebGL | Fit and optional WebGL | Add baseline add-ons and feature controls |
| WebGL | Auto policy, context fallback, atlas recovery | Try/catch dispose only | Platform policy and recovery |
| Reconnect | Renderer serialization, replay guards, eager buffers | Raw 512 KB replay | Serializer snapshots plus replay mode |
| Input | 16 MB max, 16 KB chunks, writeAccepted | Unbounded websocket input | UTF-8 chunking and accepted writes |
| Resize | Resize vs reportGeometry, mobile locks | Direct resize | Separate measurement from PTY resize |
| Remote/mobile | Binary chunks, snapshots, budgets | Web relay only; native iOS separate | Relay-grade stream protocol if web terminal becomes mobile-visible |
| Tests | Terminal perf and rendering gates | No terminal-specific perf gates | Add stress and latency tests |

## OpenScout Parity Checklist

### P0: Terminal Must Not Fall Over Under Load

- [ ] Add relay-to-browser output ACKs.
- [ ] Track per-session and total in-flight chars/bytes.
- [ ] Pause or stop reading from the PTY when in-flight exceeds high water.
- [ ] Resume when ACKs drop below low water.
- [ ] Batch PTY output before websocket send.
- [ ] Send output in bounded chunks, initially 16 KB to match Orca/VS Code-class
  behavior.
- [ ] Add active terminal hints from the client.
- [ ] Prioritize active terminal output over background terminal output.
- [ ] Add a renderer-side write scheduler around `term.write()`.
- [ ] Add hidden/background backlog cap with a terminal-visible warning.
- [ ] Add terminal stress tests for continuous output, many panes, hidden panes,
  and typing during output.

### P0: Preserve Correct Session Lifecycle

- [ ] Validate shell, cwd, cols, and rows before spawn.
- [ ] Separate session owner from websocket connection.
- [ ] Make tmux/zellij/direct PTY lifecycle policy explicit.
- [ ] Make reconnect replay deterministic and bounded.
- [ ] Flush final pending output before exit notification.
- [ ] Keep a durable session id model that works across refresh/reconnect.
- [ ] Add explicit cleanup of orphaned direct PTYs.
- [ ] Keep tmux/zellij backing sessions alive when only the bridge dies.

### P1: xterm Feature Parity

- [ ] Load SearchAddon.
- [ ] Load SerializeAddon and use it for snapshots.
- [ ] Load Unicode11Addon and activate it before writes.
- [ ] Load WebLinksAddon.
- [ ] Decide whether ligatures are a product default or a setting.
- [ ] Add clipboard/copy-as-HTML support if terminal search/copy becomes a core
  operator workflow.
- [ ] Advertise kitty keyboard protocol where compatible.
- [ ] Tune Mac Option behavior for composition.
- [ ] Add IME composition handling tests.

### P1: WebGL and Rendering Recovery

- [ ] Add WebGL `auto/on/off`.
- [ ] Disable auto WebGL on Linux Wayland.
- [ ] Disable auto WebGL on known software renderers.
- [ ] Fallback to DOM after WebGL attach failure.
- [ ] Dispose and refit on context loss.
- [ ] Add atlas clear/refresh recovery after heavy TUI redraws and image/paste
  paths.
- [ ] Refit after renderer changes because cell metrics may differ.

### P1: Input and Paste

- [ ] Cap terminal input payload size.
- [ ] Chunk input by UTF-8 byte budget.
- [ ] Yield between large input chunks.
- [ ] Add accepted-write path for control sequences that need confirmation.
- [ ] Add bracketed-paste-aware large paste flow.
- [ ] Reject oversized paste before sending to xterm or the PTY.

### P1: Visibility, Resize, and Mobile

- [ ] Send visible/hidden state from the terminal component.
- [ ] Track active vs visible separately.
- [ ] Separate `resize` from `reportGeometry`.
- [ ] Add bounded visible-resume flush.
- [ ] Add window-wake refresh path.
- [ ] Decide shared-session resize policy for multiple viewers. Terminado's
  "smallest client wins" is a good baseline if we allow concurrent viewers.
- [ ] If web terminal is exposed to iOS/mobile, add snapshot budgets and binary
  chunking instead of raw JSON scrollback replay.

### P2: Agent-Aware Terminal UX

- [ ] Parse OSC title changes in order from coalesced chunks.
- [ ] Detect BEL without letting it block renderer writes.
- [ ] Add compact side-effect queues for title/status/bell events.
- [ ] Suppress stale bells/status events during replay.
- [ ] Consider shell integration or command decorations only after the transport
  and rendering layers are stable.

### P2: Observability

- [ ] Expose debug counters for pending output, in-flight output, ACK skips,
  queued renderer chars, dropped hidden backlog, and write drain counts.
- [ ] Add dev-only terminal pressure snapshots.
- [ ] Add perf budget reports to CI or a local gate.
- [ ] Track p95 key echo during output storms.
- [ ] Track memory growth during hidden output storms.

## Acceptance Criteria

OpenScout reaches parity when:

- A foreground terminal remains responsive while at least one background PTY is
  producing sustained output.
- Hidden terminal output cannot grow renderer memory without bound.
- Reconnecting a web terminal restores the useful screen/scrollback within a
  bounded budget.
- A PTY cannot outrun the browser indefinitely; producer pressure is visible as
  pause/resume or bounded dropping, not heap growth.
- Resize does not produce stale full-screen TUI corruption after a hidden pane
  becomes visible.
- WebGL failure or context loss never leaves a blank terminal.
- Large paste/input cannot freeze the app or split UTF-8 characters.
- Terminal perf tests cover typing latency, foreground redraw, hidden TUI
  restore, output scheduler behavior, and multi-terminal scale.

## Native App A/B Test

The practical trial is inside `Scout.app`, not browser vs native app.

- Build the native app with terminal support through
  `cd apps/macos && bun bin/scout-app.ts dev`.
- Open the native Terminals section.
- Use the renderer switch in the header:
  - `Native`: Termini/Hudson/Ghostty local PTY tiles.
  - `xterm`: the same native app surface hosting the xterm.js terminal cockpit
    in `WKWebView`.
- Keep the workload identical across both renderers:
  - one local shell idle and typing latency,
  - one sustained output command such as `yes | head -n 20000`,
  - resize the window while output is active,
  - run at least four terminal tiles/sessions,
  - background and foreground the window during output.
- Record subjective feel plus measurable counters where available: cold mount
  time, key echo, resize recovery, CPU, memory, dropped or delayed output, and
  whether the active terminal stays responsive while another terminal is loud.

The comparison is not meant to pick one renderer forever. It should tell us
where the native Ghostty path is already better, and where the xterm cockpit
needs parity work before it can be trusted for agent-heavy workflows.

## Recommended Implementation Path

1. Keep the native Termini/Ghostty work as the Apple-native path.
2. Upgrade the web relay as an xterm.js cockpit instead of trying to reuse
   native Ghostty semantics inside the browser.
3. Start with transport pressure: ACKs, high/low water, batching, and active
   priority.
4. Then add renderer scheduling and hidden backlog policy.
5. Then add xterm add-ons and WebGL recovery.
6. Then add serializer snapshots and richer replay.
7. Finally add agent-aware side effects and shell integration.

The reason to start with pressure is simple: search, links, ligatures, and
pretty rendering do not matter if a busy background agent can make the active
terminal feel sticky.
