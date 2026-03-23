import Foundation

public struct ScoutRelayMessage: Identifiable, Codable, Hashable, Sendable {
    public var timestamp: Int
    public var from: String
    public var type: ScoutRelayMessageType
    public var body: String
    public var messageClass: ScoutRelayMessageClass?
    public var speechText: String?
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
        messageClass: ScoutRelayMessageClass? = nil,
        speechText: String? = nil,
        eventID: String? = nil,
        tags: [String] = [],
        recipients: [String] = [],
        channel: String? = nil
    ) {
        self.timestamp = timestamp
        self.from = from
        self.type = type
        self.body = body
        self.messageClass = messageClass
        self.speechText = speechText
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

    public var renderedBody: String {
        if body.hasPrefix("[speak] ") {
            return String(body.dropFirst(8)).trimmingCharacters(in: .whitespacesAndNewlines)
        }

        return body
    }

    public var spokenText: String? {
        let explicitSpeech = speechText?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let explicitSpeech, !explicitSpeech.isEmpty {
            return explicitSpeech
        }

        if tags.contains("speak") || body.hasPrefix("[speak] ") {
            let legacySpeech = renderedBody.trimmingCharacters(in: .whitespacesAndNewlines)
            return legacySpeech.isEmpty ? nil : legacySpeech
        }

        return nil
    }

    public var speaksAloud: Bool {
        spokenText != nil
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
        type == .sys || normalizedChannel == "system" || messageClass == .system
    }
}
