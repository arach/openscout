import HudsonShell
import HudsonUI
import ScoutNativeCore
import ScoutSharedUI
import SwiftUI
#if os(macOS)
import AppKit
#endif

struct ScoutRootView: View {
    @StateObject private var store = ScoutCommsStore()
    @StateObject private var tail = ScoutTailStore()
    @ObservedObject private var vox = ScoutVoxService.shared
    @State private var section: ScoutSection = .comms
    @State private var railCompact = false
    @State private var inspectorCollapsed = false
    @State private var agentContentMode: ScoutAgentContentMode = .roster
    @State private var channelFilter: ScoutChannelFilter = .all
    @State private var draft = ""
    @State private var suggestions: [MessageSuggestion] = []
    @State private var selectedSuggestionIndex = 0
    @State private var currentSuggestionTrigger: MessageSuggestionTrigger?
    @State private var dismissedSuggestionSignature: String?
    @State private var conversationListResizePreviewWidth: CGFloat?
    @State private var composerInputFrame: CGRect = .zero
    @State private var observeSidecarAgent: ScoutAgent?
    @State private var observeSidecarStagingWidth = ScoutObserveSidecarMetrics.peekWidth
    @State private var observeRestoresInspectorCollapsed = false
    @State private var agentPreviewPanelAgent: ScoutAgent?
    @State private var agentPreviewRestoresInspectorCollapsed = false
    @FocusState private var composerFocused: Bool
    @AppStorage("scout.navigationSidebar.labelWidth") private var navigationSidebarLabelWidth = 142.0
    @AppStorage("scout.conversationList.width") private var conversationListWidth = 286.0

    private var manifest: HudAppManifest {
        HudAppManifest(
            name: ScoutNativeAppIdentity.productName,
            version: ScoutNativeAppIdentity.version(fallback: "0.1.1"),
            tint: .green,
            targetLabel: ScoutNativeAppIdentity.targetLabel
        )
    }

    var body: some View {
        HudChromeShell(titlebarStyle: .systemToolbar, titlebarActions: chromeTitlebarActions) {
            HudResizableNavigationSidebar(
                selection: Binding(
                    get: { section },
                    set: { next in
                        if let next {
                            section = next
                        }
                    }
                ),
                entries: sidebarEntries,
                isCompact: $railCompact,
                labelWidth: navigationSidebarLabelWidthBinding,
                accent: manifest.accent,
                minLabelWidth: 112,
                maxLabelWidth: 260,
                collapseLabelWidth: 44,
                railHeader: {
                    Text("S")
                        .font(HudFont.mono(13, weight: .bold))
                        .foregroundStyle(HudPalette.bg)
                        .frame(width: 24, height: 24)
                        .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(manifest.accent))
                },
                labelHeader: {
                    Text("Scout")
                        .font(HudFont.ui(HudTextSize.base, weight: .semibold))
                        .foregroundStyle(HudPalette.ink)
                        .lineLimit(1)
                },
                footer: {
                    ScoutSidebarSettingsButton(
                        isCompact: railCompact,
                        labelWidth: CGFloat(navigationSidebarLabelWidth)
                    ) {
                        ScoutWeb.open(path: "/settings")
                    }
                }
            )
        } trailing: {
            trailingPanel
        } content: {
            content
        } statusBar: {
            statusBar
        }
        .hudsonAppManifest(manifest)
        .environment(\.hudTheme, ScoutDesign.theme)
        .environment(\.hudsonSidebarStyle, HudSidebarStyle(
            surface: .base,
            indicator: .editorial,
            icon: .editorial,
            motion: .base
        ))
        .hudsonSidebarMotionMode(.smoothFade)
        .onAppear {
            store.start()
            tail.start()
        }
        .onDisappear {
            store.stop()
            tail.stop()
        }
    }

    private var sidebarEntries: [HudSidebarEntry<ScoutSection>] {
        [
            .item(HudSidebarItem(id: .comms, title: "Comms", icon: "bubble.left.and.bubble.right", selectedIcon: "bubble.left.and.bubble.right.fill")),
            .item(HudSidebarItem(id: .agents, title: "Agents", icon: "person.2", selectedIcon: "person.2.fill")),
            .item(HudSidebarItem(id: .tail, title: "Tail", icon: "waveform.path.ecg", selectedIcon: "waveform.path.ecg")),
        ]
    }

    private var chromeTitlebarActions: [HudChromeTitlebarAction] {
        [
            HudChromeTitlebarAction(
                id: "scout.navigation",
                placement: .leading,
                label: railCompact ? "Expand navigation" : "Collapse navigation",
                systemImage: "sidebar.left"
            ) {
                withAnimation(HudSidebarMotion.expandCollapse) {
                    railCompact.toggle()
                }
            },
            HudChromeTitlebarAction(
                id: "scout.inspector",
                placement: .trailing,
                label: trailingPanelActionLabel,
                systemImage: "sidebar.right"
            ) {
                withAnimation(.easeOut(duration: 0.14)) {
                    if observeSidecarAgent != nil {
                        closeObserveSidecar()
                    } else if agentPreviewPanelAgent != nil {
                        closeAgentPreviewPanel()
                    } else {
                        inspectorCollapsed.toggle()
                    }
                }
            },
        ]
    }

    @ViewBuilder
    private var content: some View {
        switch section {
        case .comms:
            commsContent
        case .agents:
            agentsContent
        case .tail:
            tailContent
        }
    }

    private var commsContent: some View {
        HStack(spacing: 0) {
            ScoutConversationListBar(
                isLoading: store.isLoading,
                query: $store.channelQuery,
                filter: $channelFilter,
                channels: commsListChannels,
                totalCount: store.channels.count,
                selectedCId: store.selectedCId,
                width: CGFloat(conversationListWidth)
            ) { channel in
                store.selectChannel(channel.cId)
            }
            .overlay(alignment: .trailing) {
                ZStack(alignment: .trailing) {
                    if let conversationListResizePreviewWidth {
                        Rectangle()
                            .fill(HudPalette.accent.opacity(0.62))
                            .frame(width: HudStrokeWidth.standard)
                            .offset(x: conversationListResizePreviewWidth - CGFloat(conversationListWidth))
                            .allowsHitTesting(false)
                    }

                    ScoutConversationResizeHandle(
                        width: conversationListWidthBinding,
                        previewWidth: $conversationListResizePreviewWidth,
                        range: ScoutDesign.conversationListWidthRange
                    )
                    .frame(width: ScoutDesign.conversationResizeHandleWidth)
                    .offset(x: ScoutDesign.conversationResizeHandleWidth / 2)
                }
            }

            chatDetail
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(ScoutDesign.bg)
    }

    private var chatDetail: some View {
        VStack(spacing: 0) {
            chatHeader
            HudDivider(color: ScoutDesign.hairline)
            messageList
            HudDivider(color: ScoutDesign.hairline)
            composer
        }
    }

    private var chatHeader: some View {
        HStack(spacing: HudSpacing.xl) {
            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                Text(store.selectedChannel?.displayTitle ?? "Scout")
                    .font(HudFont.ui(22, weight: .semibold))
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(1)

                HStack(spacing: HudSpacing.md) {
                    if let channel = store.selectedChannel {
                        HudBadge(channel.scope.label, tint: channel.scope == .direct ? HudPalette.statusInfo : HudPalette.statusOk)
                        HudBadge(channel.cIdShort, tint: HudPalette.muted)
                        ScoutMemberStrip(members: selectedChannelMembers) { agent in
                            previewAgent(agent)
                        }
                    } else {
                        HudBadge("No channel", tint: HudPalette.muted)
                    }
                }
            }

            Spacer()

            if let agent = store.selectedAgent {
                HudButton("Agent", icon: "person.crop.circle", style: .secondary) {
                    previewAgent(agent)
                }
            }

            HudButton("Open Web", icon: "safari", style: .ghost) {
                if let cId = store.selectedCId {
                    ScoutWeb.open(path: "/c/\(cId)")
                } else {
                    ScoutWeb.open(path: "/messages")
                }
            }
        }
        .padding(.horizontal, HudSpacing.huge)
        .frame(height: 76)
        .background(ScoutDesign.bg)
    }

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: HudSpacing.xl) {
                    if store.messages.isEmpty {
                        HudEmptyState(
                            title: store.selectedChannel == nil ? "No channel selected" : "No messages yet",
                            subtitle: store.selectedChannel == nil ? "Choose a DM or channel from the list." : "This cId has no visible messages.",
                            icon: "bubble.left"
                        )
                        .frame(maxWidth: .infinity, minHeight: 360)
                    } else {
                        ForEach(store.messages) { message in
                            ScoutMessageRow(
                                message: message,
                                agent: agent(for: message),
                                previewAgent: previewAgent
                            )
                                .id(message.id)
                        }
                    }
                }
                .padding(HudSpacing.huge)
                .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            .scrollIndicators(.visible)
            .onChange(of: store.messages.count) { _, _ in
                if let last = store.messages.last {
                    withAnimation(.easeOut(duration: 0.16)) {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            HStack(alignment: .top, spacing: HudSpacing.md) {
                composerInputWell

                ScoutSendButton(
                    isEnabled: composerCanSend,
                    isSending: store.isSending,
                    action: sendDraft
                )
                .padding(.top, HudSpacing.xs)
            }

            if let status = composerStatusText {
                Text(status)
                    .font(HudFont.mono(9))
                    .foregroundStyle(HudPalette.dim)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.horizontal, HudSpacing.xs)
            }
        }
        .padding(.horizontal, HudSpacing.xxl)
        .padding(.top, HudSpacing.xl)
        .padding(.bottom, HudSpacing.lg)
        .background {
            ZStack(alignment: .top) {
                ScoutDesign.chrome
                LinearGradient(
                    colors: [
                        HudPalette.accent.opacity(composerFocused ? 0.055 : 0.018),
                        Color.clear,
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: 54)
            }
        }
        .overlay(alignment: .top) {
            Rectangle()
                .fill(composerFocused ? HudPalette.accent.opacity(0.42) : ScoutDesign.hairlineStrong)
                .frame(height: HudStrokeWidth.thin)
        }
        .overlay(alignment: .topLeading) {
            if !suggestions.isEmpty {
                MessageSuggestionPopover(
                    suggestions: suggestions,
                    selectedIndex: selectedSuggestionIndex,
                    style: .scout,
                    onHover: selectSuggestion,
                    onSelect: { _ = applySuggestion($0) }
                )
                .frame(width: composerSuggestionWidth, alignment: .leading)
                .offset(
                    x: composerSuggestionX,
                    y: -suggestionPopoverHeight(count: suggestions.count) - HudSpacing.sm
                )
                .transition(.opacity)
            }
        }
        .coordinateSpace(name: "scoutComposer")
        .onPreferenceChange(ScoutComposerInputFrameKey.self) { frame in
            composerInputFrame = frame
        }
        .animation(.easeOut(duration: 0.12), value: suggestions.count)
        .onChange(of: draft) { _, _ in refreshSuggestions() }
        .onChange(of: store.agents.count) { _, _ in refreshSuggestions() }
        .onReceive(vox.$lastFinalText) { spliceDictatedFinal($0) }
    }

    private var composerInputWell: some View {
        HStack(alignment: .top, spacing: HudSpacing.md) {
            ScoutMicButton(box: 28, glyph: 14, action: toggleDictation)
                .padding(.top, 1)

            ZStack(alignment: .topLeading) {
                TextField(showDictationPreview ? "" : composerPlaceholder, text: $draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(HudFont.mono(11))
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(1...5)
                    .focused($composerFocused)
                    .disabled(store.selectedCId == nil || store.isSending)
                    .onKeyPress(phases: .down) { press in
                        if press.key == .return {
                            if applySelectedSuggestion() { return .handled }
                            if press.modifiers.contains(.shift) { return .ignored }
                            sendDraft()
                            return .handled
                        }
                        return .ignored
                    }
                    .onKeyPress(.upArrow) {
                        guard !suggestions.isEmpty else { return .ignored }
                        stepSuggestion(-1)
                        return .handled
                    }
                    .onKeyPress(.downArrow) {
                        guard !suggestions.isEmpty else { return .ignored }
                        stepSuggestion(1)
                        return .handled
                    }
                    .onKeyPress(.escape) {
                        guard !suggestions.isEmpty else { return .ignored }
                        dismissSuggestions()
                        return .handled
                    }

                if showDictationPreview {
                    ScoutDictationPreview(text: vox.partial.isEmpty ? voxStatusLine : vox.partial)
                        .allowsHitTesting(false)
                }
            }
            .padding(.top, 5)
            .padding(.bottom, 3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                GeometryReader { proxy in
                    Color.clear.preference(
                        key: ScoutComposerInputFrameKey.self,
                        value: proxy.frame(in: .named("scoutComposer"))
                    )
                }
            )
        }
        .padding(.leading, HudSpacing.md)
        .padding(.trailing, HudSpacing.lg)
        .padding(.vertical, HudSpacing.sm)
        .frame(maxWidth: .infinity, minHeight: 42, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .fill(composerWellFill)
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .stroke(composerWellBorder, lineWidth: HudStrokeWidth.thin)
        )
        .shadow(
            color: composerFocused ? HudPalette.accent.opacity(0.12) : Color.black.opacity(0.22),
            radius: composerFocused ? 14 : 8,
            x: 0,
            y: 3
        )
    }

    private var composerWellFill: Color {
        if store.selectedCId == nil {
            return HudSurface.inset.opacity(0.64)
        }
        return composerFocused ? HudSurface.control.opacity(0.96) : HudSurface.control.opacity(0.84)
    }

    private var composerWellBorder: Color {
        if store.selectedCId == nil {
            return ScoutDesign.hairline
        }
        return composerFocused ? HudSurface.tintBorder(HudPalette.accent) : ScoutDesign.hairlineStrong
    }

    private var composerPlaceholder: String {
        if let title = store.selectedChannel?.displayTitle, !title.isEmpty {
            return "Message \(title)"
        }
        return "Message"
    }

    private var composerCanSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && store.selectedCId != nil
            && !store.isSending
    }

    private var composerSuggestionX: CGFloat {
        guard composerInputFrame.width > 0 else { return HudSpacing.xxl }
        return max(HudSpacing.xs, composerInputFrame.minX)
    }

    private var composerSuggestionWidth: CGFloat {
        guard composerInputFrame.width > 0 else { return 460 }
        return min(460, max(320, composerInputFrame.width))
    }

    private func suggestionPopoverHeight(count: Int) -> CGFloat {
        25 + CGFloat(min(max(count, 1), 7)) * 38
    }

    private var composerStatusText: String? {
        if store.selectedChannel == nil { return "Select a conversation to message" }
        if isDictating { return voxStatusLine }
        if let reason = voxUnavailableReason { return reason }
        if store.isSending { return "Sending..." }
        if draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return "Type / for commands · @ for agents · session: for sessions"
        }
        return "↵ send · ⇧↵ newline"
    }

    private var showDictationPreview: Bool {
        draft.isEmpty && (vox.state.isCaptureActive || vox.state.isProcessing)
    }

    private var isDictating: Bool {
        switch vox.state {
        case .starting, .recording, .processing: return true
        default: return false
        }
    }

    private var voxStatusLine: String {
        if !vox.partial.isEmpty { return vox.partial }
        switch vox.state {
        case .starting: return "Starting Vox..."
        case .processing: return "Transcribing..."
        default: return "Listening..."
        }
    }

    private var voxUnavailableReason: String? {
        if case .unavailable(let reason) = vox.state { return reason }
        return nil
    }

    private func sendDraft() {
        let body = draft
        guard composerCanSend else { return }
        draft = ""
        composerFocused = true
        clearSuggestions(resetDismissedSignature: true)
        Task { await store.send(body) }
    }

    private func toggleDictation() {
        composerFocused = true
        Task {
            switch ScoutDictationController.toggleDecision(for: vox.state) {
            case .probeThenStartIfIdle:
                await vox.probe()
                if case .idle = vox.state { vox.start() }
            case .start:
                vox.start()
            case .stop:
                vox.stop()
            case .ignore:
                break
            }
        }
    }

    private func spliceDictatedFinal(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        draft = ScoutDictationBuffer.appending(trimmed, to: draft)
        ScoutVoxService.shared.consumeFinalText()
        composerFocused = true
    }

    private func refreshSuggestions() {
        guard let trigger = MessageSuggestionEngine.detectTrigger(in: draft) else {
            clearSuggestions(resetDismissedSignature: true)
            return
        }

        currentSuggestionTrigger = trigger
        if dismissedSuggestionSignature == trigger.signature {
            suggestions = []
            selectedSuggestionIndex = 0
            return
        }

        let next = MessageSuggestionEngine.suggestions(
            for: trigger,
            agents: store.agents.map(MessageSuggestionAgent.init)
        )
        suggestions = next
        selectedSuggestionIndex = next.isEmpty ? 0 : min(selectedSuggestionIndex, next.count - 1)
    }

    private func clearSuggestions(resetDismissedSignature: Bool = false) {
        suggestions = []
        selectedSuggestionIndex = 0
        currentSuggestionTrigger = nil
        if resetDismissedSignature {
            dismissedSuggestionSignature = nil
        }
    }

    private func dismissSuggestions() {
        dismissedSuggestionSignature = currentSuggestionTrigger?.signature
        suggestions = []
        selectedSuggestionIndex = 0
    }

    private func selectSuggestion(_ index: Int) {
        guard !suggestions.isEmpty else { return }
        selectedSuggestionIndex = max(0, min(index, suggestions.count - 1))
    }

    private func stepSuggestion(_ delta: Int) {
        guard !suggestions.isEmpty else { return }
        selectedSuggestionIndex = (selectedSuggestionIndex + delta + suggestions.count) % suggestions.count
    }

    @discardableResult
    private func applySelectedSuggestion() -> Bool {
        guard !suggestions.isEmpty else { return false }
        return applySuggestion(suggestions[min(selectedSuggestionIndex, suggestions.count - 1)])
    }

    @discardableResult
    private func applySuggestion(_ suggestion: MessageSuggestion) -> Bool {
        guard let trigger = currentSuggestionTrigger,
              let start = MessageSuggestionEngine.index(in: draft, offset: trigger.startOffset),
              let end = MessageSuggestionEngine.index(in: draft, offset: trigger.endOffset) else {
            return false
        }

        let before = String(draft[..<start])
        let after = String(draft[end...])
        let replacement = suggestion.kind == .agent && suggestion.replacement.isEmpty
            ? "\(suggestion.label) "
            : suggestion.replacement
        draft = "\(before)\(replacement)\(after)"

        if suggestion.action == .openRunner {
            section = .agents
            agentContentMode = .roster
            draft = ""
        }

        clearSuggestions(resetDismissedSignature: true)
        composerFocused = true
        return true
    }

    private var agentsContent: some View {
        Group {
            if agentContentMode == .observe, let agent = store.selectedAgent {
                ScoutAgentObserveContent(
                    agent: agent,
                    payload: store.observeAgentId == agent.id ? store.observePayload : nil,
                    isLoading: store.isObserveLoading,
                    error: store.observeAgentId == agent.id ? store.observeError : nil
                ) {
                    store.loadObserve(agentId: agent.id, force: true)
                } showRoster: {
                    agentContentMode = .roster
                } openChannel: {
                    store.openAgentChannel(agent)
                    section = .comms
                }
                .task(id: agent.id) {
                    store.loadObserve(agentId: agent.id, force: true)
                }
            } else {
                ScrollView {
                    LazyVGrid(
                        columns: [GridItem(.adaptive(minimum: 280), spacing: HudSpacing.xl)],
                        alignment: .leading,
                        spacing: HudSpacing.xl
                    ) {
                        ForEach(store.agents) { agent in
                            ScoutAgentCard(
                                agent: agent,
                                isSelected: store.selectedAgentId == agent.id || store.selectedChannel?.agentId == agent.id
                            ) {
                                previewAgent(agent)
                            } observe: {
                                observeAgent(agent)
                            } openChannel: {
                                store.openAgentChannel(agent)
                                section = .comms
                            }
                        }
                    }
                    .padding(HudSpacing.huge)
                    .frame(maxWidth: .infinity, alignment: .topLeading)
                }
            }
        }
        .background(ScoutDesign.bg)
    }

    private var tailContent: some View {
        ScoutTailContent(tail: tail)
    }

    private var inspectorHeader: some View {
        HStack(spacing: HudSpacing.md) {
            HudSectionLabel(section == .tail ? "Tail" : (store.selectedAgent == nil ? "Context" : "Agent"))
            Spacer()
            if section == .tail {
                HudBadge(tail.isFollowing ? "Live" : "Paused", tint: tail.isFollowing ? HudPalette.statusOk : HudPalette.muted, dot: tail.isFollowing)
            } else if let agent = store.selectedAgent {
                HudBadge(agent.state.label, tint: agent.state.tint, dot: true)
            }
        }
    }

    private var observeSidecarResolvedAgent: ScoutAgent? {
        guard let observeSidecarAgent else { return nil }
        return store.agents.first { $0.id == observeSidecarAgent.id } ?? observeSidecarAgent
    }

    private var agentPreviewResolvedAgent: ScoutAgent? {
        guard let agentPreviewPanelAgent else { return nil }
        return store.agents.first { $0.id == agentPreviewPanelAgent.id } ?? agentPreviewPanelAgent
    }

    private var trailingPanelActionLabel: String {
        if observeSidecarAgent != nil { return "Close observe" }
        if agentPreviewPanelAgent != nil { return "Close agent preview" }
        return inspectorCollapsed ? "Show context" : "Hide context"
    }

    @ViewBuilder
    private var trailingPanel: some View {
        Group {
            if let agent = observeSidecarResolvedAgent {
                ScoutObserveSidecarPanel(
                    agent: agent,
                    stagingWidth: observeSidecarStagingWidth,
                    onClose: {
                        withAnimation(.easeOut(duration: 0.14)) {
                            closeObserveSidecar()
                        }
                    },
                    onOpenWeb: {
                        ScoutWeb.open(path: "/embed/observe/\(agent.id)")
                    }
                )
                .id(agent.id)
                .transition(.move(edge: .trailing).combined(with: .opacity))
            } else if let agent = agentPreviewResolvedAgent {
                ScoutAgentPreviewPanel(
                    agent: agent,
                    selectedChannel: store.selectedChannel,
                    onClose: {
                        withAnimation(.easeOut(duration: 0.14)) {
                            closeAgentPreviewPanel()
                        }
                    },
                    openObserve: {
                        observeAgent(agent)
                    },
                    openProfile: {
                        ScoutWeb.open(path: "/agents/\(agent.id)?tab=profile")
                    }
                )
                .id("preview-\(agent.id)")
                .transition(.move(edge: .trailing).combined(with: .opacity))
            } else {
                HudInspector(isCollapsed: $inspectorCollapsed) {
                    inspectorHeader
                } content: {
                    inspectorContent
                }
                .transition(.opacity)
            }
        }
        .animation(.interpolatingSpring(stiffness: 260, damping: 28), value: observeSidecarResolvedAgent?.id)
        .animation(.interpolatingSpring(stiffness: 260, damping: 28), value: agentPreviewResolvedAgent?.id)
    }

    @ViewBuilder
    private var inspectorContent: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xl) {
            if section == .tail {
                ScoutTailInspector(tail: tail)
            } else {
                if section == .agents {
                    ScoutChannelPicker(
                        title: "DM / Channels",
                        isLoading: store.isLoading,
                        query: $store.channelQuery,
                        channels: pickerChannels,
                        selectedCId: store.selectedCId
                    ) { channel in
                        store.selectChannel(channel.cId)
                        section = .comms
                    }
                }

                if let agent = store.selectedAgent {
                    ScoutAgentInspector(agent: agent, selectedChannel: store.selectedChannel) {
                        observeAgent(agent)
                    } openProfile: {
                        ScoutWeb.open(path: "/agents/\(agent.id)?tab=profile")
                    }
                } else if let channel = store.selectedChannel {
                    ScoutChannelInspector(channel: channel)
                } else {
                    HudEmptyState(title: "Nothing selected", subtitle: "Select a channel or agent to inspect context.", icon: "sidebar.right")
                }
            }
        }
    }

    private var commsListChannels: [ScoutChannel] {
        channelFilter.apply(to: store.visibleChannels)
    }

    private var conversationListWidthBinding: Binding<CGFloat> {
        Binding {
            CGFloat(conversationListWidth)
        } set: { nextWidth in
            let range = ScoutDesign.conversationListWidthRange
            conversationListWidth = Double(min(max(nextWidth, range.lowerBound), range.upperBound))
        }
    }

    private var navigationSidebarLabelWidthBinding: Binding<CGFloat> {
        Binding {
            CGFloat(navigationSidebarLabelWidth)
        } set: { nextWidth in
            navigationSidebarLabelWidth = Double(min(max(nextWidth, 112), 260))
        }
    }

    private var pickerChannels: [ScoutChannel] {
        if section == .agents, let agent = store.selectedAgent {
            return filterChannels(store.channels.filter { channel in
                channel.agentId == agent.id
                    || channel.participantIds.contains(agent.id)
                    || channel.cId.localizedCaseInsensitiveContains(agent.id)
                    || channel.participantDisplayNames.contains(where: { $0.localizedCaseInsensitiveContains(agent.displayName) })
            })
        }
        return store.visibleChannels
    }

    private var selectedChannelMembers: [ScoutMemberIdentity] {
        guard let channel = store.selectedChannel else { return [] }
        let names = channel.participantDisplayNames
        guard !names.isEmpty else { return [] }

        return names.enumerated().map { index, name in
            let participantId = channel.participantIds.indices.contains(index)
                ? channel.participantIds[index]
                : nil
            let agent = agent(
                participantId: participantId,
                displayName: name,
                channel: channel
            )

            return ScoutMemberIdentity(
                id: agent?.id ?? "\(index)-\(name)",
                name: name,
                agent: agent
            )
        }
    }

    private func filterChannels(_ channels: [ScoutChannel]) -> [ScoutChannel] {
        let trimmed = store.channelQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return channels }
        return channels.filter { channel in
            channel.displayTitle.localizedCaseInsensitiveContains(trimmed)
                || channel.cId.localizedCaseInsensitiveContains(trimmed)
                || channel.participantDisplayNames.joined(separator: " ").localizedCaseInsensitiveContains(trimmed)
        }
    }

    private func agent(for message: ScoutMessage) -> ScoutAgent? {
        guard !message.isOperator else { return nil }
        return resolveAgent(id: message.actorId, name: message.actorName)
            ?? store.selectedChannel.flatMap { channel in
                agent(participantId: message.actorId, displayName: message.actorName, channel: channel)
            }
    }

    private func agent(
        participantId: String?,
        displayName: String,
        channel: ScoutChannel
    ) -> ScoutAgent? {
        if displayName.localizedCaseInsensitiveCompare("Operator") == .orderedSame {
            return nil
        }

        if let resolved = resolveAgent(id: participantId, name: displayName) {
            return resolved
        }

        if let agentId = channel.agentId,
           let channelAgent = store.agents.first(where: { $0.id == agentId }) {
            if channel.agentName == nil
                || displayName.localizedCaseInsensitiveCompare(channelAgent.displayName) == .orderedSame
                || displayName.localizedCaseInsensitiveCompare(channel.agentName ?? "") == .orderedSame {
                return channelAgent
            }
        }

        return nil
    }

    private func resolveAgent(id: String?, name: String?) -> ScoutAgent? {
        let probes = [id, name]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && $0.localizedCaseInsensitiveCompare("operator") != .orderedSame }

        for probe in probes {
            if let exact = store.agents.first(where: { agent in
                agent.id.localizedCaseInsensitiveCompare(probe) == .orderedSame
                    || agent.displayName.localizedCaseInsensitiveCompare(probe) == .orderedSame
                    || agent.name.localizedCaseInsensitiveCompare(probe) == .orderedSame
                    || agent.handle?.localizedCaseInsensitiveCompare(probe) == .orderedSame
            }) {
                return exact
            }
        }

        for probe in probes where probe.count >= 3 {
            let normalizedProbe = probe.trimmingCharacters(in: CharacterSet(charactersIn: "@"))
            if let fuzzy = store.agents.first(where: { agent in
                agent.id.localizedCaseInsensitiveContains(normalizedProbe)
                    || normalizedProbe.localizedCaseInsensitiveContains(agent.id)
                    || agent.displayName.localizedCaseInsensitiveContains(normalizedProbe)
                    || agent.handle?.localizedCaseInsensitiveContains(normalizedProbe) == true
            }) {
                return fuzzy
            }
        }

        return nil
    }

    private func observeAgent(_ agent: ScoutAgent) {
        let openingFromIdle = observeSidecarAgent == nil
        if openingFromIdle {
            observeRestoresInspectorCollapsed = inspectorCollapsed
            observeSidecarStagingWidth = inspectorCollapsed
                ? ScoutObserveSidecarMetrics.peekWidth
                : HudLayout.panelWidth
        } else {
            observeSidecarStagingWidth = ScoutObserveSidecarMetrics.expandedWidth
        }

        store.selectAgent(agent.id)
        agentContentMode = .roster
        observeSidecarAgent = agent
    }

    private func previewAgent(_ agent: ScoutAgent) {
        if agentPreviewPanelAgent == nil {
            agentPreviewRestoresInspectorCollapsed = observeSidecarAgent == nil
                ? inspectorCollapsed
                : observeRestoresInspectorCollapsed
        }

        store.selectAgent(agent.id)
        agentContentMode = .roster
        observeSidecarAgent = nil
        agentPreviewPanelAgent = agent
    }

    private func closeObserveSidecar() {
        observeSidecarAgent = nil
        inspectorCollapsed = observeRestoresInspectorCollapsed
    }

    private func closeAgentPreviewPanel() {
        agentPreviewPanelAgent = nil
        inspectorCollapsed = agentPreviewRestoresInspectorCollapsed
    }

    private var statusBar: some View {
        HStack(spacing: HudSpacing.xl) {
            HudStatusDot(color: store.lastError == nil ? HudPalette.statusOk : HudPalette.statusError)
            Text("SCOUT")
                .font(HudFont.mono(10, weight: .bold))
                .tracking(1.4)
                .foregroundStyle(HudPalette.muted)

            Text("·")
                .font(HudFont.mono(10))
                .foregroundStyle(HudPalette.dim)

            Text("\(store.channels.count) cIds")
                .font(HudFont.mono(10))
                .foregroundStyle(HudPalette.muted)

            Text("·")
                .font(HudFont.mono(10))
                .foregroundStyle(HudPalette.dim)

            Text("\(store.agents.count) agents")
                .font(HudFont.mono(10))
                .foregroundStyle(HudPalette.muted)

            Text("·")
                .font(HudFont.mono(10))
                .foregroundStyle(HudPalette.dim)

            Text("\(tail.events.count) tail")
                .font(HudFont.mono(10))
                .foregroundStyle(HudPalette.muted)

            if let error = store.lastError {
                Text("·")
                    .font(HudFont.mono(10))
                    .foregroundStyle(HudPalette.dim)
                Text(error)
                    .font(HudFont.mono(10))
                    .foregroundStyle(HudPalette.statusError)
                    .lineLimit(1)
            }

            if let error = store.observeError {
                Text("·")
                    .font(HudFont.mono(10))
                    .foregroundStyle(HudPalette.dim)
                Text(error)
                    .font(HudFont.mono(10))
                    .foregroundStyle(HudPalette.statusError)
                    .lineLimit(1)
            }

            if let error = tail.lastError {
                Text("·")
                    .font(HudFont.mono(10))
                    .foregroundStyle(HudPalette.dim)
                Text(error)
                    .font(HudFont.mono(10))
                    .foregroundStyle(HudPalette.statusError)
                    .lineLimit(1)
            }

            Spacer()
        }
        .padding(.horizontal, HudSpacing.xxl)
        .frame(height: 24)
        .background(ScoutDesign.chrome)
    }
}

enum ScoutDesign {
    static let bg = Color(red: 8.0/255, green: 8.0/255, blue: 7.0/255)
    static let chrome = Color(red: 6.0/255, green: 6.0/255, blue: 5.0/255)
    static let surface = Color(red: 18.0/255, green: 17.0/255, blue: 15.0/255)
    static let hairline = Color.white.opacity(0.045)
    static let hairlineStrong = Color.white.opacity(0.075)
    static let conversationListWidthRange: ClosedRange<CGFloat> = 230...430
    static let conversationResizeHandleWidth: CGFloat = 12

    static let theme = HudTheme(
        palette: HudThemePalette(
            bg: bg,
            surface: surface,
            chrome: chrome,
            ink: HudPalette.ink,
            muted: HudPalette.muted,
            dim: HudPalette.dim,
            border: hairlineStrong,
            accent: HudPalette.accent,
            accentSoft: HudPalette.accentSoft,
            statusOk: HudPalette.statusOk,
            statusWarn: HudPalette.statusWarn,
            statusError: HudPalette.statusError,
            statusInfo: HudPalette.statusInfo
        ),
        hairline: HudThemeHairline(
            subtle: hairline,
            standard: hairlineStrong
        ),
        radius: .default,
        focus: .default
    )
}

private enum ScoutAgentContentMode {
    case roster
    case observe
}

private struct ScoutComposerInputFrameKey: PreferenceKey {
    static let defaultValue: CGRect = .zero

    static func reduce(value: inout CGRect, nextValue: () -> CGRect) {
        let next = nextValue()
        if next != .zero {
            value = next
        }
    }
}

private enum ScoutChannelFilter: String, CaseIterable, Identifiable {
    case all
    case direct
    case shared

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "All"
        case .direct: return "Private"
        case .shared: return "Shared"
        }
    }

    var icon: String {
        switch self {
        case .all: return "tray.full"
        case .direct: return "person.crop.circle"
        case .shared: return "number"
        }
    }

    func apply(to channels: [ScoutChannel]) -> [ScoutChannel] {
        switch self {
        case .all:
            return channels
        case .direct:
            return channels.filter { $0.scope == .direct }
        case .shared:
            return channels.filter { $0.scope == .shared }
        }
    }
}

private struct ScoutConversationListBar: View {
    let isLoading: Bool
    @Binding var query: String
    @Binding var filter: ScoutChannelFilter
    let channels: [ScoutChannel]
    let totalCount: Int
    let selectedCId: String?
    let width: CGFloat
    let select: (ScoutChannel) -> Void

    var body: some View {
        VStack(spacing: 0) {
            header
            controls
            HudDivider(color: ScoutDesign.hairline)
            listContent
        }
        .frame(width: width)
        .frame(maxHeight: .infinity)
        .background(ScoutDesign.chrome)
    }

    private var header: some View {
        HStack(spacing: HudSpacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Conversations")
                    .font(HudFont.ui(14, weight: .semibold))
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(1)
                Text("\(totalCount) cIds")
                    .font(HudFont.mono(9))
                    .foregroundStyle(HudPalette.dim)
                    .lineLimit(1)
            }

            Spacer()

            if isLoading {
                ProgressView()
                    .controlSize(.small)
            } else {
                HudBadge("\(channels.count)", tint: HudPalette.muted)
            }
        }
        .padding(.horizontal, HudSpacing.xxl)
        .frame(height: 58)
    }

    private var controls: some View {
        VStack(spacing: HudSpacing.lg) {
            HudField("Search", text: $query, icon: "magnifyingglass")
            ScoutConversationFilterControl(selection: $filter)
        }
        .padding(.horizontal, HudSpacing.xxl)
        .padding(.bottom, HudSpacing.xxl)
    }

    @ViewBuilder
    private var listContent: some View {
        if isLoading && channels.isEmpty {
            VStack(spacing: HudSpacing.md) {
                ProgressView()
                Text("Loading channels")
                    .font(HudFont.mono(10))
                    .foregroundStyle(HudPalette.dim)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if channels.isEmpty {
            HudEmptyState(
                title: query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "No conversations" : "No matches",
                subtitle: query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "No visible DMs or channels." : "Try another search or filter.",
                icon: "bubble.left"
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(HudSpacing.xxl)
        } else {
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(channels) { channel in
                        ScoutConversationRow(
                            channel: channel,
                            isSelected: selectedCId == channel.cId
                        ) {
                            select(channel)
                        }
                    }
                }
                .padding(.vertical, HudSpacing.sm)
            }
            .scrollIndicators(.visible)
        }
    }
}

private struct ScoutConversationFilterControl: View {
    @Binding var selection: ScoutChannelFilter

    var body: some View {
        HStack(spacing: HudSpacing.xs) {
            ForEach(ScoutChannelFilter.allCases) { option in
                Button {
                    selection = option
                } label: {
                    HStack(spacing: HudSpacing.xs) {
                        Image(systemName: option.icon)
                            .font(HudFont.ui(10, weight: .semibold))
                        Text(option.title)
                            .font(HudFont.mono(9, weight: .semibold))
                    }
                    .foregroundStyle(selection == option ? HudPalette.ink : HudPalette.muted)
                    .frame(maxWidth: .infinity)
                    .frame(height: 26)
                    .background(
                        RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                            .fill(selection == option ? HudSurface.selected(HudPalette.accent) : Color.clear)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                            .stroke(selection == option ? HudSurface.tintBorder(HudPalette.accent) : Color.clear, lineWidth: HudStrokeWidth.thin)
                    )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(3)
        .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(HudSurface.inset))
        .overlay(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin))
    }
}

private struct ScoutConversationRow: View {
    let channel: ScoutChannel
    let isSelected: Bool
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: HudSpacing.md) {
                Image(systemName: channel.scope == .direct ? "person.crop.circle" : "number")
                    .font(HudFont.ui(13, weight: .semibold))
                    .foregroundStyle(isSelected ? HudPalette.accent : HudPalette.muted)
                    .frame(width: 20, height: 20)
                    .padding(.top, 1)

                VStack(alignment: .leading, spacing: HudSpacing.xs) {
                    HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
                        Text(channel.displayTitle)
                            .font(HudFont.ui(13, weight: isSelected ? .semibold : .medium))
                            .foregroundStyle(HudPalette.ink)
                            .lineLimit(1)

                        Spacer(minLength: HudSpacing.sm)

                        Text(channel.ageLabel)
                            .font(HudFont.mono(8))
                            .foregroundStyle(HudPalette.dim)
                            .lineLimit(1)
                    }

                    Text(channel.preview?.nilIfEmpty ?? channel.participantDisplayNames.joined(separator: " + "))
                        .font(HudFont.ui(11))
                        .foregroundStyle(HudPalette.muted)
                        .lineLimit(2)

                    HStack(spacing: HudSpacing.sm) {
                        Text(channel.scope.label.uppercased())
                            .font(HudFont.mono(8, weight: .semibold))
                            .foregroundStyle(channel.scope == .direct ? HudPalette.statusInfo : HudPalette.statusOk)
                        Text(channel.cIdShort)
                            .font(HudFont.mono(8))
                            .foregroundStyle(HudPalette.dim)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        if channel.messageCount > 0 {
                            Text("\(channel.messageCount)")
                                .font(HudFont.mono(8, weight: .semibold))
                                .foregroundStyle(HudPalette.dim)
                        }
                    }
                }
            }
            .padding(.horizontal, HudSpacing.xxl)
            .padding(.vertical, HudSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(rowBackground)
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(isSelected ? HudPalette.accent : Color.clear)
                    .frame(width: 2)
            }
            .overlay(alignment: .bottom) {
                HudDivider(color: ScoutDesign.hairline)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .animation(.easeOut(duration: 0.10), value: isHovering)
        .animation(.easeOut(duration: 0.10), value: isSelected)
    }

    private var rowBackground: Color {
        if isSelected {
            return HudSurface.selected(HudPalette.accent)
        }
        if isHovering {
            return HudSurface.hover
        }
        return Color.clear
    }
}

private struct ScoutSidebarSettingsButton: View {
    let isCompact: Bool
    let labelWidth: CGFloat
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 0) {
                Image(systemName: isHovering ? "gearshape.fill" : "gearshape")
                    .font(HudFont.ui(13, weight: .semibold))
                    .foregroundStyle(isHovering ? HudPalette.ink : HudPalette.muted)
                    .frame(width: HudSidebarLayout.railWidth, height: 32)

                Text("Settings")
                    .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                    .foregroundStyle(isHovering ? HudPalette.ink : HudPalette.muted)
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
                    .padding(.leading, HudSidebarLayout.labelLeading)
                    .frame(width: labelWidth, alignment: .leading)
                    .opacity(isCompact ? 0 : 1)
            }
            .frame(width: HudSidebarLayout.railWidth + (isCompact ? 0 : labelWidth), height: 32, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .fill(isHovering ? HudSurface.hover : Color.clear)
            )
            .contentShape(Rectangle())
            .clipped()
        }
        .buttonStyle(.plain)
        .help("Settings")
        .accessibilityLabel("Settings")
        .onHover { isHovering = $0 }
        .animation(.easeOut(duration: 0.10), value: isHovering)
        .animation(.easeOut(duration: 0.12), value: isCompact)
    }
}

#if os(macOS)
private struct ScoutConversationResizeHandle: NSViewRepresentable {
    @Binding var width: CGFloat
    @Binding var previewWidth: CGFloat?
    let range: ClosedRange<CGFloat>

    func makeNSView(context: Context) -> ResizeHandleView {
        let view = ResizeHandleView()
        view.range = range
        view.getWidth = { width }
        view.setPreviewWidth = { previewWidth = $0 }
        view.commitWidth = { width = $0 }
        view.clearPreview = { previewWidth = nil }
        return view
    }

    func updateNSView(_ view: ResizeHandleView, context: Context) {
        view.range = range
        view.getWidth = { width }
        view.setPreviewWidth = { previewWidth = $0 }
        view.commitWidth = { width = $0 }
        view.clearPreview = { previewWidth = nil }
    }

    final class ResizeHandleView: NSView {
        var range: ClosedRange<CGFloat> = 230...430
        var getWidth: () -> CGFloat = { 286 }
        var setPreviewWidth: (CGFloat) -> Void = { _ in }
        var commitWidth: (CGFloat) -> Void = { _ in }
        var clearPreview: () -> Void = {}

        private var startX: CGFloat = 0
        private var startWidth: CGFloat = 0
        private var isActive = false

        override init(frame frameRect: NSRect) {
            super.init(frame: frameRect)
            wantsLayer = true
            layer?.backgroundColor = NSColor.clear.cgColor
        }

        required init?(coder: NSCoder) {
            super.init(coder: coder)
            wantsLayer = true
            layer?.backgroundColor = NSColor.clear.cgColor
        }

        override var acceptsFirstResponder: Bool { true }
        override var mouseDownCanMoveWindow: Bool { false }
        override var intrinsicContentSize: NSSize {
            NSSize(width: ScoutDesign.conversationResizeHandleWidth, height: NSView.noIntrinsicMetric)
        }

        override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
            true
        }

        override func resetCursorRects() {
            addCursorRect(bounds, cursor: .resizeLeftRight)
        }

        override func mouseDown(with event: NSEvent) {
            window?.makeFirstResponder(self)
            startX = event.locationInWindow.x
            startWidth = getWidth()
            isActive = true
            setPreviewWidth(startWidth)
            needsDisplay = true
        }

        override func mouseDragged(with event: NSEvent) {
            let delta = event.locationInWindow.x - startX
            setPreviewWidth(clamp(startWidth + delta))
        }

        override func mouseUp(with event: NSEvent) {
            let delta = event.locationInWindow.x - startX
            commitWidth(clamp(startWidth + delta))
            clearPreview()
            isActive = false
            needsDisplay = true
        }

        override func draw(_ dirtyRect: NSRect) {
            super.draw(dirtyRect)
            let color = isActive
                ? NSColor.white.withAlphaComponent(0.04)
                : NSColor.white.withAlphaComponent(0.06)
            color.setFill()
            let rect = NSRect(x: floor((bounds.width - 1) / 2), y: 0, width: 1, height: bounds.height)
            rect.fill()
        }

        private func clamp(_ value: CGFloat) -> CGFloat {
            min(max(value, range.lowerBound), range.upperBound)
        }
    }
}
#else
private struct ScoutConversationResizeHandle: View {
    @Binding var width: CGFloat
    @Binding var previewWidth: CGFloat?
    let range: ClosedRange<CGFloat>

    var body: some View {
        HudResizableDivider(width: $width, placement: .trailing, range: range, hitWidth: 10)
    }
}
#endif

private struct ScoutChannelPicker: View {
    let title: String
    let isLoading: Bool
    @Binding var query: String
    let channels: [ScoutChannel]
    let selectedCId: String?
    let select: (ScoutChannel) -> Void

    var body: some View {
        HudCard(padding: HudSpacing.xl) {
            VStack(alignment: .leading, spacing: HudSpacing.lg) {
                HStack {
                    HudSectionLabel(title)
                    Spacer()
                    HudBadge("\(channels.count)", tint: HudPalette.muted)
                }

                HudField("Find channel", text: $query, icon: "magnifyingglass")

                if isLoading && channels.isEmpty {
                    VStack(spacing: HudSpacing.md) {
                        ProgressView()
                        Text("Loading")
                            .font(HudFont.mono(9))
                            .foregroundStyle(HudPalette.dim)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, HudSpacing.xl)
                } else if channels.isEmpty {
                    HudEmptyState(title: "No channels", subtitle: "No matching DM or channel.", icon: "bubble.left")
                } else {
                    ScrollView {
                        LazyVStack(spacing: HudSpacing.sm) {
                            ForEach(channels) { channel in
                                ScoutCompactChannelRow(
                                    channel: channel,
                                    isSelected: selectedCId == channel.cId
                                ) {
                                    select(channel)
                                }
                            }
                        }
                    }
                    .frame(maxHeight: 280)
                    .scrollIndicators(.visible)
                }
            }
        }
    }
}

private struct ScoutCompactChannelRow: View {
    let channel: ScoutChannel
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: HudSpacing.md) {
                Image(systemName: channel.scope == .direct ? "person.crop.circle" : "number")
                    .font(HudFont.ui(12, weight: .semibold))
                    .foregroundStyle(isSelected ? HudPalette.accent : HudPalette.muted)
                    .frame(width: 20)

                VStack(alignment: .leading, spacing: 2) {
                    Text(channel.displayTitle)
                        .font(HudFont.ui(12, weight: isSelected ? .semibold : .medium))
                        .foregroundStyle(HudPalette.ink)
                        .lineLimit(1)
                    Text(channel.preview?.nilIfEmpty ?? channel.cIdShort)
                        .font(HudFont.mono(9))
                        .foregroundStyle(HudPalette.dim)
                        .lineLimit(1)
                }

                Spacer(minLength: 0)

                if channel.messageCount > 0 {
                    Text("\(channel.messageCount)")
                        .font(HudFont.mono(9, weight: .semibold))
                        .foregroundStyle(HudPalette.dim)
                }
            }
            .padding(.horizontal, HudSpacing.md)
            .padding(.vertical, HudSpacing.md)
            .background(RoundedRectangle(cornerRadius: HudRadius.standard).fill(isSelected ? HudSurface.selected(HudPalette.accent) : HudSurface.inset))
            .overlay(RoundedRectangle(cornerRadius: HudRadius.standard).stroke(isSelected ? HudSurface.tintBorder(HudPalette.accent) : HudHairline.subtle, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

private struct ScoutMemberIdentity: Identifiable {
    let id: String
    let name: String
    let agent: ScoutAgent?
}

private struct ScoutMemberStrip: View {
    let members: [ScoutMemberIdentity]
    let selectAgent: (ScoutAgent) -> Void

    var body: some View {
        HStack(spacing: HudSpacing.sm) {
            HStack(spacing: -4) {
                ForEach(Array(members.prefix(4).enumerated()), id: \.element.id) { index, member in
                    memberAvatar(member)
                        .zIndex(Double(8 - index))
                }
            }
            Text(members.map(\.name).joined(separator: " + "))
                .font(HudFont.ui(11, weight: .medium))
                .foregroundStyle(HudPalette.muted)
                .lineLimit(1)
        }
    }

    @ViewBuilder
    private func memberAvatar(_ member: ScoutMemberIdentity) -> some View {
        if let agent = member.agent {
            Button {
                selectAgent(agent)
            } label: {
                avatarGlyph(for: member)
            }
            .buttonStyle(.plain)
            .help("Preview \(agent.displayName)")
        } else {
            avatarGlyph(for: member)
        }
    }

    private func avatarGlyph(for member: ScoutMemberIdentity) -> some View {
        Text(member.name.first.map { String($0).uppercased() } ?? "?")
            .font(HudFont.mono(8, weight: .bold))
            .foregroundStyle(HudPalette.bg)
            .frame(width: 18, height: 18)
            .background(Circle().fill(memberTint(member.name)))
            .overlay(
                Circle()
                    .stroke(member.agent == nil ? HudPalette.bg : HudPalette.accent.opacity(0.82), lineWidth: member.agent == nil ? 1.2 : 1.4)
            )
            .contentShape(Circle())
    }

    private func memberTint(_ name: String) -> Color {
        if name.lowercased() == "operator" { return HudPalette.accent }
        return Color(hue: Double(stableHueSeed(for: name)) / 360.0, saturation: 0.55, brightness: 0.82)
    }

    private func stableHueSeed(for text: String) -> Int {
        var hash: UInt64 = 5381
        for byte in text.lowercased().utf8 {
            hash = (hash &* 33) &+ UInt64(byte)
        }
        return Int(hash % 360)
    }
}

private struct ScoutMessageRow: View {
    let message: ScoutMessage
    let agent: ScoutAgent?
    let previewAgent: (ScoutAgent) -> Void

    @State private var isHoveringAgent = false

    var body: some View {
        HStack(alignment: .top) {
            if message.isOperator { Spacer(minLength: 80) }
            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                HStack(spacing: HudSpacing.md) {
                    actorChip
                    Text(ScoutRelativeTime.format(message.createdAt))
                        .font(HudFont.mono(9))
                        .foregroundStyle(HudPalette.dim)
                }
                ScoutMarkdownView(text: message.body)
            }
            .padding(HudSpacing.xxl)
            .frame(maxWidth: 840, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.card)
                    .fill(message.isOperator ? HudSurface.tintGhost(HudPalette.accent) : HudPalette.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.card)
                    .stroke(message.isOperator ? HudSurface.tintBorder(HudPalette.accent) : HudHairline.standard, lineWidth: 1)
            )
            if !message.isOperator { Spacer(minLength: 80) }
        }
        .frame(maxWidth: .infinity, alignment: message.isOperator ? .trailing : .leading)
    }

    @ViewBuilder
    private var actorChip: some View {
        if let agent {
            Button {
                previewAgent(agent)
            } label: {
                actorLabel
            }
            .buttonStyle(.plain)
            .onHover { isHoveringAgent = $0 }
            .overlay(alignment: .topLeading) {
                if isHoveringAgent {
                    ScoutAgentHoverCard(agent: agent)
                        .offset(x: 0, y: -86)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                        .zIndex(20)
                }
            }
            .help("Preview \(agent.displayName)")
        } else {
            actorLabel
        }
    }

    private var actorLabel: some View {
        HStack(spacing: HudSpacing.xs) {
            Text(message.actorName.uppercased())
                .font(HudFont.mono(9, weight: .bold))
            if agent != nil {
                Image(systemName: "info.circle")
                    .font(HudFont.ui(9, weight: .semibold))
            }
        }
        .foregroundStyle(message.isOperator ? HudPalette.accent : (agent == nil ? HudPalette.muted : HudPalette.accent))
        .contentShape(Rectangle())
        .animation(.easeOut(duration: 0.10), value: isHoveringAgent)
    }
}

private struct ScoutAgentHoverCard: View {
    let agent: ScoutAgent

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            HStack(spacing: HudSpacing.sm) {
                Text(agent.displayName)
                    .font(HudFont.ui(12, weight: .semibold))
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(1)
                Spacer(minLength: HudSpacing.sm)
                HudBadge(agent.state.label, tint: agent.state.tint, dot: true)
            }

            if !agent.detail.isEmpty {
                Text(agent.detail)
                    .font(HudFont.ui(10))
                    .foregroundStyle(HudPalette.muted)
                    .lineLimit(1)
            }

            HStack(spacing: HudSpacing.md) {
                Label(agent.branchLabel, systemImage: "arrow.triangle.branch")
                Label(agent.updatedLabel, systemImage: "clock")
            }
            .font(HudFont.mono(8))
            .foregroundStyle(HudPalette.dim)
            .lineLimit(1)
        }
        .padding(HudSpacing.lg)
        .frame(width: 260, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(ScoutDesign.chrome))
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
        )
        .shadow(color: Color.black.opacity(0.32), radius: 18, x: 0, y: 10)
        .allowsHitTesting(false)
    }
}

private struct ScoutMarkdownView: View {
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            ForEach(MessageMarkupParser.parse(text)) { block in
                blockView(block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
    }

    @ViewBuilder
    private func blockView(_ block: MessageMarkupBlock) -> some View {
        switch block.kind {
        case .heading(let level):
            Text(inline(block.text))
                .font(HudFont.ui(level == 1 ? 16 : 14, weight: .semibold))
                .foregroundStyle(HudPalette.ink)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, level == 1 ? HudSpacing.xs : 0)

        case .paragraph:
            Text(inline(block.text))
                .font(HudFont.ui(13))
                .foregroundStyle(HudPalette.ink)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)

        case .blockquote:
            Text(inline(block.text))
                .font(HudFont.ui(12))
                .foregroundStyle(HudPalette.muted)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
            .padding(.leading, HudSpacing.xl)
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(HudSurface.tintBorder(HudPalette.accent))
                    .frame(width: 2)
            }

        case .list(let ordered, let items):
            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    HStack(alignment: .top, spacing: HudSpacing.md) {
                        Text(ordered ? "\(index + 1)." : "-")
                            .font(HudFont.mono(12, weight: .semibold))
                            .foregroundStyle(HudPalette.accent)
                            .frame(width: ordered ? 24 : 10, alignment: .trailing)
                        Text(inline(item))
                            .font(HudFont.ui(13))
                            .foregroundStyle(HudPalette.ink)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }

        case .code(let language):
            MessageCodeBlock(language: language, text: block.text, style: .scout)

        case .table(let headers, let rows):
            ScoutMarkdownTable(headers: headers, rows: rows)

        case .rule:
            HudDivider(color: ScoutDesign.hairlineStrong)
                .padding(.vertical, HudSpacing.xs)
        }
    }

    private func inline(_ body: String) -> AttributedString {
        (try? AttributedString(
            markdown: body,
            options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(body)
    }
}

private extension MessageCodeBlockStyle {
    static let scout = MessageCodeBlockStyle(
        labelFont: HudFont.mono(8, weight: .bold),
        codeFont: HudFont.mono(11),
        labelColor: HudPalette.dim,
        codeColor: HudPalette.ink,
        backgroundColor: HudSurface.inset,
        borderColor: ScoutDesign.hairlineStrong,
        cornerRadius: HudRadius.standard,
        borderWidth: HudStrokeWidth.thin,
        contentInsets: EdgeInsets(top: HudSpacing.md, leading: HudSpacing.xl, bottom: HudSpacing.xl, trailing: HudSpacing.xl),
        blockSpacing: HudSpacing.md,
        labelTracking: 0,
        showsScrollIndicators: false
    )
}

private extension MessageSendChipStyle {
    static let scout = MessageSendChipStyle(
        keyFont: HudFont.mono(10, weight: .semibold),
        titleFont: HudFont.mono(10, weight: .semibold),
        tracking: 1.4,
        enabledColor: HudPalette.accent,
        hoverColor: HudPalette.ink,
        disabledColor: HudPalette.dim,
        horizontalPadding: HudSpacing.xs,
        verticalPadding: HudSpacing.xs
    )
}

private extension MessageSuggestionPopoverStyle {
    static let scout = MessageSuggestionPopoverStyle(
        eyebrowFont: HudFont.mono(10, weight: .bold),
        markFont: HudFont.mono(9, weight: .bold),
        labelFont: HudFont.mono(11, weight: .semibold),
        detailFont: HudFont.ui(10),
        eyebrowColor: HudPalette.dim,
        commandAccent: HudPalette.accent,
        agentAccent: HudPalette.ink,
        sessionAccent: HudPalette.statusInfo,
        selectedLabelColor: HudPalette.ink,
        labelColor: HudPalette.muted,
        detailColor: HudPalette.dim,
        selectedBackgroundColor: HudSurface.selected(HudPalette.accent),
        backgroundColor: ScoutDesign.surface,
        borderColor: ScoutDesign.hairlineStrong,
        shadowColor: Color.black.opacity(0.24),
        cornerRadius: HudRadius.standard,
        borderWidth: HudStrokeWidth.thin
    )
}

private extension MessageSuggestionAgent {
    init(_ agent: ScoutAgent) {
        self.init(
            id: agent.id,
            name: agent.displayName,
            handle: agent.handle,
            state: agent.state.rawValue,
            role: agent.role,
            workspaceRoot: agent.workspace,
            harnessSessionId: agent.harnessSessionId
        )
    }
}

private struct ScoutDictationPreview: View {
    let text: String
    @State private var caretLit = false

    private var displayText: String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        HStack(spacing: HudSpacing.xs) {
            if !displayText.isEmpty {
                Text(displayText)
                    .font(HudFont.mono(11))
                    .foregroundStyle(HudPalette.muted)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            RoundedRectangle(cornerRadius: 0.5, style: .continuous)
                .fill(HudPalette.accent.opacity(caretLit ? 0.95 : 0.25))
                .frame(width: 1, height: 13)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear {
            withAnimation(.easeInOut(duration: 0.48).repeatForever(autoreverses: true)) {
                caretLit = true
            }
        }
    }
}

private struct ScoutSendButton: View {
    let isEnabled: Bool
    let isSending: Bool
    let action: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            ZStack {
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .fill(fillColor)

                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .stroke(borderColor, lineWidth: HudStrokeWidth.thin)

                content
            }
            .frame(width: 34, height: 34)
            .contentShape(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled || isSending)
        .onHover { hovering = $0 }
        .help(isEnabled && !isSending ? "Send message" : "")
    }

    @ViewBuilder
    private var content: some View {
        if isSending {
            ProgressView()
                .controlSize(.small)
                .scaleEffect(0.62)
                .tint(HudPalette.dim)
        } else {
            Image(systemName: "arrow.up")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(iconColor)
        }
    }

    private var fillColor: Color {
        if !isEnabled || isSending {
            return HudSurface.inset.opacity(0.82)
        }
        return hovering ? HudPalette.ink : HudPalette.accent
    }

    private var borderColor: Color {
        if !isEnabled || isSending {
            return ScoutDesign.hairlineStrong
        }
        return hovering ? HudPalette.ink.opacity(0.72) : HudPalette.accent.opacity(0.46)
    }

    private var iconColor: Color {
        if !isEnabled || isSending {
            return HudPalette.dim
        }
        return ScoutDesign.bg
    }
}

// Hand-drawn dictation mic, ported from the HUD's HudMessageDock. Tap to
// toggle Vox dictation. Visual state mirrors ScoutVoxService.state:
//   idle/probing → faint stroke · recording → accent stroke + pulsing halo
//   processing   → muted stroke that breathes · unavailable → dim + dashed.
private struct ScoutMicButton: View {
    let box: CGFloat
    let glyph: CGFloat
    let action: () -> Void

    @ObservedObject private var vox = ScoutVoxService.shared
    @State private var pulse = false
    @State private var hovering = false

    private var isRecording: Bool { vox.state.isCaptureActive }
    private var isProcessing: Bool { vox.state.isProcessing }
    private var isUnavailable: Bool { vox.state.isUnavailable }

    private var strokeColor: Color {
        if isRecording { return HudPalette.accent }
        if isProcessing { return HudPalette.muted }
        if isUnavailable { return HudPalette.dim.opacity(0.6) }
        return HudPalette.muted
    }

    private var tooltip: String {
        switch vox.state {
        case .probing:               return "Checking Vox companion…"
        case .idle:                  return "Tap to dictate with Vox"
        case .starting:              return "Starting recording…"
        case .recording:             return "Recording — tap to commit"
        case .processing:            return "Transcribing…"
        case .unavailable(let reason): return reason
        }
    }

    var body: some View {
        Button(action: action) {
            ZStack {
                Circle()
                    .fill(micFillColor)
                    .frame(width: box, height: box)

                if isRecording {
                    Circle()
                        .fill(HudPalette.accent.opacity(pulse ? 0.20 : 0.08))
                        .frame(width: box, height: box)
                }
                ScoutMicGlyphShape()
                    .stroke(
                        strokeColor,
                        style: StrokeStyle(
                            lineWidth: isRecording ? 1.4 : 1,
                            lineCap: .round,
                            lineJoin: .round,
                            dash: isUnavailable ? [1.5, 1.5] : []
                        )
                    )
                    .frame(width: glyph, height: glyph)
                    .opacity(isProcessing && pulse ? 0.55 : 1.0)
            }
            .frame(width: box, height: box)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(tooltip)
        .onHover { hovering = $0 }
        .task { if vox.state == .probing { await vox.probe() } }
        .onChange(of: vox.state) { _, newValue in
            pulse = false
            if newValue == .recording || newValue == .starting || newValue == .processing {
                withAnimation(.easeInOut(duration: 0.55).repeatForever(autoreverses: true)) {
                    pulse = true
                }
            }
        }
    }

    private var micFillColor: Color {
        if isRecording {
            return HudPalette.accent.opacity(pulse ? 0.13 : 0.08)
        }
        if isProcessing {
            return HudSurface.hover.opacity(pulse ? 0.88 : 0.62)
        }
        if hovering {
            return HudSurface.hover.opacity(0.86)
        }
        return HudSurface.inset.opacity(0.62)
    }
}

// Slim capsule body in a U-cradle dropping to a short stem and flat foot,
// drawn on a 14×14 viewBox. Matches the HUD mic glyph stroke-for-stroke.
private struct ScoutMicGlyphShape: Shape {
    func path(in rect: CGRect) -> Path {
        let sx = rect.width / 14.0
        let sy = rect.height / 14.0
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * sx, y: rect.minY + y * sy)
        }
        var path = Path()

        let bodyRect = CGRect(
            x: rect.minX + 5 * sx,
            y: rect.minY + 2 * sy,
            width: 4 * sx,
            height: 6.5 * sy
        )
        let rx = 2 * min(sx, sy)
        path.addRoundedRect(in: bodyRect, cornerSize: CGSize(width: rx, height: rx))

        path.move(to: p(4, 8.5))
        path.addQuadCurve(to: p(10, 8.5), control: p(7, 13.5))

        path.move(to: p(7, 11))
        path.addLine(to: p(7, 12.7))

        path.move(to: p(5, 12.7))
        path.addLine(to: p(9, 12.7))

        return path
    }
}

private struct ScoutMarkdownTable: View {
    let headers: [String]
    let rows: [[String]]

    var body: some View {
        ScrollView(.horizontal) {
            VStack(alignment: .leading, spacing: 0) {
                tableRow(headers, isHeader: true)
                HudDivider(color: ScoutDesign.hairlineStrong)
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    tableRow(row, isHeader: false)
                }
            }
            .background(HudSurface.inset)
            .clipShape(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
            )
        }
        .scrollIndicators(.hidden)
    }

    private func tableRow(_ cells: [String], isHeader: Bool) -> some View {
        HStack(spacing: 0) {
            ForEach(0..<max(headers.count, cells.count), id: \.self) { index in
                Text(inline(cells.indices.contains(index) ? cells[index] : ""))
                    .font(isHeader ? HudFont.mono(10, weight: .bold) : HudFont.ui(12))
                    .foregroundStyle(isHeader ? HudPalette.muted : HudPalette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(width: 136, alignment: .leading)
                    .padding(.horizontal, HudSpacing.md)
                    .padding(.vertical, HudSpacing.md)
            }
        }
        .background(isHeader ? ScoutDesign.chrome : Color.clear)
    }

    private func inline(_ body: String) -> AttributedString {
        (try? AttributedString(
            markdown: body,
            options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(body)
    }
}

private struct ScoutAgentCard: View {
    let agent: ScoutAgent
    let isSelected: Bool
    let select: () -> Void
    let observe: () -> Void
    let openChannel: () -> Void

    var body: some View {
        HudCard {
            VStack(alignment: .leading, spacing: HudSpacing.lg) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: HudSpacing.xs) {
                        Text(agent.displayName)
                            .font(HudFont.ui(17, weight: .semibold))
                            .foregroundStyle(HudPalette.ink)
                            .lineLimit(1)
                        Text(agent.id)
                            .font(HudFont.mono(10))
                            .foregroundStyle(HudPalette.dim)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    Spacer()
                    HudBadge(agent.state.label, tint: agent.state.tint, dot: true)
                }

                if !agent.detail.isEmpty {
                    Text(agent.detail)
                        .font(HudFont.ui(12))
                        .foregroundStyle(HudPalette.muted)
                        .lineLimit(2)
                }

                HudInset {
                    VStack(alignment: .leading, spacing: HudSpacing.md) {
                        HudKVRow("Branch", value: agent.branchLabel)
                        HudKVRow("Workspace", value: agent.workspace)
                        HudKVRow("Updated", value: agent.updatedLabel)
                    }
                }

                HStack {
                    HudButton("Inspect", icon: "sidebar.right", style: isSelected ? .primary(.green) : .secondary, action: select)
                    HudButton("Observe", icon: "eye", style: .secondary, action: observe)
                    HudButton("Open DM", icon: "bubble.left", style: .ghost, action: openChannel)
                }
            }
        }
    }
}

private struct ScoutAgentInspector: View {
    let agent: ScoutAgent
    let selectedChannel: ScoutChannel?
    let openObserve: () -> Void
    let openProfile: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xl) {
            HudCard {
                VStack(alignment: .leading, spacing: HudSpacing.md) {
                    Text(agent.displayName)
                        .font(HudFont.ui(18, weight: .semibold))
                        .foregroundStyle(HudPalette.ink)
                    Text(agent.id)
                        .font(HudFont.mono(10))
                        .foregroundStyle(HudPalette.dim)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                    HudBadge(agent.state.label, tint: agent.state.tint, dot: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            HudCard {
                VStack(alignment: .leading, spacing: HudSpacing.md) {
                    HudSectionLabel("Runtime")
                    HudKVRow("Harness", value: agent.harness?.nilIfEmpty ?? "—")
                    HudKVRow("Transport", value: agent.transport?.nilIfEmpty ?? "—")
                    HudKVRow("Model", value: agent.model?.nilIfEmpty ?? "—")
                    HudKVRow("Node", value: agent.nodeName?.nilIfEmpty ?? "—")
                }
            }

            HudCard {
                VStack(alignment: .leading, spacing: HudSpacing.md) {
                    HudSectionLabel("Workspace")
                    HudKVRow("Branch", value: agent.branchLabel)
                    HudKVRow("Path", value: agent.workspace)
                    if let selectedChannel {
                        HudKVRow("cId", value: selectedChannel.cIdShort)
                    }
                }
            }

            if !agent.capabilities.isEmpty {
                HudCard {
                    VStack(alignment: .leading, spacing: HudSpacing.md) {
                        HudSectionLabel("Capabilities")
                        FlowLayout(spacing: HudSpacing.sm) {
                            ForEach(agent.capabilities, id: \.self) { capability in
                                HudBadge(capability, tint: HudPalette.muted)
                            }
                        }
                    }
                }
            }

            HStack {
                HudButton("Observe", icon: "eye", style: .primary(.green), action: openObserve)
                HudButton("Profile", icon: "person.text.rectangle", style: .secondary, action: openProfile)
            }
        }
    }
}

private struct ScoutAgentPreviewPanel: View {
    let agent: ScoutAgent
    let selectedChannel: ScoutChannel?
    let onClose: () -> Void
    let openObserve: () -> Void
    let openProfile: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            header
            HudDivider(color: ScoutDesign.hairline)

            ScrollView {
                ScoutAgentInspector(
                    agent: agent,
                    selectedChannel: selectedChannel,
                    openObserve: openObserve,
                    openProfile: openProfile
                )
                .padding(HudSpacing.xl)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollIndicators(.visible)
        }
        .frame(width: ScoutObserveSidecarMetrics.expandedWidth)
        .frame(maxHeight: .infinity)
        .background(ScoutDesign.chrome)
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(ScoutDesign.hairlineStrong)
                .frame(width: HudStrokeWidth.thin)
        }
    }

    private var header: some View {
        HStack(spacing: HudSpacing.md) {
            Image(systemName: "person.crop.circle")
                .font(HudFont.ui(12, weight: .semibold))
                .foregroundStyle(HudPalette.accent)
                .frame(width: 26, height: 26)
                .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(HudPalette.accentSoft))

            VStack(alignment: .leading, spacing: 2) {
                HudSectionLabel("Agent")
                Text(agent.displayName)
                    .font(HudFont.ui(13, weight: .semibold))
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }

            Spacer(minLength: 0)

            Button(action: onClose) {
                Image(systemName: "sidebar.right")
                    .font(HudFont.ui(12, weight: .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(HudPalette.muted)
            .frame(width: 28, height: 28)
            .contentShape(Rectangle())
            .help("Close agent preview")
        }
        .padding(.horizontal, HudSpacing.lg)
        .frame(height: HudLayout.navHeight)
        .background(ScoutDesign.chrome)
    }
}

private struct ScoutChannelInspector: View {
    let channel: ScoutChannel

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xl) {
            HudCard {
                VStack(alignment: .leading, spacing: HudSpacing.md) {
                    HudSectionLabel("Channel")
                    Text(channel.displayTitle)
                        .font(HudFont.ui(18, weight: .semibold))
                        .foregroundStyle(HudPalette.ink)
                    HudBadge(channel.scope.label, tint: channel.scope == .direct ? HudPalette.statusInfo : HudPalette.statusOk)
                }
            }

            HudCard {
                VStack(alignment: .leading, spacing: HudSpacing.md) {
                    HudKVRow("cId", value: channel.cId)
                    HudKVRow("Messages", value: "\(channel.messageCount)")
                    HudKVRow("Branch", value: channel.currentBranch?.nilIfEmpty ?? "—")
                }
            }

            HudCard {
                VStack(alignment: .leading, spacing: HudSpacing.md) {
                    HudSectionLabel("Members")
                    ForEach(channel.participantDisplayNames, id: \.self) { name in
                        HudListRow(title: name, icon: name == "Operator" ? "person" : "cpu", iconTint: name == "Operator" ? .green : .blue)
                    }
                }
            }
        }
    }
}

private struct FlowLayout<Content: View>: View {
    let spacing: CGFloat
    let content: Content

    init(spacing: CGFloat, @ViewBuilder content: () -> Content) {
        self.spacing = spacing
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: spacing) {
            content
        }
    }
}
