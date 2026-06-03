import Foundation
import Observation

public enum ConnectionLogLevel: String, Sendable { case info, success, warning, error }

public struct ConnectionLogEntry: Identifiable, Sendable {
    public let id: Int
    public let tsMs: Int64
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
    public func log(_ message: String, level: ConnectionLogLevel = .info, route: TransportKind? = nil) {
        counter += 1
        entries.append(ConnectionLogEntry(id: counter, tsMs: Int64(Date().timeIntervalSince1970 * 1000), level: level, route: route, message: message))
        if entries.count > cap { entries.removeFirst(entries.count - cap) }
    }
    public func clear() { entries.removeAll() }
}
