import Foundation
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
        }
    }
}

public struct ConnectionLogEntry: Identifiable, Sendable {
    public let id: Int
    public let tsMs: Int64
    public let event: ConnectionLogEvent
    public let level: ConnectionLogLevel
    public let route: TransportKind?   // nil if not route-specific
    public let message: String
}

@MainActor
@Observable
public final class ConnectionLog {
    public private(set) var entries: [ConnectionLogEntry] = []
    private var counter = 0
    private let cap = 200
    public init() {}
    public func log(
        _ message: String,
        event: ConnectionLogEvent = .lifecycle,
        level: ConnectionLogLevel = .info,
        route: TransportKind? = nil
    ) {
        counter += 1
        entries.append(
            ConnectionLogEntry(
                id: counter,
                tsMs: Int64(Date().timeIntervalSince1970 * 1000),
                event: event,
                level: level,
                route: route,
                message: message
            )
        )
        if entries.count > cap { entries.removeFirst(entries.count - cap) }
    }
    public func clear() { entries.removeAll() }
}
