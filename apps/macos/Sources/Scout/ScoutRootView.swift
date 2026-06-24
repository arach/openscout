import HudsonShell
import HudsonUI
import ScoutAppCore
import ScoutHUD
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

#if os(macOS)
private struct ScoutAppIconMark: View {
    let size: CGFloat
    let cornerRadius: CGFloat

    var body: some View {
        Group {
            if let icon = Self.appIcon() {
                Image(nsImage: icon)
                    .resizable()
                    .interpolation(.high)
                    .frame(width: size, height: size)
                    .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            } else {
                Text("S")
                    .font(HudFont.mono(HudTextSize.base, weight: .bold))
                    .foregroundStyle(ScoutPalette.bg)
                    .frame(width: size, height: size)
                    .background(
                        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                            .fill(ScoutPalette.accent)
                    )
            }
        }
        .accessibilityLabel("Scout")
    }

    private static func appIcon() -> NSImage? {
        if let appIconURL = Bundle.main.url(forResource: "AppIcon", withExtension: "icns"),
           let image = NSImage(contentsOf: appIconURL) {
            return image
        }

        if let image = NSImage(named: NSImage.applicationIconName), image.isValid {
            return image
        }

        return nil
    }
}
#endif

private struct ScoutDiffSheetRequest {
    let worktree: RepoWorktree
    let sessionId: String?
    let agentId: String?

    var id: String {
        [worktree.id, sessionId?.nilIfEmpty ?? "", agentId?.nilIfEmpty ?? ""].joined(separator: "|")
    }

    static func worktree(_ worktree: RepoWorktree) -> ScoutDiffSheetRequest {
        ScoutDiffSheetRequest(worktree: worktree, sessionId: nil, agentId: nil)
    }

    static func session(_ worktree: RepoWorktree, sessionId: String?, agentId: String?) -> ScoutDiffSheetRequest {
        ScoutDiffSheetRequest(worktree: worktree, sessionId: sessionId?.nilIfEmpty, agentId: agentId?.nilIfEmpty)
    }
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
    /// Incoming LAN pairing requests awaiting approval on this Mac.
    @StateObject private var pairingApprovals = ScoutPairingApprovalStore()
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
    private static let activeTurnAnchor = "scout.messageList.activeTurn"
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
    @State private var compactInspectorPresented = false
    /// Non-nil while the new-session composer is presented. Configured by each
    /// entry point (list "+", message context menu, agent inspector).
    @State private var sessionDraft: ScoutSessionDraft?
    @State private var pendingConversations: [ScoutPendingConversation] = []
    @State private var pendingFlightTasks: [String: Task<Void, Never>] = [:]
    /// Embedded file preview state. Shared so message file-links (rendered deep
    /// in the markdown tree) can open it without threading a closure down.
    @ObservedObject private var fileViewer = ScoutFileViewer.shared
    @FocusState private var composerFocused: Bool
    @FocusState private var searchFocused: Bool
    @State private var repoAskFocused = false
    /// Keyboard cheatsheet overlay (⌘/). Lists the live chords so nothing has
    /// to be guessed.
    @State private var showCheatsheet = false
    @State private var showDesignPreview = false
    /// Native appearance settings page — replaces the old web `/settings` jump.
    @ObservedObject private var appearance = ScoutAppearance.shared
    @AppStorage("scout.navigationSidebar.labelWidth.v2") private var navigationSidebarLabelWidth = 88.0
    @AppStorage("scout.conversationList.width.v2") private var conversationListWidth = 224.0
    @AppStorage("scout.inspector.width") private var inspectorWidth = 320.0
    @AppStorage("scout.observeSidecar.width") private var observeSidecarWidth = Double(ScoutObserveSidecarMetrics.defaultWidth)
    @AppStorage("scout.fileViewer.width") private var fileViewerWidth = Double(ScoutFileViewerMetrics.defaultWidth)
    @AppStorage("scout.session.lastProjectPath") private var lastSessionProjectPath = ""

    /// Expansion + selection for the Agents project·agent·session tree. The
    /// window-level keyboard chords drive it; selection is mirrored into
    /// `store.selectedAgentId` so the inspector follows.
    @StateObject private var agentsTree = ScoutAgentsTreeModel()

    /// Expansion + selection for the Repos repo·worktree tree. Same chords; the
    /// inspector reads its selection directly.
    @StateObject private var reposTree = ScoutReposTreeModel()

    /// SCO-065 — the diff request presented in the slide-out
    /// `ScoutBranchDiffSheet`. Non-nil while the sheet is up; activating a
    /// worktree row (Enter / double-click) sets it.
    @State private var diffSheetRequest: ScoutDiffSheetRequest?

    /// The tail event whose full session is presented in the slide-out
    /// `ScoutTailSessionSheet` (embedded web session viewer). Non-nil while the
    /// sheet is up; "Open session" on a tail row sets it.
    @State private var tailSessionEvent: ScoutTailEvent?

    private var manifest: HudAppManifest {
        HudAppManifest(
            name: "Scout",
            version: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.1",
            accent: ScoutPalette.accent,
            accentSoft: ScoutPalette.accentSoft,
            targetLabel: "Agent"
        )
    }

    var body: some View {
        GeometryReader { proxy in
            let layout = ScoutShellLayout(windowWidth: proxy.size.width)
            rootShell(layout: layout)
                .onChange(of: layout.mode) { _, mode in
                    if mode != .compact {
                        compactInspectorPresented = false
                    }
                }
        }
    }

    private func rootShell(layout: ScoutShellLayout) -> some View {
        HudChromeShell(titlebarStyle: .systemToolbar, titlebarActions: chromeTitlebarActions(layout: layout)) {
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
                isCompact: navigationCompactBinding(layout: layout),
                labelWidth: navigationSidebarLabelWidthBinding,
                accent: manifest.accent,
                minLabelWidth: 76,
                maxLabelWidth: 260,
                collapseLabelWidth: 44,
                railHeader: {
                    ScoutAppIconMark(size: 24, cornerRadius: HudRadius.standard)
                },
                labelHeader: {
                    Text("Scout")
                        .font(HudFont.ui(HudTextSize.base, weight: .semibold))
                        .foregroundStyle(ScoutPalette.ink)
                        .lineLimit(1)
                },
                footer: {
                    ScoutSidebarSettingsButton(
                        isCompact: effectiveRailCompact(layout: layout),
                        labelWidth: CGFloat(navigationSidebarLabelWidth),
                        isSelected: section == .settings
                    ) {
                        section = .settings
                    }
                }
            )
        } trailing: {
            trailingPanel(layout: layout)
        } content: {
            content(layout: layout)
        } statusBar: {
            statusBar
        }
        .hudsonAppManifest(manifest)
        .environment(\.hudTheme, ScoutDesign.theme)
        // Opaque chrome rail (not behind-window vibrancy): the `.liquidGlass`
        // surface samples the desktop through the window, collapsing the rail to
        // mid-gray and dropping nav-label contrast to ~1.3:1 over a busy
        // wallpaper. `.base` gives a solid chrome plane (+ subtle gradient and a
        // trailing hairline) so labels stay legible against the light theme.
        .environment(\.hudsonSidebarStyle, HudSidebarStyle(
            surface: .base,
            indicator: .base,
            icon: .editorial,
            motion: .base
        ))
        .hudsonSidebarMotionMode(.smoothFade)
        .toolbarBackground(ScoutDesign.chrome, for: .windowToolbar)
        .toolbarColorScheme(appearance.themeMode.colorScheme, for: .windowToolbar)
        .background {
            #if os(macOS)
            ScoutWindowBackdrop(opacity: appearance.windowOpacity)
                .ignoresSafeArea()
            #endif
        }
        .background(ScoutWindowConfigurator(opacity: appearance.windowOpacity, themeMode: appearance.themeMode))
        .onAppear {
            store.start()
            pairingApprovals.start()
            if let cId = ScoutExternalCommand.takePendingChannelId() {
                openChannelFromExternalCommand(cId)
            }
            syncScopedStoreLifecycles()
        }
        .onReceive(NotificationCenter.default.publisher(for: ScoutExternalCommand.openChannelNotificationName)) { notification in
            guard let cId = notification.userInfo?["cId"] as? String else { return }
            openChannelFromExternalCommand(cId)
            ScoutExternalCommand.clearPendingChannelId(cId)
        }
        .onDisappear {
            store.stop()
            tail.stop()
            repos.stop()
            pairingApprovals.stop()
            cancelPendingFlightMonitors()
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
        .onChange(of: store.channels.map(\.cId)) { _, _ in
            reconcilePendingConversations()
        }
        .onChange(of: section) { _, newSection in
            if newSection != .tail {
                tailSessionEvent = nil
            }
            syncScopedStoreLifecycles()
        }
        .onChange(of: modalPresented) { _, _ in
            syncScopedStoreLifecycles()
        }
        .overlay {
            if let sessionDraft {
                ScoutSessionComposer(
                    draft: sessionDraft,
                    agents: store.agents,
                    projectOptions: sessionProjectOptions
                ) {
                    self.sessionDraft = nil
                } onComplete: { result, submittedDraft in
                    handleSessionStarted(result, draft: submittedDraft)
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
        .overlay(alignment: .bottomTrailing) {
            // Incoming LAN pairing approval — a phone tapped this Mac and needs a
            // human to allow it (trust-on-first-use). Bottom-trailing so it
            // doesn't block the rail or content.
            ScoutPairingApprovalPrompt(store: pairingApprovals)
        }
        .overlay {
            // SCO-065 — repo-diff sheet, presented at the app root so it sticks
            // across section changes (open in Repos, wander to Comms/Tail, it
            // stays). Its scrim is non-blocking, so the rail stays navigable;
            // dismissal is explicit only (close chevron or Escape).
            if let request = diffSheetRequest {
                ScoutBranchDiffSheet(
                    worktreePath: request.worktree.path,
                    branchParts: request.worktree.branchParts,
                    edge: .bottom,
                    sessionId: request.sessionId,
                    agentId: request.agentId,
                    onClose: {
                        withAnimation(.easeOut(duration: 0.14)) { diffSheetRequest = nil }
                    }
                )
                .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.14), value: diffSheetRequest?.id)
        .overlay {
            // Tail "load session" — present at the app root so the embedded
            // web viewer does not relayout the Tail table and cannot become a
            // hidden modal if the user changes sections while it is open.
            if section == .tail, let event = tailSessionEvent {
                ScoutTailSessionSheet(
                    sessionRef: event.sessionId,
                    title: event.projectLabel,
                    subtitle: "\(event.sourceLabel) · \(event.sessionShortLabel)",
                    edge: .bottom,
                    onClose: {
                        withAnimation(.easeOut(duration: 0.14)) {
                            tailSessionEvent = nil
                        }
                    }
                )
                .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.14), value: tailSessionEvent?.id)
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
        section == .tail && !modalPresented
    }

    private func handleAppCommand(_ command: ScoutAppCommand) {
        guard !modalPresented else { return }
        switch command {
        case .newConversation:
            startNewConversation()
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
        case .openSettings:
            section = .settings
        }
    }

    private func handleKeyboardEvent(_ event: NSEvent) -> Bool {
        if event.keyCode == 53, HUDController.shared.handleHostKeyDown(event) {
            return true
        }
        if HUDController.shared.isVisible,
           bareKeysAvailable,
           HUDController.shared.handleHostKeyDown(event) {
            return true
        }
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

    private func openChannelFromExternalCommand(_ cId: String) {
        let trimmed = cId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        section = .comms
        store.selectChannel(trimmed)
    }

    /// A modal overlay is up and should own the keyboard.
    private var modalPresented: Bool {
        sessionDraft != nil || previewImage != nil || diffSheetRequest != nil || tailSessionEvent != nil
    }

    /// Bare (unmodified) keys may drive navigation/help only when nothing is
    /// capturing text input — otherwise they'd be stolen from typing. (Modal
    /// overlays are already excluded by `modalPresented`.)
    private var bareKeysAvailable: Bool {
        !composerFocused && !searchFocused && !repoAskFocused
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
        case .tail, .settings:
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
        case .tail, .settings:
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

    /// Jump into the selected row's chat (⌘↩, Agents page) — the focused
    /// session if a session row is selected, else the agent's channel.
    private func openSelectedAgentChannel() {
        if section == .repos {
            activateSelectedRepoRow()
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

    /// ⌘↩ / double-click on the Repos page — activate the focused row.
    ///
    /// SCO-065: a **worktree** row opens the repo-diff slide-out sheet
    /// (`ScoutBranchDiffSheet`) for that worktree's path. A **project** row has
    /// no diff of its own, so it keeps the prior behavior and reveals the repo
    /// root in Finder.
    private func activateSelectedRepoRow() {
        if let worktree = repos.worktree(id: reposTree.selectedWorktreeID),
           !worktree.path.isEmpty {
            withAnimation(.easeOut(duration: 0.14)) {
                diffSheetRequest = .worktree(worktree)
            }
            return
        }
        revealSelectedRepoInFinder()
    }

    /// Reveal the focused worktree (or project root) in Finder — the fallback
    /// activation for project rows and the explicit "show in Finder" path.
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
        repos.refresh()
        sessionDraft = ScoutSessionDraft(
            title: "New chat",
            target: .project,
            projectPath: defaultProjectPath,
            mode: .fresh,
            instructions: "",
            fromMessageId: nil,
            fromConversationId: nil
        )
    }

    private func startConversationFromMessage(_ message: ScoutMessage, agent: ScoutAgent?) {
        repos.refresh()
        sessionDraft = ScoutSessionDraft(
            title: "Branch from message",
            target: .project,
            projectPath: agent?.projectRoot?.nilIfEmpty ?? agent?.cwd?.nilIfEmpty ?? defaultProjectPath,
            mode: .fresh,
            instructions: message.body,
            fromMessageId: message.id,
            fromConversationId: message.cId,
            seedSourceName: agent?.displayName.nilIfEmpty ?? message.actorName.nilIfEmpty,
            seedPreview: message.body,
            harness: agent?.harness?.nilIfEmpty,
            model: preferredFreshModel(harness: agent?.harness, model: agent?.model)
        )
    }

    private func startSessionWithAgent(_ agent: ScoutAgent, mode: ScoutSessionDraft.Mode) {
        repos.refresh()
        let target: ScoutSessionDraft.Target = mode == .continueContext ? .agent(agent) : .project
        sessionDraft = ScoutSessionDraft(
            title: mode == .continueContext ? "Continue chat" : "New chat",
            target: target,
            projectPath: agent.projectRoot?.nilIfEmpty ?? agent.cwd?.nilIfEmpty ?? defaultProjectPath,
            mode: mode,
            instructions: "",
            fromMessageId: nil,
            fromConversationId: nil,
            harness: mode == .continueContext ? nil : agent.harness?.nilIfEmpty,
            model: mode == .continueContext ? nil : preferredFreshModel(harness: agent.harness, model: agent.model)
        )
    }

    private func preferredFreshModel(harness: String?, model: String?) -> String? {
        guard let harness = harness?.nilIfEmpty else { return model?.nilIfEmpty }
        guard harness.lowercased() == "codex" else { return model?.nilIfEmpty }
        guard let model = model?.nilIfEmpty else { return "gpt-5.5" }
        let lower = model.lowercased()
        if lower == "gpt-5.3-codex-spark" || lower.hasPrefix("gpt-5.4") {
            return "gpt-5.5"
        }
        return model
    }

    private func handleSessionStarted(_ result: ScoutSessionStartResult, draft submittedDraft: ScoutSessionDraft) {
        sessionDraft = nil
        section = .comms
        if let projectPath = submittedDraft.projectPath.nilIfEmpty {
            lastSessionProjectPath = projectPath
        }
        if let cId = result.conversationId?.nilIfEmpty {
            addPendingConversation(result, draft: submittedDraft)
            store.selectChannel(cId)
        }
        if let agentId = result.agentId?.nilIfEmpty {
            store.selectAgent(agentId)
        }
        store.refresh(force: true)
    }

    /// Best-guess project root for a brand-new conversation: the selected
    /// agent's root, else any roster agent that exposes one.
    private var defaultProjectPath: String {
        lastSessionProjectPath.nilIfEmpty
            ?? store.selectedAgent?.projectRoot?.nilIfEmpty
            ?? store.agents.compactMap { $0.projectRoot?.nilIfEmpty }.first
            ?? ""
    }

    private var sessionProjectOptions: [ScoutSessionProjectOption] {
        var seen: Set<String> = []
        var result: [ScoutSessionProjectOption] = []
        func append(path: String?, name: String? = nil, detail: String? = nil) {
            guard let path = path?.nilIfEmpty, !seen.contains(path) else { return }
            seen.insert(path)
            result.append(ScoutSessionProjectOption(
                path: path,
                name: name?.nilIfEmpty ?? URL(fileURLWithPath: path).lastPathComponent,
                detail: detail?.nilIfEmpty ?? (path as NSString).abbreviatingWithTildeInPath
            ))
        }

        append(path: lastSessionProjectPath, name: "Recent")
        append(path: store.selectedAgent?.projectRoot)
        for project in repos.projects {
            append(path: project.root, name: project.name)
            for worktree in project.worktrees {
                append(path: worktree.path, name: worktree.name, detail: project.name)
            }
        }
        for agent in store.agents {
            append(path: agent.projectRoot)
            append(path: agent.cwd)
        }
        append(path: defaultProjectPath)
        return result
    }

    private var visiblePendingConversations: [ScoutPendingConversation] {
        let channelIds = Set(store.channels.map(\.cId))
        return pendingConversations.filter { pending in
            guard let cId = pending.conversationId else { return true }
            return !channelIds.contains(cId)
        }
    }

    private func addPendingConversation(_ result: ScoutSessionStartResult, draft submittedDraft: ScoutSessionDraft) {
        guard let key = result.conversationId?.nilIfEmpty ?? result.flightId?.nilIfEmpty else { return }
        let pending = ScoutPendingConversation(
            id: key,
            conversationId: result.conversationId?.nilIfEmpty,
            flightId: result.flightId?.nilIfEmpty,
            title: pendingConversationTitle(for: submittedDraft),
            subtitle: pendingConversationSubtitle(for: submittedDraft),
            draft: submittedDraft,
            state: .starting
        )
        pendingConversations.removeAll { $0.id == pending.id }
        pendingConversations.insert(pending, at: 0)
        startPendingFlightMonitor(for: pending)
    }

    private func reconcilePendingConversations() {
        let channelIds = Set(store.channels.map(\.cId))
        pendingConversations.removeAll { pending in
            guard let cId = pending.conversationId else { return false }
            return channelIds.contains(cId)
        }
        for pending in pendingConversations where pendingFlightTasks[pending.id] == nil {
            startPendingFlightMonitor(for: pending)
        }
        cancelPendingFlightMonitorsForMissingRows()
    }

    private func retryPendingConversation(_ pending: ScoutPendingConversation) {
        pendingConversations.removeAll { $0.id == pending.id }
        pendingFlightTasks[pending.id]?.cancel()
        pendingFlightTasks[pending.id] = nil
        sessionDraft = pending.draft
    }

    private func selectPendingConversation(_ pending: ScoutPendingConversation) {
        guard let cId = pending.conversationId else { return }
        store.selectChannel(cId)
    }

    private func pendingConversationTitle(for draft: ScoutSessionDraft) -> String {
        switch draft.target {
        case .agent(let agent):
            return agent.displayName
        case .project:
            let path = draft.projectPath.trimmingCharacters(in: .whitespacesAndNewlines)
            let name = URL(fileURLWithPath: path).lastPathComponent
            return name.isEmpty ? "New chat" : name
        }
    }

    private func pendingConversationSubtitle(for draft: ScoutSessionDraft) -> String {
        if draft.mode == .continueContext {
            return "Continuing full context"
        }
        if draft.fromMessageId?.nilIfEmpty != nil {
            return "Branching from message"
        }
        return "Starting..."
    }

    private func startPendingFlightMonitor(for pending: ScoutPendingConversation) {
        pendingFlightTasks[pending.id]?.cancel()
        guard pending.conversationId?.nilIfEmpty != nil else { return }
        pendingFlightTasks[pending.id] = Task { [pending] in
            for _ in 0..<30 {
                if Task.isCancelled { return }
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                if Task.isCancelled { return }
                guard let status = try? await Self.fetchPendingFlightStatus(for: pending) else { continue }
                await MainActor.run {
                    applyPendingFlightStatus(status, pendingId: pending.id)
                }
                if status.isTerminal { return }
            }
            await MainActor.run {
                pendingFlightTasks[pending.id] = nil
            }
        }
    }

    private func applyPendingFlightStatus(_ status: ScoutPendingFlightStatus, pendingId: String) {
        guard let index = pendingConversations.firstIndex(where: { $0.id == pendingId }) else {
            pendingFlightTasks[pendingId]?.cancel()
            pendingFlightTasks[pendingId] = nil
            return
        }
        if status.isFailure {
            if status.removePendingRow {
                pendingConversations.remove(at: index)
            } else {
                pendingConversations[index].state = .failed(status.summary?.nilIfEmpty ?? "Flight \(status.state).")
            }
            pendingFlightTasks[pendingId]?.cancel()
            pendingFlightTasks[pendingId] = nil
        } else if status.isTerminal {
            pendingConversations.remove(at: index)
            pendingFlightTasks[pendingId]?.cancel()
            pendingFlightTasks[pendingId] = nil
            store.refresh(force: true)
        }
    }

    private func cancelPendingFlightMonitorsForMissingRows() {
        let liveIds = Set(pendingConversations.map(\.id))
        for id in Array(pendingFlightTasks.keys) where !liveIds.contains(id) {
            pendingFlightTasks[id]?.cancel()
            pendingFlightTasks[id] = nil
        }
    }

    private func cancelPendingFlightMonitors() {
        for task in pendingFlightTasks.values {
            task.cancel()
        }
        pendingFlightTasks = [:]
    }

    private static func fetchPendingFlightStatus(for pending: ScoutPendingConversation) async throws -> ScoutPendingFlightStatus? {
        guard let conversationId = pending.conversationId?.nilIfEmpty else { return nil }
        let url = ScoutWeb.baseURL()
            .appending(path: "api/flights")
            .appending(queryItems: [
                URLQueryItem(name: "conversationId", value: conversationId),
                URLQueryItem(name: "active", value: "false"),
            ])
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            return nil
        }
        let flights = try JSONDecoder().decode([ScoutPendingFlightStatus].self, from: data)
        if let flightId = pending.flightId?.nilIfEmpty,
           let match = flights.first(where: { $0.id == flightId }) {
            return match
        }
        if let flight = flights.first {
            return flight
        }
        return try await fetchPendingFailureMessageStatus(conversationId: conversationId, pending: pending)
    }

    private static func fetchPendingFailureMessageStatus(
        conversationId: String,
        pending: ScoutPendingConversation
    ) async throws -> ScoutPendingFlightStatus? {
        let url = ScoutWeb.baseURL()
            .appending(path: "api/messages")
            .appending(queryItems: [
                URLQueryItem(name: "conversationId", value: conversationId),
                URLQueryItem(name: "limit", value: "12"),
            ])
        let messages = try await ScoutHTTP.fetch([ScoutMessage].self, from: url)
        guard let failure = messages.first(where: { message in
            let statusLike = message.messageClass == "status"
                || message.metadata?.source == "broker"
                || message.metadata?.flightId != nil
            return statusLike
                && message.body.localizedCaseInsensitiveContains("failed")
                && (pending.flightId == nil || message.metadata?.flightId == pending.flightId)
        }) else {
            return nil
        }
        return ScoutPendingFlightStatus(
            id: pending.flightId?.nilIfEmpty ?? failure.id,
            state: "failed",
            summary: failure.body.components(separatedBy: .newlines).first?.nilIfEmpty,
            removePendingRow: true
        )
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

    private func chromeTitlebarActions(layout: ScoutShellLayout) -> [HudChromeTitlebarAction] {
        var actions = [
            HudChromeTitlebarAction(
                id: "scout.navigation",
                placement: .leading,
                label: layout.forcesNavigationCompact
                    ? "Navigation compact at this width"
                    : (railCompact ? "Expand navigation" : "Collapse navigation"),
                systemImage: "sidebar.left"
            ) {
                if !layout.forcesNavigationCompact {
                    withAnimation(HudSidebarMotion.expandCollapse) {
                        railCompact.toggle()
                    }
                }
            }
        ]
        if section != .settings {
            actions.append(HudChromeTitlebarAction(
                id: "scout.inspector",
                placement: .trailing,
                label: trailingPanelActionLabel(layout: layout),
                systemImage: "sidebar.right"
            ) {
                withAnimation(.easeOut(duration: 0.14)) {
                    if observeSidecarAgent != nil {
                        closeObserveSidecar()
                    } else if agentPreviewPanelAgent != nil {
                        closeAgentPreviewPanel()
                    } else if layout.autoHidesInspector {
                        compactInspectorPresented.toggle()
                        if compactInspectorPresented {
                            inspectorCollapsed = false
                        }
                    } else {
                        compactInspectorPresented = false
                        inspectorCollapsed.toggle()
                    }
                }
            })
        }
        return actions
    }

    @ViewBuilder
    private func content(layout: ScoutShellLayout) -> some View {
        switch section {
        case .comms:
            commsContent(layout: layout)
        case .agents:
            agentsContent
        case .repos:
            reposContent
        case .tail:
            tailContent
        case .settings:
            settingsContent
        }
    }

    private var settingsContent: some View {
        ScoutSettingsView(appearance: appearance)
    }

    private func commsContent(layout: ScoutShellLayout) -> some View {
        HStack(spacing: 0) {
            ScoutConversationListBar(
                isLoading: store.isLoading,
                query: $store.channelQuery,
                filter: $channelFilter,
                channels: commsListChannels,
                pendingConversations: visiblePendingConversations,
                selectedCId: store.selectedCId,
                newChannelIds: store.newChannelIds,
                hasActivity: store.workingAgentCount > 0,
                width: effectiveConversationListWidth(layout: layout),
                searchFocused: $searchFocused,
                onNewConversation: { startNewConversation() },
                onRefresh: { store.refresh(force: true) },
                onRetryPending: retryPendingConversation,
                onSelectPending: selectPendingConversation
            ) { channel in
                store.selectChannel(channel.cId)
            }
            .overlay(alignment: .trailing) {
                if layout.allowsConversationListResize {
                    ZStack(alignment: .trailing) {
                        ScoutConversationResizeHandle(
                            width: conversationListWidthBinding(layout: layout),
                            previewWidth: $conversationListResizePreviewWidth,
                            range: layout.conversationListWidthRange
                        )
                        .frame(width: ScoutDesign.conversationResizeHandleWidth)
                        .offset(x: ScoutDesign.conversationResizeHandleWidth / 2)
                    }
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
            if let channel = store.selectedChannel, channel.isObserverThread {
                ScoutObservingBanner(channel: channel)
            }
            if let ask = store.selectedChannel?.ask {
                ScoutPinnedAskBand(ask: ask)
            }
            messageList
            HudDivider(color: ScoutDesign.hairline)
            composer
        }
    }

    // One clean line: just the chat's handle. Chat identity and
    // participants live in the inspector so the header stays calm.
    private var chatHeader: some View {
        let channel = store.selectedChannel
        return ScoutColumnHeader {
            // The focal title of the band — larger than the list title (13) and
            // the inspector eyebrow, but pulled down from 18 to lg (16) so the
            // three column headers share one tighter type rhythm and their
            // bottom-aligned baselines sit closer across the band.
            Text(channel?.displayHandle ?? "Scout")
                .font(HudFont.ui(HudTextSize.lg, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
                .lineLimit(1)
                .truncationMode(.tail)
        } secondary: {
            // Proposal sub-line: a glyph-led mono fact strip (repo · branch ·
            // session) so the chat's context reads at a glance without opening
            // the inspector.
            if let channel {
                chatHeaderFacts(channel)
            }
        } trailing: {
            // Quiet ghost actions — bare glyphs that warm on hover, no bordered
            // pills. Observe watches the agent work; Message jumps to the reply.
            if channel != nil {
                HStack(spacing: HudSpacing.xs) {
                    ScoutComposerIconButton(
                        systemImage: "eye",
                        glyph: 13,
                        help: "Observe",
                        isEnabled: selectedChannelAgent != nil,
                        action: { if let agent = selectedChannelAgent { observeAgent(agent) } }
                    )
                    ScoutComposerIconButton(
                        systemImage: "bubble.left",
                        glyph: 13,
                        help: "Message",
                        isEnabled: store.selectedCId != nil,
                        action: focusComposer
                    )
                }
            }
        }
    }

    @ViewBuilder
    private func chatHeaderFacts(_ channel: ScoutChannel) -> some View {
        HStack(spacing: HudSpacing.xl) {
            if let repo = channelRepoName(channel) {
                headerFact("folder", repo)
            }
            if let branch = channel.currentBranch?.nilIfEmpty {
                headerFact("arrow.triangle.branch", branch)
            }
            headerFact("number", channel.sessionIdShort ?? channel.chatIdShort)
            Spacer(minLength: 0)
        }
    }

    private func headerFact(_ icon: String, _ text: String) -> some View {
        HStack(spacing: HudSpacing.xs) {
            Image(systemName: icon)
                .font(.system(size: 9))
                .foregroundStyle(ScoutPalette.dim)
            Text(text)
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ScoutPalette.muted)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .fixedSize()
    }

    private func channelRepoName(_ channel: ScoutChannel) -> String? {
        guard let root = channel.workspaceRoot?.nilIfEmpty else { return nil }
        return (root as NSString).lastPathComponent.nilIfEmpty ?? root
    }

    /// The agent backing the open conversation, if any — drives the header's
    /// Observe action.
    private var selectedChannelAgent: ScoutAgent? {
        guard let channel = store.selectedChannel, let agentId = channel.agentId else { return nil }
        return store.agents.first(where: { $0.id == agentId })
    }

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: HudSpacing.xxxl) {
                    if store.messages.isEmpty {
                        HudEmptyState(
                            title: store.selectedChannel == nil ? "No channel selected" : "No messages yet",
                            subtitle: store.selectedChannel == nil ? "Choose a chat from the list." : "This chat has no visible messages.",
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

                        // The agent's still-running turn, rendered as a transient
                        // row at the tail of the thread. It vanishes the same poll
                        // tick the finished message lands (activeTurn → nil).
                        if let activeTurn = store.activeTurn {
                            ScoutInFlightTurnRow(turn: activeTurn)
                                .id(Self.activeTurnAnchor)
                                .transition(.opacity)
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
                .background(alignment: .topLeading) {
                    // Connected timeline spine — a single neutral hairline down
                    // the avatar column; the opaque avatar tiles sit over it as
                    // nodes (the agent-lanes idiom). It starts at the first node
                    // and fades out at the tail so the end reads intentional
                    // whatever the thread length. The accent is never used here —
                    // the spine stays a whisper.
                    if !store.messages.isEmpty {
                        LinearGradient(
                            stops: [
                                .init(color: ScoutDesign.hairlineStrong, location: 0),
                                .init(color: ScoutDesign.hairlineStrong, location: 0.9),
                                .init(color: ScoutDesign.hairlineStrong.opacity(0), location: 1),
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                        .frame(width: 1)
                        .frame(maxHeight: .infinity)
                        .padding(.top, HudSpacing.huge + 14)
                        .padding(.bottom, HudSpacing.huge)
                        .offset(x: HudSpacing.huge + 13.5)
                        .allowsHitTesting(false)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .scoutOverlayScrollers()
                .animation(.easeOut(duration: 0.2), value: store.activeTurn)
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
            // Keep the thread pinned to the bottom as the in-flight row appears
            // and its headline/detail update, so progress stays in view.
            .onChange(of: store.activeTurn) { _, _ in
                guard followLatest, !store.messages.isEmpty else { return }
                withAnimation(.easeOut(duration: 0.16)) {
                    proxy.scrollTo(Self.messageListBottomAnchor, anchor: .bottom)
                }
            }
        }
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            if !pendingImages.isEmpty {
                composerAttachmentStrip
            }
            composerInputWell
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

    // Studio `.composerBox` — a single rounded box with an internal toolbar.
    // The field rides the top; a hairline-separated bar below (`.composerBar`)
    // carries the hint/status on the left and the harmonized attach · mic · send
    // controls on the right. The buttons live *inside* the box rather than
    // floating beside it. Focus is carried by the well's border, fill, and
    // shadow — no left-edge accent rule (banned styleguide treatment).
    private var composerInputWell: some View {
        VStack(spacing: 0) {
            composerFieldRow
            composerToolbarBar
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .fill(composerWellFill)
        )
        .clipShape(RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .stroke(composerWellBorder, lineWidth: HudStrokeWidth.thin)
        )
        // A shallow, crisp lift — not the old floaty 14pt glow — so the well
        // reads as a flat surface with a clean edge, matching the studio.
        .shadow(
            color: composerFocused ? ScoutPalette.accent.opacity(0.10) : ScoutSurface.shadow(0.12),
            radius: composerFocused ? 6 : 3,
            x: 0,
            y: 1
        )
        .dropDestination(for: URL.self) { urls, _ in
            addImages(from: urls)
        }
    }

    // The compose line: the multiline field plus an inline dictation waveform.
    // Keeps the original GeometryReader + ScoutComposerInputFrameKey measurement
    // intact (the suggestions popover anchors off it).
    private var composerFieldRow: some View {
        HStack(alignment: .top, spacing: HudSpacing.sm) {
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
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                GeometryReader { proxy in
                    Color.clear.preference(
                        key: ScoutComposerInputFrameKey.self,
                        value: proxy.frame(in: .named("scoutComposer"))
                    )
                }
            )

            if isDictating {
                ScoutWaveform(tint: isDictationProcessing ? ScoutPalette.muted : ScoutPalette.accent)
                    .frame(width: 26, height: 16)
                    .transition(.opacity)
            }
        }
        .padding(.leading, HudSpacing.xl)
        .padding(.trailing, HudSpacing.xl)
        .padding(.top, HudSpacing.lg)
        .padding(.bottom, HudSpacing.md)
        .frame(maxWidth: .infinity, minHeight: 38, alignment: .topLeading)
    }

    // Studio `.composerBar` — the internal toolbar: hint/status on the left,
    // the harmonized control cluster on the right, set off from the field by a
    // top hairline over a faintly recessed plane (the canvas bg, like the web).
    private var composerToolbarBar: some View {
        HStack(spacing: HudSpacing.sm) {
            if let status = composerStatusText {
                Text(status)
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(composerStatusTint)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            Spacer(minLength: HudSpacing.sm)
            composerAttachButton
            ScoutMicButton(box: 26, glyph: 13, action: toggleDictation)
            ScoutSendButton(
                isEnabled: composerReady,
                isSending: store.isSending,
                action: requestSend
            )
        }
        .padding(.leading, HudSpacing.xl)
        .padding(.trailing, HudSpacing.md)
        .padding(.vertical, HudSpacing.sm)
        .frame(maxWidth: .infinity)
        .background(composerBarFill)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(composerWellBorder)
                .frame(height: HudStrokeWidth.thin)
        }
    }

    // MARK: - Composer attachments

    private var composerAttachButton: some View {
        ScoutComposerIconButton(
            systemImage: "paperclip",
            glyph: 13,
            help: "Attach image",
            isEnabled: store.selectedCId != nil && !store.isSending,
            action: presentImagePicker
        )
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
            return ScoutSurface.inset
        }
        return composerFocused ? ScoutSurface.controlFocused : ScoutSurface.control
    }

    private var composerWellBorder: Color {
        if store.selectedCId == nil {
            return ScoutDesign.hairline
        }
        return composerFocused ? ScoutPalette.accent.opacity(0.6) : ScoutDesign.hairlineStrong
    }

    // The internal toolbar plane sits a step below the field — the canvas bg
    // (studio `.composerBar { background: var(--s-bg) }`) so the bar reads as a
    // recessed footer under the compose line, not part of the writing surface.
    private var composerBarFill: Color {
        store.selectedCId == nil ? ScoutSurface.inset : ScoutDesign.bg
    }

    // Status tints: errors/empty-state in dim, an active send in accent, the
    // resting hint in dim. Keeps the bar quiet until something needs saying.
    private var composerStatusTint: Color {
        if store.isSending { return ScoutPalette.accent }
        return ScoutPalette.dim
    }

    private var composerPlaceholder: String {
        // Observer thread: you're watching two agents, so the composer invites
        // you to step in. Sending posts as the operator and your turn becomes
        // the accent bubble — presence returns the moment you jump in.
        if store.selectedChannel?.isObserverThread == true {
            return "Jump in…"
        }
        if let steerLabel = composerSteerLabel {
            return steerLabel
        }
        if let title = store.selectedChannel?.displayHandle, !title.isEmpty {
            return "Message \(title)"
        }
        return "Message"
    }

    private var composerSteerLabel: String? {
        guard let channel = store.selectedChannel else { return nil }
        let targets = channel.participants
            .filter { participant in
                let kind = participant.kind?.lowercased()
                return participant.label.localizedCaseInsensitiveCompare("Operator") != .orderedSame
                    && kind != "person"
                    && kind != "system"
                    && kind != "device"
            }
            .map { $0.label }
        guard !targets.isEmpty else { return nil }
        if targets.count == 1, let target = targets.first {
            return "Steer \(target)"
        }
        if targets.count == 2 {
            return "Steer \(targets[0]) and \(targets[1])"
        }
        return "Steer \(targets.count) agents"
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
        if store.selectedChannel == nil { return "Select a chat to message" }
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
        return ScoutColumnHeader(horizontalPadding: ScoutDesign.listGutter, background: .clear) {
            HStack(spacing: HudSpacing.md) {
                Text("Agents")
                    .font(HudFont.ui(HudTextSize.base, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
                    .lineLimit(1)
                if store.isLoading {
                    ProgressView().controlSize(.small)
                }
            }
        } secondary: {
            EmptyView()
        } trailing: {
            HStack(spacing: HudSpacing.md) {
                if live > 0 {
                    HudBadge("\(live) live", tint: ScoutPalette.accent, dot: true)
                }
                HudBadge("\(total) agent\(total == 1 ? "" : "s")", tint: ScoutPalette.muted, dot: false)
            }
        }
    }

    /// Filter field + All/Live scope + fold controls. Mirrors the Comms
    /// controls strip; the filter binds the shared `searchFocused` so the bare
    /// j/k chords stay dead while typing.
    private var agentsPaneControls: some View {
        HStack(spacing: HudSpacing.md) {
            ScoutSearchField("Filter agents", text: $agentsFilterQuery, focus: $searchFocused)
            ScoutAgentScopeControl(liveOnly: $agentsLiveOnly)
            Spacer(minLength: HudSpacing.md)
            agentsFoldButton(title: "Expand", icon: "chevron.down") {
                agentsTree.collapsedProjects.removeAll()
            }
            agentsFoldButton(title: "Collapse", icon: "chevron.right") {
                for group in treeGroups { agentsTree.collapsedProjects.insert(group.key) }
            }
        }
        .padding(.horizontal, ScoutDesign.listGutter)
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
            .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(ScoutSurface.inset))
            .overlay(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .help("\(title) all projects")
    }

    /// Non-scrolling column header. State moved to the leading row dot — a text
    /// column of all-"AVAILABLE" carried no signal and squeezed the title — so
    /// the header is the AGENT label and a right-aligned UPDATED column that
    /// lines up with the rows.
    private var agentsColumnHeader: some View {
        HStack(spacing: HudSpacing.sm) {
            Text("AGENT")
                .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                .tracking(0.8)
                .foregroundStyle(ScoutPalette.dim)
            Spacer(minLength: HudSpacing.sm)
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
        ScoutTailContent(
            tail: tail,
            agents: store.agents,
            onOpenSession: { event in
                guard !event.sessionId.isEmpty else { return }
                withAnimation(.easeOut(duration: 0.14)) { tailSessionEvent = event }
            },
            onOpenAgent: { agent in
                observeAgent(agent)
            }
        )
    }

    private var reposContent: some View {
        // The repo-diff sheet (SCO-065) is presented at the app root (see `body`)
        // rather than here, so it sticks across section changes — open a diff in
        // Repos, switch to Comms/Tail, and it stays up until explicitly dismissed.
        ScoutReposContent(
            repos: repos,
            tree: reposTree,
            onActivate: { activateSelectedRepoRow() },
            onOpenDiff: { worktree in
                guard !worktree.path.isEmpty else { return }
                withAnimation(.easeOut(duration: 0.14)) { diffSheetRequest = .worktree(worktree) }
            }
        )
    }

    private var inspectorHeader: some View {
        let multiAgent = section == .comms && channelAgentMembers.count >= 2
        return HStack(spacing: HudSpacing.md) {
            ScoutEyebrow(text: inspectorTitle(multiAgent: multiAgent))
            Spacer()
            inspectorHeaderBadge(multiAgent: multiAgent)
        }
    }

    private func inspectorTitle(multiAgent: Bool) -> String {
        switch section {
        case .tail:
            return "Distribution"
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
        if section == .repos {
            // No verdict pill for a worktree — the inspector's Position block
            // carries current state calmly. Keep a project-level attention
            // summary, which reads as a roll-up rather than a per-branch verdict.
            if repos.worktree(id: reposTree.selectedWorktreeID) == nil,
               let project = repos.project(id: reposTree.selectedProjectID) {
                HudBadge(project.attention.rawValue, tint: reposAttentionColor(project.attention), dot: reposAttentionLive(project.attention))
            }
        }
        // No agent-state badge: the redesigned card carries no categorical status
        // word — liveness reads from the summary's accent `now`, not a tinted pill.
    }

    private var observeSidecarResolvedAgent: ScoutAgent? {
        guard let observeSidecarAgent else { return nil }
        return store.agents.first { $0.id == observeSidecarAgent.id } ?? observeSidecarAgent
    }

    private var agentPreviewResolvedAgent: ScoutAgent? {
        guard let agentPreviewPanelAgent else { return nil }
        return store.agents.first { $0.id == agentPreviewPanelAgent.id } ?? agentPreviewPanelAgent
    }

    private func trailingPanelActionLabel(layout: ScoutShellLayout) -> String {
        if observeSidecarAgent != nil { return "Close observe" }
        if agentPreviewPanelAgent != nil { return "Close agent preview" }
        if layout.autoHidesInspector {
            return compactInspectorPresented ? "Hide context" : "Show context"
        }
        return inspectorCollapsed ? "Show context" : "Hide context"
    }

    @ViewBuilder
    private func trailingPanel(layout: ScoutShellLayout) -> some View {
        Group {
            if section == .settings {
                EmptyView()
            } else if let target = fileViewer.target {
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
                        ScoutWeb.open(path: observeWebPath(for: agent))
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
            } else if showsDefaultInspector(layout: layout) {
                ScoutThemedSidebarPanel(
                    width: inspectorWidthBinding(layout: layout),
                    edge: .trailing,
                    widthRange: layout.inspectorWidthRange
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

    private func showsDefaultInspector(layout: ScoutShellLayout) -> Bool {
        guard !inspectorCollapsed else { return false }
        return !layout.autoHidesInspector || compactInspectorPresented
    }

    /// Chats attached to an agent, most-recent first — feeds the
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

    /// Bridge the agent profile's diff actions to the SCO-065 repo-diff sheet:
    /// resolve the agent's workspace to a scanned worktree and present it. When the
    /// workspace isn't a tracked worktree (repo-watch hasn't scanned it, or it's a
    /// nested cwd), fall back to opening the agent's diff on the web surface.
    private func openAgentDiff(_ agent: ScoutAgent, sessionScoped: Bool) {
        let candidates = [agent.cwd?.nilIfEmpty, agent.projectRoot?.nilIfEmpty].compactMap { $0 }
        guard !candidates.isEmpty else {
            ScoutWeb.open(path: "/agents/\(agent.id)?tab=diff")
            return
        }
        let worktrees = repos.snapshot.projects.flatMap(\.worktrees)
        let match = worktrees.first { candidates.contains($0.path) }
            ?? worktrees.first { worktree in candidates.contains { $0.hasPrefix(worktree.path) } }
        if let match {
            let request: ScoutDiffSheetRequest = sessionScoped
                ? .session(match, sessionId: agent.harnessSessionId, agentId: agent.id)
                : .worktree(match)
            withAnimation(.easeOut(duration: 0.14)) { diffSheetRequest = request }
        } else {
            ScoutWeb.open(path: "/agents/\(agent.id)?tab=diff")
        }
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
                ScoutReposInspector(
                    repos: repos,
                    tree: reposTree,
                    inputFocused: $repoAskFocused
                )
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
                            livePreview: livePreview(for: agent),
                            openTail: { tail.query = agent.harnessSessionId ?? ""; section = .tail },
                            openDiff: { openAgentDiff(agent, sessionScoped: true) },
                            openWorktreeDiff: { openAgentDiff(agent, sessionScoped: false) }
                        )
                        // The redesigned profile's summary (Activity · Context ·
                        // Files changed) reads the observe payload for the selected
                        // agent regardless of working state, so the cursor-slaved
                        // inspector loads it on every selection, not just for live
                        // agents.
                        .task(id: agent.id) {
                            store.loadObserve(agentId: agent.id, force: true)
                        }
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
                        openTail: { tail.query = agent.harnessSessionId ?? ""; section = .tail },
                        openDiff: { openAgentDiff(agent, sessionScoped: true) },
                        openWorktreeDiff: { openAgentDiff(agent, sessionScoped: false) }
                    )
                    .task(id: agent.id) {
                        store.loadObserve(agentId: agent.id, force: true)
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

    private func conversationListWidthBinding(layout: ScoutShellLayout) -> Binding<CGFloat> {
        Binding {
            effectiveConversationListWidth(layout: layout)
        } set: { nextWidth in
            let range = layout.conversationListWidthRange
            conversationListWidth = Double(min(max(nextWidth, range.lowerBound), range.upperBound))
        }
    }

    private func effectiveConversationListWidth(layout: ScoutShellLayout) -> CGFloat {
        layout.effectiveConversationListWidth(
            stored: CGFloat(conversationListWidth),
            preview: conversationListResizePreviewWidth
        )
    }

    private var inspectorWidthBinding: Binding<CGFloat> {
        Binding {
            CGFloat(inspectorWidth)
        } set: { nextWidth in
            let range = ScoutDesign.inspectorWidthRange
            inspectorWidth = Double(min(max(nextWidth, range.lowerBound), range.upperBound))
        }
    }

    private func inspectorWidthBinding(layout: ScoutShellLayout) -> Binding<CGFloat> {
        Binding {
            layout.effectiveInspectorWidth(stored: CGFloat(inspectorWidth))
        } set: { nextWidth in
            let range = layout.inspectorWidthRange
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

    private func navigationCompactBinding(layout: ScoutShellLayout) -> Binding<Bool> {
        Binding {
            effectiveRailCompact(layout: layout)
        } set: { nextCompact in
            if !layout.forcesNavigationCompact {
                railCompact = nextCompact
            }
        }
    }

    private func effectiveRailCompact(layout: ScoutShellLayout) -> Bool {
        layout.forcesNavigationCompact || railCompact
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

    private func observeWebPath(for agent: ScoutAgent) -> String {
        if let sessionRef = agent.harnessSessionId?.nilIfEmpty {
            let encoded = sessionRef.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? sessionRef
            return "/embed/session?ref=\(encoded)"
        }
        let encodedAgentId = agent.id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? agent.id
        return "/embed/observe/\(encodedAgentId)"
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

private struct ScoutShellLayout: Equatable {
    enum Mode: Equatable {
        case compact
        case balanced
        case wide
    }

    let windowWidth: CGFloat

    var mode: Mode {
        if windowWidth < 1120 {
            return .compact
        }
        if windowWidth < 1320 {
            return .balanced
        }
        return .wide
    }

    var forcesNavigationCompact: Bool {
        mode == .compact
    }

    var autoHidesInspector: Bool {
        mode == .compact
    }

    var allowsConversationListResize: Bool {
        mode != .compact
    }

    var conversationListWidthRange: ClosedRange<CGFloat> {
        switch mode {
        case .compact:
            return 196...212
        case .balanced:
            return 204...260
        case .wide:
            return ScoutDesign.conversationListWidthRange
        }
    }

    var inspectorWidthRange: ClosedRange<CGFloat> {
        switch mode {
        case .compact:
            return 240...280
        case .balanced:
            return 260...320
        case .wide:
            return ScoutDesign.inspectorWidthRange
        }
    }

    func effectiveConversationListWidth(stored: CGFloat, preview: CGFloat?) -> CGFloat {
        clamp(preview ?? stored, to: conversationListWidthRange)
    }

    func effectiveInspectorWidth(stored: CGFloat) -> CGFloat {
        clamp(stored, to: inspectorWidthRange)
    }

    private func clamp(_ value: CGFloat, to range: ClosedRange<CGFloat>) -> CGFloat {
        min(max(value, range.lowerBound), range.upperBound)
    }
}

enum ScoutDesign {
    static var bg: Color { ScoutPalette.bg }
    static var chrome: Color { ScoutPalette.chrome }
    static var surface: Color { ScoutPalette.surface }
    static var hairline: Color { ScoutPalette.hairline }
    static var hairlineStrong: Color { ScoutPalette.hairlineStrong }
    static let columnHeaderHeight = HudSidebarLayout.headerTopPadding
        + HudSidebarLayout.headerHeight
        + HudSidebarLayout.headerBottomPadding
    static let columnHeaderTopInset = HudSidebarLayout.headerTopPadding
    static let columnHeaderPrimaryRowHeight: CGFloat = 28
    static let columnHeaderLineGap: CGFloat = 2
    static let columnHeaderTrailingTopOffset: CGFloat = 2
    /// Header horizontal gutters by column class. content > list > panel,
    /// matching the natural column widths so titles never crowd the edge.
    static let columnGutter = HudSpacing.huge   // 28 — primary content columns
    static let listGutter = HudSpacing.xxl      // 14 — narrow resizable list columns
    static let panelGutter = HudSpacing.lg      // 10 — trailing inspector/panel columns
    static let conversationListWidthRange: ClosedRange<CGFloat> = 188...440
    static let inspectorWidthRange: ClosedRange<CGFloat> = 260...520
    static let conversationResizeHandleWidth: CGFloat = 12

    /// Agents-tree trailing columns. The STATE / UPDATED values right-align into
    /// these fixed widths so they line up under the pane's column header
    /// regardless of a row's depth indent.
    static let agentsStateColumnWidth: CGFloat = 104
    static let agentsUpdatedColumnWidth: CGFloat = 48

    static var theme: HudTheme {
        HudTheme(
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
}

private enum ScoutAgentContentMode {
    case roster
    case observe
}

/// The single column-header contract. Every column's first row is this 64pt
/// band (= the Hudson sidebar header height) so one continuous hairline runs
/// across the sidebar and every column. Background + bottom divider are owned
/// here, not by each call site, so the trim can't drift.
struct ScoutColumnHeader<Primary: View, Secondary: View, Trailing: View>: View {
    let horizontalPadding: CGFloat
    let background: Color
    let showsDivider: Bool
    let primary: Primary
    let secondary: Secondary
    let trailing: Trailing

    init(
        horizontalPadding: CGFloat = ScoutDesign.columnGutter,
        background: Color = ScoutDesign.bg,
        showsDivider: Bool = true,
        @ViewBuilder primary: () -> Primary,
        @ViewBuilder secondary: () -> Secondary,
        @ViewBuilder trailing: () -> Trailing
    ) {
        self.horizontalPadding = horizontalPadding
        self.background = background
        self.showsDivider = showsDivider
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
        .background(background)
        .overlay(alignment: .bottom) {
            if showsDivider {
                HudDivider(color: ScoutDesign.hairlineStrong)
            }
        }
    }
}

/// Status-bar tail counter — observes the tail store directly so its ~1.4s
/// updates re-render only this label, not the whole window. (The root reaches
/// tail through a non-publishing box precisely so this stays scoped.)
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
        .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(ScoutSurface.inset))
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
                        .fill(active ? ScoutSurface.selected(ScoutPalette.accent) : Color.clear)
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .help(title == "Live" ? "Only working / needs-attention agents" : "All agents")
    }
}

private struct ScoutSidebarSettingsButton: View {
    let isCompact: Bool
    let labelWidth: CGFloat
    let isSelected: Bool
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 0) {
                Image(systemName: isSelected || isHovering ? "gearshape.fill" : "gearshape")
                    .font(HudFont.ui(HudTextSize.base, weight: .semibold))
                    .foregroundStyle(iconColor)
                    .frame(width: HudSidebarLayout.railWidth, height: 32)

                Text("Settings")
                    .font(HudFont.ui(HudTextSize.sm, weight: isSelected ? .semibold : .medium))
                    .foregroundStyle(labelColor)
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
                    .padding(.leading, HudSidebarLayout.labelLeading)
                    .frame(width: labelWidth, alignment: .leading)
                    .opacity(isCompact ? 0 : 1)
            }
            .frame(width: HudSidebarLayout.railWidth + (isCompact ? 0 : labelWidth), height: 32, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .fill(rowBackground)
            )
            .contentShape(Rectangle())
            .clipped()
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .help("Settings")
        .accessibilityLabel("Settings")
        .onHover { isHovering = $0 }
        .animation(.easeOut(duration: 0.10), value: isHovering)
        .animation(.easeOut(duration: 0.10), value: isSelected)
        .animation(.easeOut(duration: 0.12), value: isCompact)
    }

    private var iconColor: Color {
        if isSelected { return ScoutPalette.accent }
        return isHovering ? ScoutPalette.ink : ScoutPalette.muted
    }

    private var labelColor: Color {
        if isSelected { return ScoutPalette.ink }
        return isHovering ? ScoutPalette.ink : ScoutPalette.muted
    }

    private var rowBackground: Color {
        if isSelected { return ScoutSurface.selected(ScoutPalette.accent) }
        if isHovering { return ScoutSurface.hover }
        return Color.clear
    }
}

struct ScoutMarkdownView: View {
    let text: String
    /// Workspace root of the agent that wrote this message — used to resolve
    /// relative file paths the agent quoted from its own context.
    var baseDirectory: String? = nil
    /// Themed text colors. Default to the standard palette so every existing
    /// call site is unchanged; the operator's accent-filled bubble passes light
    /// colors so its prose stays legible on the indigo fill.
    var inkColor: Color = ScoutPalette.ink
    var mutedColor: Color = ScoutPalette.muted
    var accentColor: Color = ScoutPalette.accent
    /// When true the content hugs its width (a content-sized bubble) instead of
    /// stretching to fill — a short turn then gets a short bubble.
    var hug: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            ForEach(MessageMarkupParser.parse(text)) { block in
                blockView(block)
            }
        }
        .frame(maxWidth: hug ? nil : .infinity, alignment: .leading)
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
                .foregroundStyle(inkColor)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, level == 1 ? HudSpacing.xs : 0)

        case .paragraph:
            Text(inline(block.text))
                .font(HudFont.ui(HudTextSize.base))
                .foregroundStyle(inkColor)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)

        case .blockquote:
            Text(inline(block.text))
                .font(HudFont.ui(HudTextSize.sm))
                .foregroundStyle(mutedColor)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
            .padding(.leading, HudSpacing.xl)
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(accentColor.opacity(0.4))
                    .frame(width: 2)
            }

        case .list(let ordered, let items):
            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    HStack(alignment: .top, spacing: HudSpacing.md) {
                        Text(ordered ? "\(index + 1)." : "-")
                            .font(HudFont.mono(HudTextSize.sm, weight: .semibold))
                            .foregroundStyle(accentColor)
                            .frame(width: ordered ? 24 : 10, alignment: .trailing)
                        Text(inline(item))
                            .font(HudFont.ui(HudTextSize.base))
                            .foregroundStyle(inkColor)
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
        return ScoutFileLinkifier.apply(to: parsed, accent: accentColor, baseDirectory: baseDirectory)
    }
}

private extension MessageCodeBlockStyle {
    static let scout = MessageCodeBlockStyle(
        labelFont: HudFont.mono(HudTextSize.micro, weight: .bold),
        codeFont: HudFont.mono(HudTextSize.xs),
        labelColor: ScoutPalette.dim,
        codeColor: ScoutPalette.ink,
        backgroundColor: ScoutSurface.inset,
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
        selectedBackgroundColor: ScoutSurface.selected(ScoutPalette.accent),
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

/// Composer control footprint — a 26pt rounded-square shared by every button
/// in the toolbar (attach · mic · send) so they read as one harmonized cluster
/// instead of three mismatched shapes. The ghost variant (attach/mic) is
/// transparent at rest and warms to a faint fill on hover; Send is the only
/// filled one. Keep this in sync with `ScoutSendButton` / `ScoutMicButton`.
private enum ScoutComposerControl {
    static let box: CGFloat = 26
    static let radius: CGFloat = HudRadius.standard
}

/// Ghost icon button for the composer toolbar (attach, and the visual base for
/// the mic): an SF Symbol over a transparent rounded-square that warms on hover.
private struct ScoutComposerIconButton: View {
    let systemImage: String
    var glyph: CGFloat = 13
    let help: String
    let isEnabled: Bool
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            ZStack {
                RoundedRectangle(cornerRadius: ScoutComposerControl.radius, style: .continuous)
                    .fill(hovering && isEnabled ? ScoutSurface.hover : Color.clear)
                Image(systemName: systemImage)
                    .font(.system(size: glyph, weight: .medium))
                    .foregroundStyle(hovering && isEnabled ? ScoutPalette.ink : ScoutPalette.muted)
            }
            .frame(width: ScoutComposerControl.box, height: ScoutComposerControl.box)
            .contentShape(RoundedRectangle(cornerRadius: ScoutComposerControl.radius, style: .continuous))
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .onHover { hovering = $0 }
        .help(help)
        .disabled(!isEnabled)
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
                RoundedRectangle(cornerRadius: ScoutComposerControl.radius, style: .continuous)
                    .fill(fillColor)

                RoundedRectangle(cornerRadius: ScoutComposerControl.radius, style: .continuous)
                    .stroke(borderColor, lineWidth: HudStrokeWidth.thin)

                content
            }
            .frame(width: ScoutComposerControl.box, height: ScoutComposerControl.box)
            .contentShape(RoundedRectangle(cornerRadius: ScoutComposerControl.radius, style: .continuous))
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
                .scaleEffect(0.56)
                .tint(ScoutPalette.dim)
        } else {
            Image(systemName: "arrow.up")
                .font(.system(size: HudTextSize.sm, weight: .bold))
                .foregroundStyle(iconColor)
        }
    }

    private var fillColor: Color {
        if !isEnabled || isSending {
            return ScoutSurface.inset
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
        // A rounded-square ghost matching the attach + send controls; at rest
        // it's transparent (just the muted glyph), warms on hover, and only
        // lights with an accent fill + ring while actively recording.
        Button(action: action) {
            ZStack {
                RoundedRectangle(cornerRadius: ScoutComposerControl.radius, style: .continuous)
                    .fill(micFillColor)
                    .frame(width: box, height: box)

                RoundedRectangle(cornerRadius: ScoutComposerControl.radius, style: .continuous)
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
            .contentShape(RoundedRectangle(cornerRadius: ScoutComposerControl.radius, style: .continuous))
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
            return ScoutSurface.hover
        }
        if hovering {
            return ScoutSurface.hover
        }
        return Color.clear
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
            .background(ScoutSurface.inset)
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
///
/// Internal (not file-private) so ScoutCommsView's ScoutConversationListBar,
/// which was extracted out of this file, can still reference it.
struct ScoutAmbientGlow: View {
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        ZStack {
            if scheme == .dark {
                // Rim light bleeding in from behind the panel's edges. The
                // stroke's outward blur is clipped at the panel bound, leaving
                // an inner halo.
                Rectangle()
                    .stroke(Color.white.opacity(0.12), lineWidth: HudStrokeWidth.bold)
                    .blur(radius: 11)

                // The source sits behind-and-above: a brighter bloom hugging the top.
                LinearGradient(
                    colors: [Color.white.opacity(0.10), Color.clear],
                    startPoint: .top,
                    endPoint: UnitPoint(x: 0.5, y: 0.22)
                )
            } else {
                // A white rim on a light panel just smudges. Light mode instead
                // gets a soft overhead sheen at the very top and a whisper of
                // shade along the bottom, so the panel reads as gently domed
                // rather than backlit.
                LinearGradient(
                    colors: [Color.white.opacity(0.28), Color.clear],
                    startPoint: .top,
                    endPoint: UnitPoint(x: 0.5, y: 0.16)
                )
                LinearGradient(
                    colors: [Color.clear, Color.black.opacity(0.03)],
                    startPoint: UnitPoint(x: 0.5, y: 0.6),
                    endPoint: .bottom
                )
            }
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
            .shadow(color: depthOn ? ScoutSurface.shadow(0.35) : .clear,
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
            // Section labels index the group without competing with the values
            // beneath them — but the hierarchy is carried by size, weight, and
            // tracking, not by fading the ink toward the background. Readable
            // `muted` keeps every eyebrow legible across the theme matrix.
            Text(text.uppercased())
                .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                .tracking(1.4)
                .foregroundStyle(ScoutPalette.muted)
        }
    }
}

/// Observer-first banner for an agent↔agent thread the operator is watching but
/// not part of. A quiet inset strip under the header — it explains why no turn
/// is "yours" (no accent bubble) until you jump in. Pairs with the "Jump in…"
/// composer placeholder.
private struct ScoutObservingBanner: View {
    let channel: ScoutChannel

    var body: some View {
        HStack(spacing: HudSpacing.sm) {
            Image(systemName: "eye")
                .font(.system(size: 11))
                .foregroundStyle(ScoutPalette.dim)
            Text("Observing — you're not in this thread")
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ScoutPalette.muted)
                .lineLimit(1)
            Spacer(minLength: HudSpacing.sm)
            Text(channel.rowTitle)
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ScoutPalette.dim)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .padding(.horizontal, HudSpacing.huge)
        .padding(.vertical, HudSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ScoutPalette.chrome)
        .overlay(alignment: .bottom) {
            HudDivider(color: ScoutDesign.hairline)
        }
    }
}

/// The pinned-ask that rides under the conversation header — re-crafted to the
/// Proposal as a recessed "screen": an inset plane with a hairline, inset from
/// the edges (not a full-bleed band). Neutral when answered (the resolved state
/// needs no attention, so no accent or amber); amber appears only while the ask
/// is still pending. The accent stays a whisper — it is not used here.
private struct ScoutPinnedAskBand: View {
    let ask: ScoutChannelAsk

    private var isPending: Bool { ask.state == .pending }
    private var tint: Color { isPending ? ScoutPalette.statusWarn : ScoutPalette.dim }

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            HStack(spacing: HudSpacing.sm) {
                Image(systemName: "pin.fill")
                    .font(.system(size: 9))
                    .foregroundStyle(tint)
                Text("PINNED ASK")
                    .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                    .tracking(1.2)
                    .foregroundStyle(tint)
                if isPending {
                    Text("PENDING")
                        .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                        .tracking(0.6)
                        .foregroundStyle(ScoutPalette.statusWarn)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(
                            RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                                .fill(ScoutPalette.statusWarn.opacity(0.18))
                        )
                } else {
                    Text("· answered")
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(ScoutPalette.dim)
                }
                Spacer(minLength: HudSpacing.sm)
                Text("from \(ask.from)")
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutPalette.dim)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            Text(ask.text)
                .font(HudFont.ui(HudTextSize.sm))
                .foregroundStyle(ScoutPalette.muted)
                .lineLimit(3)
                .truncationMode(.tail)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 560, alignment: .leading)
        }
        .padding(.horizontal, HudSpacing.lg)
        .padding(.vertical, HudSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        // Recessed screen — an inset plane with a hairline edge; reads as set
        // back into the surface rather than a callout sitting on top.
        .background(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .fill(ScoutSurface.inset)
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin)
        )
        // Inset from the edges so it floats in the gap below the header, aligned
        // to the thread gutter (`huge`).
        .padding(.horizontal, HudSpacing.huge)
        .padding(.top, HudSpacing.md)
        .padding(.bottom, HudSpacing.xs)
    }
}

/// Inspector-local key/value row with stronger text contrast than the generic
/// Hudson row. The panel is information dense, so labels stay secondary while
/// values remain readable at a glance.
private struct ScoutInspectorKVRow: View {
    let key: String
    let value: String
    var valueColor: Color = ScoutPalette.ink

    init(_ key: String, value: String, valueColor: Color = ScoutPalette.ink) {
        self.key = key
        self.value = value
        self.valueColor = valueColor
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
            Text(key.uppercased())
                .font(HudFont.mono(9, weight: .semibold))
                .tracking(0.9)
                .foregroundStyle(ScoutPalette.muted)
                .lineLimit(1)
            Spacer(minLength: HudSpacing.sm)
            Text(value)
                .font(HudFont.mono(11, weight: .medium))
                .foregroundStyle(valueColor)
                .multilineTextAlignment(.trailing)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
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
        .shadow(color: ScoutSurface.shadow(0.4), radius: 16, x: 0, y: 8)
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
    /// Opens the session-scoped repo diff for this agent's changed files.
    /// `nil` ⇒ hide the affordance.
    var openDiff: (() -> Void)? = nil
    var openWorktreeDiff: (() -> Void)? = nil

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

    /// The live observe payload for this agent — the data source for the summary
    /// (Activity · stats · Context) and Files changed. `nil` ⇒ those calm blocks
    /// fold away and the card is just essentials → sessions → runtime.
    private var observePayload: ScoutObservePayload? { livePreview?.observePayload }

    var body: some View {
        HudCard {
            VStack(alignment: .leading, spacing: HudSpacing.lg) {
                essentials
                agentEngage
                if let observe = observePayload, observe.hasSummarySignal {
                    HudDivider(color: ScoutDesign.hairline)
                    summary(observe)
                    HudDivider(color: ScoutDesign.hairline)
                    filesChanged(observe)
                }
                HudDivider(color: ScoutDesign.hairline)
                sessionsList
                HudDivider(color: ScoutDesign.hairline)
                runtimeFacts
                if !specialCapabilities.isEmpty {
                    HudDivider(color: ScoutDesign.hairline)
                    skills
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scoutDepth()
    }

    /// Sessions attached to this agent. Rows are navigation-first: role +
    /// metadata at rest (no height-shifting hover swap), expanding to a
    /// mini-card with the full action set plus both identity layers: harness
    /// `sessionId` first, then Scout chat id. Those per-session verbs live here, on
    /// the session they act on; the header carries the only global action,
    /// "+ New session". Only one row expands at a time.
    private var sessionsList: some View {
        let live = observePayload?.data.live ?? false
        return VStack(alignment: .leading, spacing: HudSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
                ScoutEyebrow(text: "Sessions")
                Spacer(minLength: 0)
                ScoutInspectorActionButton(icon: "plus", title: "New session", filled: false, action: { startSession(.fresh) })
            }
            if agentChannels.isEmpty {
                Text("No sessions yet")
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(ScoutPalette.dim)
            } else {
                ForEach(agentChannels.prefix(6)) { channel in
                    ScoutInspectorSessionRow(
                        channel: channel,
                        sessionId: channel.sessionId,
                        role: agent.roleLabel,
                        isWorking: live && channel.cId == selectedChannel?.cId,
                        isExpanded: expandedSessionCId == channel.cId,
                        onToggle: {
                            withAnimation(.spring(response: 0.3, dampingFraction: 0.86)) {
                                expandedSessionCId = expandedSessionCId == channel.cId ? nil : channel.cId
                            }
                        },
                        onObserve: openObserve,
                        onTakeover: { ScoutWeb.open(path: "/terminal/\(agent.id)?mode=takeover") },
                        onMessage: { openSession(channel) },
                        onFork: { startSession(.continueContext) }
                    )
                }
            }
        }
    }

    // MARK: Essentials — Tiered+ glyph header
    //
    // The sober identity (a deterministic sprite + dim @handle), a copy-details
    // button, then a 2×2 grid of the five facts as label-less glyph rows:
    // path · branch on top, host · harness/model below. No word labels and no
    // status tag — the avatar is neutral; liveness reads from the summary's
    // accent `now`, never a badge here. (New session lives with Sessions.)
    private var essentials: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            HStack(alignment: .center, spacing: HudSpacing.md) {
                Button(action: openProfile) {
                    HStack(alignment: .center, spacing: HudSpacing.md) {
                        SpriteAvatarView(name: agent.displayName, size: 40, tile: true)
                            .shadow(color: ScoutSurface.shadow(0.4), radius: 6, x: 0, y: 3)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(agent.displayName)
                                .font(HudFont.ui(HudTextSize.lg, weight: .semibold))
                                .foregroundStyle(ScoutPalette.ink)
                                .lineLimit(1)
                            Text(handleLabel)
                                .font(HudFont.mono(HudTextSize.micro))
                                .foregroundStyle(ScoutPalette.dim)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                        .contentShape(Rectangle())
                    }
                }
                .buttonStyle(.plain).scoutPointerCursor()
                .help("Open \(agent.displayName)'s profile")

                Spacer(minLength: HudSpacing.sm)

                ScoutCopyButton(text: cardSummary, help: "Copy agent details")
            }
            glyphFacts
        }
    }

    /// Agent-level engage — Observe (the native pane) + Take over (the web's
    /// live terminal). Both operate the agent's bound session, so the bar only
    /// shows when there's a live session to engage. Per-session engage lives on
    /// each row below; this is the one-tap path into the agent's current work.
    @ViewBuilder
    private var agentEngage: some View {
        if sessionId != nil {
            HStack(spacing: HudSpacing.sm) {
                ScoutObserveChip(action: openObserve)
                ScoutTakeoverChip(action: { ScoutWeb.open(path: "/terminal/\(agent.id)?mode=takeover") })
                Spacer(minLength: 0)
            }
        }
    }

    /// Dim @handle — identity, not status. Falls back to the agent id.
    private var handleLabel: String {
        if let handle = agent.handle?.nilIfEmpty {
            return handle.hasPrefix("@") ? handle : "@\(handle)"
        }
        return agent.id
    }

    /// The 2×2 glyph grid — one faint line-glyph per fact, no word labels.
    /// Folder→path & branch on top; host & chip (harness·model) below. Built from
    /// even-width columns (no `Grid`) so the values truncate symmetrically.
    private var glyphFacts: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: HudSpacing.md) {
                ScoutGlyphFact(glyph: "folder", value: scoutHomeTilde(agent.workspace))
                    .frame(maxWidth: .infinity, alignment: .leading)
                ScoutGlyphFact(glyph: "arrow.triangle.branch", value: agent.branchLabel)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack(alignment: .firstTextBaseline, spacing: HudSpacing.md) {
                ScoutGlyphFact(glyph: "desktopcomputer", value: agent.nodeName?.nilIfEmpty ?? "—")
                    .frame(maxWidth: .infinity, alignment: .leading)
                ScoutGlyphFact(glyph: "cpu", value: chipLabel)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    /// Merged harness · model — the studio's chip cell. Either side may be empty.
    private var chipLabel: String {
        [agent.harness?.nilIfEmpty, agent.model?.nilIfEmpty]
            .compactMap { $0 }
            .joined(separator: " · ")
            .nilIfEmpty ?? "—"
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
        if let selectedChannel { lines.append("chat      \(selectedChannel.chatId)") }
        if let sessionId { lines.append("harnessSession \(sessionId)") }
        return lines.joined(separator: "\n")
    }

    // MARK: Summary — Activity rhythm + stats + quantifiable Context
    //
    // Concise and shallow: the rhythm sparkline (events binned over the window),
    // the flat stats readout (turns · tools · edits · reads · files · window),
    // and Context as purely quantifiable (a token-fill gauge + turns + total).
    // No "aging/stale" word, no present-tense status — liveness is the accent
    // `now` over the sparkline.
    private func summary(_ payload: ScoutObservePayload) -> some View {
        let events = payload.data.events
        let turns = payload.data.metadata?.session?.turnCount ?? 0
        let tools = events.filter { $0.kind == .tool }.count
        let edits = events.filter { $0.kind == .tool && scoutIsEditTool($0.tool) }.count
        let reads = events.filter { $0.kind == .tool && scoutIsReadTool($0.tool) }.count
        let files = payload.data.files.count
        return VStack(alignment: .leading, spacing: HudSpacing.md) {
            VStack(alignment: .leading, spacing: HudSpacing.xs) {
                ScoutEyebrow(text: "Activity")
                ScoutActivitySparkline(bins: scoutActivityBins(events))
                HStack(spacing: 0) {
                    Text(scoutWindowSpan(events) + " ago")
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(ScoutPalette.dim)
                    Spacer(minLength: 0)
                    Text("now")
                        .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                        .tracking(0.4)
                        .foregroundStyle(payload.data.live ? ScoutPalette.accent : ScoutPalette.dim)
                }
            }
            VStack(alignment: .leading, spacing: HudSpacing.xs) {
                HStack(alignment: .firstTextBaseline, spacing: HudSpacing.md) {
                    metric("turns", "\(turns)")
                    metric("tools", scoutFmtK(tools))
                    metric("edits", scoutFmtK(edits))
                }
                HStack(alignment: .firstTextBaseline, spacing: HudSpacing.md) {
                    metric("reads", scoutFmtK(reads))
                    metric("files", scoutFmtK(files))
                    metric("window", scoutWindowSpan(events))
                }
            }
            if payload.data.metadata?.usage != nil || !payload.data.contextUsage.isEmpty {
                contextGauge(payload)
            }
        }
    }

    /// One flat stat cell — value bright, unit faint. Even-width via the parent.
    private func metric(_ key: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.xs) {
            Text(value)
                .font(HudFont.mono(HudTextSize.sm, weight: .medium))
                .foregroundStyle(ScoutPalette.ink)
                .lineLimit(1)
            Text(key.uppercased())
                .font(HudFont.mono(8, weight: .semibold))
                .tracking(0.4)
                .foregroundStyle(ScoutPalette.dim)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Context size, purely quantifiable: a token-fill gauge (used / window %),
    /// then turns + total tokens. The numbers speak — no categorical state word.
    private func contextGauge(_ payload: ScoutObservePayload) -> some View {
        let usage = payload.data.metadata?.usage
        let fill = scoutContextFill(payload)
        let window = usage?.contextWindowTokens
        let used = window.map { Int((Double($0) * Double(fill) / 100).rounded()) }
        let turns = payload.data.metadata?.session?.turnCount
        let total = usage?.totalTokens
        return VStack(alignment: .leading, spacing: HudSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
                ScoutEyebrow(text: "Context")
                Spacer(minLength: 0)
                Text("\(fill)%")
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutPalette.dim)
            }
            if let used, let window {
                Text("\(scoutFmtK(used)) / \(scoutFmtK(window)) ctx")
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutPalette.muted)
            }
            ScoutContextGauge(fill: fill)
            Text(scoutContextFootline(turns: turns, total: total))
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(ScoutPalette.dim)
        }
    }

    // MARK: Files changed — changed-first, bridges to the full diff
    //
    // What the session actually produced: created/modified first (accent +/~),
    // read-only dimmed. Parent/filename, not the absolute path. "Open full diff"
    // navigates to the embedded repo-diff for this agent's worktree.
    private func filesChanged(_ payload: ScoutObservePayload) -> some View {
        let files = payload.data.files
        let ordered = files.sorted { lhs, rhs in
            let lr = lhs.state.lowercased() == "read" ? 0 : 1
            let rr = rhs.state.lowercased() == "read" ? 0 : 1
            if lr != rr { return lr > rr }
            return lhs.touches > rhs.touches
        }
        let shown = Array(ordered.prefix(5))
        let changedCount = files.filter { $0.state.lowercased() != "read" }.count
        return VStack(alignment: .leading, spacing: HudSpacing.sm) {
            HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
                ScoutEyebrow(text: "Files changed")
                Spacer(minLength: HudSpacing.sm)
                if !files.isEmpty {
                    Text("\(changedCount) of \(files.count)")
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(ScoutPalette.dim)
                }
            }
            if shown.isEmpty {
                Text("No file touches yet")
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(ScoutPalette.dim)
            } else {
                ForEach(shown) { file in fileChangedRow(file) }
                if openDiff != nil || openWorktreeDiff != nil {
                    HStack(spacing: HudSpacing.md) {
                        if let openDiff {
                            diffLink(title: "Open session diff", emphasis: true, action: openDiff)
                                .help("Open a path-filtered diff for files this session changed")
                        }
                        if let openWorktreeDiff {
                            diffLink(title: "Worktree diff", emphasis: false, action: openWorktreeDiff)
                                .help("Open the full repo diff for this worktree")
                        }
                    }
                    .padding(.top, 2)
                }
            }
        }
    }

    private func diffLink(title: String, emphasis: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: HudSpacing.xs) {
                Text(title)
                    .font(HudFont.mono(HudTextSize.micro, weight: emphasis ? .semibold : .medium))
                    .tracking(0.4)
                Image(systemName: "arrow.right")
                    .font(.system(size: 8, weight: .bold))
            }
            .foregroundStyle(emphasis ? ScoutPalette.accent : ScoutPalette.dim)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain).scoutPointerCursor()
    }

    @ViewBuilder
    private func fileChangedRow(_ file: ScoutObserveFile) -> some View {
        let isRead = file.state.lowercased() == "read"
        let parts = file.path.split(separator: "/").map(String.init)
        let name = parts.last ?? file.path
        let dir = parts.count >= 2 ? parts[parts.count - 2] + "/" : ""
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.xs) {
            Text(scoutFileMark(file.state))
                .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                .foregroundStyle(isRead ? ScoutPalette.dim : ScoutPalette.accent)
                .frame(width: 8, alignment: .leading)
            (Text(dir).foregroundStyle(ScoutPalette.dim)
                + Text(name).foregroundStyle(isRead ? ScoutPalette.muted : ScoutPalette.ink))
                .font(HudFont.mono(HudTextSize.micro))
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: HudSpacing.sm)
            Text("×\(file.touches)")
                .font(HudFont.mono(8))
                .foregroundStyle(ScoutPalette.dim)
        }
        .help("\(file.path) · \(file.state)")
    }

    /// Runtime — the facts the glyph header doesn't carry (harness · model · host
    /// · branch · path live up top now). Transport · Role · Class, plus the bound
    /// session id when one exists.
    private var runtimeFacts: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            ScoutEyebrow(text: "Runtime")
            ScoutInspectorKVRow("Harness", value: agent.harness?.nilIfEmpty ?? "—", valueColor: agent.harness?.nilIfEmpty == nil ? ScoutPalette.muted : ScoutPalette.ink)
            ScoutAgentModelRow(agent: agent)
            ScoutInspectorKVRow("Transport", value: agent.transport?.nilIfEmpty ?? "—", valueColor: agent.transport?.nilIfEmpty == nil ? ScoutPalette.muted : ScoutPalette.ink)
            ScoutInspectorKVRow("Role", value: agent.roleLabel)
            ScoutInspectorKVRow("Class", value: agent.agentClass?.nilIfEmpty ?? "—", valueColor: agent.agentClass?.nilIfEmpty == nil ? ScoutPalette.muted : ScoutPalette.ink)
            if let sessionId {
                ScoutCopyKVRow(key: "Harness session", value: sessionId)
            }
        }
    }

    private var skills: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            ScoutEyebrow(text: "Skills")
            ScoutAgentAbilityList(capabilities: specialCapabilities)
        }
    }
}

// MARK: - Agent profile · summary helpers
//
// Small, dependency-free derivations + two Canvas charts for the redesigned
// agent profile inspector (`ScoutAgentInspector`): event binning, token-fill,
// compact number/window formatting, and the rhythm sparkline + token-fill gauge.
// Single emerald accent only; the gauge fill is neutral (context size isn't
// liveness). Canvas (not GeometryReader) so the charts don't churn on scroll.

private func scoutIsEditTool(_ tool: String?) -> Bool {
    guard let t = tool?.lowercased() else { return false }
    return ["edit", "write", "str_replace", "apply_patch", "multiedit"].contains(t)
}

private func scoutIsReadTool(_ tool: String?) -> Bool {
    guard let t = tool?.lowercased() else { return false }
    return ["read", "read_file", "open", "view"].contains(t)
}

private func scoutFileMark(_ state: String) -> String {
    switch state.lowercased() {
    case "created", "added", "new": return "+"
    case "modified", "changed", "edited": return "~"
    default: return "·"
    }
}

/// Compact integer — 1_240_000 → "1.2M", 38_000 → "38k", 71 → "71".
private func scoutFmtK(_ value: Int) -> String {
    let magnitude = abs(value)
    if magnitude >= 1_000_000 {
        return String(format: "%.1fM", Double(value) / 1_000_000).replacingOccurrences(of: ".0M", with: "M")
    }
    if magnitude >= 1_000 {
        return String(format: "%.1fk", Double(value) / 1_000).replacingOccurrences(of: ".0k", with: "k")
    }
    return "\(value)"
}

/// The session window span from the newest event's offset (events carry `t` as
/// seconds from session start). "16h" / "42m" / "8s".
private func scoutWindowSpan(_ events: [ScoutObserveEvent]) -> String {
    let span = events.map(\.t).max() ?? 0
    let seconds = max(0, Int(span.rounded()))
    if seconds < 60 { return "\(seconds)s" }
    let minutes = seconds / 60
    if minutes < 60 { return "\(minutes)m" }
    let hours = minutes / 60
    if hours < 24 { return "\(hours)h" }
    return "\(hours / 24)d"
}

/// Events binned across the window into intensity buckets — the sparkline's
/// shape. Quiet warm-up, bursts, idle stretches, all from per-event `t`.
private func scoutActivityBins(_ events: [ScoutObserveEvent], bins: Int = 32) -> [Int] {
    guard !events.isEmpty else { return Array(repeating: 0, count: bins) }
    let maxT = events.map(\.t).max() ?? 0
    var out = Array(repeating: 0, count: bins)
    guard maxT > 0 else {
        out[bins - 1] = events.count
        return out
    }
    for event in events {
        let frac = min(0.999_99, max(0, event.t / maxT))
        let idx = min(bins - 1, Int(frac * Double(bins)))
        out[idx] += 1
    }
    return out
}

/// Token-fill percent (0…100). Prefers the backend's per-turn context-usage
/// series; falls back to total/window when only usage totals are present.
private func scoutContextFill(_ payload: ScoutObservePayload) -> Int {
    if let last = payload.data.contextUsage.last {
        let pct = last <= 1 ? last * 100 : last
        return min(100, max(0, Int(pct.rounded())))
    }
    if let usage = payload.data.metadata?.usage,
       let window = usage.contextWindowTokens, window > 0,
       let total = usage.totalTokens {
        return min(100, max(0, Int((Double(total) / Double(window) * 100).rounded())))
    }
    return 0
}

/// "80 turns · 1.2M tokens" — whichever quantities are present.
private func scoutContextFootline(turns: Int?, total: Int?) -> String {
    var parts: [String] = []
    if let turns { parts.append("\(turns) turns") }
    if let total { parts.append("\(scoutFmtK(total)) tokens") }
    return parts.isEmpty ? "—" : parts.joined(separator: " · ")
}

extension ScoutObservePayload {
    /// True when the payload carries enough to draw the calm summary + files
    /// blocks (any events, files, or usage) — else those blocks fold away.
    var hasSummarySignal: Bool {
        !data.events.isEmpty || !data.files.isEmpty
            || data.metadata?.usage != nil || !data.contextUsage.isEmpty
    }
}

/// One label-less glyph fact for the Tiered+ header — a faint line-glyph + a
/// truncating mono value. The format carries the meaning; no word label.
private struct ScoutGlyphFact: View {
    let glyph: String
    let value: String

    var body: some View {
        HStack(spacing: HudSpacing.xs) {
            Image(systemName: glyph)
                .font(.system(size: 10, weight: .regular))
                .foregroundStyle(ScoutPalette.dim)
                .frame(width: 12)
            Text(value)
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(ScoutPalette.muted)
                .lineLimit(1)
                .truncationMode(.middle)
        }
    }
}

/// The Activity rhythm chart — intensity bars across the window, brighter where
/// busier (single accent, opacity = intensity). Start → now, left → right.
private struct ScoutActivitySparkline: View {
    let bins: [Int]

    var body: some View {
        Canvas { ctx, size in
            let maxV = max(bins.max() ?? 1, 1)
            let count = max(bins.count, 1)
            let gap: CGFloat = 1
            let bw = max(1, (size.width - gap * CGFloat(count - 1)) / CGFloat(count))
            for (i, v) in bins.enumerated() {
                let h = max(1, CGFloat(v) / CGFloat(maxV) * size.height)
                let x = CGFloat(i) * (bw + gap)
                let rect = CGRect(x: x, y: size.height - h, width: bw, height: h)
                let opacity = 0.22 + 0.62 * (Double(v) / Double(maxV))
                ctx.fill(Path(rect), with: .color(ScoutPalette.accent.opacity(opacity)))
            }
        }
        .frame(height: 22)
        .frame(maxWidth: .infinity)
        .accessibilityHidden(true)
    }
}

/// The token-fill gauge — a thin track with a neutral fill (context size is a
/// quantity, not liveness, so it stays muted, not accent).
private struct ScoutContextGauge: View {
    /// 0…100.
    let fill: Int

    var body: some View {
        Canvas { ctx, size in
            let radius = size.height / 2
            let track = Path(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: radius)
            ctx.fill(track, with: .color(ScoutPalette.surface))
            let width = max(0, min(size.width, size.width * CGFloat(fill) / 100))
            if width > 0 {
                let fillRect = CGRect(x: 0, y: 0, width: width, height: size.height)
                ctx.fill(Path(roundedRect: fillRect, cornerRadius: radius), with: .color(ScoutPalette.muted))
            }
        }
        .frame(height: 3)
        .frame(maxWidth: .infinity)
        .accessibilityHidden(true)
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

    // The newest meaningful event becomes the focal "current action" line; the
    // few before it ride a quieter mini-tail beneath. `events` is newest-first.
    private var focalEvent: ScoutObserveEvent? { events.first }
    private var miniTail: [ScoutObserveEvent] {
        Array(events.dropFirst().prefix(3))
    }
    private var isLive: Bool { focalEvent?.live ?? false }

    // NOW — a single promoted current-action line with a live caret, over a
    // compact mini-tail of the few preceding events.
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
            } else if let focal = focalEvent {
                focalRow(focal)
                if !miniTail.isEmpty {
                    VStack(alignment: .leading, spacing: HudSpacing.xs) {
                        ForEach(miniTail) { event in miniTailRow(event) }
                    }
                    .padding(.top, HudSpacing.xxs)
                }
            } else {
                hint(preview.observeError != nil ? "Observe unavailable" : "Waiting for activity")
            }
        }
    }

    // The focal current-action line: a prominent one-liner derived from the
    // latest event, trailed by a blinking caret while the turn is live.
    @ViewBuilder
    private func focalRow(_ event: ScoutObserveEvent) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
            Image(systemName: event.kind.liveIcon)
                .font(.system(size: 10))
                .foregroundStyle(event.kind.liveTint)
                .frame(width: 13)
            HStack(alignment: .firstTextBaseline, spacing: HudSpacing.xs) {
                Text(focalActionText(event))
                    .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                    .foregroundStyle(ScoutPalette.ink)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                if isLive {
                    ScoutLiveCaret()
                }
            }
            Spacer(minLength: HudSpacing.sm)
            Text(event.timelineLabel)
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(ScoutPalette.muted)
        }
    }

    // A compact, quiet preceding event: kind tag + text on one line.
    @ViewBuilder
    private func miniTailRow(_ event: ScoutObserveEvent) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.xs) {
            Text(event.kind.liveLabel)
                .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                .foregroundStyle(event.kind.liveTint.opacity(0.75))
                .frame(width: 30, alignment: .leading)
            Text(miniTailText(event))
                .font(HudFont.ui(HudTextSize.xxs))
                .foregroundStyle(ScoutPalette.muted)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: HudSpacing.sm)
            Text(event.timelineLabel)
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(ScoutPalette.dim)
        }
    }

    // A human-readable current-action phrase, e.g. "editing Foo.swift".
    private func focalActionText(_ event: ScoutObserveEvent) -> String {
        let object = event.text.nilIfEmpty ?? event.arg.flatMap(\.nilIfEmpty)
        if let tool = event.tool?.nilIfEmpty {
            let verb = scoutToolVerb(tool)
            if let object {
                return "\(verb) \(object)"
            }
            return verb
        }
        if let object {
            return object
        }
        return event.kind.liveLabel.capitalized
    }

    private func miniTailText(_ event: ScoutObserveEvent) -> String {
        let object = event.text.nilIfEmpty ?? event.arg.flatMap(\.nilIfEmpty)
        if let tool = event.tool?.nilIfEmpty {
            if let object {
                return "\(tool) · \(object)"
            }
            return tool
        }
        return object ?? event.kind.liveLabel.capitalized
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
                .foregroundStyle(ScoutPalette.muted)
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
                        .foregroundStyle(ScoutPalette.muted)
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
                    .foregroundStyle(ScoutPalette.muted)
            }
        }
    }

    private var wellDivider: some View {
        Rectangle()
            .fill(ScoutPalette.muted.opacity(0.24))
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
            .font(HudFont.mono(HudTextSize.xxs, weight: .medium))
            .foregroundStyle(ScoutPalette.muted)
    }

    @ViewBuilder
    private func wellLink(_ label: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: HudSpacing.xs) {
                Image(systemName: icon).font(.system(size: 8))
                Text(label.uppercased())
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
            }
            .foregroundStyle(ScoutPalette.muted)
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

/// A tiny terminal-style caret that fades on a slow repeat to signal the
/// focal action is still live — the inspector's heartbeat. Honors
/// reduce-motion (holds a steady dim caret instead of blinking).
private struct ScoutLiveCaret: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var on = false

    var body: some View {
        Rectangle()
            .fill(ScoutPalette.accent)
            .frame(width: 6, height: 12)
            .opacity(reduceMotion ? 0.7 : (on ? 0.9 : 0.18))
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true)) {
                    on = true
                }
            }
            .accessibilityHidden(true)
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

/// Maps a raw tool name to a present-participle action verb so the focal
/// "Now" line reads as what the agent is doing, e.g. "editing Foo.swift".
private func scoutToolVerb(_ tool: String) -> String {
    switch tool.lowercased() {
    case "edit", "write", "str_replace", "apply_patch", "multiedit": return "editing"
    case "read", "read_file", "open", "view": return "reading"
    case "grep", "search", "rg", "glob", "find": return "searching"
    case "bash", "shell", "run", "exec", "terminal": return "running"
    case "ls", "list": return "listing"
    case "fetch", "webfetch", "curl", "http": return "fetching"
    default: return tool
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
                .background(Circle().fill(hovering ? ScoutSurface.hover : Color.clear))
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
                    .font(HudFont.mono(9, weight: .semibold))
                    .tracking(0.9)
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

private func scoutShortIdentifier(_ value: String, prefix: Int = 10) -> String {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmed.count > prefix else { return trimmed }
    return String(trimmed.prefix(prefix))
}

/// A session in the inspector's Sessions list, with progressive disclosure:
///  · rest    — dot · title · role badge · age, then a metadata line
///  · hover   — quick actions (Observe / Message) replace the age
///  · engaged — tap to expand into a mini-card: full session id/chat id/path/branch/msgs +
///              the per-session action set (Observe · Message · Fork; Take over
///              joins once it has a backend).
private struct ScoutInspectorSessionRow: View {
    let channel: ScoutChannel
    let sessionId: String?
    let role: String
    /// True only when the agent is live AND this is the session in focus — the
    /// dot lights for active work, not merely for being selected.
    let isWorking: Bool
    let isExpanded: Bool
    let onToggle: () -> Void
    let onObserve: () -> Void
    let onTakeover: () -> Void
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
                .fill(isExpanded ? ScoutPalette.bg : (hovering ? ScoutSurface.hover : Color.clear))
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
                        .fill(isWorking ? ScoutPalette.accent : ScoutPalette.dim)
                        .frame(width: 5, height: 5)
                        .shadow(color: isWorking ? ScoutPalette.accent.opacity(0.6) : .clear, radius: 2.5)
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

            // Per-session engage, surfaced without a tap: always on the working
            // row, hover-revealed on the rest. The expanded card carries the
            // full labeled set (Observe · Take over · Message · Fork).
            if !isExpanded && (hovering || isWorking) {
                ScoutRowQuickAction(icon: "eye", help: "Observe", accent: true, action: onObserve)
                ScoutRowQuickAction(icon: "hand.raised", help: "Take over", accent: false, action: onTakeover)
            }

            if isExpanded {
                Image(systemName: "chevron.up")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(ScoutPalette.dim)
            } else {
                Text(channel.ageLabel)
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutPalette.muted)
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
                    .stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
            )
            .fixedSize()
    }

    private var metaLine: some View {
        HStack(spacing: HudSpacing.xs) {
            if let sessionId = sessionId?.nilIfEmpty {
                Text("session \(scoutShortIdentifier(sessionId))")
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .foregroundStyle(ScoutPalette.dim)
                    .lineLimit(1)
                    .help("Session id: \(sessionId)")
            }
            Text(channel.chatIdShort)
                .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                .foregroundStyle(ScoutPalette.dim)
                .lineLimit(1)
                .help("Chat ID: \(channel.chatId)")
            Text(metaText)
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(ScoutPalette.muted)
                .lineLimit(1)
                .truncationMode(.middle)
        }
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
                if let sessionId = sessionId?.nilIfEmpty {
                    detailRow("session", sessionId)
                }
                detailRow("chat", channel.chatId)
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
                .font(HudFont.mono(8, weight: .semibold))
                .tracking(0.5)
                .foregroundStyle(ScoutPalette.muted)
                .frame(width: 78, alignment: .leading)
            Text(value)
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(ScoutPalette.ink)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 0)
        }
    }

    /// Per-session verbs as equal, single-line cells in a 2×2: Observe · Take
    /// over on top, Message · Fork below. Take over pushes to the web's live
    /// terminal (no native backend yet), so it's real, not faked.
    private var actionGrid: some View {
        VStack(spacing: HudSpacing.xs) {
            HStack(spacing: HudSpacing.xs) {
                ScoutSessionActionCell(icon: "eye", title: "Observe", accent: true, action: onObserve)
                ScoutSessionActionCell(icon: "hand.raised", title: "Take over", accent: false, action: onTakeover)
            }
            HStack(spacing: HudSpacing.xs) {
                ScoutSessionActionCell(icon: "bubble.left", title: "Message", accent: false, action: onMessage)
                ScoutSessionActionCell(icon: "arrow.triangle.branch", title: "Fork", accent: false, action: onFork)
            }
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
        return hovering ? ScoutSurface.hover : Color.clear
    }
    private var border: Color {
        if accent { return ScoutPalette.statusOk.opacity(0.45) }
        return ScoutDesign.hairlineStrong
    }
}

/// Compact icon-only engage on a collapsed session row — Observe (accent) and
/// Take over. Shown on hover, or always on the working row. The labeled set
/// lives in the expanded card; this is the no-tap shortcut.
private struct ScoutRowQuickAction: View {
    let icon: String
    let help: String
    let accent: Bool
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(accent ? ScoutPalette.statusOk : (hovering ? ScoutPalette.ink : ScoutPalette.muted))
                .frame(width: 20, height: 18)
                .background(
                    RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                        .fill(hovering ? (accent ? ScoutPalette.statusOk.opacity(0.14) : ScoutSurface.hover) : Color.clear)
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .onHover { hovering = $0 }
        .help(help)
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
            .frame(height: 24)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(fill)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .stroke(border, lineWidth: HudStrokeWidth.thin)
            )
            .contentShape(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous))
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
        return hovering ? ScoutSurface.hover : Color.clear
    }
    private var border: Color {
        // Filled (primary) carries a faint accent edge so it still reads as a
        // crisp chip on a light surface; secondary uses a hairline.
        if filled { return ScoutPalette.accent.opacity(0.35) }
        return ScoutDesign.hairlineStrong
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
                    .tracking(0.4)
            }
            .foregroundStyle(hovering ? ScoutPalette.statusOk : ScoutPalette.muted)
            .padding(.horizontal, HudSpacing.sm)
            .frame(height: 22)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .fill(hovering ? ScoutPalette.statusOk.opacity(0.12) : ScoutSurface.inset)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .stroke(hovering ? ScoutPalette.statusOk.opacity(0.5) : ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
            )
            .contentShape(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous))
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .onHover { hovering = $0 }
        .help("Observe")
    }
}

/// Take over — grabs the live terminal to drive it. macOS has no native
/// take-over backend yet, so it pushes to the web app (which does), the same
/// way the profile + diff affordances open web routes. Neutral chip (Observe
/// is the accented one); matches ScoutObserveChip's height so they sit level.
private struct ScoutTakeoverChip: View {
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: HudSpacing.xs) {
                Image(systemName: "hand.raised")
                    .font(HudFont.ui(HudTextSize.xxs, weight: .semibold))
                Text("TAKE OVER")
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .tracking(0.4)
            }
            .foregroundStyle(hovering ? ScoutPalette.ink : ScoutPalette.muted)
            .padding(.horizontal, HudSpacing.sm)
            .frame(height: 22)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .fill(hovering ? ScoutSurface.hover : ScoutSurface.inset)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
            )
            .contentShape(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous))
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .onHover { hovering = $0 }
        .help("Take over — opens the live terminal in the web app")
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
        ScoutColumnHeader(horizontalPadding: ScoutDesign.panelGutter, background: ScoutDesign.chrome) {
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
    }
}

private struct ScoutAgentModelRow: View {
    let agent: ScoutAgent

    var body: some View {
        // An unset model is conveyed by the muted "Default" value alone; the
        // "why" lives in a tooltip rather than a wrapping sentence that ate two
        // lines of the card.
        ScoutInspectorKVRow(
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
        case "chat": return "Chat"
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

private struct ScoutThemedSidebarPanel<Content: View>: View {
    enum Edge: Sendable {
        case leading
        case trailing
    }

    @Binding var width: CGFloat
    let edge: Edge
    let widthRange: ClosedRange<CGFloat>
    let resizeHitWidth: CGFloat
    let content: Content

    init(
        width: Binding<CGFloat>,
        edge: Edge,
        widthRange: ClosedRange<CGFloat>,
        resizeHitWidth: CGFloat = 10,
        @ViewBuilder content: () -> Content
    ) {
        self._width = width
        self.edge = edge
        self.widthRange = widthRange
        self.resizeHitWidth = resizeHitWidth
        self.content = content()
    }

    var body: some View {
        HStack(spacing: 0) {
            if edge == .trailing {
                resizeHandle(showsHairline: true)
            }

            panelContent

            if edge == .leading {
                resizeHandle(showsHairline: true)
            }
        }
    }

    private var panelContent: some View {
        content
            .frame(width: width, alignment: .topLeading)
            .frame(maxHeight: .infinity)
            .background(ScoutDesign.chrome)
            .overlay(alignment: edgeRuleAlignment) {
                Rectangle()
                    .fill(ScoutDesign.hairlineStrong)
                    .frame(width: HudStrokeWidth.thin)
            }
            .overlay(alignment: edgeRuleAlignment) {
                resizeHandle(showsHairline: false)
            }
    }

    private func resizeHandle(showsHairline: Bool) -> some View {
        HudResizableDivider(
            width: $width,
            placement: resizePlacement,
            range: widthRange,
            hitWidth: resizeHitWidth,
            hairlinePlacement: showsHairline ? outerHairlinePlacement : innerHairlinePlacement,
            showsHairline: showsHairline
        )
    }

    private var edgeRuleAlignment: Alignment {
        edge == .leading ? .trailing : .leading
    }

    private var resizePlacement: HudResizableDivider.Placement {
        edge == .leading ? .trailing : .leading
    }

    private var outerHairlinePlacement: HudResizableDivider.HairlinePlacement {
        edge == .leading ? .leading : .trailing
    }

    private var innerHairlinePlacement: HudResizableDivider.HairlinePlacement {
        edge == .leading ? .trailing : .leading
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
        // The parent VStack draws the under-header rule (theme.hairline.standard
        // == hairlineStrong), so this is the one header that opts out of the
        // baked divider. `.clear` keeps the panel's inherited surface.
        ScoutColumnHeader(horizontalPadding: ScoutDesign.panelGutter, background: .clear, showsDivider: false) {
            header
                .frame(maxWidth: .infinity, alignment: .leading)
        } secondary: {
            EmptyView()
        } trailing: {
            EmptyView()
        }
    }
}

/// Channel/DM inspector — re-crafted to the Proposal: an identity row, then
/// glyph-led mono fact lines grouped under quiet eyebrows, a recessed Ask
/// screen, and a members list. No boxed cards, no loud accents — the inspector
/// reads as a calm fact sheet (the agent-lanes idiom).
private struct ScoutChannelInspector: View {
    let channel: ScoutChannel

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xl) {
            identity

            section("Conversation") {
                fact("clock", channel.ageLabel)
                if channel.unreadCount > 0 {
                    fact("circlebadge.fill", "\(channel.unreadCount) unread", tint: ScoutPalette.accent, glyphTint: ScoutPalette.accent)
                }
                fact(channel.scope == .direct ? "bubble.left" : "number",
                     channel.scope == .direct ? "Direct message" : "Channel")
            }

            if channel.workspaceRoot?.nilIfEmpty != nil || channel.currentBranch?.nilIfEmpty != nil {
                section("Project") {
                    if let root = channel.workspaceRoot?.nilIfEmpty { fact("folder", root) }
                    if let branch = channel.currentBranch?.nilIfEmpty { fact("arrow.triangle.branch", branch) }
                }
            }

            if let ask = channel.ask {
                askScreen(ask)
            }

            section("Members") {
                ForEach(channel.participantDisplayNames, id: \.self) { name in
                    fact(name == "Operator" ? "person" : "cpu", name)
                }
            }
        }
    }

    private var identity: some View {
        HStack(spacing: HudSpacing.md) {
            SpriteAvatarView(name: channel.rowTitle, size: 32, tile: true)
            VStack(alignment: .leading, spacing: 2) {
                Text(channel.displayHandle)
                    .font(HudFont.ui(HudTextSize.base, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Text(channel.sessionIdShort ?? channel.chatIdShort)
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutPalette.dim)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private func section<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            Text(title.uppercased())
                .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                .tracking(1.4)
                .foregroundStyle(ScoutPalette.dim)
            content()
        }
    }

    /// One glyph-led fact line: a fixed-width glyph column + a mono value, in the
    /// 3-tier ink/muted/dim ramp. Accent only for genuinely-live facts (unread).
    private func fact(_ icon: String, _ text: String,
                      tint: Color = ScoutPalette.muted,
                      glyphTint: Color = ScoutPalette.dim) -> some View {
        HStack(spacing: HudSpacing.sm) {
            Image(systemName: icon)
                .font(.system(size: 10))
                .foregroundStyle(glyphTint)
                .frame(width: 14, alignment: .center)
            Text(text)
                .font(HudFont.mono(HudTextSize.xs))
                .foregroundStyle(tint)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private func askScreen(_ ask: ScoutChannelAsk) -> some View {
        let pending = ask.state == .pending
        section("Ask") {
            VStack(alignment: .leading, spacing: HudSpacing.xs) {
                HStack(spacing: HudSpacing.sm) {
                    Image(systemName: "pin.fill")
                        .font(.system(size: 8))
                        .foregroundStyle(pending ? ScoutPalette.statusWarn : ScoutPalette.dim)
                    Text((pending ? "pending" : "answered") + " · from \(ask.from)")
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(ScoutPalette.dim)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                Text(ask.text)
                    .font(HudFont.ui(HudTextSize.xs))
                    .foregroundStyle(ScoutPalette.muted)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(HudSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                    .fill(ScoutSurface.inset)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                    .stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin)
            )
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
