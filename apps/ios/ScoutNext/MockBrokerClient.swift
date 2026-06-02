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
