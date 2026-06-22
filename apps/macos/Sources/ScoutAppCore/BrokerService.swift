import Foundation
import ScoutCapabilities

public enum BrokerControlAction: String {
    case install
    case start
    case stop
    case restart
}

public struct BrokerServiceStatus: Decodable, Sendable {
    public struct HealthSnapshot: Decodable, Sendable {
        public let reachable: Bool
        public let ok: Bool
        public let error: String?
    }

    public let restartTelemetry: BrokerRestartTelemetry?
    public let label: String
    public let launchAgentPath: String
    public let brokerURL: String
    public let installed: Bool
    public let loaded: Bool
    public let pid: Int?
    public let lastExitStatus: Int?
    public let reachable: Bool
    public let health: HealthSnapshot
    public let lastLogLine: String?

    enum CodingKeys: String, CodingKey {
        case label
        case launchAgentPath
        case brokerURL = "brokerUrl"
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

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.label = try container.decode(String.self, forKey: .label)
        self.launchAgentPath = try container.decode(String.self, forKey: .launchAgentPath)
        self.brokerURL = try container.decode(String.self, forKey: .brokerURL)
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

public struct BrokerRestartTelemetry: Decodable, Sendable, Equatable {
    static let warningRestartThreshold = 3

    public let restartCount: Int?
    public let baseState: String?
    public let basePid: Int?
    public let scoutdPid: Int?
    public let backoffMilliseconds: Int?
    public let nextRestartAt: Date?
    public let lastExitAt: Date?
    public let lastRestartAt: Date?
    public let startedAt: Date?
    public let updatedAt: Date?

    public var isEmpty: Bool {
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

    public var shouldWarn: Bool {
        if let backoffMilliseconds, backoffMilliseconds > 0 {
            return true
        }
        if isRestartPending {
            return true
        }
        return (restartCount ?? 0) >= Self.warningRestartThreshold
    }

    public var isRestartPending: Bool {
        guard let state = normalizedBaseState else { return false }
        return state == "exited"
            || state == "crashed"
            || state == "backoff"
            || state == "backing_off"
            || state == "backing-off"
            || state == "restarting"
    }

    public func compactWarning(reachable: Bool) -> String {
        var parts: [String] = []
        if let restartCount {
            parts.append("Runtime restarted \(restartCount)x")
        } else {
            parts.append("Runtime restart warning")
        }

        if let backoffMilliseconds, backoffMilliseconds > 0 {
            parts.append("backoff \(Self.formatDuration(milliseconds: backoffMilliseconds))")
        } else if isRestartPending {
            parts.append("base \(baseState ?? "exited")")
        }

        if !reachable {
            parts.append("broker unreachable")
        }

        return parts.joined(separator: "; ")
    }

    public func backoffLabel() -> String? {
        guard let backoffMilliseconds, backoffMilliseconds > 0 else { return nil }
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

    public init(from decoder: Decoder) throws {
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
public struct BrokerService {
    private let toolchain = OpenScoutToolchain()
    private let decoder = JSONDecoder()

    public init() {}

    public func fetchStatus() async throws -> BrokerServiceStatus {
        try await run(subcommand: "status")
    }

    public func control(_ action: BrokerControlAction) async throws -> BrokerServiceStatus {
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
