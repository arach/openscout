// CommsCapability (SCO-061).
//
// Shared mesh-comms model + contract: the channels and direct-message threads
// the operator (the phone) reads and posts into. Faithful, pure port of the
// broker's `ConversationDefinition` / `MessageRecord` shapes (packages/protocol),
// flattened for the phone — participants and authors arrive pre-resolved to
// display labels so the UI never has to join against the actor table.

import Foundation

/// Link-backed message attachment. The broker stores metadata only; bytes are
/// fetched from `url` (or a future blob key) by readers/agents.
public struct MessageAttachment: Codable, Sendable, Identifiable, Equatable, Hashable {
    public var id: String
    public var mediaType: String
    public var fileName: String?
    public var blobKey: String?
    public var url: String?

    public init(id: String, mediaType: String, fileName: String? = nil, blobKey: String? = nil, url: String? = nil) {
        self.id = id
        self.mediaType = mediaType
        self.fileName = fileName
        self.blobKey = blobKey
        self.url = url
    }
}

/// Raw bytes staged by a native composer before the bridge hosts them and
/// returns a `MessageAttachment`.
public struct AttachmentUpload: Codable, Sendable, Equatable {
    public var data: Data
    public var mediaType: String
    public var fileName: String?

    public init(data: Data, mediaType: String, fileName: String? = nil) {
        self.data = data
        self.mediaType = mediaType
        self.fileName = fileName
    }
}

public protocol AttachmentHostingCapability: Sendable {
    /// Host bytes somewhere recipients can fetch, returning link-backed metadata
    /// suitable for `PromptSpec.attachments` or `postMessage(... attachments:)`.
    func uploadAttachment(_ attachment: AttachmentUpload) async throws -> MessageAttachment
}

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
    public var attachments: [MessageAttachment]
    /// Stable caller-generated id used to reconcile optimistic local posts with
    /// the authoritative broker echo.
    public var clientMessageId: String?

    public init(
        id: String,
        conversationId: String,
        actorId: String,
        authorLabel: String,
        authorKind: AuthorKind,
        body: String,
        createdAt: Date,
        replyToMessageId: String? = nil,
        isOperator: Bool = false,
        attachments: [MessageAttachment] = [],
        clientMessageId: String? = nil
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
        self.attachments = attachments
        self.clientMessageId = clientMessageId
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
    func postMessage(conversationId: String, body: String, replyTo: String?, attachments: [MessageAttachment]?, clientMessageId: String?) async throws -> String

    /// Mark a conversation read — advances the operator's read cursor on the
    /// broker through the latest message, clearing the unread badge. Returns the
    /// resulting unread count (0 when caught up). Opening a thread should call
    /// this so the count doesn't linger forever.
    @discardableResult
    func markConversationRead(conversationId: String) async throws -> Int
}

public extension CommsCapability {
    @discardableResult
    func postMessage(conversationId: String, body: String, replyTo: String?, attachments: [MessageAttachment]?) async throws -> String {
        try await postMessage(conversationId: conversationId, body: body, replyTo: replyTo, attachments: attachments, clientMessageId: nil)
    }

    @discardableResult
    func postMessage(conversationId: String, body: String, replyTo: String?) async throws -> String {
        try await postMessage(conversationId: conversationId, body: body, replyTo: replyTo, attachments: nil, clientMessageId: nil)
    }
}
