import Foundation
import ScoutCapabilities

/// Fully offline `ScoutBrokerClient` for the ScoutNext demo. Returns believable
/// fixtures for listing, replays + streams a synthetic tail firehose, and
/// echoes a canned session-initiation result. No network, no broker.
final class MockBrokerClient: ScoutBrokerClient {
    // MARK: - ListingCapability

    func listSessions(query: String?, limit: Int) async throws -> [SessionSummary] {
        let now = Date()
        let all: [SessionSummary] = [
            SessionSummary(
                id: "s.1",
                title: "Wire ScoutNext shell",
                harness: "claude",
                preview: "Stand up the HudPhoneAppShell with three surfaces and a mock client.",
                agentName: "scoutnext-builder",
                workspaceRoot: "/Users/arach/dev/openscout",
                messageCount: 42,
                status: .active,
                lastMessageAt: now.addingTimeInterval(-90)
            ),
            SessionSummary(
                id: "s.2",
                title: "Tail firehose tokens",
                harness: "codex",
                preview: "Color attribution by harness; cap rows at ~200, newest on top.",
                agentName: "tail-tuner",
                workspaceRoot: "/Users/arach/dev/hudson",
                messageCount: 17,
                status: .active,
                lastMessageAt: now.addingTimeInterval(-360)
            ),
            SessionSummary(
                id: "s.3",
                title: "Lattices OCR pass",
                harness: "claude",
                preview: "Re-run window scan and reconcile the layout deltas.",
                agentName: "lattices-scan",
                workspaceRoot: "/Users/arach/dev/lattices",
                messageCount: 8,
                status: .idle,
                lastMessageAt: now.addingTimeInterval(-3_600)
            ),
            SessionSummary(
                id: "s.4",
                title: "Broker SQLite migration",
                harness: "codex",
                preview: "Drop the in-memory snapshot; read sessions straight from SQLite.",
                agentName: "broker-smith",
                workspaceRoot: "/Users/arach/dev/openscout",
                messageCount: 64,
                status: .idle,
                lastMessageAt: now.addingTimeInterval(-7_200)
            ),
            SessionSummary(
                id: "s.5",
                title: "Release notes 0.2.71",
                harness: "claude",
                preview: "Summarize the agent work-preservation defaults for the changelog.",
                agentName: "release-scribe",
                workspaceRoot: "/Users/arach/dev/openscout",
                messageCount: 5,
                status: .closed,
                lastMessageAt: now.addingTimeInterval(-21_600)
            ),
        ]
        return filtered(all, query: query, key: { "\($0.title) \($0.preview ?? "") \($0.agentName ?? "")" }, limit: limit)
    }

    func listAgents(query: String?, limit: Int) async throws -> [AgentSummary] {
        let now = Date()
        let all: [AgentSummary] = [
            AgentSummary(
                id: "a.1",
                title: "scoutnext-builder",
                harness: "claude",
                projectName: "openscout",
                statusLabel: "building shell",
                state: .live,
                sessionId: "s.1",
                lastActiveAt: now.addingTimeInterval(-30)
            ),
            AgentSummary(
                id: "a.2",
                title: "tail-tuner",
                harness: "codex",
                projectName: "hudson",
                statusLabel: "streaming tail",
                state: .live,
                sessionId: "s.2",
                lastActiveAt: now.addingTimeInterval(-120)
            ),
            AgentSummary(
                id: "a.3",
                title: "broker-smith",
                harness: "codex",
                projectName: "openscout",
                statusLabel: "idle · 2h",
                state: .idle,
                sessionId: "s.4",
                lastActiveAt: now.addingTimeInterval(-7_200)
            ),
            AgentSummary(
                id: "a.4",
                title: "lattices-scan",
                harness: "claude",
                projectName: "lattices",
                statusLabel: "offline",
                state: .offline,
                sessionId: "s.3",
                lastActiveAt: now.addingTimeInterval(-86_400)
            ),
        ]
        return filtered(all, query: query, key: { "\($0.title) \($0.projectName ?? "") \($0.statusLabel ?? "")" }, limit: limit)
    }

    // MARK: - TailCapability

    func tailEvents(since: Int64?) -> AsyncStream<TailEvent> {
        AsyncStream { continuation in
            let task = Task {
                let seeds = Self.seedEvents()
                for event in seeds {
                    continuation.yield(event)
                }
                var counter = seeds.count
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 2_000_000_000)
                    if Task.isCancelled { break }
                    continuation.yield(Self.syntheticEvent(index: counter))
                    counter += 1
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private static func seedEvents() -> [TailEvent] {
        let base = Int64(Date().timeIntervalSince1970 * 1000)
        return (0..<8).map { i in
            syntheticEvent(index: i, tsMs: base - Int64((8 - i) * 1500))
        }
    }

    private static func syntheticEvent(index: Int, tsMs: Int64? = nil) -> TailEvent {
        let harnesses: [TailEvent.Harness] = [.scoutManaged, .hudsonManaged, .unattributed]
        let kinds: [TailEvent.Kind] = [.user, .assistant, .tool, .toolResult, .system]
        let sources = ["claude", "codex", "claude", "codex"]
        let summaries = [
            "user: review the ScoutNext shell wiring",
            "assistant: building HudPhoneAppShell with three surfaces",
            "tool: read packages/scout-native-core/Sources/ScoutCapabilities",
            "toolResult: 4 capability files resolved",
            "assistant: rendering HomeSurface sections via HudListRow",
            "user: cap the tail at 200 rows, newest on top",
            "tool: xcodebuild -scheme ScoutNext -destination 'iPhone 17'",
            "system: agent live · streaming firehose",
        ]
        return TailEvent(
            id: "t.\(index)",
            tsMs: tsMs ?? Int64(Date().timeIntervalSince1970 * 1000),
            source: sources[index % sources.count],
            harness: harnesses[index % harnesses.count],
            kind: kinds[index % kinds.count],
            summary: summaries[index % summaries.count]
        )
    }

    // MARK: - ConversationCapability

    /// An authoritative snapshot: one completed user+assistant exchange so the
    /// surface has history to render before the live stream starts.
    func snapshot(conversationId: String) async throws -> SessionState {
        let session = Session(
            id: conversationId,
            name: "Wire ScoutNext shell",
            adapterType: "claude",
            status: .active,
            cwd: "/Users/arach/dev/openscout",
            model: "claude-opus-4-8"
        )
        let userTurn = TurnState(
            id: "t.seed.user",
            status: .completed,
            blocks: [BlockState(block: Block(id: "b.seed.u0", turnId: "t.seed.user", type: .text, status: .completed, index: 0, text: "Stand up the next-gen shell with three surfaces."), status: .completed)],
            startedAt: 1_000, endedAt: 1_001, isUserTurn: true
        )
        let asstTurn = TurnState(
            id: "t.seed.asst",
            status: .completed,
            blocks: [
                BlockState(block: Block(id: "b.seed.a0", turnId: "t.seed.asst", type: .text, status: .completed, index: 0, text: "Done — `HudPhoneAppShell` with Home, New, and Tail, all driven by the shared `ScoutCapabilities` contracts through a mock adapter."), status: .completed)
            ],
            startedAt: 1_002, endedAt: 1_010, isUserTurn: false
        )
        return SessionState(session: session, turns: [userTurn, asstTurn], currentTurnId: nil)
    }

    /// A scripted live turn: user prompt → assistant reasoning → text deltas →
    /// a running command action → an action status flip → completion.
    func conversationEvents(conversationId: String, sinceSeq: Int?) -> AsyncStream<SequencedEvent> {
        AsyncStream { continuation in
            let task = Task {
                let sid = conversationId
                var seq = (sinceSeq ?? 0)
                func emit(_ event: ScoutEvent, gapMs: UInt64 = 350) async {
                    if Task.isCancelled { return }
                    seq += 1
                    continuation.yield(SequencedEvent(seq: seq, event: event))
                    try? await Task.sleep(nanoseconds: gapMs * 1_000_000)
                }

                // User turn
                let uTurn = Turn(id: "t.live.user", sessionId: sid, status: .completed, startedAt: "2000", isUserTurn: true)
                await emit(.turnStart(sessionId: sid, turn: uTurn), gapMs: 120)
                await emit(.blockStart(sessionId: sid, turnId: uTurn.id, block: Block(id: "b.u", turnId: uTurn.id, type: .text, status: .completed, index: 0, text: "Now render the conversation surface off the shared projection.")), gapMs: 120)
                await emit(.blockEnd(sessionId: sid, turnId: uTurn.id, blockId: "b.u", status: .completed), gapMs: 120)
                await emit(.turnEnd(sessionId: sid, turnId: uTurn.id, status: .completed), gapMs: 400)

                // Assistant turn
                let aTurn = Turn(id: "t.live.asst", sessionId: sid, status: .streaming, startedAt: "2100", isUserTurn: false)
                await emit(.turnStart(sessionId: sid, turn: aTurn))

                // Reasoning block
                await emit(.blockStart(sessionId: sid, turnId: aTurn.id, block: Block(id: "b.r", turnId: aTurn.id, type: .reasoning, status: .streaming, index: 0, text: "")))
                for chunk in ["Reducing events into ", "TurnState/BlockState, ", "then mapping blocks to Hudson atoms…"] {
                    await emit(.blockDelta(sessionId: sid, turnId: aTurn.id, blockId: "b.r", text: chunk))
                }
                await emit(.blockEnd(sessionId: sid, turnId: aTurn.id, blockId: "b.r", status: .completed))

                // Text block, streamed
                await emit(.blockStart(sessionId: sid, turnId: aTurn.id, block: Block(id: "b.t", turnId: aTurn.id, type: .text, status: .streaming, index: 1, text: "")))
                for chunk in ["The surface drives a ", "`ConversationProjection` ", "from the same event stream both ", "platforms reduce. ", "Watch the action below run live."] {
                    await emit(.blockDelta(sessionId: sid, turnId: aTurn.id, blockId: "b.t", text: chunk))
                }
                await emit(.blockEnd(sessionId: sid, turnId: aTurn.id, blockId: "b.t", status: .completed))

                // Action block (command), running → output → completed
                let cmd = Action(kind: .command, status: .running, output: "", command: "xcodebuild -scheme ScoutNext -destination 'iPhone 17'")
                await emit(.blockStart(sessionId: sid, turnId: aTurn.id, block: Block(id: "b.a", turnId: aTurn.id, type: .action, status: .streaming, index: 2, action: cmd)))
                for line in ["▸ Compiling ScoutCapabilities\n", "▸ Compiling ScoutNext\n", "▸ Linking ScoutNext.app\n", "** BUILD SUCCEEDED **\n"] {
                    await emit(.blockActionOutput(sessionId: sid, turnId: aTurn.id, blockId: "b.a", output: line), gapMs: 500)
                }
                await emit(.blockActionStatus(sessionId: sid, turnId: aTurn.id, blockId: "b.a", status: .completed, meta: nil))
                await emit(.blockEnd(sessionId: sid, turnId: aTurn.id, blockId: "b.a", status: .completed))

                await emit(.turnEnd(sessionId: sid, turnId: aTurn.id, status: .completed), gapMs: 200)
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: - ControlCapability

    func send(_ prompt: PromptSpec) async throws -> ControlResult {
        try? await Task.sleep(nanoseconds: 300_000_000)
        return ControlResult(ok: true, turnId: "t.user.\(prompt.text.hashValue)", messageId: "msg.demo")
    }

    func answerQuestion(_ answer: QuestionAnswerSpec) async throws -> ControlResult {
        ControlResult(ok: true, turnId: answer.turnId, messageId: "msg.answer")
    }

    func decideAction(_ decision: ActionDecisionSpec) async throws -> ControlResult {
        ControlResult(ok: true, turnId: decision.turnId, messageId: "msg.decision")
    }

    func interrupt(_ interrupt: InterruptSpec) async throws -> ControlResult {
        ControlResult(ok: true, turnId: nil, messageId: "msg.interrupt")
    }

    // MARK: - SessionInitiationCapability

    func startSession(_ spec: SessionInitiationSpec) async throws -> SessionInitiationResult {
        try? await Task.sleep(nanoseconds: 700_000_000)
        return SessionInitiationResult(
            ok: true,
            conversationId: "c.demo",
            agentId: "agent.demo",
            flightId: "flight.demo",
            messageId: "msg.demo"
        )
    }

    // MARK: - Helpers

    private func filtered<T>(_ items: [T], query: String?, key: (T) -> String, limit: Int) -> [T] {
        var result = items
        if let q = query?.trimmingCharacters(in: .whitespacesAndNewlines), !q.isEmpty {
            let needle = q.lowercased()
            result = result.filter { key($0).lowercased().contains(needle) }
        }
        if limit > 0 { result = Array(result.prefix(limit)) }
        return result
    }
}
