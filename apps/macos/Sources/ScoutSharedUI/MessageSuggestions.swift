import Foundation

public enum MessageSuggestionKind: String, Sendable {
    case command
    case agent
    case session

    public var eyebrow: String {
        switch self {
        case .command: return "COMMANDS"
        case .agent: return "AGENTS"
        case .session: return "SESSIONS"
        }
    }

    public var mark: String {
        switch self {
        case .command: return "/"
        case .agent: return "@"
        case .session: return "session"
        }
    }
}

public enum MessageSuggestionAction: String, Sendable {
    case openRunner
}

public struct MessageSuggestion: Identifiable, Equatable, Sendable {
    public let id: String
    public let kind: MessageSuggestionKind
    public let label: String
    public let detail: String
    public let replacement: String
    public let targetHandle: String?
    public let targetLabel: String?
    public let action: MessageSuggestionAction?

    public init(
        id: String,
        kind: MessageSuggestionKind,
        label: String,
        detail: String,
        replacement: String,
        targetHandle: String?,
        targetLabel: String?,
        action: MessageSuggestionAction?
    ) {
        self.id = id
        self.kind = kind
        self.label = label
        self.detail = detail
        self.replacement = replacement
        self.targetHandle = targetHandle
        self.targetLabel = targetLabel
        self.action = action
    }
}

public struct MessageSuggestionTrigger: Equatable, Sendable {
    public let kind: MessageSuggestionKind
    public let token: String
    public let query: String
    public let startOffset: Int
    public let endOffset: Int

    public var signature: String {
        "\(kind.rawValue):\(startOffset):\(token)"
    }

    public init(
        kind: MessageSuggestionKind,
        token: String,
        query: String,
        startOffset: Int,
        endOffset: Int
    ) {
        self.kind = kind
        self.token = token
        self.query = query
        self.startOffset = startOffset
        self.endOffset = endOffset
    }
}

public struct MessageCommandCandidate: Sendable {
    public let command: String
    public let detail: String
    public let replacement: String
    public let action: MessageSuggestionAction?

    public init(
        command: String,
        detail: String,
        replacement: String,
        action: MessageSuggestionAction? = nil
    ) {
        self.command = command
        self.detail = detail
        self.replacement = replacement
        self.action = action
    }
}

public struct MessageSuggestionAgent: Sendable {
    public let id: String
    public let name: String
    public let handle: String?
    public let state: String
    public let role: String?
    public let workspaceRoot: String?
    public let harnessSessionId: String?

    public init(
        id: String,
        name: String,
        handle: String?,
        state: String,
        role: String?,
        workspaceRoot: String?,
        harnessSessionId: String?
    ) {
        self.id = id
        self.name = name
        self.handle = handle
        self.state = state
        self.role = role
        self.workspaceRoot = workspaceRoot
        self.harnessSessionId = harnessSessionId
    }
}

public enum MessageSuggestionEngine {
    public static let defaultCommands: [MessageCommandCandidate] = [
        MessageCommandCandidate(command: "/help", detail: "Show Scoutbot commands", replacement: "/help "),
        MessageCommandCandidate(command: "/agents", detail: "List known agents and endpoints", replacement: "/agents "),
        MessageCommandCandidate(command: "/status", detail: "Summarize active work and online agents", replacement: "/status "),
        MessageCommandCandidate(command: "/recent", detail: "Show recent messages from an agent", replacement: "/recent "),
        MessageCommandCandidate(command: "/doing", detail: "Show active work for an agent", replacement: "/doing "),
        MessageCommandCandidate(command: "/flight", detail: "Inspect a flight by id", replacement: "/flight "),
        MessageCommandCandidate(command: "/spin", detail: "Open the agent runner", replacement: "", action: .openRunner),
    ]

    public static func detectTrigger(in value: String) -> MessageSuggestionTrigger? {
        guard !value.isEmpty else { return nil }
        let end = value.endIndex
        var start = end
        while start > value.startIndex {
            let previous = value.index(before: start)
            if value[previous].isWhitespace {
                break
            }
            start = previous
        }

        let token = String(value[start..<end])
        guard !token.isEmpty else { return nil }
        let startOffset = value.distance(from: value.startIndex, to: start)
        let endOffset = value.distance(from: value.startIndex, to: end)

        if token.hasPrefix("/") {
            let query = String(token.dropFirst())
            guard isSimpleQuery(query) else { return nil }
            return MessageSuggestionTrigger(kind: .command, token: token, query: query, startOffset: startOffset, endOffset: endOffset)
        }

        if token.hasPrefix("@") {
            let query = String(token.dropFirst())
            guard isHandleQuery(query) else { return nil }
            return MessageSuggestionTrigger(kind: .agent, token: token, query: query, startOffset: startOffset, endOffset: endOffset)
        }

        let lowerToken = token.lowercased()
        if lowerToken.hasPrefix("session:") || lowerToken.hasPrefix("sid:") {
            let prefixLength = lowerToken.hasPrefix("session:") ? 8 : 4
            let query = String(token.dropFirst(prefixLength))
            guard isSessionQuery(query) else { return nil }
            return MessageSuggestionTrigger(kind: .session, token: token, query: query, startOffset: startOffset, endOffset: endOffset)
        }

        return nil
    }

    public static func suggestions(
        for trigger: MessageSuggestionTrigger,
        agents: [MessageSuggestionAgent],
        commands: [MessageCommandCandidate] = defaultCommands
    ) -> [MessageSuggestion] {
        switch trigger.kind {
        case .command:
            return commandSuggestions(query: trigger.query, commands: commands)
        case .agent:
            return agentSuggestions(query: trigger.query, agents: agents)
        case .session:
            return sessionSuggestions(query: trigger.query, agents: agents)
        }
    }

    public static func index(in value: String, offset: Int) -> String.Index? {
        guard offset >= 0, offset <= value.count else { return nil }
        return value.index(value.startIndex, offsetBy: offset, limitedBy: value.endIndex)
    }

    private static func commandSuggestions(query: String, commands: [MessageCommandCandidate]) -> [MessageSuggestion] {
        let q = query.lowercased()
        return commands
            .filter { candidate in
                q.isEmpty
                    || candidate.command.dropFirst().lowercased().hasPrefix(q)
                    || candidate.command.lowercased().contains(q)
                    || candidate.detail.lowercased().contains(q)
            }
            .prefix(8)
            .map { candidate in
                MessageSuggestion(
                    id: "command:\(candidate.command)",
                    kind: .command,
                    label: candidate.command,
                    detail: candidate.detail,
                    replacement: candidate.replacement,
                    targetHandle: nil,
                    targetLabel: nil,
                    action: candidate.action
                )
            }
    }

    private static func agentSuggestions(query: String, agents: [MessageSuggestionAgent]) -> [MessageSuggestion] {
        let q = query.lowercased()
        var seen = Set<String>()
        return agents
            .compactMap { agent -> MessageSuggestion? in
                guard let handle = suggestionHandle(for: agent) else { return nil }
                let key = handle.lowercased()
                guard !seen.contains(key) else { return nil }
                guard q.isEmpty
                    || handle.lowercased().contains(q)
                    || agent.name.lowercased().contains(q)
                    || agent.id.lowercased().contains(q) else {
                    return nil
                }
                seen.insert(key)
                return MessageSuggestion(
                    id: "agent:\(key)",
                    kind: .agent,
                    label: "@\(handle)",
                    detail: agentSuggestionDetail(agent),
                    replacement: "",
                    targetHandle: handle,
                    targetLabel: agent.name,
                    action: nil
                )
            }
            .sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
            .prefix(7)
            .map { $0 }
    }

    private static func sessionSuggestions(query: String, agents: [MessageSuggestionAgent]) -> [MessageSuggestion] {
        let q = query.lowercased()
        var seen = Set<String>()
        return agents
            .compactMap { agent -> MessageSuggestion? in
                guard let sessionId = agent.harnessSessionId?.trimmingCharacters(in: .whitespacesAndNewlines),
                      !sessionId.isEmpty else {
                    return nil
                }
                let key = sessionId.lowercased()
                guard !seen.contains(key) else { return nil }
                guard q.isEmpty
                    || key.contains(q)
                    || agent.name.lowercased().contains(q)
                    || (agent.handle ?? "").lowercased().contains(q) else {
                    return nil
                }
                seen.insert(key)
                return MessageSuggestion(
                    id: "session:\(key)",
                    kind: .session,
                    label: "session:\(sessionId)",
                    detail: "\(agent.name) · \(agent.state)",
                    replacement: "session:\(sessionId) ",
                    targetHandle: nil,
                    targetLabel: nil,
                    action: nil
                )
            }
            .sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
            .prefix(7)
            .map { $0 }
    }

    private static func suggestionHandle(for agent: MessageSuggestionAgent) -> String? {
        let raw = agent.handle ?? agent.name
        let trimmed = raw
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "@"))
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func agentSuggestionDetail(_ agent: MessageSuggestionAgent) -> String {
        let scope = (agent.workspaceRoot as NSString?)?.lastPathComponent ?? agent.role
        return "\(agent.name) · \(agent.state) · \(scope ?? "agent")"
    }

    private static func isSimpleQuery(_ value: String) -> Bool {
        value.allSatisfy { ch in
            ch.isLetter || ch.isNumber || ch == "-" || ch == "_"
        }
    }

    private static func isHandleQuery(_ value: String) -> Bool {
        value.allSatisfy { ch in
            ch.isLetter || ch.isNumber || ch == "-" || ch == "_" || ch == "."
        }
    }

    private static func isSessionQuery(_ value: String) -> Bool {
        value.allSatisfy { ch in
            ch.isLetter || ch.isNumber || ch == "-" || ch == "_" || ch == "."
        }
    }
}
