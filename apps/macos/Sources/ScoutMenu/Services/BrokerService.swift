import Foundation
import ScoutCapabilities

enum BrokerControlAction: String {
    case install
    case start
    case stop
    case restart
}

struct BrokerServiceStatus: Decodable, Sendable {
    struct HealthSnapshot: Decodable, Sendable {
        let reachable: Bool
        let ok: Bool
        let error: String?
    }

    let restartTelemetry: BrokerRestartTelemetry?
    let label: String
    let launchAgentPath: String
    let brokerURL: String
    let webURL: String?
    let installed: Bool
    let loaded: Bool
    let pid: Int?
    let lastExitStatus: Int?
    let reachable: Bool
    let health: HealthSnapshot
    let lastLogLine: String?

    enum CodingKeys: String, CodingKey {
        case label
        case launchAgentPath
        case brokerURL = "brokerUrl"
        case effectiveBrokerURL = "effectiveBrokerUrl"
        case webURL = "webUrl"
        case effectiveWebURL = "effectiveWebUrl"
        case installed
        case loaded
        case pid
        case lastExitStatus
        case reachable
        case health
        case lastLogLine
        case scoutdState
        case daemonState
        case runtimeState
        case restartTelemetry
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.label = try container.decode(String.self, forKey: .label)
        self.launchAgentPath = try container.decode(String.self, forKey: .launchAgentPath)
        let configuredBrokerURL = try container.decode(String.self, forKey: .brokerURL)
        let effectiveBrokerURL = try container.decodeIfPresent(String.self, forKey: .effectiveBrokerURL)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        self.brokerURL = effectiveBrokerURL?.isEmpty == false ? effectiveBrokerURL! : configuredBrokerURL
        let configuredWebURL = try container.decodeIfPresent(String.self, forKey: .webURL)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let effectiveWebURL = try container.decodeIfPresent(String.self, forKey: .effectiveWebURL)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if let effectiveWebURL, !effectiveWebURL.isEmpty {
            self.webURL = effectiveWebURL
        } else if let configuredWebURL, !configuredWebURL.isEmpty {
            self.webURL = configuredWebURL
        } else {
            self.webURL = nil
        }
        self.installed = try container.decode(Bool.self, forKey: .installed)
        self.loaded = try container.decode(Bool.self, forKey: .loaded)
        self.pid = try container.decodeIfPresent(Int.self, forKey: .pid)
        self.lastExitStatus = try container.decodeIfPresent(Int.self, forKey: .lastExitStatus)
        self.reachable = try container.decode(Bool.self, forKey: .reachable)
        self.health = try container.decode(HealthSnapshot.self, forKey: .health)
        self.lastLogLine = try container.decodeIfPresent(String.self, forKey: .lastLogLine)

        let candidates = [
            try? container.decode(BrokerRestartTelemetry.self, forKey: .restartTelemetry),
            try? container.decode(BrokerRestartTelemetry.self, forKey: .scoutdState),
            try? container.decode(BrokerRestartTelemetry.self, forKey: .daemonState),
            try? container.decode(BrokerRestartTelemetry.self, forKey: .runtimeState),
            Self.decodeTelemetryString(container, forKey: .restartTelemetry),
            Self.decodeTelemetryString(container, forKey: .scoutdState),
            Self.decodeTelemetryString(container, forKey: .daemonState),
            Self.decodeTelemetryString(container, forKey: .runtimeState),
            try? BrokerRestartTelemetry(from: decoder),
        ]
        self.restartTelemetry = candidates.compactMap { $0 }.first { !$0.isEmpty }
    }

    private static func decodeTelemetryString(
        _ container: KeyedDecodingContainer<CodingKeys>,
        forKey key: CodingKeys
    ) -> BrokerRestartTelemetry? {
        guard let raw = try? container.decode(String.self, forKey: key),
              let data = raw.data(using: .utf8) else {
            return nil
        }
        return try? JSONDecoder().decode(BrokerRestartTelemetry.self, from: data)
    }
}

struct BrokerRestartTelemetry: Decodable, Sendable, Equatable {
    static let warningRestartThreshold = 3

    let restartCount: Int?
    let baseState: String?
    let basePid: Int?
    let scoutdPid: Int?
    let backoffMilliseconds: Int?
    let nextRestartAt: Date?
    let lastExitAt: Date?
    let lastRestartAt: Date?
    let startedAt: Date?
    let updatedAt: Date?

    var isEmpty: Bool {
        restartCount == nil
            && baseState == nil
            && basePid == nil
            && scoutdPid == nil
            && backoffMilliseconds == nil
            && nextRestartAt == nil
            && lastExitAt == nil
            && lastRestartAt == nil
            && startedAt == nil
            && updatedAt == nil
    }

    var shouldWarn: Bool {
        if hasActiveBackoff { return true }
        if isRestartPending {
            return true
        }
        return (restartCount ?? 0) >= Self.warningRestartThreshold
    }

    var hasActiveBackoff: Bool {
        guard let backoffMilliseconds, backoffMilliseconds > 0 else { return false }
        if isRestartPending { return true }

        // Older telemetry may only expose a backoff value while a restart is
        // pending. When the daemon says the base runtime is running, the value
        // is just the next delay it would use after a future exit.
        return normalizedBaseState == nil
    }

    var isRestartPending: Bool {
        guard let state = normalizedBaseState else { return false }
        return state == "exited"
            || state == "crashed"
            || state == "backoff"
            || state == "backing_off"
            || state == "backing-off"
            || state == "restarting"
    }

    func compactWarning(reachable: Bool) -> String {
        var parts: [String] = []
        if let restartCount {
            parts.append("Runtime restarted \(restartCount)x")
        } else {
            parts.append("Runtime restart warning")
        }

        if hasActiveBackoff, let backoffMilliseconds, backoffMilliseconds > 0 {
            parts.append("backoff \(Self.formatDuration(milliseconds: backoffMilliseconds))")
        } else if isRestartPending {
            parts.append("base \(baseState ?? "exited")")
        }

        if !reachable {
            parts.append("broker unreachable")
        }

        return parts.joined(separator: "; ")
    }

    func backoffLabel() -> String? {
        guard hasActiveBackoff, let backoffMilliseconds, backoffMilliseconds > 0 else { return nil }
        return Self.formatDuration(milliseconds: backoffMilliseconds)
    }

    private var normalizedBaseState: String? {
        let trimmed = baseState?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return trimmed?.isEmpty == false ? trimmed : nil
    }

    private enum CodingKeys: String, CodingKey {
        case restartCount
        case restart_count
        case restarts
        case baseState
        case base_state
        case childState
        case state
        case basePid
        case base_pid
        case childPid
        case child_pid
        case scoutdPid
        case scoutd_pid
        case backoffMs
        case backoffMillis
        case backoffMilliseconds
        case currentBackoffMs
        case currentBackoffMillis
        case currentBackoffMilliseconds
        case restartBackoffMs
        case restartBackoffMillis
        case restartBackoffMilliseconds
        case nextRestartDelayMs
        case nextRestartDelayMillis
        case nextRestartDelayMilliseconds
        case backoffSeconds
        case restartBackoffSeconds
        case currentBackoffSeconds
        case nextRestartDelaySeconds
        case nextRestartAt
        case nextRestartAtMs
        case nextRestartTime
        case next_restart_at
        case lastExitAt
        case lastExitAtMs
        case lastExitedAt
        case lastExitedAtMs
        case lastExitTime
        case last_exit_at
        case lastRestartAt
        case lastRestartAtMs
        case lastStartedAt
        case lastStartedAtMs
        case lastRestartTime
        case last_restart_at
        case startedAt
        case startedAtMs
        case started_at
        case updatedAt
        case updatedAtMs
        case updated_at
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.restartCount = Self.decodeInt(container, keys: [.restartCount, .restart_count, .restarts])
        self.baseState = Self.decodeString(container, keys: [.baseState, .base_state, .childState, .state])
        self.basePid = Self.decodeInt(container, keys: [.basePid, .base_pid, .childPid, .child_pid])
        self.scoutdPid = Self.decodeInt(container, keys: [.scoutdPid, .scoutd_pid])
        self.backoffMilliseconds = Self.decodeMilliseconds(
            container,
            millisecondKeys: [
                .backoffMs,
                .backoffMillis,
                .backoffMilliseconds,
                .currentBackoffMs,
                .currentBackoffMillis,
                .currentBackoffMilliseconds,
                .restartBackoffMs,
                .restartBackoffMillis,
                .restartBackoffMilliseconds,
                .nextRestartDelayMs,
                .nextRestartDelayMillis,
                .nextRestartDelayMilliseconds,
            ],
            secondKeys: [
                .backoffSeconds,
                .restartBackoffSeconds,
                .currentBackoffSeconds,
                .nextRestartDelaySeconds,
            ]
        )
        self.nextRestartAt = Self.decodeDate(container, keys: [.nextRestartAt, .nextRestartAtMs, .nextRestartTime, .next_restart_at])
        self.lastExitAt = Self.decodeDate(container, keys: [.lastExitAt, .lastExitAtMs, .lastExitedAt, .lastExitedAtMs, .lastExitTime, .last_exit_at])
        self.lastRestartAt = Self.decodeDate(container, keys: [.lastRestartAt, .lastRestartAtMs, .lastStartedAt, .lastStartedAtMs, .lastRestartTime, .last_restart_at])
        self.startedAt = Self.decodeDate(container, keys: [.startedAt, .startedAtMs, .started_at])
        self.updatedAt = Self.decodeDate(container, keys: [.updatedAt, .updatedAtMs, .updated_at])
    }

    private static func decodeString(
        _ container: KeyedDecodingContainer<CodingKeys>,
        keys: [CodingKeys]
    ) -> String? {
        for key in keys {
            if let value = try? container.decode(String.self, forKey: key) {
                let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty {
                    return trimmed
                }
            }
        }
        return nil
    }

    private static func decodeInt(
        _ container: KeyedDecodingContainer<CodingKeys>,
        keys: [CodingKeys]
    ) -> Int? {
        for key in keys {
            if let value = try? container.decode(Int.self, forKey: key) {
                return value
            }
            if let value = try? container.decode(Double.self, forKey: key) {
                return Int(value)
            }
            if let raw = try? container.decode(String.self, forKey: key),
               let value = Double(raw.trimmingCharacters(in: .whitespacesAndNewlines)) {
                return Int(value)
            }
        }
        return nil
    }

    private static func decodeDouble(
        _ container: KeyedDecodingContainer<CodingKeys>,
        key: CodingKeys
    ) -> Double? {
        if let value = try? container.decode(Double.self, forKey: key) {
            return value
        }
        if let value = try? container.decode(Int.self, forKey: key) {
            return Double(value)
        }
        if let raw = try? container.decode(String.self, forKey: key) {
            return Double(raw.trimmingCharacters(in: .whitespacesAndNewlines))
        }
        return nil
    }

    private static func decodeMilliseconds(
        _ container: KeyedDecodingContainer<CodingKeys>,
        millisecondKeys: [CodingKeys],
        secondKeys: [CodingKeys]
    ) -> Int? {
        for key in millisecondKeys {
            if let value = decodeDouble(container, key: key) {
                return Int(value)
            }
        }
        for key in secondKeys {
            if let value = decodeDouble(container, key: key) {
                return Int(value * 1000)
            }
        }
        return nil
    }

    private static func decodeDate(
        _ container: KeyedDecodingContainer<CodingKeys>,
        keys: [CodingKeys]
    ) -> Date? {
        for key in keys {
            if let value = decodeDouble(container, key: key) {
                return dateFromEpoch(value)
            }
            if let raw = try? container.decode(String.self, forKey: key),
               let date = parseDateString(raw) {
                return date
            }
        }
        return nil
    }

    private static func parseDateString(_ raw: String) -> Date? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if let value = Double(trimmed) {
            return dateFromEpoch(value)
        }

        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: trimmed) {
            return date
        }

        return ISO8601DateFormatter().date(from: trimmed)
    }

    private static func dateFromEpoch(_ value: Double) -> Date {
        ScoutTimestamp.date(fromEpoch: value) ?? Date(timeIntervalSince1970: 0)
    }

    private static func formatDuration(milliseconds: Int) -> String {
        if milliseconds < 1000 {
            return "\(milliseconds)ms"
        }
        let totalSeconds = Int((Double(milliseconds) / 1000).rounded())
        if totalSeconds < 60 {
            return "\(totalSeconds)s"
        }
        let minutes = totalSeconds / 60
        let seconds = totalSeconds % 60
        if seconds == 0 {
            return "\(minutes)m"
        }
        return "\(minutes)m \(seconds)s"
    }
}

@MainActor
struct BrokerService {
    private let toolchain = OpenScoutToolchain()
    private let decoder = JSONDecoder()

    func fetchStatus() async throws -> BrokerServiceStatus {
        try await run(subcommand: "status")
    }

    func control(_ action: BrokerControlAction) async throws -> BrokerServiceStatus {
        try await run(subcommand: action.rawValue)
    }

    private func run(subcommand: String) async throws -> BrokerServiceStatus {
        let descriptor = try toolchain.runtimeServiceCommand(subcommand: subcommand)
        let result = try await CommandRunner.run(descriptor)

        guard result.exitCode == 0 else {
            throw CommandRunnerError.nonZeroExit(
                result.trimmedStderr.isEmpty ? result.trimmedStdout : result.trimmedStderr
            )
        }

        let data = Data(result.trimmedStdout.utf8)
        do {
            return try decoder.decode(BrokerServiceStatus.self, from: data)
        } catch {
            throw CommandRunnerError.nonZeroExit(
                "Failed to decode broker service output: \(error.localizedDescription)"
            )
        }
    }
}
