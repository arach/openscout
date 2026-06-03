import HudsonShell
import HudsonUI
import ScoutNativeCore
import ScoutSharedUI
import SwiftUI
#if os(macOS)
import AppKit
import UniformTypeIdentifiers
#endif

struct ScoutRootView: View {
    @StateObject private var store = ScoutCommsStore()
    @StateObject private var tail = ScoutTailStore()
    @ObservedObject private var vox = ScoutVoxService.shared
    @State private var section: ScoutSection = .comms
    @AppStorage("scout.navigationSidebar.compact") private var railCompact = false
    @AppStorage("scout.inspector.collapsed") private var inspectorCollapsed = false
    @State private var agentContentMode: ScoutAgentContentMode = .roster
    @State private var channelFilter: ScoutChannelFilter = .all
    @State private var draft = ""
    /// Per-conversation unsent drafts, so a message isn't lost when navigating
    /// to another chat/section. Keyed by cId; the active draft mirrors into
    /// `draft` and is swapped on selection change.
    @State private var drafts: [String: String] = [:]
    /// Set when the user hits send while dictating: we commit the recording and
    /// fire the send once the final transcript has been spliced in.
    @State private var pendingSendAfterDictation = false
    /// Whether the transcript is pinned to the latest message. True while the
    /// bottom is in view; flips false when the user scrolls up into history so
    /// incoming messages don't yank them out of the zone they're reading.
    @State private var followLatest = true
    /// Pending one-shot jump to the newest message when a conversation opens.
    @State private var pendingInitialJump = true

    private static let messageListBottomAnchor = "scout.messageList.bottom"
    @State private var suggestions: [MessageSuggestion] = []
    @State private var selectedSuggestionIndex = 0
    @State private var currentSuggestionTrigger: MessageSuggestionTrigger?
    @State private var dismissedSuggestionSignature: String?
    @State private var conversationListResizePreviewWidth: CGFloat?
    @State private var composerInputFrame: CGRect = .zero
    /// Images staged in the composer (pasted, dropped, or picked), uploaded as
    /// link-backed attachments on send.
    @State private var pendingImages: [ScoutComposerImage] = []
    /// Staged image currently shown in the centered lightbox preview, if any.
    @State private var previewImage: ScoutComposerImage?
    @State private var observeSidecarAgent: ScoutAgent?
    @State private var observeSidecarStagingWidth = ScoutObserveSidecarMetrics.peekWidth
    @State private var observeSidecarResizePreviewWidth: CGFloat?
    @State private var observeRestoresInspectorCollapsed = false
    @State private var agentPreviewPanelAgent: ScoutAgent?
    @State private var agentPreviewRestoresInspectorCollapsed = false
    /// Non-nil while the new-session composer is presented. Configured by each
    /// entry point (list "+", message context menu, agent inspector).
    @State private var sessionDraft: ScoutSessionDraft?
    /// Embedded file preview state. Shared so message file-links (rendered deep
    /// in the markdown tree) can open it without threading a closure down.
    @ObservedObject private var fileViewer = ScoutFileViewer.shared
    @FocusState private var composerFocused: Bool
    @FocusState private var searchFocused: Bool
    /// Keyboard cheatsheet overlay (⌘/). Lists the live chords so nothing has
    /// to be guessed.
    @State private var showCheatsheet = false
    @AppStorage("scout.navigationSidebar.labelWidth.v2") private var navigationSidebarLabelWidth = 88.0
    @AppStorage("scout.conversationList.width.v2") private var conversationListWidth = 224.0
    @AppStorage("scout.inspector.width") private var inspectorWidth = 320.0
    @AppStorage("scout.observeSidecar.width") private var observeSidecarWidth = Double(ScoutObserveSidecarMetrics.defaultWidth)
    @AppStorage("scout.fileViewer.width") private var fileViewerWidth = Double(ScoutFileViewerMetrics.defaultWidth)

    private var manifest: HudAppManifest {
        HudAppManifest(
            name: "Scout",
            version: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.1",
            tint: .green,
            targetLabel: "Agent"
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
                minLabelWidth: 76,
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
        .onChange(of: store.selectedCId) { oldCId, newCId in
            // Preserve the in-progress draft for the chat we're leaving and
            // restore any draft saved for the one we're entering.
            if let oldCId { drafts[oldCId] = draft }
            draft = newCId.flatMap { drafts[$0] } ?? ""
            // Staged images are tied to the chat that was open; don't carry
            // them into a different conversation.
            pendingImages = []
        }
        .overlay {
            if let sessionDraft {
                ScoutSessionComposer(draft: sessionDraft) {
                    self.sessionDraft = nil
                } onComplete: { result in
                    handleSessionStarted(result)
                }
                .transition(.opacity)
            }
        }
        .overlay {
            if let previewImage {
                ScoutImageLightbox(image: previewImage) {
                    self.previewImage = nil
                }
            }
        }
        .animation(.easeOut(duration: 0.14), value: previewImage?.id)
        .overlay(alignment: .bottomLeading) {
            ScoutDesignPreviewPanel()
                .padding(HudSpacing.xl)
        }
        .overlay {
            if showCheatsheet {
                ScoutKeyboardCheatsheet(section: section) { showCheatsheet = false }
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.12), value: showCheatsheet)
        .background(keyboardCommands)
    }

    // Invisible buttons that register window-level shortcuts. Kept active
    // (opacity 0, not .hidden/.disabled) so the chords stay live regardless of
    // which control holds focus. Mirrors OpenScoutMenu's CommsWindow. ⌘-modified
    // so they never collide with typing in the composer or search field.
    private var keyboardCommands: some View {
        Group {
            // Silenced while a modal overlay (new-session composer, image
            // lightbox) owns the screen — otherwise these would reach through
            // and steer the page behind the modal.
            if !modalPresented {
                Group {
                    Button("") { moveSelection(1) }.keyboardShortcut(.downArrow, modifiers: .command)
                    Button("") { moveSelection(-1) }.keyboardShortcut(.upArrow, modifiers: .command)
                    Button("") { focusSearch() }.keyboardShortcut("k", modifiers: .command)
                    Button("") { focusComposer() }.keyboardShortcut("l", modifiers: .command)
                    Button("") { store.refresh(force: true) }.keyboardShortcut("r", modifiers: .command)
                }
                Group {
                    Button("") { channelFilter = .all }.keyboardShortcut("1", modifiers: .command)
                    Button("") { channelFilter = .direct }.keyboardShortcut("2", modifiers: .command)
                    Button("") { channelFilter = .shared }.keyboardShortcut("3", modifiers: .command)
                    Button("") { observeSelectedAgent() }.keyboardShortcut("o", modifiers: .command)
                    Button("") { openSelectedAgentChannel() }.keyboardShortcut(.return, modifiers: .command)
                }
                Button("") { showCheatsheet.toggle() }.keyboardShortcut("/", modifiers: .command)
                // Bare vim keys + `?` — only live when no text field is capturing
                // input, so typing j/k/?/etc. into a message or search field still
                // inserts the character instead of stealing the key.
                if bareKeysAvailable {
                    Group {
                        Button("") { showCheatsheet.toggle() }.keyboardShortcut("?", modifiers: [])
                        Button("") { moveSelection(1) }.keyboardShortcut("j", modifiers: [])
                        Button("") { moveSelection(-1) }.keyboardShortcut("k", modifiers: [])
                        Button("") { moveSelection(1) }.keyboardShortcut("l", modifiers: [])
                        Button("") { moveSelection(-1) }.keyboardShortcut("h", modifiers: [])
                        Button("") { moveSelectionToEdge(last: false) }.keyboardShortcut("g", modifiers: [])
                        Button("") { moveSelectionToEdge(last: true) }.keyboardShortcut("g", modifiers: .shift)
                    }
                }
            }
        }
        .opacity(0)
        .frame(width: 0, height: 0)
        .accessibilityHidden(true)
    }

    /// A modal overlay is up and should own the keyboard.
    private var modalPresented: Bool {
        sessionDraft != nil || previewImage != nil
    }

    /// Bare (unmodified) keys may drive navigation/help only when nothing is
    /// capturing text input — otherwise they'd be stolen from typing. (Modal
    /// overlays are already excluded by `modalPresented`.)
    private var bareKeysAvailable: Bool {
        !composerFocused && !searchFocused
    }

    /// Step the active page's selection: conversations in Comms, agent cards in
    /// Agents. A no-op (or seeds the first item) when nothing is selected yet.
    private func moveSelection(_ delta: Int) {
        switch section {
        case .comms:
            let channels = commsListChannels
            guard !channels.isEmpty else { return }
            let current = channels.firstIndex { $0.cId == store.selectedCId }
            let next = current.map { min(max($0 + delta, 0), channels.count - 1) } ?? 0
            store.selectChannel(channels[next].cId)
        case .agents:
            let agents = store.agents
            guard !agents.isEmpty else { return }
            let current = agents.firstIndex { $0.id == store.selectedAgentId }
            let next = current.map { min(max($0 + delta, 0), agents.count - 1) } ?? 0
            store.selectAgent(agents[next].id)
        case .tail:
            break
        }
    }

    /// Jump the active page's selection to the first (`g`) or last (`⇧G`) item.
    private func moveSelectionToEdge(last: Bool) {
        switch section {
        case .comms:
            let channels = commsListChannels
            guard let target = last ? channels.last : channels.first else { return }
            store.selectChannel(target.cId)
        case .agents:
            let agents = store.agents
            guard let target = last ? agents.last : agents.first else { return }
            store.selectAgent(target.id)
        case .tail:
            break
        }
    }

    private func focusSearch() {
        guard section == .comms else { return }
        searchFocused = true
    }

    private func focusComposer() {
        guard section == .comms, store.selectedCId != nil else { return }
        composerFocused = true
    }

    /// Open the observe sidecar for the selected agent (⌘O, Agents page).
    private func observeSelectedAgent() {
        guard section == .agents, let agent = store.selectedAgent else { return }
        observeAgent(agent)
    }

    /// Jump into the selected agent's conversation (⌘↩, Agents page).
    private func openSelectedAgentChannel() {
        guard section == .agents, let agent = store.selectedAgent else { return }
        store.openAgentChannel(agent)
        section = .comms
    }

    private func startNewConversation() {
        sessionDraft = ScoutSessionDraft(
            title: "New conversation",
            target: .project,
            projectPath: defaultProjectPath,
            mode: .fresh,
            instructions: "",
            fromMessageId: nil,
            fromConversationId: nil
        )
    }

    private func startConversationFromMessage(_ message: ScoutMessage, agent: ScoutAgent?) {
        let target: ScoutSessionDraft.Target = agent.map { .agent($0) } ?? .project
        sessionDraft = ScoutSessionDraft(
            title: "New conversation from message",
            target: target,
            projectPath: agent?.projectRoot?.nilIfEmpty ?? defaultProjectPath,
            mode: .fresh,
            instructions: message.body,
            fromMessageId: message.id,
            fromConversationId: message.cId
        )
    }

    private func startSessionWithAgent(_ agent: ScoutAgent, mode: ScoutSessionDraft.Mode) {
        sessionDraft = ScoutSessionDraft(
            title: mode == .continueContext ? "Continue session" : "New session",
            target: .agent(agent),
            projectPath: agent.projectRoot?.nilIfEmpty ?? "",
            mode: mode,
            instructions: "",
            fromMessageId: nil,
            fromConversationId: nil
        )
    }

    private func handleSessionStarted(_ result: SessionInitiationResult) {
        sessionDraft = nil
        section = .comms
        store.refresh(force: true)
        if let cId = result.conversationId?.nilIfEmpty {
            store.selectChannel(cId)
        }
        if let agentId = result.agentId?.nilIfEmpty {
            store.selectAgent(agentId)
        }
    }

    /// Best-guess project root for a brand-new conversation: the selected
    /// agent's root, else any roster agent that exposes one.
    private var defaultProjectPath: String {
        store.selectedAgent?.projectRoot?.nilIfEmpty
            ?? store.agents.compactMap { $0.projectRoot?.nilIfEmpty }.first
            ?? ""
    }

    /// Root for resolving relative file paths quoted in a message: prefer the
    /// sender agent's own workspace, then the selected conversation's agent,
    /// then any known project — so an agent's "apps/macos/…" resolves to the
    /// repo it's actually working in.
    private func fileBaseDirectory(for message: ScoutMessage) -> String? {
        if let sender = agent(for: message),
           let root = sender.projectRoot?.nilIfEmpty ?? sender.cwd?.nilIfEmpty {
            return root
        }
        if let selected = store.selectedAgent?.projectRoot?.nilIfEmpty ?? store.selectedAgent?.cwd?.nilIfEmpty {
            return selected
        }
        return defaultProjectPath.nilIfEmpty
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
                selectedCId: store.selectedCId,
                width: conversationListResizePreviewWidth ?? CGFloat(conversationListWidth),
                searchFocused: $searchFocused,
                onNewConversation: { startNewConversation() }
            ) { channel in
                store.selectChannel(channel.cId)
            }
            .overlay(alignment: .trailing) {
                ZStack(alignment: .trailing) {
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

    // One clean line: just the conversation's handle. The cId and participant
    // strip that used to ride a second row are redundant with the inspector
    // card (which lists members + cId), so they're gone here.
    private var chatHeader: some View {
        HStack(spacing: HudSpacing.md) {
            Text(store.selectedChannel?.displayHandle ?? "Scout")
                .font(HudFont.ui(18, weight: .semibold))
                .foregroundStyle(HudPalette.ink)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, HudSpacing.huge)
        .frame(height: 42, alignment: .center)
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
                                baseDirectory: fileBaseDirectory(for: message),
                                previewAgent: previewAgent,
                                onNewFromMessage: {
                                    startConversationFromMessage(message, agent: agent(for: message))
                                }
                            )
                                .id(message.id)
                        }

                        // Bottom sentinel: visible only when scrolled to the
                        // latest message, so we can tell whether to keep
                        // following or leave the reader in their zone.
                        Color.clear
                            .frame(height: 1)
                            .id(Self.messageListBottomAnchor)
                            .onAppear { followLatest = true }
                            .onDisappear { followLatest = false }
                    }
                }
                .padding(EdgeInsets(
                    top: HudSpacing.huge,
                    leading: HudSpacing.huge,
                    bottom: HudSpacing.huge,
                    trailing: HudSpacing.md
                ))
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .scoutOverlayScrollers()
            }
            .scrollIndicators(.visible)
            .onAppear {
                if !store.messages.isEmpty {
                    proxy.scrollTo(Self.messageListBottomAnchor, anchor: .bottom)
                    pendingInitialJump = false
                }
            }
            .onChange(of: store.selectedCId) { _, _ in
                // Opening a conversation lands on the newest message unless the
                // user deliberately scrolls up afterwards.
                pendingInitialJump = true
                followLatest = true
            }
            .onChange(of: store.messages.last?.id) { _, _ in
                guard !store.messages.isEmpty else { return }
                if pendingInitialJump {
                    pendingInitialJump = false
                    proxy.scrollTo(Self.messageListBottomAnchor, anchor: .bottom)
                } else if followLatest {
                    withAnimation(.easeOut(duration: 0.16)) {
                        proxy.scrollTo(Self.messageListBottomAnchor, anchor: .bottom)
                    }
                }
            }
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            if !pendingImages.isEmpty {
                composerAttachmentStrip
            }
            HStack(alignment: .top, spacing: HudSpacing.md) {
                composerInputWell

                if isDictating {
                    ScoutWaveform(tint: isDictationProcessing ? HudPalette.muted : HudPalette.accent)
                        .frame(width: 26, height: 18)
                        .padding(.top, HudSpacing.xs + 8)
                        .transition(.opacity)
                }

                composerAttachButton
                    .padding(.top, HudSpacing.xs)

                ScoutMicButton(box: 34, glyph: 15, action: toggleDictation)
                    .padding(.top, HudSpacing.xs)

                ScoutSendButton(
                    isEnabled: composerReady,
                    isSending: store.isSending,
                    action: requestSend
                )
                .padding(.top, HudSpacing.xs)
            }
            .animation(.easeOut(duration: 0.16), value: isDictating)
            .onChange(of: vox.state) { _, newState in
                guard pendingSendAfterDictation else { return }
                switch newState {
                case .idle:
                    // Final transcript has already been spliced (it lands on
                    // $lastFinalText before state flips to idle), so send now.
                    pendingSendAfterDictation = false
                    sendDraft()
                case .unavailable:
                    pendingSendAfterDictation = false
                default:
                    break
                }
            }

            if let status = composerStatusText {
                Text(status)
                    .font(HudFont.mono(9))
                    .foregroundStyle(HudPalette.dim)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, HudSpacing.xs)
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
        .background(
            ImagePasteCatcher(
                isActive: { store.selectedCId != nil && sessionDraft == nil },
                onPasteImages: stagePastedImages
            )
            .frame(width: 0, height: 0)
            .allowsHitTesting(false)
        )
    }

    private var composerInputWell: some View {
        HStack(alignment: .top, spacing: HudSpacing.md) {
            ZStack(alignment: .topLeading) {
                TextField(showDictationPreview ? "" : composerPlaceholder, text: $draft, axis: .vertical)
                    .textFieldStyle(.plain)
                    .font(HudFont.mono(11))
                    .foregroundStyle(HudPalette.ink)
                    // Accent caret to match the HUD (not the system blue), and
                    // hidden while dictating so the waveform is the only cue.
                    .tint(showDictationPreview ? Color.clear : HudPalette.accent)
                    .lineLimit(1...5)
                    .focused($composerFocused)
                    .disabled(store.selectedCId == nil || store.isSending)
                    .onKeyPress(phases: .down) { press in
                        // ⌘V image paste is handled by ImagePasteCatcher at the
                        // AppKit level — the field editor swallows it here.
                        if press.key == .return {
                            if applySelectedSuggestion() { return .handled }
                            if press.modifiers.contains(.shift) {
                                draft.append("\n")
                                return .handled
                            }
                            requestSend()
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
                        if !suggestions.isEmpty {
                            dismissSuggestions()
                            return .handled
                        }
                        // Blur so the bare vim keys (h/j/k/l, g/G, ?) become
                        // live for list navigation.
                        composerFocused = false
                        return .handled
                    }

                if showDictationPreview {
                    ScoutDictationPreview(text: vox.partial)
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
        .dropDestination(for: URL.self) { urls, _ in
            addImages(from: urls)
        }
    }

    // MARK: - Composer attachments

    private var composerAttachButton: some View {
        Button(action: presentImagePicker) {
            Image(systemName: "paperclip")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(HudPalette.muted)
                .frame(width: 34, height: 34)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .help("Attach image")
        .disabled(store.selectedCId == nil || store.isSending)
    }

    private var composerAttachmentStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: HudSpacing.sm) {
                ForEach(pendingImages) { image in
                    composerAttachmentChip(image)
                }
            }
            .padding(.horizontal, HudSpacing.xs)
            .padding(.vertical, 2)
        }
    }

    private func composerAttachmentChip(_ image: ScoutComposerImage) -> some View {
        ZStack(alignment: .topTrailing) {
            Group {
                if let nsImage = NSImage(data: image.data) {
                    Image(nsImage: nsImage)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                } else {
                    Image(systemName: "photo")
                        .foregroundStyle(HudPalette.muted)
                }
            }
            .frame(width: 52, height: 52)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
            )
            .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .onTapGesture { previewImage = image }
            .help("Click to preview")

            Button {
                pendingImages.removeAll { $0.id == image.id }
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(.white, .black.opacity(0.55))
            }
            .buttonStyle(.plain).scoutPointerCursor()
            .help("Remove attachment")
            .offset(x: 5, y: -5)
        }
    }

    /// Stage images handed up by the ⌘V paste catcher. Returns false (so the
    /// paste falls through to normal text handling) when we can't accept them.
    private func stagePastedImages(_ images: [ScoutComposerImage]) -> Bool {
        guard store.selectedCId != nil, !store.isSending, !images.isEmpty else { return false }
        pendingImages.append(contentsOf: images)
        return true
    }

    @discardableResult
    private func addImages(from urls: [URL]) -> Bool {
        let images = urls.compactMap(ScoutImageIntake.fromFileURL)
        guard !images.isEmpty else { return false }
        pendingImages.append(contentsOf: images)
        return true
    }

    private func presentImagePicker() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.allowedContentTypes = [.image]
        guard panel.runModal() == .OK else { return }
        addImages(from: panel.urls)
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
        if let title = store.selectedChannel?.displayHandle, !title.isEmpty {
            return "Message \(title)"
        }
        return "Message"
    }

    private var composerCanSend: Bool {
        (!draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !pendingImages.isEmpty)
            && store.selectedCId != nil
            && !store.isSending
    }

    /// Whether the send button should read as *enabled* — i.e. we have a target
    /// to talk to. Lit whenever a conversation is selected (not gated on having
    /// typed text yet); the actual send still no-ops on an empty draft.
    private var composerReady: Bool {
        store.selectedCId != nil && !store.isSending
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
        if !pendingImages.isEmpty {
            let noun = pendingImages.count == 1 ? "image" : "images"
            return "\(pendingImages.count) \(noun) attached · ↵ send · ⌘V or ⊕ to add"
        }
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

    private var isDictationProcessing: Bool {
        if case .processing = vox.state { return true }
        return false
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

    /// Send entry point. While dictating, commit the recording first and let
    /// the dictation→idle transition fire the actual send once the transcript
    /// has landed — so one tap finishes transcription and sends in one shot.
    private func requestSend() {
        if isDictating {
            guard composerReady else { return }
            pendingSendAfterDictation = true
            vox.stop()
            return
        }
        sendDraft()
    }

    private func sendDraft() {
        let body = draft
        guard composerCanSend else { return }
        let images = pendingImages
        draft = ""
        pendingImages = []
        if let cId = store.selectedCId { drafts[cId] = nil }
        followLatest = true
        composerFocused = true
        clearSuggestions(resetDismissedSignature: true)
        Task { await store.send(body, images: images) }
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
        // While the New-conversation composer is up it owns dictation; don't
        // also splice into the (hidden) chat composer behind it.
        guard sessionDraft == nil else { return }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        draft = ScoutDictationBuffer.appending(trimmed, to: draft)
        ScoutVoxService.shared.consumeFinalText()
        composerFocused = true
        moveComposerCaretToEnd()
    }

    /// After splicing dictated text, drop the field's selection and park the
    /// caret at the very end so you can keep typing/editing cleanly instead of
    /// landing on an all-selected or mid-string insertion point.
    private func moveComposerCaretToEnd() {
        #if os(macOS)
        DispatchQueue.main.async {
            guard let textView = NSApp.keyWindow?.firstResponder as? NSTextView else { return }
            let end = (textView.string as NSString).length
            textView.setSelectedRange(NSRange(location: end, length: 0))
            textView.scrollRangeToVisible(NSRange(location: end, length: 0))
        }
        #endif
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
                ScrollViewReader { proxy in
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
                                .id(agent.id)
                            }
                        }
                        .padding(HudSpacing.huge)
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                    }
                    // Keep the keyboard-selected card in view (it may be off-screen).
                    .onChange(of: store.selectedAgentId) { _, id in
                        guard let id else { return }
                        withAnimation(.easeOut(duration: 0.16)) {
                            proxy.scrollTo(id, anchor: .center)
                        }
                    }
                }
            }
        }
        .background(ScoutDesign.bg)
    }

    private var tailContent: some View {
        ScoutTailContent(tail: tail)
    }

    private var inspectorHeader: some View {
        let multiAgent = channelAgentMembers.count >= 2
        return HStack(spacing: HudSpacing.md) {
            HudSectionLabel(section == .tail ? "Tail" : (multiAgent ? "Agents" : (store.selectedAgent == nil ? "Context" : "Agent")))
            Spacer()
            if section == .tail {
                HudBadge(tail.isFollowing ? "Live" : "Paused", tint: tail.isFollowing ? HudPalette.statusOk : HudPalette.muted, dot: tail.isFollowing)
            } else if !multiAgent, let agent = store.selectedAgent {
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
            if let target = fileViewer.target {
                ScoutFileViewerPanel(
                    target: target,
                    width: fileViewerWidthBinding,
                    onClose: {
                        withAnimation(.easeOut(duration: 0.14)) {
                            fileViewer.close()
                        }
                    },
                    onOpenInEditor: {
                        ScoutFileOpener.openInEditor(path: target.path, line: target.line)
                    }
                )
                .id(target.path)
                .transition(.move(edge: .trailing).combined(with: .opacity))
            } else if let agent = observeSidecarResolvedAgent {
                ScoutObserveSidecarPanel(
                    agent: agent,
                    stagingWidth: observeSidecarStagingWidth,
                    width: observeSidecarWidthBinding,
                    previewWidth: $observeSidecarResizePreviewWidth,
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
                    },
                    startSession: { mode in
                        startSessionWithAgent(agent, mode: mode)
                    }
                )
                .id("preview-\(agent.id)")
                .transition(.move(edge: .trailing).combined(with: .opacity))
            } else if !inspectorCollapsed {
                HudSidebarPanel(
                    width: inspectorWidthBinding,
                    edge: .trailing,
                    widthRange: ScoutDesign.inspectorWidthRange
                ) {
                    ScoutResizableInspectorPanel {
                        inspectorHeader
                    } content: {
                        inspectorContent
                    }
                }
                .transition(.opacity)
            }
        }
        .animation(.interpolatingSpring(stiffness: 260, damping: 28), value: observeSidecarResolvedAgent?.id)
        .animation(.interpolatingSpring(stiffness: 260, damping: 28), value: agentPreviewResolvedAgent?.id)
        .animation(.interpolatingSpring(stiffness: 260, damping: 28), value: fileViewer.target)
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

                let members = channelAgentMembers
                if members.count >= 2 {
                    ScoutAgentCardStack(
                        agents: members,
                        selectedChannel: store.selectedChannel,
                        openObserve: { observeAgent($0) },
                        openProfile: { ScoutWeb.open(path: "/agents/\($0.id)?tab=profile") },
                        startSession: { agent in startSessionWithAgent(agent, mode: .fresh) }
                    )
                } else if let agent = store.selectedAgent {
                    ScoutAgentInspector(
                        agent: agent,
                        selectedChannel: store.selectedChannel,
                        openObserve: { observeAgent(agent) },
                        openProfile: { ScoutWeb.open(path: "/agents/\(agent.id)?tab=profile") },
                        startSession: { mode in startSessionWithAgent(agent, mode: mode) }
                    )
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

    private var inspectorWidthBinding: Binding<CGFloat> {
        Binding {
            CGFloat(inspectorWidth)
        } set: { nextWidth in
            let range = ScoutDesign.inspectorWidthRange
            inspectorWidth = Double(min(max(nextWidth, range.lowerBound), range.upperBound))
        }
    }

    private var observeSidecarWidthBinding: Binding<CGFloat> {
        Binding {
            CGFloat(observeSidecarWidth)
        } set: { nextWidth in
            let range = ScoutObserveSidecarMetrics.widthRange
            observeSidecarWidth = Double(min(max(nextWidth, range.lowerBound), range.upperBound))
        }
    }

    private var fileViewerWidthBinding: Binding<CGFloat> {
        Binding {
            CGFloat(fileViewerWidth)
        } set: { nextWidth in
            let range = ScoutFileViewerMetrics.widthRange
            fileViewerWidth = Double(min(max(nextWidth, range.lowerBound), range.upperBound))
        }
    }

    private var navigationSidebarLabelWidthBinding: Binding<CGFloat> {
        Binding {
            CGFloat(navigationSidebarLabelWidth)
        } set: { nextWidth in
            navigationSidebarLabelWidth = Double(min(max(nextWidth, 76), 260))
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

    /// Distinct, resolved agents participating in the selected channel.
    private var channelAgentMembers: [ScoutAgent] {
        var seen = Set<String>()
        var result: [ScoutAgent] = []
        for member in selectedChannelMembers {
            guard let agent = member.agent, !seen.contains(agent.id) else { continue }
            seen.insert(agent.id)
            result.append(agent)
        }
        return result
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
                : min(max(inspectorWidthBinding.wrappedValue, ScoutObserveSidecarMetrics.widthRange.lowerBound), ScoutObserveSidecarMetrics.widthRange.upperBound)
        } else {
            observeSidecarStagingWidth = observeSidecarWidthBinding.wrappedValue
        }

        store.selectAgent(agent.id)
        agentContentMode = .roster
        observeSidecarResizePreviewWidth = nil
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
        observeSidecarResizePreviewWidth = nil
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
    static let columnHeaderHeight = HudSidebarLayout.headerTopPadding
        + HudSidebarLayout.headerHeight
        + HudSidebarLayout.headerBottomPadding
    static let columnHeaderTopInset = HudSidebarLayout.headerTopPadding
    static let columnHeaderPrimaryRowHeight: CGFloat = 28
    static let columnHeaderLineGap: CGFloat = 2
    static let columnHeaderTrailingTopOffset: CGFloat = 2
    static let conversationListWidthRange: ClosedRange<CGFloat> = 188...440
    static let inspectorWidthRange: ClosedRange<CGFloat> = 260...520
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
        case .direct: return "Direct"
        case .shared: return "Channels"
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

struct ScoutColumnHeader<Primary: View, Secondary: View, Trailing: View>: View {
    let horizontalPadding: CGFloat
    let primary: Primary
    let secondary: Secondary
    let trailing: Trailing

    init(
        horizontalPadding: CGFloat,
        @ViewBuilder primary: () -> Primary,
        @ViewBuilder secondary: () -> Secondary,
        @ViewBuilder trailing: () -> Trailing
    ) {
        self.horizontalPadding = horizontalPadding
        self.primary = primary()
        self.secondary = secondary()
        self.trailing = trailing()
    }

    var body: some View {
        HStack(alignment: .top, spacing: HudSpacing.xl) {
            VStack(alignment: .leading, spacing: ScoutDesign.columnHeaderLineGap) {
                primary
                    .frame(
                        maxWidth: .infinity,
                        minHeight: ScoutDesign.columnHeaderPrimaryRowHeight,
                        alignment: .bottomLeading
                    )
                secondary
                    .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            trailing
                .padding(.top, ScoutDesign.columnHeaderTrailingTopOffset)
        }
        .padding(.top, ScoutDesign.columnHeaderTopInset)
        .padding(.horizontal, horizontalPadding)
        .frame(height: ScoutDesign.columnHeaderHeight, alignment: .top)
    }
}

private struct ScoutConversationListBar: View {
    let isLoading: Bool
    @Binding var query: String
    @Binding var filter: ScoutChannelFilter
    let channels: [ScoutChannel]
    let selectedCId: String?
    let width: CGFloat
    let searchFocused: FocusState<Bool>.Binding
    let onNewConversation: () -> Void
    let select: (ScoutChannel) -> Void

    @AppStorage(ScoutDesignPreview.glow) private var glowOn = false

    var body: some View {
        VStack(spacing: 0) {
            header
            HudDivider(color: ScoutDesign.hairline)
            controls
            HudDivider(color: ScoutDesign.hairline)
            listContent
        }
        .frame(width: width)
        .frame(maxHeight: .infinity)
        .background {
            ZStack {
                ScoutDesign.chrome
                if glowOn { ScoutAmbientGlow() }
            }
        }
    }

    private var header: some View {
        HStack(spacing: HudSpacing.md) {
            Text("Conversations")
                .font(HudFont.ui(13, weight: .semibold))
                .foregroundStyle(HudPalette.ink)
                .lineLimit(1)

            if isLoading {
                ProgressView()
                    .controlSize(.small)
            }

            Spacer(minLength: 0)

            Button(action: onNewConversation) {
                HStack(spacing: HudSpacing.xs) {
                    Image(systemName: "square.and.pencil")
                        .font(HudFont.ui(11, weight: .semibold))
                    Text("New")
                        .font(HudFont.ui(11, weight: .semibold))
                }
                .foregroundStyle(HudPalette.accent)
                .padding(.horizontal, HudSpacing.md)
                .padding(.vertical, HudSpacing.xs)
                .background(Capsule().fill(HudSurface.tintGhost(HudPalette.accent)))
                .overlay(Capsule().stroke(HudSurface.tintBorder(HudPalette.accent), lineWidth: 1))
                .contentShape(Capsule())
            }
            .buttonStyle(.plain).scoutPointerCursor()
            .help("New conversation")
        }
        .padding(.horizontal, HudSpacing.xxl)
        .frame(height: 42, alignment: .center)
    }

    private var controls: some View {
        HStack(spacing: HudSpacing.md) {
            HudField("Search", text: $query, icon: "magnifyingglass")
                .focused(searchFocused)
            ScoutConversationFilterControl(selection: $filter)
        }
        .padding(.horizontal, HudSpacing.xxl)
        .padding(.top, HudSpacing.md)
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
                .frame(maxWidth: .infinity)
                .scoutOverlayScrollers()
            }
            .scrollIndicators(.visible)
        }
    }
}

/// Compact icon-only scope toggle. Tucked onto the search row rather than
/// taking a full row of its own — the active scope reads from the accent fill;
/// each segment names itself on hover.
private struct ScoutConversationFilterControl: View {
    @Binding var selection: ScoutChannelFilter

    var body: some View {
        HStack(spacing: 2) {
            ForEach(ScoutChannelFilter.allCases) { option in
                Button {
                    selection = option
                } label: {
                    Image(systemName: option.icon)
                        .font(HudFont.ui(11, weight: .semibold))
                        .foregroundStyle(selection == option ? HudPalette.ink : HudPalette.muted)
                        .frame(width: 30, height: 24)
                        .background(
                            RoundedRectangle(cornerRadius: HudRadius.standard - 2, style: .continuous)
                                .fill(selection == option ? HudSurface.selected(HudPalette.accent) : Color.clear)
                        )
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain).scoutPointerCursor()
                .help(option.title)
            }
        }
        .padding(2)
        .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(HudSurface.inset))
        .overlay(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin))
    }
}

private struct ScoutConversationRow: View {
    let channel: ScoutChannel
    let isSelected: Bool
    let action: () -> Void

    @State private var isHovering = false
    @AppStorage(ScoutDesignPreview.accents) private var accentsOn = false

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
                        Text(channel.rowTitle)
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
                if isSelected {
                    ZStack(alignment: .leading) {
                        if accentsOn {
                            // Soft bloom behind the rule so selection feels lit.
                            Rectangle()
                                .fill(HudPalette.accent)
                                .frame(width: 3)
                                .blur(radius: 4)
                                .opacity(0.85)
                        }
                        Rectangle()
                            .fill(HudPalette.accent)
                            .frame(width: 2)
                    }
                }
            }
            .overlay(alignment: .bottom) {
                HudDivider(color: ScoutDesign.hairline)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain).scoutPointerCursor()
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
        .buttonStyle(.plain).scoutPointerCursor()
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
                        .frame(maxWidth: .infinity)
                        .scoutOverlayScrollers()
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
                    Text(channel.rowTitle)
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
        .buttonStyle(.plain).scoutPointerCursor()
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
            .buttonStyle(.plain).scoutPointerCursor()
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
    /// Workspace root for resolving relative file paths this message quotes.
    let baseDirectory: String?
    let previewAgent: (ScoutAgent) -> Void
    let onNewFromMessage: () -> Void

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
                ScoutMarkdownView(text: message.body, baseDirectory: baseDirectory)
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
            .contextMenu {
                Button {
                    onNewFromMessage()
                } label: {
                    Label("New conversation from this message…", systemImage: "bubble.left.and.text.bubble.right")
                }
                Divider()
                Button {
                    copyToPasteboard(message.body)
                } label: {
                    Label("Copy message", systemImage: "doc.on.doc")
                }
                Button {
                    copyToPasteboard(message.id)
                } label: {
                    Label("Copy message ID", systemImage: "number")
                }
            }
            if !message.isOperator { Spacer(minLength: 80) }
        }
        .frame(maxWidth: .infinity, alignment: message.isOperator ? .trailing : .leading)
    }

    private func copyToPasteboard(_ value: String) {
        #if os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(value, forType: .string)
        #endif
    }

    @ViewBuilder
    private var actorChip: some View {
        if let agent {
            Button {
                previewAgent(agent)
            } label: {
                actorLabel
            }
            .buttonStyle(.plain).scoutPointerCursor()
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

struct ScoutMarkdownView: View {
    let text: String
    /// Workspace root of the agent that wrote this message — used to resolve
    /// relative file paths the agent quoted from its own context.
    var baseDirectory: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            ForEach(MessageMarkupParser.parse(text)) { block in
                blockView(block)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
        .environment(\.openURL, OpenURLAction { url in
            guard let link = ScoutFileLink.parse(url) else { return .systemAction }
            let resolved = ScoutFilePathResolver.resolve(path: link.path, base: link.base)
            // A folder can't render in a code pane — reveal it in Finder instead.
            var isDir: ObjCBool = false
            if FileManager.default.fileExists(atPath: resolved, isDirectory: &isDir), isDir.boolValue {
                NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: resolved)])
                return .handled
            }
            if NSEvent.modifierFlags.contains(.command) {
                // ⌘-click pops straight out to the editor (Cursor), with line jump.
                ScoutFileOpener.openInEditor(path: resolved, line: link.line)
            } else {
                // Plain click previews in the embedded file viewer.
                withAnimation(.easeOut(duration: 0.16)) {
                    ScoutFileViewer.shared.open(path: resolved, line: link.line)
                }
            }
            return .handled
        })
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
        let parsed = (try? AttributedString(
            markdown: body,
            options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(body)
        return ScoutFileLinkifier.apply(to: parsed, accent: HudPalette.accent, baseDirectory: baseDirectory)
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

struct ScoutDictationPreview: View {
    let text: String

    private var displayText: String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        // Live partial transcript only — no blinking caret. The recording cue
        // is the waveform near the mic; the textual state lives in the status row.
        Text(displayText)
            .font(HudFont.mono(11))
            .foregroundStyle(HudPalette.muted)
            .lineLimit(1)
            .truncationMode(.tail)
            .opacity(displayText.isEmpty ? 0 : 1)
            .frame(maxWidth: .infinity, alignment: .leading)
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
        .buttonStyle(.plain).scoutPointerCursor()
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
            Image(systemName: "paperplane.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(iconColor)
                .offset(x: -1, y: 1)
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
// Lightweight equalizer-style waveform shown while dictating. Decorative
// (synthetic, not amplitude-driven) — replaces the recording pulse with a
// calmer, single activity cue. Bars stay out of phase via fixed per-bar
// durations rather than any RNG.
private struct ScoutWaveform: View {
    var tint: Color
    @State private var animate = false

    private let lows: [CGFloat] = [4, 6, 5, 7, 4]
    private let highs: [CGFloat] = [12, 17, 14, 18, 11]
    private let durations: [Double] = [0.50, 0.62, 0.44, 0.70, 0.54]

    var body: some View {
        HStack(alignment: .center, spacing: 2) {
            ForEach(lows.indices, id: \.self) { i in
                Capsule(style: .continuous)
                    .fill(tint.opacity(0.85))
                    .frame(width: 2.5, height: animate ? highs[i] : lows[i])
                    .animation(
                        .easeInOut(duration: durations[i]).repeatForever(autoreverses: true),
                        value: animate
                    )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .onAppear { animate = true }
    }
}

struct ScoutMicButton: View {
    let box: CGFloat
    let glyph: CGFloat
    let action: () -> Void

    @ObservedObject private var vox = ScoutVoxService.shared
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

                Circle()
                    .stroke(
                        isRecording ? HudPalette.accent.opacity(0.5) : Color.clear,
                        lineWidth: HudStrokeWidth.thin
                    )
                    .frame(width: box, height: box)

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
            }
            .frame(width: box, height: box)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .help(tooltip)
        .onHover { hovering = $0 }
        .task { if vox.state == .probing { await vox.probe() } }
    }

    private var micFillColor: Color {
        if isRecording {
            return HudPalette.accent.opacity(0.13)
        }
        if isProcessing {
            return HudSurface.hover.opacity(0.7)
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
        let parsed = (try? AttributedString(
            markdown: body,
            options: AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(body)
        return ScoutFileLinkifier.apply(to: parsed, accent: HudPalette.accent)
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

// MARK: - Design preview (toggleable look-and-feel experiments)

/// UserDefaults keys for the three live "make it awesomer" experiments. Each is
/// off by default so the app ships at its current baseline; the floating
/// `ScoutDesignPreviewPanel` flips them so before/after is one click apart.
/// Every consumer reads the same key via `@AppStorage`, so a flip re-renders
/// all affected surfaces at once.
enum ScoutDesignPreview {
    static let depth = "scout.design.preview.depth"
    static let accents = "scout.design.preview.accents"
    static let glow = "scout.design.preview.glow"
}

/// "Glow": the conversation list reads as backlit — light leaks in around the
/// panel's edges (rim light), as if a source sits behind it, brightest at the
/// top where the light originates. The interior stays dark so text never
/// competes with it. Same single white light source as Depth.
private struct ScoutAmbientGlow: View {
    var body: some View {
        ZStack {
            // Rim light bleeding in from behind the panel's edges. The stroke's
            // outward blur is clipped at the panel bound, leaving an inner halo.
            Rectangle()
                .stroke(Color.white.opacity(0.12), lineWidth: 2)
                .blur(radius: 11)

            // The source sits behind-and-above: a brighter bloom hugging the top.
            LinearGradient(
                colors: [Color.white.opacity(0.10), Color.clear],
                startPoint: .top,
                endPoint: UnitPoint(x: 0.5, y: 0.22)
            )
        }
        .allowsHitTesting(false)
    }
}

/// "Depth": one consistent light source — a 1px top-edge highlight that fades
/// downward plus a soft, wide shadow — so graphite cards read as lifted objects
/// rather than flat outlined boxes. No-op when the flag is off.
private struct ScoutDepthModifier: ViewModifier {
    var radius: CGFloat = HudRadius.card
    @AppStorage(ScoutDesignPreview.depth) private var depthOn = false

    func body(content: Content) -> some View {
        content
            .overlay {
                if depthOn {
                    RoundedRectangle(cornerRadius: radius, style: .continuous)
                        .strokeBorder(
                            LinearGradient(
                                colors: [Color.white.opacity(0.10), Color.white.opacity(0.0)],
                                startPoint: .top,
                                endPoint: .bottom
                            ),
                            lineWidth: 1
                        )
                        .allowsHitTesting(false)
                }
            }
            .shadow(color: Color.black.opacity(depthOn ? 0.35 : 0),
                    radius: depthOn ? 14 : 0, x: 0, y: depthOn ? 6 : 0)
    }
}

extension View {
    func scoutDepth(radius: CGFloat = HudRadius.card) -> some View {
        modifier(ScoutDepthModifier(radius: radius))
    }
}

/// Shows the pointing-hand cursor while hovering an enabled clickable. Push/pop
/// are balanced via local state (and cleaned up on disappear) so the cursor
/// never gets stuck. Respects `isEnabled` so disabled controls stay an arrow.
private struct ScoutPointerCursorModifier: ViewModifier {
    @Environment(\.isEnabled) private var isEnabled
    @State private var pushed = false

    func body(content: Content) -> some View {
        content
            .onHover { inside in
                if inside, isEnabled {
                    if !pushed { NSCursor.pointingHand.push(); pushed = true }
                } else if pushed {
                    NSCursor.pop(); pushed = false
                }
            }
            .onDisappear {
                if pushed { NSCursor.pop(); pushed = false }
            }
    }
}

extension View {
    /// Pointing-hand cursor on hover for custom (`.plain`) buttons and other
    /// tap targets that don't get it for free.
    func scoutPointerCursor() -> some View {
        modifier(ScoutPointerCursorModifier())
    }
}

/// "Accents": a section eyebrow that grows a small hanging accent tick when the
/// flag is on — an editorial marker that makes labels feel deliberate.
private struct ScoutEyebrow: View {
    let text: String
    @AppStorage(ScoutDesignPreview.accents) private var accentsOn = false

    var body: some View {
        HStack(spacing: HudSpacing.sm) {
            if accentsOn {
                RoundedRectangle(cornerRadius: 0.5, style: .continuous)
                    .fill(HudPalette.accent)
                    .frame(width: 2, height: 9)
            }
            HudSectionLabel(text)
        }
    }
}

/// Tiny floating control to flip the three look-and-feel experiments on/off
/// live, so before/after is one click apart. Collapses to a single chip.
private struct ScoutDesignPreviewPanel: View {
    @AppStorage(ScoutDesignPreview.depth) private var depth = false
    @AppStorage(ScoutDesignPreview.accents) private var accents = false
    @AppStorage(ScoutDesignPreview.glow) private var glow = false
    @AppStorage("scout.design.preview.panelExpanded") private var expanded = true

    var body: some View {
        VStack(alignment: .leading, spacing: expanded ? HudSpacing.md : 0) {
            Button {
                withAnimation(.easeOut(duration: 0.16)) { expanded.toggle() }
            } label: {
                HStack(spacing: HudSpacing.sm) {
                    Image(systemName: "sparkles")
                        .font(HudFont.ui(10, weight: .semibold))
                        .foregroundStyle(anyOn ? HudPalette.accent : HudPalette.muted)
                    Text("DESIGN")
                        .font(HudFont.mono(9, weight: .bold))
                        .tracking(1.5)
                        .foregroundStyle(HudPalette.muted)
                    Spacer(minLength: HudSpacing.lg)
                    Image(systemName: expanded ? "chevron.down" : "chevron.up")
                        .font(HudFont.ui(8, weight: .bold))
                        .foregroundStyle(HudPalette.dim)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain).scoutPointerCursor()
            .help("Toggle design experiments")

            if expanded {
                toggleRow("Depth", isOn: $depth)
                toggleRow("Accents", isOn: $accents)
                toggleRow("Glow", isOn: $glow)
            }
        }
        .padding(.horizontal, HudSpacing.lg)
        .padding(.vertical, HudSpacing.md)
        .frame(width: expanded ? 168 : nil)
        .background(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).fill(HudPalette.surface))
        .overlay(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).stroke(HudHairline.standard, lineWidth: 1))
        .shadow(color: Color.black.opacity(0.4), radius: 16, x: 0, y: 8)
    }

    private var anyOn: Bool { depth || accents || glow }

    private func toggleRow(_ title: String, isOn: Binding<Bool>) -> some View {
        HStack(spacing: HudSpacing.sm) {
            Text(title)
                .font(HudFont.ui(11, weight: .medium))
                .foregroundStyle(HudPalette.ink)
            Spacer(minLength: HudSpacing.md)
            Toggle("", isOn: isOn)
                .labelsHidden()
                .toggleStyle(.switch)
                .controlSize(.mini)
                .tint(HudPalette.accent)
        }
    }
}

/// One self-contained agent card: identity, runtime, workspace, optional
/// special skills, and the per-agent actions all live inside a single card so
/// the agent reads as one cohesive concept rather than a stack of fragments.
private struct ScoutAgentInspector: View {
    let agent: ScoutAgent
    let selectedChannel: ScoutChannel?
    let openObserve: () -> Void
    let openProfile: () -> Void
    let startSession: (ScoutSessionDraft.Mode) -> Void

    /// Conversation / work-requests / result-delivery / observe are table
    /// stakes every agent has — not "abilities". Only surface skills beyond
    /// that baseline, when an agent actually loads them.
    private var specialCapabilities: [String] {
        let baseline: Set<String> = ["chat", "invoke", "deliver", "observe"]
        return agent.capabilities.filter {
            !baseline.contains($0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
        }
    }

    /// The agent's live harness session, if one is bound. Observe lives with
    /// this — you observe a *session* — so it (and Observe) only appear when
    /// there's something to watch.
    private var sessionId: String? { agent.harnessSessionId?.nilIfEmpty }

    var body: some View {
        HudCard {
            VStack(alignment: .leading, spacing: HudSpacing.lg) {
                identity
                HudDivider(color: ScoutDesign.hairline)
                runtime
                HudDivider(color: ScoutDesign.hairline)
                workspace
                if sessionId != nil {
                    HudDivider(color: ScoutDesign.hairline)
                    sessionSection
                }
                if !specialCapabilities.isEmpty {
                    HudDivider(color: ScoutDesign.hairline)
                    skills
                }
                ScoutNewSessionLink(action: { startSession(.fresh) })
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scoutDepth()
    }

    /// Clickable identity header → profile. State rides the presence dot on
    /// the avatar (no "AVAILABLE" tag); Observe now lives in the Session block.
    private var identity: some View {
        Button(action: openProfile) {
            HStack(alignment: .top, spacing: HudSpacing.md) {
                avatar
                VStack(alignment: .leading, spacing: 2) {
                    Text(agent.displayName)
                        .font(HudFont.ui(16, weight: .semibold))
                        .foregroundStyle(HudPalette.ink)
                        .lineLimit(1)
                    Text(agent.id)
                        .font(HudFont.mono(9))
                        .foregroundStyle(HudPalette.dim)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .help("Open \(agent.displayName)'s profile")
    }

    private var avatar: some View {
        Text(String(agent.displayName.first.map(String.init) ?? "?").uppercased())
            .font(HudFont.mono(11, weight: .bold))
            .foregroundStyle(HudPalette.bg)
            .frame(width: 30, height: 30)
            .background(Circle().fill(HudPalette.muted))
            .overlay(alignment: .bottomTrailing) {
                Circle()
                    .fill(agent.state.tint)
                    .frame(width: 9, height: 9)
                    .overlay(Circle().stroke(HudPalette.surface, lineWidth: 2))
            }
    }

    private var runtime: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            ScoutEyebrow(text: "Runtime")
            HudKVRow("Role", value: agent.roleLabel)
            HudKVRow("Harness", value: agent.harness?.nilIfEmpty ?? "—")
            HudKVRow("Transport", value: agent.transport?.nilIfEmpty ?? "—")
            ScoutAgentModelRow(agent: agent)
            HudKVRow("Node", value: agent.nodeName?.nilIfEmpty ?? "—")
        }
    }

    private var workspace: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            ScoutEyebrow(text: "Workspace")
            HudKVRow("Branch", value: agent.branchLabel)
            HudKVRow("Path", value: agent.workspace)
            if let selectedChannel {
                HudKVRow("cId", value: selectedChannel.cIdShort)
            }
        }
    }

    /// Live session block — the only home for Observe. The label and Observe
    /// share the top line; the session's real id and last-activity sit below.
    private var sessionSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            HStack(alignment: .center, spacing: HudSpacing.sm) {
                ScoutEyebrow(text: "Session")
                Spacer(minLength: HudSpacing.sm)
                ScoutObserveChip(action: openObserve)
            }
            if let sessionId {
                HudKVRow("id", value: Self.shortSession(sessionId))
            }
            HudKVRow("Active", value: agent.updatedLabel)
        }
    }

    /// Real session ids are opaque (UUID-ish); show head + tail like the tail
    /// view does, so it reads as an id rather than a relay label.
    private static func shortSession(_ id: String) -> String {
        let trimmed = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count > 14 else { return trimmed }
        return "\(trimmed.prefix(8))…\(trimmed.suffix(4))"
    }

    private var skills: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            ScoutEyebrow(text: "Skills")
            ScoutAgentAbilityList(capabilities: specialCapabilities)
        }
    }
}

/// Quiet-but-clearly-clickable Observe chip. At rest it reads as a button
/// (hairline border + faint inset), warming to observe-green on hover —
/// present without out-shouting the agent identity above it.
private struct ScoutObserveChip: View {
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: HudSpacing.xs) {
                Image(systemName: "eye")
                    .font(HudFont.ui(10, weight: .semibold))
                Text("OBSERVE")
                    .font(HudFont.mono(9, weight: .semibold))
            }
            .foregroundStyle(hovering ? HudPalette.statusOk : HudPalette.muted)
            .padding(.horizontal, HudSpacing.sm)
            .padding(.vertical, 4)
            .background(
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(hovering ? HudPalette.statusOk.opacity(0.12) : HudSurface.inset)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .stroke(hovering ? HudPalette.statusOk.opacity(0.5) : Color.white.opacity(0.22), lineWidth: HudStrokeWidth.thin)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .onHover { hovering = $0 }
        .help("Observe")
    }
}

/// Unemphasized "New session" link — muted at rest, accent on hover, since
/// continuing a conversation is already the default action in the sidebar.
private struct ScoutNewSessionLink: View {
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: HudSpacing.xs) {
                Image(systemName: "plus")
                    .font(HudFont.ui(9, weight: .bold))
                Text("NEW SESSION")
                    .font(HudFont.mono(10, weight: .semibold))
            }
            .foregroundStyle(hovering ? HudPalette.accent : HudPalette.muted)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .onHover { hovering = $0 }
    }
}

/// Lays out every agent in a DM as its own card — side by side when the column
/// is wide enough, otherwise stacked.
private struct ScoutAgentCardStack: View {
    let agents: [ScoutAgent]
    let selectedChannel: ScoutChannel?
    let openObserve: (ScoutAgent) -> Void
    let openProfile: (ScoutAgent) -> Void
    let startSession: (ScoutAgent) -> Void

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: HudSpacing.lg) {
                ForEach(agents) { agent in
                    card(for: agent)
                        .frame(minWidth: 230, maxWidth: .infinity, alignment: .top)
                }
            }
            VStack(spacing: HudSpacing.lg) {
                ForEach(agents) { agent in
                    card(for: agent)
                }
            }
        }
    }

    private func card(for agent: ScoutAgent) -> some View {
        ScoutAgentInspector(
            agent: agent,
            selectedChannel: selectedChannel,
            openObserve: { openObserve(agent) },
            openProfile: { openProfile(agent) },
            startSession: { _ in startSession(agent) }
        )
    }
}

private struct ScoutAgentPreviewPanel: View {
    let agent: ScoutAgent
    let selectedChannel: ScoutChannel?
    let onClose: () -> Void
    let openObserve: () -> Void
    let openProfile: () -> Void
    let startSession: (ScoutSessionDraft.Mode) -> Void

    var body: some View {
        VStack(spacing: 0) {
            header
            HudDivider(color: ScoutDesign.hairline)

            ScrollView {
                ScoutAgentInspector(
                    agent: agent,
                    selectedChannel: selectedChannel,
                    openObserve: openObserve,
                    openProfile: openProfile,
                    startSession: startSession
                )
                .padding(HudSpacing.xl)
                .frame(maxWidth: .infinity, alignment: .leading)
                .scoutOverlayScrollers()
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
        ScoutColumnHeader(horizontalPadding: HudSpacing.lg) {
            HStack(spacing: HudSpacing.md) {
                Image(systemName: "person.crop.circle")
                    .font(HudFont.ui(12, weight: .semibold))
                    .foregroundStyle(HudPalette.accent)
                    .frame(width: 22, height: 22)
                    .background(RoundedRectangle(cornerRadius: 5, style: .continuous).fill(HudPalette.accentSoft))
                HudSectionLabel("Agent")
            }
        } secondary: {
            Text(agent.displayName)
                .font(HudFont.ui(13, weight: .semibold))
                .foregroundStyle(HudPalette.ink)
                .lineLimit(1)
                .truncationMode(.tail)
        } trailing: {
            Button(action: onClose) {
                Image(systemName: "sidebar.right")
                    .font(HudFont.ui(12, weight: .semibold))
            }
            .buttonStyle(.plain).scoutPointerCursor()
            .foregroundStyle(HudPalette.muted)
            .frame(width: 28, height: 28)
            .contentShape(Rectangle())
            .help("Close agent preview")
        }
        .background(ScoutDesign.chrome)
    }
}

private struct ScoutAgentModelRow: View {
    let agent: ScoutAgent

    var body: some View {
        // An unset model is conveyed by the muted "Default" value alone; the
        // "why" lives in a tooltip rather than a wrapping sentence that ate two
        // lines of the card.
        HudKVRow(
            "Model",
            value: agent.modelDisplayValue,
            valueColor: agent.model?.nilIfEmpty == nil ? HudPalette.muted : HudPalette.ink
        )
        .help(agent.modelDisplayNote ?? agent.modelDisplayValue)
    }
}

private struct ScoutAgentAbilityList: View {
    let capabilities: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            ForEach(abilities, id: \.id) { ability in
                ScoutAgentAbilityRow(ability: ability)
            }
        }
    }

    private var abilities: [ScoutAgentAbility] {
        capabilities
            .map(ScoutAgentAbility.init(rawValue:))
            .sorted { left, right in
                if left.rank != right.rank { return left.rank < right.rank }
                return left.title < right.title
            }
    }
}

private struct ScoutAgentAbilityRow: View {
    let ability: ScoutAgentAbility

    var body: some View {
        HStack(alignment: .top, spacing: HudSpacing.md) {
            Image(systemName: ability.icon)
                .font(HudFont.ui(11, weight: .medium))
                .foregroundStyle(HudPalette.muted)
                .frame(width: 22, height: 22)
                .background(RoundedRectangle(cornerRadius: 5, style: .continuous).fill(HudPalette.surface))
                .overlay(
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin)
                )

            VStack(alignment: .leading, spacing: 2) {
                Text(ability.title)
                    .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                    .foregroundStyle(HudPalette.ink)
                Text(ability.detail)
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(HudPalette.dim)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(ability.title), \(ability.detail)")
    }
}

private struct ScoutAgentAbility {
    let rawValue: String

    var id: String { rawValue }

    var normalized: String {
        rawValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    var rank: Int {
        switch normalized {
        case "chat": return 10
        case "invoke": return 20
        case "deliver": return 30
        case "observe": return 40
        default: return 100
        }
    }

    var title: String {
        switch normalized {
        case "chat": return "Conversation"
        case "invoke": return "Work requests"
        case "deliver": return "Result delivery"
        case "observe": return "Live observe"
        default: return rawValue.agentMetadataTitle
        }
    }

    var detail: String {
        switch normalized {
        case "chat":
            return "Can exchange Scout messages with the operator."
        case "invoke":
            return "Can accept owned asks and run delegated work."
        case "deliver":
            return "Can report completion, status, or artifacts back."
        case "observe":
            return "Can expose live session context when available."
        default:
            return "Advertised by the agent registration."
        }
    }

    var icon: String {
        switch normalized {
        case "chat": return "bubble.left.and.bubble.right"
        case "invoke": return "play.circle"
        case "deliver": return "arrow.down.doc"
        case "observe": return "eye"
        default: return "checkmark.seal"
        }
    }
}

private struct ScoutResizableInspectorPanel<Header: View, Content: View>: View {
    let header: Header
    let content: Content

    @Environment(\.hudTheme) private var theme

    init(
        @ViewBuilder header: () -> Header,
        @ViewBuilder content: () -> Content
    ) {
        self.header = header()
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            headerBar
            HudDivider(color: theme.hairline.standard)

            ScrollView {
                VStack(alignment: .leading, spacing: HudSpacing.xl) {
                    content
                }
                .padding(HudSpacing.xl)
                .frame(maxWidth: .infinity, alignment: .leading)
                .scoutOverlayScrollers()
            }
            .scrollIndicators(.visible)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var headerBar: some View {
        ScoutColumnHeader(horizontalPadding: HudSpacing.lg) {
            header
                .frame(maxWidth: .infinity, alignment: .leading)
        } secondary: {
            EmptyView()
        } trailing: {
            EmptyView()
        }
    }
}

private struct ScoutChannelInspector: View {
    let channel: ScoutChannel

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xl) {
            HudCard {
                VStack(alignment: .leading, spacing: HudSpacing.md) {
                    HudSectionLabel(channel.scope == .direct ? "Direct message" : "Channel")
                    Text(channel.displayHandle)
                        .font(HudFont.ui(18, weight: .semibold))
                        .foregroundStyle(HudPalette.ink)
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
