import Foundation

private func scoutTailClean(_ value: String?) -> String? {
    guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
          !trimmed.isEmpty,
          trimmed != "\u{2014}" else {
        return nil
    }
    return trimmed
}

public enum ScoutTailDisplayKind: String, Sendable, CaseIterable, Identifiable, Equatable {
    case user = "USR"
    case assistant = "AST"
    case message = "MSG"
    case tool = "TOL"
    case output = "OUT"
    case system = "SYS"
    case event = "EVT"
    case edit = "EDT"
    case error = "ERR"
    case lifecycle = "LIF"
    case prompt = "PMT"
    case broker = "BRK"
    case ask = "REQ"

    public var id: String { rawValue }
    public var label: String { rawValue }

    public static func from(_ event: ScoutTailEvent) -> ScoutTailDisplayKind {
        let summaryKind = from(summary: event.summary)
        if summaryKind == .error || summaryKind == .ask {
            return summaryKind
        }
        switch event.kind {
        case .user: return .user
        case .assistant: return .assistant
        case .tool: return .tool
        case .toolResult: return .output
        case .system: return summaryKind == .broker || summaryKind == .lifecycle ? summaryKind : .system
        case .other: return summaryKind
        }
    }

    public static func from(summary raw: String) -> ScoutTailDisplayKind {
        let value = raw.lowercased()
        if value.contains("fail") || value.contains("error") || value.contains("dead") { return .error }
        if value.contains("ask") || value.contains("attention") || value.contains("wait") { return .ask }
        if value.contains("message") || value.contains("reply") || value.contains("sent") || value.contains("wire") { return .message }
        if value.contains("tool") { return .tool }
        if value.contains("edit") || value.contains("file") { return .edit }
        if value.contains("prompt") { return .prompt }
        if value.contains("broker") || value.contains("ping") { return .broker }
        if value.contains("start") || value.contains("spawn") || value.contains("wake") || value.contains("lifecycle") { return .lifecycle }
        return .event
    }

    public var glyph: String {
        switch self {
        case .user, .prompt: return ">"
        case .assistant: return "<"
        case .tool: return "*"
        case .output: return "="
        case .system, .lifecycle, .broker: return "~"
        case .message, .event: return "·"
        case .edit: return "+"
        case .error: return "!"
        case .ask: return "?"
        }
    }

    public var title: String {
        switch self {
        case .user: return "User"
        case .assistant: return "Assistant"
        case .message: return "Message"
        case .tool: return "Tool"
        case .output: return "Output"
        case .system: return "System"
        case .event: return "Event"
        case .edit: return "Edit"
        case .error: return "Error"
        case .lifecycle: return "Lifecycle"
        case .prompt: return "Prompt"
        case .broker: return "Broker"
        case .ask: return "Request"
        }
    }

    public var isAttention: Bool {
        self == .ask || self == .error
    }
}

public struct ScoutTailResolvedAgent: Sendable, Equatable {
    public let id: String
    public let name: String?
    public let displayName: String
    public let handle: String?
    public let harness: String?
    public let conversationId: String?
    public let harnessSessionId: String?

    public init(agent: ScoutAgent) {
        id = agent.id
        name = scoutTailClean(agent.name)
        displayName = agent.displayName
        handle = scoutTailClean(agent.handle)
        harness = scoutTailClean(agent.harness)
        conversationId = scoutTailClean(agent.conversationId)
        harnessSessionId = scoutTailClean(agent.harnessSessionId)
    }
}

public enum ScoutTailDetailAction: String, Sendable, Equatable {
    case openSession
    case openAgent
}

public struct ScoutTailDetailRow: Identifiable, Sendable, Equatable {
    public let key: String
    public let value: String
    public let action: ScoutTailDetailAction?

    public var id: String {
        "\(key):\(action?.rawValue ?? "text"):\(value)"
    }

    public init(key: String, value: String, action: ScoutTailDetailAction? = nil) {
        self.key = key
        self.value = value
        self.action = action
    }
}

public struct ScoutTailRowContext: Identifiable, Sendable, Equatable {
    public let event: ScoutTailEvent
    public let agent: ScoutTailResolvedAgent?
    public let kind: ScoutTailDisplayKind
    public let source: String
    public let provider: String
    public let origin: String
    public let line: String
    public let sessionId: String
    public let pid: Int
    public let project: String
    public let cwd: String
    public let agentId: String?
    public let agentName: String?
    public let agentHandle: String?
    public let conversationId: String?
    public let emphasized: Bool

    public var id: String { event.id }
    public var at: String { event.clockLabel }

    public init(event: ScoutTailEvent, agent: ScoutAgent?) {
        let resolvedAgent = agent.map(ScoutTailResolvedAgent.init(agent:))
        let displayKind = ScoutTailDisplayKind.from(event)
        let sourceLabel = event.sourceLabel
        let summary = scoutTailClean(event.summary) ?? event.kind.title

        self.event = event
        self.agent = resolvedAgent
        self.kind = displayKind
        self.source = sourceLabel.hasPrefix("@") ? String(sourceLabel.dropFirst()) : sourceLabel
        self.provider = Self.provider(for: event, agent: resolvedAgent)
        self.origin = event.originLabel
        self.line = summary
        self.sessionId = event.sessionId
        self.pid = event.pid
        self.project = event.projectLabel
        self.cwd = event.cwd
        self.agentId = resolvedAgent?.id
        self.agentName = resolvedAgent?.name
        self.agentHandle = resolvedAgent?.handle
        self.conversationId = resolvedAgent?.conversationId
        self.emphasized = displayKind.isAttention
    }

    public var hasSession: Bool {
        scoutTailClean(sessionId) != nil
    }

    public var sessionRoutingHandle: String? {
        guard let sessionId = scoutTailClean(sessionId) else { return nil }
        return "session:\(sessionId)"
    }

    public var sessionRoutingLabel: String? {
        sessionRoutingHandle
    }

    public var routingHandle: String {
        sessionRoutingHandle ?? scoutTailClean(agentHandle) ?? scoutTailClean(agentName) ?? source
    }

    public var routingLabel: String {
        sessionRoutingLabel ?? scoutTailClean(agentName) ?? scoutTailClean(agentHandle) ?? source
    }

    public var scopeLabel: String {
        pathPrimary + expandedPathDetail
    }

    public var identityDetail: String {
        var ref = expandedPathDetail
        if pid > 0 {
            ref += ref.isEmpty ? "·\(pid)" : ":\(pid)"
        }
        return ref
    }

    public var hoverLabel: String {
        var parts = [scopeLabel]
        if let cwd = scoutTailClean(cwd) {
            parts.append(cwd)
        }
        if let sessionId = scoutTailClean(sessionId) {
            parts.append("session \(sessionId)")
        }
        if pid > 0 {
            parts.append("pid \(pid)")
        }
        return parts.joined(separator: " · ")
    }

    public var pathPrimary: String {
        scoutTailClean(project) ?? source
    }

    public var compactPathDetail: String {
        let tail = sessionTailLabel
        return tail.isEmpty ? "" : "/\(tail)"
    }

    public var expandedPathDetail: String {
        let session = sessionShortLabel
        return session.isEmpty ? "" : "/\(session)"
    }

    public var sessionShortLabel: String {
        guard let sessionId = scoutTailClean(sessionId) else { return "" }
        return String(sessionId.prefix(8))
    }

    public var sessionTailLabel: String {
        guard let sessionId = scoutTailClean(sessionId) else { return "" }
        return String(sessionId.suffix(4))
    }

    public var sessionURL: URL {
        guard let sessionId = scoutTailClean(sessionId) else { return Self.relativeURL("/sessions") }
        return Self.relativeURL("/sessions/\(Self.percentPath(sessionId))")
    }

    public var followURL: URL {
        var components = URLComponents(url: Self.relativeURL("/follow"), resolvingAgainstBaseURL: false)
        var queryItems = [URLQueryItem(name: "view", value: "tail")]
        if let sessionId = scoutTailClean(sessionId) {
            queryItems.append(URLQueryItem(name: "sessionId", value: sessionId))
        }
        if let agentId = scoutTailClean(agentId) {
            queryItems.append(URLQueryItem(name: "targetAgentId", value: agentId))
        }
        components?.queryItems = queryItems
        return components?.url ?? Self.relativeURL("/follow")
    }

    public var agentURL: URL? {
        guard let agentId = scoutTailClean(agentId) else { return nil }
        return Self.relativeURL("/agents/\(Self.percentPath(agentId))?tab=profile")
    }

    public var messagesURL: URL? {
        if let conversationId = scoutTailClean(conversationId) {
            return Self.relativeURL("/c/\(Self.percentPath(conversationId))")
        }
        guard let agentId = scoutTailClean(agentId) else { return nil }
        return Self.relativeURL("/agents/\(Self.percentPath(agentId))?tab=message")
    }

    public var detailSummary: String {
        "[\(at)] [\(provider)] [\(kind.glyph)\(kind.rawValue)] \(scopeLabel) · \(line)"
    }

    public var neighborSummary: String {
        "\(at) \(kind.glyph)\(kind.rawValue) \(source) · \(line)"
    }

    public var detailRows: [ScoutTailDetailRow] {
        var rows: [ScoutTailDetailRow] = [
            ScoutTailDetailRow(key: "id", value: event.id),
        ]

        if let sessionId = scoutTailClean(sessionId) {
            rows.append(ScoutTailDetailRow(key: "session", value: sessionId, action: .openSession))
        }

        if let agent {
            rows.append(ScoutTailDetailRow(key: "agent", value: agent.displayName, action: .openAgent))
        }

        rows.append(ScoutTailDetailRow(key: "project", value: project))

        if let cwd = scoutTailClean(cwd) {
            rows.append(ScoutTailDetailRow(key: "cwd", value: cwd))
        }

        rows.append(ScoutTailDetailRow(key: "harness", value: "\(provider) · \(origin)"))
        rows.append(ScoutTailDetailRow(key: "proc", value: event.parentPid.map { "\(pid)<-\($0)" } ?? event.pidLabel))
        rows.append(ScoutTailDetailRow(key: "age", value: event.ageLabel))

        return rows
    }

    private static func provider(for event: ScoutTailEvent, agent: ScoutTailResolvedAgent?) -> String {
        for candidate in [agent?.harness, Optional(event.source), Optional(event.harness)] {
            guard let value = scoutTailClean(candidate),
                  !isManagementOrigin(value)
            else {
                continue
            }
            return value
        }
        return event.sourceLabel
    }

    private static func isManagementOrigin(_ value: String) -> Bool {
        switch value.lowercased() {
        case "scout-managed", "hudson-managed", "unattributed":
            return true
        default:
            return false
        }
    }

    private static func relativeURL(_ path: String) -> URL {
        ScoutWeb.url(path: path) ?? ScoutWeb.baseURL()
    }

    private static func percentPath(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? value
    }
}

public enum ScoutTailContextBuilder {
    public static func agentsBySessionId(_ agents: [ScoutAgent]) -> [String: ScoutAgent] {
        var result: [String: ScoutAgent] = [:]
        for agent in agents {
            guard let key = scoutTailClean(agent.harnessSessionId) else { continue }
            if result[key] == nil || agent.state == .working {
                result[key] = agent
            }
        }
        return result
    }

    public static func activeAgent(
        for event: ScoutTailEvent,
        in agentsBySessionId: [String: ScoutAgent]
    ) -> ScoutAgent? {
        guard let sessionId = scoutTailClean(event.sessionId) else { return nil }
        return agentsBySessionId[sessionId]
    }

    public static func context(
        for event: ScoutTailEvent,
        agentsBySessionId: [String: ScoutAgent]
    ) -> ScoutTailRowContext {
        ScoutTailRowContext(event: event, agent: activeAgent(for: event, in: agentsBySessionId))
    }

    public static func rows(events: [ScoutTailEvent], agents: [ScoutAgent]) -> [ScoutTailRowContext] {
        let agentsBySessionId = agentsBySessionId(agents)
        return events.map { context(for: $0, agentsBySessionId: agentsBySessionId) }
    }
}
