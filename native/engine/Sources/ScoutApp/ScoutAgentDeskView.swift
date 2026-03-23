import ScoutCore
import SwiftUI

private enum RelayChannel: String, CaseIterable, Hashable {
    case shared
    case mentions
    case voice
    case system

    var title: String {
        switch self {
        case .shared:
            return "shared-channel"
        case .mentions:
            return "mentions"
        case .voice:
            return "voice"
        case .system:
            return "system"
        }
    }

    var label: String {
        switch self {
        case .mentions:
            return "@ mentions"
        default:
            return "# \(title)"
        }
    }

    var icon: String {
        switch self {
        case .shared:
            return "number"
        case .mentions:
            return "at"
        case .voice:
            return "waveform"
        case .system:
            return "gearshape.2"
        }
    }

    var subtitle: String {
        switch self {
        case .shared:
            return "Broadcast updates and shared context."
        case .mentions:
            return "Messages with explicit agent targets."
        case .voice:
            return "Relay messages tagged for spoken output."
        case .system:
            return "State and infrastructure events."
        }
    }
}

private enum RelayComposeMode: String, CaseIterable, Hashable {
    case message
    case speak

    var title: String {
        switch self {
        case .message:
            return "Message"
        case .speak:
            return "Speak"
        }
    }

    var sendLabel: String {
        switch self {
        case .message:
            return "Send"
        case .speak:
            return "Speak"
        }
    }

    var subtitle: String {
        switch self {
        case .message:
            return "Append a normal relay message."
        case .speak:
            return "Tag the message for voice delivery."
        }
    }
}

private enum RelayPresenceState: String, CaseIterable, Hashable {
    case thinking
    case reviewing
    case blocked
    case speaking
    case idle

    var title: String {
        switch self {
        case .thinking:
            return "Thinking"
        case .reviewing:
            return "Reviewing"
        case .blocked:
            return "Blocked"
        case .speaking:
            return "Speaking"
        case .idle:
            return "Clear"
        }
    }
}

private enum RelayDestination: Hashable {
    case channel(RelayChannel)
    case direct(String)
}

struct ScoutAgentDeskView: View {
    @Bindable var viewModel: ScoutShellViewModel

    @State private var draft = ""
    @State private var targetAgentIDs = Set<String>()
    @State private var composeMode: RelayComposeMode = .message
    @State private var selectedDestination: RelayDestination = .channel(.shared)
    @State private var leftRailCollapsed = false
    @State private var composerMetrics = ScoutEditorMetrics.empty

    private var filteredMessages: [ScoutRelayMessage] {
        switch selectedDestination {
        case .channel(.shared):
            return viewModel.relayMessages.filter(isSharedChannelMessage)
        case .channel(.mentions):
            return viewModel.relayMessages.filter(isMentionsChannelMessage)
        case .channel(.voice):
            return viewModel.relayMessages.filter(isVoiceChannelMessage)
        case .channel(.system):
            return viewModel.relayMessages.filter(isSystemChannelMessage)
        case let .direct(agentID):
            return viewModel.relayMessages.filter {
                $0.from == agentID || $0.mentionedAgents.contains(agentID)
            }
        }
    }

    private var selectedAgentNames: [String] {
        viewModel.agentProfiles
            .filter { targetAgentIDs.contains($0.id) }
            .map(\.name)
    }

    private var selectedAgent: ScoutAgentProfile? {
        guard case let .direct(agentID) = selectedDestination else {
            return nil
        }

        return agentProfile(id: agentID)
    }

    var body: some View {
        HStack(spacing: 0) {
            leftRail

            Rectangle()
                .fill(ScoutTheme.border.opacity(0.7))
                .frame(width: 1)

            threadStage
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(ScoutTheme.canvas)
        .onAppear(perform: syncVoiceRouting)
        .onChange(of: selectedDestination) { _, _ in
            syncVoiceRouting()
        }
        .onChange(of: targetAgentIDs) { _, _ in
            syncVoiceRouting()
        }
        .onChange(of: viewModel.relayComposerResetToken) { _, _ in
            resetComposer()
        }
    }

    private var leftRail: some View {
        VStack(alignment: .leading, spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    railSection(title: "Channels") {
                        ForEach(RelayChannel.allCases, id: \.self) { channel in
                            RelayRailRow(
                                title: channel.label,
                                subtitle: channel.subtitle,
                                icon: channel.icon,
                                badge: messageCount(for: channel) > 0 ? "\(messageCount(for: channel))" : nil,
                                isSelected: selectedDestination == .channel(channel),
                                isCollapsed: leftRailCollapsed,
                                action: {
                                    select(channel: channel)
                                }
                            )
                        }
                    }

                    railSection(title: "Direct Messages") {
                        ForEach(viewModel.agentProfiles) { agent in
                            RelayDirectRow(
                                agent: agent,
                                state: viewModel.relayState(for: agent.id),
                                preview: viewModel.latestRelayMessage(for: agent.id)?.renderedBody,
                                timestamp: latestTimestamp(for: agent.id),
                                isSelected: selectedDestination == .direct(agent.id),
                                isCollapsed: leftRailCollapsed,
                                action: {
                                    select(agentID: agent.id)
                                }
                            )
                        }
                    }
                }
                .padding(.horizontal, leftRailCollapsed ? 10 : 12)
                .padding(.top, 18)
                .padding(.bottom, 14)
            }
            .scrollIndicators(.hidden)

            railFooter
        }
        .frame(width: leftRailCollapsed ? 82 : 296)
        .background(ScoutTheme.sidebar)
        .overlay(alignment: .topTrailing) {
            Button {
                withAnimation(.easeInOut(duration: 0.18)) {
                    leftRailCollapsed.toggle()
                }
            } label: {
                Image(systemName: leftRailCollapsed ? "sidebar.right" : "sidebar.left")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(ScoutTheme.inkMuted)
                    .frame(width: 28, height: 28)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(ScoutTheme.surface.opacity(0.92))
                            .overlay(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .strokeBorder(ScoutTheme.border.opacity(0.45), lineWidth: 0.75)
                            )
                    )
            }
            .buttonStyle(.plain)
            .help(leftRailCollapsed ? "Expand relay rail" : "Collapse relay rail")
            .padding(.top, 10)
            .padding(.trailing, leftRailCollapsed ? 10 : 12)
        }
    }

    @ViewBuilder
    private func railSection<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if !leftRailCollapsed {
                Text(title.uppercased())
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .tracking(0.7)
                    .foregroundStyle(ScoutTheme.inkFaint)
                    .padding(.horizontal, 6)
            }

            content()
        }
    }

    private var railFooter: some View {
        VStack(alignment: .leading, spacing: 12) {
            Rectangle()
                .fill(ScoutTheme.border.opacity(0.7))
                .frame(height: 1)

            if leftRailCollapsed {
                VStack(spacing: 10) {
                    RelayStatusDot(state: viewModel.operatorRelayState)

                    Menu {
                        ForEach(RelayPresenceState.allCases, id: \.self) { state in
                            Button(state.title) {
                                Task {
                                    await viewModel.setOperatorRelayState(state == .idle ? nil : state.rawValue)
                                }
                            }
                        }
                    } label: {
                        Image(systemName: "person.crop.circle.badge.clock")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(ScoutTheme.inkMuted)
                            .frame(width: 30, height: 30)
                            .background(
                                RoundedRectangle(cornerRadius: 9, style: .continuous)
                                    .fill(ScoutTheme.surface.opacity(0.9))
                            )
                    }
                    .menuStyle(.borderlessButton)
                }
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 8)
                .padding(.bottom, 14)
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 8) {
                        RelayStatusDot(state: viewModel.operatorRelayState)

                        VStack(alignment: .leading, spacing: 2) {
                            Text("Operator")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(ScoutTheme.ink)

                            Text(viewModel.operatorRelayState)
                                .font(.system(size: 11))
                                .foregroundStyle(ScoutTheme.inkSecondary)
                        }

                        Spacer(minLength: 0)

                        Menu("Set State") {
                            ForEach(RelayPresenceState.allCases, id: \.self) { state in
                                Button(state.title) {
                                    Task {
                                        await viewModel.setOperatorRelayState(state == .idle ? nil : state.rawValue)
                                    }
                                }
                            }
                        }
                        .menuStyle(.borderlessButton)
                    }

                    HStack(spacing: 8) {
                        RelayInlineMetric(
                            icon: "dot.radiowaves.left.and.right",
                            label: viewModel.relayTransportMode.title
                        )

                        RelayInlineMetric(
                            icon: voiceCaptureIcon,
                            label: viewModel.voiceBridgeStatus.captureState.title
                        )
                    }

                    Text("Updated \(lastUpdatedLabel)")
                        .font(.system(size: 11))
                        .foregroundStyle(ScoutTheme.inkFaint)
                }
                .padding(.horizontal, 14)
                .padding(.top, 6)
                .padding(.bottom, 14)
            }
        }
        .background(ScoutTheme.sidebar)
    }

    private var threadStage: some View {
        VStack(spacing: 0) {
            threadHeader

            Rectangle()
                .fill(ScoutTheme.border.opacity(0.7))
                .frame(height: 1)

            timeline

            Rectangle()
                .fill(ScoutTheme.border.opacity(0.7))
                .frame(height: 1)

            composer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(ScoutTheme.thread)
    }

    private var threadHeader: some View {
        HStack(alignment: .center, spacing: 14) {
            RelayConversationIcon(
                icon: selectedConversationIcon,
                label: selectedConversationAbbreviation,
                tint: selectedConversationTint
            )

            VStack(alignment: .leading, spacing: 4) {
                Text(selectedConversationTitle)
                    .font(.system(size: 22, weight: .medium))
                    .foregroundStyle(ScoutTheme.ink)

                HStack(spacing: 8) {
                    Text(selectedConversationSubtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(ScoutTheme.inkSecondary)

                    Circle()
                        .fill(ScoutTheme.borderStrong)
                        .frame(width: 4, height: 4)

                    Text("\(filteredMessages.count) message\(filteredMessages.count == 1 ? "" : "s")")
                        .font(.system(size: 12))
                        .foregroundStyle(ScoutTheme.inkMuted)
                }
            }

            Spacer(minLength: 0)

            HStack(spacing: 8) {
                RelayPill(
                    title: viewModel.voiceBridgeStatus.captureState.title,
                    icon: voiceCaptureIcon,
                    tint: voiceCaptureTint
                )

                Button(viewModel.voiceCaptureButtonTitle) {
                    viewModel.toggleVoiceCapture()
                }
                .buttonStyle(ScoutButtonStyle(tone: viewModel.isVoiceCaptureActive ? .primary : .secondary))

                Button(viewModel.voiceRepliesEnabled ? "Voice On" : "Voice Off") {
                    viewModel.toggleVoiceRepliesEnabled()
                }
                .buttonStyle(ScoutButtonStyle(tone: viewModel.voiceRepliesEnabled ? .secondary : .quiet))

                RelayPill(
                    title: viewModel.relayTransportMode.title,
                    icon: viewModel.relayTransportMode == .watching ? "dot.radiowaves.left.and.right" : "clock.arrow.circlepath",
                    tint: viewModel.relayTransportMode == .watching ? ScoutTheme.accent : ScoutTheme.inkMuted
                )
            }
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 18)
        .background(ScoutTheme.surfaceStrong.opacity(0.96))
    }

    private var timeline: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if filteredMessages.isEmpty {
                        emptyThread
                    } else {
                        ForEach(Array(filteredMessages.enumerated()), id: \.element.id) { index, message in
                            RelayThreadRow(
                                message: message,
                                currentIdentity: viewModel.relayIdentity,
                                profile: agentProfile(id: message.from)
                            )

                            if index < filteredMessages.count - 1 {
                                Rectangle()
                                    .fill(ScoutTheme.border.opacity(0.38))
                                    .frame(height: 1)
                                    .padding(.leading, message.type == .sys ? 24 : 72)
                            }
                        }
                    }

                    Color.clear
                        .frame(height: 1)
                        .id("relay-bottom")
                }
                .padding(.vertical, 12)
            }
            .scrollIndicators(.hidden)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(ScoutTheme.thread)
            .onAppear {
                scrollToBottom(proxy)
            }
            .onChange(of: filteredMessages.count) { _, _ in
                scrollToBottom(proxy)
            }
        }
    }

    private var emptyThread: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("No relay traffic here yet.")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(ScoutTheme.ink)

            Text("Pick a channel, target an agent, or send the first message from the composer below.")
                .font(.system(size: 13))
                .foregroundStyle(ScoutTheme.inkSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 24)
        .padding(.vertical, 28)
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(composeHeaderTitle)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(ScoutTheme.ink)

                    Text(composeMode.subtitle)
                        .font(.system(size: 12))
                        .foregroundStyle(ScoutTheme.inkSecondary)
                }

                Spacer(minLength: 0)

                ScoutTabBar(
                    items: RelayComposeMode.allCases.map { ScoutTabItem(id: $0, title: $0.title) },
                    selection: $composeMode
                )
            }

            HStack(spacing: 8) {
                RelayPill(title: "From \(viewModel.relayIdentity)", icon: "person.crop.square", tint: ScoutTheme.inkMuted)

                RelayPill(
                    title: targetSummary,
                    icon: targetAgentIDs.isEmpty ? selectedConversationIcon : "person.2",
                    tint: targetAgentIDs.isEmpty ? ScoutTheme.inkMuted : ScoutTheme.accent
                )

                Spacer(minLength: 0)

                if !targetAgentIDs.isEmpty {
                    Button("Broadcast") {
                        targetAgentIDs.removeAll()
                        selectedDestination = .channel(.shared)
                    }
                    .buttonStyle(ScoutButtonStyle(tone: .quiet))
                }
            }

            if shouldShowVoiceStatus {
                RelayVoiceStatusStrip(
                    title: voiceStatusTitle,
                    detail: viewModel.voiceModeDetail,
                    icon: voiceCaptureIcon,
                    tint: voiceCaptureTint
                )
            }

            ZStack(alignment: .topLeading) {
                ScoutTextEditor(
                    text: $draft,
                    metrics: $composerMetrics,
                    usesMonospacedFont: false,
                    showsLineNumbers: false,
                    accessibilityLabel: "Relay message",
                    accessibilityHint: composePlaceholder
                )
                .frame(minHeight: 110, maxHeight: 180)

                if draft.isEmpty {
                    Text(composePlaceholder)
                        .font(.system(size: 14))
                        .foregroundStyle(ScoutTheme.inkFaint)
                        .padding(.leading, 14)
                        .padding(.top, 13)
                        .allowsHitTesting(false)
                }
            }
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(ScoutTheme.input)
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .strokeBorder(ScoutTheme.border.opacity(0.7), lineWidth: 0.75)
                    )
            )

            HStack(alignment: .center, spacing: 12) {
                Text(composeFooter)
                    .font(.system(size: 12))
                    .foregroundStyle(ScoutTheme.inkSecondary)

                Spacer(minLength: 0)

                Text(metricsSummary)
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(ScoutTheme.inkFaint)

                Button(composeMode.sendLabel) {
                    sendMessage()
                }
                .buttonStyle(ScoutButtonStyle(tone: .primary))
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
        .padding(.bottom, 18)
        .background(ScoutTheme.surfaceStrong.opacity(0.98))
    }

    private var composeHeaderTitle: String {
        if let selectedAgent {
            return "Message \(selectedAgent.name)"
        }

        switch selectedDestination {
        case let .channel(channel):
            return "Post to \(channel.label)"
        case .direct:
            return "Post to direct thread"
        }
    }

    private var composePlaceholder: String {
        if let selectedAgent {
            return "Message \(selectedAgent.name) with context, next steps, or a request."
        }

        switch selectedDestination {
        case .channel(.shared):
            return "Share context, ask a question, or broadcast an update to the channel."
        case .channel(.mentions):
            return "Write a targeted note for one or more agents."
        case .channel(.voice):
            return "Write the message that should be treated as spoken relay output."
        case .channel(.system):
            return "Describe the system event or state change you want to log."
        case .direct:
            return "Write a direct relay message."
        }
    }

    private var composeFooter: String {
        if targetAgentIDs.isEmpty {
            return "No explicit targets selected. This will post to the selected channel."
        }

        return "Selected targets are prepended as @mentions before the message body."
    }

    private var metricsSummary: String {
        "Ln \(composerMetrics.cursorLine)  Col \(composerMetrics.cursorColumn)  \(composerMetrics.wordCount) words"
    }

    private var targetSummary: String {
        if !selectedAgentNames.isEmpty {
            return "To \(selectedAgentNames.joined(separator: ", "))"
        }

        if let selectedAgent {
            return "Direct thread with \(selectedAgent.name)"
        }

        switch selectedDestination {
        case let .channel(channel):
            return channel.label
        case .direct:
            return "Direct thread"
        }
    }

    private var selectedConversationTitle: String {
        if let selectedAgent {
            return selectedAgent.name
        }

        switch selectedDestination {
        case let .channel(channel):
            return channel.label
        case .direct:
            return "Direct thread"
        }
    }

    private var selectedConversationSubtitle: String {
        if let selectedAgent {
            return "\(selectedAgent.role) · \(selectedAgent.summary)"
        }

        switch selectedDestination {
        case let .channel(channel):
            return channel.subtitle
        case .direct:
            return "Direct thread"
        }
    }

    private var selectedConversationIcon: String {
        if let selectedAgent {
            return selectedAgent.systemImage
        }

        switch selectedDestination {
        case let .channel(channel):
            return channel.icon
        case .direct:
            return "person.crop.circle"
        }
    }

    private var selectedConversationTint: Color {
        if let selectedAgent {
            return avatarTint(for: selectedAgent.id)
        }

        switch selectedDestination {
        case .channel(.shared):
            return ScoutTheme.accent
        case .channel(.mentions):
            return Color(nsColor: .systemOrange)
        case .channel(.voice):
            return Color(nsColor: .systemPink)
        case .channel(.system):
            return ScoutTheme.inkMuted
        case .direct:
            return ScoutTheme.accent
        }
    }

    private var selectedConversationAbbreviation: String {
        if let selectedAgent {
            return String(selectedAgent.name.prefix(1)).uppercased()
        }

        switch selectedDestination {
        case .channel(.shared):
            return "#"
        case .channel(.mentions):
            return "@"
        case .channel(.voice):
            return "V"
        case .channel(.system):
            return "S"
        case .direct:
            return "D"
        }
    }

    private var lastUpdatedLabel: String {
        guard let relayLastUpdatedAt = viewModel.relayLastUpdatedAt else {
            return "waiting for relay"
        }

        return relayLastUpdatedAt.formatted(date: .omitted, time: .standard)
    }

    private func sendMessage() {
        let message = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else {
            return
        }

        Task {
            await viewModel.quickSendMessage(
                message,
                to: resolvedTargets,
                speaksAloud: shouldSpeakMessage,
                channel: composeChannel,
                type: composeMessageType
            )
            draft = ""
        }
    }

    private func select(channel: RelayChannel) {
        selectedDestination = .channel(channel)
        targetAgentIDs.removeAll()
    }

    private func select(agentID: String) {
        selectedDestination = .direct(agentID)
        targetAgentIDs = [agentID]
    }

    private func messageCount(for channel: RelayChannel) -> Int {
        switch channel {
        case .shared:
            return viewModel.relayMessages.filter(isSharedChannelMessage).count
        case .mentions:
            return viewModel.relayMessages.filter(isMentionsChannelMessage).count
        case .voice:
            return viewModel.relayMessages.filter(isVoiceChannelMessage).count
        case .system:
            return viewModel.relayMessages.filter(isSystemChannelMessage).count
        }
    }

    private func latestTimestamp(for agentID: String) -> String? {
        guard let message = viewModel.latestRelayMessage(for: agentID) else {
            return nil
        }

        return formatTimestamp(Double(message.timestamp))
    }

    private func agentProfile(id: String) -> ScoutAgentProfile? {
        viewModel.agentProfiles.first { $0.id == id }
    }

    private func avatarTint(for identity: String) -> Color {
        let palette: [Color] = [
            ScoutTheme.accent,
            Color(nsColor: .systemTeal),
            Color(nsColor: .systemOrange),
            Color(nsColor: .systemPink),
            Color(nsColor: .systemGreen),
            Color(nsColor: .systemIndigo),
        ]
        let seed = identity.unicodeScalars.reduce(0) { partialResult, scalar in
            partialResult + Int(scalar.value)
        }

        return palette[seed % palette.count]
    }

    private func formatTimestamp(_ timestamp: Double) -> String {
        Date(timeIntervalSince1970: TimeInterval(timestamp))
            .formatted(date: .omitted, time: .shortened)
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        DispatchQueue.main.async {
            withAnimation(.easeOut(duration: 0.18)) {
                proxy.scrollTo("relay-bottom", anchor: .bottom)
            }
        }
    }

    private func resetComposer() {
        draft = ""
        targetAgentIDs.removeAll()
        composeMode = .message
        selectedDestination = .channel(.shared)
    }

    private var composeChannel: String? {
        switch selectedDestination {
        case .channel(.shared):
            return "shared"
        case .channel(.mentions):
            return "mentions"
        case .channel(.voice):
            return "voice"
        case .channel(.system):
            return "system"
        case .direct:
            return nil
        }
    }

    private var composeMessageType: ScoutRelayMessageType {
        switch selectedDestination {
        case .channel(.system):
            return .sys
        default:
            return .msg
        }
    }

    private var shouldSpeakMessage: Bool {
        guard composeMessageType != .sys else {
            return false
        }

        return composeMode == .speak
    }

    private var resolvedTargets: [String] {
        Array(targetAgentIDs).sorted()
    }

    private var shouldShowVoiceStatus: Bool {
        selectedDestination == .channel(.voice) ||
        viewModel.isVoiceCaptureActive ||
        !viewModel.voicePartialTranscript.isEmpty ||
        viewModel.voiceLastError != nil
    }

    private var voiceStatusTitle: String {
        if !viewModel.voicePartialTranscript.isEmpty {
            return "Listening"
        }

        if let error = viewModel.voiceLastError, !error.isEmpty {
            return "Voice Error"
        }

        return viewModel.voiceBridgeStatus.captureState.title
    }

    private var voiceCaptureIcon: String {
        switch viewModel.voiceBridgeStatus.captureState {
        case .recording:
            return "waveform.circle.fill"
        case .processing:
            return "waveform.badge.magnifyingglass"
        case .connecting:
            return "dot.radiowaves.left.and.right"
        case .error:
            return "exclamationmark.triangle.fill"
        case .idle:
            return "mic.fill"
        case .unavailable:
            return "mic.slash.fill"
        }
    }

    private var voiceCaptureTint: Color {
        switch viewModel.voiceBridgeStatus.captureState {
        case .recording:
            return Color(nsColor: .systemPink)
        case .processing:
            return Color(nsColor: .systemOrange)
        case .connecting:
            return ScoutTheme.accent
        case .error:
            return Color(nsColor: .systemRed)
        case .idle:
            return Color(nsColor: .systemTeal)
        case .unavailable:
            return ScoutTheme.inkMuted
        }
    }

    private func syncVoiceRouting() {
        viewModel.setVoiceRouting(channel: composeChannel, targets: resolvedTargets)
    }

    private func isSharedChannelMessage(_ message: ScoutRelayMessage) -> Bool {
        guard !message.isSystemChannelMessage else {
            return false
        }

        guard !message.isVoiceChannelMessage else {
            return false
        }

        guard !message.isDirectMessage else {
            return false
        }

        return message.normalizedChannel == nil || message.normalizedChannel == "shared"
    }

    private func isMentionsChannelMessage(_ message: ScoutRelayMessage) -> Bool {
        message.normalizedChannel == "mentions" || message.isDirectMessage
    }

    private func isVoiceChannelMessage(_ message: ScoutRelayMessage) -> Bool {
        message.isVoiceChannelMessage || message.speaksAloud
    }

    private func isSystemChannelMessage(_ message: ScoutRelayMessage) -> Bool {
        message.isSystemChannelMessage
    }
}

private struct RelayRailRow: View {
    let title: String
    let subtitle: String
    let icon: String
    let badge: String?
    let isSelected: Bool
    let isCollapsed: Bool
    let action: () -> Void

    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            Group {
                if isCollapsed {
                    Image(systemName: icon)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(isSelected ? ScoutTheme.accent : ScoutTheme.inkMuted)
                        .frame(maxWidth: .infinity)
                        .frame(height: 38)
                        .background(backgroundShape)
                } else {
                    HStack(spacing: 10) {
                        Image(systemName: icon)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(isSelected ? ScoutTheme.accent : ScoutTheme.inkMuted)
                            .frame(width: 16)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(title)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(ScoutTheme.ink)

                            Text(subtitle)
                                .font(.system(size: 11))
                                .foregroundStyle(ScoutTheme.inkMuted)
                                .lineLimit(1)
                        }

                        Spacer(minLength: 0)

                        if let badge {
                            Text(badge)
                                .font(.system(size: 10, weight: .medium, design: .monospaced))
                                .foregroundStyle(isSelected ? ScoutTheme.accent : ScoutTheme.inkMuted)
                        }
                    }
                    .padding(.horizontal, 12)
                    .frame(height: 44)
                    .background(backgroundShape)
                }
            }
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            isHovered = hovering
        }
        .help(isCollapsed ? title : "")
    }

    private var backgroundShape: some View {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
            .fill(isSelected ? ScoutTheme.selectionStrong : (isHovered ? ScoutTheme.hover : Color.clear))
    }
}

private struct RelayDirectRow: View {
    let agent: ScoutAgentProfile
    let state: String
    let preview: String?
    let timestamp: String?
    let isSelected: Bool
    let isCollapsed: Bool
    let action: () -> Void

    @State private var isHovered = false

    var body: some View {
        Button(action: action) {
            Group {
                if isCollapsed {
                    RelayConversationIcon(
                        icon: agent.systemImage,
                        label: String(agent.name.prefix(1)).uppercased(),
                        tint: tint
                    )
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 4)
                } else {
                    HStack(alignment: .top, spacing: 10) {
                        RelayConversationIcon(
                            icon: agent.systemImage,
                            label: String(agent.name.prefix(1)).uppercased(),
                            tint: tint
                        )

                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 8) {
                                Text(agent.name)
                                    .font(.system(size: 13, weight: .medium))
                                    .foregroundStyle(ScoutTheme.ink)

                                RelayStatusDot(state: state)
                            }

                            Text(preview ?? agent.role)
                                .font(.system(size: 11))
                                .foregroundStyle(ScoutTheme.inkMuted)
                                .lineLimit(1)
                        }

                        Spacer(minLength: 0)

                        if let timestamp {
                            Text(timestamp)
                                .font(.system(size: 10, weight: .medium, design: .monospaced))
                                .foregroundStyle(ScoutTheme.inkFaint)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(backgroundShape)
                }
            }
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            isHovered = hovering
        }
        .help(isCollapsed ? agent.name : "")
    }

    private var tint: Color {
        let palette: [Color] = [
            ScoutTheme.accent,
            Color(nsColor: .systemTeal),
            Color(nsColor: .systemOrange),
            Color(nsColor: .systemPink),
            Color(nsColor: .systemGreen),
            Color(nsColor: .systemIndigo),
        ]
        let seed = agent.id.unicodeScalars.reduce(0) { partialResult, scalar in
            partialResult + Int(scalar.value)
        }

        return palette[seed % palette.count]
    }

    private var backgroundShape: some View {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
            .fill(isSelected ? ScoutTheme.selectionStrong : (isHovered ? ScoutTheme.hover : Color.clear))
    }
}

private struct RelayThreadRow: View {
    let message: ScoutRelayMessage
    let currentIdentity: String
    let profile: ScoutAgentProfile?

    private var isCurrentUser: Bool {
        message.from == currentIdentity
    }

    var body: some View {
        Group {
            if message.type == .sys {
                HStack {
                    Spacer()

                    VStack(spacing: 4) {
                        Text(message.body)
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                            .foregroundStyle(ScoutTheme.inkMuted)
                            .multilineTextAlignment(.center)

                        Text(timestampLabel)
                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                            .foregroundStyle(ScoutTheme.inkFaint)
                    }

                    Spacer()
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 10)
            } else {
                HStack(alignment: .top, spacing: 12) {
                    RelayConversationIcon(
                        icon: profile?.systemImage ?? (isCurrentUser ? "person.crop.circle.fill" : nil),
                        label: senderAbbreviation,
                        tint: avatarTint
                    )

                    VStack(alignment: .leading, spacing: 6) {
                        HStack(alignment: .center, spacing: 8) {
                            Text(senderName)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(ScoutTheme.ink)

                            if message.isVoiceChannelMessage || message.speaksAloud {
                                RelayPill(
                                    title: message.isVoiceChannelMessage ? "#voice" : "speak",
                                    icon: "waveform",
                                    tint: Color(nsColor: .systemPink)
                                )
                            }

                            ForEach(message.mentionedAgents, id: \.self) { agent in
                                RelayPill(title: "@\(agent)", icon: nil, tint: ScoutTheme.inkMuted)
                            }

                            Spacer(minLength: 0)

                            Text(timestampLabel)
                                .font(.system(size: 10, weight: .medium, design: .monospaced))
                                .foregroundStyle(ScoutTheme.inkFaint)
                        }

                        Text(message.renderedBody)
                            .font(.system(size: 14))
                            .foregroundStyle(ScoutTheme.inkSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                    }

                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 24)
                .padding(.vertical, 12)
                .background(
                    isCurrentUser ? ScoutTheme.selection.opacity(0.24) : Color.clear
                )
            }
        }
    }

    private var senderName: String {
        if isCurrentUser {
            return "You"
        }

        return profile?.name ?? message.from
    }

    private var senderAbbreviation: String {
        String(senderName.prefix(1)).uppercased()
    }

    private var avatarTint: Color {
        let palette: [Color] = [
            ScoutTheme.accent,
            Color(nsColor: .systemTeal),
            Color(nsColor: .systemOrange),
            Color(nsColor: .systemPink),
            Color(nsColor: .systemGreen),
            Color(nsColor: .systemIndigo),
        ]
        let seed = message.from.unicodeScalars.reduce(0) { partialResult, scalar in
            partialResult + Int(scalar.value)
        }

        return palette[seed % palette.count]
    }

    private var timestampLabel: String {
        Date(timeIntervalSince1970: TimeInterval(message.timestamp))
            .formatted(date: .omitted, time: .shortened)
    }
}

private struct RelayConversationIcon: View {
    let icon: String?
    let label: String
    let tint: Color

    var body: some View {
        ZStack {
            Circle()
                .fill(tint.opacity(0.14))

            Circle()
                .strokeBorder(tint.opacity(0.16), lineWidth: 0.75)

            if let icon {
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(tint)
            } else {
                Text(label)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(tint)
            }
        }
        .frame(width: 36, height: 36)
    }
}

private struct RelayPill: View {
    let title: String
    let icon: String?
    let tint: Color

    var body: some View {
        HStack(spacing: 5) {
            if let icon {
                Image(systemName: icon)
                    .font(.system(size: 9, weight: .medium))
            }

            Text(title)
                .font(.system(size: 10, weight: .medium, design: .monospaced))
        }
        .foregroundStyle(tint)
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(
            Capsule(style: .continuous)
                .fill(tint.opacity(0.12))
        )
    }
}

private struct RelayStatusDot: View {
    let state: String

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 8, height: 8)
    }

    private var color: Color {
        switch state.lowercased() {
        case "thinking":
            return ScoutTheme.accent
        case "reviewing":
            return Color(nsColor: .systemOrange)
        case "blocked":
            return Color(nsColor: .systemRed)
        case "speaking":
            return Color(nsColor: .systemPink)
        default:
            return ScoutTheme.inkFaint
        }
    }
}

private struct RelayInlineMetric: View {
    let icon: String
    let label: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 10, weight: .medium))

            Text(label)
                .font(.system(size: 11))
        }
        .foregroundStyle(ScoutTheme.inkMuted)
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(ScoutTheme.surface.opacity(0.92))
        )
    }
}

private struct RelayVoiceStatusStrip: View {
    let title: String
    let detail: String
    let icon: String
    let tint: Color

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(tint)
                .frame(width: 22, height: 22)
                .background(
                    Circle()
                        .fill(tint.opacity(0.12))
                )

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(ScoutTheme.ink)

                Text(detail)
                    .font(.system(size: 12))
                    .foregroundStyle(ScoutTheme.inkSecondary)
                    .lineLimit(3)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(ScoutTheme.surfaceMuted)
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(ScoutTheme.border.opacity(0.55), lineWidth: 0.75)
                )
        )
    }
}
