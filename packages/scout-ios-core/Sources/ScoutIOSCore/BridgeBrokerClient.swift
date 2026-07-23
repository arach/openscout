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

public final class BridgeBrokerClient: ScoutBrokerClient, TerminalAccessProviding, TerminalStatusProviding, @unchecked Sendable {

    private let connection: BridgeConnection

    /// Connection log surfaced to the UI (route attempts, handshake outcomes).
    public var connectionLog: ConnectionLog { connection.connectionLog }

    /// The transport route the live connection is using.
    public var currentRoute: TransportKind { connection.currentRoute }

    /// The host we're connected through — the Mac's own advertised name.
    public var currentHost: String? { connection.currentHost }

    /// Direct paired-host coordinates for web-backed mission-control surfaces.
    public var webAccessHost: String? { connection.webAccessHost }
    public var webAccessPort: Int? { connection.webAccessPort }

    /// Stored route inventory for the active trusted bridge, filtered by current
    /// route preferences. This is a settings/status summary, not a reachability probe.
    public var savedRouteSummary: BridgeRouteSummary { connection.savedRouteSummary() }

    public var isConnected: Bool { connection.isConnected }

    /// Public-key hex this client is pinned to, if any.
    public var targetPublicKeyHex: String? { connection.targetPublicKeyHex }

    /// Public-key hex of the bridge backing this client's current connection.
    public var currentPublicKeyHex: String? { connection.currentPublicKeyHex }

    public init(connection: BridgeConnection) {
        self.connection = connection
    }

    @MainActor
    public convenience init(
        connectionLog: ConnectionLogHandle,
        userDefaults: UserDefaults = .standard,
        preferredPublicKeyHex: String? = nil
    ) {
        let target = preferredPublicKeyHex.map { BridgeConnectionTarget(publicKeyHex: $0) }
        self.init(connection: BridgeConnection(
            target: target,
            connectionLog: connectionLog,
            requestLog: BrokerRequestLogHandle(.shared),
            userDefaults: userDefaults
        ))
    }

    /// Select the legacy single-link active bridge. This is UI preference only;
    /// pinned connections do not read or mutate it during reconnect.
    public static func setActiveConnectionPublicKeyHex(
        _ publicKeyHex: String?,
        userDefaults: UserDefaults = .standard
    ) {
        BridgeConnectionInfo.setActivePublicKeyHex(publicKeyHex, userDefaults: userDefaults)
    }

    public static func activeConnectionPublicKeyHex(userDefaults: UserDefaults = .standard) -> String? {
        BridgeConnectionInfo.activePublicKeyHex(userDefaults: userDefaults)
    }

    public static func removeSavedConnectionInfo(
        publicKeyHex: String,
        userDefaults: UserDefaults = .standard
    ) {
        BridgeConnectionInfo.remove(publicKeyHex: publicKeyHex, userDefaults: userDefaults)
    }

    public static func savePairingConnectionInfo(
        qrPayload: QRPayload,
        promoteActive: Bool,
        userDefaults: UserDefaults = .standard
    ) {
        let info = BridgeConnectionInfo(
            relayURL: qrPayload.relay,
            roomId: qrPayload.room,
            publicKeyHex: qrPayload.publicKey,
            fallbackRelayURLs: qrPayload.fallbackRelays ?? [],
            webPort: qrPayload.webPort
        )
        info.save(userDefaults: userDefaults, promoteActive: promoteActive)
    }

    public func setUnexpectedDisconnectHandler(_ handler: BridgeConnectionDisconnectHandler?) {
        connection.setUnexpectedDisconnectHandler(handler)
    }

    public func setMachineIdentityUpdatedHandler(_ handler: ((String) -> Void)?) {
        connection.setMachineIdentityUpdatedHandler(handler)
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
            agentName: spec.agent?.handle ?? spec.agent?.displayName,
            worktree: nil,
            profile: nil,
            branch: nil,
            model: spec.execution?.model,
            forceNew: (spec.execution?.session == .new) ? true : nil,
            seed: spec.seed
        )
        let handle: MobileSessionHandle = try await connection.rpc("mobile/session/create", params: params)
        return SessionInitiationResult(
            ok: true,
            conversationId: handle.session.conversationId,
            agentId: handle.agent.id,
            flightId: handle.flightId,
            messageId: handle.messageId
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

    public func listWorkspaces(query: String?, limit: Int) async throws -> [WorkspaceSummary] {
        let params = MobileListParams(query: query, limit: limit)
        let wire: [MobileWorkspaceSummary] = try await connection.rpc("mobile/workspaces", params: params)
        return wire.map { $0.toSummary() }
    }

    /// Operator usage-quota gauges (Claude / Codex / Kimi / GitHub) with their spent
    /// windows, for the Home strip. Empty when the paired Mac can't report them
    /// (older bridge without the `mobile/service-budgets` procedure).
    public func serviceBudgets() async throws -> [ServiceBudget] {
        // Param-less query (the procedure's input is optional) — pass nil, the
        // same shape as `mobile/endpoints` / `mobile/mesh/status`.
        let result: MobileServiceBudgetsResult = try await connection.rpc("mobile/service-budgets", params: nil)
        return result.budgets
    }

    /// Recent terminal (harness) sessions from the registry — cwd, resume command,
    /// harness, and whether a surface is live — for the Home Terminals shelf.
    /// Empty when the paired Mac has no registry / an older bridge.
    public func terminalSessions() async throws -> [MobileTerminal] {
        let result: MobileTerminalsResult = try await connection.rpc("mobile/terminal-sessions", params: nil)
        return result.terminals
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

    public func conversationRefreshes(conversationId: String) -> AsyncStream<Void> {
        let upstream = connection.mobileConversationChanges()
        return AsyncStream { continuation in
            let task = Task {
                for await change in upstream {
                    guard change.conversationId == conversationId,
                          change.event != "mobile:conversation:lifecycle"
                    else { continue }
                    continuation.yield(())
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    public func conversationLifecycleUpdates(conversationId: String) -> AsyncStream<ConversationLifecycleUpdate> {
        let upstream = connection.mobileConversationChanges()
        return AsyncStream { continuation in
            let task = Task {
                for await change in upstream {
                    guard change.conversationId == conversationId,
                          let update = conversationLifecycleUpdate(from: change)
                    else { continue }
                    continuation.yield(update)
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // MARK: - ControlCapability

    public func send(_ prompt: PromptSpec) async throws -> ControlResult {
        let params = mobilePromptSendParams(prompt)
        let result: MobileCommsSendResult = try await connection.rpc("mobile/comms/send", params: params)
        return ControlResult(
            ok: true,
            turnId: nil,
            messageId: result.messageId,
            flightId: result.flightId,
            invocationId: result.invocationId,
            targetAgentId: result.targetAgentId,
            lifecycleState: result.lifecycleState.flatMap(ConversationLifecycleState.init(rawValue:)),
            summary: result.summary
        )
    }

    public func uploadAttachment(_ attachment: AttachmentUpload) async throws -> MessageAttachment {
        let params = MobileAttachmentUploadParams(
            data: attachment.data.base64EncodedString(),
            mediaType: attachment.mediaType,
            fileName: attachment.fileName
        )
        let result: MobileAttachmentUploadResult = try await connection.rpc("mobile/attachments/upload", params: params)
        return MessageAttachment(
            id: result.id,
            mediaType: result.mediaType,
            fileName: result.fileName,
            url: result.url
        )
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

    /// Recent activity from the broker's *curated* home feed (via the
    /// `mobile/activity` procedure → `readScoutBrokerHome().activity`): one row per
    /// message, name-resolved, always thread-linked. This is the orientation feed
    /// Home renders; the raw lifecycle firehose stays on the Tail tab.
    public func recentActivity(limit: Int) async throws -> [TailEvent] {
        let params = MobileActivityParams(limit: limit)
        do {
            let wire: [MobileActivityItem] = try await connection.rpc("mobile/activity", params: params)
            return wire.map { $0.toTailEvent() }
        } catch {
            // Compatibility with paired Macs still running the older activity
            // projection. That route returned the raw Tail wire shape, which we
            // deliberately refuse to put back on Home. Reconstruct a small recent
            // exchange window through the already-supported Comms endpoints until
            // the Mac restarts onto the broker-ledger implementation.
            return try await recentCommsActivityFallback(limit: limit)
        }
    }

    private func recentCommsActivityFallback(limit: Int) async throws -> [TailEvent] {
        let boundedLimit = max(1, limit)
        let conversationLimit = min(12, boundedLimit)
        let messagesPerConversation = max(1, Int(ceil(Double(boundedLimit) / Double(conversationLimit))))
        let conversations = try await listConversations(kind: nil, limit: conversationLimit)
        var events: [TailEvent] = []

        for conversation in conversations {
            guard let messages = try? await conversationMessages(
                conversationId: conversation.id,
                limit: messagesPerConversation
            ) else { continue }
            events.append(contentsOf: messages.map { message in
                let kind: TailEvent.Kind
                if message.isOperator {
                    kind = .user
                } else if message.authorKind == .system {
                    kind = .system
                } else {
                    kind = .assistant
                }
                return TailEvent(
                    id: message.id,
                    tsMs: Int64(message.createdAt.timeIntervalSince1970 * 1_000),
                    source: message.authorLabel,
                    harness: .unattributed,
                    kind: kind,
                    summary: message.body.trimmingCharacters(in: .whitespacesAndNewlines),
                    conversationId: message.conversationId
                )
            })
        }

        return Array(events.sorted { $0.tsMs > $1.tsMs }.prefix(boundedLimit))
    }

    /// Recent harness-firehose snapshot for the Tail surface, polled while the
    /// view is open. Served by the resilient `mobile/tail` query — a fresh broker
    /// read per call — so it survives broker restarts (no stale singleton push)
    /// and never streams the firehose across cellular when the view is closed.
    public func recentTail(limit: Int) async throws -> [TailEvent] {
        let params = MobileTailParams(limit: limit)
        let wire: [MobileTailEvent] = try await connection.rpc("mobile/tail", params: params)
        return wire.map { $0.toTailEvent() }
    }

    // MARK: - CommsCapability

    public func listConversations(kind: CommsConversation.Kind?, limit: Int) async throws -> [CommsConversation] {
        let params = MobileCommsListParams(kind: kind?.rawValue, limit: limit)
        let wire: [MobileCommsConversation] = try await connection.rpc("mobile/comms/conversations", params: params)
        return wire.map { $0.toConversation() }
    }

    public func conversationMessages(conversationId: String, limit: Int) async throws -> [CommsMessage] {
        let params = MobileCommsMessagesParams(conversationId: conversationId, limit: limit)
        let wire: [MobileCommsMessage] = try await connection.rpc("mobile/comms/messages", params: params)
        return wire.map { $0.toMessage() }
    }

    @discardableResult
    public func postMessage(conversationId: String, body: String, replyTo: String?, attachments: [MessageAttachment]?, clientMessageId: String?) async throws -> String {
        let params = MobileCommsSendParams(
            conversationId: conversationId,
            body: body,
            attachments: attachments,
            replyToMessageId: replyTo,
            clientMessageId: clientMessageId ?? UUID().uuidString
        )
        let result: MobileCommsSendResult = try await connection.rpc("mobile/comms/send", params: params)
        return result.messageId
    }

    @discardableResult
    public func markConversationRead(conversationId: String) async throws -> Int {
        let params = MobileCommsMarkReadParams(conversationId: conversationId, lastReadMessageId: nil)
        let result: MobileCommsMarkReadResult = try await connection.rpc("mobile/comms/read", params: params)
        return result.unreadCount ?? 0
    }

    // MARK: - TerminalAccessProviding

    public func provisionTerminalAccess(sshPublicKey: String) async throws -> TerminalAccess {
        let params = MobileTerminalProvisionParams(sshPublicKey: sshPublicKey)
        let wire: MobileTerminalProvisionResult = try await connection.rpc(
            "mobile/terminal/provision", params: params
        )
        return TerminalAccess(
            host: wire.host,
            port: wire.port,
            username: wire.username,
            hostKeyFingerprint: wire.hostKeyFingerprint
        )
    }

    public func terminalHostStatus() async throws -> TerminalHostStatus {
        let wire: MobileTerminalStatusResult = try await connection.rpc(
            "mobile/terminal/status", params: nil
        )
        return TerminalHostStatus(
            shellExecutable: wire.shellExecutable,
            wrapperKind: wire.wrapperKind,
            wrapperInstalled: wire.wrapperInstalled,
            sessionName: wire.sessionName,
            sessionExists: wire.sessionExists,
            attachedClients: wire.attachedClients,
            paneColumns: wire.paneColumns,
            paneRows: wire.paneRows,
            paneCommand: wire.paneCommand
        )
    }

    public func mobileMeshStatus() async throws -> MobileMeshStatusResponse {
        try await connection.rpc("mobile/mesh/status", params: nil)
    }

    // MARK: - MobilePushRegistrationCapability

    public func syncMobilePushRegistration(
        _ registration: MobilePushRegistration
    ) async throws -> MobilePushRegistrationResult {
        try await connection.rpc("mobile/push/sync", params: registration)
    }
}

func mobilePromptSendParams(_ prompt: PromptSpec, clientMessageId: String? = nil) -> MobileCommsSendParams {
    MobileCommsSendParams(
        conversationId: prompt.conversationId,
        body: prompt.text,
        attachments: prompt.attachments,
        replyToMessageId: nil,
        clientMessageId: prompt.clientMessageId ?? clientMessageId ?? UUID().uuidString
    )
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

private func conversationLifecycleUpdate(from change: MobileConversationChangeEvent) -> ConversationLifecycleUpdate? {
    guard change.event == "mobile:conversation:lifecycle",
          let rawState = change.lifecycleState,
          let state = ConversationLifecycleState(rawValue: rawState)
    else { return nil }

    return ConversationLifecycleUpdate(
        conversationId: change.conversationId,
        messageId: change.messageId,
        clientMessageId: change.clientMessageId,
        invocationId: change.invocationId,
        flightId: change.flightId,
        targetAgentId: change.targetAgentId,
        state: state,
        summary: change.summary,
        error: change.error
    )
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
    var seed: SessionInitiationSpec.Seed?
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
    let flightId: String?
    let invocationId: String?
    let targetAgentId: String?
    let lifecycleState: String?
    let summary: String?
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

struct MobileTerminalProvisionParams: Codable, Sendable {
    let sshPublicKey: String
}

struct MobileTerminalProvisionResult: Codable, Sendable {
    let host: String
    let port: Int
    let username: String
    let hostKeyFingerprint: String?
}

struct MobileTerminalStatusResult: Codable, Sendable {
    let shellExecutable: String
    let wrapperKind: String
    let wrapperInstalled: Bool
    let sessionName: String
    let sessionExists: Bool
    let attachedClients: Int
    let paneColumns: Int?
    let paneRows: Int?
    let paneCommand: String?
}

public struct MobileMeshStatusResponse: Codable, Sendable {
    public let tailscale: MobileMeshTailscale?
}

public struct MobileMeshTailscale: Codable, Sendable {
    public let peers: [MobileMeshTailnetPeer]
}

public struct MobileMeshTailnetPeer: Codable, Sendable {
    public let id: String
    public let name: String
    public let dnsName: String?
    public let hostName: String?
    public let addresses: [String]
    public let online: Bool
    public let os: String?
}

// MARK: - Listing wire shapes → contract summaries (best-effort mapping)

/// Input for `mobile.activity`. Only `limit` is sent from the phone — the other
/// server-side filters (agent/actor/conversation) stay unset for the fleet feed.
struct MobileActivityParams: Codable, Sendable {
    let limit: Int
}

/// Donor `ScoutBrokerHomeActivityRecord` (broker/service.ts), served via
/// `mobile/activity`. This is the broker's *curated* home feed — already deduped
/// to one row per message, name-resolved, and always thread-linked — so the phone
/// maps it straight onto a `TailEvent` with no substring guessing. The raw
/// `/v1/activity` lifecycle firehose lives on the Tail tab, not here.
struct MobileActivityItem: Codable, Sendable {
    let id: String
    let kind: String            // "message" | "system"
    let actorId: String
    let actorName: String
    let title: String
    let detail: String?
    let conversationId: String?
    let channel: String?
    let timestamp: Int

    func toTailEvent() -> TailEvent {
        TailEvent(
            id: id,
            tsMs: Int64(scoutEpochMilliseconds(timestamp)),
            source: actorName,
            harness: .unattributed,         // curated activity carries no harness attribution
            kind: mappedKind,
            summary: detail?.trimmedNonEmpty ?? title,
            conversationId: conversationId?.trimmedNonEmpty
        )
    }

    /// The curated feed gives an exact role, so there's no guessing: the operator's
    /// own posts read as `.user`, an agent's as `.assistant`, broker notices as
    /// `.system`. (This drives the row's dot color.)
    private var mappedKind: TailEvent.Kind {
        if kind == "system" { return .system }
        return actorId == "operator" ? .user : .assistant
    }
}

struct MobileTailParams: Codable, Sendable {
    let limit: Int
}

/// Compact harness tail event from the `mobile/tail` snapshot (broker `TailEvent`
/// minus the heavy `raw` payload). Harness/kind decode leniently — an unknown
/// value maps to `.unattributed` / `.other` rather than failing the whole batch,
/// so one new harness or event kind never blanks the Tail surface.
struct MobileTailEvent: Codable, Sendable {
    let id: String
    let ts: Int
    let source: String
    let sessionId: String
    let pid: Int
    let parentPid: Int?
    let project: String
    let cwd: String
    let harness: String
    let kind: String
    let summary: String

    func toTailEvent() -> TailEvent {
        let mappedHarness: TailEvent.Harness
        switch harness {
        case "scout-managed": mappedHarness = .scoutManaged
        case "hudson-managed": mappedHarness = .hudsonManaged
        default: mappedHarness = .unattributed
        }
        let mappedKind: TailEvent.Kind
        switch kind {
        case "user": mappedKind = .user
        case "assistant": mappedKind = .assistant
        case "tool": mappedKind = .tool
        case "tool-result": mappedKind = .toolResult
        case "system": mappedKind = .system
        default: mappedKind = .other
        }
        return TailEvent(
            id: id,
            tsMs: Int64(scoutEpochMilliseconds(ts)),
            source: source,
            harness: mappedHarness,
            kind: mappedKind,
            summary: summary,
            conversationId: sessionId.trimmedNonEmpty,
            project: project.trimmedNonEmpty,
            cwd: cwd.trimmedNonEmpty
        )
    }
}

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

/// Structured pending-ask, decoded from the wire when the broker sends an object
/// under `pendingAsk`. Every field is optional so a partial object never fails
/// the batch. TODAY the server emits a FLAT string for `pendingAsk` (see
/// `MobileAgentSummary` below); this shape is forward scaffolding for when the
/// broker is taught to carry the structured ask.
struct MobileAgentPendingAsk: Codable, Sendable {
    let kind: String?
    let prompt: String?
    let options: [String]?
}

/// Donor `MobileAgentSummary` (RPC.swift). Mapped into `AgentSummary`.
///
/// Attention groundwork (ADDITIVE / OPTIONAL): `needsAttention` and `pendingAsk`
/// are decoded IF PRESENT. The paired Mac does NOT emit them yet — the server's
/// `ScoutMobileAgentSummary` (packages/web/server/core/mobile/service.ts:71) has
/// no attention overlay, and the attention index (agent-attention.ts) is applied
/// only to the WEB `/api/agents` shape, not the mobile projection. So these keys
/// are defensive: they light up the moment the broker mirrors attention onto
/// `mobile/agents` (see the FINAL REPORT for the exact server change). Tolerant
/// keys mean older/partial payloads decode cleanly to no-attention.
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
    let conversationId: String?
    let lastActiveAt: Int?
    /// Explicit attention flag, if the broker sends one. When absent, attention is
    /// inferred from a `state == "needs_attention"` (matching the web shape) or a
    /// non-empty `pendingAsk`.
    let needsAttention: Bool?
    /// Flat ask line. The server's attention index (agent-attention.ts:116) sets
    /// `pendingAsk: string | null` today, so decode a bare string first.
    let pendingAsk: String?
    /// Structured ask, decoded when a future broker sends an object instead of a
    /// bare string under a distinct key. Kept separate so both wire shapes coexist.
    let pendingAskDetail: MobileAgentPendingAsk?

    enum CodingKeys: String, CodingKey {
        case id, title, selector, defaultSelector, nodeId, nodeName
        case workspaceRoot, harness, transport, state, statusLabel
        case sessionId, conversationId, lastActiveAt
        case needsAttention
        case pendingAsk
        case pendingAskDetail
    }

    /// Custom decode so `pendingAsk` tolerates EITHER a bare string (today's wire)
    /// or an object (future structured wire), and every attention key is optional.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        selector = try c.decodeIfPresent(String.self, forKey: .selector)
        defaultSelector = try c.decodeIfPresent(String.self, forKey: .defaultSelector)
        nodeId = try c.decodeIfPresent(String.self, forKey: .nodeId)
        nodeName = try c.decodeIfPresent(String.self, forKey: .nodeName)
        workspaceRoot = try c.decodeIfPresent(String.self, forKey: .workspaceRoot)
        harness = try c.decodeIfPresent(String.self, forKey: .harness)
        transport = try c.decodeIfPresent(String.self, forKey: .transport)
        state = try c.decode(String.self, forKey: .state)
        statusLabel = try c.decodeIfPresent(String.self, forKey: .statusLabel)
        sessionId = try c.decodeIfPresent(String.self, forKey: .sessionId)
        conversationId = try c.decodeIfPresent(String.self, forKey: .conversationId)
        lastActiveAt = try c.decodeIfPresent(Int.self, forKey: .lastActiveAt)
        needsAttention = try c.decodeIfPresent(Bool.self, forKey: .needsAttention)

        // `pendingAsk` may be a string (today), an object (future), or absent.
        var flatAsk: String? = nil
        var structuredAsk: MobileAgentPendingAsk? = nil
        if let s = try? c.decodeIfPresent(String.self, forKey: .pendingAsk) {
            flatAsk = s
        } else if let obj = try? c.decodeIfPresent(MobileAgentPendingAsk.self, forKey: .pendingAsk) {
            structuredAsk = obj
        }
        pendingAsk = flatAsk
        // A dedicated structured key wins over one squeezed into `pendingAsk`.
        pendingAskDetail = (try? c.decodeIfPresent(MobileAgentPendingAsk.self, forKey: .pendingAskDetail)) ?? structuredAsk
    }

    func toSummary() -> AgentSummary {
        // The broker's mobile agent vocab is offline | available | working
        // (broker-daemon.ts). Older aliases kept as a safety net. The web shape
        // additionally uses "needs_attention" as a state — accept it here so a
        // future mobile mirror of that shape maps cleanly.
        let mappedState: AgentSummary.State
        switch state.lowercased() {
        case "working", "live", "active", "online": mappedState = .live
        case "available", "idle", "waiting": mappedState = .idle
        case "offline": mappedState = .offline
        default: mappedState = .unknown
        }
        let projectName = workspaceRoot?.trimmedNonEmpty.map { URL(fileURLWithPath: $0).lastPathComponent }

        // Resolve the structured ask from whichever wire shape arrived.
        let resolvedAsk = resolvedPendingAsk()
        // Attention is: an explicit flag, OR the web-parity "needs_attention"
        // state, OR the mere presence of an ask.
        let attention = (needsAttention ?? false)
            || state.lowercased() == "needs_attention"
            || resolvedAsk != nil

        return AgentSummary(
            id: id,
            title: title,
            harness: harness,
            projectName: projectName,
            statusLabel: statusLabel,
            state: mappedState,
            sessionId: sessionId,
            conversationId: conversationId,
            lastActiveAt: lastActiveAt.map { Date(timeIntervalSince1970: Double(scoutEpochMilliseconds($0)) / 1000.0) },
            needsAttention: attention,
            pendingAsk: resolvedAsk
        )
    }

    /// Fold the flat + structured wire shapes into the contract `PendingAsk`.
    /// Returns nil when there's no usable ask text.
    private func resolvedPendingAsk() -> PendingAsk? {
        if let detail = pendingAskDetail {
            let prompt = detail.prompt?.trimmedNonEmpty ?? pendingAsk?.trimmedNonEmpty
            guard let prompt else { return nil }
            let kind = detail.kind.flatMap { PendingAsk.Kind(rawValue: $0) } ?? .question
            return PendingAsk(kind: kind, prompt: prompt, options: detail.options ?? [])
        }
        if let flat = pendingAsk?.trimmedNonEmpty {
            // No kind on the flat wire — default to `.question`. The band can
            // still render the ask; refine once the broker sends a kind.
            return PendingAsk(kind: .question, prompt: flat)
        }
        return nil
    }
}

struct MobileWorkspaceSummary: Codable, Sendable {
    let id: String
    let title: String?
    let projectName: String?
    let root: String?
    let defaultHarness: String?
    let harnesses: [WireHarness]?

    struct WireHarness: Codable, Sendable {
        let harness: String
        let source: String?
        let detail: String?
        let readinessState: String?
        let readinessDetail: String?
    }

    func toSummary() -> WorkspaceSummary {
        let resolvedRoot = root?.trimmedNonEmpty ?? ""
        let leaf = resolvedRoot.isEmpty ? id : URL(fileURLWithPath: resolvedRoot).lastPathComponent
        return WorkspaceSummary(
            id: id,
            title: title?.trimmedNonEmpty ?? projectName?.trimmedNonEmpty ?? leaf,
            projectName: projectName?.trimmedNonEmpty ?? leaf,
            root: resolvedRoot,
            defaultHarness: defaultHarness?.trimmedNonEmpty,
            harnesses: (harnesses ?? []).map { wire in
                WorkspaceSummary.Harness(
                    harness: wire.harness,
                    readiness: WorkspaceSummary.Harness.Readiness(rawValue: wire.readinessState ?? "") ?? .unknown,
                    detail: wire.readinessDetail?.trimmedNonEmpty ?? wire.detail?.trimmedNonEmpty
                )
            }
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
    let messageId: String?
    let flightId: String?
}

// MARK: - Comms params + wire shapes → contract types

struct MobileCommsListParams: Codable, Sendable {
    var kind: String?
    var limit: Int?
}

struct MobileCommsMessagesParams: Codable, Sendable {
    let conversationId: String
    var limit: Int?
}

struct MobileCommsSendParams: Codable, Sendable {
    let conversationId: String
    let body: String
    var attachments: [MessageAttachment]?
    var replyToMessageId: String?
    var clientMessageId: String?
}

struct MobileCommsSendResult: Codable, Sendable {
    let conversationId: String
    let messageId: String
    let flightId: String?
    let invocationId: String?
    let targetAgentId: String?
    let lifecycleState: String?
    let summary: String?
}

struct MobileAttachmentUploadParams: Codable, Sendable {
    let data: String
    let mediaType: String
    let fileName: String?
}

struct MobileAttachmentUploadResult: Codable, Sendable {
    let id: String
    let url: String
    let mediaType: String
    let fileName: String?
    let size: Int?
    let expiresAt: Int?
}

struct MobileCommsMarkReadParams: Codable, Sendable {
    let conversationId: String
    var lastReadMessageId: String?
}

struct MobileCommsMarkReadResult: Codable, Sendable {
    let conversationId: String
    let unreadCount: Int?
}

/// Donor `mobile/comms/conversations` row. Flattened by the broker (participants
/// + last-author already resolved to display labels). Mapped into the contract.
struct MobileCommsConversation: Codable, Sendable {
    let id: String
    let kind: String
    let title: String
    let participants: [String]?
    let topic: String?
    let lastMessagePreview: String?
    let lastMessageAuthor: String?
    let lastMessageAt: Int?
    let messageCount: Int?
    let unreadCount: Int?

    func toConversation() -> CommsConversation {
        CommsConversation(
            id: id,
            kind: CommsConversation.Kind(rawValue: kind) ?? .unknown,
            title: title,
            participants: participants ?? [],
            topic: topic,
            lastMessagePreview: lastMessagePreview,
            lastMessageAuthor: lastMessageAuthor,
            lastMessageAt: lastMessageAt.map { Date(timeIntervalSince1970: Double(scoutEpochMilliseconds($0)) / 1000.0) },
            messageCount: messageCount ?? 0,
            unreadCount: unreadCount ?? 0
        )
    }
}

/// Donor `mobile/comms/messages` row. Mapped into the contract `CommsMessage`.
struct MobileCommsMessage: Codable, Sendable {
    let id: String
    let conversationId: String
    let actorId: String
    let authorLabel: String
    let authorKind: String
    let body: String
    let createdAt: Int
    let replyToMessageId: String?
    let isOperator: Bool?
    let attachments: [MessageAttachment]?
    let clientMessageId: String?

    func toMessage() -> CommsMessage {
        CommsMessage(
            id: id,
            conversationId: conversationId,
            actorId: actorId,
            authorLabel: authorLabel,
            authorKind: CommsMessage.AuthorKind(rawValue: authorKind) ?? .unknown,
            body: body,
            createdAt: Date(timeIntervalSince1970: Double(scoutEpochMilliseconds(createdAt)) / 1000.0),
            replyToMessageId: replyToMessageId,
            isOperator: isOperator ?? (actorId == "operator"),
            attachments: attachments ?? [],
            clientMessageId: clientMessageId
        )
    }
}

// MARK: - Service budgets (usage quota)

/// A subscription's usage quota for the Home strip — one provider (Claude /
/// Codex / Kimi / GitHub) with its spent windows (e.g. a short 5h cap + a weekly cap).
public struct ServiceBudget: Codable, Sendable, Identifiable, Equatable {
    /// One spent window: a short label, how much of it is used (0–100), and a
    /// terse reset hint. `usedPercent` decodes leniently from int or double.
    public struct Window: Codable, Sendable, Equatable {
        public let label: String
        public let usedPercent: Double
        public let reset: String
        /// Absolute quota-window reset in epoch milliseconds. Older brokers omit
        /// this field, so it remains optional for wire compatibility.
        public let resetAt: Double?

        enum CodingKeys: String, CodingKey { case label, usedPercent, reset, resetAt }

        public init(label: String, usedPercent: Double, reset: String, resetAt: Double? = nil) {
            self.label = label
            self.usedPercent = usedPercent
            self.reset = reset
            self.resetAt = resetAt
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            self.label = (try? c.decode(String.self, forKey: .label)) ?? ""
            self.usedPercent = (try? c.decode(Double.self, forKey: .usedPercent)) ?? 0
            self.reset = (try? c.decode(String.self, forKey: .reset)) ?? ""
            self.resetAt = try? c.decode(Double.self, forKey: .resetAt)
        }
    }

    public let provider: String
    public let label: String
    public let plan: String
    public let windows: [Window]

    public var id: String { provider }

    enum CodingKeys: String, CodingKey { case provider, label, plan, windows }

    public init(provider: String, label: String, plan: String, windows: [Window]) {
        self.provider = provider
        self.label = label
        self.plan = plan
        self.windows = windows
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.provider = (try? c.decode(String.self, forKey: .provider)) ?? ""
        self.label = (try? c.decode(String.self, forKey: .label)) ?? ""
        self.plan = (try? c.decode(String.self, forKey: .plan)) ?? ""
        self.windows = (try? c.decode([Window].self, forKey: .windows)) ?? []
    }
}

/// Merge account-level quota snapshots reported by several paired Macs.
/// A later reset timestamp identifies the current quota window and always wins
/// over a stale pre-reset percentage. Percentages are compared only when both
/// samples belong to the same window (or both came from an older broker that
/// did not provide reset metadata).
public func mergeServiceBudgets(_ snapshots: [[ServiceBudget]]) -> [ServiceBudget] {
    var byProvider: [String: ServiceBudget] = [:]
    var providerOrder: [String] = []

    for snapshot in snapshots {
        for budget in snapshot {
            guard let existing = byProvider[budget.provider] else {
                byProvider[budget.provider] = budget
                providerOrder.append(budget.provider)
                continue
            }

            var windows = existing.windows
            for incoming in budget.windows {
                if let index = windows.firstIndex(where: { $0.label == incoming.label }) {
                    windows[index] = preferredServiceBudgetWindow(windows[index], incoming)
                } else {
                    windows.append(incoming)
                }
            }
            byProvider[budget.provider] = ServiceBudget(
                provider: existing.provider,
                label: existing.label.isEmpty ? budget.label : existing.label,
                plan: existing.plan.isEmpty ? budget.plan : existing.plan,
                windows: windows
            )
        }
    }

    return providerOrder.compactMap { byProvider[$0] }
}

private func preferredServiceBudgetWindow(
    _ existing: ServiceBudget.Window,
    _ incoming: ServiceBudget.Window
) -> ServiceBudget.Window {
    switch (existing.resetAt, incoming.resetAt) {
    case let (existingReset?, incomingReset?) where incomingReset != existingReset:
        return incomingReset > existingReset ? incoming : existing
    case (nil, .some):
        return incoming
    case (.some, nil):
        return existing
    default:
        return incoming.usedPercent > existing.usedPercent ? incoming : existing
    }
}

struct MobileServiceBudgetsResult: Codable, Sendable {
    let budgets: [ServiceBudget]

    enum CodingKeys: String, CodingKey { case budgets }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.budgets = (try? c.decode([ServiceBudget].self, forKey: .budgets)) ?? []
    }
}

/// A recent terminal (harness) session for the Home Terminals shelf. `updatedAt`
/// decodes from a ms-epoch number; all fields tolerate absence.
public struct MobileTerminal: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let sessionId: String
    public let cwd: String
    public let command: String
    public let harness: String
    public let running: Bool
    public let updatedAt: Date?

    enum CodingKeys: String, CodingKey { case id, sessionId, cwd, command, harness, running, updatedAt }

    public init(id: String, sessionId: String, cwd: String, command: String, harness: String, running: Bool, updatedAt: Date?) {
        self.id = id
        self.sessionId = sessionId
        self.cwd = cwd
        self.command = command
        self.harness = harness
        self.running = running
        self.updatedAt = updatedAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.id = (try? c.decode(String.self, forKey: .id)) ?? ""
        self.sessionId = (try? c.decode(String.self, forKey: .sessionId)) ?? ""
        self.cwd = (try? c.decode(String.self, forKey: .cwd)) ?? ""
        self.command = (try? c.decode(String.self, forKey: .command)) ?? ""
        self.harness = (try? c.decode(String.self, forKey: .harness)) ?? ""
        self.running = (try? c.decode(Bool.self, forKey: .running)) ?? false
        if let ms = try? c.decode(Double.self, forKey: .updatedAt), ms > 0 {
            self.updatedAt = Date(timeIntervalSince1970: ms / 1000)
        } else {
            self.updatedAt = nil
        }
    }
}

struct MobileTerminalsResult: Codable, Sendable {
    let terminals: [MobileTerminal]

    enum CodingKeys: String, CodingKey { case terminals }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.terminals = (try? c.decode([MobileTerminal].self, forKey: .terminals)) ?? []
    }
}
