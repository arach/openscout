import HudsonShell
import HudsonUI
import ScoutNativeCore
import ScoutSharedUI
import SwiftUI
#if os(macOS)
import AppKit
import UniformTypeIdentifiers
#endif

/// Non-publishing owner for the high-churn tail feed. It never fires
/// `objectWillChange`, so a view holding it as `@StateObject` is NOT invalidated
    /// when `tail` publishes — only views that observe `tail` directly re-render.
    /// The root also starts the tail poller only when a visible surface needs it,
    /// so the full event stream is live where it belongs instead of becoming a
    /// window-lifetime idle cost.
@MainActor
final class ScoutFeeds: ObservableObject {
    let tail = ScoutTailStore()
}

struct ScoutRootView: View {
    @StateObject private var store = ScoutCommsStore()
    /// Tail is reached through `feeds` (a non-publishing box) instead of being
    /// observed directly, so its frequent updates only re-render the leaf views
    /// that read it (status-bar count, tail inspector, Live/Paused badge) rather
    /// than the entire window. Repos is started only by the Repos surface.
    @StateObject private var feeds = ScoutFeeds()
    private var tail: ScoutTailStore { feeds.tail }
    @StateObject private var repos = ScoutRepoStore()
    @ObservedObject private var voice = ScoutVoiceService.shared
    @State private var section: ScoutSection = .comms
    @AppStorage("scout.navigationSidebar.compact") private var railCompact = false
    @AppStorage("scout.inspector.collapsed") private var inspectorCollapsed = false
    @State private var agentContentMode: ScoutAgentContentMode = .roster
    @State private var agentsFilterQuery = ""
    @State private var agentsLiveOnly = false
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
    @State private var showDesignPreview = false
    /// Native appearance settings (sidebar gear) — window transparency, and
    /// theme/tokens as they come online. Replaces the old web `/settings` jump.
    @State private var showSettings = false
    @ObservedObject private var appearance = ScoutAppearance.shared
    @AppStorage("scout.navigationSidebar.labelWidth.v2") private var navigationSidebarLabelWidth = 88.0
    @AppStorage("scout.conversationList.width.v2") private var conversationListWidth = 224.0
    @AppStorage("scout.inspector.width") private var inspectorWidth = 320.0
    @AppStorage("scout.observeSidecar.width") private var observeSidecarWidth = Double(ScoutObserveSidecarMetrics.defaultWidth)
    @AppStorage("scout.fileViewer.width") private var fileViewerWidth = Double(ScoutFileViewerMetrics.defaultWidth)

    /// Expansion + selection for the Agents project·agent·session tree. The
    /// window-level keyboard chords drive it; selection is mirrored into
    /// `store.selectedAgentId` so the inspector follows.
    @StateObject private var agentsTree = ScoutAgentsTreeModel()

    /// Expansion + selection for the Repos repo·worktree tree. Same chords; the
    /// inspector reads its selection directly.
    @StateObject private var reposTree = ScoutReposTreeModel()

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
                        .font(HudFont.mono(HudTextSize.base, weight: .bold))
                        .foregroundStyle(ScoutPalette.bg)
                        .frame(width: 24, height: 24)
                        .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(manifest.accent))
                },
                labelHeader: {
                    Text("Scout")
                        .font(HudFont.ui(HudTextSize.base, weight: .semibold))
                        .foregroundStyle(ScoutPalette.ink)
                        .lineLimit(1)
                },
                footer: {
                    ScoutSidebarSettingsButton(
                        isCompact: railCompact,
                        labelWidth: CGFloat(navigationSidebarLabelWidth)
                    ) {
                        showSettings = true
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
        .sheet(isPresented: $showSettings) {
            ScoutSettingsView(appearance: appearance, onClose: { showSettings = false })
        }
        .background(ScoutWindowConfigurator(opacity: appearance.windowOpacity, themeMode: appearance.themeMode))
        .onAppear {
            store.start()
            syncScopedStoreLifecycles()
        }
        .onDisappear {
            store.stop()
            tail.stop()
            repos.stop()
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
        .onChange(of: section) { _, _ in
            syncScopedStoreLifecycles()
        }
        .onChange(of: inspectorCollapsed) { _, _ in
            syncScopedStoreLifecycles()
        }
        .onChange(of: store.selectedCId) { _, _ in
            syncScopedStoreLifecycles()
        }
        .onChange(of: store.selectedAgentId) { _, _ in
            syncScopedStoreLifecycles()
        }
        .onChange(of: store.workingAgentCount) { _, _ in
            syncScopedStoreLifecycles()
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
            if showDesignPreview {
                ScoutDesignPreviewPanel()
                    .padding(HudSpacing.xl)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .overlay {
            if showCheatsheet {
                ScoutKeyboardCheatsheet(section: section) { showCheatsheet = false }
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.12), value: showCheatsheet)
        .onReceive(NotificationCenter.default.publisher(for: .scoutAppCommand)) { notification in
            guard let command = ScoutAppCommand(notification: notification) else { return }
            handleAppCommand(command)
        }
        .background(
            ScoutKeyboardEventMonitor(isActive: true, handler: handleKeyboardEvent)
                .frame(width: 0, height: 0)
                .accessibilityHidden(true)
        )
    }

    private func syncScopedStoreLifecycles() {
        if tailShouldPoll {
            tail.start()
        } else {
            tail.stop()
        }

        if section == .repos {
            repos.start()
        } else {
            repos.stop()
        }
    }

    private var tailShouldPoll: Bool {
        if section == .tail { return true }
        guard section == .comms, !inspectorCollapsed, let agent = store.selectedAgent else {
            return false
        }
        return agent.state == .working || agent.state == .needsAttention
    }

    private func handleAppCommand(_ command: ScoutAppCommand) {
        guard !modalPresented else { return }
        switch command {
        case .moveDown:
            moveSelection(1)
        case .moveUp:
            moveSelection(-1)
        case .focusSearch:
            focusSearch()
        case .focusComposer:
            focusComposer()
        case .refresh:
            store.refresh(force: true)
        case .filterAll:
            channelFilter = .all
        case .filterDirect:
            channelFilter = .direct
        case .filterShared:
            channelFilter = .shared
        case .observeSelectedAgent:
            observeSelectedAgent()
        case .openSelectedAgentChannel:
            openSelectedAgentChannel()
        case .toggleCheatsheet:
            showCheatsheet.toggle()
        case .toggleDesignPreview:
            showDesignPreview.toggle()
        }
    }

    private func handleKeyboardEvent(_ event: NSEvent) -> Bool {
        if showCheatsheet, event.keyCode == 53 {
            showCheatsheet = false
            return true
        }
        guard !modalPresented, bareKeysAvailable else { return false }
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        let disallowed: NSEvent.ModifierFlags = [.command, .control, .option, .function]
        guard flags.intersection(disallowed).isEmpty else { return false }
        let hasShift = flags.contains(.shift)
        let key = event.charactersIgnoringModifiers?.lowercased()

        if event.characters == "?" || (hasShift && key == "/") {
            showCheatsheet.toggle()
            return true
        }
        guard let key else { return false }
        if hasShift {
            guard key == "g" else { return false }
            moveSelectionToEdge(last: true)
            return true
        }
        switch key {
        case "j":
            moveSelection(1)
        case "k":
            moveSelection(-1)
        case "l":
            moveRight()
        case "h":
            moveLeft()
        case "g":
            moveSelectionToEdge(last: false)
        default:
            return false
        }
        return true
    }

    /// A modal overlay is up and should own the keyboard.
    private var modalPresented: Bool {
        sessionDraft != nil || previewImage != nil || showSettings
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
            treeMove(delta)
        case .repos:
            reposTreeMove(delta)
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
            treeEdge(last: last)
        case .repos:
            reposTreeEdge(last: last)
        case .tail:
            break
        }
    }

    // MARK: Agents tree navigation

    private var treeGroups: [ScoutAgentsTreeModel.ProjectGroup] {
        ScoutAgentsTreeModel.groups(agents: filteredTreeAgents, channels: store.channels)
    }

    /// Roster narrowed by the pane's All/Live scope and filter field.
    private var filteredTreeAgents: [ScoutAgent] {
        var agents = store.agents
        if agentsLiveOnly {
            agents = agents.filter { $0.state == .working || $0.state == .needsAttention }
        }
        let query = agentsFilterQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return agents }
        return agents.filter { agent in
            agent.displayName.lowercased().contains(query)
                || agent.detail.lowercased().contains(query)
                || (agent.project ?? "").lowercased().contains(query)
                || agent.workspace.lowercased().contains(query)
        }
    }

    /// Mirror the tree's selection into the store so the inspector follows.
    private func pushTreeSelection() {
        if let agentId = agentsTree.selectedAgentID { store.selectAgent(agentId) }
    }

    private func treeMove(_ delta: Int) {
        agentsTree.move(delta, groups: treeGroups)
        pushTreeSelection()
    }

    private func treeEdge(last: Bool) {
        agentsTree.moveToEdge(last: last, groups: treeGroups)
        pushTreeSelection()
    }

    // MARK: Repos tree navigation

    private func reposTreeMove(_ delta: Int) {
        reposTree.move(delta, projects: repos.projects, showClean: repos.showCleanIdle)
    }

    private func reposTreeEdge(last: Bool) {
        reposTree.moveToEdge(last: last, projects: repos.projects, showClean: repos.showCleanIdle)
    }

    /// `l` / →  — expand a collapsed node, else descend.
    private func moveRight() {
        switch section {
        case .agents:
            withAnimation(.easeOut(duration: 0.16)) { agentsTree.expandOrDescend(groups: treeGroups) }
            pushTreeSelection()
        case .repos:
            withAnimation(.easeOut(duration: 0.16)) {
                reposTree.expandOrDescend(projects: repos.projects, showClean: repos.showCleanIdle)
            }
        default:
            moveSelection(1)
        }
    }

    /// `h` / ←  — collapse an expanded node, else step to the parent.
    private func moveLeft() {
        switch section {
        case .agents:
            withAnimation(.easeOut(duration: 0.16)) { agentsTree.collapseOrParent(groups: treeGroups) }
            pushTreeSelection()
        case .repos:
            withAnimation(.easeOut(duration: 0.16)) {
                reposTree.collapseOrParent(projects: repos.projects, showClean: repos.showCleanIdle)
            }
        default:
            moveSelection(-1)
        }
    }

    private func focusSearch() {
        guard section == .comms || section == .agents else { return }
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

    /// Jump into the selected row's conversation (⌘↩, Agents page) — the focused
    /// session if a session row is selected, else the agent's channel.
    private func openSelectedAgentChannel() {
        if section == .repos {
            revealSelectedRepoInFinder()
            return
        }
        guard section == .agents else { return }
        if let cId = agentsTree.selectedSessionCId {
            store.selectChannel(cId)
            section = .comms
            return
        }
        guard let agent = store.selectedAgent else { return }
        store.openAgentChannel(agent)
        section = .comms
    }

    /// ⌘↩ / double-click on the Repos page — reveal the focused worktree (or
    /// project root) in Finder.
    private func revealSelectedRepoInFinder() {
        let path: String?
        if let worktree = repos.worktree(id: reposTree.selectedWorktreeID) {
            path = worktree.path
        } else if let project = repos.project(id: reposTree.selectedProjectID) {
            path = project.root
        } else {
            path = nil
        }
        guard let path, !path.isEmpty else { return }
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
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
            .item(HudSidebarItem(id: .repos, title: "Repos", icon: "arrow.triangle.branch", selectedIcon: "arrow.triangle.branch")),
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
        case .repos:
            reposContent
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
                newChannelIds: store.newChannelIds,
                hasActivity: store.workingAgentCount > 0,
                width: conversationListResizePreviewWidth ?? CGFloat(conversationListWidth),
                searchFocused: $searchFocused,
                onNewConversation: { startNewConversation() },
                onRefresh: { store.refresh(force: true) }
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
                .font(HudFont.ui(HudTextSize.xl, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
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
                    ScoutWaveform(tint: isDictationProcessing ? ScoutPalette.muted : ScoutPalette.accent)
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
            .onChange(of: voice.state) { _, newState in
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
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutPalette.dim)
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
                        ScoutPalette.accent.opacity(composerFocused ? 0.055 : 0.018),
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
                .fill(composerFocused ? ScoutPalette.accent.opacity(0.42) : ScoutDesign.hairlineStrong)
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
            // Snap to whole points and skip no-op writes. The measured frame can
            // ping-pong by sub-points while the multiline TextField settles its
            // intrinsic height; since this value flows back into layout, an
            // unguarded assignment becomes a self-sustaining relayout loop
            // (preference → state → relayout → preference …) that pins the CPU.
            let snapped = CGRect(
                x: frame.origin.x.rounded(),
                y: frame.origin.y.rounded(),
                width: frame.size.width.rounded(),
                height: frame.size.height.rounded()
            )
            if snapped != composerInputFrame {
                composerInputFrame = snapped
            }
        }
        .animation(.easeOut(duration: 0.12), value: suggestions.count)
        .onChange(of: draft) { _, _ in refreshSuggestions() }
        .onChange(of: store.agents.count) { _, _ in refreshSuggestions() }
        .onReceive(voice.$lastFinalText) { spliceDictatedFinal($0) }
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
                    .font(HudFont.mono(HudTextSize.xs))
                    .foregroundStyle(ScoutPalette.ink)
                    // Accent caret to match the HUD (not the system blue), and
                    // hidden while dictating so the waveform is the only cue.
                    .tint(showDictationPreview ? Color.clear : ScoutPalette.accent)
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
                    ScoutDictationPreview(text: voice.partial)
                        .allowsHitTesting(false)
                }
            }
            .padding(.top, HudSpacing.sm)
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
            color: composerFocused ? ScoutPalette.accent.opacity(0.12) : Color.black.opacity(0.22),
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
                .font(.system(size: HudTextSize.lgm, weight: .medium))
                .foregroundStyle(ScoutPalette.muted)
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
            .padding(.vertical, HudSpacing.xxs)
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
                        .foregroundStyle(ScoutPalette.muted)
                }
            }
            .frame(width: 52, height: 52)
            .clipShape(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                    .stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
            )
            .contentShape(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous))
            .onTapGesture { previewImage = image }
            .help("Click to preview")

            Button {
                pendingImages.removeAll { $0.id == image.id }
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: HudTextSize.md))
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
        return composerFocused ? HudSurface.tintBorder(ScoutPalette.accent) : ScoutDesign.hairlineStrong
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
        if isDictating { return voiceStatusLine }
        if let reason = voiceUnavailableReason { return reason }
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
        draft.isEmpty && (voice.state.isCaptureActive || voice.state.isProcessing)
    }

    private var isDictating: Bool {
        switch voice.state {
        case .starting, .recording, .processing: return true
        default: return false
        }
    }

    private var isDictationProcessing: Bool {
        if case .processing = voice.state { return true }
        return false
    }

    private var voiceStatusLine: String {
        if !voice.partial.isEmpty { return voice.partial }
        switch voice.state {
        case .starting: return "Starting voice..."
        case .processing: return "Transcribing..."
        default: return "Listening..."
        }
    }

    private var voiceUnavailableReason: String? {
        if case .unavailable(let reason) = voice.state { return reason }
        return nil
    }

    /// Send entry point. While dictating, commit the recording first and let
    /// the dictation→idle transition fire the actual send once the transcript
    /// has landed — so one tap finishes transcription and sends in one shot.
    private func requestSend() {
        if isDictating {
            guard composerReady else { return }
            pendingSendAfterDictation = true
            voice.stop()
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
            switch ScoutDictationController.toggleDecision(for: voice.state) {
            case .probeThenStartIfIdle:
                await voice.probe()
                if case .idle = voice.state { voice.start() }
            case .start:
                voice.start()
            case .stop:
                voice.stop()
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
        ScoutVoiceService.shared.consumeFinalText()
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
                // Complaint #1: the tree no longer drops straight onto the page
                // background. It lives in a contained pane that mirrors the Comms
                // list-bar idiom — header → controls → column header → surface —
                // so Agents reads as a deliberate, structured panel.
                VStack(spacing: 0) {
                    agentsPaneHeader
                    HudDivider(color: ScoutDesign.hairline)
                    agentsPaneControls
                    HudDivider(color: ScoutDesign.hairline)
                    agentsColumnHeader
                    HudDivider(color: ScoutDesign.hairline)
                    if treeGroups.isEmpty {
                        agentsPaneEmptyState
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else {
                        ScrollViewReader { proxy in
                            ScrollView {
                                ScoutAgentsTree(
                                    model: agentsTree,
                                    groups: treeGroups,
                                    onSelect: { pushTreeSelection() },
                                    onActivate: { openSelectedAgentChannel() },
                                    onObserve: { observeAgent($0) },
                                    onOpenDM: { agent in
                                        store.openAgentChannel(agent)
                                        section = .comms
                                    }
                                )
                                .frame(maxWidth: .infinity, alignment: .topLeading)
                            }
                            // Keep the keyboard-selected row in view, but only scroll the
                            // minimum needed (no anchor → no constant re-centering), so
                            // moves inside the viewport don't shift the list at all.
                            .onChange(of: agentsTree.selectedID) { _, id in
                                guard let id else { return }
                                withAnimation(.easeOut(duration: 0.1)) {
                                    proxy.scrollTo(id)
                                }
                            }
                            // Follow selection arriving from elsewhere (e.g. Comms).
                            .onChange(of: store.selectedAgentId) { _, id in
                                agentsTree.syncToAgent(id, groups: treeGroups)
                            }
                            .onAppear {
                                agentsTree.ensureSelection(groups: treeGroups, fallbackAgentID: store.selectedAgentId)
                                pushTreeSelection()
                            }
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(ScoutDesign.chrome)
            }
        }
        .background(ScoutDesign.bg)
    }

    // MARK: Agents pane chrome (container for the tree)

    /// Title + live/total census. Mirrors ScoutConversationListBar.header.
    private var agentsPaneHeader: some View {
        let live = store.agents.filter { $0.state == .working || $0.state == .needsAttention }.count
        let total = store.agents.count
        return HStack(spacing: HudSpacing.md) {
            Text("Agents")
                .font(HudFont.ui(HudTextSize.base, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
                .lineLimit(1)
            if store.isLoading {
                ProgressView().controlSize(.small)
            }
            Spacer(minLength: 0)
            if live > 0 {
                HudBadge("\(live) live", tint: ScoutPalette.accent, dot: true)
            }
            HudBadge("\(total) agent\(total == 1 ? "" : "s")", tint: ScoutPalette.muted, dot: false)
        }
        .padding(.horizontal, HudSpacing.xxl)
        .frame(height: 42, alignment: .center)
    }

    /// Filter field + All/Live scope + fold controls. Mirrors the Comms
    /// controls strip; the filter binds the shared `searchFocused` so the bare
    /// j/k chords stay dead while typing.
    private var agentsPaneControls: some View {
        HStack(spacing: HudSpacing.md) {
            HudField("Filter agents", text: $agentsFilterQuery, icon: "magnifyingglass")
                .focused($searchFocused)
            ScoutAgentScopeControl(liveOnly: $agentsLiveOnly)
            Spacer(minLength: HudSpacing.md)
            agentsFoldButton(title: "Expand", icon: "chevron.down") {
                agentsTree.collapsedProjects.removeAll()
            }
            agentsFoldButton(title: "Collapse", icon: "chevron.right") {
                for group in treeGroups { agentsTree.collapsedProjects.insert(group.key) }
            }
        }
        .padding(.horizontal, HudSpacing.xxl)
        .padding(.top, HudSpacing.md)
        .padding(.bottom, HudSpacing.lg)
    }

    private func agentsFoldButton(title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: HudSpacing.xs) {
                Image(systemName: icon)
                    .font(HudFont.ui(HudTextSize.xxs, weight: .semibold))
                Text(title)
                    .font(HudFont.ui(HudTextSize.xs, weight: .medium))
            }
            .foregroundStyle(ScoutPalette.muted)
            .padding(.horizontal, HudSpacing.sm)
            .padding(.vertical, HudSpacing.xs)
            .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(HudSurface.inset))
            .overlay(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .help("\(title) all projects")
    }

    /// Non-scrolling column header. Complaint #2: the trailing STATE / UPDATED
    /// columns are now labeled, turning the old "pointless" right gap into a
    /// real table. Padding + column widths match the tree rows so they align.
    private var agentsColumnHeader: some View {
        HStack(spacing: HudSpacing.sm) {
            Text("AGENT")
                .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                .tracking(0.8)
                .foregroundStyle(ScoutPalette.dim)
            Spacer(minLength: HudSpacing.sm)
            Text("STATE")
                .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                .tracking(0.8)
                .foregroundStyle(ScoutPalette.dim)
                .frame(width: ScoutDesign.agentsStateColumnWidth, alignment: .trailing)
            Text("UPDATED")
                .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                .tracking(0.8)
                .foregroundStyle(ScoutPalette.dim)
                .frame(width: ScoutDesign.agentsUpdatedColumnWidth, alignment: .trailing)
        }
        .padding(.leading, 10)
        .padding(.trailing, HudSpacing.lg)
        .padding(.vertical, HudSpacing.xs)
    }

    /// Shown inside the pane when the roster is empty or the filter/scope
    /// matches nothing — so the contained surface never goes blank.
    private var agentsPaneEmptyState: some View {
        let filtering = !agentsFilterQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || agentsLiveOnly
        return HudEmptyState(
            title: filtering ? "No agents match" : "No agents yet",
            subtitle: filtering
                ? "Clear the filter or switch back to All."
                : "Agents connected to this broker will appear here.",
            icon: "person.2"
        )
    }

    private var tailContent: some View {
        ScoutTailContent(tail: tail)
    }

    private var reposContent: some View {
        ScoutReposContent(repos: repos, tree: reposTree, onActivate: { revealSelectedRepoInFinder() })
    }

    private var inspectorHeader: some View {
        let multiAgent = section == .comms && channelAgentMembers.count >= 2
        return HStack(spacing: HudSpacing.md) {
            HudSectionLabel(inspectorTitle(multiAgent: multiAgent))
            Spacer()
            inspectorHeaderBadge(multiAgent: multiAgent)
        }
    }

    private func inspectorTitle(multiAgent: Bool) -> String {
        switch section {
        case .tail:
            return "Tail"
        case .repos:
            if repos.worktree(id: reposTree.selectedWorktreeID) != nil { return "Worktree" }
            if repos.project(id: reposTree.selectedProjectID) != nil { return "Repo" }
            return "Context"
        default:
            return multiAgent ? "Agents" : (store.selectedAgent == nil ? "Context" : "Agent")
        }
    }

    @ViewBuilder
    private func inspectorHeaderBadge(multiAgent: Bool) -> some View {
        if section == .tail {
            ScoutTailFollowBadge(tail: tail)
        } else if section == .repos {
            // No verdict pill for a worktree — the inspector's Position block
            // carries current state calmly. Keep a project-level attention
            // summary, which reads as a roll-up rather than a per-branch verdict.
            if repos.worktree(id: reposTree.selectedWorktreeID) == nil,
               let project = repos.project(id: reposTree.selectedProjectID) {
                HudBadge(project.attention.rawValue, tint: reposAttentionColor(project.attention), dot: reposAttentionLive(project.attention))
            }
        } else if !multiAgent, let agent = store.selectedAgent {
            HudBadge(agent.state.label, tint: agent.state.tint, dot: true)
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
                    agentChannels: agentChannels(for: agent),
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
                    openConversation: {
                        store.openAgentChannel(agent)
                        section = .comms
                    },
                    openSession: { channel in
                        store.selectChannel(channel.cId)
                        section = .comms
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

    /// Conversations attached to an agent, most-recent first — feeds the
    /// inspector's Sessions list.
    private func agentChannels(for agent: ScoutAgent) -> [ScoutChannel] {
        store.channels
            .filter { $0.agentId == agent.id }
            .sorted { ($0.lastMessageAt ?? 0) > ($1.lastMessageAt ?? 0) }
    }

    /// Tail events scoped to one agent: by bound session id first, falling back
    /// to the agent's working directory + harness when no session id matches.
    private func scopedTail(for agent: ScoutAgent, limit: Int = 4) -> [ScoutTailEvent] {
        let events = tail.events
        if let sid = agent.harnessSessionId?.nilIfEmpty {
            let bySession = events.filter { $0.sessionId == sid }
            if !bySession.isEmpty { return Array(bySession.suffix(limit)) }
        }
        if let target = (agent.cwd ?? agent.projectRoot)?.nilIfEmpty {
            let byCwd = events.filter {
                !$0.cwd.isEmpty && $0.cwd == target
                    && (agent.harness == nil || $0.harness.isEmpty || $0.harness == agent.harness)
            }
            return Array(byCwd.suffix(limit))
        }
        return []
    }

    /// The live-activity bundle for the Comms inspector: observe payload (slot-
    /// guarded to this agent, like the Observe pane) + agent-scoped tail.
    private func livePreview(for agent: ScoutAgent) -> ScoutAgentLivePreview {
        ScoutAgentLivePreview(
            observePayload: store.observeAgentId == agent.id ? store.observePayload : nil,
            isObserveLoading: store.observeAgentId == agent.id && store.isObserveLoading,
            observeError: store.observeAgentId == agent.id ? store.observeError : nil,
            tailEvents: scopedTail(for: agent)
        )
    }

    @ViewBuilder
    private var inspectorContent: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xl) {
            if section == .tail {
                ScoutTailInspector(tail: tail)
            } else if section == .repos {
                ScoutReposInspector(repos: repos, tree: reposTree)
            } else {
                if section == .agents {
                    if let agent = store.selectedAgent {
                        ScoutAgentInspector(
                            agent: agent,
                            selectedChannel: store.selectedChannel,
                            agentChannels: agentChannels(for: agent),
                            openObserve: { observeAgent(agent) },
                            openProfile: { ScoutWeb.open(path: "/agents/\(agent.id)?tab=profile") },
                            openConversation: { store.openAgentChannel(agent); section = .comms },
                            openSession: { channel in store.selectChannel(channel.cId); section = .comms },
                            startSession: { mode in startSessionWithAgent(agent, mode: mode) },
                            livePreview: nil,
                            openTail: nil
                        )
                    } else {
                        HudEmptyState(title: "Nothing selected", subtitle: "Select an agent to inspect context.", icon: "sidebar.right")
                    }
                } else if channelAgentMembers.count >= 2 {
                    ScoutAgentCardStack(
                        agents: channelAgentMembers,
                        selectedChannel: store.selectedChannel,
                        channelsFor: { agentChannels(for: $0) },
                        openObserve: { observeAgent($0) },
                        openProfile: { ScoutWeb.open(path: "/agents/\($0.id)?tab=profile") },
                        openConversation: { store.openAgentChannel($0); section = .comms },
                        openSession: { channel in store.selectChannel(channel.cId); section = .comms },
                        startSession: { agent in startSessionWithAgent(agent, mode: .fresh) }
                    )
                } else if let agent = store.selectedAgent {
                    ScoutAgentInspector(
                        agent: agent,
                        selectedChannel: store.selectedChannel,
                        agentChannels: agentChannels(for: agent),
                        openObserve: { observeAgent(agent) },
                        openProfile: { ScoutWeb.open(path: "/agents/\(agent.id)?tab=profile") },
                        openConversation: { store.openAgentChannel(agent); section = .comms },
                        openSession: { channel in store.selectChannel(channel.cId); section = .comms },
                        startSession: { mode in startSessionWithAgent(agent, mode: mode) },
                        livePreview: livePreview(for: agent),
                        openTail: { tail.query = agent.harnessSessionId ?? ""; section = .tail }
                    )
                    .task(id: "\(agent.id)#\(agent.state == .working)") {
                        if agent.state == .working {
                            store.loadObserve(agentId: agent.id, force: true)
                        }
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
            HudStatusDot(color: store.lastError == nil ? ScoutPalette.statusOk : ScoutPalette.statusError)
            Text("SCOUT")
                .font(HudFont.mono(HudTextSize.xxs, weight: .bold))
                .tracking(1.4)
                .foregroundStyle(ScoutPalette.muted)

            Text("·")
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ScoutPalette.dim)

            Text("\(store.channels.count) cIds")
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ScoutPalette.muted)

            Text("·")
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ScoutPalette.dim)

            Text("\(store.agents.count) agents")
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ScoutPalette.muted)

            ScoutTailCountItem(tail: tail)

            Text("·")
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ScoutPalette.dim)

            Text("\(repos.totals.worktrees) trees")
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ScoutPalette.muted)

            if let error = store.lastError {
                Text("·")
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(ScoutPalette.dim)
                Text(error)
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(ScoutPalette.statusError)
                    .lineLimit(1)
            }

            if let error = store.observeError {
                Text("·")
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(ScoutPalette.dim)
                Text(error)
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(ScoutPalette.statusError)
                    .lineLimit(1)
            }

            ScoutTailErrorItem(tail: tail)

            if let error = repos.lastError {
                Text("·")
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(ScoutPalette.dim)
                Text(error)
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(ScoutPalette.statusError)
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
    static let bg = ScoutPalette.bg
    static let chrome = ScoutPalette.chrome
    static let surface = ScoutPalette.surface
    static let hairline = ScoutPalette.hairline
    static let hairlineStrong = ScoutPalette.hairlineStrong
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

    /// Agents-tree trailing columns. The STATE / UPDATED values right-align into
    /// these fixed widths so they line up under the pane's column header
    /// regardless of a row's depth indent.
    static let agentsStateColumnWidth: CGFloat = 104
    static let agentsUpdatedColumnWidth: CGFloat = 48

    static let theme = HudTheme(
        palette: HudThemePalette(
            bg: bg,
            surface: surface,
            chrome: chrome,
            ink: ScoutPalette.ink,
            muted: ScoutPalette.muted,
            dim: ScoutPalette.dim,
            border: hairlineStrong,
            accent: ScoutPalette.accent,
            accentSoft: ScoutPalette.accentSoft,
            statusOk: ScoutPalette.statusOk,
            statusWarn: ScoutPalette.statusWarn,
            statusError: ScoutPalette.statusError,
            statusInfo: ScoutPalette.statusInfo
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
    let newChannelIds: Set<String>
    let hasActivity: Bool
    let width: CGFloat
    let searchFocused: FocusState<Bool>.Binding
    let onNewConversation: () -> Void
    let onRefresh: () -> Void
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
                .font(HudFont.ui(HudTextSize.base, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
                .lineLimit(1)

            ScoutListLiveDot(active: hasActivity)

            Spacer(minLength: 0)

            ScoutListRefreshButton(isLoading: isLoading, action: onRefresh)

            Button(action: onNewConversation) {
                HStack(spacing: HudSpacing.xs) {
                    Image(systemName: "square.and.pencil")
                        .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                    Text("New")
                        .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                }
                .foregroundStyle(ScoutPalette.accent)
                .padding(.horizontal, HudSpacing.md)
                .padding(.vertical, HudSpacing.xs)
                .background(Capsule().fill(HudSurface.tintGhost(ScoutPalette.accent)))
                .overlay(Capsule().stroke(HudSurface.tintBorder(ScoutPalette.accent), lineWidth: HudStrokeWidth.standard))
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
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(ScoutPalette.dim)
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
                            isSelected: selectedCId == channel.cId,
                            isNew: newChannelIds.contains(channel.cId)
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

/// Status-bar tail counter — observes the tail store directly so its ~1.4s
/// updates re-render only this label, not the whole window. (The root reaches
/// tail through a non-publishing box precisely so this stays scoped.)
private struct ScoutTailCountItem: View {
    @ObservedObject var tail: ScoutTailStore
    var body: some View {
        HStack(spacing: HudSpacing.xl) {
            Text("·")
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ScoutPalette.dim)
            Text("\(tail.events.count) tail")
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ScoutPalette.muted)
        }
    }
}

/// Status-bar tail error — isolated so a tail error toggling on/off doesn't
/// relayout the window.
private struct ScoutTailErrorItem: View {
    @ObservedObject var tail: ScoutTailStore
    var body: some View {
        if let error = tail.lastError {
            HStack(spacing: HudSpacing.xl) {
                Text("·")
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(ScoutPalette.dim)
                Text(error)
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(ScoutPalette.statusError)
                    .lineLimit(1)
            }
        }
    }
}

/// The tail inspector's Live/Paused badge — observes the tail store so the
/// follow state flips without the root having to observe tail.
private struct ScoutTailFollowBadge: View {
    @ObservedObject var tail: ScoutTailStore
    var body: some View {
        HudBadge(tail.isFollowing ? "Live" : "Paused", tint: tail.isFollowing ? ScoutPalette.statusOk : ScoutPalette.muted, dot: tail.isFollowing)
    }
}

/// A quiet live pulse beside the Conversations title — breathes only while
/// agents are actively working. No label; the motion is the whole message.
private struct ScoutListLiveDot: View {
    let active: Bool

    var body: some View {
        ZStack {
            if active {
                ScoutListLivePulse()
            } else {
                Circle()
                    .fill(ScoutPalette.statusOk)
                    .frame(width: 6, height: 6)
                    .opacity(0)
            }
        }
        .frame(width: 10, height: 10)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .help("Live — agents working")
    }
}

private struct ScoutListLivePulse: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    var body: some View {
        Circle()
            .fill(ScoutPalette.statusOk)
            .frame(width: 6, height: 6)
            .opacity(reduceMotion ? 0.78 : (pulse ? 0.78 : 0.34))
            .scaleEffect(reduceMotion ? 1.0 : (pulse ? 1.0 : 0.78))
            .shadow(color: ScoutPalette.statusOk.opacity(reduceMotion ? 0.28 : (pulse ? 0.38 : 0.1)), radius: 3)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 1.4).repeatForever(autoreverses: true)) {
                    pulse = true
                }
            }
    }
}

/// Manual refresh for the conversation list. The data refreshes itself every
/// few seconds; this gives a deliberate "I pulled it" gesture — a one-shot
/// spin for tactile reassurance that the list is live.
private struct ScoutListRefreshButton: View {
    let isLoading: Bool
    let action: () -> Void
    @State private var angle: Double = 0
    @State private var hovering = false

    var body: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.7)) { angle += 360 }
            action()
        } label: {
            Image(systemName: "arrow.clockwise")
                .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                .foregroundStyle(hovering ? ScoutPalette.ink : ScoutPalette.muted)
                .rotationEffect(.degrees(angle))
                .frame(width: 24, height: 24)
                .background(Circle().fill(hovering ? HudSurface.hover : Color.clear))
                .contentShape(Circle())
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .onHover { hovering = $0 }
        .help("Refresh conversations")
        .accessibilityLabel("Refresh conversations")
    }
}

/// Compact icon-only scope toggle. Tucked onto the search row rather than
/// taking a full row of its own — the active scope reads from the accent fill;
/// each segment names itself on hover.
private struct ScoutConversationFilterControl: View {
    @Binding var selection: ScoutChannelFilter

    var body: some View {
        HStack(spacing: HudSpacing.xxs) {
            ForEach(ScoutChannelFilter.allCases) { option in
                Button {
                    selection = option
                } label: {
                    Image(systemName: option.icon)
                        .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                        .foregroundStyle(selection == option ? ScoutPalette.ink : ScoutPalette.muted)
                        .frame(width: 30, height: 24)
                        .background(
                            RoundedRectangle(cornerRadius: HudRadius.standard - 2, style: .continuous)
                                .fill(selection == option ? HudSurface.selected(ScoutPalette.accent) : Color.clear)
                        )
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain).scoutPointerCursor()
                .help(option.title)
            }
        }
        .padding(HudSpacing.xxs)
        .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(HudSurface.inset))
        .overlay(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin))
    }
}

/// Two-segment All/Live scope for the Agents pane. Visually matches
/// ScoutConversationFilterControl (inset pill, accent-selected segment).
private struct ScoutAgentScopeControl: View {
    @Binding var liveOnly: Bool

    var body: some View {
        HStack(spacing: HudSpacing.xxs) {
            segment(title: "All", active: !liveOnly) { liveOnly = false }
            segment(title: "Live", active: liveOnly) { liveOnly = true }
        }
        .padding(HudSpacing.xxs)
        .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(HudSurface.inset))
        .overlay(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin))
    }

    private func segment(title: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
                .foregroundStyle(active ? ScoutPalette.ink : ScoutPalette.muted)
                .padding(.horizontal, HudSpacing.sm)
                .frame(height: 24)
                .background(
                    RoundedRectangle(cornerRadius: HudRadius.standard - 2, style: .continuous)
                        .fill(active ? HudSurface.selected(ScoutPalette.accent) : Color.clear)
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .help(title == "Live" ? "Only working / needs-attention agents" : "All agents")
    }
}

private struct ScoutConversationRow: View {
    let channel: ScoutChannel
    let isSelected: Bool
    var isNew: Bool = false
    let action: () -> Void

    @State private var isHovering = false
    /// Fades 1 → 0 to wash a freshly-arrived row with accent, then settle.
    @State private var revealWash: CGFloat = 0
    @AppStorage(ScoutDesignPreview.accents) private var accentsOn = false

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: HudSpacing.md) {
                Image(systemName: channel.scope == .direct ? "person.crop.circle" : "number")
                    .font(HudFont.ui(HudTextSize.base, weight: .semibold))
                    .foregroundStyle(isSelected ? ScoutPalette.accent : ScoutPalette.muted)
                    .frame(width: 20, height: 20)
                    .padding(.top, 1)

                VStack(alignment: .leading, spacing: HudSpacing.xs) {
                    HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
                        Text(channel.rowTitle)
                            .font(HudFont.ui(HudTextSize.base, weight: isSelected ? .semibold : .medium))
                            .foregroundStyle(ScoutPalette.ink)
                            .lineLimit(1)

                        Spacer(minLength: HudSpacing.sm)

                        Text(channel.ageLabel)
                            .font(HudFont.mono(HudTextSize.micro))
                            .foregroundStyle(ScoutPalette.dim)
                            .lineLimit(1)
                    }

                    Text(channel.preview?.nilIfEmpty ?? channel.participantDisplayNames.joined(separator: " + "))
                        .font(HudFont.ui(HudTextSize.xs))
                        .foregroundStyle(ScoutPalette.muted)
                        .lineLimit(2)

                    HStack(spacing: HudSpacing.sm) {
                        Text(channel.cIdShort)
                            .font(HudFont.mono(HudTextSize.micro))
                            .foregroundStyle(ScoutPalette.dim)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        if channel.messageCount > 0 {
                            Text("\(channel.messageCount)")
                                .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                                .foregroundStyle(ScoutPalette.dim)
                        }
                    }
                }
            }
            .padding(.horizontal, HudSpacing.xxl)
            .padding(.vertical, HudSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(rowBackground)
            .background(ScoutPalette.accent.opacity(0.18 * revealWash))
            .overlay(alignment: .leading) {
                if revealWash > 0.01 {
                    Rectangle()
                        .fill(ScoutPalette.accent)
                        .frame(width: 2)
                        .opacity(Double(revealWash))
                }
                if isSelected {
                    ZStack(alignment: .leading) {
                        if accentsOn {
                            // Soft bloom behind the rule so selection feels lit.
                            Rectangle()
                                .fill(ScoutPalette.accent)
                                .frame(width: 3)
                                .blur(radius: 4)
                                .opacity(0.85)
                        }
                        Rectangle()
                            .fill(ScoutPalette.accent)
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
        .onAppear { if isNew { playReveal() } }
        .onChange(of: isNew) { _, now in if now { playReveal() } }
    }

    /// One-shot accent wash + left rule that fades as a row first arrives.
    private func playReveal() {
        revealWash = 1
        withAnimation(.easeOut(duration: 1.5)) { revealWash = 0 }
    }

    private var rowBackground: Color {
        if isSelected {
            return HudSurface.selected(ScoutPalette.accent)
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
                    .font(HudFont.ui(HudTextSize.base, weight: .semibold))
                    .foregroundStyle(isHovering ? ScoutPalette.ink : ScoutPalette.muted)
                    .frame(width: HudSidebarLayout.railWidth, height: 32)

                Text("Settings")
                    .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                    .foregroundStyle(isHovering ? ScoutPalette.ink : ScoutPalette.muted)
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
                .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                .foregroundStyle(ScoutPalette.muted)
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
            .font(HudFont.mono(HudTextSize.micro, weight: .bold))
            .foregroundStyle(ScoutPalette.bg)
            .frame(width: 18, height: 18)
            .background(Circle().fill(memberTint(member.name)))
            .overlay(
                Circle()
                    .stroke(member.agent == nil ? ScoutPalette.bg : ScoutPalette.accent.opacity(0.82), lineWidth: member.agent == nil ? 1.2 : 1.4)
            )
            .contentShape(Circle())
    }

    private func memberTint(_ name: String) -> Color {
        if name.lowercased() == "operator" { return ScoutPalette.accent }
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
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(ScoutPalette.dim)
                }
                ScoutMarkdownView(text: message.body, baseDirectory: baseDirectory)
            }
            .padding(HudSpacing.xxl)
            .frame(maxWidth: 840, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.card)
                    .fill(message.isOperator ? HudSurface.tintGhost(ScoutPalette.accent) : ScoutPalette.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.card)
                    .stroke(message.isOperator ? HudSurface.tintBorder(ScoutPalette.accent) : HudHairline.standard, lineWidth: HudStrokeWidth.standard)
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
                .font(HudFont.mono(HudTextSize.micro, weight: .bold))
            if agent != nil {
                Image(systemName: "info.circle")
                    .font(HudFont.ui(HudTextSize.micro, weight: .semibold))
            }
        }
        .foregroundStyle(message.isOperator ? ScoutPalette.accent : (agent == nil ? ScoutPalette.muted : ScoutPalette.accent))
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
                    .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
                    .lineLimit(1)
                Spacer(minLength: HudSpacing.sm)
                HudBadge(agent.state.label, tint: agent.state.tint, dot: true)
            }

            if !agent.detail.isEmpty {
                Text(agent.detail)
                    .font(HudFont.ui(HudTextSize.xxs))
                    .foregroundStyle(ScoutPalette.muted)
                    .lineLimit(1)
            }

            HStack(spacing: HudSpacing.md) {
                Label(agent.branchLabel, systemImage: "arrow.triangle.branch")
                Label(agent.updatedLabel, systemImage: "clock")
            }
            .font(HudFont.mono(HudTextSize.micro))
            .foregroundStyle(ScoutPalette.dim)
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
                .font(HudFont.ui(level == 1 ? HudTextSize.lg : HudTextSize.md, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, level == 1 ? HudSpacing.xs : 0)

        case .paragraph:
            Text(inline(block.text))
                .font(HudFont.ui(HudTextSize.base))
                .foregroundStyle(ScoutPalette.ink)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)

        case .blockquote:
            Text(inline(block.text))
                .font(HudFont.ui(HudTextSize.sm))
                .foregroundStyle(ScoutPalette.muted)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
            .padding(.leading, HudSpacing.xl)
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(HudSurface.tintBorder(ScoutPalette.accent))
                    .frame(width: 2)
            }

        case .list(let ordered, let items):
            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    HStack(alignment: .top, spacing: HudSpacing.md) {
                        Text(ordered ? "\(index + 1)." : "-")
                            .font(HudFont.mono(HudTextSize.sm, weight: .semibold))
                            .foregroundStyle(ScoutPalette.accent)
                            .frame(width: ordered ? 24 : 10, alignment: .trailing)
                        Text(inline(item))
                            .font(HudFont.ui(HudTextSize.base))
                            .foregroundStyle(ScoutPalette.ink)
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
        return ScoutFileLinkifier.apply(to: parsed, accent: ScoutPalette.accent, baseDirectory: baseDirectory)
    }
}

private extension MessageCodeBlockStyle {
    static let scout = MessageCodeBlockStyle(
        labelFont: HudFont.mono(HudTextSize.micro, weight: .bold),
        codeFont: HudFont.mono(HudTextSize.xs),
        labelColor: ScoutPalette.dim,
        codeColor: ScoutPalette.ink,
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
        keyFont: HudFont.mono(HudTextSize.xxs, weight: .semibold),
        titleFont: HudFont.mono(HudTextSize.xxs, weight: .semibold),
        tracking: 1.4,
        enabledColor: ScoutPalette.accent,
        hoverColor: ScoutPalette.ink,
        disabledColor: ScoutPalette.dim,
        horizontalPadding: HudSpacing.xs,
        verticalPadding: HudSpacing.xs
    )
}

private extension MessageSuggestionPopoverStyle {
    static let scout = MessageSuggestionPopoverStyle(
        eyebrowFont: HudFont.mono(HudTextSize.xxs, weight: .bold),
        markFont: HudFont.mono(HudTextSize.micro, weight: .bold),
        labelFont: HudFont.mono(HudTextSize.xs, weight: .semibold),
        detailFont: HudFont.ui(HudTextSize.xxs),
        eyebrowColor: ScoutPalette.dim,
        commandAccent: ScoutPalette.accent,
        agentAccent: ScoutPalette.ink,
        sessionAccent: ScoutPalette.statusInfo,
        selectedLabelColor: ScoutPalette.ink,
        labelColor: ScoutPalette.muted,
        detailColor: ScoutPalette.dim,
        selectedBackgroundColor: HudSurface.selected(ScoutPalette.accent),
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
            .font(HudFont.mono(HudTextSize.xs))
            .foregroundStyle(ScoutPalette.muted)
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
                .tint(ScoutPalette.dim)
        } else {
            Image(systemName: "paperplane.fill")
                .font(.system(size: HudTextSize.base, weight: .semibold))
                .foregroundStyle(iconColor)
                .offset(x: -1, y: 1)
        }
    }

    private var fillColor: Color {
        if !isEnabled || isSending {
            return HudSurface.inset.opacity(0.82)
        }
        return hovering ? ScoutPalette.ink : ScoutPalette.accent
    }

    private var borderColor: Color {
        if !isEnabled || isSending {
            return ScoutDesign.hairlineStrong
        }
        return hovering ? ScoutPalette.ink.opacity(0.72) : ScoutPalette.accent.opacity(0.46)
    }

    private var iconColor: Color {
        if !isEnabled || isSending {
            return ScoutPalette.dim
        }
        return ScoutDesign.bg
    }
}

// Hand-drawn dictation mic, ported from the HUD's HudMessageDock. Tap to
// toggle HudsonKit dictation. Visual state mirrors ScoutVoiceService.state:
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
        HStack(alignment: .center, spacing: HudSpacing.xxs) {
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

    @ObservedObject private var voice = ScoutVoiceService.shared
    @State private var hovering = false

    private var isRecording: Bool { voice.state.isCaptureActive }
    private var isProcessing: Bool { voice.state.isProcessing }
    private var isUnavailable: Bool { voice.state.isUnavailable }

    private var strokeColor: Color {
        if isRecording { return ScoutPalette.accent }
        if isProcessing { return ScoutPalette.muted }
        if isUnavailable { return ScoutPalette.dim.opacity(0.6) }
        return ScoutPalette.muted
    }

    private var tooltip: String {
        switch voice.state {
        case .probing:               return "Preparing voice…"
        case .idle:                  return "Tap to dictate"
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
                        isRecording ? ScoutPalette.accent.opacity(0.5) : Color.clear,
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
        .task { if voice.state == .probing { await voice.probe() } }
    }

    private var micFillColor: Color {
        if isRecording {
            return ScoutPalette.accent.opacity(0.13)
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
                    .font(isHeader ? HudFont.mono(HudTextSize.xxs, weight: .bold) : HudFont.ui(HudTextSize.sm))
                    .foregroundStyle(isHeader ? ScoutPalette.muted : ScoutPalette.ink)
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
        return ScoutFileLinkifier.apply(to: parsed, accent: ScoutPalette.accent)
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
                .stroke(Color.white.opacity(0.12), lineWidth: HudStrokeWidth.bold)
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
                            lineWidth: HudStrokeWidth.standard
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
                    .fill(ScoutPalette.accent)
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
                        .font(HudFont.ui(HudTextSize.xxs, weight: .semibold))
                        .foregroundStyle(anyOn ? ScoutPalette.accent : ScoutPalette.muted)
                    Text("DESIGN")
                        .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                        .tracking(1.5)
                        .foregroundStyle(ScoutPalette.muted)
                    Spacer(minLength: HudSpacing.lg)
                    Image(systemName: expanded ? "chevron.down" : "chevron.up")
                        .font(HudFont.ui(HudTextSize.micro, weight: .bold))
                        .foregroundStyle(ScoutPalette.dim)
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
        .background(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).fill(ScoutPalette.surface))
        .overlay(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous).stroke(HudHairline.standard, lineWidth: HudStrokeWidth.standard))
        .shadow(color: Color.black.opacity(0.4), radius: 16, x: 0, y: 8)
    }

    private var anyOn: Bool { depth || accents || glow }

    private func toggleRow(_ title: String, isOn: Binding<Bool>) -> some View {
        HStack(spacing: HudSpacing.sm) {
            Text(title)
                .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                .foregroundStyle(ScoutPalette.ink)
            Spacer(minLength: HudSpacing.md)
            Toggle("", isOn: isOn)
                .labelsHidden()
                .toggleStyle(.switch)
                .controlSize(.mini)
                .tint(ScoutPalette.accent)
        }
    }
}

/// One self-contained agent card: identity, runtime, workspace, optional
/// special skills, and the per-agent actions all live inside a single card so
/// the agent reads as one cohesive concept rather than a stack of fragments.
private struct ScoutAgentInspector: View {
    let agent: ScoutAgent
    let selectedChannel: ScoutChannel?
    let agentChannels: [ScoutChannel]
    let openObserve: () -> Void
    let openProfile: () -> Void
    let openConversation: () -> Void
    let openSession: (ScoutChannel) -> Void
    let startSession: (ScoutSessionDraft.Mode) -> Void
    /// Live activity for a *working* agent (Observe preview + agent-scoped tail
    /// + touched files). `nil` ⇒ no live well — every non-Comms inspector.
    let livePreview: ScoutAgentLivePreview?
    /// Opens the full Tail scoped to this agent. `nil` ⇒ hide the affordance.
    let openTail: (() -> Void)?

    /// Which session row is engaged (expanded into its mini-card). One at a time.
    @State private var expandedSessionCId: String? = nil

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
                actions
                HudDivider(color: ScoutDesign.hairline)
                runtime
                HudDivider(color: ScoutDesign.hairline)
                workspace
                if sessionId != nil {
                    HudDivider(color: ScoutDesign.hairline)
                    sessionSection
                }
                if !agentChannels.isEmpty {
                    HudDivider(color: ScoutDesign.hairline)
                    sessionsList
                }
                if !specialCapabilities.isEmpty {
                    HudDivider(color: ScoutDesign.hairline)
                    skills
                }
                if let livePreview, agent.state == .working {
                    ScoutAgentLiveWell(
                        preview: livePreview,
                        openObserve: openObserve,
                        openTail: openTail
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scoutDepth()
    }

    /// Sessions attached to this agent. Each row discloses progressively: role
    /// + metadata at rest, quick actions on hover, a mini-card with the full
    /// action set when engaged (tapped open). Only one expands at a time.
    private var sessionsList: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            ScoutEyebrow(text: "Sessions")
            ForEach(agentChannels.prefix(6)) { channel in
                ScoutInspectorSessionRow(
                    channel: channel,
                    role: agent.roleLabel,
                    isActive: channel.cId == selectedChannel?.cId,
                    isExpanded: expandedSessionCId == channel.cId,
                    onToggle: {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.86)) {
                            expandedSessionCId = expandedSessionCId == channel.cId ? nil : channel.cId
                        }
                    },
                    onObserve: openObserve,
                    onMessage: { openSession(channel) },
                    onFork: { startSession(.continueContext) }
                )
            }
        }
    }

    /// Global, agent-level actions at the top of the card — Message (primary)
    /// and New session — as real CTAs, not muted inline labels. Per-session
    /// verbs live on each session row, not here.
    private var actions: some View {
        HStack(spacing: HudSpacing.sm) {
            ScoutInspectorActionButton(icon: "bubble.left", title: "Message", filled: true, action: openConversation)
            ScoutInspectorActionButton(icon: "plus", title: "New session", filled: false, action: { startSession(.fresh) })
            Spacer(minLength: 0)
        }
    }

    /// Clickable identity header → profile. State rides the presence dot on
    /// the avatar (no "AVAILABLE" tag). A copy-all button sits opposite so the
    /// whole card's metadata is one click away.
    private var identity: some View {
        HStack(alignment: .top, spacing: HudSpacing.md) {
            Button(action: openProfile) {
                HStack(alignment: .top, spacing: HudSpacing.md) {
                    avatar
                    VStack(alignment: .leading, spacing: HudSpacing.xxs) {
                        Text(agent.displayName)
                            .font(HudFont.ui(HudTextSize.lg, weight: .semibold))
                            .foregroundStyle(ScoutPalette.ink)
                            .lineLimit(1)
                        Text(agent.id)
                            .font(HudFont.mono(HudTextSize.micro))
                            .foregroundStyle(ScoutPalette.dim)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain).scoutPointerCursor()
            .help("Open \(agent.displayName)'s profile")

            Spacer(minLength: 0)

            ScoutCopyButton(text: cardSummary, help: "Copy agent details")
        }
    }

    /// Plain-text dump of every field on the card — the "copy all" payload.
    private var cardSummary: String {
        var lines = [
            agent.displayName,
            "id        \(agent.id)",
            "role      \(agent.roleLabel)",
            "harness   \(agent.harness?.nilIfEmpty ?? "—")",
            "transport \(agent.transport?.nilIfEmpty ?? "—")",
            "model     \(agent.modelDisplayValue)",
            "node      \(agent.nodeName?.nilIfEmpty ?? "—")",
            "branch    \(agent.branchLabel)",
            "path      \(agent.workspace)",
        ]
        if let selectedChannel { lines.append("cId       \(selectedChannel.cId)") }
        if let sessionId { lines.append("session   \(sessionId)") }
        return lines.joined(separator: "\n")
    }

    private var avatar: some View {
        Text(String(agent.displayName.first.map(String.init) ?? "?").uppercased())
            .font(HudFont.mono(HudTextSize.xs, weight: .bold))
            .foregroundStyle(ScoutPalette.bg)
            .frame(width: 30, height: 30)
            .background(Circle().fill(ScoutPalette.muted))
            .overlay(alignment: .bottomTrailing) {
                Circle()
                    .fill(agent.state.tint)
                    .frame(width: 9, height: 9)
                    .overlay(Circle().stroke(ScoutPalette.surface, lineWidth: HudStrokeWidth.bold))
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
            ScoutCopyKVRow(key: "Path", value: agent.workspace, valueColor: ScoutPalette.muted)
            if let selectedChannel {
                ScoutCopyKVRow(key: "cId", value: selectedChannel.cId, valueColor: ScoutPalette.muted)
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
                ScoutCopyKVRow(key: "id", value: sessionId, valueColor: ScoutPalette.muted)
            }
            HudKVRow("Active", value: agent.updatedLabel)
        }
    }

    private var skills: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            ScoutEyebrow(text: "Skills")
            ScoutAgentAbilityList(capabilities: specialCapabilities)
        }
    }
}

/// Everything the live well needs, pre-scoped to one agent by the caller.
struct ScoutAgentLivePreview {
    let observePayload: ScoutObservePayload?
    let isObserveLoading: Bool
    let observeError: String?
    let tailEvents: [ScoutTailEvent]
}

/// The live data area for a working agent — same inspector card, different
/// *material*: a recessed well (darker than the surface) with a faint CRT
/// scanline texture, and a shimmering amber seam at the top. The seam IS the
/// divider between metadata and live — its glimmer is the "something is
/// happening" cue (echoing the Claude Code TUI shimmer). No "Live"/"turn"
/// labels; the material conveys it. Bleeds to the card edges.
private struct ScoutAgentLiveWell: View {
    let preview: ScoutAgentLivePreview
    let openObserve: () -> Void
    let openTail: (() -> Void)?

    private var payload: ScoutObservePayload? { preview.observePayload }
    private var events: [ScoutObserveEvent] {
        Array((payload?.data.events ?? []).suffix(4).reversed())
    }
    private var files: [ScoutObserveFile] {
        Array((payload?.data.files ?? []).sorted { $0.lastT > $1.lastT }.prefix(5))
    }
    private var tailEvents: [ScoutTailEvent] {
        Array(preview.tailEvents.suffix(4).reversed())
    }

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.lg) {
            nowSection
            wellDivider
            tailSection
            wellDivider
            filesSection
        }
        .padding(.horizontal, HudSpacing.xxl)
        .padding(.top, HudSpacing.lg)
        .padding(.bottom, HudSpacing.xxl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(wellBackground)
        .overlay(alignment: .top) { ScoutShimmerSeam() }
        .clipShape(
            UnevenRoundedRectangle(
                bottomLeadingRadius: HudRadius.card,
                bottomTrailingRadius: HudRadius.card,
                style: .continuous
            )
        )
        .padding(.horizontal, -HudSpacing.xxl)
        .padding(.bottom, -HudSpacing.xxl)
    }

    // NOW — condensed Observe timeline, newest-first.
    private var nowSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            HStack {
                ScoutEyebrow(text: "Now")
                Spacer(minLength: HudSpacing.sm)
                ScoutObserveChip(action: openObserve)
            }
            if preview.isObserveLoading && payload == nil {
                HStack(spacing: HudSpacing.sm) {
                    ProgressView().controlSize(.small)
                    hint("Reading activity…")
                }
            } else if events.isEmpty {
                hint(preview.observeError != nil ? "Observe unavailable" : "Waiting for activity")
            } else {
                ForEach(events) { event in nowRow(event) }
            }
        }
    }

    @ViewBuilder
    private func nowRow(_ event: ScoutObserveEvent) -> some View {
        HStack(alignment: .top, spacing: HudSpacing.sm) {
            Image(systemName: event.kind.liveIcon)
                .font(.system(size: 9))
                .foregroundStyle(event.kind.liveTint)
                .frame(width: 12)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: HudSpacing.xs) {
                    Text(event.kind.liveLabel)
                        .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                        .foregroundStyle(event.kind.liveTint)
                    if let tool = event.tool?.nilIfEmpty {
                        Text(tool)
                            .font(HudFont.mono(HudTextSize.micro))
                            .foregroundStyle(ScoutPalette.accent)
                            .lineLimit(1)
                    }
                    Spacer(minLength: HudSpacing.sm)
                    Text(event.timelineLabel)
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(ScoutPalette.dim)
                }
                if !event.text.isEmpty {
                    Text(event.text)
                        .font(HudFont.ui(HudTextSize.xxs))
                        .foregroundStyle(event.kind == .think ? ScoutPalette.muted : ScoutPalette.ink)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    // TAIL — system events scoped to this agent, newest-first.
    private var tailSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            HStack {
                ScoutEyebrow(text: "Tail · this agent")
                Spacer(minLength: HudSpacing.sm)
                if let openTail {
                    wellLink("Tail", icon: "list.bullet.indent", action: openTail)
                }
            }
            if tailEvents.isEmpty {
                hint("No tail events for this agent yet")
            } else {
                ForEach(tailEvents) { event in tailRow(event) }
            }
        }
    }

    @ViewBuilder
    private func tailRow(_ event: ScoutTailEvent) -> some View {
        HStack(spacing: HudSpacing.sm) {
            Text(event.kind.glyph)
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(event.kind.tint)
                .frame(width: 10)
            Text(event.summary)
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ScoutPalette.muted)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: HudSpacing.sm)
            Text(event.ageLabel)
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(ScoutPalette.dim)
        }
    }

    // FILES — recently touched files snapshot.
    private var filesSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            HStack {
                ScoutEyebrow(text: "Files")
                Spacer(minLength: HudSpacing.sm)
                if !files.isEmpty {
                    Text("\(files.count) changed")
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(ScoutPalette.dim)
                }
            }
            if files.isEmpty {
                hint("No file touches yet")
            } else {
                ForEach(files) { file in fileRow(file) }
            }
        }
    }

    @ViewBuilder
    private func fileRow(_ file: ScoutObserveFile) -> some View {
        HStack(alignment: .center, spacing: HudSpacing.sm) {
            Circle()
                .fill(scoutFileStateTint(file.state))
                .frame(width: 6, height: 6)
            VStack(alignment: .leading, spacing: 1) {
                Text(file.path)
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(ScoutPalette.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text("\(file.state) · \(file.touches)× · \(file.ageLabel)")
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutPalette.dim)
            }
        }
    }

    private var wellDivider: some View {
        Rectangle()
            .fill(ScoutPalette.ink.opacity(0.08))
            .frame(height: 1)
    }

    private var wellBackground: some View {
        ZStack {
            ScoutPalette.bg
            ScoutScanlines()
            LinearGradient(
                colors: [Color.black.opacity(0.35), .clear],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }

    private func hint(_ text: String) -> some View {
        Text(text)
            .font(HudFont.mono(HudTextSize.xxs))
            .foregroundStyle(ScoutPalette.dim)
    }

    @ViewBuilder
    private func wellLink(_ label: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: HudSpacing.xs) {
                Image(systemName: icon).font(.system(size: 8))
                Text(label.uppercased())
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
            }
            .foregroundStyle(ScoutPalette.dim)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .help("Open full \(label)")
    }
}

/// The seam between metadata and live IS the activity cue: a static machined
/// amber line with a bright glimmer that sweeps across it, echoing the Claude
/// Code TUI working shimmer. Full-bleed across the top of the well.
private struct ScoutShimmerSeam: View {
    @State private var phase: CGFloat = -1

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            Rectangle()
                .fill(ScoutPalette.statusWarn.opacity(0.32))
                .overlay {
                    LinearGradient(
                        colors: [.clear, ScoutPalette.statusWarn, .clear],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                    .frame(width: max(w * 0.4, 48))
                    .offset(x: phase * (w * 0.9))
                }
                .clipped()
        }
        .frame(height: 1.5)
        .allowsHitTesting(false)
        .onAppear {
            withAnimation(.linear(duration: 2.4).repeatForever(autoreverses: false)) {
                phase = 1
            }
        }
    }
}

/// Faint CRT scanline texture for the live well.
private struct ScoutScanlines: View {
    var body: some View {
        Canvas { ctx, size in
            let shading = GraphicsContext.Shading.color(ScoutPalette.ink.opacity(0.05))
            var y: CGFloat = 0
            while y < size.height {
                ctx.fill(Path(CGRect(x: 0, y: y, width: size.width, height: 1)), with: shading)
                y += 3
            }
        }
        .allowsHitTesting(false)
    }
}

private extension ScoutObserveEventKind {
    var liveLabel: String {
        switch self {
        case .think: return "THINK"
        case .tool: return "TOOL"
        case .ask: return "ASK"
        case .message: return "MSG"
        case .note: return "NOTE"
        case .system: return "SYS"
        case .boot: return "BOOT"
        case .unknown: return "EVT"
        }
    }

    var liveIcon: String {
        switch self {
        case .think: return "sparkles"
        case .tool: return "wrench.and.screwdriver"
        case .ask: return "questionmark.bubble"
        case .message: return "bubble.left"
        case .note: return "note.text"
        case .system: return "gearshape"
        case .boot: return "power"
        case .unknown: return "circle"
        }
    }

    var liveTint: Color {
        switch self {
        case .think: return ScoutPalette.dim
        case .tool: return ScoutPalette.accent
        case .ask: return ScoutPalette.statusWarn
        case .message: return ScoutPalette.statusInfo
        case .note: return ScoutPalette.statusOk
        case .system, .boot: return ScoutPalette.muted
        case .unknown: return ScoutPalette.dim
        }
    }
}

private func scoutFileStateTint(_ state: String) -> Color {
    switch state.lowercased() {
    case "created", "added", "new": return ScoutPalette.statusOk
    case "modified", "changed", "edited": return ScoutPalette.accent
    case "deleted", "removed": return ScoutPalette.statusError
    default: return ScoutPalette.muted
    }
}

/// Quiet-but-clearly-clickable Observe chip. At rest it reads as a button
/// (hairline border + faint inset), warming to observe-green on hover —
/// present without out-shouting the agent identity above it.
enum ScoutClipboard {
    static func copy(_ text: String) {
        #if os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #endif
    }
}

/// Small icon copy button — flashes a checkmark on copy. Used for "copy the
/// whole card" and any one-shot copy affordance.
private struct ScoutCopyButton: View {
    let text: String
    var help: String = "Copy"
    @State private var hovering = false
    @State private var copied = false

    var body: some View {
        Button {
            ScoutClipboard.copy(text)
            flash()
        } label: {
            Image(systemName: copied ? "checkmark" : "doc.on.doc")
                .font(HudFont.ui(HudTextSize.xxs, weight: .semibold))
                .foregroundStyle(copied ? ScoutPalette.statusOk : (hovering ? ScoutPalette.ink : ScoutPalette.dim))
                .frame(width: 22, height: 22)
                .background(Circle().fill(hovering ? HudSurface.hover : Color.clear))
                .contentShape(Circle())
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .onHover { hovering = $0 }
        .help(copied ? "Copied" : help)
        .accessibilityLabel(help)
    }

    private func flash() {
        withAnimation(.easeOut(duration: 0.15)) { copied = true }
        Task {
            try? await Task.sleep(nanoseconds: 1_100_000_000)
            withAnimation(.easeOut(duration: 0.3)) { copied = false }
        }
    }
}

/// A telemetry row whose value copies on click. Mirrors HudKVRow's look, but
/// shows the value in full (no shortening) and flashes "copied". The copy glyph
/// fades in on hover so at-rest it reads like a plain KV row.
private struct ScoutCopyKVRow: View {
    let key: String
    let value: String
    var valueColor: Color = ScoutPalette.ink
    @State private var hovering = false
    @State private var copied = false

    var body: some View {
        Button {
            ScoutClipboard.copy(value)
            flash()
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
                Text(key.uppercased())
                    .font(HudFont.mono(9))
                    .tracking(0.8)
                    .foregroundStyle(ScoutPalette.dim)
                    .lineLimit(1)
                Spacer(minLength: HudSpacing.sm)
                // No reserved copy glyph — values stay flush-right, aligned with
                // the plain KV rows. Click-to-copy + hover brighten + the
                // "copied" flash are the affordance.
                Text(copied ? "copied" : value)
                    .font(HudFont.mono(11))
                    .foregroundStyle(copied ? ScoutPalette.statusOk : (hovering ? ScoutPalette.ink : valueColor))
                    .multilineTextAlignment(.trailing)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .onHover { hovering = $0 }
        .help("Copy \(key)")
    }

    private func flash() {
        withAnimation(.easeOut(duration: 0.15)) { copied = true }
        Task {
            try? await Task.sleep(nanoseconds: 1_100_000_000)
            withAnimation(.easeOut(duration: 0.3)) { copied = false }
        }
    }
}

/// Collapse the home directory to `~` for compact path display.
private func scoutHomeTilde(_ path: String) -> String {
    let home = NSHomeDirectory()
    guard !home.isEmpty, path.hasPrefix(home) else { return path }
    return "~" + path.dropFirst(home.count)
}

/// A session in the inspector's Sessions list, with progressive disclosure:
///  · rest    — dot · title · role badge · age, then a metadata line
///  · hover   — quick actions (Observe / Message) replace the age
///  · engaged — tap to expand into a mini-card: full id/path/branch/msgs +
///              the per-session action set (Observe · Message · Fork; Take over
///              joins once it has a backend).
private struct ScoutInspectorSessionRow: View {
    let channel: ScoutChannel
    let role: String
    let isActive: Bool
    let isExpanded: Bool
    let onToggle: () -> Void
    let onObserve: () -> Void
    let onMessage: () -> Void
    let onFork: () -> Void
    @State private var hovering = false

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            header
            if isExpanded {
                expandedDetail
            } else {
                metaLine
            }
        }
        .padding(.horizontal, HudSpacing.sm)
        .padding(.vertical, HudSpacing.sm)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .fill(isExpanded ? ScoutPalette.bg : (hovering ? HudSurface.hover : Color.clear))
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .stroke(isExpanded ? HudHairline.standard : Color.clear, lineWidth: HudStrokeWidth.thin)
        )
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.12), value: hovering)
    }

    private var header: some View {
        HStack(spacing: HudSpacing.sm) {
            Button(action: onToggle) {
                HStack(spacing: HudSpacing.sm) {
                    Circle()
                        .fill(isActive ? ScoutPalette.statusOk : ScoutPalette.dim)
                        .frame(width: 5, height: 5)
                    Text(channel.rowTitle)
                        .font(HudFont.ui(HudTextSize.xxs, weight: .medium))
                        .foregroundStyle(hovering || isExpanded ? ScoutPalette.ink : ScoutPalette.muted)
                        .lineLimit(1)
                    roleBadge
                    Spacer(minLength: HudSpacing.sm)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain).scoutPointerCursor()
            .help(isExpanded ? "Collapse" : "Expand \(channel.rowTitle)")

            if isExpanded {
                Image(systemName: "chevron.up")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(ScoutPalette.dim)
            } else if hovering {
                quickActions
            } else {
                Text(channel.ageLabel)
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutPalette.dim)
            }
        }
    }

    private var roleBadge: some View {
        Text(role.uppercased())
            .font(HudFont.mono(8, weight: .semibold))
            .tracking(0.5)
            .foregroundStyle(ScoutPalette.muted)
            .padding(.horizontal, HudSpacing.xs)
            .padding(.vertical, 1)
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                    .stroke(HudHairline.standard, lineWidth: HudStrokeWidth.thin)
            )
            .fixedSize()
    }

    private var quickActions: some View {
        HStack(spacing: HudSpacing.xs) {
            quickIcon("eye", tint: ScoutPalette.statusOk, help: "Observe", action: onObserve)
            quickIcon("bubble.left", tint: ScoutPalette.muted, help: "Message", action: onMessage)
        }
    }

    private func quickIcon(_ name: String, tint: Color, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: name)
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 16, height: 16)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .help(help)
    }

    private var metaLine: some View {
        Text(metaText)
            .font(HudFont.mono(HudTextSize.micro))
            .foregroundStyle(ScoutPalette.dim)
            .lineLimit(1)
            .truncationMode(.middle)
            .padding(.leading, 13)
    }

    private var metaText: String {
        var parts: [String] = []
        if let branch = channel.currentBranch?.nilIfEmpty { parts.append(branch) }
        parts.append("\(channel.messageCount) msgs")
        return parts.joined(separator: " · ")
    }

    private var expandedDetail: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            VStack(alignment: .leading, spacing: 3) {
                detailRow("id", channel.cId)
                if let path = channel.workspaceRoot?.nilIfEmpty { detailRow("path", scoutHomeTilde(path)) }
                if let branch = channel.currentBranch?.nilIfEmpty { detailRow("branch", branch) }
                detailRow("msgs", "\(channel.messageCount)")
            }
            actionGrid
        }
        .padding(.leading, 13)
    }

    private func detailRow(_ key: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
            Text(key.uppercased())
                .font(HudFont.mono(8))
                .tracking(0.5)
                .foregroundStyle(ScoutPalette.dim)
                .frame(width: 34, alignment: .leading)
            Text(value)
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(ScoutPalette.muted)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 0)
        }
    }

    /// Per-session verbs as equal, single-line cells. Take over joins to make
    /// the 2×2 once it has a backend — until then it's not faked.
    private var actionGrid: some View {
        HStack(spacing: HudSpacing.xs) {
            ScoutSessionActionCell(icon: "eye", title: "Observe", accent: true, action: onObserve)
            ScoutSessionActionCell(icon: "bubble.left", title: "Message", accent: false, action: onMessage)
            ScoutSessionActionCell(icon: "arrow.triangle.branch", title: "Fork", accent: false, action: onFork)
        }
    }
}

/// One equal, single-line per-session action cell (Observe accent, others
/// neutral). No "soon"/disabled states — a cell is here only if it's real.
private struct ScoutSessionActionCell: View {
    let icon: String
    let title: String
    let accent: Bool
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: HudSpacing.xs) {
                Image(systemName: icon).font(.system(size: 9, weight: .semibold))
                Text(title.uppercased())
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .tracking(0.4)
                    .lineLimit(1)
            }
            .foregroundStyle(foreground)
            .frame(maxWidth: .infinity)
            .frame(height: 24)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(fill)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .stroke(border, lineWidth: HudStrokeWidth.thin)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .onHover { hovering = $0 }
    }

    private var foreground: Color {
        if accent { return ScoutPalette.statusOk }
        return hovering ? ScoutPalette.ink : ScoutPalette.muted
    }
    private var fill: Color {
        if accent { return ScoutPalette.statusOk.opacity(hovering ? 0.22 : 0.12) }
        return hovering ? HudSurface.hover : Color.clear
    }
    private var border: Color {
        if accent { return ScoutPalette.statusOk.opacity(0.45) }
        return HudHairline.standard
    }
}

/// Global agent-level CTA — filled accent (primary) or outlined (secondary).
/// Reads unmistakably as a button so it never gets lost as a label.
private struct ScoutInspectorActionButton: View {
    let icon: String
    let title: String
    let filled: Bool
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: HudSpacing.xs) {
                Image(systemName: icon).font(HudFont.ui(HudTextSize.micro, weight: .bold))
                Text(title.uppercased())
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .tracking(0.4)
                    .lineLimit(1)
            }
            .foregroundStyle(foreground)
            .padding(.horizontal, HudSpacing.md)
            .padding(.vertical, HudSpacing.xs + 1)
            .background(Capsule().fill(fill))
            .overlay(Capsule().stroke(border, lineWidth: HudStrokeWidth.standard))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .onHover { hovering = $0 }
    }

    private var foreground: Color {
        if filled { return ScoutPalette.bg }
        return hovering ? ScoutPalette.ink : ScoutPalette.muted
    }
    private var fill: Color {
        if filled { return ScoutPalette.accent.opacity(hovering ? 1 : 0.92) }
        return hovering ? HudSurface.hover : Color.clear
    }
    private var border: Color {
        if filled { return .clear }
        return HudHairline.standard
    }
}

private struct ScoutObserveChip: View {
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: HudSpacing.xs) {
                Image(systemName: "eye")
                    .font(HudFont.ui(HudTextSize.xxs, weight: .semibold))
                Text("OBSERVE")
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
            }
            .foregroundStyle(hovering ? ScoutPalette.statusOk : ScoutPalette.muted)
            .padding(.horizontal, HudSpacing.sm)
            .padding(.vertical, HudSpacing.xs)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .fill(hovering ? ScoutPalette.statusOk.opacity(0.12) : HudSurface.inset)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .stroke(hovering ? ScoutPalette.statusOk.opacity(0.5) : Color.white.opacity(0.22), lineWidth: HudStrokeWidth.thin)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .onHover { hovering = $0 }
        .help("Observe")
    }
}

/// Lays out every agent in a DM as its own card — side by side when the column
/// is wide enough, otherwise stacked.
private struct ScoutAgentCardStack: View {
    let agents: [ScoutAgent]
    let selectedChannel: ScoutChannel?
    let channelsFor: (ScoutAgent) -> [ScoutChannel]
    let openObserve: (ScoutAgent) -> Void
    let openProfile: (ScoutAgent) -> Void
    let openConversation: (ScoutAgent) -> Void
    let openSession: (ScoutChannel) -> Void
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
            agentChannels: channelsFor(agent),
            openObserve: { openObserve(agent) },
            openProfile: { openProfile(agent) },
            openConversation: { openConversation(agent) },
            openSession: openSession,
            startSession: { _ in startSession(agent) },
            livePreview: nil,
            openTail: nil
        )
    }
}

private struct ScoutAgentPreviewPanel: View {
    let agent: ScoutAgent
    let selectedChannel: ScoutChannel?
    let agentChannels: [ScoutChannel]
    let onClose: () -> Void
    let openObserve: () -> Void
    let openProfile: () -> Void
    let openConversation: () -> Void
    let openSession: (ScoutChannel) -> Void
    let startSession: (ScoutSessionDraft.Mode) -> Void

    var body: some View {
        VStack(spacing: 0) {
            header
            HudDivider(color: ScoutDesign.hairline)

            ScrollView {
                ScoutAgentInspector(
                    agent: agent,
                    selectedChannel: selectedChannel,
                    agentChannels: agentChannels,
                    openObserve: openObserve,
                    openProfile: openProfile,
                    openConversation: openConversation,
                    openSession: openSession,
                    startSession: startSession,
                    livePreview: nil,
                    openTail: nil
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
                    .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                    .foregroundStyle(ScoutPalette.accent)
                    .frame(width: 22, height: 22)
                    .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(ScoutPalette.accentSoft))
                HudSectionLabel("Agent")
            }
        } secondary: {
            Text(agent.displayName)
                .font(HudFont.ui(HudTextSize.base, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
                .lineLimit(1)
                .truncationMode(.tail)
        } trailing: {
            Button(action: onClose) {
                Image(systemName: "sidebar.right")
                    .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
            }
            .buttonStyle(.plain).scoutPointerCursor()
            .foregroundStyle(ScoutPalette.muted)
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
            valueColor: agent.model?.nilIfEmpty == nil ? ScoutPalette.muted : ScoutPalette.ink
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
                .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                .foregroundStyle(ScoutPalette.muted)
                .frame(width: 22, height: 22)
                .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(ScoutPalette.surface))
                .overlay(
                    RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                        .stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin)
                )

            VStack(alignment: .leading, spacing: HudSpacing.xxs) {
                Text(ability.title)
                    .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                    .foregroundStyle(ScoutPalette.ink)
                Text(ability.detail)
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(ScoutPalette.dim)
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
                        .font(HudFont.ui(HudTextSize.xl, weight: .semibold))
                        .foregroundStyle(ScoutPalette.ink)
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
