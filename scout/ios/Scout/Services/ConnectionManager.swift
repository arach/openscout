// ConnectionManager — WebSocket + Noise encryption + RPC client for the Dispatch bridge.
//
// Manages the full lifecycle: connect via relay, perform Noise handshake,
// route decrypted messages (events → SessionStore, RPC responses → pending
// continuations), and expose typed async RPC methods.
//
// Uses SecureTransport from Security/SecureTransport.swift for Noise encryption,
// DispatchIdentity from Security/Identity.swift for Keychain-based key/trust storage,
// and QRPayload from Security/QRPayload.swift for pairing payload parsing.

import Foundation
import os

// MARK: - Connection state

enum ConnectionState: Sendable, Equatable {
    case disconnected
    case connecting
    case handshaking
    case connected
    case reconnecting(attempt: Int)
    case failed(Error)

    static func == (lhs: ConnectionState, rhs: ConnectionState) -> Bool {
        switch (lhs, rhs) {
        case (.disconnected, .disconnected),
             (.connecting, .connecting),
             (.handshaking, .handshaking),
             (.connected, .connected):
            return true
        case (.reconnecting(let a), .reconnecting(let b)):
            return a == b
        case (.failed, .failed):
            return true
        default:
            return false
        }
    }
}

// MARK: - Errors

enum ConnectionError: LocalizedError, Sendable {
    case notConnected
    case handshakeFailed(String)
    case rpcTimeout(method: String)
    case rpcError(code: Int, message: String)
    case invalidQRPayload(String)
    case reconnectExhausted
    case encodingFailed
    case decodingFailed(String)
    case identityError(String)

    var errorDescription: String? {
        switch self {
        case .notConnected:
            return "Not connected to bridge"
        case .handshakeFailed(let reason):
            return "Handshake failed: \(reason)"
        case .rpcTimeout(let method):
            return "RPC timeout: \(method)"
        case .rpcError(let code, let message):
            return "RPC error \(code): \(message)"
        case .invalidQRPayload(let reason):
            return "Invalid QR payload: \(reason)"
        case .reconnectExhausted:
            return "Reconnect attempts exhausted"
        case .encodingFailed:
            return "Failed to encode RPC request"
        case .decodingFailed(let detail):
            return "Failed to decode message: \(detail)"
        case .identityError(let detail):
            return "Identity error: \(detail)"
        }
    }
}

extension Error {
    var scoutUserFacingMessage: String {
        if let connectionError = self as? ConnectionError {
            switch connectionError {
            case .notConnected, .reconnectExhausted:
                return "Scout on your Mac is unavailable right now. Make sure the bridge is running and try again."
            case .rpcTimeout:
                return "Scout on your Mac took too long to respond. Check that the bridge is awake and try again."
            case .rpcError(_, let message):
                if message.localizedCaseInsensitiveContains("not connected")
                    || message.localizedCaseInsensitiveContains("bridge")
                    || message.localizedCaseInsensitiveContains("relay is not reachable") {
                    return "Scout on your Mac is unavailable right now. Make sure the bridge is running and try again."
                }
                return message
            case .handshakeFailed, .identityError:
                return "Scout couldn't establish a secure connection to your Mac. Reconnect and try again."
            case .invalidQRPayload:
                return connectionError.localizedDescription ?? "That QR code isn't valid."
            case .encodingFailed, .decodingFailed:
                return "Scout hit a transport error talking to your Mac. Try again."
            }
        }
        return localizedDescription
    }
}

// MARK: - Connection info (for reconnect)

/// Lightweight struct holding the relay/room info needed to reconnect.
/// The bridge's trust record (public key) lives in DispatchIdentity (Keychain).
struct BridgeConnectionInfo: Codable, Sendable {
    let relayURL: String
    var roomId: String      // Mutable — updated when room is resolved after bridge restart
    let publicKeyHex: String

    /// Convert the hex public key to raw Data (32 bytes).
    var bridgePublicKeyData: Data {
        var data = Data(capacity: publicKeyHex.count / 2)
        var index = publicKeyHex.startIndex
        while index < publicKeyHex.endIndex {
            let nextIndex = publicKeyHex.index(index, offsetBy: 2)
            if let byte = UInt8(publicKeyHex[index..<nextIndex], radix: 16) {
                data.append(byte)
            }
            index = nextIndex
        }
        return data
    }
}

// MARK: - ConnectionManager

@Observable
final class ConnectionManager: @unchecked Sendable {

    // MARK: Observable state

    private(set) var state: ConnectionState = .disconnected

    private func setState(_ newState: ConnectionState) {
        if Thread.isMainThread {
            state = newState
        } else {
            DispatchQueue.main.sync { state = newState }
        }
    }

    // MARK: Derived

    /// Best-effort bridge host for direct HTTP access (e.g., spectator, file server).
    /// Extracted from the relay URL — works when relay runs on the bridge machine.
    var bridgeHost: String? {
        guard let info = connectionInfo,
              let components = URLComponents(string: info.relayURL),
              let host = components.host else { return nil }
        return host
    }

    /// File server HTTP port (bridge port + 2, default 7890).
    var bridgePort: Int? {
        // File server runs on bridge port + 2 (7889 is relay).
        // TODO: include file server port in bridge/status response
        return 7890
    }

    // MARK: Dependencies

    private let sessionStore: SessionStore

    // MARK: Internal state

    private var webSocket: URLSessionWebSocketTask?
    private var transport: SecureTransport?
    private var receiveTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private let pendingRequests = OSAllocatedUnfairLock(initialState: [String: PendingRequest]())
    private let urlSession: URLSession
    private let sessionDelegate = TrustAllDelegate()
    private var connectionInfo: BridgeConnectionInfo?
    private var identityKeyPair: NoiseKeyPair?
    private var manualDisconnectRequested = false

    private static let logger = Logger(
        subsystem: "com.openscout.scout",
        category: "ConnectionManager"
    )

    private static let rpcTimeout: TimeInterval = 10
    private static let createSessionTimeout: TimeInterval = 30
    private static let maxReconnectAttempts = 3
    private static let maxBackoff: TimeInterval = 30

    // MARK: Init

    init(sessionStore: SessionStore) {
        self.sessionStore = sessionStore
        self.urlSession = URLSession(configuration: .default, delegate: sessionDelegate, delegateQueue: nil)
        self.connectionInfo = Self.loadConnectionInfo()
    }

    deinit {
        disconnect()
    }

    // MARK: - Identity

    /// Load or create the phone's static Noise identity from Keychain.
    private func ensureIdentity() throws -> NoiseKeyPair {
        if let existing = identityKeyPair { return existing }
        let keyPair = try DispatchIdentity.loadOrCreateIdentity()
        identityKeyPair = keyPair
        return keyPair
    }

    // MARK: - Connection lifecycle

    /// Connect to a bridge via QR pairing payload (XX handshake).
    func connect(qrPayload: QRPayload) async throws {
        manualDisconnectRequested = false
        // Validate using the QRPayload's built-in validation.
        if let error = qrPayload.validate() {
            throw ConnectionError.invalidQRPayload(error)
        }

        disconnect()

        setState(.connecting)
        Self.logger.notice("Connecting via QR: relay=\(qrPayload.relay, privacy: .public) room=\(qrPayload.room, privacy: .public)")

        do {
            let expectedRemoteKey = qrPayload.bridgePublicKeyData
            guard expectedRemoteKey.count == 32 else {
                throw ConnectionError.invalidQRPayload("Invalid bridge public key length")
            }

            let remoteKey = try await performConnection(
                relayURL: qrPayload.relay,
                roomId: qrPayload.room,
                remoteStaticKey: nil // XX pattern — no prior key
            )

            try verifyRemoteKey(
                remoteKey,
                matches: expectedRemoteKey,
                failureReason: "Bridge identity did not match the scanned QR code"
            )

            // On successful XX handshake, save the bridge as trusted in Keychain.
            try DispatchIdentity.saveTrustedBridge(publicKey: remoteKey)

            let publicKeyHex = hexString(remoteKey)

            let info = BridgeConnectionInfo(
                relayURL: qrPayload.relay,
                roomId: qrPayload.room,
                publicKeyHex: publicKeyHex
            )
            saveConnectionInfo(info)
            connectionInfo = info

            // Bind session store to this bridge for seq persistence.
            await MainActor.run {
                sessionStore.bindToBridge(publicKeyHex: publicKeyHex)
            }

            startMessageLoop()

            setState(.connected)
            Self.logger.notice("Connected via QR pairing (XX handshake)")

            // Run recovery to sync state.
            await runRecovery()

        } catch {
            setState(.failed(error))
            throw error
        }
    }

    /// Reconnect to a previously trusted bridge (IK handshake).
    ///
    /// Flow (per IOS_GUIDE.md):
    ///   1. Try last known room ID first
    ///   2. If room is gone (4004 or connection refused): resolve new room via POST /resolve
    ///   3. If resolve returns room → connect with new room, Noise IK
    ///   4. If resolve returns 404 → bridge offline, retry with backoff
    ///   5. After 3 failed IK attempts → clear trust, show QR scanner
    func reconnect() async {
        guard !manualDisconnectRequested else {
            setState(.disconnected)
            await MainActor.run {
                sessionStore.connectionState = .disconnected
            }
            return
        }

        guard var info = connectionInfo else {
            Self.logger.warning("No saved connection info to reconnect to")
            setState(.disconnected)
            return
        }

        manualDisconnectRequested = false

        let remoteKeyData = info.bridgePublicKeyData
        guard remoteKeyData.count == 32 else {
            Self.logger.error("Invalid stored public key")
            clearTrustedBridge()
            setState(.disconnected)
            return
        }

        // Verify the bridge is still trusted in Keychain.
        guard DispatchIdentity.isTrustedBridge(publicKey: remoteKeyData) else {
            Self.logger.warning("Bridge no longer trusted, clearing connection info")
            clearTrustedBridge()
            setState(.disconnected)
            return
        }

        var attempt = 0
        while attempt < Self.maxReconnectAttempts {
            attempt += 1
            setState(.reconnecting(attempt: attempt))
            Self.logger.notice("Reconnect attempt \(attempt, privacy: .public)/\(Self.maxReconnectAttempts, privacy: .public)")

            // Resolve the current room — don't guess with stale room IDs.
            Self.logger.notice("Resolving room for bridge \(info.publicKeyHex.prefix(12), privacy: .public)... relay=\(info.relayURL, privacy: .public)")
            guard let roomId = await resolveRoom(relayURL: info.relayURL, publicKeyHex: info.publicKeyHex) else {
                Self.logger.notice("Resolve returned 404 — bridge offline")
                if attempt < Self.maxReconnectAttempts {
                    let backoff = min(pow(2.0, Double(attempt - 1)), Self.maxBackoff)
                    try? await Task.sleep(for: .seconds(backoff))
                }
                continue
            }

            // Update saved room if it changed.
            if roomId != info.roomId {
                Self.logger.notice("Room changed: \(info.roomId, privacy: .public) → \(roomId, privacy: .public)")
                info.roomId = roomId
                saveConnectionInfo(info)
                connectionInfo = info
            }

            do {
                let remoteKey = try await performConnection(
                    relayURL: info.relayURL,
                    roomId: roomId,
                    remoteStaticKey: remoteKeyData
                )

                try verifyRemoteKey(
                    remoteKey,
                    matches: remoteKeyData,
                    failureReason: "Trusted bridge identity changed during reconnect"
                )

                await MainActor.run {
                    sessionStore.bindToBridge(publicKeyHex: info.publicKeyHex)
                }
                try? DispatchIdentity.touchTrustedBridge(publicKey: remoteKeyData)
                startMessageLoop()
                setState(.connected)
                Self.logger.notice("Reconnected via IK handshake")
                await runRecovery()
                return

            } catch {
                Self.logger.error("Handshake failed: \(error.localizedDescription, privacy: .public)")
                if attempt < Self.maxReconnectAttempts {
                    let backoff = min(pow(2.0, Double(attempt - 1)), Self.maxBackoff)
                    try? await Task.sleep(for: .seconds(backoff))
                }
            }
        }

        // Exhausted all attempts — keep trust (bridge is just offline), signal failure.
        Self.logger.error("All reconnect attempts exhausted — bridge appears offline")
        setState(.failed(ConnectionError.reconnectExhausted))
    }

    /// Resolve the bridge's current room ID via the relay's POST /resolve endpoint.
    private func resolveRoom(relayURL: String, publicKeyHex: String) async -> String? {
        // Convert ws(s):// to http(s):// for the REST endpoint.
        let httpURL = relayURL
            .replacingOccurrences(of: "wss://", with: "https://")
            .replacingOccurrences(of: "ws://", with: "http://")
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))

        guard let url = URL(string: "\(httpURL)/resolve") else { return nil }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONEncoder().encode(["bridgePublicKey": publicKeyHex])

        do {
            let (data, response) = try await urlSession.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                return nil
            }
            let result = try JSONDecoder().decode([String: String].self, from: data)
            return result["room"]
        } catch {
            Self.logger.error("Room resolve request failed: \(error.localizedDescription, privacy: .public)")
            return nil
        }
    }

    /// Disconnect from the current bridge.
    func disconnect() {
        manualDisconnectRequested = true
        receiveTask?.cancel()
        receiveTask = nil
        reconnectTask?.cancel()
        reconnectTask = nil

        transport = nil

        let activeWebSocket = webSocket
        webSocket = nil
        activeWebSocket?.cancel(with: .goingAway, reason: nil)

        cancelAllPendingRequests(with: ConnectionError.notConnected)

        Task { @MainActor in
            sessionStore.connectionState = .disconnected
        }

        if state != .disconnected {
            setState(.disconnected)
        }
    }

    /// Whether there is a saved trusted bridge (for UI routing decisions).
    var hasTrustedBridge: Bool {
        connectionInfo != nil
    }

    /// Clear the trusted bridge record (triggers QR scanner).
    func clearTrustedBridge() {
        disconnect()

        if let info = connectionInfo {
            let keyData = info.bridgePublicKeyData
            if keyData.count == 32 {
                try? DispatchIdentity.removeTrustedBridge(publicKey: keyData)
            }
        }
        connectionInfo = nil
        UserDefaults.standard.removeObject(forKey: "scout.connectionInfo")
        Task { @MainActor in
            sessionStore.clearAll()
            sessionStore.connectionState = .disconnected
        }
        setState(.disconnected)
        Self.logger.notice("Cleared trusted bridge record")
    }

    // MARK: - RPC client methods

    func createSession(
        adapterType: String,
        name: String? = nil,
        cwd: String? = nil,
        options: [String: AnyCodable]? = nil
    ) async throws -> Session {
        let params = CreateSessionParams(
            adapterType: adapterType,
            name: name,
            cwd: cwd,
            options: options
        )
        let data = try await sendRPC(method: "session/create", params: params)
        return try decodeResult(Session.self, from: data)
    }

    func createMobileSession(
        workspaceId: String,
        harness: String? = nil,
        agentName: String? = nil,
        worktree: String? = nil,
        profile: String? = nil
    ) async throws -> MobileSessionHandle {
        let params = MobileCreateSessionParams(
            workspaceId: workspaceId,
            harness: harness,
            agentName: agentName,
            worktree: worktree,
            profile: profile
        )
        let data = try await sendRPC(method: "mobile/session/create", params: params)
        return try decodeResult(MobileSessionHandle.self, from: data)
    }

    func listSessions() async throws -> [Session] {
        let data = try await sendRPC(method: "session/list", params: nil as Empty?)
        return try decodeResult([Session].self, from: data)
    }

    func listMobileSessions(query: String? = nil, limit: Int? = nil) async throws -> [MobileSessionSummary] {
        let params = MobileListParams(query: query, limit: limit)
        let data = try await sendRPC(method: "mobile/sessions", params: params)
        return try decodeResult([MobileSessionSummary].self, from: data)
    }

    func listMobileWorkspaces(query: String? = nil, limit: Int? = nil) async throws -> [MobileWorkspaceSummary] {
        let params = MobileListParams(query: query, limit: limit)
        let data = try await sendRPC(method: "mobile/workspaces", params: params)
        return try decodeResult([MobileWorkspaceSummary].self, from: data)
    }

    func closeSession(_ sessionId: String) async throws {
        let params = SessionIdParams(sessionId: sessionId)
        _ = try await sendRPC(method: "session/close", params: params)
    }

    func sendPrompt(_ prompt: Prompt) async throws {
        let session = await MainActor.run {
            sessionStore.sessions[prompt.sessionId]?.session
        }
        guard let session,
              let agentId = session.agentId else {
            throw ConnectionError.rpcError(code: -32602, message: "Missing relay agent for session")
        }

        let params = MobileSendMessageParams(
            agentId: agentId,
            body: prompt.text,
            clientMessageId: UUID().uuidString,
            replyToMessageId: nil,
            referenceMessageIds: nil,
            harness: session.adapterType.trimmedNonEmpty
        )
        _ = try await sendRPC(method: "mobile/message/send", params: params)
    }

    func interruptTurn(_ sessionId: String) async throws {
        let params = SessionIdParams(sessionId: sessionId)
        _ = try await sendRPC(method: "turn/interrupt", params: params)
    }

    func getSnapshot(_ sessionId: String, beforeTurnId: String? = nil, limit: Int? = nil) async throws -> SessionState {
        let params = MobileSessionSnapshotParams(
            conversationId: sessionId,
            beforeTurnId: beforeTurnId,
            limit: limit
        )
        let data = try await sendRPC(method: "mobile/session/snapshot", params: params)
        return try decodeResult(SessionState.self, from: data)
    }

    func syncStatus() async throws -> SyncStatusResponse {
        let data = try await sendRPC(method: "sync/status", params: nil as Empty?)
        return try decodeResult(SyncStatusResponse.self, from: data)
    }

    func syncReplay(lastSeq: Int) async throws -> [SequencedEvent] {
        let params = ReplayParams(lastSeq: lastSeq)
        let data = try await sendRPC(method: "sync/replay", params: params)
        let response = try decodeResult(ReplayResponse.self, from: data)
        return response.events
    }

    func bridgeStatus() async throws -> BridgeStatusResponse {
        let data = try await sendRPC(method: "bridge/status", params: nil as Empty?)
        return try decodeResult(BridgeStatusResponse.self, from: data)
    }

    // MARK: - Workspace RPC methods

    func workspaceInfo() async throws -> WorkspaceInfoResponse {
        let data = try await sendRPC(method: "workspace/info", params: nil as Empty?)
        return try decodeResult(WorkspaceInfoResponse.self, from: data)
    }

    func workspaceList(path: String? = nil) async throws -> WorkspaceListResponse {
        let params = WorkspaceListParams(path: path)
        let data = try await sendRPC(method: "workspace/list", params: params)
        return try decodeResult(WorkspaceListResponse.self, from: data)
    }

    func workspaceOpen(path: String, adapter: String? = nil, name: String? = nil) async throws -> Session {
        let params = WorkspaceOpenParams(path: path, adapter: adapter, name: name)
        let data = try await sendRPC(method: "workspace/open", params: params)
        return try decodeResult(Session.self, from: data)
    }

    func refreshRelaySessions(limit: Int = 100) async {
        do {
            let sessions = try await listMobileSessions(limit: limit)
            let now = Int(Date().timeIntervalSince1970 * 1000)
            let summaries = sessions.map { session in
                let lastActivityAt = (session.lastMessageAt ?? Int(now / 1000)) * 1000
                let project = session.workspaceRoot?.trimmedNonEmpty.map {
                    URL(fileURLWithPath: $0).lastPathComponent
                } ?? session.agentName
                return SessionSummary(
                    sessionId: session.id,
                    name: session.title,
                    adapterType: session.harness?.trimmedNonEmpty ?? "relay",
                    status: "active",
                    turnCount: session.messageCount,
                    currentTurnStatus: nil,
                    startedAt: lastActivityAt,
                    lastActivityAt: lastActivityAt,
                    project: project,
                    model: nil,
                    isCachedOnly: false
                )
            }

            await MainActor.run {
                sessionStore.reconcileLiveSummaries(summaries)
                sessionStore.connectionState = .connected
            }
        } catch {
            Self.logger.error("Relay refresh failed: \(error.localizedDescription, privacy: .public)")
            await MainActor.run {
                sessionStore.connectionState = state
            }
        }
    }

    // MARK: - Session Resume

    func resumeSession(sessionPath: String, adapterType: String? = nil, name: String? = nil) async throws -> Session {
        let params = SessionResumeParams(sessionPath: sessionPath, adapterType: adapterType, name: name)
        let data = try await sendRPC(method: "session/resume", params: params)
        return try decodeResult(Session.self, from: data)
    }

    // MARK: - History RPC methods

    func historyDiscover(maxAge: Int = 14, limit: Int = 100, project: String? = nil) async throws -> HistoryDiscoverResponse {
        let params = HistoryDiscoverParams(maxAge: maxAge, limit: limit, project: project)
        let data = try await sendRPC(method: "history/discover", params: params)
        return try decodeResult(HistoryDiscoverResponse.self, from: data)
    }

    func historySearch(query: String, maxAge: Int = 14, limit: Int = 20) async throws -> HistorySearchResponse {
        let params = HistorySearchParams(query: query, maxAge: maxAge, limit: limit)
        let data = try await sendRPC(method: "history/search", params: params)
        return try decodeResult(HistorySearchResponse.self, from: data)
    }

    func historyRead(path: String) async throws -> HistoryReadResponse {
        let params = HistoryReadParams(path: path)
        let data = try await sendRPC(method: "history/read", params: params)
        return try decodeResult(HistoryReadResponse.self, from: data)
    }

    // MARK: - Private: Connection

    /// Perform the WebSocket connection and Noise handshake.
    /// Returns the authenticated remote static public key on success.
    @discardableResult
    private func performConnection(
        relayURL: String,
        roomId: String,
        remoteStaticKey: Data?
    ) async throws -> Data {
        // Build relay URL with query params.
        guard var components = URLComponents(string: relayURL) else {
            throw ConnectionError.invalidQRPayload("Invalid relay URL")
        }
        components.queryItems = [
            URLQueryItem(name: "room", value: roomId),
            URLQueryItem(name: "role", value: "client"),
        ]
        guard let url = components.url else {
            throw ConnectionError.invalidQRPayload("Failed to construct relay URL")
        }

        // Load our identity key pair.
        let keyPair: NoiseKeyPair
        do {
            keyPair = try ensureIdentity()
        } catch {
            throw ConnectionError.identityError(error.localizedDescription)
        }

        // Open WebSocket.
        let ws = urlSession.webSocketTask(with: url)
        ws.resume()
        self.webSocket = ws

        setState(.handshaking)

        // Create SecureTransport with just the identity key.
        let newTransport = SecureTransport(staticKey: keyPair)
        self.transport = newTransport

        // Capture the remote public key via onReady callback using a Sendable box.
        let remoteKeyBox = KeyBox()
        newTransport.onReady = { key in
            remoteKeyBox.set(key)
        }

        // Perform the Noise handshake — blocks until complete.
        // SecureTransport reads/writes the WebSocket directly.
        do {
            try await newTransport.performHandshake(
                webSocket: ws,
                remoteStaticKey: remoteStaticKey
            )
        } catch {
            throw ConnectionError.handshakeFailed(error.localizedDescription)
        }

        guard newTransport.isReady, let remoteKey = remoteKeyBox.get() else {
            throw ConnectionError.handshakeFailed("Transport not ready after handshake")
        }

        return remoteKey
    }

    /// Read decrypted messages from the transport's AsyncStream and route them.
    private func startMessageLoop() {
        guard let transport else {
            Self.logger.error("Cannot start message loop without an active transport")
            return
        }

        receiveTask?.cancel()
        receiveTask = Task { [weak self] in
            for await message in transport.receive() {
                self?.handleDecryptedMessage(message)
            }
            // Stream ended — connection lost.
            if !Task.isCancelled {
                await self?.handleDisconnect()
            }
        }
    }

    private func handleDisconnect() async {
        let shouldReconnect = !manualDisconnectRequested && connectionInfo != nil

        // Clean up the dead connection state.
        transport = nil
        let activeWebSocket = webSocket
        webSocket = nil
        activeWebSocket?.cancel(with: .goingAway, reason: nil)
        cancelAllPendingRequests(with: ConnectionError.notConnected)

        await MainActor.run {
            sessionStore.connectionState = shouldReconnect ? .reconnecting(attempt: 0) : .disconnected
        }

        // Attempt reconnect if we have connection info for a trusted bridge.
        if shouldReconnect {
            await reconnect()
        } else {
            setState(.disconnected)
            await MainActor.run {
                sessionStore.connectionState = .disconnected
            }
        }
    }

    // MARK: - Private: Message routing

    private func handleDecryptedMessage(_ raw: String) {
        guard let data = raw.data(using: .utf8) else {
            Self.logger.warning("Received non-UTF8 message, skipping")
            return
        }

        // Try parsing as an RPC response first (has "id" field).
        if let response = try? JSONDecoder().decode(RPCResponse.self, from: data) {
            handleRPCResponse(response)
            return
        }

        // Try parsing as a sequenced event (has "seq" and "event" fields).
        if let sequenced = try? JSONDecoder().decode(SequencedEvent.self, from: data) {
            Task { @MainActor in
                sessionStore.applyEvent(sequenced)
            }
            return
        }

        // Unknown message format — log and skip. Never crash.
        Self.logger.warning("Unrecognized message format, skipping: \(raw.prefix(200), privacy: .public)")
    }

    private func handleRPCResponse(_ response: RPCResponse) {
        let pending = pendingRequests.withLock { $0.removeValue(forKey: response.id) }

        guard let pending else {
            Self.logger.warning("Received RPC response for unknown id: \(response.id, privacy: .public)")
            return
        }

        pending.timeoutTask.cancel()

        if let error = response.error {
            pending.continuation.resume(
                throwing: ConnectionError.rpcError(code: error.code, message: error.message)
            )
        } else if let result = response.result {
            // Re-encode the AnyCodable result to Data so callers can decode to their specific type.
            do {
                let resultData = try JSONEncoder().encode(result)
                pending.continuation.resume(returning: resultData)
            } catch {
                pending.continuation.resume(
                    throwing: ConnectionError.decodingFailed("Failed to re-encode result")
                )
            }
        } else {
            // Success with no result body (e.g., { "id": "...", "result": null }).
            // Encode an empty JSON object so decoders expecting { ok: true } still work.
            let emptyData = "{}".data(using: .utf8)!
            pending.continuation.resume(returning: emptyData)
        }
    }

    // MARK: - Private: RPC sending

    private func sendRPC<P: Encodable & Sendable>(
        method: String,
        params: P?
    ) async throws -> Data {
        guard let transport, transport.isReady else {
            throw ConnectionError.notConnected
        }

        let request = RPCRequest(method: method, params: params)

        let encoder = JSONEncoder()
        guard let jsonData = try? encoder.encode(request),
              let jsonString = String(data: jsonData, encoding: .utf8) else {
            throw ConnectionError.encodingFailed
        }

        return try await withCheckedThrowingContinuation { continuation in
            let timeoutTask = Task { [weak self] in
                let timeout = switch method {
                case "mobile/session/create", "session/create", "workspace/open", "session/resume":
                    Self.createSessionTimeout
                default:
                    Self.rpcTimeout
                }
                try? await Task.sleep(for: .seconds(timeout))
                guard !Task.isCancelled else { return }

                let removed = self?.pendingRequests.withLock { $0.removeValue(forKey: request.id) }
                if removed != nil {
                    Self.logger.warning("RPC timeout: \(method, privacy: .public) — connection likely stale")
                    continuation.resume(throwing: ConnectionError.rpcTimeout(method: method))
                    // Stale connection — tear down and reconnect
                    await self?.handleDisconnect()
                }
            }

            let pending = PendingRequest(
                method: method,
                continuation: continuation,
                timeoutTask: timeoutTask
            )

            pendingRequests.withLock { $0[request.id] = pending }

            Task {
                do {
                    try await transport.send(jsonString)
                } catch {
                    let removed = self.pendingRequests.withLock { $0.removeValue(forKey: request.id) }
                    if removed != nil {
                        timeoutTask.cancel()
                        continuation.resume(throwing: error)
                    }
                }
            }
        }
    }

    private func cancelAllPendingRequests(with error: Error) {
        let requests = pendingRequests.withLock { dict -> [String: PendingRequest] in
            let copy = dict
            dict.removeAll()
            return copy
        }

        for (_, pending) in requests {
            pending.timeoutTask.cancel()
            pending.continuation.resume(throwing: error)
        }
    }

    private func decodeResult<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw ConnectionError.decodingFailed(
                "Expected \(T.self): \(error.localizedDescription)"
            )
        }
    }

    // MARK: - Private: Recovery (PROTOCOL.md §4)

    /// Run the reconnect recovery algorithm from PROTOCOL.md §4.
    private func runRecovery() async {
        await refreshRelaySessions()
    }

    // MARK: - Private: Connection info persistence

    private static func loadConnectionInfo() -> BridgeConnectionInfo? {
        guard let data = UserDefaults.standard.data(forKey: "scout.connectionInfo") else {
            return nil
        }
        return try? JSONDecoder().decode(BridgeConnectionInfo.self, from: data)
    }

    private func saveConnectionInfo(_ info: BridgeConnectionInfo) {
        if let data = try? JSONEncoder().encode(info) {
            UserDefaults.standard.set(data, forKey: "scout.connectionInfo")
        }
    }

    private func verifyRemoteKey(
        _ remoteKey: Data,
        matches expectedKey: Data,
        failureReason: String
    ) throws {
        guard remoteKey == expectedKey else {
            disconnect()
            throw ConnectionError.handshakeFailed(failureReason)
        }
    }
}

// MARK: - Pending request tracking

private struct PendingRequest: @unchecked Sendable {
    let method: String
    let continuation: CheckedContinuation<Data, Error>
    let timeoutTask: Task<Void, Never>
}

// MARK: - Empty params helper

/// Used for RPC methods with no parameters.
private struct Empty: Encodable, Sendable {}

// MARK: - URLSession delegate (accept self-signed certs)

/// Accepts self-signed TLS certificates. Safe because Noise Protocol handles
/// real peer authentication — TLS is just a transport wrapper to satisfy iOS ATS.
private final class TrustAllDelegate: NSObject, URLSessionDelegate {
    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
           let trust = challenge.protectionSpace.serverTrust {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.performDefaultHandling, nil)
        }
    }
}

/// Thread-safe box for capturing a value from a Sendable closure.
private final class KeyBox: @unchecked Sendable {
    private var value: Data?
    private let lock = OSAllocatedUnfairLock(initialState: ())
    func set(_ data: Data) { lock.withLock { _ in value = data } }
    func get() -> Data? { lock.withLock { _ in value } }
}

private func hexString(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
}

// MARK: - Preview instance

extension ConnectionManager {
    /// Create a preview instance for SwiftUI previews.
    @MainActor
    static func preview() -> ConnectionManager {
        let store = SessionStore.preview
        let manager = ConnectionManager(sessionStore: store)
        manager.state = .connected
        return manager
    }
}
