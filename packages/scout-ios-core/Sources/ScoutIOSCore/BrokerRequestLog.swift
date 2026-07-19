import Foundation
import Observation

/// The result of one metadata-only broker RPC observation.
public enum BrokerRequestOutcome: String, Sendable {
    case success
    case failure
}

/// A deliberately narrow request-log record.
///
/// Inputs and response data never enter this type. In particular, it must not
/// grow fields for request bodies, prompts, agent output, connection URLs,
/// machine identifiers, file paths, or authentication material.
public struct BrokerRequestLogEntry: Identifiable, Sendable {
    public let id: UUID
    public let startedAt: Date
    public let completedAt: Date
    public let operation: String
    public let kind: String
    public let outcome: BrokerRequestOutcome
    public let durationMilliseconds: Int
    public let route: TransportKind?
    public let failureCategory: String?

    init(
        startedAt: Date,
        completedAt: Date,
        operation: String,
        kind: String,
        outcome: BrokerRequestOutcome,
        durationMilliseconds: Int,
        route: TransportKind?,
        failureCategory: String?
    ) {
        self.id = UUID()
        self.startedAt = startedAt
        self.completedAt = completedAt
        self.operation = operation
        self.kind = kind
        self.outcome = outcome
        self.durationMilliseconds = durationMilliseconds
        self.route = route
        self.failureCategory = failureCategory
    }
}

/// Process-local, bounded broker request history for power-user diagnostics.
///
/// The app's bridge clients share this store, so the log reflects every focused
/// or fleet RPC rather than only the requests initiated from Settings.
@MainActor
@Observable
public final class BrokerRequestLog {
    public static let shared = BrokerRequestLog()

    public private(set) var entries: [BrokerRequestLogEntry] = []

    /// Last decoded successful broker query. Mutations do not advance freshness.
    /// This is intentionally retained when the visible history is cleared so a
    /// diagnostics action cannot make the app's freshness indicator untruthful.
    public private(set) var lastSuccessfulReadAt: Date?

    private let capacity: Int

    public init(capacity: Int = 200) {
        self.capacity = max(1, capacity)
    }

    public func clear() {
        entries.removeAll(keepingCapacity: true)
    }

    func record(
        startedAt: Date,
        completedAt: Date,
        operation: String,
        kind: String,
        outcome: BrokerRequestOutcome,
        route: TransportKind?,
        failureCategory: String? = nil
    ) {
        let entry = BrokerRequestLogEntry(
            startedAt: startedAt,
            completedAt: completedAt,
            operation: operation,
            kind: kind,
            outcome: outcome,
            durationMilliseconds: max(0, Int(completedAt.timeIntervalSince(startedAt) * 1_000)),
            route: route,
            failureCategory: failureCategory
        )
        entries.append(entry)
        if entries.count > capacity {
            entries.removeFirst(entries.count - capacity)
        }
        if outcome == .success, kind == "query" {
            lastSuccessfulReadAt = completedAt
        }
    }
}

/// Sendable MainActor hop used by the transport layer.
public struct BrokerRequestLogHandle: Sendable {
    public let log: BrokerRequestLog

    public init(_ log: BrokerRequestLog) {
        self.log = log
    }

    func record(
        startedAt: Date,
        completedAt: Date,
        operation: String,
        kind: String,
        outcome: BrokerRequestOutcome,
        route: TransportKind?,
        failureCategory: String? = nil
    ) async {
        await MainActor.run {
            log.record(
                startedAt: startedAt,
                completedAt: completedAt,
                operation: operation,
                kind: kind,
                outcome: outcome,
                route: route,
                failureCategory: failureCategory
            )
        }
    }
}

/// Collapse errors to a fixed, payload-free category. Server error messages and
/// localized transport descriptions can contain user content or paths, so they
/// must never be copied into the request log.
func brokerRequestFailureCategory(_ error: Error) -> String {
    if error is CancellationError { return "Cancelled" }
    if let urlError = error as? URLError { return "Network \(urlError.code.rawValue)" }

    guard let bridgeError = error as? BridgeConnectionError else {
        return "Failed"
    }
    switch bridgeError {
    case .notConnected:
        return "Not connected"
    case .encodingFailed:
        return "Encode"
    case .decodingFailed:
        return "Decode"
    case .rpcTimeout:
        return "Timeout"
    case .rpcError(let code, _):
        return "RPC \(code)"
    case .noTrustedBridge, .identityError:
        return "Identity"
    case .noRelayCandidates, .relayUnavailable, .tailscaleUnavailable, .handshakeFailed:
        return "Transport"
    }
}
