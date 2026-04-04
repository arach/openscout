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
    public var isDirectConversation: Bool
    public var replyToMessageID: String?
    public var metadata: [String: String]?
    public var routingSummary: String?
    public var provenanceSummary: String?
    public var provenanceDetail: String?

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
        channel: String? = nil,
        isDirectConversation: Bool = false,
        replyToMessageID: String? = nil,
        metadata: [String: String]? = nil,
        routingSummary: String? = nil,
        provenanceSummary: String? = nil,
        provenanceDetail: String? = nil
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
        self.isDirectConversation = isDirectConversation
        self.replyToMessageID = replyToMessageID
        self.metadata = metadata
        self.routingSummary = routingSummary
        self.provenanceSummary = provenanceSummary
        self.provenanceDetail = provenanceDetail
    }

    public var mentionedAgents: [String] {
        body
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
            .reduce(into: [String]()) { partialResult, agent in
                if !partialResult.contains(agent) {
                    partialResult.append(agent)
                }
            }
    }

    public var targetedAgents: [String] {
        Array(Set(recipients)).sorted()
    }

    public var renderedBody: String {
        return body
    }

    public var spokenText: String? {
        let explicitSpeech = speechText?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let explicitSpeech, !explicitSpeech.isEmpty {
            return explicitSpeech
        }

        if tags.contains("speak") {
            let spokenBody = renderedBody.trimmingCharacters(in: .whitespacesAndNewlines)
            return spokenBody.isEmpty ? nil : spokenBody
        }

        return nil
    }

    public var speaksAloud: Bool {
        spokenText != nil
    }

    public var isDirectMessage: Bool {
        isDirectConversation
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
