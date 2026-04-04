import Foundation

enum ScoutTmuxInventoryState: Equatable {
    case inactive
    case scanning
    case ready
    case unavailable
    case failed

    var title: String {
        switch self {
        case .inactive:
            return "Idle"
        case .scanning:
            return "Scanning"
        case .ready:
            return "Ready"
        case .unavailable:
            return "Unavailable"
        case .failed:
            return "Error"
        }
    }
}

struct ScoutTmuxInventorySession: Identifiable, Equatable {
    let id: String
    let hostID: String
    let hostLabel: String
    let target: String
    let sessionName: String
    let sessionID: String?
    let attached: Bool
    let windowCount: Int
    let createdAt: Date?
    let lastActivityAt: Date?
    let isRemote: Bool

    var laneLabel: String {
        isRemote ? "SSH" : "Local"
    }

    var detail: String {
        var parts: [String] = [
            attached ? "attached" : "idle",
            "\(windowCount) window\(windowCount == 1 ? "" : "s")",
        ]

        if let lastActivityAt {
            parts.append("active \(Self.relativeTime(lastActivityAt))")
        }

        return parts.joined(separator: " · ")
    }

    private static func relativeTime(_ date: Date) -> String {
        let age = max(0, Int(Date().timeIntervalSince(date)))
        if age < 60 {
            return "\(age)s ago"
        }
        if age < 3600 {
            return "\(age / 60)m ago"
        }
        if age < 86_400 {
            return "\(age / 3600)h ago"
        }

        return "\(age / 86_400)d ago"
    }
}

struct ScoutTmuxInventoryHostStatus: Identifiable, Equatable {
    let id: String
    let name: String
    let target: String
    let isRemote: Bool
    let sessionCount: Int
    let reachable: Bool
    let detail: String

    var displayValue: String {
        if reachable {
            return "\(sessionCount) session\(sessionCount == 1 ? "" : "s") · \(detail)"
        }

        return detail
    }
}

struct ScoutTmuxInventorySnapshot {
    let sessions: [ScoutTmuxInventorySession]
    let hosts: [ScoutTmuxInventoryHostStatus]
    let state: ScoutTmuxInventoryState
    let detail: String
    let lastError: String?
}

actor ScoutTmuxInventoryService {
    private static let tmuxFormat = [
        "#{session_name}",
        "#{session_id}",
        "#{session_attached}",
        "#{session_windows}",
        "#{session_created}",
        "#{session_activity}",
    ].joined(separator: "\t")

    func discover(meshNodes: [ScoutMeshNode]) async -> ScoutTmuxInventorySnapshot {
        let hosts = buildHosts(from: meshNodes)
        let outcomes = await withTaskGroup(of: ScoutTmuxHostOutcome.self) { group in
            for host in hosts {
                group.addTask {
                    await self.probe(host: host)
                }
            }

            var outcomes: [ScoutTmuxHostOutcome] = []
            for await outcome in group {
                outcomes.append(outcome)
            }

            return outcomes.sorted { lhs, rhs in
                if lhs.host.isRemote != rhs.host.isRemote {
                    return !lhs.host.isRemote
                }

                return lhs.host.name.localizedCaseInsensitiveCompare(rhs.host.name) == .orderedAscending
            }
        }

        let sessions = outcomes
            .flatMap(\.sessions)
            .sorted { lhs, rhs in
                if lhs.isRemote != rhs.isRemote {
                    return !lhs.isRemote
                }

                if lhs.hostLabel != rhs.hostLabel {
                    return lhs.hostLabel.localizedCaseInsensitiveCompare(rhs.hostLabel) == .orderedAscending
                }

                return lhs.sessionName.localizedCaseInsensitiveCompare(rhs.sessionName) == .orderedAscending
            }
        let hostStatuses = outcomes.map(\.status)
        let reachableHosts = hostStatuses.filter(\.reachable)
        let totalHosts = hostStatuses.count
        let totalSessions = sessions.count
        let lastError = hostStatuses.first(where: { !$0.reachable })?.detail
        let state: ScoutTmuxInventoryState
        let detail: String

        if totalHosts == 0 {
            state = .unavailable
            detail = "No local or mesh hosts are available for tmux discovery."
        } else if totalSessions > 0 {
            state = .ready
            detail = "Found \(totalSessions) tmux session\(totalSessions == 1 ? "" : "s") across \(reachableHosts.count) reachable host\(reachableHosts.count == 1 ? "" : "s")."
        } else if !reachableHosts.isEmpty {
            state = .ready
            detail = "Scanned \(reachableHosts.count) reachable host\(reachableHosts.count == 1 ? "" : "s"), but no tmux sessions were running."
        } else {
            state = .failed
            detail = "Tried \(totalHosts) host\(totalHosts == 1 ? "" : "s"), but none answered for tmux discovery."
        }

        return ScoutTmuxInventorySnapshot(
            sessions: sessions,
            hosts: hostStatuses,
            state: state,
            detail: detail,
            lastError: lastError
        )
    }

    private func buildHosts(from meshNodes: [ScoutMeshNode]) -> [ScoutTmuxHostProbe] {
        var hosts: [ScoutTmuxHostProbe] = [
            ScoutTmuxHostProbe(
                id: "local",
                name: ProcessInfo.processInfo.hostName,
                target: "local",
                isRemote: false
            )
        ]

        let remote = meshNodes.compactMap { node -> ScoutTmuxHostProbe? in
            guard !node.isLocal else {
                return nil
            }

            let target = node.hostName ?? node.brokerURL.host() ?? node.name
            guard !target.isEmpty else {
                return nil
            }

            return ScoutTmuxHostProbe(
                id: node.id,
                name: node.name,
                target: target,
                isRemote: true
            )
        }

        var seenTargets: Set<String> = ["local"]
        for host in remote {
            if seenTargets.insert(host.target).inserted {
                hosts.append(host)
            }
        }

        return hosts
    }

    private func probe(host: ScoutTmuxHostProbe) async -> ScoutTmuxHostOutcome {
        do {
            let result = try await runCommand(arguments: commandArguments(for: host))
            return buildOutcome(for: host, result: result)
        } catch {
            return ScoutTmuxHostOutcome(
                host: host,
                status: ScoutTmuxInventoryHostStatus(
                    id: host.id,
                    name: host.name,
                    target: host.target,
                    isRemote: host.isRemote,
                    sessionCount: 0,
                    reachable: false,
                    detail: error.localizedDescription
                ),
                sessions: []
            )
        }
    }

    private func commandArguments(for host: ScoutTmuxHostProbe) -> [String] {
        if host.isRemote {
            return [
                "ssh",
                "-o", "BatchMode=yes",
                "-o", "ConnectTimeout=2",
                host.target,
                "tmux",
                "list-sessions",
                "-F",
                Self.tmuxFormat,
            ]
        }

        return [
            "tmux",
            "list-sessions",
            "-F",
            Self.tmuxFormat,
        ]
    }

    private func buildOutcome(for host: ScoutTmuxHostProbe, result: ScoutCommandResult) -> ScoutTmuxHostOutcome {
        let output = result.output.trimmingCharacters(in: .whitespacesAndNewlines)

        if result.status == 0 {
            let sessions = parseSessions(output, host: host)
            let detail = sessions.isEmpty ? "No tmux sessions" : "tmux reachable"
            return ScoutTmuxHostOutcome(
                host: host,
                status: ScoutTmuxInventoryHostStatus(
                    id: host.id,
                    name: host.name,
                    target: host.target,
                    isRemote: host.isRemote,
                    sessionCount: sessions.count,
                    reachable: true,
                    detail: detail
                ),
                sessions: sessions
            )
        }

        if isNoSessionMessage(output) {
            return ScoutTmuxHostOutcome(
                host: host,
                status: ScoutTmuxInventoryHostStatus(
                    id: host.id,
                    name: host.name,
                    target: host.target,
                    isRemote: host.isRemote,
                    sessionCount: 0,
                    reachable: true,
                    detail: "No tmux server"
                ),
                sessions: []
            )
        }

        let detail = shortenedError(output.isEmpty ? "command exited with status \(result.status)" : output)
        return ScoutTmuxHostOutcome(
            host: host,
            status: ScoutTmuxInventoryHostStatus(
                id: host.id,
                name: host.name,
                target: host.target,
                isRemote: host.isRemote,
                sessionCount: 0,
                reachable: false,
                detail: detail
            ),
            sessions: []
        )
    }

    private func parseSessions(_ output: String, host: ScoutTmuxHostProbe) -> [ScoutTmuxInventorySession] {
        output
            .split(whereSeparator: \.isNewline)
            .compactMap { line -> ScoutTmuxInventorySession? in
                let fields = line.split(separator: "\t", omittingEmptySubsequences: false).map(String.init)
                guard fields.count >= 6 else {
                    return nil
                }

                let sessionName = fields[0]
                let sessionID = fields[1].isEmpty ? nil : fields[1]
                let attached = fields[2] == "1"
                let windowCount = Int(fields[3]) ?? 0
                let createdAt = Double(fields[4]).flatMap { $0 > 0 ? Date(timeIntervalSince1970: $0) : nil }
                let lastActivityAt = Double(fields[5]).flatMap { $0 > 0 ? Date(timeIntervalSince1970: $0) : nil }

                return ScoutTmuxInventorySession(
                    id: "\(host.id):\(sessionName)",
                    hostID: host.id,
                    hostLabel: host.name,
                    target: host.target,
                    sessionName: sessionName,
                    sessionID: sessionID,
                    attached: attached,
                    windowCount: windowCount,
                    createdAt: createdAt,
                    lastActivityAt: lastActivityAt,
                    isRemote: host.isRemote
                )
            }
    }

    private func runCommand(arguments: [String]) async throws -> ScoutCommandResult {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .utility).async {
                let process = Process()
                process.executableURL = URL(filePath: "/usr/bin/env")
                process.arguments = arguments

                let outputPipe = Pipe()
                process.standardOutput = outputPipe
                process.standardError = outputPipe

                do {
                    try process.run()
                    process.waitUntilExit()
                    let data = outputPipe.fileHandleForReading.readDataToEndOfFile()
                    let output = String(data: data, encoding: .utf8) ?? ""
                    continuation.resume(returning: ScoutCommandResult(status: process.terminationStatus, output: output))
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    private func isNoSessionMessage(_ output: String) -> Bool {
        let normalized = output.lowercased()
        return normalized.contains("failed to connect to server")
            || normalized.contains("no server running")
            || normalized.contains("can't find socket")
    }

    private func shortenedError(_ output: String) -> String {
        let trimmed = output.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.contains("operation timed out") || trimmed.contains("connect timeout") {
            return "Timed out"
        }
        if trimmed.contains("could not resolve hostname") || trimmed.contains("name or service not known") {
            return "Host lookup failed"
        }
        if trimmed.contains("permission denied") {
            return "SSH permission denied"
        }
        if trimmed.contains("connection refused") {
            return "Connection refused"
        }
        if trimmed.contains("command not found") || trimmed.contains("no such file") {
            return "tmux unavailable"
        }
        return trimmed.isEmpty ? "Probe failed" : trimmed
    }
}

private struct ScoutTmuxHostProbe {
    let id: String
    let name: String
    let target: String
    let isRemote: Bool
}

private struct ScoutTmuxHostOutcome {
    let host: ScoutTmuxHostProbe
    let status: ScoutTmuxInventoryHostStatus
    let sessions: [ScoutTmuxInventorySession]
}

private struct ScoutCommandResult {
    let status: Int32
    let output: String
}
