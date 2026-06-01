import Foundation
import SwiftUI

enum ScoutSection: String, CaseIterable, Identifiable {
    case comms
    case agents

    var id: String { rawValue }

    var title: String {
        switch self {
        case .comms: return "Comms"
        case .agents: return "Agents"
        }
    }

    var icon: String {
        switch self {
        case .comms: return "bubble.left.and.bubble.right"
        case .agents: return "person.2"
        }
    }
}

enum ScoutChannelScope {
    case direct
    case shared

    var label: String {
        switch self {
        case .direct: return "Private"
        case .shared: return "Shared"
        }
    }
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
        if scope == .direct {
            let peer = agentName?.nilIfEmpty
                ?? participantIds.first(where: { displayName(for: $0) != "Operator" }).map(displayName(for:))
                ?? displayTitle
            return uniqueMemberNames(["Operator", peer])
        }

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
}
