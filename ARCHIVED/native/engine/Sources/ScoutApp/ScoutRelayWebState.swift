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
        struct Receipt: Encodable, Equatable {
            let state: String
            let label: String
            let detail: String?
        }

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
        let receipt: Receipt?
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

        let runtimeInventoryByID = Dictionary(uniqueKeysWithValues: visibleRuntimeAgents.map { ($0.id, $0) })
        let runtimeAgentIDs = visibleRuntimeAgents.map(\.id)
        let profileAgentIDs = agentProfiles.map(\.id)
        let directConversationAgentIDs = relayMessages.flatMap { message -> [String] in
            guard message.isDirectConversation else {
                return []
            }

            return [message.from] + message.recipients
        }

        let allDirectIDs = Set(runtimeAgentIDs + profileAgentIDs + directConversationAgentIDs)
        let filteredDirectIDs = allDirectIDs.filter { candidate in
            !candidate.isEmpty && candidate != relayIdentity && candidate != "system"
        }
        let directSourceIDs = filteredDirectIDs.sorted { lhs, rhs in
            relayWebDisplayName(for: lhs).localizedCaseInsensitiveCompare(relayWebDisplayName(for: rhs)) == .orderedAscending
        }

        let directs = directSourceIDs.map { agentID in
            let latestMessage = latestRelayMessage(for: agentID)
            let profile = agentProfiles.first(where: { $0.id == agentID })
            let runtime = runtimeInventoryByID[agentID]
            let isReachable = relayReachableAgentIDs.contains(agentID) || runtime?.state != "registered"

            return ScoutRelayWebState.DirectThread(
                id: agentID,
                title: profile?.name ?? runtime?.displayName ?? relayWebDisplayName(for: agentID),
                subtitle: profile?.role ?? runtime?.detail ?? "Project agent",
                preview: latestMessage?.renderedBody,
                timestampLabel: latestMessage.map { relayWebFormatTime(timestamp: $0.timestamp) },
                state: runtime?.state ?? relayState(for: agentID),
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
                avatarColor: relayWebAvatarColor(for: message.from),
                receipt: relayWebReceipt(for: message)
            )
        }

        return ScoutRelayWebState(
            title: "Relay",
            subtitle: "\(relayMessages.count) messages · \(visibleRuntimeAgents.count) agents",
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

    private func relayWebReceipt(for message: ScoutRelayMessage) -> ScoutRelayWebState.Message.Receipt? {
        guard message.from == relayIdentity else {
            return nil
        }

        if message.isSystemChannelMessage || message.messageClass == .status {
            return nil
        }

        let targets = Array(Set(message.recipients.filter { $0 != relayIdentity })).sorted()
        guard !targets.isEmpty else {
            return nil
        }

        let relatedMessages = relayMessages.filter { $0.replyToMessageID == message.id }
        if relatedMessages.isEmpty {
            return ScoutRelayWebState.Message.Receipt(
                state: "sent",
                label: "Sent",
                detail: targets.count == 1 ? nil : "\(targets.count) targets"
            )
        }

        let targetStates = targets.map { target in
            relayWebReceiptState(for: target, relatedMessages: relatedMessages)
        }

        let repliedCount = targetStates.filter { $0 == "replied" }.count
        let workingCount = targetStates.filter { $0 == "working" }.count
        let failedCount = targetStates.filter { $0 == "failed" }.count

        if repliedCount == targets.count {
            return ScoutRelayWebState.Message.Receipt(
                state: "replied",
                label: "Replied",
                detail: targets.count == 1 ? nil : "\(repliedCount)/\(targets.count)"
            )
        }

        if workingCount > 0 {
            let detail: String?
            if repliedCount > 0 {
                detail = "\(repliedCount) replied · \(workingCount) working"
            } else if targets.count > 1 {
                detail = "\(workingCount)/\(targets.count) working"
            } else {
                detail = nil
            }

            return ScoutRelayWebState.Message.Receipt(
                state: "working",
                label: "Working",
                detail: detail
            )
        }

        if repliedCount > 0 {
            return ScoutRelayWebState.Message.Receipt(
                state: "partial",
                label: "Partial",
                detail: "\(repliedCount)/\(targets.count) replied"
            )
        }

        if failedCount > 0 {
            return ScoutRelayWebState.Message.Receipt(
                state: "failed",
                label: "Failed",
                detail: targets.count == 1 ? nil : "\(failedCount)/\(targets.count)"
            )
        }

        return ScoutRelayWebState.Message.Receipt(
            state: "sent",
            label: "Sent",
            detail: targets.count == 1 ? nil : "\(targets.count) targets"
        )
    }

    private func relayWebReceiptState(for targetID: String, relatedMessages: [ScoutRelayMessage]) -> String {
        if relatedMessages.contains(where: { $0.from == targetID && $0.messageClass != .status && !$0.isSystemChannelMessage }) {
            return "replied"
        }

        if let statusMessage = relatedMessages.last(where: {
            $0.messageClass == .status && ($0.metadata?["targetAgentId"] == targetID || relatedMessages.count == 1)
        }) {
            let normalized = statusMessage.body.lowercased()
            if normalized.contains("failed") || normalized.contains("not runnable") || normalized.contains("not respond") {
                return "failed"
            }

            if normalized.contains("working") {
                return "working"
            }
        }

        return "sent"
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
