import Combine
import Foundation
import HudsonObservability
import Observation

public enum ConnectionLogLevel: String, Sendable { case info, success, warning, error }

public enum ConnectionLogEvent: String, CaseIterable, Sendable {
    case lifecycle
    case discover
    case resolve
    case handshake
    case connected
    case reconnect
    case network
    case fallback
    case routeDisabled
    case routeUnavailable
    case pairing
    case trust
    case auth

    public var label: String {
        switch self {
        case .lifecycle: return "LIFECYCLE"
        case .discover: return "DISCOVER"
        case .resolve: return "RESOLVE"
        case .handshake: return "HANDSHAKE"
        case .connected: return "CONNECTED"
        case .reconnect: return "RECONNECT"
        case .network: return "NETWORK"
        case .fallback: return "FALLBACK"
        case .routeDisabled: return "ROUTE-OFF"
        case .routeUnavailable: return "UNAVAIL"
        case .pairing: return "PAIR"
        case .trust: return "TRUST"
        case .auth: return "AUTH"
        }
    }
}

public struct ConnectionLogEntry: Identifiable, Sendable {
    public let id: Int
    public let tsMs: Int64
    public let event: ConnectionLogEvent
    public let level: ConnectionLogLevel
    public let route: TransportKind?
    public let message: String
}

@MainActor
@Observable
public final class ConnectionLog {
    public private(set) var entries: [ConnectionLogEntry] = []

    private let store = HudLogStore.shared
    private var cancellables = Set<AnyCancellable>()

    public init() {
        Self.bootstrapSinksIfNeeded()
        store.$entries
            .sink { [weak self] hudEntries in
                self?.syncEntries(from: hudEntries)
            }
            .store(in: &cancellables)
        syncEntries(from: store.entries)
    }

    public func log(
        _ message: String,
        event: ConnectionLogEvent = .lifecycle,
        level: ConnectionLogLevel = .info,
        route: TransportKind? = nil
    ) {
        store.record(
            message,
            level: level.hudLevel,
            category: "connection",
            subsystem: "dev.scout.ios",
            metadata: level.hudMetadata(event: event, route: route)
        )
        syncEntries(from: store.entries)
    }

    public func clear() {
        store.clear()
        entries = []
    }

    private func syncEntries(from hudEntries: [HudLogEntry]) {
        entries = hudEntries.enumerated().map { index, entry in
            ConnectionLogEntry(hud: entry, sequence: index + 1)
        }
    }

    private static var sinksInstalled = false

    private static func bootstrapSinksIfNeeded() {
        guard !sinksInstalled else { return }
        sinksInstalled = true
        HudLoggerSinks.install(HudLogStore.shared)
    }
}

private extension ConnectionLogEntry {
    init(hud: HudLogEntry, sequence: Int) {
        id = sequence
        tsMs = Int64(hud.timestamp.timeIntervalSince1970 * 1000)
        event = ConnectionLogEvent(hud: hud)
        level = ConnectionLogLevel(hud: hud)
        route = TransportKind(metadataRoute: hud.metadata["route"])
        message = hud.message
    }
}

private extension ConnectionLogEvent {
    init(hud: HudLogEntry) {
        if let raw = hud.metadata["event"], let event = ConnectionLogEvent(rawValue: raw) {
            self = event
            return
        }
        self = .lifecycle
    }
}

private extension ConnectionLogLevel {
    init(hud: HudLogEntry) {
        if hud.metadata["outcome"] == "success" {
            self = .success
            return
        }
        switch hud.level {
        case .warning:
            self = .warning
        case .error, .fault:
            self = .error
        default:
            self = .info
        }
    }

    var hudLevel: HudLogLevel {
        switch self {
        case .info: return .info
        case .success: return .notice
        case .warning: return .warning
        case .error: return .error
        }
    }

    func hudMetadata(event: ConnectionLogEvent, route: TransportKind?) -> [String: String] {
        var metadata: [String: String] = ["event": event.rawValue]
        if let route {
            metadata["route"] = route.rawValue
        }
        if self == .success {
            metadata["outcome"] = "success"
        }
        return metadata
    }
}

private extension TransportKind {
    init?(metadataRoute: String?) {
        guard let raw = metadataRoute?.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty,
              let kind = TransportKind(rawValue: raw)
        else {
            return nil
        }
        self = kind
    }
}