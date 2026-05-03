// ConnectionManager — WebSocket + Noise encryption + RPC client for the Dispatch bridge.
//
// Manages the full lifecycle: connect via relay, perform Noise handshake,
// route decrypted messages (events → SessionStore, RPC responses → pending
// continuations), and expose typed async RPC methods.
//
// Uses SecureTransport from Security/SecureTransport.swift for Noise encryption,
// ScoutIdentity from Security/Identity.swift for Keychain-based key/trust storage,
// and QRPayload from Security/QRPayload.swift for pairing payload parsing.

import Foundation
import os
import UIKit

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

enum BridgeHealthState: Sendable, Equatable {
    case healthy
    case suspect
    case degraded
    case tailscaleUnavailable
    case offline
}

func normalizedConnectionDisplayHealth(
    state: ConnectionState,
    health: BridgeHealthState
) -> BridgeHealthState {
    switch state {
    case .connected:
        return (health == .offline || health == .tailscaleUnavailable) ? .healthy : health
    case .connecting, .handshaking, .reconnecting:
        return health == .offline ? .suspect : health
    case .disconnected, .failed:
        return health
    }
}

func relayURLIndicatesLocalOnlyTailscaleRoute(_ rawValue: String) -> Bool {
    guard let host = URLComponents(string: rawValue)?.host?.lowercased() else {
        return false
    }
    return isLocalOnlyRelayHost(host)
}

func relayURLUsesTailnetRoute(_ rawValue: String) -> Bool {
    guard let host = URLComponents(string: rawValue)?.host?.lowercased() else {
        return false
    }
    return isTailnetRelayHost(host)
}

func relayURLUsesOpenScoutNetworkRoute(_ rawValue: String) -> Bool {
    guard let host = URLComponents(string: rawValue)?.host?.lowercased() else {
        return false
    }
    return isOpenScoutNetworkRelayHost(host)
}

func tailnetRoutingEnabled(userDefaults: UserDefaults = .standard) -> Bool {
    if userDefaults.object(forKey: "scout.tsn.enabled") == nil {
        return true
    }
    return userDefaults.bool(forKey: "scout.tsn.enabled")
}

func openScoutNetworkRoutingEnabled(userDefaults: UserDefaults = .standard) -> Bool {
    userDefaults.bool(forKey: "scout.osn.enabled")
}

func relayURLAllowedByRouteSettings(_ rawValue: String, userDefaults: UserDefaults = .standard) -> Bool {
    if relayURLUsesTailnetRoute(rawValue) {
        return tailnetRoutingEnabled(userDefaults: userDefaults)
    }
    if relayURLUsesOpenScoutNetworkRoute(rawValue) {
        return openScoutNetworkRoutingEnabled(userDefaults: userDefaults)
    }
    return true
}

func relayURLsAllowedByRouteSettings(_ rawValues: [String], userDefaults: UserDefaults = .standard) -> [String] {
    rawValues.filter { relayURLAllowedByRouteSettings($0, userDefaults: userDefaults) }
}

func relayURLDependsOnTailscale(_ rawValue: String) -> Bool {
    relayURLUsesTailnetRoute(rawValue)
}

func deduplicatedRelayURLs(primary: String, fallbacks: [String]) -> [String] {
    var seen = Set<String>()
    var urls: [String] = []

    for rawValue in [primary] + fallbacks {
        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, seen.insert(value).inserted else {
            continue
        }
        urls.append(value)
    }

    return urls
}

func isTailscaleRouteNetworkFailure(_ error: Error) -> Bool {
    guard let urlError = error as? URLError else {
        return false
    }

    switch urlError.code {
    case .cannotFindHost,
         .cannotConnectToHost,
         .dnsLookupFailed,
         .networkConnectionLost,
         .notConnectedToInternet,
         .timedOut:
        return true
    default:
        return false
    }
}

private func isLocalOnlyRelayHost(_ host: String) -> Bool {
    host == "localhost"
        || host == "127.0.0.1"
        || host == "::1"
        || host == "0.0.0.0"
}

private func isTailnetRelayHost(_ host: String) -> Bool {
    host.hasSuffix(".ts.net") || isTailscaleAddress(host)
}

private func isOpenScoutNetworkRelayHost(_ host: String) -> Bool {
    host == "oscout.net" || host.hasSuffix(".oscout.net")
}

private func isTailscaleAddress(_ host: String) -> Bool {
    let components = host.split(separator: ".")
    guard components.count == 4,
          let first = Int(components[0]),
          let second = Int(components[1]) else {
        return false
    }
    return first == 100 && (64...127).contains(second)
}

// MARK: - Errors

enum ConnectionError: LocalizedError, Sendable {
    case notConnected
    case handshakeFailed(String)
    case rpcTimeout(method: String)
    case rpcError(code: Int, message: String)
    case invalidQRPayload(String)
    case bridgeOffline
    case relayUnavailable
    case tailscaleUnavailable
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
        case .bridgeOffline:
            return "Scout on your Mac appears to be offline"
        case .relayUnavailable:
            return "Scout can't reach the relay right now"
        case .tailscaleUnavailable:
            return "Scout cannot reach your Mac on the local network or through the saved Tailscale route."
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
            case .bridgeOffline, .reconnectExhausted:
                return "Your Mac looks offline or asleep. Open Scout on your Mac or wake it, then try again. Cached sessions on this iPhone stay available read-only."
            case .relayUnavailable:
                return "Scout can't reach the relay right now. Check your network connection and try again."
            case .tailscaleUnavailable:
                return "Scout cannot reach your Mac on the local network or through Tailscale. If you're nearby, allow Local Network access and make sure Scout is running on your Mac. If you're remote, open Tailscale on this iPhone and Mac."
            case .notConnected:
                return "Scout isn't connected to your Mac right now. Reconnect and try again."
            case .rpcTimeout:
                return "Scout on your Mac took too long to respond. It may be asleep or offline. Wake it and try again."
            case .rpcError(_, let message):
                if message.localizedCaseInsensitiveContains("not connected")
                    || message.localizedCaseInsensitiveContains("bridge")
                    || message.localizedCaseInsensitiveContains("relay is not reachable") {
                    return "Your Mac looks offline or asleep. Open Scout on your Mac or wake it, then try again. Cached sessions on this iPhone stay available read-only."
                }
                // Suppress raw server validation errors (e.g. Zod schema errors)
                if message.localizedCaseInsensitiveContains("expected object")
                    || message.localizedCaseInsensitiveContains("received undefined")
                    || message.localizedCaseInsensitiveContains("invalid type")
                    || message.localizedCaseInsensitiveContains("invalid input") {
                    return "Scout received an unexpected response from your Mac. Make sure Scout on your Mac is up to date."
                }
                return message
            case .handshakeFailed, .identityError:
                return "Scout couldn't establish a secure connection to your Mac. Reconnect and try again."
            case .invalidQRPayload:
                return connectionError.localizedDescription
            case .encodingFailed, .decodingFailed:
                return "Scout hit a transport error talking to your Mac. Try again."
            }
        }
        return localizedDescription
    }
}

struct ConnectionStatusDetails: Sendable {
    let shortLabel: String
    let title: String
    let message: String?
    let symbol: String
    let allowsRetry: Bool
}

// MARK: - Connection info (for reconnect)

/// Lightweight struct holding the relay/room info needed to reconnect.
/// The bridge's trust record (public key) lives in ScoutIdentity (Keychain).
struct BridgeConnectionInfo: Codable, Sendable {
    let relayURL: String
    var roomId: String      // Mutable — updated when room is resolved after bridge restart
    let publicKeyHex: String
    let fallbackRelayURLs: [String]

    init(
        relayURL: String,
        roomId: String,
        publicKeyHex: String,
        fallbackRelayURLs: [String] = []
    ) {
        self.relayURL = relayURL
        self.roomId = roomId
        self.publicKeyHex = publicKeyHex
        self.fallbackRelayURLs = Array(deduplicatedRelayURLs(primary: relayURL, fallbacks: fallbackRelayURLs).dropFirst())
    }

    enum CodingKeys: String, CodingKey {
        case relayURL
        case roomId
        case publicKeyHex
        case fallbackRelayURLs
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let relayURL = try container.decode(String.self, forKey: .relayURL)
        let fallbackRelayURLs = try container.decodeIfPresent([String].self, forKey: .fallbackRelayURLs) ?? []
        self.init(
            relayURL: relayURL,
            roomId: try container.decode(String.self, forKey: .roomId),
            publicKeyHex: try container.decode(String.self, forKey: .publicKeyHex),
            fallbackRelayURLs: fallbackRelayURLs
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
}

// MARK: - Transport classification

enum TransportKind: String {
    /// RFC1918 private LAN: 10/8, 192.168/16, 172.16-31/12; link-local 169.254/16.
    case lan
    /// Tailscale CGNAT 100.64.0.0/10 or `*.ts.net` MagicDNS host.
    case tailnet
    /// OpenScout-managed front door hosts.
    case oscout
    /// Public IP / generic DNS hostname — neither LAN, Tailnet, nor OpenScout Network.
    case remote
    /// 127.0.0.0/8 loopback (mostly bridge-to-self, rare from phone).
    case loopback
    /// Not connected or no host known.
    case none

    var label: String {
        switch self {
        case .lan: return "LAN"
        case .tailnet: return "TSN"
        case .oscout: return "OSN"
        case .remote: return "WAN"
        case .loopback: return "LOCAL"
        case .none: return ""
        }
    }
}

private func classifyTransport(host: String) -> TransportKind {
    let lower = host.lowercased()
    if lower == "localhost" {
        return .loopback
    }
    // Tailscale MagicDNS hostnames look like `<machine>.<tailnet>.ts.net`.
    if lower.hasSuffix(".ts.net") {
        return .tailnet
    }
    if isOpenScoutNetworkRelayHost(lower) {
        return .oscout
    }
    // Bonjour / mDNS hostnames (`<host>.local`) are by definition link-local LAN.
    if lower.hasSuffix(".local") {
        return .lan
    }

    let parts = host.split(separator: ".").compactMap { UInt8($0) }
    guard parts.count == 4 else {
        // Hostname or IPv6 we can't classify cheaply — fall through to remote.
        return .remote
    }

    let a = parts[0], b = parts[1]
    if a == 127 { return .loopback }
    if a == 10 { return .lan }
    if a == 192 && b == 168 { return .lan }
    if a == 172 && (16...31).contains(b) { return .lan }
    if a == 169 && b == 254 { return .lan }
    // Tailscale CGNAT: 100.64.0.0/10 → 100.64.x.x through 100.127.x.x.
    if a == 100 && (64...127).contains(b) { return .tailnet }
    return .remote
}

// MARK: - ConnectionManager

@Observable
final class ConnectionManager: @unchecked Sendable {

    // MARK: Observable state

    private(set) var state: ConnectionState = .disconnected
    private(set) var health: BridgeHealthState = .offline

    private func setState(_ newState: ConnectionState) {
        if Thread.isMainThread {
            state = newState
        } else {
            DispatchQueue.main.sync { state = newState }
        }
    }

    private func setHealth(_ newHealth: BridgeHealthState) {
        if Thread.isMainThread {
            health = newHealth
        } else {
            DispatchQueue.main.sync { health = newHealth }
        }
    }

    // MARK: Derived

    /// Best-effort bridge host for direct HTTP access (e.g., spectator, file server).
    /// Extracted from the relay URL — works when relay runs on the bridge machine.
    var bridgeHost: String? {
        guard let relayURL = activeRelayURL ?? connectionInfo?.relayURL,
              let components = URLComponents(string: relayURL),
              let host = components.host else { return nil }
        return host
    }

    /// Classified transport for the active relay host: LAN / TSN / OSN / WAN / loopback.
    /// `.none` while disconnected or when the host isn't known yet.
    var transportKind: TransportKind {
        guard state == .connected, let host = bridgeHost else { return .none }
        return classifyTransport(host: host)
    }

    /// File server HTTP port (bridge port + 2, default 7890).
    var bridgePort: Int? {
        // File server runs on bridge port + 2 (7889 is relay).
        // TODO: include file server port in bridge/status response
        return 7890
    }

    var pairedBridgeName: String? {
        currentTrustedBridge?.name?.trimmedNonEmpty
    }

    var pairedBridgeLastSeen: Date? {
        currentTrustedBridge?.lastSeen
    }

    var pairedBridgeFingerprint: String? {
        currentTrustedBridge?.publicKeyHex
    }

    var relayRoomId: String? {
        connectionInfo?.roomId.trimmedNonEmpty
    }

    var lastConnectedAtDate: Date? {
        lastConnectedAt
    }

    var lastSuccessfulRPCAtDate: Date? {
        lastSuccessfulRPCAt
    }

    var lastIncomingMessageAtDate: Date? {
        lastIncomingMessageAt
    }

    var statusDetails: ConnectionStatusDetails {
        if !hasTrustedBridge {
            return ConnectionStatusDetails(
                shortLabel: "Not Paired",
                title: "Not Paired",
                message: "Pair this iPhone with Scout on your Mac to browse live sessions.",
                symbol: "qrcode.viewfinder",
                allowsRetry: false
            )
        }

        let displayHealth = normalizedConnectionDisplayHealth(state: state, health: health)

        switch state {
        case .connected:
            switch displayHealth {
            case .suspect:
                return ConnectionStatusDetails(
                    shortLabel: "Checking Mac",
                    title: "Checking Your Mac",
                    message: "Scout is reconnecting and checking whether your Mac is reachable on the network.",
                    symbol: "arrow.triangle.2.circlepath",
                    allowsRetry: false
                )
            case .degraded:
                return ConnectionStatusDetails(
                    shortLabel: "Mac Reachable",
                    title: "Scout Not Responding",
                    message: "Your Mac is reachable, but Scout on your Mac is not responding yet. The app will keep retrying.",
                    symbol: "exclamationmark.triangle",
                    allowsRetry: true
                )
            case .healthy, .tailscaleUnavailable, .offline:
                break
            }
            return ConnectionStatusDetails(
                shortLabel: "Connected",
                title: "Connected",
                message: nil,
                symbol: "desktopcomputer",
                allowsRetry: false
            )
        case .connecting, .handshaking:
            return ConnectionStatusDetails(
                shortLabel: "Connecting",
                title: "Connecting to Your Mac",
                message: "Opening a secure connection to Scout on your Mac.",
                symbol: "arrow.triangle.2.circlepath",
                allowsRetry: false
            )
        case .reconnecting(let attempt):
            if displayHealth == .tailscaleUnavailable {
                return tailscaleUnavailableStatusDetails(allowsRetry: false)
            }
            let attemptSuffix = attempt > 1 ? " Attempt \(attempt) of \(Self.maxReconnectAttempts)." : ""
            return ConnectionStatusDetails(
                shortLabel: "Reconnecting",
                title: "Reconnecting to Your Mac",
                message: "Trying to reach Scout on your Mac again.\(attemptSuffix)",
                symbol: "arrow.triangle.2.circlepath",
                allowsRetry: false
            )
        case .disconnected:
            switch displayHealth {
            case .suspect:
                return ConnectionStatusDetails(
                    shortLabel: "Checking Mac",
                    title: "Checking Your Mac",
                    message: "Scout is reconnecting and checking whether your Mac is reachable on the network.",
                    symbol: "arrow.triangle.2.circlepath",
                    allowsRetry: false
                )
            case .degraded:
                return ConnectionStatusDetails(
                    shortLabel: "Mac Reachable",
                    title: "Scout Not Responding",
                    message: "Your Mac is reachable, but Scout on your Mac is not responding yet. The app will keep retrying.",
                    symbol: "exclamationmark.triangle",
                    allowsRetry: true
                )
            case .tailscaleUnavailable:
                return tailscaleUnavailableStatusDetails()
            case .offline:
                return ConnectionStatusDetails(
                    shortLabel: "Mac Offline",
                    title: "Mac Offline",
                    message: "Scout could not reach your Mac after retrying. It is probably offline, asleep, or on another network.",
                    symbol: "wifi.exclamationmark",
                    allowsRetry: true
                )
            case .healthy:
                break
            }
            return ConnectionStatusDetails(
                shortLabel: "Disconnected",
                title: "Disconnected",
                message: "Scout is disconnected from your Mac and checking whether it can reconnect.",
                symbol: "wifi.exclamationmark",
                allowsRetry: true
            )
        case .failed(let error):
            if let connectionError = error as? ConnectionError {
                switch connectionError {
                case .bridgeOffline, .reconnectExhausted:
                    return ConnectionStatusDetails(
                        shortLabel: "Mac Offline",
                        title: "Mac Offline",
                        message: error.scoutUserFacingMessage,
                        symbol: "wifi.exclamationmark",
                        allowsRetry: true
                    )
                case .tailscaleUnavailable:
                    return tailscaleUnavailableStatusDetails()
                case .rpcTimeout:
                    return ConnectionStatusDetails(
                        shortLabel: "Checking Mac",
                        title: "Checking Your Mac",
                        message: "Scout stopped hearing back from your Mac and is checking whether it is still reachable.",
                        symbol: "arrow.triangle.2.circlepath",
                        allowsRetry: false
                    )
                case .relayUnavailable:
                    return ConnectionStatusDetails(
                        shortLabel: "Relay Offline",
                        title: "Relay Unavailable",
                        message: error.scoutUserFacingMessage,
                        symbol: "exclamationmark.triangle",
                        allowsRetry: true
                    )
                case .handshakeFailed, .identityError:
                    return ConnectionStatusDetails(
                        shortLabel: "Secure Connect Failed",
                        title: "Secure Connection Failed",
                        message: error.scoutUserFacingMessage,
                        symbol: "lock.shield",
                        allowsRetry: true
                    )
                case .invalidQRPayload:
                    return ConnectionStatusDetails(
                        shortLabel: "Pairing Error",
                        title: "Pairing Error",
                        message: error.scoutUserFacingMessage,
                        symbol: "qrcode.viewfinder",
                        allowsRetry: false
                    )
                case .notConnected, .rpcError, .encodingFailed, .decodingFailed:
                    break
                }
            }

            return ConnectionStatusDetails(
                shortLabel: "Connection Failed",
                title: "Connection Failed",
                message: error.scoutUserFacingMessage,
                symbol: "exclamationmark.triangle",
                allowsRetry: hasTrustedBridge
            )
        }
    }

    private func tailscaleUnavailableStatusDetails(allowsRetry: Bool = true) -> ConnectionStatusDetails {
        ConnectionStatusDetails(
            shortLabel: "Mac Unreachable",
            title: "Mac Not Reachable",
            message: "Scout could not find your Mac on the local network or reach it through Tailscale. If you're nearby, allow Local Network access and keep Scout running on your Mac. If you're remote, open Tailscale on both devices.",
            symbol: "network.slash",
            allowsRetry: allowsRetry
        )
    }

    private var currentTrustedBridge: TrustedBridge? {
        let bridges = (try? ScoutIdentity.getTrustedBridges()) ?? []
        guard !bridges.isEmpty else { return nil }

        if let expectedKey = connectionInfo?.publicKeyHex.lowercased(),
           let matched = bridges.first(where: { $0.publicKeyHex.lowercased() == expectedKey }) {
            return matched
        }

        return bridges.sorted { lhs, rhs in
            let left = lhs.lastSeen ?? lhs.pairedAt
            let right = rhs.lastSeen ?? rhs.pairedAt
            return left > right
        }.first
    }

    // MARK: Dependencies

    private let sessionStore: SessionStore
    private let inboxStore: InboxStore

    // MARK: Internal state

    private var webSocket: URLSessionWebSocketTask?
    private var transport: SecureTransport?
    private var receiveTask: Task<Void, Never>?
    private var reconnectTask: ReconnectHandle?
    private let pendingRequests = OSAllocatedUnfairLock(initialState: [Int: PendingRequest]())
    private let urlSession: URLSession
    private let sessionDelegate = TrustAllDelegate()
    private var connectionInfo: BridgeConnectionInfo?
    private var activeRelayURL: String?
    private var isScreenshotPreview = false
    private var cachedRemotePushToken: String?
    private var identityKeyPair: NoiseKeyPair?
    private var manualDisconnectRequested = false
    private var lastSyncedPushRegistrationSignature: String?
    private var healthProbeTask: Task<Void, Never>?
    private var lastSuccessfulRPCAt: Date?
    private var lastIncomingMessageAt: Date?
    private var lastConnectedAt: Date?
    private var lastMachineProbeSuccessAt: Date?
    private var lastBridgeProbeSuccessAt: Date?
    private var lastResolveSuccessAt: Date?
    private var lastResolve404At: Date?
    private var lastForegroundAt: Date?
    private var consecutiveRPCTimeouts = 0
    private var consecutiveTransportDrops = 0
    private var consecutiveMachineProbeFailures = 0
    private var consecutiveBridgeProbeFailures = 0
    private let healthProbeGeneration = OSAllocatedUnfairLock(initialState: 0)

    /// Monotonically incrementing tRPC request ID.
    private let nextRequestId = OSAllocatedUnfairLock(initialState: 1)

    /// Last event ID received from a tRPC tracked subscription (for reconnect recovery).
    private(set) var lastEventId: String?

    /// Active fanout continuations for callers that subscribed via
    /// `subscribeToEvents()`. Used by views like TailFeedView to live-refresh
    /// when the bridge pushes any sequenced event.
    private let eventFanout = OSAllocatedUnfairLock(
        initialState: [UUID: AsyncStream<SequencedEvent>.Continuation]()
    )

    /// Live stream of every `SequencedEvent` the connection receives, regardless
    /// of which routing path it arrived through. The stream stays open for the
    /// lifetime of the consumer; cancel by exiting the `for await` loop.
    func subscribeToEvents() -> AsyncStream<SequencedEvent> {
        let id = UUID()
        return AsyncStream { continuation in
            eventFanout.withLock { $0[id] = continuation }
            continuation.onTermination = { [weak self] _ in
                self?.eventFanout.withLock { $0.removeValue(forKey: id) }
            }
        }
    }

    /// Fan a sequenced event out to every active `subscribeToEvents()` consumer.
    /// Call sites: any code path that decodes a `SequencedEvent`.
    private func fanoutEvent(_ event: SequencedEvent) {
        let conts = eventFanout.withLock { Array($0.values) }
        for cont in conts {
            cont.yield(event)
        }
    }

    /// Active fanout continuations for callers that subscribed via
    /// `subscribeToTailEvents()`. Separate from `eventFanout` because tail is a
    /// machine-wide firehose with potentially high rate, distinct from per-session
    /// control events. See docs/tail-firehose.md.
    private let tailFanout = OSAllocatedUnfairLock(
        initialState: [UUID: AsyncStream<TailEvent>.Continuation]()
    )

    /// Live stream of every `TailEvent` fanned out by the bridge's
    /// `tail.events` subscription (Lane A). Empty until Lane A wires the
    /// bridge subscription; the receive-side here is ready.
    func subscribeToTailEvents() -> AsyncStream<TailEvent> {
        let id = UUID()
        return AsyncStream { continuation in
            tailFanout.withLock { $0[id] = continuation }
            continuation.onTermination = { [weak self] _ in
                self?.tailFanout.withLock { $0.removeValue(forKey: id) }
            }
        }
    }

    /// Fan a tail event out to every active `subscribeToTailEvents()` consumer.
    /// Call sites: tRPC subscription decoder once Lane A wires `tail.events`.
    private func fanoutTailEvent(_ event: TailEvent) {
        let conts = tailFanout.withLock { Array($0.values) }
        for cont in conts {
            cont.yield(event)
        }
    }

    private static let logger = Logger(
        subsystem: "com.openscout.scout",
        category: "ConnectionManager"
    )

    private static let rpcTimeout: TimeInterval = 10
    private static let createSessionTimeout: TimeInterval = 30
    private static let maxReconnectAttempts = 3
    private static let maxBackoff: TimeInterval = 30

    // MARK: Init

    init(sessionStore: SessionStore, inboxStore: InboxStore) {
        self.sessionStore = sessionStore
        self.inboxStore = inboxStore
        self.urlSession = URLSession(configuration: .default, delegate: sessionDelegate, delegateQueue: nil)
        self.connectionInfo = Self.loadConnectionInfo()
        self.cachedRemotePushToken = Self.loadRemotePushToken()
        self.health = self.connectionInfo == nil ? .offline : .suspect
    }

    deinit {
        disconnect()
    }

    // MARK: - Identity

    /// Load or create the phone's static Noise identity from Keychain.
    private func ensureIdentity() throws -> NoiseKeyPair {
        if let existing = identityKeyPair { return existing }
        let keyPair = try ScoutIdentity.loadOrCreateIdentity()
        identityKeyPair = keyPair
        return keyPair
    }

    func noteAppDidBecomeActive() {
        lastForegroundAt = Date()
        guard hasTrustedBridge, state != .connected else { return }
        transitionHealth(to: .suspect)
        scheduleHealthProbe(reason: "app_foreground")
    }

    func refreshPushRegistration() async {
        let authorizationStatus = await PermissionAuthorizations.notificationAuthorizationStatus()
        if authorizationStatus.allowsRemoteNotifications {
            await MainActor.run {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
        await syncPushRegistrationIfPossible(authorizationStatus: authorizationStatus)
    }

    func handleRemotePushDeviceToken(_ deviceToken: Data) {
        let token = hexString(deviceToken).lowercased()
        guard !token.isEmpty else { return }

        if token != cachedRemotePushToken {
            cachedRemotePushToken = token
            Self.saveRemotePushToken(token)
            lastSyncedPushRegistrationSignature = nil
        }

        Task {
            await syncPushRegistrationIfPossible(force: true)
        }
    }

    func handleRemotePushRegistrationFailure(_ error: Error) {
        Self.logger.warning("Remote notification registration failed: \(error.localizedDescription, privacy: .public)")
    }

    private func transitionHealth(to newHealth: BridgeHealthState) {
        setHealth(newHealth)
    }

    private func beginHealthProbeGeneration() -> Int {
        healthProbeGeneration.withLock { generation in
            generation += 1
            return generation
        }
    }

    private func invalidateHealthProbeGeneration() {
        _ = healthProbeGeneration.withLock { generation in
            generation += 1
            return generation
        }
    }

    private func isCurrentHealthProbeGeneration(_ generation: Int) -> Bool {
        healthProbeGeneration.withLock { current in current == generation }
    }

    private func noteSuccessfulConnection() {
        let now = Date()
        lastConnectedAt = now
        lastIncomingMessageAt = now
        lastSuccessfulRPCAt = now
        consecutiveRPCTimeouts = 0
        consecutiveTransportDrops = 0
        consecutiveMachineProbeFailures = 0
        consecutiveBridgeProbeFailures = 0
        healthProbeTask?.cancel()
        healthProbeTask = nil
        invalidateHealthProbeGeneration()
        setHealth(.healthy)
    }

    private func noteIncomingBridgeActivity() {
        lastIncomingMessageAt = Date()
        consecutiveTransportDrops = 0
        consecutiveBridgeProbeFailures = 0
        if hasTrustedBridge {
            invalidateHealthProbeGeneration()
            transitionHealth(to: .healthy)
        }
    }

    private func noteSuccessfulRPC() {
        lastSuccessfulRPCAt = Date()
        consecutiveRPCTimeouts = 0
        consecutiveBridgeProbeFailures = 0
        if hasTrustedBridge {
            invalidateHealthProbeGeneration()
            transitionHealth(to: .healthy)
        }
    }

    private func noteTransportDrop() {
        consecutiveTransportDrops += 1
        transitionHealth(to: .suspect)
    }

    private func noteRPCTimeout() {
        consecutiveRPCTimeouts += 1
        if consecutiveRPCTimeouts >= 2 {
            transitionHealth(to: .degraded)
        } else {
            transitionHealth(to: .suspect)
        }
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
        manualDisconnectRequested = false

        setState(.connecting)
        Self.logger.notice("Connecting via QR: relay=\(qrPayload.relay, privacy: .public) room=\(qrPayload.room, privacy: .public)")

        do {
            let expectedRemoteKey = qrPayload.bridgePublicKeyData
            guard expectedRemoteKey.count == 32 else {
                throw ConnectionError.invalidQRPayload("Invalid bridge public key length")
            }

            let relayURLs = relayURLsAllowedByRouteSettings(qrPayload.orderedRelayURLs)
            guard !relayURLs.isEmpty else {
                throw ConnectionError.relayUnavailable
            }
            let attempt = try await connectUsingAvailableRelayURLs(
                relayURLs: relayURLs,
                initialRoomId: qrPayload.room,
                publicKeyHex: qrPayload.publicKey,
                expectedRemoteKey: expectedRemoteKey,
                remoteStaticKey: nil, // XX pattern — no prior key
                resolveRoomBeforeConnect: false,
                failureReason: "Bridge identity did not match the scanned QR code"
            )

            // On successful XX handshake, save the bridge as trusted in Keychain.
            try ScoutIdentity.saveTrustedBridge(publicKey: attempt.remoteKey)

            let publicKeyHex = hexString(attempt.remoteKey)

            let info = BridgeConnectionInfo(
                relayURL: relayURLs.first ?? attempt.relayURL,
                roomId: attempt.roomId,
                publicKeyHex: publicKeyHex,
                fallbackRelayURLs: Array(relayURLs.dropFirst())
            )
            saveConnectionInfo(info)
            connectionInfo = info
            lastSyncedPushRegistrationSignature = nil

            // Bind session store to this bridge for seq persistence.
            await MainActor.run {
                sessionStore.bindToBridge(publicKeyHex: publicKeyHex)
            }

            startMessageLoop()

            setState(.connected)
            await MainActor.run {
                sessionStore.connectionState = .connected
            }
            noteSuccessfulConnection()
            Self.logger.notice("Connected via QR pairing (XX handshake)")

            // Run recovery to sync state.
            await runRecovery()

        } catch {
            if let connectionError = error as? ConnectionError {
                switch connectionError {
                case .tailscaleUnavailable:
                    transitionHealth(to: .tailscaleUnavailable)
                default:
                    break
                }
            }
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
        if let existing = reconnectTask {
            await existing.task.value
            return
        }

        let id = UUID()
        let task = Task<Void, Never> { [weak self] in
            guard let self else { return }
            await self.runReconnect()
        }
        reconnectTask = ReconnectHandle(id: id, task: task)

        await task.value

        if reconnectTask?.id == id {
            reconnectTask = nil
        }
    }

    private func runReconnect() async {
        guard !manualDisconnectRequested else {
            setState(.disconnected)
            await MainActor.run {
                sessionStore.connectionState = .disconnected
            }
            return
        }

        let initialConnectionInfo: BridgeConnectionInfo?
        if let connectionInfo {
            initialConnectionInfo = connectionInfo
        } else {
            initialConnectionInfo = await discoveredConnectionInfoFromTrustedBridge()
        }

        guard var info = initialConnectionInfo else {
            Self.logger.warning("No saved connection info to reconnect to")
            setState(.disconnected)
            return
        }
        if connectionInfo == nil {
            saveConnectionInfo(info)
            connectionInfo = info
        }

        manualDisconnectRequested = false
        transitionHealth(to: .suspect)

        let remoteKeyData = info.bridgePublicKeyData
        guard remoteKeyData.count == 32 else {
            Self.logger.error("Invalid stored public key")
            clearTrustedBridge()
            setState(.disconnected)
            return
        }

        // Verify the bridge is still trusted in Keychain.
        guard ScoutIdentity.isTrustedBridge(publicKey: remoteKeyData) else {
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

            let relayURLs = await relayURLsForTrustedBridge(info)
            Self.logger.notice("Resolving room for bridge \(info.publicKeyHex.prefix(12), privacy: .public) across \(relayURLs.count, privacy: .public) relay route(s)")

            do {
                let connectionAttempt = try await connectUsingAvailableRelayURLs(
                    relayURLs: relayURLs,
                    initialRoomId: info.roomId,
                    publicKeyHex: info.publicKeyHex,
                    expectedRemoteKey: remoteKeyData,
                    remoteStaticKey: remoteKeyData,
                    resolveRoomBeforeConnect: true,
                    failureReason: "Trusted bridge identity changed during reconnect"
                )

                if connectionAttempt.roomId != info.roomId || relayURLs != info.relayURLs {
                    if connectionAttempt.roomId != info.roomId {
                        Self.logger.notice("Room changed: \(info.roomId, privacy: .public) → \(connectionAttempt.roomId, privacy: .public)")
                    } else {
                        Self.logger.notice("Relay routes updated via Bonjour discovery")
                    }
                    info = BridgeConnectionInfo(
                        relayURL: relayURLs.first ?? connectionAttempt.relayURL,
                        roomId: connectionAttempt.roomId,
                        publicKeyHex: info.publicKeyHex,
                        fallbackRelayURLs: Array(relayURLs.dropFirst())
                    )
                    saveConnectionInfo(info)
                    connectionInfo = info
                }

                await MainActor.run {
                    sessionStore.bindToBridge(publicKeyHex: info.publicKeyHex)
                }
                try? ScoutIdentity.touchTrustedBridge(publicKey: remoteKeyData)
                startMessageLoop()
                setState(.connected)
                await MainActor.run {
                    sessionStore.connectionState = .connected
                }
                noteSuccessfulConnection()
                Self.logger.notice("Reconnected via IK handshake")
                await runRecovery()
                return
            } catch {
                if let connectionError = error as? ConnectionError {
                    switch connectionError {
                    case .tailscaleUnavailable:
                        Self.logger.notice("Could not reach the Tailscale relay route")
                        transitionHealth(to: .tailscaleUnavailable)
                        if attempt >= Self.maxReconnectAttempts {
                            setState(.failed(ConnectionError.tailscaleUnavailable))
                            return
                        }
                    case .bridgeOffline:
                        Self.logger.notice("Resolve returned 404 — bridge offline")
                        transitionHealth(to: .degraded)
                        scheduleHealthProbe(reason: "resolve_404")
                    case .relayUnavailable:
                        Self.logger.notice("Could not reach any relay route")
                        transitionHealth(to: .suspect)
                        scheduleHealthProbe(reason: "resolve_unreachable")
                        if attempt >= Self.maxReconnectAttempts {
                            setState(.failed(ConnectionError.relayUnavailable))
                            return
                        }
                    default:
                        Self.logger.error("Handshake failed: \(error.localizedDescription, privacy: .public)")
                    }
                } else {
                    Self.logger.error("Handshake failed: \(error.localizedDescription, privacy: .public)")
                }

                if attempt < Self.maxReconnectAttempts {
                    let backoff = min(pow(2.0, Double(attempt - 1)), Self.maxBackoff)
                    try? await Task.sleep(for: .seconds(backoff))
                }
            }
        }

        // Exhausted all attempts — keep trust (bridge is just offline), signal failure.
        Self.logger.error("All reconnect attempts exhausted — bridge appears offline")
        let generation = beginHealthProbeGeneration()
        await runHealthProbe(reason: "reconnect_exhausted", generation: generation)
        setState(.failed(health == .tailscaleUnavailable ? ConnectionError.tailscaleUnavailable : ConnectionError.bridgeOffline))
    }

    /// Resolve the bridge's current room ID via the relay's POST /resolve endpoint.
    private enum ResolveRoomResult: Sendable {
        case resolved(String)
        case tailscaleUnavailable
        case bridgeOffline
        case relayUnavailable
    }

    private struct BridgeHealthProbeResponse: Decodable, Sendable {
        let ok: Bool
        let bridgeConnected: Bool
        let roomId: String?
    }

    private enum MachineProbeResult: Sendable {
        case bridgeConnected
        case bridgeAbsent
        case tailscaleUnavailable
        case unreachable
    }

    private struct RelayConnectionAttempt: Sendable {
        let relayURL: String
        let roomId: String
        let remoteKey: Data
    }

    private func relayURLsForTrustedBridge(_ info: BridgeConnectionInfo) async -> [String] {
        let discoveredRelayURLs = await BonjourRelayDiscovery.discoverRelayURLs(publicKeyHex: info.publicKeyHex)
        let combinedRelayURLs = discoveredRelayURLs + info.relayURLs
        let allowedRelayURLs = relayURLsAllowedByRouteSettings(combinedRelayURLs)
        guard let primary = allowedRelayURLs.first else {
            return []
        }
        return deduplicatedRelayURLs(primary: primary, fallbacks: Array(allowedRelayURLs.dropFirst()))
    }

    private func discoveredConnectionInfoFromTrustedBridge() async -> BridgeConnectionInfo? {
        guard let bridge = currentTrustedBridge else {
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

    private func connectUsingAvailableRelayURLs(
        relayURLs: [String],
        initialRoomId: String,
        publicKeyHex: String,
        expectedRemoteKey: Data,
        remoteStaticKey: Data?,
        resolveRoomBeforeConnect: Bool,
        failureReason: String
    ) async throws -> RelayConnectionAttempt {
        var lastError: Error?
        var sawBridgeOffline = false
        var sawTailscaleUnavailable = false

        for relayURL in relayURLs {
            var roomId = initialRoomId
            Self.logger.notice("Trying relay \(relayURL, privacy: .public)")

            if resolveRoomBeforeConnect {
                let resolvedRoom = await resolveRoom(relayURL: relayURL, publicKeyHex: publicKeyHex)
                switch resolvedRoom {
                case .resolved(let resolvedRoomId):
                    roomId = resolvedRoomId
                case .tailscaleUnavailable:
                    sawTailscaleUnavailable = true
                    lastError = ConnectionError.tailscaleUnavailable
                    continue
                case .bridgeOffline:
                    sawBridgeOffline = true
                    lastError = ConnectionError.bridgeOffline
                    continue
                case .relayUnavailable:
                    break
                }
            }

            do {
                let remoteKey = try await performConnection(
                    relayURL: relayURL,
                    roomId: roomId,
                    remoteStaticKey: remoteStaticKey
                )

                guard remoteKey == expectedRemoteKey else {
                    clearFailedConnectionAttempt()
                    lastError = ConnectionError.handshakeFailed(failureReason)
                    continue
                }

                activeRelayURL = relayURL
                return RelayConnectionAttempt(relayURL: relayURL, roomId: roomId, remoteKey: remoteKey)
            } catch {
                clearFailedConnectionAttempt()
                if relayURLDependsOnTailscale(relayURL) && isTailscaleRouteNetworkFailure(error) {
                    sawTailscaleUnavailable = true
                    lastError = ConnectionError.tailscaleUnavailable
                } else {
                    lastError = error
                }
            }
        }

        if sawBridgeOffline {
            throw ConnectionError.bridgeOffline
        }
        if sawTailscaleUnavailable {
            throw ConnectionError.tailscaleUnavailable
        }
        throw lastError ?? ConnectionError.relayUnavailable
    }

    private func clearFailedConnectionAttempt() {
        transport = nil
        let activeWebSocket = webSocket
        webSocket = nil
        activeWebSocket?.cancel(with: .goingAway, reason: nil)
    }

    private func resolveRoom(relayURL: String, publicKeyHex: String) async -> ResolveRoomResult {
        // Convert ws(s):// to http(s):// for the REST endpoint.
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
            guard let http = response as? HTTPURLResponse else {
                return .relayUnavailable
            }
            switch http.statusCode {
            case 200:
                let result = try JSONDecoder().decode([String: String].self, from: data)
                guard let room = result["room"]?.trimmingCharacters(in: .whitespacesAndNewlines),
                      !room.isEmpty else {
                    return .relayUnavailable
                }
                lastResolveSuccessAt = Date()
                return .resolved(room)
            case 404:
                lastResolve404At = Date()
                return .bridgeOffline
            default:
                return .relayUnavailable
            }
        } catch {
            Self.logger.error("Room resolve request failed: \(error.localizedDescription, privacy: .public)")
            if relayURLDependsOnTailscale(relayURL) && isTailscaleRouteNetworkFailure(error) {
                return .tailscaleUnavailable
            }
            return .relayUnavailable
        }
    }

    private func machineProbeURL(relayURL: String, publicKeyHex: String) -> URL? {
        let httpURL = relayURL
            .replacingOccurrences(of: "wss://", with: "https://")
            .replacingOccurrences(of: "ws://", with: "http://")
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard var components = URLComponents(string: "\(httpURL)/healthz") else { return nil }
        components.queryItems = [
            URLQueryItem(name: "bridgePublicKey", value: publicKeyHex),
        ]
        return components.url
    }

    private func probeMachineLiveness() async -> MachineProbeResult {
        guard let info = connectionInfo else { return .unreachable }
        let relayURLs = await relayURLsForTrustedBridge(info)
        var sawBridgeAbsent = false
        var sawTailscaleUnavailable = false

        for relayURL in relayURLs {
            guard let url = machineProbeURL(relayURL: relayURL, publicKeyHex: info.publicKeyHex) else {
                continue
            }

            var request = URLRequest(url: url)
            request.httpMethod = "GET"
            request.timeoutInterval = 3

            do {
                let (data, response) = try await urlSession.data(for: request)
                guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                    continue
                }
                let payload = try JSONDecoder().decode(BridgeHealthProbeResponse.self, from: data)
                guard payload.ok else { continue }
                lastMachineProbeSuccessAt = Date()
                if payload.bridgeConnected {
                    activeRelayURL = relayURL
                    lastBridgeProbeSuccessAt = Date()
                    return .bridgeConnected
                }
                sawBridgeAbsent = true
            } catch {
                if relayURLDependsOnTailscale(relayURL) && isTailscaleRouteNetworkFailure(error) {
                    sawTailscaleUnavailable = true
                }
            }
        }

        if sawTailscaleUnavailable {
            return .tailscaleUnavailable
        }
        if sawBridgeAbsent {
            return .bridgeAbsent
        }
        return .unreachable
    }

    private func scheduleHealthProbe(reason: String) {
        guard hasTrustedBridge else { return }
        healthProbeTask?.cancel()
        let generation = beginHealthProbeGeneration()
        healthProbeTask = Task { [weak self] in
            await self?.runHealthProbe(reason: reason, generation: generation)
        }
    }

    private func runHealthProbe(reason: String, generation: Int) async {
        for attempt in 1...3 {
            if Task.isCancelled || !isCurrentHealthProbeGeneration(generation) { return }

            let result = await probeMachineLiveness()
            if Task.isCancelled || !isCurrentHealthProbeGeneration(generation) { return }

            if state == .connected {
                transitionHealth(to: .healthy)
                return
            }

            switch result {
            case .bridgeConnected:
                consecutiveMachineProbeFailures = 0
                consecutiveBridgeProbeFailures = 0
                transitionHealth(to: .healthy)
                Self.logger.notice("Health probe succeeded (\(reason, privacy: .public))")
                reconnectAfterReachableHealthProbeIfNeeded(reason: reason)
                return
            case .bridgeAbsent:
                consecutiveBridgeProbeFailures += 1
                transitionHealth(to: .degraded)
                if consecutiveBridgeProbeFailures >= 2 {
                    Self.logger.notice("Health probe found reachable machine but absent bridge")
                    return
                }
            case .tailscaleUnavailable:
                transitionHealth(to: .tailscaleUnavailable)
                Self.logger.notice("Health probe could not reach the Tailscale route")
                return
            case .unreachable:
                consecutiveMachineProbeFailures += 1
                if consecutiveMachineProbeFailures >= 2 {
                    transitionHealth(to: .offline)
                    Self.logger.notice("Health probe could not reach machine on any relay route")
                    return
                }
                transitionHealth(to: .degraded)
            }

            if attempt < 3 {
                try? await Task.sleep(for: .seconds(Double(attempt)))
            }
        }
    }

    private func reconnectAfterReachableHealthProbeIfNeeded(reason: String) {
        guard hasTrustedBridge, !manualDisconnectRequested else { return }

        let shouldReconnect: Bool
        switch state {
        case .connected, .connecting, .handshaking:
            shouldReconnect = false
        case .reconnecting:
            shouldReconnect = reconnectTask == nil
        case .disconnected, .failed:
            shouldReconnect = true
        }

        guard shouldReconnect else { return }
        Self.logger.notice("Reachable bridge found while disconnected; retrying secure reconnect (\(reason, privacy: .public))")

        Task { [weak self] in
            await self?.reconnect()
        }
    }

    /// Disconnect from the current bridge.
    func disconnect() {
        manualDisconnectRequested = true
        receiveTask?.cancel()
        receiveTask = nil
        reconnectTask?.task.cancel()
        reconnectTask = nil
        healthProbeTask?.cancel()
        healthProbeTask = nil

        transport = nil
        activeRelayURL = nil

        let activeWebSocket = webSocket
        webSocket = nil
        activeWebSocket?.cancel(with: .goingAway, reason: nil)

        cancelAllPendingRequests(with: ConnectionError.notConnected)

        // Reset request ID counter (new connection = fresh sequence).
        nextRequestId.withLock { $0 = 1 }
        // Note: lastEventId is intentionally preserved across reconnects for subscription recovery.

        Task { @MainActor in
            sessionStore.connectionState = .disconnected
        }

        if state != .disconnected {
            setState(.disconnected)
        }
    }

    /// Whether there is a saved trusted bridge (for UI routing decisions).
    var hasTrustedBridge: Bool {
        connectionInfo != nil || currentTrustedBridge != nil
    }

    /// Clear the trusted bridge record (triggers QR scanner).
    func clearTrustedBridge() {
        disconnect()

        if let info = connectionInfo {
            let keyData = info.bridgePublicKeyData
            if keyData.count == 32 {
                try? ScoutIdentity.removeTrustedBridge(publicKey: keyData)
            }
        }
        connectionInfo = nil
        UserDefaults.standard.removeObject(forKey: "scout.connectionInfo")
        Task { @MainActor in
            sessionStore.clearAll()
            inboxStore.clear()
            sessionStore.connectionState = .disconnected
        }
        lastSyncedPushRegistrationSignature = nil
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
        profile: String? = nil,
        branch: String? = nil,
        model: String? = nil,
        forceNew: Bool = false
    ) async throws -> MobileSessionHandle {
        let params = MobileCreateSessionParams(
            workspaceId: workspaceId,
            harness: harness,
            agentName: agentName,
            worktree: worktree,
            profile: profile,
            branch: branch,
            model: model,
            forceNew: forceNew ? true : nil
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

    func listMobileAgents(query: String? = nil, limit: Int? = nil) async throws -> [MobileAgentSummary] {
        let params = MobileListParams(query: query, limit: limit)
        let data = try await sendRPC(method: "mobile/agents", params: params)
        return try decodeResult([MobileAgentSummary].self, from: data)
    }

    func getActivity(agentId: String? = nil, limit: Int? = nil) async throws -> [ActivityItem] {
        let params = MobileActivityParams(agentId: agentId, limit: limit)
        let data = try await sendRPC(method: "mobile/activity", params: params)
        return try decodeResult([ActivityItem].self, from: data)
    }

    func getInbox() async throws -> MobileInboxResponse {
        let data = try await sendRPC(method: "mobile/inbox", params: nil as Empty?)
        return try decodeResult(MobileInboxResponse.self, from: data)
    }

    func syncPushRegistration(_ params: MobilePushSyncParams) async throws -> PushRegistrationResult {
        let data = try await sendRPC(method: "mobile/push/sync", params: params)
        return try decodeResult(PushRegistrationResult.self, from: data)
    }

    func getAgentDetail(agentId: String) async throws -> MobileAgentDetail {
        let params = AgentIdParams(agentId: agentId)
        let data = try await sendRPC(method: "mobile/agent/detail", params: params)
        return try decodeResult(MobileAgentDetail.self, from: data)
    }

    func restartAgent(agentId: String) async throws -> AgentActionResult {
        let params = AgentIdParams(agentId: agentId)
        let data = try await sendRPC(method: "mobile/agent/restart", params: params)
        return try decodeResult(AgentActionResult.self, from: data)
    }

    func stopAgent(agentId: String) async throws -> AgentActionResult {
        let params = AgentIdParams(agentId: agentId)
        let data = try await sendRPC(method: "mobile/agent/stop", params: params)
        return try decodeResult(AgentActionResult.self, from: data)
    }

    func closeSession(_ sessionId: String) async throws {
        let params = SessionIdParams(sessionId: sessionId)
        _ = try await sendRPC(method: "session/close", params: params)
    }

    func sendPrompt(_ prompt: Prompt) async throws -> MobileSendMessageResult {
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
        let data = try await sendRPC(method: "mobile/message/send", params: params)
        return try decodeResult(MobileSendMessageResult.self, from: data)
    }

    func interruptTurn(_ sessionId: String) async throws {
        let params = SessionIdParams(sessionId: sessionId)
        _ = try await sendRPC(method: "turn/interrupt", params: params)
    }

    func interruptAgent(_ agentId: String) async throws {
        let params = AgentIdParams(agentId: agentId)
        _ = try await sendRPC(method: "mobile/agent/interrupt", params: params)
    }

    func answerQuestion(sessionId: String, blockId: String, answer: [String]) async throws {
        struct Params: Encodable {
            let sessionId: String
            let blockId: String
            let answer: [String]
        }
        _ = try await sendRPC(method: "question/answer", params: Params(sessionId: sessionId, blockId: blockId, answer: answer))
    }

    func decideAction(
        sessionId: String,
        turnId: String,
        blockId: String,
        version: Int,
        decision: String,
        reason: String? = nil
    ) async throws {
        let params = ActionDecideParams(
            sessionId: sessionId,
            turnId: turnId,
            blockId: blockId,
            version: version,
            decision: decision,
            reason: reason
        )
        _ = try await sendRPC(method: "action/decide", params: params)
    }

    func getSnapshot(_ sessionId: String, beforeTurnId: String? = nil, limit: Int? = nil) async throws -> SessionState {
        if isScreenshotPreview {
            if let snapshot = await MainActor.run(body: { sessionStore.sessions[sessionId] }) {
                return snapshot
            }
            throw ConnectionError.rpcError(code: -32602, message: "Missing preview snapshot")
        }

        let params = MobileSessionSnapshotParams(
            conversationId: sessionId,
            beforeTurnId: beforeTurnId,
            limit: limit
        )
        let data = try await sendRPC(method: "mobile/session/snapshot", params: params)
        return try decodeResult(SessionState.self, from: data)
    }

    func syncStatus(sessionId: String) async throws -> SyncStatusResponse {
        let params = SyncStatusParams(sessionId: sessionId)
        let data = try await sendRPC(method: "sync/status", params: params)
        return try decodeResult(SyncStatusResponse.self, from: data)
    }

    func syncReplay(sessionId: String, lastSeq: Int) async throws -> [SequencedEvent] {
        let params = ReplayParams(sessionId: sessionId, lastSeq: lastSeq)
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
        if isScreenshotPreview {
            await MainActor.run {
                sessionStore.connectionState = .connected
            }
            return
        }

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
        noteTransportDrop()
        scheduleHealthProbe(reason: "transport_drop")

        // Clean up the dead connection state.
        transport = nil
        let activeWebSocket = webSocket
        webSocket = nil
        activeWebSocket?.cancel(with: .goingAway, reason: nil)
        cancelAllPendingRequests(with: ConnectionError.notConnected)

        let nextState: ConnectionState = shouldReconnect ? .reconnecting(attempt: 0) : .disconnected
        setState(nextState)
        await MainActor.run {
            sessionStore.connectionState = nextState
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
        // Handle tRPC keep-alive: PING → PONG (plain text, not JSON).
        if raw == "PING" {
            noteIncomingBridgeActivity()
            Task {
                try? await transport?.send("PONG")
            }
            return
        }
        if raw == "PONG" {
            noteIncomingBridgeActivity()
            // Server acknowledged our ping — nothing to do.
            return
        }

        guard let data = raw.data(using: .utf8) else {
            Self.logger.warning("Received non-UTF8 message, skipping")
            return
        }

        noteIncomingBridgeActivity()

        // Try parsing as a tRPC response (has integer "id" field).
        if let response = try? JSONDecoder().decode(TRPCResponse.self, from: data) {
            handleTRPCResponse(response)
            return
        }

        if let notification = try? JSONDecoder().decode(OperatorNotificationEvent.self, from: data),
           notification.event == "operator:notify" {
            Task { @MainActor in
                inboxStore.receiveOperatorNotification(notification)
            }
            return
        }

        // Try parsing as a sequenced event (has "seq" and "event" fields).
        // This handles the transition period before subscriptions are fully adopted.
        if let sequenced = try? JSONDecoder().decode(SequencedEvent.self, from: data) {
            fanoutEvent(sequenced)
            Task { @MainActor in
                sessionStore.applyEvent(sequenced)
            }
            return
        }

        // Try parsing as a TailEvent — bridge auto-fans the broker's
        // /v1/tail/stream firehose to every connected phone as raw JSON in
        // parity with the SequencedEvent path above. TailEvent's required
        // fields (`harness`, `source`, `pid`, no `seq`) make this a safe
        // last-resort decode.
        if let tail = try? JSONDecoder().decode(TailEvent.self, from: data) {
            fanoutTailEvent(tail)
            return
        }

        // Unknown message format — log and skip. Never crash.
        Self.logger.warning("Unrecognized message format, skipping: \(raw.prefix(200), privacy: .public)")
    }

    private func handleTRPCResponse(_ response: TRPCResponse) {
        // Check if this is subscription data (no pending request, just streamed events).
        let pending = pendingRequests.withLock { $0.removeValue(forKey: response.id) }

        // Track lastEventId from subscription data for future reconnect recovery.
        if let result = response.result, result.type == "data", let eventId = result.id {
            lastEventId = eventId
        }

        // Subscription data with no pending request — it's a streamed event.
        if pending == nil, let result = response.result, result.type == "data" {
            if let eventData = result.data {
                // Try decoding subscription data as a sequenced event.
                do {
                    let encoded = try JSONEncoder().encode(eventData)
                    if let sequenced = try? JSONDecoder().decode(SequencedEvent.self, from: encoded) {
                        fanoutEvent(sequenced)
                        Task { @MainActor in
                            sessionStore.applyEvent(sequenced)
                        }
                        return
                    }
                    // Lane A's tail.events subscription will land here too.
                    // TailEvent has disjoint required fields from SequencedEvent
                    // (no `seq`, has `harness`+`source`+`pid`), so this attempt
                    // is safe as a fallback.
                    if let tail = try? JSONDecoder().decode(TailEvent.self, from: encoded) {
                        fanoutTailEvent(tail)
                        return
                    }
                } catch {
                    // Not a known event shape — log and skip.
                }
            }
            Self.logger.debug("Received subscription data for id \(response.id, privacy: .public) with no handler")
            return
        }

        guard let pending else {
            // Could be a subscription "started"/"stopped" ack — not an error.
            if let result = response.result, (result.type == "started" || result.type == "stopped") {
                Self.logger.debug("Subscription \(result.type, privacy: .public) for id \(response.id, privacy: .public)")
                return
            }
            Self.logger.warning("Received tRPC response for unknown id: \(response.id, privacy: .public)")
            return
        }

        pending.timeoutTask.cancel()

        if let error = response.error {
            pending.continuation.resume(
                throwing: ConnectionError.rpcError(code: error.code, message: error.message)
            )
        } else if let result = response.result {
            noteSuccessfulRPC()
            // Unwrap tRPC envelope: extract result.data.
            if let resultData = result.data {
                do {
                    let encoded = try JSONEncoder().encode(resultData)
                    pending.continuation.resume(returning: encoded)
                } catch {
                    pending.continuation.resume(
                        throwing: ConnectionError.decodingFailed("Failed to re-encode tRPC result.data")
                    )
                }
            } else {
                // Success with null data — encode empty object for callers expecting decodable content.
                let emptyData = "{}".data(using: .utf8)!
                pending.continuation.resume(returning: emptyData)
            }
        } else {
            noteSuccessfulRPC()
            // No result and no error — treat as empty success.
            let emptyData = "{}".data(using: .utf8)!
            pending.continuation.resume(returning: emptyData)
        }
    }

    // MARK: - Private: RPC sending

    /// Allocate the next monotonic request ID.
    private func allocateRequestId() -> Int {
        nextRequestId.withLock { id in
            let current = id
            id += 1
            return current
        }
    }

    private func sendRPC<P: Encodable & Sendable>(
        method: String,
        params: P?
    ) async throws -> Data {
        guard let transport, transport.isReady else {
            throw ConnectionError.notConnected
        }

        // Resolve the tRPC route for this legacy method name.
        guard let route = trpcRouteMap[method] else {
            Self.logger.error("No tRPC route mapping for method: \(method, privacy: .public)")
            throw ConnectionError.encodingFailed
        }

        let requestId = allocateRequestId()
        let request = TRPCRequest(id: requestId, method: route.method, path: route.path, input: params)

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

                let removed = self?.pendingRequests.withLock { $0.removeValue(forKey: requestId) }
                if removed != nil {
                    Self.logger.warning("RPC timeout: \(method, privacy: .public) — connection likely stale")
                    self?.noteRPCTimeout()
                    self?.scheduleHealthProbe(reason: "rpc_timeout")
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

            pendingRequests.withLock { $0[requestId] = pending }

            Task {
                do {
                    try await transport.send(jsonString)
                } catch {
                    let removed = self.pendingRequests.withLock { $0.removeValue(forKey: requestId) }
                    if removed != nil {
                        timeoutTask.cancel()
                        continuation.resume(throwing: error)
                    }
                }
            }
        }
    }

    private func cancelAllPendingRequests(with error: Error) {
        let requests = pendingRequests.withLock { dict -> [Int: PendingRequest] in
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
        await inboxStore.refresh(using: self, presentNotifications: true)
        await syncPushRegistrationIfPossible()
    }

    private func syncPushRegistrationIfPossible(
        force: Bool = false,
        authorizationStatus: PushAuthorizationStatus? = nil
    ) async {
        guard hasTrustedBridge, state == .connected else { return }

        let resolvedAuthorizationStatus: PushAuthorizationStatus
        if let authorizationStatus {
            resolvedAuthorizationStatus = authorizationStatus
        } else {
            resolvedAuthorizationStatus = await PermissionAuthorizations.notificationAuthorizationStatus()
        }

        guard let params = await currentPushSyncParams(authorizationStatus: resolvedAuthorizationStatus) else {
            return
        }

        let signature = pushRegistrationSignature(for: params)
        if !force, signature == lastSyncedPushRegistrationSignature {
            return
        }

        do {
            let response = try await syncPushRegistration(params)
            if response.ok {
                lastSyncedPushRegistrationSignature = signature
            }
        } catch {
            Self.logger.warning("Push registration sync failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func currentPushSyncParams(
        authorizationStatus: PushAuthorizationStatus
    ) async -> MobilePushSyncParams? {
        let bundleId = Bundle.main.bundleIdentifier?.trimmedNonEmpty ?? "com.openscout.scout"
        let info = Bundle.main.infoDictionary
        let appVersion = info?["CFBundleShortVersionString"] as? String
        let buildNumber = info?["CFBundleVersion"] as? String
        let deviceInfo = await MainActor.run {
            (
                model: UIDevice.current.model,
                systemVersion: UIDevice.current.systemVersion
            )
        }

        return MobilePushSyncParams(
            pushToken: authorizationStatus.allowsRemoteNotifications ? cachedRemotePushToken : nil,
            authorizationStatus: authorizationStatus,
            appBundleId: bundleId,
            apnsEnvironment: currentAPNSEnvironment,
            appVersion: appVersion,
            buildNumber: buildNumber,
            deviceModel: deviceInfo.model,
            systemVersion: deviceInfo.systemVersion
        )
    }

    private var currentAPNSEnvironment: APNSEnvironment {
        #if DEBUG
        return .development
        #else
        return .production
        #endif
    }

    private func pushRegistrationSignature(for params: MobilePushSyncParams) -> String {
        [
            params.pushToken ?? "",
            params.authorizationStatus.rawValue,
            params.appBundleId,
            params.apnsEnvironment.rawValue,
            params.appVersion ?? "",
            params.buildNumber ?? "",
            params.deviceModel ?? "",
            params.systemVersion ?? "",
        ].joined(separator: "|")
    }

    // MARK: - Private: Connection info persistence

    private static func loadConnectionInfo() -> BridgeConnectionInfo? {
        guard let data = UserDefaults.standard.data(forKey: "scout.connectionInfo") else {
            return nil
        }
        return try? JSONDecoder().decode(BridgeConnectionInfo.self, from: data)
    }

    private static func loadRemotePushToken() -> String? {
        UserDefaults.standard.string(forKey: "scout.remotePushToken")?.trimmedNonEmpty
    }

    private func saveConnectionInfo(_ info: BridgeConnectionInfo) {
        if let data = try? JSONEncoder().encode(info) {
            UserDefaults.standard.set(data, forKey: "scout.connectionInfo")
        }
    }

    private static func saveRemotePushToken(_ token: String) {
        UserDefaults.standard.set(token, forKey: "scout.remotePushToken")
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

private struct ReconnectHandle {
    let id: UUID
    let task: Task<Void, Never>
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
        let manager = ConnectionManager(sessionStore: store, inboxStore: InboxStore())
        manager.state = ConnectionState.connected
        return manager
    }

    @MainActor
    static func screenshotPreview(
        sessionStore: SessionStore,
        inboxStore: InboxStore,
        trustedBridge: Bool
    ) -> ConnectionManager {
        let manager = ConnectionManager(sessionStore: sessionStore, inboxStore: inboxStore)
        manager.isScreenshotPreview = true
        manager.state = trustedBridge ? .connected : .disconnected
        manager.health = trustedBridge ? .healthy : .offline
        manager.connectionInfo = trustedBridge ? BridgeConnectionInfo(
            relayURL: "https://relay.openscout.app",
            roomId: "preview-room",
            publicKeyHex: String(repeating: "ab", count: 32)
        ) : nil
        return manager
    }
}
