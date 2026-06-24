// BridgeConnection — encrypted-transport connection lifecycle for the Scout bridge.
//
// Distilled from apps/ios/Scout/Services/ConnectionManager.swift (the donor's
// 2533-line working implementation). This keeps the *core loop* only:
//
//   - relay-candidate ordering (Bonjour LAN first + stored relay URLs),
//     filtered by route settings and deduplicated;
//   - room resolution via the relay's POST /resolve endpoint;
//   - the Noise IK handshake (over SecureTransport), with trusted-bridge key
//     verification;
//   - tRPC request/response over the encrypted channel, with a pending
//     continuation map keyed by request id and a per-request timeout;
//   - the live conversation event stream and the tail firehose stream,
//     fanned out from a single inbound decrypt loop (handleDecryptedMessage).
//
// Dropped vs. the donor: inbox, push/APNS, mesh rendezvous, OSN auth, history,
// health probing, operator notifications, workspace listing, and automatic
// reconnect-on-drop. See the report for the exact gap list.
//
// The Noise/tRPC wire details are byte-identical to the donor so this interops
// with the real bridge unchanged.

import Foundation
import ScoutCapabilities

// MARK: - Errors

public enum BridgeConnectionError: Error, LocalizedError, Sendable {
    case noTrustedBridge
    case noRelayCandidates
    case relayUnavailable
    case tailscaleUnavailable
    case handshakeFailed(String)
    case identityError(String)
    case notConnected
    case encodingFailed
    case decodingFailed(String)
    case rpcError(code: Int, message: String)
    case rpcTimeout(method: String)

    public var errorDescription: String? {
        switch self {
        case .noTrustedBridge: return "No trusted bridge is paired on this device."
        case .noRelayCandidates: return "No relay routes are available for the trusted bridge."
        case .relayUnavailable: return "Could not reach the bridge through any relay route."
        case .tailscaleUnavailable:
            return "Scout cannot reach your Mac on the local network or through the saved Tailscale route."
        case .handshakeFailed(let reason): return "Noise handshake failed: \(reason)"
        case .identityError(let reason): return "Identity error: \(reason)"
        case .notConnected: return "Not connected to the bridge."
        case .encodingFailed: return "Failed to encode the RPC request."
        case .decodingFailed(let detail): return "Failed to decode an RPC result: \(detail)"
        case .rpcError(let code, let message): return "Bridge RPC error \(code): \(message)"
        case .rpcTimeout(let method): return "RPC timed out: \(method)"
        }
    }
}

// MARK: - Connection info (for reconnect)

/// Lightweight struct holding the relay/room info needed to connect to a paired
/// bridge. Ported verbatim from the donor (the bridge's trust record — its
/// public key — lives in `ScoutIdentity` / Keychain, not here).
struct BridgeConnectionInfo: Codable, Sendable {
    private static let connectionInfosKey = "scout.connectionInfos"
    private static let legacyConnectionInfoKey = "scout.connectionInfo"
    private static let activeConnectionPublicKeyHexKey = "scout.activeConnectionPublicKeyHex"

    let relayURL: String
    var roomId: String      // Mutable — updated when room is resolved after bridge restart
    let publicKeyHex: String
    let fallbackRelayURLs: [String]
    let webPort: Int?

    init(
        relayURL: String,
        roomId: String,
        publicKeyHex: String,
        fallbackRelayURLs: [String] = [],
        webPort: Int? = nil
    ) {
        self.relayURL = relayURL
        self.roomId = roomId
        self.publicKeyHex = publicKeyHex
        self.fallbackRelayURLs = Array(deduplicatedRelayURLs(primary: relayURL, fallbacks: fallbackRelayURLs).dropFirst())
        self.webPort = webPort
    }

    enum CodingKeys: String, CodingKey {
        case relayURL
        case roomId
        case publicKeyHex
        case fallbackRelayURLs
        case webPort
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let relayURL = try container.decode(String.self, forKey: .relayURL)
        let fallbackRelayURLs = try container.decodeIfPresent([String].self, forKey: .fallbackRelayURLs) ?? []
        self.init(
            relayURL: relayURL,
            roomId: try container.decode(String.self, forKey: .roomId),
            publicKeyHex: try container.decode(String.self, forKey: .publicKeyHex),
            fallbackRelayURLs: fallbackRelayURLs,
            webPort: try container.decodeIfPresent(Int.self, forKey: .webPort)
        )
    }

    var relayURLs: [String] {
        deduplicatedRelayURLs(primary: relayURL, fallbacks: fallbackRelayURLs)
    }

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

    // MARK: UserDefaults load (donor keys, distilled)

    /// Load the active connection info using the same UserDefaults keys and
    /// precedence the donor uses: `scout.connectionInfos` (active key selected by
    /// `scout.activeConnectionPublicKeyHex`), falling back to the legacy
    /// single-record `scout.connectionInfo`.
    static func loadActive(userDefaults: UserDefaults = .standard) -> BridgeConnectionInfo? {
        let infos = loadConnectionInfos(userDefaults: userDefaults)
        if let activeKey = activePublicKeyHex(userDefaults: userDefaults),
           let info = load(publicKeyHex: activeKey, userDefaults: userDefaults) {
            return info
        }
        if let info = infos.first {
            return info
        }
        return loadLegacy(userDefaults: userDefaults)
    }

    /// Load the connection info for one bridge key. Pinned bridge clients use this
    /// directly so they never depend on the global active-key UI preference.
    static func load(publicKeyHex: String, userDefaults: UserDefaults = .standard) -> BridgeConnectionInfo? {
        let key = publicKeyHex.lowercased()
        return loadConnectionInfos(userDefaults: userDefaults)
            .first { $0.publicKeyHex.lowercased() == key }
    }

    static func activePublicKeyHex(userDefaults: UserDefaults = .standard) -> String? {
        userDefaults.string(forKey: activeConnectionPublicKeyHexKey)?.lowercased()
    }

    /// Persist the active-key preference without touching any per-bridge route
    /// records. This is UI state only; pinned connections must not read or mutate it.
    static func setActivePublicKeyHex(_ publicKeyHex: String?, userDefaults: UserDefaults = .standard) {
        guard let key = publicKeyHex?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
              !key.isEmpty else {
            userDefaults.removeObject(forKey: activeConnectionPublicKeyHexKey)
            return
        }
        userDefaults.set(key, forKey: activeConnectionPublicKeyHexKey)
    }

    private static func loadConnectionInfos(userDefaults: UserDefaults) -> [BridgeConnectionInfo] {
        guard let data = userDefaults.data(forKey: connectionInfosKey),
              let infos = try? JSONDecoder().decode([BridgeConnectionInfo].self, from: data) else {
            return loadLegacy(userDefaults: userDefaults).map { [$0] } ?? []
        }
        var seen = Set<String>()
        return infos.filter { seen.insert($0.publicKeyHex.lowercased()).inserted }
    }

    private static func loadLegacy(userDefaults: UserDefaults) -> BridgeConnectionInfo? {
        guard let data = userDefaults.data(forKey: legacyConnectionInfoKey) else { return nil }
        return try? JSONDecoder().decode(BridgeConnectionInfo.self, from: data)
    }

    // MARK: UserDefaults save (donor keys, distilled)

    /// Persist this connection info the same way the donor's `saveConnectionInfo`
    /// does so a later IK `connect()` reads it back via `loadActive`:
    ///   - append/replace in `scout.connectionInfos` (JSON `[BridgeConnectionInfo]`,
    ///     deduped by lowercased `publicKeyHex`);
    ///   - optionally set `scout.activeConnectionPublicKeyHex` to this info's
    ///     lowercased key (legacy single-link UI preference only);
    ///   - when promoted, mirror into the legacy single-record
    ///     `scout.connectionInfo` for old single-link readers.
    func save(userDefaults: UserDefaults = .standard, promoteActive: Bool = true) {
        let key = publicKeyHex.lowercased()
        var infos = Self.loadConnectionInfos(userDefaults: userDefaults)
        if let index = infos.firstIndex(where: { $0.publicKeyHex.lowercased() == key }) {
            infos[index] = self
        } else {
            infos.append(self)
        }
        var seen = Set<String>()
        let deduped = infos.filter { seen.insert($0.publicKeyHex.lowercased()).inserted }
        if let data = try? JSONEncoder().encode(deduped) {
            userDefaults.set(data, forKey: Self.connectionInfosKey)
        }
        if promoteActive {
            Self.setActivePublicKeyHex(key, userDefaults: userDefaults)
        }
        if promoteActive, let data = try? JSONEncoder().encode(self) {
            userDefaults.set(data, forKey: Self.legacyConnectionInfoKey)
        }
    }

    static func remove(publicKeyHex: String, userDefaults: UserDefaults = .standard) {
        let key = publicKeyHex.lowercased()
        let remaining = loadConnectionInfos(userDefaults: userDefaults)
            .filter { $0.publicKeyHex.lowercased() != key }

        if let data = try? JSONEncoder().encode(remaining) {
            userDefaults.set(data, forKey: connectionInfosKey)
        }

        if activePublicKeyHex(userDefaults: userDefaults) == key {
            setActivePublicKeyHex(remaining.first?.publicKeyHex, userDefaults: userDefaults)
        }

        if let legacy = loadLegacy(userDefaults: userDefaults),
           legacy.publicKeyHex.lowercased() == key {
            if let next = remaining.first,
               let data = try? JSONEncoder().encode(next) {
                userDefaults.set(data, forKey: legacyConnectionInfoKey)
            } else {
                userDefaults.removeObject(forKey: legacyConnectionInfoKey)
            }
        }
    }
}

/// Optional pin for a bridge connection. A nil target preserves the legacy
/// single-bridge behavior (read the UI's active-key preference); a non-nil target
/// makes this connection immutable to one trusted bridge public key.
public struct BridgeConnectionTarget: Hashable, Sendable {
    public let publicKeyHex: String

    public init(publicKeyHex: String) {
        self.publicKeyHex = publicKeyHex.lowercased()
    }
}

public struct BridgeConnectionDisconnectEvent: Sendable {
    public let publicKeyHex: String?
    public let route: TransportKind
    public let host: String?
    public let reason: String

    public init(
        publicKeyHex: String?,
        route: TransportKind,
        host: String?,
        reason: String
    ) {
        self.publicKeyHex = publicKeyHex
        self.route = route
        self.host = host
        self.reason = reason
    }
}

public typealias BridgeConnectionDisconnectHandler = @MainActor @Sendable (BridgeConnectionDisconnectEvent) -> Void

// MARK: - Room resolution result

private enum ResolveRoomResult: Sendable {
    case resolved(String)
    case bridgeOffline
    case tailscaleUnavailable
    case relayUnavailable
}

private struct RelayConnectionAttempt: Sendable {
    let relayURL: String
    let roomId: String
    let remoteKey: Data
}

// MARK: - Pending RPC tracking

private struct PendingRequest {
    let method: String
    let continuation: CheckedContinuation<Data, Error>
    let timeoutTask: Task<Void, Never>
}

// MARK: - BridgeConnection

/// Owns the encrypted connection lifecycle, the tRPC request/response plumbing,
/// and the inbound message fan-out (events + tail). `@unchecked Sendable` with an
/// internal lock, mirroring the donor's `ConnectionManager`.
public final class BridgeConnection: @unchecked Sendable {

    // MARK: Dependencies

    private let connectionLogHandle: ConnectionLogHandle
    private let userDefaults: UserDefaults
    private let urlSession: URLSession
    private let target: BridgeConnectionTarget?

    // MARK: Timeouts (donor values)

    private static let rpcTimeout: TimeInterval = 15
    private static let createSessionTimeout: TimeInterval = 60

    // MARK: Locked state

    private let lock = NSLock()
    private var transport: SecureTransport?
    private var webSocket: URLSessionWebSocketTask?
    private var connectionInfo: BridgeConnectionInfo?
    private var receiveTask: Task<Void, Never>?
    private var connectionGeneration = 0
    private var disconnectHandler: BridgeConnectionDisconnectHandler?
    private var nextRequestId = 1
    private var pendingRequests: [Int: PendingRequest] = [:]
    private var _isConnected = false
    private var _currentRoute: TransportKind = .none
    private var _currentHost: String?

    // MARK: Fan-out continuations

    private var eventFanout: [UUID: AsyncStream<SequencedEvent>.Continuation] = [:]
    private var tailFanout: [UUID: AsyncStream<TailEvent>.Continuation] = [:]
    private var mobileConversationChangeFanout: [UUID: AsyncStream<MobileConversationChangeEvent>.Continuation] = [:]

    // MARK: Exposed state

    /// The MainActor connection log surfaced to the UI.
    public var connectionLog: ConnectionLog { connectionLogHandle.log }

    public var isConnected: Bool {
        lock.lock(); defer { lock.unlock() }
        return _isConnected
    }

    public var currentRoute: TransportKind {
        lock.lock(); defer { lock.unlock() }
        return _currentRoute
    }

    /// The host we're currently connected through (e.g. "Arachs-Mac-mini.local"
    /// on LAN) — the bridge's own advertised name, used to label the machine
    /// instead of the phone's device name.
    public var currentHost: String? {
        lock.lock(); defer { lock.unlock() }
        return _currentHost
    }

    /// Public-key hex of the bridge this connection is pinned to, if any.
    public var targetPublicKeyHex: String? { target?.publicKeyHex }

    /// Public-key hex of the bridge backing the current or most-recent successful
    /// connection on this instance.
    public var currentPublicKeyHex: String? {
        lock.lock(); defer { lock.unlock() }
        return connectionInfo?.publicKeyHex
    }

    /// Snapshot the stored relay routes for this connection's target bridge. This
    /// is a synchronous summary for settings/status UI; it does not probe
    /// reachability. Pinned connections read only their key's routes. Unpinned
    /// connections read the active-key UI preference for legacy single-link mode.
    public func savedRouteSummary() -> BridgeRouteSummary {
        guard let info = savedConnectionInfoForTarget() else {
            return BridgeRouteSummary(relayURLs: [], userDefaults: userDefaults)
        }
        return BridgeRouteSummary(relayURLs: info.relayURLs, userDefaults: userDefaults)
    }

    public func savedWebPort() -> Int? {
        savedConnectionInfoForTarget()?.webPort
    }

    public func setUnexpectedDisconnectHandler(_ handler: BridgeConnectionDisconnectHandler?) {
        lock.withLockVoid {
            disconnectHandler = handler
        }
    }

    // MARK: Init

    public init(
        target: BridgeConnectionTarget? = nil,
        connectionLog: ConnectionLogHandle,
        userDefaults: UserDefaults = .standard,
        urlSession: URLSession? = nil
    ) {
        self.target = target
        self.connectionLogHandle = connectionLog
        self.userDefaults = userDefaults
        if let urlSession {
            self.urlSession = urlSession
        } else {
            let config = URLSessionConfiguration.default
            self.urlSession = URLSession(
                configuration: config,
                delegate: TrustAllDelegate(),
                delegateQueue: nil
            )
        }
    }

    // MARK: - Connection lifecycle

    /// Connect to the trusted bridge. Loads identity + the stored
    /// `BridgeConnectionInfo`, assembles relay candidates (Bonjour LAN first +
    /// stored URLs, route-filtered, deduplicated), then iterates them: resolve
    /// room, run the Noise IK handshake, and verify the remote static key matches
    /// the trusted bridge key. Logs each attempt and the winning route.
    public func connect() async throws {
        let generation = nextConnectionGeneration()
        let keyPair: NoiseKeyPair
        do {
            keyPair = try ScoutIdentity.loadOrCreateIdentity()
        } catch {
            throw BridgeConnectionError.identityError(error.localizedDescription)
        }

        let savedInfo = savedConnectionInfoForTarget()
        let discoveredInfo: BridgeConnectionInfo?
        if savedInfo == nil {
            discoveredInfo = await discoveredConnectionInfoFromTrustedBridge()
        } else {
            discoveredInfo = nil
        }

        guard let info = savedInfo ?? discoveredInfo else {
            if currentTrustedBridge() == nil {
                await connectionLogHandle.log("No trusted bridge paired", event: .trust, level: .error)
                throw BridgeConnectionError.noTrustedBridge
            }
            await connectionLogHandle.log("No relay routes available", event: .routeUnavailable, level: .error)
            throw BridgeConnectionError.noRelayCandidates
        }

        if savedInfo == nil {
            info.save(userDefaults: userDefaults, promoteActive: target == nil)
            await connectionLogHandle.log(
                "Recovered relay routes from trusted Bonjour bridge",
                event: .discover,
                route: transportKind(forRelayURL: info.relayURL)
            )
        }

        let expectedRemoteKey = info.bridgePublicKeyData
        guard expectedRemoteKey.count == 32 else {
            throw BridgeConnectionError.noTrustedBridge
        }
        guard ScoutIdentity.isTrustedBridge(publicKey: expectedRemoteKey) else {
            await connectionLogHandle.log("Bridge identity is no longer trusted", event: .trust, level: .error)
            throw BridgeConnectionError.noTrustedBridge
        }

        let relayURLs = await assembleRelayCandidates(for: info)
        guard !relayURLs.isEmpty else {
            await connectionLogHandle.log("No relay routes available", event: .routeUnavailable, level: .error)
            throw BridgeConnectionError.noRelayCandidates
        }

        let attempt = try await connectUsingAvailableRelayURLs(
            relayURLs: relayURLs,
            initialRoomId: info.roomId,
            publicKeyHex: info.publicKeyHex,
            expectedRemoteKey: expectedRemoteKey,
            remoteStaticKey: expectedRemoteKey,        // IK pattern — reconnect to known bridge
            staticKey: keyPair
        )

        let persistedRelayURLs = relayURLsPromotingSuccessfulRelay(attempt.relayURL, within: relayURLs)
        let updated = BridgeConnectionInfo(
            relayURL: persistedRelayURLs.first ?? attempt.relayURL,
            roomId: attempt.roomId,
            publicKeyHex: info.publicKeyHex,
            fallbackRelayURLs: Array(persistedRelayURLs.dropFirst()),
            webPort: info.webPort
        )
        updated.save(userDefaults: userDefaults, promoteActive: target == nil)
        lock.withLockVoid {
            connectionInfo = updated
            _isConnected = true
            _currentRoute = transportKind(forRelayURL: attempt.relayURL)
            _currentHost = URLComponents(string: attempt.relayURL)?.host
        }

        try? ScoutIdentity.touchTrustedBridge(publicKey: attempt.remoteKey)

        await connectionLogHandle.log(
            "Connected via \(transportKind(forRelayURL: attempt.relayURL).label) \(attempt.relayURL)",
            event: .connected,
            level: .success,
            route: transportKind(forRelayURL: attempt.relayURL)
        )

        startMessageLoop(generation: generation)
    }

    /// First-time pair to a bridge via a scanned QR payload (Noise XX handshake).
    ///
    /// Unlike `connect()` (IK reconnect to an already-trusted bridge), pairing has
    /// no prior knowledge of the bridge's static key — it learns it from the XX
    /// handshake and then persists trust. Relay candidates come from the QR
    /// (`orderedRelayURLs`), prepended with any Bonjour-discovered LAN relays so
    /// local pairing works. The QR's room is used directly (the `/resolve`
    /// endpoint isn't valid before pairing).
    public func pair(qrPayload: QRPayload, primaryName: String?) async throws {
        let generation = nextConnectionGeneration()
        let keyPair: NoiseKeyPair
        do {
            keyPair = try ScoutIdentity.loadOrCreateIdentity()
        } catch {
            throw BridgeConnectionError.identityError(error.localizedDescription)
        }

        if let err = qrPayload.validate() {
            await connectionLogHandle.log("Invalid QR payload: \(err)", event: .pairing, level: .error)
            throw BridgeConnectionError.handshakeFailed(err)
        }

        let expectedRemoteKey = qrPayload.bridgePublicKeyData
        guard expectedRemoteKey.count == 32 else {
            throw BridgeConnectionError.handshakeFailed("Invalid bridge public key length")
        }

        // Candidate relays: Bonjour LAN first (local pairing is supported), then
        // the QR's ordered relay URLs, route-filtered and deduplicated.
        let discovered = await BonjourRelayDiscovery.discoverRelayURLs(publicKeyHex: qrPayload.publicKey)
        let storedRelayURLs = qrPayload.orderedRelayURLs
        let relayURLs = orderedPairingRelayCandidates(
            discoveredRelayURLs: discovered,
            payloadRelayURLs: storedRelayURLs,
            userDefaults: userDefaults
        )
        await logRelayCandidateDiagnostics(
            context: "Pairing",
            discoveredRelayURLs: discovered,
            storedRelayURLs: storedRelayURLs,
            candidates: relayURLs
        )
        guard !relayURLs.isEmpty else {
            await connectionLogHandle.log("No relay routes available for pairing", event: .routeUnavailable, level: .error)
            throw BridgeConnectionError.noRelayCandidates
        }

        await connectionLogHandle.log(
            "Pairing via QR (XX): room=\(qrPayload.room)",
            event: .pairing,
            route: transportKind(forRelayURL: relayURLs[0])
        )

        let attempt = try await connectUsingAvailableRelayURLs(
            relayURLs: relayURLs,
            initialRoomId: qrPayload.room,
            publicKeyHex: qrPayload.publicKey,
            expectedRemoteKey: expectedRemoteKey,
            remoteStaticKey: nil,                 // XX pattern — no prior key
            staticKey: keyPair,
            resolveRoomBeforeConnect: false       // use the QR's room directly
        )

        // XX handshake succeeded and the learned key matched the QR — trust it.
        // Label the record with the Mac's own advertised name (its relay host),
        // not the phone's device name.
        let learnedName = URLComponents(string: attempt.relayURL)?.host.map {
            $0.hasSuffix(".local") ? String($0.dropLast(6)) : $0
        }
        try ScoutIdentity.saveTrustedBridge(publicKey: attempt.remoteKey, name: learnedName ?? primaryName)

        let publicKeyHex = hexString(attempt.remoteKey)
        let persistedRelayURLs = relayURLsPromotingSuccessfulRelay(attempt.relayURL, within: relayURLs)
        let info = BridgeConnectionInfo(
            relayURL: persistedRelayURLs.first ?? attempt.relayURL,
            roomId: attempt.roomId,
            publicKeyHex: publicKeyHex,
            fallbackRelayURLs: Array(persistedRelayURLs.dropFirst()),
            webPort: qrPayload.webPort
        )
        info.save(userDefaults: userDefaults, promoteActive: true)

        let route = transportKind(forRelayURL: attempt.relayURL)
        lock.withLockVoid {
            connectionInfo = info
            _isConnected = true
            _currentRoute = route
            _currentHost = URLComponents(string: attempt.relayURL)?.host
        }

        await connectionLogHandle.log(
            "Paired via \(route.label) \(attempt.relayURL)",
            event: .connected,
            level: .success,
            route: route
        )

        startMessageLoop(generation: generation)
    }

    /// Tear down the connection and all streams.
    public func disconnect() {
        lock.lock()
        connectionGeneration += 1
        let activeTransport = transport
        let activeWebSocket = webSocket
        let activeReceive = receiveTask
        transport = nil
        webSocket = nil
        receiveTask = nil
        _isConnected = false
        _currentRoute = .none
        _currentHost = nil
        let events = Array(eventFanout.values)
        let tails = Array(tailFanout.values)
        let mobileChanges = Array(mobileConversationChangeFanout.values)
        eventFanout.removeAll()
        tailFanout.removeAll()
        mobileConversationChangeFanout.removeAll()
        lock.unlock()

        activeReceive?.cancel()
        activeTransport?.shutdown()
        activeWebSocket?.cancel(with: .goingAway, reason: nil)
        cancelAllPendingRequests(with: BridgeConnectionError.notConnected)
        events.forEach { $0.finish() }
        tails.forEach { $0.finish() }
        mobileChanges.forEach { $0.finish() }
    }

    // MARK: - Relay candidate assembly (distilled from relayURLsForTrustedBridge)

    private func assembleRelayCandidates(for info: BridgeConnectionInfo) async -> [String] {
        let discovered = await BonjourRelayDiscovery.discoverRelayURLs(publicKeyHex: info.publicKeyHex)
        let candidates = orderedRelayCandidates(
            discoveredRelayURLs: discovered,
            storedRelayURLs: info.relayURLs,
            userDefaults: userDefaults
        )
        await logRelayCandidateDiagnostics(
            context: "Reconnect",
            discoveredRelayURLs: discovered,
            storedRelayURLs: info.relayURLs,
            candidates: candidates
        )
        return candidates
    }

    private func savedConnectionInfoForTarget() -> BridgeConnectionInfo? {
        if let target {
            return BridgeConnectionInfo.load(publicKeyHex: target.publicKeyHex, userDefaults: userDefaults)
        }
        return BridgeConnectionInfo.loadActive(userDefaults: userDefaults)
    }

    private func discoveredConnectionInfoFromTrustedBridge() async -> BridgeConnectionInfo? {
        guard let bridge = currentTrustedBridge() else {
            return nil
        }

        let relayURLs = await BonjourRelayDiscovery.discoverRelayURLs(publicKeyHex: bridge.publicKeyHex)
        guard let primary = relayURLs.first else {
            return nil
        }

        return BridgeConnectionInfo(
            relayURL: primary,
            roomId: "",
            publicKeyHex: bridge.publicKeyHex,
            fallbackRelayURLs: Array(relayURLs.dropFirst())
        )
    }

    private func currentTrustedBridge() -> TrustedBridge? {
        let bridges = (try? ScoutIdentity.getTrustedBridges()) ?? []
        guard !bridges.isEmpty else { return nil }

        let preferredKey = target?.publicKeyHex
            ?? BridgeConnectionInfo.activePublicKeyHex(userDefaults: userDefaults)
        if let expectedKey = preferredKey?.lowercased(),
           let matched = bridges.first(where: { $0.publicKeyHex.lowercased() == expectedKey }) {
            return matched
        }

        if target != nil {
            return nil
        }

        return bridges.sorted { lhs, rhs in
            let left = lhs.lastSeen ?? lhs.pairedAt
            let right = rhs.lastSeen ?? rhs.pairedAt
            return left > right
        }.first
    }

    // MARK: - Candidate iteration (distilled from connectUsingAvailableRelayURLs)

    private func connectUsingAvailableRelayURLs(
        relayURLs: [String],
        initialRoomId: String,
        publicKeyHex: String,
        expectedRemoteKey: Data,
        remoteStaticKey: Data?,
        staticKey: NoiseKeyPair,
        resolveRoomBeforeConnect: Bool = true
    ) async throws -> RelayConnectionAttempt {
        var lastError: Error?
        var sawBridgeOffline = false
        var sawTailscaleUnavailable = false

        for (index, relayURL) in relayURLs.enumerated() {
            var roomId = initialRoomId
            let route = transportKind(forRelayURL: relayURL)
            await connectionLogHandle.log(
                "Trying \(route.label) route \(index + 1)/\(relayURLs.count): \(relayURL)",
                event: index == 0 ? .resolve : .fallback,
                route: route
            )

            // Resolve the bridge's current room before connecting (handles a
            // bridge restart that rotated the room id). During first-time QR
            // pairing the /resolve endpoint isn't valid yet, so we skip it and
            // use the QR's room directly.
            if resolveRoomBeforeConnect {
                let resolved = await resolveRoom(relayURL: relayURL, publicKeyHex: publicKeyHex)
                switch resolved {
                case .resolved(let resolvedRoomId):
                    roomId = resolvedRoomId
                    await connectionLogHandle.log(
                        "Resolved current room on \(route.label)",
                        event: .resolve,
                        route: route
                    )
                case .bridgeOffline:
                    await connectionLogHandle.log(
                        "\(route.label) relay reachable but bridge absent",
                        event: .routeUnavailable,
                        level: .warning,
                        route: route
                    )
                    sawBridgeOffline = true
                    lastError = BridgeConnectionError.relayUnavailable
                    continue
                case .tailscaleUnavailable:
                    await connectionLogHandle.log(
                        "Tailscale route is unavailable",
                        event: .routeUnavailable,
                        level: .warning,
                        route: route
                    )
                    sawTailscaleUnavailable = true
                    lastError = BridgeConnectionError.tailscaleUnavailable
                    continue
                case .relayUnavailable:
                    await connectionLogHandle.log(
                        "Resolve unavailable; trying saved room",
                        event: .fallback,
                        level: .warning,
                        route: route
                    )
                    break
                }
            }

            do {
                await connectionLogHandle.log(
                    "Starting \(remoteStaticKey == nil ? "XX" : "IK") handshake on \(route.label)",
                    event: .handshake,
                    route: route
                )
                let remoteKey = try await performConnection(
                    relayURL: relayURL,
                    roomId: roomId,
                    remoteStaticKey: remoteStaticKey,
                    staticKey: staticKey
                )

                guard remoteKey == expectedRemoteKey else {
                    clearFailedConnectionAttempt()
                    await connectionLogHandle.log(
                        "\(route.label) bridge key mismatch",
                        event: .handshake,
                        level: .warning,
                        route: route
                    )
                    lastError = BridgeConnectionError.handshakeFailed("Bridge identity did not match trusted key")
                    continue
                }

                await connectionLogHandle.log(
                    "Handshake OK on \(route.label) \(relayURL)",
                    event: .handshake,
                    level: .success,
                    route: route
                )
                return RelayConnectionAttempt(relayURL: relayURL, roomId: roomId, remoteKey: remoteKey)
            } catch {
                clearFailedConnectionAttempt()
                if relayURLDependsOnTailscale(relayURL) && isTailscaleRouteNetworkFailure(error) {
                    sawTailscaleUnavailable = true
                    lastError = BridgeConnectionError.tailscaleUnavailable
                    await connectionLogHandle.log(
                        "Tailscale route failed: \(error.localizedDescription)",
                        event: .routeUnavailable,
                        level: .warning,
                        route: route
                    )
                } else {
                    lastError = error
                    await connectionLogHandle.log(
                        "\(route.label) route failed: \(error.localizedDescription)",
                        event: .routeUnavailable,
                        level: .warning,
                        route: route
                    )
                }
            }
        }

        if sawBridgeOffline {
            throw BridgeConnectionError.relayUnavailable
        }
        if sawTailscaleUnavailable {
            throw BridgeConnectionError.tailscaleUnavailable
        }
        throw lastError ?? BridgeConnectionError.relayUnavailable
    }

    private func clearFailedConnectionAttempt() {
        lock.lock()
        let activeTransport = transport
        let activeWebSocket = webSocket
        transport = nil
        webSocket = nil
        lock.unlock()
        activeTransport?.shutdown()
        activeWebSocket?.cancel(with: .goingAway, reason: nil)
    }

    private func nextConnectionGeneration() -> Int {
        lock.withLockReturning {
            connectionGeneration += 1
            return connectionGeneration
        }
    }

    // MARK: - Room resolution (distilled from resolveRoom)

    private func resolveRoom(relayURL: String, publicKeyHex: String) async -> ResolveRoomResult {
        let httpURL = relayURL
            .replacingOccurrences(of: "wss://", with: "https://")
            .replacingOccurrences(of: "ws://", with: "http://")
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))

        guard let url = URL(string: "\(httpURL)/resolve") else { return .relayUnavailable }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 3
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONEncoder().encode(["bridgePublicKey": publicKeyHex])

        do {
            let (data, response) = try await urlSession.data(for: request)
            guard let http = response as? HTTPURLResponse else { return .relayUnavailable }
            switch http.statusCode {
            case 200:
                let result = try JSONDecoder().decode([String: String].self, from: data)
                guard let room = result["room"]?.trimmingCharacters(in: .whitespacesAndNewlines),
                      !room.isEmpty else {
                    return .relayUnavailable
                }
                return .resolved(room)
            case 404:
                return .bridgeOffline
            default:
                return .relayUnavailable
            }
        } catch {
            let route = transportKind(forRelayURL: relayURL)
            await connectionLogHandle.log(
                "Resolve failed detail: \(detailedErrorDescription(error))",
                event: .resolve,
                level: .warning,
                route: route
            )
            if relayURLDependsOnTailscale(relayURL) && isTailscaleRouteNetworkFailure(error) {
                return .tailscaleUnavailable
            }
            return .relayUnavailable
        }
    }

    // MARK: - Handshake (distilled from performConnection)

    private func performConnection(
        relayURL: String,
        roomId: String,
        remoteStaticKey: Data?,
        staticKey: NoiseKeyPair
    ) async throws -> Data {
        guard var components = URLComponents(string: relayURL) else {
            throw BridgeConnectionError.handshakeFailed("Invalid relay URL")
        }
        components.queryItems = [
            URLQueryItem(name: "room", value: roomId),
            URLQueryItem(name: "role", value: "client"),
        ]
        guard let url = components.url else {
            throw BridgeConnectionError.handshakeFailed("Failed to construct relay URL")
        }

        let route = transportKind(forRelayURL: relayURL)
        await connectionLogHandle.log(
            "Opening WebSocket \(url.absoluteString)",
            event: .network,
            route: route
        )

        let ws = urlSession.webSocketTask(with: url)
        ws.resume()
        lock.withLockVoid { webSocket = ws }

        let newTransport = SecureTransport(staticKey: staticKey)
        lock.withLockVoid { transport = newTransport }

        let remoteKeyBox = KeyBox()
        newTransport.onReady = { key in remoteKeyBox.set(key) }

        do {
            try await newTransport.performHandshake(
                webSocket: ws,
                remoteStaticKey: remoteStaticKey
            )
        } catch {
            let detail = detailedErrorDescription(error)
            await connectionLogHandle.log(
                "Handshake failed detail: \(detail)",
                event: .handshake,
                level: .warning,
                route: route
            )
            throw BridgeConnectionError.handshakeFailed(detail)
        }

        guard newTransport.isReady, let remoteKey = remoteKeyBox.get() else {
            throw BridgeConnectionError.handshakeFailed("Transport not ready after handshake")
        }
        return remoteKey
    }

    // MARK: - Message loop + routing (distilled from startMessageLoop / handleDecryptedMessage)

    private func startMessageLoop(generation: Int) {
        lock.lock()
        let activeTransport = transport
        receiveTask?.cancel()
        lock.unlock()
        guard let activeTransport else { return }

        let task = Task { [weak self] in
            for await message in activeTransport.receive() {
                self?.handleDecryptedMessage(message)
            }
            self?.markDisconnected(generation: generation, reason: "transport stream ended")
        }
        lock.lock()
        receiveTask = task
        lock.unlock()
    }

    private func markDisconnected(generation: Int, reason: String) {
        let result = lock.withLockReturning { () -> (BridgeConnectionDisconnectEvent?, SecureTransport?, URLSessionWebSocketTask?, BridgeConnectionDisconnectHandler?) in
            guard generation == connectionGeneration, _isConnected else {
                return (nil, nil, nil, nil)
            }
            let event = BridgeConnectionDisconnectEvent(
                publicKeyHex: connectionInfo?.publicKeyHex,
                route: _currentRoute,
                host: _currentHost,
                reason: reason
            )
            let activeTransport = transport
            let activeWebSocket = webSocket
            transport = nil
            webSocket = nil
            receiveTask = nil
            _isConnected = false
            _currentRoute = .none
            _currentHost = nil
            return (event, activeTransport, activeWebSocket, disconnectHandler)
        }

        guard let event = result.0 else {
            return
        }
        result.1?.shutdown()
        result.2?.cancel(with: .goingAway, reason: nil)
        Task {
            await connectionLogHandle.log(
                "Connection dropped: \(event.reason)",
                event: .reconnect,
                level: .warning,
                route: event.route == .none ? nil : event.route
            )
        }
        if let handler = result.3 {
            Task { @MainActor in
                handler(event)
            }
        }
        cancelAllPendingRequests(with: BridgeConnectionError.notConnected)
    }

    private func handleDecryptedMessage(_ raw: String) {
        // tRPC keep-alive (plain text, not JSON).
        if raw == "PING" {
            Task { [weak self] in try? await self?.sendRaw("PONG") }
            return
        }
        if raw == "PONG" { return }

        guard let data = raw.data(using: .utf8) else { return }

        // tRPC response (has integer "id" field).
        if let response = try? JSONDecoder().decode(TRPCResponse.self, from: data) {
            handleTRPCResponse(response)
            return
        }

        // Sequenced conversation event (has "seq" and "event").
        if let sequenced = try? JSONDecoder().decode(SequencedEvent.self, from: data) {
            fanoutEvent(sequenced)
            return
        }

        // Mobile broker conversation invalidation (message posted / lifecycle changed in broker comms).
        if let change = try? JSONDecoder().decode(MobileConversationChangeEvent.self, from: data),
           change.event == "mobile:conversation:changed" || change.event == "mobile:conversation:lifecycle" {
            fanoutMobileConversationChange(change)
            return
        }

        // Tail firehose event (disjoint required fields — `source`, `pid`, no `seq`).
        if let wire = try? JSONDecoder().decode(WireTailEvent.self, from: data) {
            fanoutTailEvent(wire.toCapability())
            return
        }
    }

    private func handleTRPCResponse(_ response: TRPCResponse) {
        let pending = lock.withLockReturning { pendingRequests.removeValue(forKey: response.id) }

        // Subscription data with no pending request — a streamed event.
        if pending == nil, let result = response.result, result.type == "data", let eventData = result.data {
            if let encoded = try? JSONEncoder().encode(eventData) {
                if let sequenced = try? JSONDecoder().decode(SequencedEvent.self, from: encoded) {
                    fanoutEvent(sequenced)
                    return
                }
                if let wire = try? JSONDecoder().decode(WireTailEvent.self, from: encoded) {
                    fanoutTailEvent(wire.toCapability())
                    return
                }
            }
            return
        }

        guard let pending else { return }  // started/stopped acks or unknown ids — ignore.

        pending.timeoutTask.cancel()

        if let error = response.error {
            pending.continuation.resume(
                throwing: BridgeConnectionError.rpcError(code: error.code, message: error.message)
            )
        } else if let result = response.result, let resultData = result.data {
            if let encoded = try? JSONEncoder().encode(resultData) {
                pending.continuation.resume(returning: encoded)
            } else {
                pending.continuation.resume(
                    throwing: BridgeConnectionError.decodingFailed("Failed to re-encode tRPC result.data")
                )
            }
        } else {
            // Null/empty success — hand back an empty object for void callers.
            pending.continuation.resume(returning: Data("{}".utf8))
        }
    }

    // MARK: - Fan-out

    private func fanoutEvent(_ event: SequencedEvent) {
        let continuations = lock.withLockReturning { Array(eventFanout.values) }
        continuations.forEach { $0.yield(event) }
    }

    private func fanoutTailEvent(_ event: TailEvent) {
        let continuations = lock.withLockReturning { Array(tailFanout.values) }
        continuations.forEach { $0.yield(event) }
    }

    private func fanoutMobileConversationChange(_ event: MobileConversationChangeEvent) {
        let continuations = lock.withLockReturning { Array(mobileConversationChangeFanout.values) }
        continuations.forEach { $0.yield(event) }
    }

    /// Live conversation events. Callers filter by conversation id.
    public func events() -> AsyncStream<SequencedEvent> {
        let id = UUID()
        return AsyncStream { continuation in
            lock.lock(); eventFanout[id] = continuation; lock.unlock()
            continuation.onTermination = { [weak self] _ in
                self?.lock.lock(); self?.eventFanout.removeValue(forKey: id); self?.lock.unlock()
            }
        }
    }

    /// Tail firehose events.
    public func tail() -> AsyncStream<TailEvent> {
        let id = UUID()
        return AsyncStream { continuation in
            lock.lock(); tailFanout[id] = continuation; lock.unlock()
            continuation.onTermination = { [weak self] _ in
                self?.lock.lock(); self?.tailFanout.removeValue(forKey: id); self?.lock.unlock()
            }
        }
    }

    /// Broker-backed mobile conversation invalidations.
    public func mobileConversationChanges() -> AsyncStream<MobileConversationChangeEvent> {
        let id = UUID()
        return AsyncStream { continuation in
            lock.lock(); mobileConversationChangeFanout[id] = continuation; lock.unlock()
            continuation.onTermination = { [weak self] _ in
                self?.lock.lock(); self?.mobileConversationChangeFanout.removeValue(forKey: id); self?.lock.unlock()
            }
        }
    }

    // MARK: - RPC (distilled from sendRPC + handleTRPCResponse)

    /// Send a tRPC request by donor method name and decode the unwrapped result.
    public func rpc<Res: Decodable>(_ method: String, params: (any Encodable & Sendable)?) async throws -> Res {
        let data = try await sendRPC(method: method, params: params)
        do {
            return try JSONDecoder().decode(Res.self, from: data)
        } catch {
            throw BridgeConnectionError.decodingFailed("Expected \(Res.self): \(error.localizedDescription)")
        }
    }

    private func sendRPC(method: String, params: (any Encodable & Sendable)?) async throws -> Data {
        let (activeTransport, generation) = lock.withLockReturning { (transport, connectionGeneration) }
        guard let activeTransport, activeTransport.isReady else {
            throw BridgeConnectionError.notConnected
        }
        guard let route = trpcRouteMap[method] else {
            throw BridgeConnectionError.encodingFailed
        }

        let requestId = allocateRequestId()
        let request = TRPCRequest(id: requestId, method: route.method, path: route.path, input: params)

        guard let jsonData = try? JSONEncoder().encode(request),
              let jsonString = String(data: jsonData, encoding: .utf8) else {
            throw BridgeConnectionError.encodingFailed
        }

        return try await withCheckedThrowingContinuation { continuation in
            let timeoutTask = Task { [weak self] in
                let timeout: TimeInterval = (method == "mobile/session/create")
                    ? Self.createSessionTimeout
                    : Self.rpcTimeout
                try? await Task.sleep(for: .seconds(timeout))
                guard !Task.isCancelled else { return }
                let removed = self?.lock.withLockReturning { self?.pendingRequests.removeValue(forKey: requestId) ?? nil }
                if removed != nil {
                    continuation.resume(throwing: BridgeConnectionError.rpcTimeout(method: method))
                }
            }

            let pending = PendingRequest(method: method, continuation: continuation, timeoutTask: timeoutTask)
            lock.lock(); pendingRequests[requestId] = pending; lock.unlock()

            Task {
                do {
                    try await activeTransport.send(jsonString)
                } catch {
                    let removed = self.lock.withLockReturning { self.pendingRequests.removeValue(forKey: requestId) }
                    if removed != nil {
                        timeoutTask.cancel()
                        continuation.resume(throwing: error)
                    }
                    self.markDisconnected(generation: generation, reason: "send failed: \(error.localizedDescription)")
                }
            }
        }
    }

    private func sendRaw(_ message: String) async throws {
        let activeTransport = lock.withLockReturning { transport }
        guard let activeTransport else { throw BridgeConnectionError.notConnected }
        try await activeTransport.send(message)
    }

    private func allocateRequestId() -> Int {
        lock.lock(); defer { lock.unlock() }
        let current = nextRequestId
        nextRequestId += 1
        return current
    }

    private func cancelAllPendingRequests(with error: Error) {
        let requests = lock.withLockReturning { () -> [Int: PendingRequest] in
            let copy = pendingRequests
            pendingRequests.removeAll()
            return copy
        }
        for (_, pending) in requests {
            pending.timeoutTask.cancel()
            pending.continuation.resume(throwing: error)
        }
    }
}

// MARK: - Lock helper

private extension NSLock {
    func withLockReturning<T>(_ body: () -> T) -> T {
        lock(); defer { unlock() }
        return body()
    }

    func withLockVoid(_ body: () -> Void) {
        lock(); defer { unlock() }
        body()
    }
}

private extension BridgeConnection {
    func logRelayCandidateDiagnostics(
        context: String,
        discoveredRelayURLs: [String],
        storedRelayURLs: [String],
        candidates: [String]
    ) async {
        await connectionLogHandle.log(
            "\(context) relay inputs: discovered=\(formatRelayURLs(discoveredRelayURLs)) stored=\(formatRelayURLs(storedRelayURLs))",
            event: .discover
        )
        await connectionLogHandle.log(
            "Route prefs: LAN=\(routingSettingLabel(lanRoutingEnabled(userDefaults: userDefaults))) TSN=\(routingSettingLabel(tailnetRoutingEnabled(userDefaults: userDefaults))) OSN=\(routingSettingLabel(openScoutNetworkRoutingEnabled(userDefaults: userDefaults)))",
            event: .resolve
        )

        let disabled = (discoveredRelayURLs + storedRelayURLs).filter {
            !relayURLAllowedByRouteSettings($0, userDefaults: userDefaults)
        }
        if !disabled.isEmpty {
            await connectionLogHandle.log(
                "Filtered by route prefs: \(formatRelayURLs(disabled))",
                event: .routeDisabled,
                level: .warning
            )
        }

        await connectionLogHandle.log(
            "\(context) candidates \(candidates.count): \(formatRelayURLs(candidates))",
            event: .resolve,
            route: candidates.first.map(transportKind(forRelayURL:))
        )
    }
}

private func routingSettingLabel(_ enabled: Bool) -> String {
    enabled ? "on" : "off"
}

private func formatRelayURLs(_ urls: [String], limit: Int = 8) -> String {
    if urls.isEmpty { return "none" }
    let rendered = urls.prefix(limit).enumerated().map { index, url in
        "\(index + 1):\(transportKind(forRelayURL: url).label)=\(url)"
    }
    let remainder = urls.count - rendered.count
    if remainder > 0 {
        return "\(rendered.joined(separator: ", ")) +\(remainder) more"
    }
    return rendered.joined(separator: ", ")
}

private func detailedErrorDescription(_ error: Error) -> String {
    if let bridgeError = error as? BridgeConnectionError {
        return bridgeError.localizedDescription
    }

    let nsError = error as NSError
    var parts = [error.localizedDescription]
    var domainCode = "\(nsError.domain) code=\(nsError.code)"
    if let urlCode = urlErrorCodeLabel(nsError) {
        domainCode += " \(urlCode)"
    }
    parts.append(domainCode)

    if let failingURL = nsError.userInfo[NSURLErrorFailingURLErrorKey] as? URL {
        parts.append("url=\(failingURL.absoluteString)")
    } else if let failingURL = nsError.userInfo[NSURLErrorFailingURLStringErrorKey] as? String {
        parts.append("url=\(failingURL)")
    }

    if let underlying = nsError.userInfo[NSUnderlyingErrorKey] as? Error {
        parts.append("underlying={\(detailedErrorDescription(underlying))}")
    }

    let uniqueParts = (Array(NSOrderedSet(array: parts)) as? [String]) ?? parts
    return uniqueParts.joined(separator: " | ")
}

private func urlErrorCodeLabel(_ error: NSError) -> String? {
    guard error.domain == NSURLErrorDomain else { return nil }
    switch URLError.Code(rawValue: error.code) {
    case .timedOut: return "timedOut"
    case .cannotFindHost: return "cannotFindHost"
    case .cannotConnectToHost: return "cannotConnectToHost"
    case .dnsLookupFailed: return "dnsLookupFailed"
    case .networkConnectionLost: return "networkConnectionLost"
    case .notConnectedToInternet: return "notConnectedToInternet"
    case .appTransportSecurityRequiresSecureConnection: return "ATSRequiresSecureConnection"
    case .secureConnectionFailed: return "secureConnectionFailed"
    case .serverCertificateUntrusted: return "serverCertificateUntrusted"
    default: return nil
    }
}

// MARK: - ConnectionLogHandle (MainActor hop)

/// A Sendable handle around the `@MainActor ConnectionLog` so the off-main
/// connection actor can append entries without capturing a non-Sendable ref.
public struct ConnectionLogHandle: Sendable {
    public let log: ConnectionLog

    public init(_ log: ConnectionLog) {
        self.log = log
    }

    func log(
        _ message: String,
        event: ConnectionLogEvent = .lifecycle,
        level: ConnectionLogLevel = .info,
        route: TransportKind? = nil
    ) async {
        await MainActor.run {
            log.log(message, event: event, level: level, route: route)
        }
    }
}

// MARK: - Wire tail event (donor TailEvent.swift) → ScoutCapabilities.TailEvent

/// Broker message invalidation pushed over the mobile bridge when the Scout
/// broker posts a comms message. The iOS surface uses this as a lightweight
/// prompt to refresh the authoritative conversation snapshot.
public struct MobileConversationChangeEvent: Codable, Sendable, Equatable {
    public let event: String
    public let conversationId: String
    public let messageId: String?
    public let clientMessageId: String?
    public let invocationId: String?
    public let flightId: String?
    public let targetAgentId: String?
    public let lifecycleState: String?
    public let summary: String?
    public let error: String?
}

/// The bridge's tail firehose JSON (mirrors apps/ios/Scout/Models/TailEvent.swift
/// and packages/web/server/core/tail/types.ts). Its field shape and the harness
/// raw values differ from `ScoutCapabilities.TailEvent`, so we decode the wire
/// here and map.
private struct WireTailEvent: Codable, Sendable {
    enum Harness: String, Codable, Sendable {
        case scoutManaged = "scout-managed"
        case hudsonManaged = "hudson-managed"
        case unattributed
    }
    enum Kind: String, Codable, Sendable {
        case user, assistant, tool
        case toolResult = "tool-result"
        case system, other
    }

    let id: String
    let ts: Int
    let source: String
    let sessionId: String
    let pid: Int
    let parentPid: Int?
    let project: String
    let cwd: String
    let harness: Harness
    let kind: Kind
    let summary: String

    func toCapability() -> TailEvent {
        let mappedHarness: TailEvent.Harness
        switch harness {
        case .scoutManaged: mappedHarness = .scoutManaged
        case .hudsonManaged: mappedHarness = .hudsonManaged
        case .unattributed: mappedHarness = .unattributed
        }
        let mappedKind: TailEvent.Kind
        switch kind {
        case .user: mappedKind = .user
        case .assistant: mappedKind = .assistant
        case .tool: mappedKind = .tool
        case .toolResult: mappedKind = .toolResult
        case .system: mappedKind = .system
        case .other: mappedKind = .other
        }
        return TailEvent(
            id: id,
            tsMs: Int64(scoutEpochMilliseconds(ts)),
            source: source,
            harness: mappedHarness,
            kind: mappedKind,
            summary: summary,
            conversationId: sessionId.trimmedNonEmpty
        )
    }
}

// MARK: - Sendable boxes / helpers (ported from donor)

/// Lowercased hex encoding of raw bytes (ported from the donor's `hexString`).
func hexString(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
}

/// Thread-safe box for capturing the remote static key from the
/// SecureTransport.onReady callback.
private final class KeyBox: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Data?
    func set(_ data: Data) { lock.lock(); value = data; lock.unlock() }
    func get() -> Data? { lock.lock(); defer { lock.unlock() }; return value }
}

/// Accept self-signed certs on LAN relays (ported from donor).
private final class TrustAllDelegate: NSObject, URLSessionDelegate {
    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        if let trust = challenge.protectionSpace.serverTrust {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.performDefaultHandling, nil)
        }
    }
}
