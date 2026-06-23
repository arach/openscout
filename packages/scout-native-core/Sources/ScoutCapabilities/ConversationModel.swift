// Conversation model (SCO-061 Phase 2).
//
// The pure protocol types for a conversation/session timeline, ported verbatim
// from the iOS donor (apps/ios/Scout/Models/Primitives.swift + Events.swift).
// These mirror the Dispatch wire format (PROTOCOL.md §4/§5) and stay in sync
// with src/protocol/primitives.ts. Foundation-only, Codable, Sendable — no
// SwiftUI, no @MainActor, no I/O. This is the shape both platforms reduce into
// and both platforms render.

import Foundation

// MARK: - Session

public enum SessionStatus: String, Codable, Sendable {
    case connecting, active, idle, error, closed
}

public struct Session: Codable, Identifiable, Sendable, Equatable {
    public let id: String
    public var name: String
    public let adapterType: String
    public var status: SessionStatus
    public var cwd: String?
    public var model: String?
    public var providerMeta: [String: AnyCodable]?

    public init(id: String, name: String, adapterType: String, status: SessionStatus, cwd: String? = nil, model: String? = nil, providerMeta: [String: AnyCodable]? = nil) {
        self.id = id
        self.name = name
        self.adapterType = adapterType
        self.status = status
        self.cwd = cwd
        self.model = model
        self.providerMeta = providerMeta
    }
}

// MARK: - Turn

public enum TurnStatus: String, Codable, Sendable {
    case started, streaming, completed, failed, stopped
}

public struct Turn: Codable, Identifiable, Sendable, Equatable {
    public let id: String
    public let sessionId: String
    public var status: TurnStatus
    public let startedAt: String
    public var endedAt: String?
    public var blocks: [Block]
    public var isUserTurn: Bool?

    public init(id: String, sessionId: String, status: TurnStatus, startedAt: String, endedAt: String? = nil, blocks: [Block] = [], isUserTurn: Bool? = nil) {
        self.id = id
        self.sessionId = sessionId
        self.status = status
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.blocks = blocks
        self.isUserTurn = isUserTurn
    }
}

// MARK: - Block

public enum BlockStatus: String, Codable, Sendable {
    case started, streaming, completed, failed
}

public enum BlockType: String, Codable, Sendable {
    case text, reasoning, action, file, error, question
}

public struct Block: Codable, Identifiable, Sendable, Equatable {
    public let id: String
    public let turnId: String
    public let type: BlockType
    public var status: BlockStatus
    public let index: Int

    // Text / reasoning
    public var text: String?
    // Action
    public var action: Action?
    // File
    public var mimeType: String?
    public var name: String?
    public var data: String?
    public var url: String?
    // Error
    public var message: String?
    public var code: String?
    // Question
    public var header: String?
    public var question: String?
    public var options: [QuestionOption]?
    public var multiSelect: Bool?
    public var questionStatus: QuestionBlockStatus?
    public var answer: [String]?

    public init(id: String, turnId: String, type: BlockType, status: BlockStatus, index: Int, text: String? = nil, action: Action? = nil, mimeType: String? = nil, name: String? = nil, data: String? = nil, url: String? = nil, message: String? = nil, code: String? = nil, header: String? = nil, question: String? = nil, options: [QuestionOption]? = nil, multiSelect: Bool? = nil, questionStatus: QuestionBlockStatus? = nil, answer: [String]? = nil) {
        self.id = id
        self.turnId = turnId
        self.type = type
        self.status = status
        self.index = index
        self.text = text
        self.action = action
        self.mimeType = mimeType
        self.name = name
        self.data = data
        self.url = url
        self.message = message
        self.code = code
        self.header = header
        self.question = question
        self.options = options
        self.multiSelect = multiSelect
        self.questionStatus = questionStatus
        self.answer = answer
    }
}

// MARK: - Question

public enum QuestionBlockStatus: String, Codable, Sendable {
    case awaitingAnswer = "awaiting_answer"
    case answered
    case denied
}

public struct QuestionOption: Codable, Sendable, Equatable {
    public let label: String
    public let description: String?
    public init(label: String, description: String? = nil) {
        self.label = label
        self.description = description
    }
}

// MARK: - Action

public enum ActionKind: String, Codable, Sendable {
    case fileChange = "file_change"
    case command
    case toolCall = "tool_call"
    case subagent
}

public enum ActionStatus: String, Codable, Sendable {
    case pending, running, completed, failed
    case awaitingApproval = "awaiting_approval"
}

public enum ApprovalRisk: String, Codable, Sendable {
    case low, medium, high
}

public struct ActionApproval: Codable, Sendable, Equatable {
    public var version: Int
    public var description: String?
    public var risk: ApprovalRisk?
    public init(version: Int, description: String? = nil, risk: ApprovalRisk? = nil) {
        self.version = version
        self.description = description
        self.risk = risk
    }
}

public struct Action: Codable, Sendable, Equatable {
    public let kind: ActionKind
    public var status: ActionStatus
    public var output: String
    public var approval: ActionApproval?

    public var path: String?
    public var diff: String?
    public var command: String?
    public var exitCode: Int?
    public var toolName: String?
    public var toolCallId: String?
    public var input: AnyCodable?
    public var result: AnyCodable?
    public var agentId: String?
    public var agentName: String?
    public var prompt: String?

    public init(kind: ActionKind, status: ActionStatus, output: String = "", approval: ActionApproval? = nil, path: String? = nil, diff: String? = nil, command: String? = nil, exitCode: Int? = nil, toolName: String? = nil, toolCallId: String? = nil, input: AnyCodable? = nil, result: AnyCodable? = nil, agentId: String? = nil, agentName: String? = nil, prompt: String? = nil) {
        self.kind = kind
        self.status = status
        self.output = output
        self.approval = approval
        self.path = path
        self.diff = diff
        self.command = command
        self.exitCode = exitCode
        self.toolName = toolName
        self.toolCallId = toolCallId
        self.input = input
        self.result = result
        self.agentId = agentId
        self.agentName = agentName
        self.prompt = prompt
    }
}

// MARK: - Projection snapshot types

public struct SessionHistory: Codable, Sendable, Equatable {
    public var hasOlder: Bool
    public var oldestTurnId: String?
    public var newestTurnId: String?
    public init(hasOlder: Bool, oldestTurnId: String? = nil, newestTurnId: String? = nil) {
        self.hasOlder = hasOlder
        self.oldestTurnId = oldestTurnId
        self.newestTurnId = newestTurnId
    }
}

public enum SnapshotTurnStatus: String, Codable, Sendable {
    case streaming, completed, interrupted, error
}

public enum SnapshotBlockStatus: String, Codable, Sendable {
    case streaming, completed
}

public struct BlockState: Codable, Sendable, Equatable {
    public var block: Block
    public var status: SnapshotBlockStatus
    public init(block: Block, status: SnapshotBlockStatus) {
        self.block = block
        self.status = status
    }
}

public struct TurnState: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public var status: SnapshotTurnStatus
    public var blocks: [BlockState]
    public let startedAt: Int
    public var endedAt: Int?
    public var isUserTurn: Bool?
    /// Optional caller-generated id used to reconcile optimistic local sends with
    /// the authoritative broker message once it appears in a snapshot.
    public var clientMessageId: String?

    public init(id: String, status: SnapshotTurnStatus, blocks: [BlockState] = [], startedAt: Int, endedAt: Int? = nil, isUserTurn: Bool? = nil, clientMessageId: String? = nil) {
        self.id = id
        self.status = status
        self.blocks = blocks
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.isUserTurn = isUserTurn
        self.clientMessageId = clientMessageId
    }
}

/// The reduced projection of a conversation: a session plus its ordered turns.
public struct SessionState: Codable, Sendable, Equatable {
    public var session: Session
    public var history: SessionHistory?
    public var turns: [TurnState]
    public var currentTurnId: String?

    public init(session: Session, history: SessionHistory? = nil, turns: [TurnState] = [], currentTurnId: String? = nil) {
        self.session = session
        self.history = history
        self.turns = turns
        self.currentTurnId = currentTurnId
    }
}

// MARK: - Events

/// A sequenced event off the bridge: `{ seq, event }`. `seq == 0` denotes an
/// initial push outside the replay buffer.
public struct SequencedEvent: Codable, Sendable {
    public let seq: Int
    public let event: ScoutEvent
    public init(seq: Int, event: ScoutEvent) {
        self.seq = seq
        self.event = event
    }
}

/// Discriminated union of conversation events, keyed on the `event` field.
public enum ScoutEvent: Sendable {
    case sessionUpdate(session: Session)
    case sessionClosed(sessionId: String)
    case turnStart(sessionId: String, turn: Turn)
    case turnEnd(sessionId: String, turnId: String, status: TurnStatus)
    case turnError(sessionId: String, turnId: String, message: String)
    case blockStart(sessionId: String, turnId: String, block: Block)
    case blockDelta(sessionId: String, turnId: String, blockId: String, text: String)
    case blockActionOutput(sessionId: String, turnId: String, blockId: String, output: String)
    case blockActionStatus(sessionId: String, turnId: String, blockId: String, status: ActionStatus, meta: [String: AnyCodable]?)
    case blockActionApproval(sessionId: String, turnId: String, blockId: String, approval: ActionApproval)
    case blockQuestionAnswer(sessionId: String, turnId: String, blockId: String, questionStatus: QuestionBlockStatus, answer: [String]?)
    case blockEnd(sessionId: String, turnId: String, blockId: String, status: BlockStatus)
    case unknown(discriminator: String)
}

extension ScoutEvent: Codable {
    private enum CodingKeys: String, CodingKey {
        case event
        case session, sessionId
        case turn, turnId
        case block, blockId
        case status, text, output, message, meta
        case approval
        case questionStatus, answer
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let discriminator = try c.decode(String.self, forKey: .event)
        switch discriminator {
        case "session:update":
            self = .sessionUpdate(session: try c.decode(Session.self, forKey: .session))
        case "session:closed":
            self = .sessionClosed(sessionId: try c.decode(String.self, forKey: .sessionId))
        case "turn:start":
            self = .turnStart(sessionId: try c.decode(String.self, forKey: .sessionId), turn: try c.decode(Turn.self, forKey: .turn))
        case "turn:end":
            self = .turnEnd(sessionId: try c.decode(String.self, forKey: .sessionId), turnId: try c.decode(String.self, forKey: .turnId), status: try c.decode(TurnStatus.self, forKey: .status))
        case "turn:error":
            self = .turnError(sessionId: try c.decode(String.self, forKey: .sessionId), turnId: try c.decode(String.self, forKey: .turnId), message: try c.decode(String.self, forKey: .message))
        case "block:start":
            self = .blockStart(sessionId: try c.decode(String.self, forKey: .sessionId), turnId: try c.decode(String.self, forKey: .turnId), block: try c.decode(Block.self, forKey: .block))
        case "block:delta":
            self = .blockDelta(sessionId: try c.decode(String.self, forKey: .sessionId), turnId: try c.decode(String.self, forKey: .turnId), blockId: try c.decode(String.self, forKey: .blockId), text: try c.decode(String.self, forKey: .text))
        case "block:action:output":
            self = .blockActionOutput(sessionId: try c.decode(String.self, forKey: .sessionId), turnId: try c.decode(String.self, forKey: .turnId), blockId: try c.decode(String.self, forKey: .blockId), output: try c.decode(String.self, forKey: .output))
        case "block:action:status":
            self = .blockActionStatus(sessionId: try c.decode(String.self, forKey: .sessionId), turnId: try c.decode(String.self, forKey: .turnId), blockId: try c.decode(String.self, forKey: .blockId), status: try c.decode(ActionStatus.self, forKey: .status), meta: try c.decodeIfPresent([String: AnyCodable].self, forKey: .meta))
        case "block:action:approval":
            self = .blockActionApproval(sessionId: try c.decode(String.self, forKey: .sessionId), turnId: try c.decode(String.self, forKey: .turnId), blockId: try c.decode(String.self, forKey: .blockId), approval: try c.decode(ActionApproval.self, forKey: .approval))
        case "block:question:answer":
            self = .blockQuestionAnswer(sessionId: try c.decode(String.self, forKey: .sessionId), turnId: try c.decode(String.self, forKey: .turnId), blockId: try c.decode(String.self, forKey: .blockId), questionStatus: try c.decode(QuestionBlockStatus.self, forKey: .questionStatus), answer: try c.decodeIfPresent([String].self, forKey: .answer))
        case "block:end":
            self = .blockEnd(sessionId: try c.decode(String.self, forKey: .sessionId), turnId: try c.decode(String.self, forKey: .turnId), blockId: try c.decode(String.self, forKey: .blockId), status: try c.decode(BlockStatus.self, forKey: .status))
        default:
            self = .unknown(discriminator: discriminator)
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .sessionUpdate(let s):
            try c.encode("session:update", forKey: .event); try c.encode(s, forKey: .session)
        case .sessionClosed(let sid):
            try c.encode("session:closed", forKey: .event); try c.encode(sid, forKey: .sessionId)
        case .turnStart(let sid, let turn):
            try c.encode("turn:start", forKey: .event); try c.encode(sid, forKey: .sessionId); try c.encode(turn, forKey: .turn)
        case .turnEnd(let sid, let tid, let status):
            try c.encode("turn:end", forKey: .event); try c.encode(sid, forKey: .sessionId); try c.encode(tid, forKey: .turnId); try c.encode(status, forKey: .status)
        case .turnError(let sid, let tid, let msg):
            try c.encode("turn:error", forKey: .event); try c.encode(sid, forKey: .sessionId); try c.encode(tid, forKey: .turnId); try c.encode(msg, forKey: .message)
        case .blockStart(let sid, let tid, let block):
            try c.encode("block:start", forKey: .event); try c.encode(sid, forKey: .sessionId); try c.encode(tid, forKey: .turnId); try c.encode(block, forKey: .block)
        case .blockDelta(let sid, let tid, let bid, let text):
            try c.encode("block:delta", forKey: .event); try c.encode(sid, forKey: .sessionId); try c.encode(tid, forKey: .turnId); try c.encode(bid, forKey: .blockId); try c.encode(text, forKey: .text)
        case .blockActionOutput(let sid, let tid, let bid, let output):
            try c.encode("block:action:output", forKey: .event); try c.encode(sid, forKey: .sessionId); try c.encode(tid, forKey: .turnId); try c.encode(bid, forKey: .blockId); try c.encode(output, forKey: .output)
        case .blockActionStatus(let sid, let tid, let bid, let status, let meta):
            try c.encode("block:action:status", forKey: .event); try c.encode(sid, forKey: .sessionId); try c.encode(tid, forKey: .turnId); try c.encode(bid, forKey: .blockId); try c.encode(status, forKey: .status); try c.encodeIfPresent(meta, forKey: .meta)
        case .blockActionApproval(let sid, let tid, let bid, let approval):
            try c.encode("block:action:approval", forKey: .event); try c.encode(sid, forKey: .sessionId); try c.encode(tid, forKey: .turnId); try c.encode(bid, forKey: .blockId); try c.encode(approval, forKey: .approval)
        case .blockQuestionAnswer(let sid, let tid, let bid, let qs, let answer):
            try c.encode("block:question:answer", forKey: .event); try c.encode(sid, forKey: .sessionId); try c.encode(tid, forKey: .turnId); try c.encode(bid, forKey: .blockId); try c.encode(qs, forKey: .questionStatus); try c.encodeIfPresent(answer, forKey: .answer)
        case .blockEnd(let sid, let tid, let bid, let status):
            try c.encode("block:end", forKey: .event); try c.encode(sid, forKey: .sessionId); try c.encode(tid, forKey: .turnId); try c.encode(bid, forKey: .blockId); try c.encode(status, forKey: .status)
        case .unknown(let d):
            try c.encode(d, forKey: .event)
        }
    }
}

// MARK: - AnyCodable (type-erased JSON)

public struct AnyCodable: Codable, @unchecked Sendable, Equatable {
    public let value: Any

    public init(_ value: Any) { self.value = value }

    public init(from decoder: Decoder) throws {
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

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case is NSNull: try container.encodeNil()
        case let bool as Bool: try container.encode(bool)
        case let int as Int: try container.encode(int)
        case let double as Double: try container.encode(double)
        case let string as String: try container.encode(string)
        case let array as [Any]: try container.encode(array.map { AnyCodable($0) })
        case let dict as [String: Any]: try container.encode(dict.mapValues { AnyCodable($0) })
        default: try container.encodeNil()
        }
    }

    public var stringValue: String? { value as? String }

    // Structural equality is sufficient for fixtures/state diffing.
    public static func == (lhs: AnyCodable, rhs: AnyCodable) -> Bool {
        switch (lhs.value, rhs.value) {
        case (is NSNull, is NSNull): return true
        case let (l as Bool, r as Bool): return l == r
        case let (l as Int, r as Int): return l == r
        case let (l as Double, r as Double): return l == r
        case let (l as String, r as String): return l == r
        case let (l as [Any], r as [Any]):
            return l.count == r.count && zip(l, r).allSatisfy { AnyCodable($0) == AnyCodable($1) }
        case let (l as [String: Any], r as [String: Any]):
            return l.keys == r.keys && l.allSatisfy { AnyCodable($0.value) == AnyCodable(r[$0.key] as Any) }
        default: return false
        }
    }
}
