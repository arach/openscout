// Primitives — Dispatch protocol types.
//
// Canonical source: PROTOCOL.md §5.
// These types mirror the TypeScript definitions in src/protocol/primitives.ts
// and must stay in sync with the wire format.

import Foundation

// MARK: - Session

enum SessionStatus: String, Codable, Sendable {
    case connecting
    case active
    case idle
    case error
    case closed
}

struct Session: Codable, Identifiable, Sendable {
    let id: String
    var name: String
    let adapterType: String
    var status: SessionStatus
    var cwd: String?
    var model: String?
    var providerMeta: [String: AnyCodable]?
}

// MARK: - Turn

enum TurnStatus: String, Codable, Sendable {
    case started
    case streaming
    case completed
    case failed
    case stopped
}

struct Turn: Codable, Identifiable, Sendable {
    let id: String
    let sessionId: String
    var status: TurnStatus
    let startedAt: String
    var endedAt: String?
    var blocks: [Block]
    var isUserTurn: Bool?
    var turnHash: String? = nil
}

// MARK: - Block

enum BlockStatus: String, Codable, Sendable {
    case started
    case streaming
    case completed
    case failed
}

struct Block: Codable, Identifiable, Sendable {
    let id: String
    let turnId: String
    let type: BlockType
    var status: BlockStatus
    let index: Int

    // Text / reasoning fields
    var text: String?

    // Action fields
    var action: Action?

    // File fields
    var mimeType: String?
    var name: String?
    var data: String?

    // Error fields
    var message: String?
    var code: String?
}

enum BlockType: String, Codable, Sendable {
    case text
    case reasoning
    case action
    case file
    case error
}

// MARK: - Action

enum ActionKind: String, Codable, Sendable {
    case fileChange = "file_change"
    case command
    case toolCall = "tool_call"
    case subagent
}

enum ActionStatus: String, Codable, Sendable {
    case pending
    case running
    case completed
    case failed
}

struct Action: Codable, Sendable {
    let kind: ActionKind
    var status: ActionStatus
    var output: String

    // file_change
    var path: String?
    var diff: String?

    // command
    var command: String?
    var exitCode: Int?

    // tool_call
    var toolName: String?
    var toolCallId: String?
    var input: AnyCodable?
    var result: AnyCodable?

    // subagent
    var agentId: String?
    var agentName: String?
    var prompt: String?
}

// MARK: - Prompt

struct Prompt: Codable, Sendable {
    let sessionId: String
    var text: String
    var files: [String]?
    var images: [ImageAttachment]?
    var providerOptions: [String: AnyCodable]?
}

struct ImageAttachment: Codable, Sendable {
    let mimeType: String
    let data: String
}

// MARK: - Snapshot types

struct SessionState: Codable, Sendable {
    var session: Session
    var history: SessionHistory?
    var turns: [TurnState]
    var currentTurnId: String?
}

struct SessionHistory: Codable, Sendable {
    var hasOlder: Bool
    var oldestTurnId: String?
    var newestTurnId: String?
}

enum SnapshotTurnStatus: String, Codable, Sendable {
    case streaming
    case completed
    case interrupted
    case error
}

struct TurnState: Codable, Sendable {
    let id: String
    var status: SnapshotTurnStatus
    var blocks: [BlockState]
    let startedAt: Int
    var endedAt: Int?
    var isUserTurn: Bool?
    var turnHash: String? = nil
}

enum SnapshotBlockStatus: String, Codable, Sendable {
    case streaming
    case completed
}

struct BlockState: Codable, Sendable {
    var block: Block
    var status: SnapshotBlockStatus
}

struct SessionSummary: Codable, Identifiable, Sendable {
    let sessionId: String
    var name: String
    let adapterType: String
    var status: String
    var turnCount: Int
    var currentTurnStatus: String?
    let startedAt: Int
    var lastActivityAt: Int
    var project: String? = nil
    var model: String? = nil
    var isCachedOnly: Bool = false

    var id: String { sessionId }
}

// MARK: - AnyCodable (type-erased JSON)

struct AnyCodable: Codable, @unchecked Sendable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            value = NSNull()
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let int = try? container.decode(Int.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.map(\.value)
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            value = dict.mapValues(\.value)
        } else {
            value = NSNull()
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case is NSNull:
            try container.encodeNil()
        case let bool as Bool:
            try container.encode(bool)
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let string as String:
            try container.encode(string)
        case let array as [Any]:
            try container.encode(array.map { AnyCodable($0) })
        case let dict as [String: Any]:
            try container.encode(dict.mapValues { AnyCodable($0) })
        default:
            try container.encodeNil()
        }
    }
}

// MARK: - Typed helpers

extension AnyCodable {
    var stringValue: String? {
        value as? String
    }
}

extension Session {
    var agentId: String? {
        providerMeta?["agentId"]?.stringValue?.trimmedNonEmpty
    }

    var currentBranch: String? {
        for key in ["branch", "gitBranch", "currentBranch", "workspaceQualifier"] {
            if let branch = providerMeta?[key]?.stringValue?.trimmedNonEmpty {
                return branch
            }
        }

        if let selector = providerMeta?["selector"]?.stringValue?.trimmedNonEmpty,
           let suffix = selector.split(separator: "/").last,
           !suffix.isEmpty {
            return String(suffix)
        }

        return nil
    }

    var inferredProjectName: String? {
        if let explicitProject = providerMeta?["project"]?.stringValue?.trimmedNonEmpty {
            return explicitProject
        }

        if let cwd = cwd?.trimmedNonEmpty {
            let lastComponent = URL(fileURLWithPath: cwd).lastPathComponent.trimmingCharacters(in: .whitespacesAndNewlines)
            if !lastComponent.isEmpty && lastComponent != "/" {
                return lastComponent
            }
        }

        for separator in [" — ", " – ", " · "] {
            let parts = name.components(separatedBy: separator)
            if let suffix = parts.last?.trimmingCharacters(in: .whitespacesAndNewlines),
               !suffix.isEmpty,
               suffix != name {
                return suffix
            }
        }

        return nil
    }
}

extension String {
    var trimmedNonEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
