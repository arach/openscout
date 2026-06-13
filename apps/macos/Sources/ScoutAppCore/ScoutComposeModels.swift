import Foundation

public enum ScoutAssistantSpan: Sendable, Equatable {
    case text(String)
    case mention(String)
    case cmd(String)
    case path(String)
    case code(String)
}

public enum ScoutAssistantSource: Sendable, Equatable {
    case scout
    case operatorYou
}

public struct ScoutAssistantMessage: Identifiable, Sendable, Equatable {
    public let id: String
    public let source: ScoutAssistantSource
    public let at: String
    public let body: [ScoutAssistantSpan]

    public init(id: String, source: ScoutAssistantSource, at: String, body: [ScoutAssistantSpan]) {
        self.id = id
        self.source = source
        self.at = at
        self.body = body
    }
}

/// One scoutbot conversation thread. Stage 1 always has one — the
/// auto-created "default". Per SCO-051, a thread is a label over the
/// transport-native session ID; we never build a parallel abstraction.
public struct ScoutbotThread: Decodable, Sendable, Equatable {
    public let threadId: String
    public let name: String
    public let conversationId: String
    public let transportSessionId: String?
    public let transport: String?
}

struct ScoutbotThreadsResponse: Decodable {
    let threads: [ScoutbotThread]
    let defaultThreadId: String
}
