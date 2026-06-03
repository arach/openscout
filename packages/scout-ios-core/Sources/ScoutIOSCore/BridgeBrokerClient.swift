// BridgeBrokerClient — the iOS conformer of `ScoutBrokerClient` (SCO-061).
//
// Encrypted-transport (WebSocket + Noise + tRPC) implementation of the shared
// capability contracts. Every capability method maps to a donor tRPC method via
// `BridgeConnection.rpc(...)`; the read-stream capabilities filter the
// connection's fan-out streams.
//
// Wire ↔ contract mapping:
//   - snapshot / events / tail decode DIRECTLY into the ScoutCapabilities types
//     (SessionState / SequencedEvent / TailEvent), which are faithful ports of
//     the donor wire shapes — except tail, whose harness/kind raw values differ
//     and is mapped inside BridgeConnection (WireTailEvent).
//   - the listing RPCs return donor `Mobile*Summary` shapes, decoded into the
//     private wire structs below and mapped (best-effort) into the contract
//     `SessionSummary` / `AgentSummary`.

import Foundation
import ScoutCapabilities

public final class BridgeBrokerClient: ScoutBrokerClient, @unchecked Sendable {

    private let connection: BridgeConnection

    /// Connection log surfaced to the UI (route attempts, handshake outcomes).
    public var connectionLog: ConnectionLog { connection.connectionLog }

    /// The transport route the live connection is using.
    public var currentRoute: TransportKind { connection.currentRoute }

    public var isConnected: Bool { connection.isConnected }

    public init(connection: BridgeConnection) {
        self.connection = connection
    }

    public convenience init(connectionLog: ConnectionLogHandle, userDefaults: UserDefaults = .standard) {
        self.init(connection: BridgeConnection(connectionLog: connectionLog, userDefaults: userDefaults))
    }

    /// Establish the encrypted connection (load identity + trusted bridge,
    /// assemble + iterate relay candidates, Noise IK handshake, start streams).
    public func connect() async throws {
        try await connection.connect()
    }

    /// First-time pair to a bridge from a scanned QR payload (Noise XX handshake):
    /// learn + persist the bridge's static key, save connection info, start streams.
    public func pair(qrPayload: QRPayload, primaryName: String? = nil) async throws {
        try await connection.pair(qrPayload: qrPayload, primaryName: primaryName)
    }

    public func disconnect() {
        connection.disconnect()
    }

    // MARK: - SessionInitiationCapability

    public func startSession(_ spec: SessionInitiationSpec) async throws -> SessionInitiationResult {
        // Map the modality-flexible spec onto the donor `mobile.createSession`
        // params. The bridge's workspace identity is the project path; harness /
        // model / "fresh" come from execution; agent name from the agent block.
        let params = MobileCreateSessionParams(
            workspaceId: spec.target?.projectPath ?? spec.target?.agentId ?? "",
            harness: spec.execution?.harness,
            agentName: spec.agent?.name ?? spec.agent?.displayName,
            worktree: nil,
            profile: nil,
            branch: nil,
            model: spec.execution?.model,
            forceNew: (spec.execution?.session == .new) ? true : nil
        )
        let handle: MobileSessionHandle = try await connection.rpc("mobile/session/create", params: params)
        return SessionInitiationResult(
            ok: true,
            conversationId: handle.session.conversationId,
            agentId: handle.agent.id,
            flightId: nil,
            messageId: nil
        )
    }

    // MARK: - ListingCapability

    public func listSessions(query: String?, limit: Int) async throws -> [SessionSummary] {
        let params = MobileListParams(query: query, limit: limit)
        let wire: [MobileSessionSummary] = try await connection.rpc("mobile/sessions", params: params)
        return wire.map { $0.toSummary() }
    }

    public func listAgents(query: String?, limit: Int) async throws -> [AgentSummary] {
        let params = MobileListParams(query: query, limit: limit)
        let wire: [MobileAgentSummary] = try await connection.rpc("mobile/agents", params: params)
        return wire.map { $0.toSummary() }
    }

    // MARK: - ConversationCapability

    public func snapshot(conversationId: String) async throws -> SessionState {
        let params = MobileSessionSnapshotParams(conversationId: conversationId, beforeTurnId: nil, limit: nil)
        // Snapshot wire decodes directly into the contract type.
        return try await connection.rpc("mobile/session/snapshot", params: params)
    }

    public func conversationEvents(conversationId: String, sinceSeq: Int?) -> AsyncStream<SequencedEvent> {
        let upstream = connection.events()
        return AsyncStream { continuation in
            let task = Task {
                for await sequenced in upstream {
                    if let since = sinceSeq, sequenced.seq != 0, sequenced.seq <= since { continue }
                    guard eventBelongsToConversation(sequenced.event, conversationId: conversationId) else { continue }
                    continuation.yield(sequenced)
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: - ControlCapability

    public func send(_ prompt: PromptSpec) async throws -> ControlResult {
        // The bridge routes prompts by agentId; the conversation id is its proxy
        // here (the donor resolves agentId from its session store, which this
        // distill does not carry). Callers that need agent-id routing should pass
        // it via conversationId, matching the donor sendDirectMessage contract.
        let params = MobileSendMessageParams(
            agentId: prompt.conversationId,
            body: prompt.text,
            clientMessageId: UUID().uuidString,
            harness: nil
        )
        let result: MobileSendMessageResult = try await connection.rpc("mobile/message/send", params: params)
        return ControlResult(ok: true, turnId: nil, messageId: result.messageId)
    }

    public func answerQuestion(_ answer: QuestionAnswerSpec) async throws -> ControlResult {
        let params = QuestionAnswerParams(
            sessionId: answer.conversationId,
            blockId: answer.blockId,
            answer: answer.answer
        )
        _ = try await connection.rpc("question/answer", params: params) as EmptyResult
        return ControlResult(ok: true)
    }

    public func decideAction(_ decision: ActionDecisionSpec) async throws -> ControlResult {
        let params = ActionDecideParams(
            sessionId: decision.conversationId,
            turnId: decision.turnId,
            blockId: decision.blockId,
            version: decision.version,
            decision: decision.decision.rawValue,
            reason: nil
        )
        _ = try await connection.rpc("action/decide", params: params) as EmptyResult
        return ControlResult(ok: true)
    }

    public func interrupt(_ interrupt: InterruptSpec) async throws -> ControlResult {
        let params = SessionIdParams(sessionId: interrupt.conversationId)
        _ = try await connection.rpc("turn/interrupt", params: params) as EmptyResult
        return ControlResult(ok: true)
    }

    // MARK: - TailCapability

    public func tailEvents(since: Int64?) -> AsyncStream<TailEvent> {
        let upstream = connection.tail()
        guard let since else { return upstream }
        return AsyncStream { continuation in
            let task = Task {
                for await event in upstream where event.tsMs >= since {
                    continuation.yield(event)
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

// MARK: - Event → conversation filtering

private func eventBelongsToConversation(_ event: ScoutEvent, conversationId: String) -> Bool {
    switch event {
    case .sessionUpdate(let session): return session.id == conversationId
    case .sessionClosed(let sessionId): return sessionId == conversationId
    case .turnStart(let sessionId, _),
         .turnEnd(let sessionId, _, _),
         .turnError(let sessionId, _, _),
         .blockStart(let sessionId, _, _),
         .blockDelta(let sessionId, _, _, _),
         .blockActionOutput(let sessionId, _, _, _),
         .blockActionStatus(let sessionId, _, _, _, _),
         .blockActionApproval(let sessionId, _, _, _),
         .blockQuestionAnswer(let sessionId, _, _, _, _),
         .blockEnd(let sessionId, _, _, _):
        return sessionId == conversationId
    case .unknown:
        // Pass unknown discriminators through — the projection ignores them.
        return true
    }
}

// MARK: - tRPC param structs (ported from donor RPC.swift)

struct MobileListParams: Codable, Sendable {
    var query: String?
    var limit: Int?
}

struct MobileCreateSessionParams: Codable, Sendable {
    let workspaceId: String
    var harness: String?
    var agentName: String?
    var worktree: String?
    var profile: String?
    var branch: String?
    var model: String?
    var forceNew: Bool?
}

struct MobileSessionSnapshotParams: Codable, Sendable {
    let conversationId: String
    var beforeTurnId: String?
    var limit: Int?
}

struct MobileSendMessageParams: Codable, Sendable {
    let agentId: String
    let body: String
    var clientMessageId: String?
    var harness: String?
}

struct MobileSendMessageResult: Codable, Sendable {
    let conversationId: String
    let messageId: String
}

struct QuestionAnswerParams: Codable, Sendable {
    let sessionId: String
    let blockId: String
    let answer: [String]
}

struct ActionDecideParams: Codable, Sendable {
    let sessionId: String
    let turnId: String
    let blockId: String
    let version: Int
    let decision: String
    var reason: String?
}

struct SessionIdParams: Codable, Sendable {
    let sessionId: String
}

/// Decoded for void mutations whose result is `{}` or null.
struct EmptyResult: Codable, Sendable {}

// MARK: - Listing wire shapes → contract summaries (best-effort mapping)

/// Donor `MobileSessionSummary` (RPC.swift). Mapped into `SessionSummary`.
struct MobileSessionSummary: Codable, Sendable {
    let id: String
    let kind: String
    let title: String
    let participantIds: [String]?
    let agentId: String?
    let agentName: String?
    let harness: String?
    let currentBranch: String?
    let preview: String?
    let messageCount: Int?
    let lastMessageAt: Int?
    let workspaceRoot: String?

    func toSummary() -> SessionSummary {
        SessionSummary(
            id: id,
            title: title,
            harness: harness,
            preview: preview,
            agentName: agentName,
            workspaceRoot: workspaceRoot,
            messageCount: messageCount,
            status: .unknown,                 // donor summary carries no live status field
            lastMessageAt: lastMessageAt.map { Date(timeIntervalSince1970: Double(scoutEpochMilliseconds($0)) / 1000.0) }
        )
    }
}

/// Donor `MobileAgentSummary` (RPC.swift). Mapped into `AgentSummary`.
struct MobileAgentSummary: Codable, Sendable {
    let id: String
    let title: String
    let selector: String?
    let defaultSelector: String?
    let nodeId: String?
    let nodeName: String?
    let workspaceRoot: String?
    let harness: String?
    let transport: String?
    let state: String
    let statusLabel: String?
    let sessionId: String?
    let lastActiveAt: Int?

    func toSummary() -> AgentSummary {
        let mappedState: AgentSummary.State
        switch state.lowercased() {
        case "live", "active", "online": mappedState = .live
        case "idle": mappedState = .idle
        case "offline": mappedState = .offline
        default: mappedState = .unknown
        }
        let projectName = workspaceRoot?.trimmedNonEmpty.map { URL(fileURLWithPath: $0).lastPathComponent }
        return AgentSummary(
            id: id,
            title: title,
            harness: harness,
            projectName: projectName,
            statusLabel: statusLabel,
            state: mappedState,
            sessionId: sessionId,
            lastActiveAt: lastActiveAt.map { Date(timeIntervalSince1970: Double(scoutEpochMilliseconds($0)) / 1000.0) }
        )
    }
}

// MARK: - Session-create handle (donor MobileSessionHandle subset)

struct MobileSessionHandleConversation: Codable, Sendable {
    let conversationId: String
    let title: String
    let existed: Bool
}

struct MobileSessionHandleAgent: Codable, Sendable {
    let id: String
    let title: String
}

struct MobileSessionHandle: Codable, Sendable {
    let agent: MobileSessionHandleAgent
    let session: MobileSessionHandleConversation
}
