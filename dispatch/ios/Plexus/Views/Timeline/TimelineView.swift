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
                blocks: blocks,
                isUserTurn: turnState.isUserTurn
            )
        }
    }

    private var isStreaming: Bool {
        turns.last?.status == .streaming || turns.last?.status == .started
    }

    private var isConnected: Bool {
        connection.state == .connected
    }

    var body: some View {
        VStack(spacing: 0) {
            if turns.isEmpty {
                emptyState
            } else {
                timeline
            }

            if let sendError {
                HStack {
                    Text(sendError.contains("No session") ? "Session expired" : sendError)
                        .font(PlexusTypography.caption(12, weight: .medium))
                        .foregroundStyle(.white)
                    Spacer()
                    if sendError.contains("No session") {
                        Button("Go back") { dismiss() }
                            .font(PlexusTypography.caption(12, weight: .bold))
                            .foregroundStyle(.white)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(PlexusColors.statusError.opacity(0.85))
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
                isConnected: isConnected,
                isStreaming: isStreaming,
                onSend: { text in
                    // Show the user's message in the timeline immediately
                    let turnId = "user-\(UUID().uuidString)"
                    let userBlock = Block(
                        id: UUID().uuidString,
                        turnId: turnId,
                        type: .text,
                        status: .completed,
                        index: 0,
                        text: text
                    )
                    let userTurn = TurnState(
                        id: turnId,
                        status: .completed,
                        blocks: [BlockState(block: userBlock, status: .completed)],
                        startedAt: Int(Date().timeIntervalSince1970 * 1000),
                        isUserTurn: true
                    )
                    store.appendLocalTurn(userTurn, sessionId: sessionId)

                    Task {
                        do {
                            let prompt = Prompt(sessionId: sessionId, text: text)
                            try await connection.sendPrompt(prompt)
                            sendError = nil
                        } catch {
                            sendError = error.localizedDescription
                        }
                    }
                },
                onInterrupt: {
                    Task {
                        try? await connection.interruptTurn(sessionId)
                    }
                }
            )
        }
        .background(PlexusColors.backgroundAdaptive)
        .navigationTitle(session?.name ?? "Session")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            // 1. Hydrate from local cache immediately (no network wait)
            if store.sessions[sessionId] == nil || store.sessions[sessionId]?.turns.isEmpty == true {
                if let cached = SessionCache.shared.load(sessionId: sessionId) {
                    store.applySnapshot(cached)
                    PlexusLog.session.info("Restored \(cached.turns.count) turns from cache for \(sessionId)")
                }
            }

            // 2. Overlay fresh state from bridge if connected
            guard connection.state == .connected else { return }
            do {
                let snapshot = try await connection.getSnapshot(sessionId)
                store.applySnapshot(snapshot)
                PlexusLog.session.info("Loaded snapshot for \(sessionId): \(snapshot.turns.count) turns")
            } catch {
                PlexusLog.session.warning("Failed to load snapshot for \(sessionId): \(error.localizedDescription)")
            }
        }
        .toolbar {
            ToolbarItem(placement: .principal) {
                titleView
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    showingSettings = true
                } label: {
                    Image(systemName: "gearshape")
                        .font(.system(size: 15))
                        .foregroundStyle(PlexusColors.textSecondary)
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
                .padding(.top, PlexusSpacing.sm)
                .padding(.bottom, PlexusSpacing.md)
            }
            .refreshable {
                guard connection.state == .connected else { return }
                if let snapshot = try? await connection.getSnapshot(sessionId) {
                    store.applySnapshot(snapshot)
                    PlexusLog.session.info("Refreshed snapshot: \(snapshot.turns.count) turns")
                }
            }
            .scrollDismissesKeyboard(.interactively)
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
        }
    }

    private func scrollToBottom(proxy: ScrollViewProxy) {
        withAnimation(.easeOut(duration: 0.25)) {
            proxy.scrollTo("bottom", anchor: .bottom)
        }
    }

    private var turnDivider: some View {
        Rectangle()
            .fill(PlexusColors.divider)
            .frame(height: 0.5)
            .padding(.horizontal, PlexusSpacing.xl)
            .padding(.vertical, PlexusSpacing.sm)
    }

    // MARK: - Title

    private var titleView: some View {
        HStack(spacing: PlexusSpacing.sm) {
            if let session {
                Image(systemName: AdapterIcon.systemName(for: session.adapterType))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(PlexusColors.accent)
            }

            Text(session?.name ?? "Session")
                .font(PlexusTypography.body(16, weight: .semibold))
                .foregroundStyle(PlexusColors.textPrimary)
        }
    }

    // MARK: - Connection Indicator

    @ViewBuilder
    private var connectionIndicator: some View {
        Button {
            Task { await connection.reconnect() }
        } label: {
            switch connection.state {
            case .connected:
                Circle()
                    .fill(PlexusColors.statusActive)
                    .frame(width: 7, height: 7)
                    .accessibilityLabel("Connected — tap to reconnect")
            case .connecting, .handshaking, .reconnecting:
                ProgressView()
                    .controlSize(.mini)
                    .accessibilityLabel("Connecting — tap to retry")
            case .disconnected, .failed:
                Circle()
                    .fill(PlexusColors.statusError)
                    .frame(width: 7, height: 7)
                    .accessibilityLabel("Disconnected — tap to reconnect")
            }
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: PlexusSpacing.lg) {
            Spacer()

            Image(systemName: "bubble.left.and.text.bubble.right")
                .font(.system(size: 40))
                .foregroundStyle(PlexusColors.textMuted.opacity(0.5))

            VStack(spacing: PlexusSpacing.sm) {
                Text("No turns yet")
                    .font(PlexusTypography.body(18, weight: .semibold))
                    .foregroundStyle(PlexusColors.textSecondary)

                Text("Send a prompt to start a conversation with the agent.")
                    .font(PlexusTypography.body(14))
                    .foregroundStyle(PlexusColors.textMuted)
                    .multilineTextAlignment(.center)
            }

            Spacer()
        }
        .padding(.horizontal, PlexusSpacing.xxl)
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
