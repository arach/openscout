import Foundation

/// Decoded shape of `GET /api/shell-state` — the web server's runtime health.
///
/// The server returns `{ "runtime": { "brokerReachable": Bool, "brokerHealthy":
/// Bool, "brokerLabel": String, ... } }`. Only the fields the native app needs
/// to classify degradation are modelled; `Decodable` ignores the rest.
public struct ScoutShellState: Decodable, Sendable {
    public struct Runtime: Decodable, Sendable {
        /// True when the web server can reach the broker. `false` means the web
        /// service answered but the broker itself is down — the case that
        /// otherwise masquerades as an empty list.
        public let brokerReachable: Bool
        public let brokerHealthy: Bool?

        public init(brokerReachable: Bool, brokerHealthy: Bool? = nil) {
            self.brokerReachable = brokerReachable
            self.brokerHealthy = brokerHealthy
        }
    }

    public let runtime: Runtime

    public init(runtime: Runtime) {
        self.runtime = runtime
    }
}

/// How healthy the local Scout services are, from the native app's point of view.
///
/// - `ok`: the web service answered and the broker is reachable.
/// - `brokerDown`: the web service answered but the broker is unreachable —
///   conversations and agents come back empty even though the app is "up".
/// - `webDown`: the local web service itself didn't answer (connection refused
///   or timed out). The app cannot start the web service; the only honest
///   recovery is retry + the menu-bar controls.
public enum ScoutServiceHealth: Sendable, Equatable {
    case ok
    case brokerDown
    case webDown

    /// Classify from a decoded shell-state payload. Pure — no I/O — so it can be
    /// unit-tested off the decoded shape.
    public static func from(shellState: ScoutShellState) -> ScoutServiceHealth {
        shellState.runtime.brokerReachable ? .ok : .brokerDown
    }
}

/// Tiny, dependency-free probe over `GET /api/shell-state`. Mirrors the
/// `ScoutCommsClient` / `ScoutHTTP.fetch` pattern; carries no state of its own.
public struct ScoutShellStateClient: Sendable {
    public init() {}

    public func fetchShellState() async throws -> ScoutShellState {
        try await ScoutHTTP.fetch(
            ScoutShellState.self,
            from: ScoutWeb.baseURL().appending(path: "api/shell-state")
        )
    }

    /// Probe once and classify. Returns `nil` when the probe itself is cancelled
    /// (inconclusive) so callers can leave the prior classification intact. Any
    /// other failure to reach shell-state means the local web service isn't
    /// answering, which is `webDown`.
    public func classify() async -> ScoutServiceHealth? {
        do {
            return ScoutServiceHealth.from(shellState: try await fetchShellState())
        } catch {
            if ScoutAppError.isCancellation(error) { return nil }
            return .webDown
        }
    }
}
