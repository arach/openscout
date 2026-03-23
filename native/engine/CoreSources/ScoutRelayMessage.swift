import Foundation

public struct ScoutRelayMessage: Identifiable, Codable, Hashable, Sendable {
    public var timestamp: Int
    public var from: String
    public var type: ScoutRelayMessageType
    public var body: String
    public var eventID: String?
    public var tags: [String]
    public var recipients: [String]
    public var channel: String?

    public var id: String {
        eventID ?? "\(timestamp)-\(from)-\(type.rawValue)-\(body.hashValue)"
    }

    public init(
        timestamp: Int,
        from: String,
        type: ScoutRelayMessageType,
        body: String,
        eventID: String? = nil,
        tags: [String] = [],
        recipients: [String] = [],
        channel: String? = nil
    ) {
        self.timestamp = timestamp
        self.from = from
        self.type = type
        self.body = body
        self.eventID = eventID
        self.tags = tags
        self.recipients = recipients
        self.channel = channel
    }

    public var mentionedAgents: [String] {
        let inlineMentions = body
            .split(separator: " ")
            .compactMap { token -> String? in
                guard token.hasPrefix("@") else {
                    return nil
                }

                return String(
                    token
                    .dropFirst()
                    .trimmingCharacters(in: CharacterSet(charactersIn: ".,:;!?"))
                )
            }

        return Array(Set(recipients + inlineMentions)).sorted()
    }

    public var speaksAloud: Bool {
        tags.contains("speak") || body.hasPrefix("[speak] ")
    }

    public var renderedBody: String {
        guard speaksAloud else {
            return body
        }

        return String(body.dropFirst(8)).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public var isDirectMessage: Bool {
        !mentionedAgents.isEmpty
    }

    public var normalizedChannel: String? {
        let trimmed = channel?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard let trimmed, !trimmed.isEmpty else {
            return nil
        }

        return trimmed
    }

    public var isVoiceChannelMessage: Bool {
        normalizedChannel == "voice"
    }

    public var isSystemChannelMessage: Bool {
        type == .sys || normalizedChannel == "system"
    }
}
