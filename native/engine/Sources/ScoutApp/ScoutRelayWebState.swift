import Foundation
import ScoutCore

struct ScoutRelayWebState: Encodable, Equatable {
    struct NavigationItem: Encodable, Equatable {
        let kind: String
        let id: String
        let title: String
        let subtitle: String
        let count: Int
    }

    struct DirectThread: Encodable, Equatable {
        let kind = "direct"
        let id: String
        let title: String
        let subtitle: String
        let preview: String?
        let timestampLabel: String?
        let state: String
        let reachable: Bool
    }

    struct VoiceState: Encodable, Equatable {
        let captureState: String
        let captureTitle: String
        let repliesEnabled: Bool
        let detail: String?
        let isCapturing: Bool
    }

    struct Message: Encodable, Equatable {
        let id: String
        let authorId: String
        let authorName: String
        let authorRole: String?
        let body: String
        let timestampLabel: String
        let dayLabel: String
        let normalizedChannel: String?
        let recipients: [String]
        let isDirectConversation: Bool
        let isSystem: Bool
        let isVoice: Bool
        let messageClass: String?
        let routingSummary: String?
        let provenanceSummary: String?
        let provenanceDetail: String?
        let isOperator: Bool
        let avatarLabel: String
        let avatarColor: String
    }

    let title: String
    let subtitle: String
    let transportTitle: String
    let meshTitle: String
    let syncLine: String
    let operatorId: String
    let channels: [NavigationItem]
    let views: [NavigationItem]
    let directs: [DirectThread]
    let messages: [Message]
    let voice: VoiceState
    let lastUpdatedLabel: String?
}

extension ScoutShellViewModel {
    func relayWebStateSnapshot() -> ScoutRelayWebState {
        let channels = [
            ScoutRelayWebState.NavigationItem(
                kind: "channel",
                id: "shared",
                title: "# shared-channel",
                subtitle: "Broadcast updates and shared context.",
                count: relayMessages.filter(relayWebIsSharedChannelMessage).count
            ),
            ScoutRelayWebState.NavigationItem(
                kind: "channel",
                id: "voice",
                title: "# voice",
                subtitle: "Voice-related chat, transcripts, and spoken updates.",
                count: relayMessages.filter(relayWebIsVoiceChannelMessage).count
            ),
            ScoutRelayWebState.NavigationItem(
                kind: "channel",
                id: "system",
                title: "# system",
                subtitle: "State, lifecycle, and infrastructure events.",
                count: relayMessages.filter(relayWebIsSystemChannelMessage).count
            ),
        ]

        let views = [
            ScoutRelayWebState.NavigationItem(
                kind: "filter",
                id: "mentions",
                title: "Mentions",
                subtitle: "Focused view over shared-channel targeted messages.",
                count: relayMessages.filter(relayWebIsMentionsMessage).count
            ),
        ]

        let directs = agentProfiles.compactMap { agent -> ScoutRelayWebState.DirectThread? in
            let latestMessage = latestRelayMessage(for: agent.id)
            let isReachable = relayReachableAgentIDs.contains(agent.id)
            guard isReachable || latestMessage != nil else {
                return nil
            }

            return ScoutRelayWebState.DirectThread(
                id: agent.id,
                title: agent.name,
                subtitle: agent.role,
                preview: latestMessage?.renderedBody,
                timestampLabel: latestMessage.map { relayWebFormatTime(timestamp: $0.timestamp) },
                state: relayState(for: agent.id),
                reachable: isReachable
            )
        }

        let messages = relayMessages.map { message in
            ScoutRelayWebState.Message(
                id: message.id,
                authorId: message.from,
                authorName: relayWebDisplayName(for: message.from),
                authorRole: relayWebRole(for: message.from),
                body: message.renderedBody,
                timestampLabel: relayWebFormatTime(timestamp: message.timestamp),
                dayLabel: relayWebFormatDay(timestamp: message.timestamp),
                normalizedChannel: message.normalizedChannel,
                recipients: message.recipients,
                isDirectConversation: message.isDirectConversation,
                isSystem: message.isSystemChannelMessage,
                isVoice: message.isVoiceChannelMessage || message.speaksAloud,
                messageClass: message.messageClass?.rawValue,
                routingSummary: message.routingSummary,
                provenanceSummary: message.provenanceSummary,
                provenanceDetail: message.provenanceDetail,
                isOperator: message.from == relayIdentity,
                avatarLabel: relayWebAvatarLabel(for: message.from),
                avatarColor: relayWebAvatarColor(for: message.from)
            )
        }

        return ScoutRelayWebState(
            title: "Relay",
            subtitle: "\(relayMessages.count) messages · \(agentProfiles.count) agents",
            transportTitle: relayTransportMode.title,
            meshTitle: meshStatusTitle,
            syncLine: "\(relayTransportMode.title) sync · \(meshStatusLine)",
            operatorId: relayIdentity,
            channels: channels,
            views: views,
            directs: directs,
            messages: messages,
            voice: ScoutRelayWebState.VoiceState(
                captureState: voiceBridgeStatus.captureState.rawValue,
                captureTitle: voiceCaptureButtonTitle,
                repliesEnabled: voiceRepliesEnabled,
                detail: relayWebVoiceDetail,
                isCapturing: isVoiceCaptureActive
            ),
            lastUpdatedLabel: relayLastUpdatedAt.map { relayWebFormatRelativeTime($0) }
        )
    }

    func relayWebSendMessage(
        body: String,
        destinationKind: String,
        destinationID: String
    ) async throws {
        switch (destinationKind, destinationID) {
        case ("direct", let agentID):
            _ = try await quickSendMessage(
                body,
                to: [agentID],
                invokeTargets: [agentID],
                speaksAloud: false,
                channel: nil,
                type: .msg
            )
        case ("channel", "system"):
            _ = try await quickSendMessage(
                body,
                to: [],
                invokeTargets: [],
                speaksAloud: false,
                channel: "system",
                type: .sys
            )
        case ("channel", let channelID):
            _ = try await quickSendMessage(
                body,
                to: [],
                invokeTargets: [],
                speaksAloud: false,
                channel: channelID,
                type: .msg
            )
        case ("filter", _):
            _ = try await quickSendMessage(
                body,
                to: [],
                invokeTargets: [],
                speaksAloud: false,
                channel: "shared",
                type: .msg
            )
        default:
            throw NSError(
                domain: "OpenScout",
                code: 41,
                userInfo: [NSLocalizedDescriptionKey: "Unsupported Relay destination."]
            )
        }
    }

    private var relayWebVoiceDetail: String? {
        if let voiceLastError, !voiceLastError.isEmpty {
            return voiceLastError
        }

        if !voicePartialTranscript.isEmpty {
            return voicePartialTranscript
        }

        switch voiceBridgeStatus.captureState {
        case .connecting, .processing:
            return voiceBridgeStatus.detail
        case .recording:
            return "Listening for your next update."
        case .idle, .unavailable, .error:
            return nil
        }
    }

    private func relayWebDisplayName(for actorID: String) -> String {
        if actorID == relayIdentity {
            return "You"
        }

        if let profile = agentProfiles.first(where: { $0.id == actorID }) {
            return profile.name
        }

        if actorID == "system" {
            return "System"
        }

        let fallback = actorID.replacingOccurrences(of: "-", with: " ")
        return fallback.prefix(1).uppercased() + fallback.dropFirst()
    }

    private func relayWebRole(for actorID: String) -> String? {
        if actorID == relayIdentity {
            return "Operator"
        }

        return agentProfiles.first(where: { $0.id == actorID })?.role
    }

    private func relayWebAvatarLabel(for actorID: String) -> String {
        String(relayWebDisplayName(for: actorID).prefix(1)).uppercased()
    }

    private func relayWebAvatarColor(for actorID: String) -> String {
        let palette = [
            "#3B82F6",
            "#14B8A6",
            "#FB923C",
            "#F43F5E",
            "#8B5CF6",
            "#10B981",
        ]
        let seed = actorID.unicodeScalars.reduce(0) { partialResult, scalar in
            partialResult + Int(scalar.value)
        }

        return palette[seed % palette.count]
    }

    private func relayWebFormatTime(timestamp: Int) -> String {
        Date(timeIntervalSince1970: TimeInterval(timestamp))
            .formatted(date: .omitted, time: .shortened)
    }

    private func relayWebFormatDay(timestamp: Int) -> String {
        Date(timeIntervalSince1970: TimeInterval(timestamp))
            .formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
    }

    private func relayWebFormatRelativeTime(_ date: Date) -> String {
        let seconds = max(0, Int(Date().timeIntervalSince(date)))
        if seconds < 5 {
            return "just now"
        }

        if seconds < 60 {
            return "\(seconds)s ago"
        }

        if seconds < 3600 {
            return "\(seconds / 60)m ago"
        }

        if seconds < 86_400 {
            return "\(seconds / 3600)h ago"
        }

        return "\(seconds / 86_400)d ago"
    }

    private func relayWebIsSharedChannelMessage(_ message: ScoutRelayMessage) -> Bool {
        guard !message.isSystemChannelMessage else {
            return false
        }

        guard !relayWebIsVoiceChannelMessage(message) else {
            return false
        }

        guard !message.isDirectMessage else {
            return false
        }

        return message.normalizedChannel == nil || message.normalizedChannel == "shared"
    }

    private func relayWebIsMentionsMessage(_ message: ScoutRelayMessage) -> Bool {
        guard !message.isDirectMessage else {
            return false
        }

        guard !message.isSystemChannelMessage, !relayWebIsVoiceChannelMessage(message) else {
            return false
        }

        return !message.targetedAgents.isEmpty
    }

    private func relayWebIsVoiceChannelMessage(_ message: ScoutRelayMessage) -> Bool {
        message.isVoiceChannelMessage || message.speaksAloud
    }

    private func relayWebIsSystemChannelMessage(_ message: ScoutRelayMessage) -> Bool {
        message.isSystemChannelMessage
    }
}
