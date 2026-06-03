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

    /// A fixed, static batch of recent activity — no continuous emission. A
    /// real adapter keeps the stream open and pushes live events.
    func tailEvents(since: Int64?) -> AsyncStream<TailEvent> {
        AsyncStream { continuation in
            for event in Self.seedEvents() { continuation.yield(event) }
            continuation.finish()
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

    /// A complete, already-settled conversation. Everything is rendered from
    /// this single snapshot — no scripted playback — so the surface is static
    /// and calm. (When a real `BridgeBrokerClient` lands, the snapshot recovers
    /// history and `conversationEvents` carries genuinely-live deltas.)
    func snapshot(conversationId: String) async throws -> SessionState {
        let session = Session(
            id: conversationId,
            name: "Wire ScoutNext shell",
            adapterType: "claude",
            status: .idle,
            cwd: "/Users/arach/dev/openscout",
            model: "claude-opus-4-8"
        )

        func userText(_ id: String, _ text: String, at: Int) -> TurnState {
            TurnState(id: id, status: .completed,
                      blocks: [BlockState(block: Block(id: "\(id).0", turnId: id, type: .text, status: .completed, index: 0, text: text), status: .completed)],
                      startedAt: at, endedAt: at + 1, isUserTurn: true)
        }

        let t1 = userText("t1", "Stand up the next-gen shell with three surfaces.", at: 1_000)
        let t2 = TurnState(id: "t2", status: .completed, blocks: [
            BlockState(block: Block(id: "t2.0", turnId: "t2", type: .text, status: .completed, index: 0, text: "Done — `HudPhoneAppShell` with Home, New, and Tail, all driven by the shared `ScoutCapabilities` contracts through a mock adapter."), status: .completed)
        ], startedAt: 1_002, endedAt: 1_010, isUserTurn: false)

        let t3 = userText("t3", "Now render the conversation surface off the shared projection.", at: 2_000)
        let t4 = TurnState(id: "t4", status: .completed, blocks: [
            BlockState(block: Block(id: "t4.0", turnId: "t4", type: .reasoning, status: .completed, index: 0, text: "Reducing events into TurnState/BlockState, then mapping blocks to Hudson atoms."), status: .completed),
            BlockState(block: Block(id: "t4.1", turnId: "t4", type: .text, status: .completed, index: 1, text: "The surface drives a `ConversationProjection` from the same event stream both platforms reduce."), status: .completed),
            BlockState(block: Block(id: "t4.2", turnId: "t4", type: .action, status: .completed, index: 2, action: Action(
                kind: .command, status: .completed,
                output: "▸ Compiling ScoutCapabilities\n▸ Compiling ScoutNext\n▸ Linking ScoutNext.app\n** BUILD SUCCEEDED **",
                command: "xcodebuild -scheme ScoutNext -destination 'iPhone 17'")), status: .completed)
        ], startedAt: 2_002, endedAt: 2_020, isUserTurn: false)

        return SessionState(session: session, turns: [t1, t2, t3, t4], currentTurnId: nil)
    }

    /// No synthetic playback. A real adapter streams live deltas here; the mock
    /// has nothing live to add, so it finishes immediately.
    func conversationEvents(conversationId: String, sinceSeq: Int?) -> AsyncStream<SequencedEvent> {
        AsyncStream { continuation in continuation.finish() }
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
