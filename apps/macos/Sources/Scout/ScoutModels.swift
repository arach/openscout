import Foundation
import HudsonUI
import SwiftUI

enum ScoutSection: String, CaseIterable, Identifiable {
    case comms
    case agents
    case tail

    var id: String { rawValue }

    var title: String {
        switch self {
        case .comms: return "Comms"
        case .agents: return "Agents"
        case .tail: return "Tail"
        }
    }

    var icon: String {
        switch self {
        case .comms: return "bubble.left.and.bubble.right"
        case .agents: return "person.2"
        case .tail: return "waveform.path.ecg"
        }
    }
}

enum ScoutChannelScope {
    case direct
    case shared
}

struct ScoutChannel: Identifiable, Decodable, Sendable {
    let cId: String
    let kind: String
    let title: String
    let alias: String?
    let participantIds: [String]
    let agentId: String?
    let agentName: String?
    let harness: String?
    let preview: String?
    let messageCount: Int
    let lastMessageAt: TimeInterval?
    let workspaceRoot: String?
    let currentBranch: String?

    var id: String { cId }

    var displayTitle: String {
        alias?.nilIfEmpty ?? agentName?.nilIfEmpty ?? title
    }

    var scope: ScoutChannelScope {
        if kind == "direct", participantIds.count <= 2 {
            return .direct
        }
        return .shared
    }

    /// A DM is named by its other participant(s); operator (you) is implied.
    /// Agent-to-agent DMs (no operator) read as "agent1 <> agent2".
    var directPeerLabel: String {
        let peers = participantDisplayNames.filter { $0 != "Operator" }
        if peers.count >= 2 {
            return peers.joined(separator: " <> ")
        }
        let names = peers.isEmpty ? participantDisplayNames : peers
        return names.joined(separator: ", ").nilIfEmpty ?? displayTitle
    }

    /// Channel name without any leading "#" decoration.
    var channelName: String {
        displayTitle.trimmingCharacters(in: CharacterSet(charactersIn: "# ")).nilIfEmpty ?? displayTitle
    }

    /// Title shown next to the type icon (the icon already conveys #/person).
    var rowTitle: String {
        scope == .direct ? directPeerLabel : channelName
    }

    /// Self-describing title where there is no type icon (header, inspector).
    var displayHandle: String {
        scope == .direct ? directPeerLabel : "#\(channelName)"
    }

    var cIdShort: String {
        if cId.hasPrefix("c.") {
            return "cId \(String(cId.dropFirst(2).prefix(8)))"
        }
        if cId.hasPrefix("dm.") {
            return "cId legacy-dm"
        }
        if cId.hasPrefix("channel.") {
            return "cId #\(String(cId.dropFirst("channel.".count)))"
        }
        return cId.count > 16 ? "cId \(String(cId.prefix(12)))" : "cId \(cId)"
    }

    var participantDisplayNames: [String] {
        let names = participantIds.map(displayName(for:))
        return uniqueMemberNames(names.isEmpty ? [displayTitle] : names)
    }

    var ageLabel: String {
        ScoutRelativeTime.format(lastMessageAt)
    }

    enum CodingKeys: String, CodingKey {
        case cId
        case fallbackId = "id"
        case kind
        case title
        case alias
        case participantIds
        case agentId
        case agentName
        case harness
        case preview
        case messageCount
        case lastMessageAt
        case workspaceRoot
        case currentBranch
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        cId = try c.decodeIfPresent(String.self, forKey: .cId)
            ?? c.decode(String.self, forKey: .fallbackId)
        kind = try c.decode(String.self, forKey: .kind)
        title = try c.decode(String.self, forKey: .title)
        alias = try c.decodeIfPresent(String.self, forKey: .alias)
        participantIds = try c.decodeIfPresent([String].self, forKey: .participantIds) ?? []
        agentId = try c.decodeIfPresent(String.self, forKey: .agentId)
        agentName = try c.decodeIfPresent(String.self, forKey: .agentName)
        harness = try c.decodeIfPresent(String.self, forKey: .harness)
        preview = try c.decodeIfPresent(String.self, forKey: .preview)
        messageCount = try c.decodeIfPresent(Int.self, forKey: .messageCount) ?? 0
        lastMessageAt = try c.decodeIfPresent(TimeInterval.self, forKey: .lastMessageAt)
        workspaceRoot = try c.decodeIfPresent(String.self, forKey: .workspaceRoot)
        currentBranch = try c.decodeIfPresent(String.self, forKey: .currentBranch)
    }

    private func displayName(for participant: String) -> String {
        let trimmed = participant.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "Unknown" }
        if trimmed == "operator" { return "Operator" }
        if trimmed == agentId, let agentName = agentName?.nilIfEmpty { return agentName }
        if let agentName = agentName?.nilIfEmpty,
           trimmed.lowercased().contains(agentName.lowercased()) {
            return agentName
        }

        let withoutHandle = trimmed.trimmingCharacters(in: CharacterSet(charactersIn: "@"))
        let compact = withoutHandle.split(separator: ".").first.map(String.init) ?? withoutHandle
        return compact
            .replacingOccurrences(of: "-", with: " ")
            .split(separator: " ")
            .map { part in
                guard let first = part.first else { return "" }
                return first.uppercased() + part.dropFirst()
            }
            .joined(separator: " ")
    }
}

struct ScoutMessage: Identifiable, Decodable, Sendable {
    let id: String
    let cId: String
    let actorId: String?
    let actorName: String
    let body: String
    let createdAt: TimeInterval
    let messageClass: String

    var isOperator: Bool {
        actorId == "operator" || messageClass == "operator" || actorName.lowercased() == "operator"
    }

    enum CodingKeys: String, CodingKey {
        case id
        case cId
        case fallbackCId = "conversationId"
        case actorId
        case actorName
        case body
        case createdAt
        case messageClass = "class"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        cId = try c.decodeIfPresent(String.self, forKey: .cId)
            ?? c.decode(String.self, forKey: .fallbackCId)
        actorId = try c.decodeIfPresent(String.self, forKey: .actorId)
        actorName = try c.decodeIfPresent(String.self, forKey: .actorName)
            ?? actorId
            ?? "unknown"
        body = try c.decode(String.self, forKey: .body)
        createdAt = try c.decode(TimeInterval.self, forKey: .createdAt)
        messageClass = try c.decodeIfPresent(String.self, forKey: .messageClass) ?? "message"
    }
}

enum ScoutAgentState: String, Sendable, Decodable {
    case working
    case available
    case offline
    case done
    case needsAttention = "needs-attention"

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        self = Self.from(raw: try? container.decode(String.self))
    }

    static func from(raw: String?) -> ScoutAgentState {
        switch (raw ?? "offline").lowercased().replacingOccurrences(of: "_", with: "-") {
        case "working", "running", "waking", "queued":
            return .working
        case "waiting", "blocked", "needs-attention", "needsattention", "on-you":
            return .needsAttention
        case "available", "idle", "ready":
            return .available
        case "done", "completed", "complete":
            return .done
        default:
            return .offline
        }
    }

    var label: String {
        switch self {
        case .working: return "Working"
        case .available: return "Available"
        case .offline: return "Offline"
        case .done: return "Done"
        case .needsAttention: return "Needs attention"
        }
    }

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

struct ScoutAgent: Identifiable, Decodable, Sendable {
    let id: String
    let name: String
    let handle: String?
    let harness: String?
    let state: ScoutAgentState
    let role: String?
    let projectRoot: String?
    let cwd: String?
    let project: String?
    let branch: String?
    let selector: String?
    let model: String?
    let transport: String?
    let capabilities: [String]
    let nodeName: String?
    let conversationId: String?
    let harnessSessionId: String?
    let updatedAt: TimeInterval?

    var displayName: String { name.nilIfEmpty ?? handle?.nilIfEmpty ?? id }
    var detail: String { [role, harness, transport].compactMap { $0?.nilIfEmpty }.joined(separator: " · ") }
    var workspace: String { projectRoot?.nilIfEmpty ?? cwd?.nilIfEmpty ?? project?.nilIfEmpty ?? "—" }
    var branchLabel: String { branch?.nilIfEmpty ?? "—" }
    var updatedLabel: String { ScoutRelativeTime.format(updatedAt) }
    var roleLabel: String { role?.nilIfEmpty ?? "Session agent" }
    var modelDisplayValue: String {
        if let model = model?.nilIfEmpty { return model }
        if harness?.nilIfEmpty?.lowercased() == "codex" { return "Default" }
        return "—"
    }
    var modelDisplayNote: String? {
        guard model?.nilIfEmpty == nil else { return nil }
        if harness?.nilIfEmpty?.lowercased() == "codex" {
            return "No explicit model was declared by this Codex session."
        }
        return nil
    }

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case handle
        case harness
        case state
        case role
        case projectRoot
        case cwd
        case project
        case branch
        case selector
        case model
        case transport
        case capabilities
        case authorityNodeName
        case homeNodeName
        case conversationId
        case harnessSessionId
        case updatedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? id
        handle = try c.decodeIfPresent(String.self, forKey: .handle)
        harness = try c.decodeIfPresent(String.self, forKey: .harness)
        state = ScoutAgentState.from(raw: try c.decodeIfPresent(String.self, forKey: .state))
        role = try c.decodeIfPresent(String.self, forKey: .role)
        projectRoot = try c.decodeIfPresent(String.self, forKey: .projectRoot)
        cwd = try c.decodeIfPresent(String.self, forKey: .cwd)
        project = try c.decodeIfPresent(String.self, forKey: .project)
        branch = try c.decodeIfPresent(String.self, forKey: .branch)
        selector = try c.decodeIfPresent(String.self, forKey: .selector)
        model = try c.decodeIfPresent(String.self, forKey: .model)
        transport = try c.decodeIfPresent(String.self, forKey: .transport)
        capabilities = try c.decodeIfPresent([String].self, forKey: .capabilities) ?? []
        nodeName = try c.decodeIfPresent(String.self, forKey: .authorityNodeName)
            ?? c.decodeIfPresent(String.self, forKey: .homeNodeName)
        conversationId = try c.decodeIfPresent(String.self, forKey: .conversationId)
        harnessSessionId = try c.decodeIfPresent(String.self, forKey: .harnessSessionId)
        updatedAt = try c.decodeIfPresent(TimeInterval.self, forKey: .updatedAt)
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

enum ScoutTailEventKind: String, Decodable, Sendable, CaseIterable, Identifiable {
    case user
    case assistant
    case tool
    case toolResult = "tool-result"
    case system
    case other

    var id: String { rawValue }

    var label: String {
        switch self {
        case .user: return "USER"
        case .assistant: return "ASST"
        case .tool: return "TOOL"
        case .toolResult: return "OUT"
        case .system: return "SYS"
        case .other: return "EVT"
        }
    }

    var glyph: String {
        switch self {
        case .user: return ">"
        case .assistant: return "<"
        case .tool: return "*"
        case .toolResult: return "="
        case .system: return "~"
        case .other: return "·"
        }
    }

    var title: String {
        switch self {
        case .user: return "User"
        case .assistant: return "Assistant"
        case .tool: return "Tool"
        case .toolResult: return "Tool result"
        case .system: return "System"
        case .other: return "Other"
        }
    }

    var tint: Color {
        switch self {
        case .user: return ScoutPalette.statusInfo
        case .assistant: return ScoutPalette.accent
        case .tool: return .cyan
        case .toolResult: return .orange
        case .system: return ScoutPalette.muted
        case .other: return ScoutPalette.dim
        }
    }
}

struct ScoutTailEvent: Identifiable, Decodable, Sendable {
    let id: String
    let ts: TimeInterval
    let source: String
    let sessionId: String
    let pid: Int
    let parentPid: Int?
    let project: String
    let cwd: String
    let harness: String
    let kind: ScoutTailEventKind
    let summary: String

    var date: Date {
        Date(timeIntervalSince1970: ts > 10_000_000_000 ? ts / 1000 : ts)
    }

    var clockLabel: String {
        Self.clockFormatter.string(from: date)
    }

    var ageLabel: String {
        ScoutRelativeTime.format(ts)
    }

    var sourceLabel: String {
        source.isEmpty ? "unknown" : source.lowercased()
    }

    var projectLabel: String {
        project.nilIfEmpty ?? cwd.split(separator: "/").last.map(String.init) ?? "—"
    }

    var sessionShortLabel: String {
        let trimmed = sessionId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "—" }
        return String(trimmed.prefix(8))
    }

    var pidLabel: String {
        pid > 0 ? "\(pid)" : "log"
    }

    var originLabel: String {
        switch harness {
        case "scout-managed": return "scout"
        case "hudson-managed": return "hudson"
        case "unattributed": return "native"
        default: return harness
        }
    }

    var isLowSignalMetadata: Bool {
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

    private static let clockFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        return formatter
    }()
}

struct ScoutTailRecentPayload: Decodable, Sendable {
    let events: [ScoutTailEvent]
}

struct ScoutTailDiscoverySnapshot: Decodable, Sendable {
    let generatedAt: TimeInterval
    let processes: [ScoutTailDiscoveredProcess]
    let transcripts: [ScoutTailDiscoveredTranscript]
    let totals: ScoutTailDiscoveryTotals
}

struct ScoutTailDiscoveredProcess: Identifiable, Decodable, Sendable {
    let pid: Int
    let ppid: Int
    let command: String
    let etime: String
    let cwd: String?
    let harness: String
    let source: String

    var id: String { "\(source)-\(pid)" }
}

struct ScoutTailDiscoveredTranscript: Identifiable, Decodable, Sendable {
    let source: String
    let transcriptPath: String
    let sessionId: String?
    let cwd: String?
    let project: String
    let harness: String
    let mtimeMs: TimeInterval
    let size: Int

    var id: String { "\(source)-\(transcriptPath)" }
}

struct ScoutTailDiscoveryTotals: Decodable, Sendable {
    let total: Int
    let scoutManaged: Int
    let hudsonManaged: Int
    let unattributed: Int
    let transcripts: Int
}

enum ScoutRelativeTime {
    static func format(_ raw: TimeInterval?, now: Date = Date()) -> String {
        guard let raw else { return "—" }
        let seconds = raw > 10_000_000_000 ? raw / 1000 : raw
        let delta = max(0, Int(now.timeIntervalSince(Date(timeIntervalSince1970: seconds))))
        if delta < 60 { return "\(delta)s" }
        if delta < 3600 { return "\(delta / 60)m" }
        if delta < 86_400 {
            let h = delta / 3600
            let m = (delta % 3600) / 60
            return m == 0 ? "\(h)h" : "\(h)h \(m)m"
        }
        return "\(delta / 86_400)d"
    }
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
