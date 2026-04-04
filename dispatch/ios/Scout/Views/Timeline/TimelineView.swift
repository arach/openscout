// TimelineView — Session detail screen showing a scrolling timeline of turns.
//
// Auto-scrolls to bottom during streaming. Shows prompt composer at the bottom.
// NavigationStack destination from the session list.

import SwiftUI

struct TimelineView: View {
    let sessionId: String

    @Environment(SessionStore.self) private var store
    @Environment(ConnectionManager.self) private var connection

    @State private var shouldAutoScroll = true
    @State private var showingSettings = false
    @State private var sendError: String?
    @State private var isRefreshing = false
    @Environment(\.dismiss) private var dismiss
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

    private var isStreaming: Bool {
        turns.last?.status == .streaming || turns.last?.status == .started
    }

    private var isConnected: Bool {
        connection.state == .connected
    }

    private var isCachedOnly: Bool {
        store.cachedOnlySessionIds.contains(sessionId)
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

            if let sendError {
                HStack {
                    Text(sendError.contains("No session") ? "Session expired" : sendError)
                        .font(DispatchTypography.caption(12, weight: .medium))
                        .foregroundStyle(.white)
                    Spacer()
                    if sendError.contains("No session") {
                        Button("Go back") { dismiss() }
                            .font(DispatchTypography.caption(12, weight: .bold))
                            .foregroundStyle(.white)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(DispatchColors.statusError.opacity(0.85))
                .onTapGesture { self.sendError = nil }
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .task {
                    try? await Task.sleep(for: .seconds(5))
                    withAnimation { self.sendError = nil }
                }
            }

            ComposerView(
                sessionId: sessionId,
                projectName: session?.name,
                adapterType: session?.adapterType,
                currentModel: session?.model,
                currentBranch: session?.currentBranch,
                isConnected: isConnected && !isCachedOnly,
                isStreaming: isStreaming,
                onSend: { request in
                    Task { await sendPrompt(request) }
                },
                onInterrupt: {
                    Task {
                        try? await connection.interruptTurn(sessionId)
                    }
                }
            )
        }
        .background(DispatchColors.backgroundAdaptive)
        .navigationTitle(session?.name ?? "Session")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await hydrateTimeline()
        }
        .toolbar {
            ToolbarItem(placement: .principal) {
                titleView
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
                refreshButton
                Button {
                    showingSettings = true
                } label: {
                    Image(systemName: "gearshape")
                        .font(.system(size: 15))
                        .foregroundStyle(DispatchColors.textSecondary)
                }
                connectionIndicator
            }
        }
        .sheet(isPresented: $showingSettings) {
            SettingsView()
                .environment(connection)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
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
            sendError = nil
        } catch {
            sendError = error.localizedDescription
        }
    }

    @MainActor
    private func verifyLatestTurnBeforeSending() async throws -> Bool {
        guard connection.state == .connected else { return true }

        let localState = store.sessions[sessionId] ?? SessionCache.shared.load(sessionId: sessionId)
        let remoteSnapshot = TurnHash.normalize(try await connection.getSnapshot(sessionId))
        guard TurnHash.latestTurnsMatch(local: localState, remote: remoteSnapshot) else {
            store.applySnapshot(remoteSnapshot)
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
                DispatchLog.session.info("Restored \(cached.turns.count) turns from cache for \(sessionId)")
            }
        }

        guard connection.state == .connected else { return }
        await refreshTimeline()
    }

    @MainActor
    private func refreshTimeline() async {
        guard connection.state == .connected else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        do {
            let snapshot = try await connection.getSnapshot(sessionId)
            store.applySnapshot(snapshot)
            DispatchLog.session.info("Loaded snapshot for \(sessionId): \(snapshot.turns.count) turns")
        } catch {
            DispatchLog.session.warning("Failed to load snapshot for \(sessionId): \(error.localizedDescription)")
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
                    ForEach(turns) { turn in
                        TurnView(turn: turn)

                        // Subtle divider between turns
                        if turn.id != turns.last?.id {
                            turnDivider
                        }
                    }

                    // Invisible anchor at the bottom for auto-scroll
                    Color.clear
                        .frame(height: 1)
                        .id("bottom")
                }
                .padding(.top, DispatchSpacing.sm)
                .padding(.bottom, DispatchSpacing.md)
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
                scrollToBottom(proxy: proxy)
            }
            .overlay(alignment: .bottomTrailing) {
                if !shouldAutoScroll {
                    Button {
                        shouldAutoScroll = true
                        scrollToBottom(proxy: proxy)
                    } label: {
                        HStack(spacing: DispatchSpacing.xs) {
                            Image(systemName: "arrow.down.circle.fill")
                            Text("Latest")
                        }
                        .font(DispatchTypography.caption(12, weight: .semibold))
                        .padding(.horizontal, DispatchSpacing.md)
                        .padding(.vertical, DispatchSpacing.sm)
                        .background(.ultraThinMaterial)
                        .clipShape(Capsule())
                    }
                    .padding(.trailing, DispatchSpacing.lg)
                    .padding(.bottom, DispatchSpacing.lg)
                }
            }
        }
    }

    private func scrollToBottom(proxy: ScrollViewProxy) {
        withAnimation(.easeOut(duration: 0.25)) {
            proxy.scrollTo("bottom", anchor: .bottom)
        }
    }

    private var turnDivider: some View {
        Rectangle()
            .fill(DispatchColors.divider)
            .frame(height: 0.5)
            .padding(.horizontal, DispatchSpacing.xl)
            .padding(.vertical, DispatchSpacing.sm)
    }

    // MARK: - Title

    private var cachedSessionBanner: some View {
        HStack(spacing: DispatchSpacing.sm) {
            Image(systemName: "internaldrive")
                .font(.system(size: 12, weight: .semibold))
            Text("Read only")
                .font(DispatchTypography.caption(12, weight: .medium))
            Spacer()
        }
        .foregroundStyle(DispatchColors.textSecondary)
        .padding(.horizontal, DispatchSpacing.lg)
        .padding(.vertical, DispatchSpacing.sm)
        .background(DispatchColors.surfaceRaisedAdaptive)
    }

    private var titleView: some View {
        HStack(spacing: DispatchSpacing.sm) {
            if let session {
                Image(systemName: AdapterIcon.systemName(for: session.adapterType))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(DispatchColors.accent)
            }

            Text(session?.name ?? "Session")
                .font(DispatchTypography.body(16, weight: .semibold))
                .foregroundStyle(DispatchColors.textPrimary)
        }
    }

    // MARK: - Connection Indicator

    @ViewBuilder
    private var refreshButton: some View {
        Button {
            Task { await refreshTimeline() }
        } label: {
            if isRefreshing {
                ProgressView()
                    .controlSize(.mini)
            } else {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(isConnected ? DispatchColors.textSecondary : DispatchColors.textMuted)
            }
        }
        .disabled(!isConnected || isRefreshing)
        .accessibilityLabel("Refresh session")
    }

    @ViewBuilder
    private var connectionIndicator: some View {
        Button {
            Task { await connection.reconnect() }
        } label: {
            switch connection.state {
            case .connected:
                Circle()
                    .fill(DispatchColors.statusActive)
                    .frame(width: 7, height: 7)
                    .accessibilityLabel("Connected — tap to reconnect")
            case .connecting, .handshaking, .reconnecting:
                ProgressView()
                    .controlSize(.mini)
                    .accessibilityLabel("Connecting — tap to retry")
            case .disconnected, .failed:
                Circle()
                    .fill(DispatchColors.statusError)
                    .frame(width: 7, height: 7)
                    .accessibilityLabel("Disconnected — tap to reconnect")
            }
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: DispatchSpacing.lg) {
            Spacer()

            Image(systemName: "bubble.left.and.text.bubble.right")
                .font(.system(size: 40))
                .foregroundStyle(DispatchColors.textMuted.opacity(0.5))

            VStack(spacing: DispatchSpacing.sm) {
                Text("No turns yet")
                    .font(DispatchTypography.body(18, weight: .semibold))
                    .foregroundStyle(DispatchColors.textSecondary)

                Text("Send a prompt to start a conversation with the agent.")
                    .font(DispatchTypography.body(14))
                    .foregroundStyle(DispatchColors.textMuted)
                    .multilineTextAlignment(.center)
            }

            Spacer()
        }
        .padding(.horizontal, DispatchSpacing.xxl)
    }
}

// MARK: - Preview

#Preview {
    NavigationStack {
        TimelineView(sessionId: "s1")
            .environment(SessionStore.preview)
            .environment(ConnectionManager.preview())
    }
    .preferredColorScheme(.dark)
}
