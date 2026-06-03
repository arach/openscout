// ConversationCapability + ControlCapability (SCO-061 Phase 2).
//
// The read and write sides of a live conversation, as semantic contracts. The
// read side streams sequenced events (which the app reduces with
// `ConversationProjection`); the write side expresses every steering verb the
// surface needs. Per-platform adapters implement these over their own transport
// (macOS HTTP/SSE, iOS WS+Noise+tRPC). Views and shared behavior depend on the
// protocols only.

import Foundation

/// Read side: subscribe to a conversation's event stream and recover snapshots.
public protocol ConversationCapability: Sendable {
    /// An authoritative snapshot of the conversation as of now (recovery path).
    func snapshot(conversationId: String) async throws -> SessionState

    /// The live event stream for a conversation. `sinceSeq` is an optional
    /// replay cursor; the transport delivers events as they arrive.
    func conversationEvents(conversationId: String, sinceSeq: Int?) -> AsyncStream<SequencedEvent>
}

/// Write side: the steering verbs. Each is expressed semantically; the spec is
/// Codable so it doubles as a contract fixture.
public protocol ControlCapability: Sendable {
    /// Send a user prompt into a conversation.
    func send(_ prompt: PromptSpec) async throws -> ControlResult

    /// Answer an outstanding question block.
    func answerQuestion(_ answer: QuestionAnswerSpec) async throws -> ControlResult

    /// Approve or deny an action awaiting approval.
    func decideAction(_ decision: ActionDecisionSpec) async throws -> ControlResult

    /// Interrupt / steer the current turn (stop generation, optionally re-prompt).
    func interrupt(_ interrupt: InterruptSpec) async throws -> ControlResult
}

// MARK: - Control specs

public struct PromptSpec: Codable, Sendable, Equatable {
    public var conversationId: String
    public var text: String
    public var images: [ImageAttachment]?
    public init(conversationId: String, text: String, images: [ImageAttachment]? = nil) {
        self.conversationId = conversationId
        self.text = text
        self.images = images
    }
}

public struct ImageAttachment: Codable, Sendable, Equatable {
    public let mimeType: String
    public let data: String
    public init(mimeType: String, data: String) {
        self.mimeType = mimeType
        self.data = data
    }
}

public struct QuestionAnswerSpec: Codable, Sendable, Equatable {
    public var conversationId: String
    public var turnId: String
    public var blockId: String
    public var answer: [String]
    public init(conversationId: String, turnId: String, blockId: String, answer: [String]) {
        self.conversationId = conversationId
        self.turnId = turnId
        self.blockId = blockId
        self.answer = answer
    }
}

public struct ActionDecisionSpec: Codable, Sendable, Equatable {
    public enum Decision: String, Codable, Sendable { case approve, deny }
    public var conversationId: String
    public var turnId: String
    public var blockId: String
    public var decision: Decision
    /// The approval version the agent is waiting on (`Action.approval.version`).
    /// The bridge rejects a decision that doesn't match the live version.
    public var version: Int
    public init(conversationId: String, turnId: String, blockId: String, decision: Decision, version: Int = 0) {
        self.conversationId = conversationId
        self.turnId = turnId
        self.blockId = blockId
        self.decision = decision
        self.version = version
    }
}

public struct InterruptSpec: Codable, Sendable, Equatable {
    public var conversationId: String
    /// Optional follow-up prompt to inject after stopping the current turn.
    public var steerText: String?
    public init(conversationId: String, steerText: String? = nil) {
        self.conversationId = conversationId
        self.steerText = steerText
    }
}

public struct ControlResult: Codable, Sendable, Equatable {
    public var ok: Bool
    public var turnId: String?
    public var messageId: String?
    public init(ok: Bool, turnId: String? = nil, messageId: String? = nil) {
        self.ok = ok
        self.turnId = turnId
        self.messageId = messageId
    }
}
