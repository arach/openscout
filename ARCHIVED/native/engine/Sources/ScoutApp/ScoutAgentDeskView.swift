import ScoutCore
import SwiftUI

private enum RelayChannel: String, CaseIterable, Hashable {
    case shared
    case voice
    case system

    var title: String {
        switch self {
        case .shared:
            return "shared-channel"
        case .voice:
            return "voice"
        case .system:
            return "system"
        }
    }

    var label: String {
        switch self {
        case .shared:
            return "# \(title)"
        default:
            return "# \(title)"
        }
    }

    var icon: String {
        switch self {
        case .shared:
            return "number"
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
        case .voice:
            return "Voice-related chat, transcripts, and explicit speech cues."
        case .system:
            return "State and infrastructure events."
        }
    }
}

private enum RelayFilter: String, CaseIterable, Hashable {
    case mentions

    var title: String {
        switch self {
        case .mentions:
            return "Mentions"
        }
    }

    var icon: String {
        switch self {
        case .mentions:
            return "at"
        }
    }

    var subtitle: String {
        switch self {
        case .mentions:
            return "Focused view of shared-channel messages that target agents."
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
    case filter(RelayFilter)
    case direct(String)
}

private enum RelayComposeFeedback: Equatable {
    case idle
    case sending
    case sent(String)
    case failed(String)
}

struct ScoutAgentDeskView: View {
    @Bindable var viewModel: ScoutShellViewModel

    @State private var draft = ""
    @State private var targetAgentIDs = Set<String>()
    @State private var selectedDestination: RelayDestination = .channel(.shared)
    @State private var leftRailCollapsed = false
    @State private var composerMetrics = ScoutEditorMetrics.empty
    @State private var composeFeedback: RelayComposeFeedback = .idle

    private var filteredMessages: [ScoutRelayMessage] {
        switch selectedDestination {
        case .channel(.shared):
            return viewModel.relayMessages.filter(isSharedChannelMessage)
        case .channel(.voice):
            return viewModel.relayMessages.filter(isVoiceChannelMessage)
        case .channel(.system):
            return viewModel.relayMessages.filter(isSystemChannelMessage)
        case .filter(.mentions):
            return viewModel.relayMessages.filter(isMentionsChannelMessage)
        case let .direct(agentID):
            return viewModel.relayMessages.filter {
                $0.isDirectConversation && ($0.from == agentID || $0.recipients.contains(agentID))
            }
        }
    }

    private var selectedAgentNames: [String] {
        viewModel.agentProfiles
            .filter { targetAgentIDs.contains($0.id) }
            .map(\.name)
    }

    private var directAgents: [ScoutAgentProfile] {
        viewModel.agentProfiles.filter { agent in
            viewModel.relayReachableAgentIDs.contains(agent.id)
            || viewModel.latestRelayMessage(for: agent.id) != nil
            || selectedDestination == .direct(agent.id)
        }
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
        .onChange(of: draft) { _, _ in
            switch composeFeedback {
            case .sent, .failed:
                composeFeedback = .idle
            case .idle, .sending:
                break
            }
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

                    railSection(title: "Views") {
                        ForEach(RelayFilter.allCases, id: \.self) { filter in
                            RelayRailRow(
                                title: filter.title,
                                subtitle: filter.subtitle,
                                icon: filter.icon,
                                badge: messageCount(for: filter) > 0 ? "\(messageCount(for: filter))" : nil,
                                isSelected: selectedDestination == .filter(filter),
                                isCollapsed: leftRailCollapsed,
                                action: {
                                    select(filter: filter)
                                }
                            )
                        }
                    }

                    railSection(title: "Direct Messages") {
                        ForEach(directAgents) { agent in
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
                            icon: "point.3.connected.trianglepath.dotted",
                            label: viewModel.meshInlineMetricLabel
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
        HStack(alignment: .top, spacing: 18) {
            RelayConversationIcon(
                icon: selectedConversationIcon,
                label: selectedConversationAbbreviation,
                tint: selectedConversationTint
            )

            VStack(alignment: .leading, spacing: 4) {
                Text(selectedConversationTitle)
                    .font(.system(size: 22, weight: .medium))
                    .foregroundStyle(ScoutTheme.ink)
                    .lineLimit(1)

                Text(threadSummaryLine)
                    .font(.system(size: 13))
                    .foregroundStyle(ScoutTheme.inkSecondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 18)

            VStack(alignment: .trailing, spacing: 8) {
                if shouldShowHeaderVoiceStatus {
                    RelayInlineStatus(
                        title: voiceStatusTitle,
                        detail: compactVoiceStatusDetail,
                        icon: voiceCaptureIcon,
                        tint: voiceCaptureTint
                    )
                }

                HStack(spacing: 10) {
                    RelayHeaderToggle(
                        title: "Mic",
                        icon: voiceCaptureIcon,
                        isActive: viewModel.isVoiceCaptureActive,
                        tint: voiceCaptureTint
                    ) {
                        viewModel.toggleVoiceCapture()
                    }

                    RelayHeaderToggle(
                        title: "Speak",
                        icon: viewModel.voiceRepliesEnabled ? "speaker.wave.2.fill" : "speaker.slash.fill",
                        isActive: viewModel.voiceRepliesEnabled,
                        tint: ScoutTheme.accent
                    ) {
                        viewModel.toggleVoiceRepliesEnabled()
                    }
                }
            }
            .layoutPriority(1)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 16)
        .background(ScoutTheme.surfaceStrong.opacity(0.96))
    }

    private var timeline: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        if filteredMessages.isEmpty {
                            emptyThread
                        } else {
                            ForEach(Array(filteredMessages.enumerated()), id: \.element.id) { index, message in
                                RelayThreadRow(
                                    message: message,
                                    previousMessage: index > 0 ? filteredMessages[index - 1] : nil,
                                    currentIdentity: viewModel.relayIdentity,
                                    profile: agentProfile(id: message.from)
                                )
                            }
                        }

                        Color.clear
                            .frame(height: 1)
                            .id("relay-bottom")
                    }
                    .frame(maxWidth: 940, alignment: .leading)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                }
                .frame(maxWidth: .infinity, alignment: .topLeading)
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

                    Text(composeSubtitle)
                        .font(.system(size: 12))
                        .foregroundStyle(ScoutTheme.inkSecondary)
                }

                Spacer(minLength: 0)
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
                    behavior: .composer,
                    accessibilityLabel: "Relay message",
                    accessibilityHint: composePlaceholder,
                    onCommandEnter: {
                        sendMessage()
                    }
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

            if let feedbackDetail {
                RelayComposerFeedbackStrip(
                    detail: feedbackDetail,
                    tone: feedbackTone
                )
            }

            HStack(alignment: .center, spacing: 12) {
                Text(composeFooter)
                    .font(.system(size: 12))
                    .foregroundStyle(ScoutTheme.inkSecondary)

                Spacer(minLength: 0)

                Text(metricsSummary)
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(ScoutTheme.inkFaint)

                Button(isSending ? "Sending…" : "Send") {
                    sendMessage()
                }
                .buttonStyle(ScoutButtonStyle(tone: .primary))
                .disabled(isSendDisabled)
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
        case .filter(.mentions):
            return "Post to #shared-channel"
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
        case .channel(.voice):
            return "Post a typed message to the voice channel."
        case .channel(.system):
            return "Describe the system event or state change you want to log."
        case .filter(.mentions):
            return "Write a targeted note for one or more agents. It still posts into #shared-channel."
        case .direct:
            return "Write a direct relay message."
        }
    }

    private var composeSubtitle: String {
        switch selectedDestination {
        case .channel(.voice):
            return "Type to the voice channel. Playback stays optional and separate."
        case .filter(.mentions):
            return "This is a filtered view of targeted shared-channel messages, not a separate channel."
        default:
            return "Append a normal relay message."
        }
    }

    private var composeFooter: String {
        if isSending {
            return "Posting through the local control plane."
        }

        if targetAgentIDs.isEmpty {
            return "No explicit targets selected. This will post to the selected channel. Use ⌘↩ to send."
        }

        if selectedDestination == .filter(.mentions) {
            return "Selected targets are mentioned and invoked when runnable. The message still posts to #shared-channel. Use ⌘↩ to send."
        }

        return "Selected targets are invoked as well as mentioned. Use ⌘↩ to send."
    }

    private var metricsSummary: String {
        "Ln \(composerMetrics.cursorLine)  Col \(composerMetrics.cursorColumn)  \(composerMetrics.wordCount) words"
    }

    private var isSending: Bool {
        if case .sending = composeFeedback {
            return true
        }

        return false
    }

    private var isSendDisabled: Bool {
        isSending || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var feedbackDetail: String? {
        switch composeFeedback {
        case .idle:
            return nil
        case .sending:
            return "Sending through the broker."
        case let .sent(detail), let .failed(detail):
            return detail
        }
    }

    private var feedbackTone: RelayComposerFeedbackStrip.Tone {
        switch composeFeedback {
        case .idle, .sending:
            return .neutral
        case .sent:
            return .success
        case .failed:
            return .warning
        }
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
        case let .filter(filter):
            return filter.title
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
        case let .filter(filter):
            return filter.title
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
        case let .filter(filter):
            return filter.subtitle
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
        case let .filter(filter):
            return filter.icon
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
        case .channel(.voice):
            return Color(nsColor: .systemPink)
        case .channel(.system):
            return ScoutTheme.inkMuted
        case .filter(.mentions):
            return Color(nsColor: .systemOrange)
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
        case .channel(.voice):
            return "V"
        case .channel(.system):
            return "S"
        case .filter(.mentions):
            return "@"
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
        guard !message.isEmpty, !isSending else {
            return
        }

        composeFeedback = .sending

        Task {
            do {
                let outcome = try await viewModel.quickSendMessage(
                    message,
                    to: resolvedTargets,
                    invokeTargets: resolvedTargets,
                    speaksAloud: false,
                    channel: composeChannel,
                    type: composeMessageType
                )
                draft = ""
                let detail = sendSuccessDetail(for: outcome)
                if outcome.flights.contains(where: { $0.state == "failed" }) || !outcome.skippedInvokeTargets.isEmpty {
                    composeFeedback = .failed(detail)
                } else {
                    composeFeedback = .sent(detail)
                }
            } catch {
                composeFeedback = .failed(error.localizedDescription)
            }
        }
    }

    private func sendSuccessDetail(for outcome: ScoutRelaySendOutcome) -> String {
        let failedFlights = outcome.flights.filter { $0.state == "failed" }
        if !failedFlights.isEmpty {
            let targets = failedFlights.map(\.targetAgentID).sorted().joined(separator: ", ")
            let detail = failedFlights.compactMap { $0.summary ?? $0.error }.first
                ?? "No runnable endpoint is attached yet."
            return "Message posted, but \(targets) did not run. \(detail)"
        }

        if !outcome.skippedInvokeTargets.isEmpty {
            let skipped = outcome.skippedInvokeTargets.joined(separator: ", ")
            return "Message posted, but \(skipped) is not connected to a runnable endpoint yet."
        }

        if !outcome.flights.isEmpty {
            let targets = outcome.flights.map(\.targetAgentID).sorted().joined(separator: ", ")
            return "Message posted and handed off to \(targets)."
        }

        switch selectedDestination {
        case let .channel(channel):
            return "Message posted to \(channel.label)."
        case .filter(.mentions):
            return "Message posted to #shared-channel."
        case let .direct(agentID):
            return "Message posted to \(agentID)."
        }
    }

    private func select(channel: RelayChannel) {
        selectedDestination = .channel(channel)
        targetAgentIDs.removeAll()
    }

    private func select(filter: RelayFilter) {
        selectedDestination = .filter(filter)
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
        case .voice:
            return viewModel.relayMessages.filter(isVoiceChannelMessage).count
        case .system:
            return viewModel.relayMessages.filter(isSystemChannelMessage).count
        }
    }

    private func messageCount(for filter: RelayFilter) -> Int {
        switch filter {
        case .mentions:
            return viewModel.relayMessages.filter(isMentionsChannelMessage).count
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
        selectedDestination = .channel(.shared)
        composeFeedback = .idle
    }

    private var composeChannel: String? {
        switch selectedDestination {
        case .channel(.shared):
            return "shared"
        case .channel(.voice):
            return "voice"
        case .channel(.system):
            return "system"
        case .filter(.mentions):
            return "shared"
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

    private var resolvedTargets: [String] {
        Array(targetAgentIDs).sorted()
    }

    private var shouldShowVoiceStatus: Bool {
        selectedDestination == .channel(.voice) ||
        viewModel.isVoiceCaptureActive ||
        !viewModel.voicePartialTranscript.isEmpty ||
        viewModel.voiceLastError != nil
    }

    private var shouldShowHeaderVoiceStatus: Bool {
        viewModel.isVoiceCaptureActive ||
        !viewModel.voicePartialTranscript.isEmpty ||
        viewModel.voiceLastError != nil ||
        viewModel.voiceBridgeStatus.captureState == .processing ||
        viewModel.voiceBridgeStatus.captureState == .connecting
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

    private var compactVoiceStatusDetail: String? {
        if let error = viewModel.voiceLastError, !error.isEmpty {
            return error
        }

        if !viewModel.voicePartialTranscript.isEmpty {
            return viewModel.voicePartialTranscript
        }

        switch viewModel.voiceBridgeStatus.captureState {
        case .processing:
            return "Transcribing your latest capture."
        case .connecting:
            return "Connecting to the voice runtime."
        default:
            return nil
        }
    }

    private var threadSummaryLine: String {
        var parts: [String] = [
            selectedConversationSubtitle,
            "\(filteredMessages.count) message\(filteredMessages.count == 1 ? "" : "s")",
        ]

        switch viewModel.relayTransportMode {
        case .watching:
            parts.append("live sync")
        case .pollingFallback:
            parts.append("polling")
        case .inactive:
            parts.append("starting")
        }

        if viewModel.meshPeerNodeCount > 0 {
            parts.append("\(viewModel.meshPeerNodeCount) peer\(viewModel.meshPeerNodeCount == 1 ? "" : "s")")
        }

        return parts.joined(separator: " · ")
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

        return message.normalizedChannel == nil
            || message.normalizedChannel == "shared"
    }

    private func isMentionsChannelMessage(_ message: ScoutRelayMessage) -> Bool {
        guard !message.isDirectMessage else {
            return false
        }

        guard !message.isSystemChannelMessage, !message.isVoiceChannelMessage else {
            return false
        }

        return !message.targetedAgents.isEmpty
    }

    private func isVoiceChannelMessage(_ message: ScoutRelayMessage) -> Bool {
        message.isVoiceChannelMessage || message.speaksAloud
    }

    private func isSystemChannelMessage(_ message: ScoutRelayMessage) -> Bool {
        message.isSystemChannelMessage
    }
}

private struct RelayComposerFeedbackStrip: View {
    enum Tone {
        case neutral
        case success
        case warning
    }

    let detail: String
    let tone: Tone

    private var tint: Color {
        switch tone {
        case .neutral:
            return ScoutTheme.inkMuted
        case .success:
            return ScoutTheme.success
        case .warning:
            return ScoutTheme.warning
        }
    }

    private var icon: String {
        switch tone {
        case .neutral:
            return "arrow.triangle.2.circlepath"
        case .success:
            return "checkmark.circle.fill"
        case .warning:
            return "exclamationmark.triangle.fill"
        }
    }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(tint)

            Text(detail)
                .font(.system(size: 12))
                .foregroundStyle(ScoutTheme.inkSecondary)

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(ScoutTheme.input.opacity(0.9))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(tint.opacity(0.22), lineWidth: 0.8)
                )
        )
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
    let previousMessage: ScoutRelayMessage?
    let currentIdentity: String
    let profile: ScoutAgentProfile?

    private var isCurrentUser: Bool {
        message.from == currentIdentity
    }

    private var isGroupedWithPrevious: Bool {
        guard let previousMessage else {
            return false
        }

        guard message.type != .sys, previousMessage.type != .sys else {
            return false
        }

        guard previousMessage.from == message.from else {
            return false
        }

        return abs(message.timestamp - previousMessage.timestamp) <= 300
    }

    var body: some View {
        Group {
            if message.type == .sys {
                HStack(alignment: .top, spacing: 10) {
                    RelayConversationIcon(
                        icon: "sparkles",
                        label: "S",
                        tint: Color(nsColor: .systemIndigo)
                    )

                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 8) {
                            Text(systemSenderName)
                                .font(.system(size: 12.5, weight: .semibold))
                                .foregroundStyle(ScoutTheme.inkMuted)

                            Text("Status")
                                .font(.system(size: 10, weight: .medium, design: .monospaced))
                                .foregroundStyle(ScoutTheme.inkFaint)
                                .padding(.horizontal, 7)
                                .padding(.vertical, 3)
                                .background(
                                    Capsule(style: .continuous)
                                        .fill(ScoutTheme.surfaceMuted)
                                )

                            Spacer(minLength: 0)

                            Text(timestampLabel)
                                .font(.system(size: 10, weight: .medium, design: .monospaced))
                                .foregroundStyle(ScoutTheme.inkFaint)
                        }

                        Text(message.body)
                            .font(.system(size: 13))
                            .foregroundStyle(ScoutTheme.inkSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(ScoutTheme.surfaceMuted.opacity(0.92))
                    )

                    Spacer(minLength: 0)
                }
                .padding(.top, 10)
                .padding(.bottom, 4)
            } else {
                HStack(alignment: .top, spacing: 12) {
                    if isGroupedWithPrevious {
                        Color.clear
                            .frame(width: 36, height: 8)
                    } else {
                        RelayConversationIcon(
                            icon: profile?.systemImage ?? (isCurrentUser ? "person.crop.circle.fill" : nil),
                            label: senderAbbreviation,
                            tint: avatarTint
                        )
                    }

                    VStack(alignment: .leading, spacing: isGroupedWithPrevious ? 3 : 6) {
                        if !isGroupedWithPrevious {
                            HStack(alignment: .center, spacing: 8) {
                                Text(senderName)
                                    .font(.system(size: 13.5, weight: .semibold))
                                    .foregroundStyle(ScoutTheme.ink)

                                if message.isVoiceChannelMessage || message.speaksAloud {
                                    RelayPill(
                                        title: message.isVoiceChannelMessage ? "#voice" : "speak",
                                        icon: "waveform",
                                        tint: Color(nsColor: .systemPink)
                                    )
                                }

                                Spacer(minLength: 0)

                                Text(timestampLabel)
                                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                                    .foregroundStyle(ScoutTheme.inkFaint)
                            }

                            if let metadataLine {
                                Text(metadataLine)
                                    .font(.system(size: 10.5, weight: .regular, design: .monospaced))
                                    .foregroundStyle(ScoutTheme.inkFaint)
                                    .lineLimit(1)
                                    .help(message.provenanceDetail ?? metadataLine)
                            } else if let routingSummary = message.routingSummary {
                                Text(routingSummary)
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundStyle(ScoutTheme.inkMuted)
                                    .lineLimit(1)
                            }

                            if let replyContext {
                                Text(replyContext)
                                    .font(.system(size: 10.5, weight: .medium))
                                    .foregroundStyle(ScoutTheme.inkMuted)
                                    .lineLimit(1)
                            }
                        }

                        Text(message.renderedBody)
                            .font(.system(size: 14.25))
                            .lineSpacing(1.5)
                            .foregroundStyle(ScoutTheme.inkSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                            .textSelection(.enabled)
                            .padding(.top, isGroupedWithPrevious ? 0 : 1)
                    }
                    .frame(maxWidth: 760, alignment: .leading)

                    Spacer(minLength: 0)
                }
                .padding(.top, isGroupedWithPrevious ? 2 : 11)
                .padding(.bottom, isGroupedWithPrevious ? 2 : 7)
            }
        }
    }

    private var replyContext: String? {
        guard let routingSummary = message.routingSummary else {
            return nil
        }

        let normalized = routingSummary.lowercased()
        guard normalized.hasPrefix("replying") else {
            return nil
        }

        return routingSummary
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

    private var metadataLine: String? {
        var parts: [String] = []

        if let provenanceSummary = message.provenanceSummary {
            parts.append(provenanceSummary)
        }

        if let routingSummary = message.routingSummary,
           !routingSummary.lowercased().hasPrefix("replying") {
            parts.append(routingSummary)
        }

        guard !parts.isEmpty else {
            return nil
        }

        return parts.joined(separator: "  ·  ")
    }

    private var systemSenderName: String {
        if let target = message.metadata?["targetAgentId"], !target.isEmpty {
            return target.capitalized
        }

        return "System"
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

private struct RelayHeaderToggle: View {
    let title: String
    let icon: String
    let isActive: Bool
    let tint: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Image(systemName: icon)
                    .font(.system(size: 11, weight: .medium))

                Text(title)
                    .font(.system(size: 12.5, weight: .medium))
                    .lineLimit(1)
            }
            .foregroundStyle(isActive ? Color.white : ScoutTheme.inkSecondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .fill(isActive ? tint : ScoutTheme.surfaceMuted)
                    .overlay(
                        RoundedRectangle(cornerRadius: 11, style: .continuous)
                            .strokeBorder(isActive ? tint.opacity(0.15) : ScoutTheme.border.opacity(0.5), lineWidth: 0.8)
                    )
            )
        }
        .buttonStyle(.plain)
    }
}

private struct RelayInlineStatus: View {
    let title: String
    let detail: String?
    let icon: String
    let tint: Color

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(tint)

            Text(title)
                .font(.system(size: 11.5, weight: .semibold))
                .foregroundStyle(ScoutTheme.ink)

            if let detail, !detail.isEmpty {
                Text(detail)
                    .font(.system(size: 11))
                    .foregroundStyle(ScoutTheme.inkMuted)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 7)
        .background(
            Capsule(style: .continuous)
                .fill(ScoutTheme.surfaceMuted)
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
