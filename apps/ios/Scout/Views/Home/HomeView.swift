// HomeView — Landing surface replacing SessionListView.
//
// Sections: device card (connection state), active sessions (horizontal),
// recent history (vertical, reuses SessionRowView).

import SwiftUI

struct HomeView: View {
    @Environment(SessionStore.self) private var store
    @Environment(InboxStore.self) private var inbox
    @Environment(ConnectionManager.self) private var connection
    @Environment(ScoutRouter.self) private var router

    @State private var isRefreshing = false

    private let shortcutColumns = [
        GridItem(.flexible(), spacing: ScoutSpacing.md),
        GridItem(.flexible(), spacing: ScoutSpacing.md),
    ]

    private var isConnected: Bool {
        connection.state == .connected
    }

    private var surfacedSummaries: [SessionSummary] {
        let source = isConnected ? store.summaries.filter { !$0.isCachedOnly } : store.summaries
        return source.sorted { $0.lastActivityAt > $1.lastActivityAt }
    }

    private var liveSummaries: [SessionSummary] {
        surfacedSummaries.filter { !$0.isCachedOnly }
    }

    private var activeSummaries: [SessionSummary] {
        liveSummaries.filter { summary in
            let status = SessionStatus(rawValue: summary.status)
            return status == .active || status == .connecting
                || summary.currentTurnStatus == "streaming"
                || summary.currentTurnStatus == "started"
        }
    }

    private var recentSummaries: [SessionSummary] {
        surfacedSummaries.filter { summary in
            !activeSummaries.contains(where: { $0.sessionId == summary.sessionId })
        }
    }

    private var cachedSummaryCount: Int {
        store.summaries.filter(\.isCachedOnly).count
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                deviceCard
                    .padding(.horizontal, ScoutSpacing.lg)
                    .padding(.top, ScoutSpacing.lg)

                shortcutsSection

                if !activeSummaries.isEmpty {
                    activeSessionsSection
                }

                if !recentSummaries.isEmpty {
                    recentSessionsSection
                }

                if surfacedSummaries.isEmpty {
                    emptyState
                }

                // Bottom padding for the bar
                Color.clear.frame(height: 100)
            }
        }
        .refreshable {
            await refreshSessions()
        }
        .task {
            if !isConnected && store.summaries.isEmpty {
                await refreshSessions()
            }
        }
        .task(id: isConnected) {
            guard isConnected else { return }
            await refreshSessions()
        }
    }

    // MARK: - Device Card

    private var deviceCard: some View {
        HStack(spacing: ScoutSpacing.md) {
            ZStack {
                RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous)
                    .fill(connectionCardColor.opacity(0.12))
                    .frame(width: 44, height: 44)

                Image(systemName: connectionCardIcon)
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(connectionCardColor)
            }

            VStack(alignment: .leading, spacing: ScoutSpacing.xxs) {
                Text("Scout Bridge")
                    .font(ScoutTypography.body(16, weight: .semibold))
                    .foregroundStyle(ScoutColors.textPrimary)

                Text(connectionCardSubtitle)
                    .font(ScoutTypography.caption(13))
                    .foregroundStyle(ScoutColors.textSecondary)
            }

            Spacer()

            if !isConnected && connection.statusDetails.allowsRetry {
                Button {
                    Task { await connection.reconnect() }
                } label: {
                    Text("Retry")
                        .font(ScoutTypography.caption(13, weight: .semibold))
                        .foregroundStyle(ScoutColors.accent)
                        .padding(.horizontal, ScoutSpacing.md)
                        .padding(.vertical, ScoutSpacing.sm)
                        .background(ScoutColors.accent.opacity(0.12))
                        .clipShape(Capsule())
                }
            }
        }
        .scoutCard()
    }

    private var connectionCardColor: Color {
        switch connection.state {
        case .connected: ScoutColors.statusActive
        case .connecting, .handshaking, .reconnecting: ScoutColors.statusStreaming
        case .disconnected, .failed: ScoutColors.statusError
        }
    }

    private var connectionCardIcon: String {
        connection.statusDetails.symbol
    }

    private var connectionCardSubtitle: String {
        switch connection.state {
        case .connected:
            let count = liveSummaries.count
            return count == 0 ? "Connected — no active sessions" : "Connected — \(count) session\(count == 1 ? "" : "s")"
        default:
            if cachedSummaryCount > 0,
               connection.state != .connecting,
               connection.state != .handshaking,
               !matchesReconnectingState(connection.state) {
                return "\(connection.statusDetails.shortLabel) — \(cachedSummaryCount) cached session\(cachedSummaryCount == 1 ? "" : "s") available"
            }
            return connection.statusDetails.message ?? connection.statusDetails.shortLabel
        }
    }

    private func matchesReconnectingState(_ state: ConnectionState) -> Bool {
        if case .reconnecting = state {
            return true
        }
        return false
    }

    // MARK: - Shortcuts

    private var shortcutsSection: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
            sectionHeader("Explore")
                .padding(.horizontal, ScoutSpacing.lg)

            LazyVGrid(columns: shortcutColumns, spacing: ScoutSpacing.md) {
                shortcutCard(
                    title: inbox.pendingCount == 0 ? "Inbox" : "Inbox \(inbox.pendingCount)",
                    subtitle: inbox.pendingCount == 0
                        ? "Approvals that need you will appear here."
                        : "\(inbox.pendingCount) approval\(inbox.pendingCount == 1 ? "" : "s") waiting for confirmation.",
                    icon: inbox.unreadCount > 0 ? "bell.badge.fill" : "tray.full.fill",
                    accent: inbox.unreadCount > 0 ? ScoutColors.statusStreaming : ScoutColors.statusStreaming,
                    enabled: isConnected || inbox.pendingCount > 0
                ) {
                    router.push(.inbox)
                }

                shortcutCard(
                    title: "New Session",
                    subtitle: isConnected
                        ? "Browse your workspace and launch a fresh agent."
                        : "Connect to your Mac to launch a new session.",
                    icon: "plus.circle.fill",
                    accent: ScoutColors.accent,
                    enabled: isConnected
                ) {
                    router.push(.newSession)
                }

                shortcutCard(
                    title: "Agents",
                    subtitle: isConnected
                        ? "See every live agent and jump into its session."
                        : "Connect to browse the agents on your Mac.",
                    icon: "person.3.fill",
                    accent: ScoutColors.statusActive,
                    enabled: isConnected
                ) {
                    router.push(.agents)
                }
            }
            .padding(.horizontal, ScoutSpacing.lg)
        }
        .padding(.top, ScoutSpacing.xl)
    }

    private func shortcutCard(
        title: String,
        subtitle: String,
        icon: String,
        accent: Color,
        enabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button {
            let impact = UIImpactFeedbackGenerator(style: .light)
            impact.impactOccurred()
            action()
        } label: {
            VStack(alignment: .leading, spacing: ScoutSpacing.md) {
                ZStack {
                    RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous)
                        .fill(accent.opacity(enabled ? 0.14 : 0.08))
                        .frame(width: 40, height: 40)

                    Image(systemName: icon)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(enabled ? accent : ScoutColors.textMuted)
                }

                VStack(alignment: .leading, spacing: ScoutSpacing.xs) {
                    Text(title)
                        .font(ScoutTypography.body(15, weight: .semibold))
                        .foregroundStyle(ScoutColors.textPrimary)

                    Text(subtitle)
                        .font(ScoutTypography.caption(12))
                        .foregroundStyle(ScoutColors.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer()

                HStack(spacing: ScoutSpacing.xs) {
                    Text(enabled ? "Open" : "Offline")
                        .font(ScoutTypography.caption(11, weight: .semibold))
                        .foregroundStyle(enabled ? accent : ScoutColors.textMuted)

                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(enabled ? accent : ScoutColors.textMuted)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 132, alignment: .leading)
            .opacity(enabled ? 1 : 0.72)
            .scoutCard(padding: ScoutSpacing.md, cornerRadius: ScoutRadius.lg)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    // MARK: - Active Sessions (horizontal scroll)

    private var activeSessionsSection: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
            sectionHeader("Active")
                .padding(.horizontal, ScoutSpacing.lg)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: ScoutSpacing.md) {
                    ForEach(activeSummaries) { summary in
                        activeSessionCard(summary)
                            .onTapGesture {
                                router.push(.sessionDetail(sessionId: summary.sessionId))
                            }
                    }
                }
                .padding(.horizontal, ScoutSpacing.lg)
            }
        }
        .padding(.top, ScoutSpacing.xl)
    }

    private func activeSessionCard(_ summary: SessionSummary) -> some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
            HStack(spacing: ScoutSpacing.sm) {
                Image(systemName: AdapterIcon.systemName(for: summary.adapterType))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(ScoutColors.accent)

                StatusDot(SessionStatus(rawValue: summary.status) ?? .idle, size: 7)
            }

            Text(summary.name)
                .font(ScoutTypography.body(14, weight: .semibold))
                .foregroundStyle(ScoutColors.textPrimary)
                .lineLimit(2)

            HStack(spacing: ScoutSpacing.xs) {
                if summary.currentTurnStatus == "streaming" || summary.currentTurnStatus == "started" {
                    PulseIndicator()
                    Text("Working")
                        .font(ScoutTypography.caption(11, weight: .medium))
                        .foregroundStyle(ScoutColors.statusStreaming)
                } else {
                    Text(RelativeTime.string(from: summary.lastActivityAt))
                        .font(ScoutTypography.caption(11))
                        .foregroundStyle(ScoutColors.textMuted)
                }
            }
        }
        .frame(width: 150, alignment: .leading)
        .scoutCard(padding: ScoutSpacing.md, cornerRadius: ScoutRadius.md)
    }

    // MARK: - Recent Sessions (vertical list)

    private var recentSessionsSection: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
            sectionHeader("Recent")
                .padding(.horizontal, ScoutSpacing.lg)

            LazyVStack(spacing: 0) {
                ForEach(recentSummaries) { summary in
                    Button {
                        router.push(.sessionDetail(sessionId: summary.sessionId))
                    } label: {
                        SessionRowView(summary: summary)
                            .padding(.horizontal, ScoutSpacing.lg)
                            .padding(.vertical, ScoutSpacing.xs)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)

                    if summary.id != recentSummaries.last?.id {
                        Rectangle()
                            .fill(ScoutColors.divider)
                            .frame(height: 0.5)
                            .padding(.horizontal, ScoutSpacing.xl)
                    }
                }
            }
        }
        .padding(.top, ScoutSpacing.xl)
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: ScoutSpacing.xl) {
            Spacer().frame(height: 60)

            VStack(spacing: ScoutSpacing.lg) {
                ZStack {
                    Circle()
                        .fill(ScoutColors.accent.opacity(0.08))
                        .frame(width: 80, height: 80)

                    Image(systemName: "rectangle.connected.to.line.below")
                        .font(.system(size: 32, weight: .light))
                        .foregroundStyle(ScoutColors.accent.opacity(0.6))
                }

                VStack(spacing: ScoutSpacing.sm) {
                    Text("No sessions")
                        .font(ScoutTypography.body(20, weight: .semibold))
                        .foregroundStyle(ScoutColors.textPrimary)

                    Text(isConnected
                         ? "Start a new session or jump into an available agent."
                         : "Connect to a bridge to see your sessions.")
                        .font(ScoutTypography.body(15))
                        .foregroundStyle(ScoutColors.textSecondary)
                        .multilineTextAlignment(.center)
                }
            }
        }
        .padding(.horizontal, ScoutSpacing.xxl)
    }

    // MARK: - Helpers

    private func sectionHeader(_ title: String) -> some View {
        Text(title.uppercased())
            .font(ScoutTypography.caption(12, weight: .bold))
            .foregroundStyle(ScoutColors.textMuted)
            .padding(.top, ScoutSpacing.sm)
    }

    private func refreshSessions() async {
        isRefreshing = true
        await connection.refreshRelaySessions()
        isRefreshing = false
    }
}
