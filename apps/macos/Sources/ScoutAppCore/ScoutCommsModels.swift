import Foundation

public enum ScoutChannelScope: Sendable, Equatable {
    case direct
    case shared
}

public enum ScoutAskState: String, Decodable, Sendable, Equatable {
    case answered
    case pending
}

public struct ScoutChannelAsk: Decodable, Sendable, Equatable {
    public let from: String       // who asked (display name, e.g. "Art" or an agent name)
    public let text: String       // the originating ask text
    public let state: ScoutAskState
}

public struct ScoutChannel: Identifiable, Decodable, Sendable, Equatable {
    public let cId: String
    public let kind: String
    public let title: String
    public let alias: String?
    public let participantIds: [String]
    public let agentId: String?
    public let agentName: String?
    public let harness: String?
    public let preview: String?
    public let messageCount: Int
    public let lastMessageAt: TimeInterval?
    public let workspaceRoot: String?
    public let currentBranch: String?
    public let unreadCount: Int
    public let ask: ScoutChannelAsk?

    public var id: String { cId }

    public var displayTitle: String {
        nilIfEmpty(alias) ?? nilIfEmpty(agentName) ?? title
    }

    public var scope: ScoutChannelScope {
        if kind == "direct", participantIds.count <= 2 {
            return .direct
        }
        return .shared
    }

    public var scopeLabel: String {
        switch scope {
        case .direct: return "Private"
        case .shared: return "Shared"
        }
    }

    /// A DM is named by its other participant(s); operator (you) is implied.
    /// Agent-to-agent DMs (no operator) read as "agent1 <> agent2".
    public var directPeerLabel: String {
        let peers = participantDisplayNames.filter { $0 != "Operator" }
        if peers.count >= 2 {
            return peers.joined(separator: " <> ")
        }
        let names = peers.isEmpty ? participantDisplayNames : peers
        return nilIfEmpty(names.joined(separator: ", ")) ?? displayTitle
    }

    /// Channel name without any leading "#" decoration.
    public var channelName: String {
        nilIfEmpty(displayTitle.trimmingCharacters(in: CharacterSet(charactersIn: "# "))) ?? displayTitle
    }

    /// Title shown next to the type icon (the icon already conveys #/person).
    public var rowTitle: String {
        scope == .direct ? directPeerLabel : channelName
    }

    /// Self-describing title where there is no type icon (header, inspector).
    public var displayHandle: String {
        scope == .direct ? directPeerLabel : "#\(channelName)"
    }

    public var cIdShort: String {
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

    public var participantDisplayNames: [String] {
        if scope == .direct {
            let peer = nilIfEmpty(agentName)
                ?? participantIds.first(where: { displayName(for: $0) != "Operator" }).map(displayName(for:))
                ?? displayTitle
            return uniqueMemberNames(["Operator", peer])
        }

        let names = participantIds.map(displayName(for:))
        return uniqueMemberNames(names.isEmpty ? [displayTitle] : names)
    }

    public var ageLabel: String {
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
        case unreadCount
        case ask
    }

    public init(from decoder: Decoder) throws {
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
        unreadCount = try c.decodeIfPresent(Int.self, forKey: .unreadCount) ?? 0
        ask = try c.decodeIfPresent(ScoutChannelAsk.self, forKey: .ask)
    }

    private func displayName(for participant: String) -> String {
        let trimmed = participant.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "Unknown" }
        if trimmed == "operator" { return "Operator" }
        if trimmed == agentId, let agentName = nilIfEmpty(agentName) { return agentName }
        if let agentName = nilIfEmpty(agentName),
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

public struct ScoutMessage: Identifiable, Decodable, Sendable, Equatable {
    public let id: String
    public let cId: String
    public let actorId: String?
    public let actorName: String
    public let body: String
    public let createdAt: TimeInterval
    public let messageClass: String

    public var isOperator: Bool {
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

    public init(from decoder: Decoder) throws {
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

public enum ScoutAgentState: String, Sendable, Decodable, Equatable {
    case working
    case available
    case offline
    case done
    case needsAttention = "needs-attention"

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        self = Self.from(raw: try? container.decode(String.self))
    }

    public static func from(raw: String?) -> ScoutAgentState {
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

    public var label: String {
        switch self {
        case .working: return "Working"
        case .available: return "Available"
        case .offline: return "Offline"
        case .done: return "Done"
        case .needsAttention: return "Needs attention"
        }
    }
}

public struct ScoutAgent: Identifiable, Decodable, Sendable, Equatable {
    public let id: String
    public let name: String
    public let handle: String?
    public let agentClass: String?
    public let harness: String?
    public let state: ScoutAgentState
    public let role: String?
    public let projectRoot: String?
    public let cwd: String?
    public let project: String?
    public let branch: String?
    public let selector: String?
    public let model: String?
    public let transport: String?
    public let capabilities: [String]
    public let nodeName: String?
    public let conversationId: String?
    public let harnessSessionId: String?
    public let updatedAt: TimeInterval?
    public let createdAt: TimeInterval?

    public var displayName: String { nilIfEmpty(name) ?? nilIfEmpty(handle) ?? id }
    public var detail: String { [role, harness, transport].compactMap(nilIfEmpty).joined(separator: " · ") }
    public var workspace: String { nilIfEmpty(projectRoot) ?? nilIfEmpty(cwd) ?? nilIfEmpty(project) ?? "—" }
    public var branchLabel: String { nilIfEmpty(branch) ?? "—" }
    public var updatedLabel: String { ScoutRelativeTime.format(updatedAt) }
    public var roleLabel: String { nilIfEmpty(role) ?? "Session agent" }
    public var modelDisplayValue: String {
        if let model = nilIfEmpty(model) { return model }
        if nilIfEmpty(harness)?.lowercased() == "codex" { return "Default" }
        return "—"
    }
    public var modelDisplayNote: String? {
        guard nilIfEmpty(model) == nil else { return nil }
        if nilIfEmpty(harness)?.lowercased() == "codex" {
            return "No explicit model was declared by this Codex session."
        }
        return nil
    }
    public var hue: Double { ScoutAgentHue.forAgent(name: name, handle: handle) }
    public var ago: String { updatedLabel }
    public var runtime: String { Self.formatRuntime(createdAtMs: createdAt) }
    public var hudRole: String {
        let left = nilIfEmpty(role) ?? nilIfEmpty(project) ?? nilIfEmpty(agentClass) ?? "agent"
        if let harness = nilIfEmpty(harness) {
            return "\(left) · \(harness)"
        }
        return left
    }
    public var lastTurn: String {
        Self.makeSummary(
            state: state,
            harness: harness,
            transport: transport,
            project: project,
            cwd: cwd,
            nodeName: nodeName,
            selector: selector
        )
    }
    public var lastMessage: ScoutAgentMessage? { nil }
    public var pendingAsk: String? {
        state == .needsAttention ? "waiting for operator input" : nil
    }
    public var files: Int { capabilities.count }
    public var tokens: String {
        nilIfEmpty(model) ?? nilIfEmpty(harness) ?? nilIfEmpty(transport) ?? "—"
    }

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case handle
        case agentClass
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
        case createdAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? id
        handle = try c.decodeIfPresent(String.self, forKey: .handle)
        agentClass = try c.decodeIfPresent(String.self, forKey: .agentClass)
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
        createdAt = try c.decodeIfPresent(TimeInterval.self, forKey: .createdAt)
    }

    public static func formatAgo(sinceMs: TimeInterval?, now: Date = Date()) -> String {
        ScoutRelativeTime.format(sinceMs, now: now)
    }

    private static func formatRuntime(createdAtMs: TimeInterval?, now: Date = Date()) -> String {
        guard let createdAtMs else { return "—" }
        let then = Date(timeIntervalSince1970: createdAtMs / 1000)
        let delta = max(0, Int(now.timeIntervalSince(then)))
        if delta < 60 { return "\(delta)s" }
        if delta < 3600 { return "\(delta / 60)m" }
        if delta < 86_400 {
            let h = delta / 3600
            let m = (delta % 3600) / 60
            return m == 0 ? "\(h)h" : "\(h)h \(m)m"
        }
        return "\(delta / 86_400)d"
    }

    private static func makeSummary(
        state: ScoutAgentState,
        harness: String?,
        transport: String?,
        project: String?,
        cwd: String?,
        nodeName: String?,
        selector: String?
    ) -> String {
        let status: String = switch state {
        case .working: "Working"
        case .needsAttention: "Waiting on the operator"
        case .available: "Available"
        case .done: "Done"
        case .offline: "Offline"
        }
        let runtime = [harness, transport].compactMap(nilIfEmpty).joined(separator: " · ")
        let scope = nilIfEmpty(project) ?? nilIfEmpty(cwd) ?? nilIfEmpty(nodeName) ?? nilIfEmpty(selector) ?? "broker-visible fleet"
        if runtime.isEmpty {
            return "\(status) in \(scope)."
        }
        return "\(status) via \(runtime) in \(scope)."
    }
}

public struct ScoutAgentMessage: Sendable, Equatable {
    public let to: String
    public let text: String

    public init(to: String, text: String) {
        self.to = to
        self.text = text
    }
}

public enum ScoutAgentHue {
    public static let scout: Double  = 125
    public static let hudson: Double = 210
    public static let qb: Double     = 25
    public static let cody: Double   = 85
    public static let ranger: Double = 295
    public static let vox: Double    = 340
    public static let atlas: Double  = 175
    public static let drover: Double = 50
    public static let vault: Double  = 250
    public static let pike: Double   = 305
    public static let quill: Double  = 195
    public static let cobalt: Double = 235

    public static func forAgent(name: String, handle: String?) -> Double {
        let key = (handle ?? name)
            .lowercased()
            .replacingOccurrences(of: " ", with: "-")
        switch key {
        case "scout": return scout
        case "hudson": return hudson
        case "qb": return qb
        case "cody": return cody
        case "ranger": return ranger
        case "vox": return vox
        case "atlas": return atlas
        case "drover": return drover
        case "vault": return vault
        case "pike": return pike
        case "quill": return quill
        case "cobalt": return cobalt
        default: return hashedHue(key)
        }
    }

    private static func hashedHue(_ input: String) -> Double {
        var hash: UInt32 = 2_166_136_261
        for byte in input.utf8 {
            hash ^= UInt32(byte)
            hash &*= 16_777_619
        }
        return Double(hash % 360)
    }
}

private func nilIfEmpty(_ value: String?) -> String? {
    guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
          !trimmed.isEmpty else {
        return nil
    }
    return value
}

private func uniqueMemberNames(_ names: [String]) -> [String] {
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
