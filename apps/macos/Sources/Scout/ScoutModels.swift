import Foundation
import HudsonUI
import ScoutAppCore
import SwiftUI

enum ScoutSection: String, CaseIterable, Identifiable {
    case comms
    case agents
    case terminals
    case tail
    case dispatch
    case lanes
    case repos
    case settings

    var id: String { rawValue }

    var title: String {
        switch self {
        case .comms: return "Comms"
        case .agents: return "Agents"
        case .terminals: return "Terminals"
        case .tail: return "Tail"
        case .dispatch: return "Dispatch"
        case .lanes: return "Lanes"
        case .repos: return "Repos"
        case .settings: return "Settings"
        }
    }

    var icon: String {
        switch self {
        case .comms: return "bubble.left.and.bubble.right"
        case .agents: return "person.2"
        case .terminals: return "terminal"
        case .tail: return "waveform.path.ecg"
        case .dispatch: return "paperplane"
        case .lanes: return "rectangle.split.3x1"
        case .repos: return "arrow.triangle.branch"
        case .settings: return "gearshape"
        }
    }

    var selectedIcon: String {
        switch self {
        case .comms: return "bubble.left.and.bubble.right.fill"
        case .agents: return "person.2.fill"
        case .terminals, .tail, .dispatch, .lanes, .repos: return icon
        case .settings: return "gearshape.fill"
        }
    }
}

typealias ScoutChannelScope = ScoutAppCore.ScoutChannelScope
typealias ScoutChannel = ScoutAppCore.ScoutChannel
typealias ScoutMessage = ScoutAppCore.ScoutMessage
typealias ScoutAgentState = ScoutAppCore.ScoutAgentState
typealias ScoutAgent = ScoutAppCore.ScoutAgent

extension ScoutAgentState {
    var tint: Color {
        switch self {
        case .working: return .green
        case .available: return .cyan
        case .offline: return .gray
        case .done: return .blue
        case .needsAttention: return .orange
        }
    }
}

extension ScoutTailEventKind {
    /// Token-only tone per kind (no raw system colors), matching the
    /// `scout-tail` study: three distinct hero hues for the high-signal kinds
    /// and neutrals for the rest.
    var tint: Color {
        switch self {
        case .user: return ScoutPalette.accent
        case .assistant: return ScoutPalette.statusOk
        case .tool: return ScoutPalette.statusWarn
        case .toolResult: return ScoutPalette.statusInfo
        case .system: return ScoutPalette.muted
        case .other: return ScoutPalette.dim
        }
    }
}

struct ScoutObservePayload: Decodable, Sendable {
    let agentId: String
    let source: String
    let fidelity: String
    let historyPath: String?
    let sessionId: String?
    let updatedAt: TimeInterval
    let data: ScoutObserveData

    var updatedLabel: String {
        ScoutRelativeTime.format(updatedAt)
    }
}

struct ScoutObserveData: Decodable, Sendable {
    let events: [ScoutObserveEvent]
    let files: [ScoutObserveFile]
    let contextUsage: [Double]
    let live: Bool
    let metadata: ScoutObserveMetadata?

    enum CodingKeys: String, CodingKey {
        case events
        case files
        case contextUsage
        case live
        case metadata
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        events = try c.decodeIfPresent([ScoutObserveEvent].self, forKey: .events) ?? []
        files = try c.decodeIfPresent([ScoutObserveFile].self, forKey: .files) ?? []
        contextUsage = try c.decodeIfPresent([Double].self, forKey: .contextUsage) ?? []
        live = try c.decodeIfPresent(Bool.self, forKey: .live) ?? false
        metadata = try c.decodeIfPresent(ScoutObserveMetadata.self, forKey: .metadata)
    }
}

enum ScoutObserveEventKind: String, Decodable, Sendable {
    case think
    case tool
    case ask
    case message
    case note
    case system
    case boot
    case unknown

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        self = Self(rawValue: (try? container.decode(String.self)) ?? "") ?? .unknown
    }
}

struct ScoutObserveEvent: Identifiable, Decodable, Sendable {
    let id: String
    let t: TimeInterval
    let kind: ScoutObserveEventKind
    let text: String
    let tool: String?
    let arg: String?
    let diff: ScoutObserveDiff?
    let result: [String: ScoutObserveValue]
    let stream: [String]
    let live: Bool
    let to: String?
    let answer: String?
    let answerT: TimeInterval?
    let detail: String?

    var timelineLabel: String {
        if t >= 1_000_000_000 {
            return ScoutRelativeTime.format(t)
        }

        let totalSeconds = max(0, Int(t.rounded()))
        let hours = totalSeconds / 3600
        let minutes = (totalSeconds % 3600) / 60
        let seconds = totalSeconds % 60
        if hours > 0 {
            return "\(hours):\(Self.padded(minutes)):\(Self.padded(seconds))"
        }
        return "\(Self.padded(minutes)):\(Self.padded(seconds))"
    }

    private static func padded(_ value: Int) -> String {
        value < 10 ? "0\(value)" : "\(value)"
    }

    enum CodingKeys: String, CodingKey {
        case id
        case t
        case kind
        case text
        case tool
        case arg
        case diff
        case result
        case stream
        case live
        case to
        case answer
        case answerT
        case detail
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        t = try c.decodeIfPresent(TimeInterval.self, forKey: .t) ?? 0
        kind = try c.decodeIfPresent(ScoutObserveEventKind.self, forKey: .kind) ?? .unknown
        text = try c.decodeIfPresent(String.self, forKey: .text) ?? ""
        tool = try c.decodeIfPresent(String.self, forKey: .tool)
        arg = try c.decodeIfPresent(String.self, forKey: .arg)
        diff = try c.decodeIfPresent(ScoutObserveDiff.self, forKey: .diff)
        result = try c.decodeIfPresent([String: ScoutObserveValue].self, forKey: .result) ?? [:]
        stream = try c.decodeIfPresent([String].self, forKey: .stream) ?? []
        live = try c.decodeIfPresent(Bool.self, forKey: .live) ?? false
        to = try c.decodeIfPresent(String.self, forKey: .to)
        answer = try c.decodeIfPresent(String.self, forKey: .answer)
        answerT = try c.decodeIfPresent(TimeInterval.self, forKey: .answerT)
        detail = try c.decodeIfPresent(String.self, forKey: .detail)
    }
}

struct ScoutObserveDiff: Decodable, Sendable {
    let add: Int
    let del: Int
    let preview: String

    enum CodingKeys: String, CodingKey {
        case add
        case del
        case preview
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        add = try c.decodeIfPresent(Int.self, forKey: .add) ?? 0
        del = try c.decodeIfPresent(Int.self, forKey: .del) ?? 0
        preview = try c.decodeIfPresent(String.self, forKey: .preview) ?? ""
    }
}

struct ScoutObserveFile: Identifiable, Decodable, Sendable {
    let path: String
    let state: String
    let touches: Int
    let lastT: TimeInterval

    var id: String { path }
    var ageLabel: String { ScoutRelativeTime.format(lastT) }

    enum CodingKeys: String, CodingKey {
        case path
        case state
        case touches
        case lastT
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        path = try c.decodeIfPresent(String.self, forKey: .path) ?? "unknown"
        state = try c.decodeIfPresent(String.self, forKey: .state) ?? "read"
        touches = try c.decodeIfPresent(Int.self, forKey: .touches) ?? 0
        lastT = try c.decodeIfPresent(TimeInterval.self, forKey: .lastT) ?? 0
    }
}

enum ScoutObserveValue: Decodable, Sendable, CustomStringConvertible, Hashable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let bool = try? container.decode(Bool.self) {
            self = .bool(bool)
        } else if let int = try? container.decode(Int.self) {
            self = .number(Double(int))
        } else if let double = try? container.decode(Double.self) {
            self = .number(double)
        } else if let string = try? container.decode(String.self) {
            self = .string(string)
        } else {
            self = .string("—")
        }
    }

    var description: String {
        switch self {
        case .string(let value):
            return value
        case .number(let value):
            if value.rounded() == value {
                return String(Int(value))
            }
            return String(format: "%.2f", value)
        case .bool(let value):
            return value ? "true" : "false"
        case .null:
            return "—"
        }
    }
}

struct ScoutObserveMetadata: Decodable, Sendable {
    let session: ScoutObserveSessionMeta?
    let usage: ScoutObserveUsageMeta?
}

struct ScoutObserveSessionMeta: Decodable, Sendable {
    let adapterType: String?
    let model: String?
    let cwd: String?
    let sessionStart: TimeInterval?
    let turnCount: Int?
    let externalSessionId: String?
    let threadId: String?
    let threadPath: String?
    let gitBranch: String?
    let cliVersion: String?
    let entrypoint: String?
    let originator: String?
    let source: String?
    let permissionMode: String?
    let approvalPolicy: String?
    let sandbox: String?
    let userType: String?
    let effort: String?
    let modelProvider: String?
    let timezone: String?
}

struct ScoutObserveUsageMeta: Decodable, Sendable {
    let assistantMessages: Int?
    let inputTokens: Int?
    let outputTokens: Int?
    let reasoningOutputTokens: Int?
    let cacheReadInputTokens: Int?
    let cacheCreationInputTokens: Int?
    let totalTokens: Int?
    let contextWindowTokens: Int?
    let webSearchRequests: Int?
    let webFetchRequests: Int?
    let serviceTier: String?
    let speed: String?
    let planType: String?
}

func uniqueMemberNames(_ names: [String]) -> [String] {
    var result: [String] = []
    for name in names {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { continue }
        if !result.contains(where: { $0.caseInsensitiveCompare(trimmed) == .orderedSame }) {
            result.append(trimmed)
        }
    }
    return result
}

extension String {
    var nilIfEmpty: String? {
        trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : self
    }

    var agentMetadataTitle: String {
        split(whereSeparator: { $0 == "-" || $0 == "_" || $0 == "." })
            .map { part in
                guard let first = part.first else { return "" }
                return first.uppercased() + part.dropFirst().lowercased()
            }
            .joined(separator: " ")
    }
}
