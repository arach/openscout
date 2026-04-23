// TimelineView — Session detail screen showing a scrolling timeline of turns.
//
// Auto-scrolls to bottom during streaming. Shows prompt composer at the bottom.
// NavigationStack destination from the session list.

import SwiftUI

struct TimelineView: View {
    let sessionId: String

    @Environment(SessionStore.self) private var store
    @Environment(ConnectionManager.self) private var connection
    @Environment(ScoutRouter.self) private var router
    @Environment(\.scenePhase) private var scenePhase

    @State private var shouldAutoScroll = true
    @State private var sendError: String?
    @State private var isRefreshing = false
    @State private var isLoadingOlder = false
    @State private var liveRefreshGeneration = 0
    @State private var liveRefreshDeadline: Date?
    @State private var isHydrating = true
    @Namespace private var bottomAnchor

    private var sessionState: SessionState? {
        store.sessions[sessionId]
    }

    private var session: Session? {
        sessionState?.session
    }

    private var turns: [Turn] {
        guard let state = sessionState else { return [] }
        // Convert TurnState -> Turn for rendering
        return state.turns.map { turnState in
            let turnStatus: TurnStatus = switch turnState.status {
            case .streaming: .streaming
            case .completed: .completed
            case .interrupted: .stopped
            case .error: .failed
            }

            let blocks = turnState.blocks.map(\.block)
            let startedAtDate = Date(timeIntervalSince1970: Double(turnState.startedAt) / 1000.0)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime]

            return Turn(
                id: turnState.id,
                sessionId: sessionId,
                status: turnStatus,
                startedAt: formatter.string(from: startedAtDate),
                endedAt: turnState.endedAt.map { formatter.string(from: Date(timeIntervalSince1970: Double($0) / 1000.0)) },
                blocks: blocks,
                isUserTurn: turnState.isUserTurn,
                turnHash: turnState.turnHash
            )
        }
    }

    private var hasOlderHistory: Bool {
        sessionState?.history?.hasOlder == true
    }

    private var oldestLoadedTurnId: String? {
        sessionState?.history?.oldestTurnId
    }

    private var isStreaming: Bool {
        turns.last?.status == .streaming || turns.last?.status == .started
    }

    private var isConnected: Bool {
        connection.state == .connected
    }

    private var isCachedOnly: Bool {
        store.cachedOnlySessionIds.contains(sessionId)
    }

    private var shouldRunFocusedRefresh: Bool {
        guard connection.state == .connected, scenePhase == .active else { return false }
        if sessionState?.currentTurnId != nil {
            return true
        }
        guard let deadline = liveRefreshDeadline else { return false }
        return deadline > Date()
    }

    private var liveRefreshInterval: Duration {
        sessionState?.currentTurnId != nil ? .milliseconds(700) : .milliseconds(1500)
    }

    var body: some View {
        VStack(spacing: 0) {
            if isCachedOnly {
                cachedSessionBanner
            }

            if turns.isEmpty {
                emptyState
            } else {
                timeline
            }
        }
        .overlay(alignment: .bottom) {
            if let sendError {
                HStack {
                    Text(sendError.contains("No session") ? "Session expired" : sendError)
                        .font(ScoutTypography.caption(12, weight: .medium))
                        .foregroundStyle(.white)
                    Spacer()
                    if sendError.contains("No session") {
                        Button("Go back") { router.pop() }
                            .font(ScoutTypography.caption(12, weight: .bold))
                            .foregroundStyle(.white)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(ScoutColors.statusError.opacity(0.85))
                .onTapGesture { self.sendError = nil }
                .padding(.bottom, 180)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .task {
                    try? await Task.sleep(for: .seconds(5))
                    withAnimation { self.sendError = nil }
                }
            }
        }
        .background(ScoutColors.backgroundAdaptive)
        .environment(\.openURL, OpenURLAction { url in
            guard url.scheme == "scout", url.host == "agent",
                  let handle = url.pathComponents.dropFirst().first
            else { return .systemAction }
            Task {
                guard let agents = try? await connection.listMobileAgents(query: handle),
                      let agent = agents.first(where: { $0.mentionHandle == handle })
                else { return }
                router.push(.agentDashboard(agentId: agent.id))
            }
            return .handled
        })
        .task {
            await hydrateTimeline()
        }
        .task(id: liveRefreshGeneration) {
            await runFocusedRefreshLoop()
        }
        .onReceive(NotificationCenter.default.publisher(for: .scoutSendPrompt)) { notification in
            guard let info = notification.userInfo,
                  let notifSessionId = info["sessionId"] as? String,
                  notifSessionId == sessionId,
                  let request = info["request"] as? ComposerSendRequest else { return }
            Task { await sendPrompt(request) }
        }
        .onChange(of: sessionState?.currentTurnId) { _, currentTurnId in
            guard currentTurnId != nil else { return }
            shouldAutoScroll = true
            requestFocusedRefresh(for: 30, forceRestart: true)
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active, (sessionState?.currentTurnId != nil || liveRefreshDeadline != nil) else { return }
            requestFocusedRefresh(for: 20, forceRestart: true)
        }
    }

    @MainActor
    private func sendPrompt(_ request: ComposerSendRequest) async {
        do {
            guard try await verifyLatestTurnBeforeSending() else { return }

            let turnId = "user-\(UUID().uuidString)"
            let userBlock = Block(
                id: UUID().uuidString,
                turnId: turnId,
                type: .text,
                status: .completed,
                index: 0,
                text: request.text
            )
            let userTurn = TurnState(
                id: turnId,
                status: .completed,
                blocks: [BlockState(block: userBlock, status: .completed)],
                startedAt: Int(Date().timeIntervalSince1970 * 1000),
                isUserTurn: true
            )
            store.appendLocalTurn(userTurn, sessionId: sessionId)

            let prompt = Prompt(
                sessionId: sessionId,
                text: request.text,
                providerOptions: promptProviderOptions(for: request)
            )
            try await connection.sendPrompt(prompt)
            shouldAutoScroll = true
            requestFocusedRefresh(for: 30, forceRestart: true)
            sendError = nil
        } catch {
            sendError = error.scoutUserFacingMessage
        }
    }

    @MainActor
    private func verifyLatestTurnBeforeSending() async throws -> Bool {
        guard connection.state == .connected else { return true }
        if sessionState?.currentTurnId != nil {
            return true
        }

        let localState = store.sessions[sessionId] ?? SessionCache.shared.load(sessionId: sessionId)
        let remoteSnapshot = TurnHash.normalize(try await connection.getSnapshot(sessionId))
        guard TurnHash.latestTurnsMatch(local: localState, remote: remoteSnapshot) else {
            store.applyLatestSnapshotPreservingHistory(remoteSnapshot)
            sendError = "Session changed on the bridge. Scout reloaded the latest turns. Review and send again."
            return false
        }

        return true
    }

    @MainActor
    private func hydrateTimeline() async {
        if store.sessions[sessionId] == nil || store.sessions[sessionId]?.turns.isEmpty == true {
            if let cached = SessionCache.shared.load(sessionId: sessionId) {
                store.restoreCachedSnapshot(cached)
                ScoutLog.session.info("Restored \(cached.turns.count) turns from cache for \(sessionId)")
            }
        }

        guard connection.state == .connected else {
            isHydrating = false
            return
        }
        await refreshTimeline()
        isHydrating = false
    }

    @MainActor
    private func refreshTimeline(showSpinner: Bool = true, reportErrors: Bool = true) async {
        guard connection.state == .connected else { return }
        if showSpinner {
            isRefreshing = true
        }
        defer {
            if showSpinner {
                isRefreshing = false
            }
        }

        do {
            let snapshot = try await connection.getSnapshot(sessionId)
            store.applyLatestSnapshotPreservingHistory(snapshot)
            ScoutLog.session.info("Loaded snapshot for \(sessionId): \(snapshot.turns.count) turns")
        } catch {
            ScoutLog.session.warning("Failed to load snapshot for \(sessionId): \(error.localizedDescription)")
            if reportErrors, sendError == nil {
                sendError = error.scoutUserFacingMessage
            }
        }
    }

    @MainActor
    private func requestFocusedRefresh(for seconds: TimeInterval, forceRestart: Bool = false) {
        let now = Date()
        let deadline = now.addingTimeInterval(seconds)
        let hadActiveDeadline = liveRefreshDeadline.map { $0 > now } ?? false
        if liveRefreshDeadline == nil || deadline > liveRefreshDeadline! {
            liveRefreshDeadline = deadline
        }
        if forceRestart || !hadActiveDeadline {
            liveRefreshGeneration += 1
        }
    }

    @MainActor
    private func runFocusedRefreshLoop() async {
        guard liveRefreshGeneration > 0 else { return }

        while !Task.isCancelled {
            guard shouldRunFocusedRefresh else { return }
            try? await Task.sleep(for: liveRefreshInterval)
            guard !Task.isCancelled, shouldRunFocusedRefresh else { return }
            await refreshTimeline(showSpinner: false, reportErrors: false)
        }
    }

    private func promptProviderOptions(for request: ComposerSendRequest) -> [String: AnyCodable]? {
        var options: [String: AnyCodable] = [:]

        if let model = request.model {
            options["model"] = AnyCodable(model)
        }

        if let effort = request.effort {
            options["effort"] = AnyCodable(effort)
        }

        return options.isEmpty ? nil : options
    }

    // MARK: - Timeline

    private var timeline: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    // Top inset so content isn't hidden behind the blur chrome
                    Color.clear.frame(height: 44)
                    if hasOlderHistory {
                        Button {
                            Task { await loadOlderHistory() }
                        } label: {
                            HStack(spacing: ScoutSpacing.xs) {
                                if isLoadingOlder {
                                    ProgressView()
                                        .controlSize(.mini)
                                }
                                Text(isLoadingOlder ? "Loading earlier…" : "Load earlier")
                            }
                            .font(ScoutTypography.caption(12, weight: .semibold))
                            .foregroundStyle(ScoutColors.textSecondary)
                            .padding(.horizontal, ScoutSpacing.md)
                            .padding(.vertical, ScoutSpacing.sm)
                            .background(ScoutColors.surfaceRaisedAdaptive)
                            .clipShape(Capsule())
                        }
                        .buttonStyle(.plain)
                        .disabled(isLoadingOlder || !isConnected)
                        .padding(.vertical, ScoutSpacing.sm)
                    }

                    ForEach(turns) { turn in
                        TurnView(turn: turn)

                        // Subtle divider between turns
                        if turn.id != turns.last?.id {
                            turnDivider
                        }
                    }

                    // Bottom spacer to clear the composer bar, then the scroll anchor
                    Color.clear.frame(height: 200)

                    Color.clear
                        .frame(height: 1)
                        .id("bottom")
                }
                .padding(.top, ScoutSpacing.sm)
            }
            .refreshable {
                await refreshTimeline()
            }
            .scrollDismissesKeyboard(.interactively)
            .simultaneousGesture(
                DragGesture(minimumDistance: 12)
                    .onChanged { value in
                        guard abs(value.translation.height) > abs(value.translation.width) else { return }
                        if shouldAutoScroll {
                            shouldAutoScroll = false
                        }
                    }
            )
            .onChange(of: turns.last?.blocks.count) { _, _ in
                if shouldAutoScroll {
                    scrollToBottom(proxy: proxy)
                }
            }
            .onChange(of: turns.last?.blocks.last?.text) { _, _ in
                if shouldAutoScroll {
                    scrollToBottom(proxy: proxy)
                }
            }
            .onChange(of: turns.count) { _, _ in
                if shouldAutoScroll {
                    scrollToBottom(proxy: proxy)
                }
            }
            .onChange(of: isStreaming) { _, streaming in
                if streaming {
                    shouldAutoScroll = true
                    scrollToBottom(proxy: proxy)
                }
            }
            .onAppear {
                // Jump instantly on first appear — no animation
                proxy.scrollTo("bottom", anchor: .bottom)
            }
            .overlay(alignment: .bottomTrailing) {
                if !shouldAutoScroll {
                    Button {
                        shouldAutoScroll = true
                        scrollToBottom(proxy: proxy)
                    } label: {
                        HStack(spacing: ScoutSpacing.xs) {
                            Image(systemName: "arrow.down.circle.fill")
                            Text("Latest")
                        }
                        .font(ScoutTypography.caption(12, weight: .semibold))
                        .padding(.horizontal, ScoutSpacing.md)
                        .padding(.vertical, ScoutSpacing.sm)
                        .background(.ultraThinMaterial)
                        .clipShape(Capsule())
                    }
                    .padding(.trailing, ScoutSpacing.lg)
                    .padding(.bottom, ScoutSpacing.lg)
                }
            }
            .overlay(alignment: .top) {
                // Gradient blur behind the status bar / dynamic island
                Rectangle()
                    .fill(.ultraThinMaterial)
                    .mask(
                        LinearGradient(
                            stops: [
                                .init(color: .white, location: 0),
                                .init(color: .white, location: 0.5),
                                .init(color: .clear, location: 1),
                            ],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .frame(height: 54)
                    .ignoresSafeArea(edges: .top)
                    .allowsHitTesting(false)
            }
        }
    }

    @MainActor
    private func loadOlderHistory() async {
        guard connection.state == .connected,
              !isLoadingOlder,
              let beforeTurnId = oldestLoadedTurnId else { return }

        isLoadingOlder = true
        defer { isLoadingOlder = false }

        do {
            let snapshot = try await connection.getSnapshot(sessionId, beforeTurnId: beforeTurnId, limit: 40)
            store.prependHistoryPage(snapshot)
            sendError = nil
        } catch {
            sendError = error.scoutUserFacingMessage
        }
    }

    private func scrollToBottom(proxy: ScrollViewProxy) {
        if isHydrating {
            proxy.scrollTo("bottom", anchor: .bottom)
        } else {
            withAnimation(.easeOut(duration: 0.25)) {
                proxy.scrollTo("bottom", anchor: .bottom)
            }
        }
    }

    private var turnDivider: some View {
        Rectangle()
            .fill(ScoutColors.divider)
            .frame(height: 0.5)
            .padding(.horizontal, ScoutSpacing.xl)
            .padding(.vertical, ScoutSpacing.sm)
    }

    // MARK: - Title

    private var cachedSessionBanner: some View {
        HStack(spacing: ScoutSpacing.sm) {
            Image(systemName: "internaldrive")
                .font(.system(size: 12, weight: .semibold))
            Text("Read only")
                .font(ScoutTypography.caption(12, weight: .medium))
            Spacer()
        }
        .foregroundStyle(ScoutColors.textSecondary)
        .padding(.horizontal, ScoutSpacing.lg)
        .padding(.vertical, ScoutSpacing.sm)
        .background(ScoutColors.surfaceRaisedAdaptive)
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: ScoutSpacing.lg) {
            Spacer()

            Image(systemName: "bubble.left.and.text.bubble.right")
                .font(.system(size: 40))
                .foregroundStyle(ScoutColors.textMuted.opacity(0.5))

            VStack(spacing: ScoutSpacing.sm) {
                Text("No turns yet")
                    .font(ScoutTypography.body(18, weight: .semibold))
                    .foregroundStyle(ScoutColors.textSecondary)

                Text("Send a prompt to start a conversation with the agent.")
                    .font(ScoutTypography.body(14))
                    .foregroundStyle(ScoutColors.textMuted)
                    .multilineTextAlignment(.center)
            }

            Spacer()
        }
        .padding(.horizontal, ScoutSpacing.xxl)
    }
}

// MARK: - Preview

#Preview {
    TimelineView(sessionId: "s1")
        .environment(SessionStore.preview)
        .environment(ConnectionManager.preview())
        .environment(ScoutRouter())
        .preferredColorScheme(.dark)
}
