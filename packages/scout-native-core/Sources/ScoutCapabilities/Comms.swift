// CommsCapability (SCO-061).
//
// Shared mesh-comms model + contract: the channels and direct-message threads
// the operator (the phone) reads and posts into. Faithful, pure port of the
// broker's `ConversationDefinition` / `MessageRecord` shapes (packages/protocol),
// flattened for the phone — participants and authors arrive pre-resolved to
// display labels so the UI never has to join against the actor table.

import Foundation

/// A room in the mesh comms layer: a shared channel, a 1:1 direct thread with an
/// agent, a group, or a sub-thread. The operator joins these from the Comms tab.
public struct CommsConversation: Codable, Sendable, Identifiable, Equatable, Hashable {
    public enum Kind: String, Codable, Sendable {
        case channel, direct, group, thread, system, unknown
    }

    public var id: String
    public var kind: Kind
    public var title: String
    /// Participant display labels, operator excluded (e.g. ["broker-smith"]).
    public var participants: [String]
    public var topic: String?
    /// Trimmed preview of the most-recent message body.
    public var lastMessagePreview: String?
    /// Display label of the most-recent message's author ("You", "broker-smith"…).
    public var lastMessageAuthor: String?
    public var lastMessageAt: Date?
    public var messageCount: Int
    /// Operator's unread count (from read cursors); 0 when caught up.
    public var unreadCount: Int

    public init(
        id: String,
        kind: Kind,
        title: String,
        participants: [String] = [],
        topic: String? = nil,
        lastMessagePreview: String? = nil,
        lastMessageAuthor: String? = nil,
        lastMessageAt: Date? = nil,
        messageCount: Int = 0,
        unreadCount: Int = 0
    ) {
        self.id = id
        self.kind = kind
        self.title = title
        self.participants = participants
        self.topic = topic
        self.lastMessagePreview = lastMessagePreview
        self.lastMessageAuthor = lastMessageAuthor
        self.lastMessageAt = lastMessageAt
        self.messageCount = messageCount
        self.unreadCount = unreadCount
    }
}

/// A single posted message in a conversation.
public struct CommsMessage: Codable, Sendable, Identifiable, Equatable {
    public enum AuthorKind: String, Codable, Sendable {
        case person, agent, system, unknown
    }

    public var id: String
    public var conversationId: String
    public var actorId: String
    /// Pre-resolved author label ("You", "broker-smith", "system").
    public var authorLabel: String
    public var authorKind: AuthorKind
    public var body: String
    public var createdAt: Date
    public var replyToMessageId: String?
    /// True when this message was authored by the phone operator.
    public var isOperator: Bool

    public init(
        id: String,
        conversationId: String,
        actorId: String,
        authorLabel: String,
        authorKind: AuthorKind,
        body: String,
        createdAt: Date,
        replyToMessageId: String? = nil,
        isOperator: Bool = false
    ) {
        self.id = id
        self.conversationId = conversationId
        self.actorId = actorId
        self.authorLabel = authorLabel
        self.authorKind = authorKind
        self.body = body
        self.createdAt = createdAt
        self.replyToMessageId = replyToMessageId
        self.isOperator = isOperator
    }
}

/// Capability: read the mesh comms (channels + DMs) and post as the operator.
/// The transport resolves how to route a post by the conversation's kind
/// (channel send vs. direct message vs. threaded reply).
public protocol CommsCapability: Sendable {
    /// Conversations the operator can see, most-recently-active first. `kind`
    /// narrows to one room type (nil = all).
    func listConversations(kind: CommsConversation.Kind?, limit: Int) async throws -> [CommsConversation]

    /// Messages in a conversation, oldest → newest.
    func conversationMessages(conversationId: String, limit: Int) async throws -> [CommsMessage]

    /// Post a message into a conversation as the operator. `replyTo` threads the
    /// post under an existing message. Returns the new message id.
    @discardableResult
    func postMessage(conversationId: String, body: String, replyTo: String?) async throws -> String
}
