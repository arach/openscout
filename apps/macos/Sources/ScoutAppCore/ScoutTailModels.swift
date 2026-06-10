import Foundation

public enum ScoutTailEventKind: String, Decodable, Sendable, CaseIterable, Identifiable, Equatable {
    case user
    case assistant
    case tool
    case toolResult = "tool-result"
    case system
    case other

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .user: return "USER"
        case .assistant: return "ASST"
        case .tool: return "TOOL"
        case .toolResult: return "OUT"
        case .system: return "SYS"
        case .other: return "EVT"
        }
    }

    public var glyph: String {
        switch self {
        case .user: return ">"
        case .assistant: return "<"
        case .tool: return "*"
        case .toolResult: return "="
        case .system: return "~"
        case .other: return "·"
        }
    }

    public var title: String {
        switch self {
        case .user: return "User"
        case .assistant: return "Assistant"
        case .tool: return "Tool"
        case .toolResult: return "Tool result"
        case .system: return "System"
        case .other: return "Other"
        }
    }
}

public struct ScoutTailEvent: Identifiable, Decodable, Sendable, Equatable {
    public let id: String
    public let ts: TimeInterval
    public let source: String
    public let sessionId: String
    public let pid: Int
    public let parentPid: Int?
    public let project: String
    public let cwd: String
    public let harness: String
    public let kind: ScoutTailEventKind
    public let summary: String

    public var date: Date {
        Date(timeIntervalSince1970: ts > 10_000_000_000 ? ts / 1000 : ts)
    }

    public var clockLabel: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter.string(from: date)
    }

    public var ageLabel: String {
        ScoutRelativeTime.format(ts)
    }

    public var sourceLabel: String {
        source.isEmpty ? "unknown" : source.lowercased()
    }

    public var projectLabel: String {
        let trimmedProject = project.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedProject.isEmpty {
            return trimmedProject
        }
        return cwd.split(separator: "/").last.map(String.init) ?? "—"
    }

    public var sessionShortLabel: String {
        let trimmed = sessionId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "—" }
        return String(trimmed.prefix(8))
    }

    public var pidLabel: String {
        pid > 0 ? "\(pid)" : "log"
    }

    public var originLabel: String {
        switch harness {
        case "scout-managed": return "scout"
        case "hudson-managed": return "hudson"
        case "unattributed": return "native"
        default: return harness
        }
    }

    public var isLowSignalMetadata: Bool {
        if kind == .other || kind == .system {
            let normalized = summary
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased()
            if normalized.hasPrefix("last-prompt:") { return true }
            if normalized.hasPrefix("permission-mode") { return true }
            if normalized == "[ai-title]"
                || normalized == "[custom-title]"
                || normalized == "[agent-name]"
                || normalized == "[model]"
                || normalized == "[summary]" {
                return true
            }
        }
        return false
    }
}

public struct ScoutTailRecentPayload: Decodable, Sendable, Equatable {
    public let events: [ScoutTailEvent]
}

public struct ScoutTailDiscoverySnapshot: Decodable, Sendable, Equatable {
    public let generatedAt: TimeInterval
    public let processes: [ScoutTailDiscoveredProcess]
    public let transcripts: [ScoutTailDiscoveredTranscript]
    public let totals: ScoutTailDiscoveryTotals
}

public struct ScoutTailDiscoveredProcess: Identifiable, Decodable, Sendable, Equatable {
    public let pid: Int
    public let ppid: Int
    public let command: String
    public let etime: String
    public let cwd: String?
    public let harness: String
    public let source: String

    public var id: String { "\(source)-\(pid)" }
}

public struct ScoutTailDiscoveredTranscript: Identifiable, Decodable, Sendable, Equatable {
    public let source: String
    public let transcriptPath: String
    public let sessionId: String?
    public let cwd: String?
    public let project: String
    public let harness: String
    public let mtimeMs: TimeInterval
    public let size: Int

    public var id: String { "\(source)-\(transcriptPath)" }
}

public struct ScoutTailDiscoveryTotals: Decodable, Sendable, Equatable {
    public let total: Int
    public let scoutManaged: Int
    public let hudsonManaged: Int
    public let unattributed: Int
    public let transcripts: Int
}

public struct ScoutTailCount: Identifiable, Sendable {
    public let label: String
    public let count: Int

    public var id: String { label }

    public init(label: String, count: Int) {
        self.label = label
        self.count = count
    }
}
