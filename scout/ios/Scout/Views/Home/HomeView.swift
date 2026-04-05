// HomeView — Landing surface replacing SessionListView.
//
// Sections: device card (connection state), active sessions (horizontal),
// recent history (vertical, reuses SessionRowView).

import SwiftUI

struct HomeView: View {
    @Environment(SessionStore.self) private var store
    @Environment(ConnectionManager.self) private var connection
    @Environment(ScoutRouter.self) private var router

    @State private var isRefreshing = false

    private var isConnected: Bool {
        connection.state == .connected
    }

    private var liveSummaries: [SessionSummary] {
        store.summaries.filter { !$0.isCachedOnly }
            .sorted { $0.lastActivityAt > $1.lastActivityAt }
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
        liveSummaries.filter { summary in
            !activeSummaries.contains(where: { $0.sessionId == summary.sessionId })
        }
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                deviceCard
                    .padding(.horizontal, ScoutSpacing.lg)
                    .padding(.top, ScoutSpacing.lg)

                if !activeSummaries.isEmpty {
                    activeSessionsSection
                }

                if !recentSummaries.isEmpty {
                    recentSessionsSection
                }

                if liveSummaries.isEmpty {
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

            if !isConnected && connection.hasTrustedBridge {
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
        switch connection.state {
        case .connected: "desktopcomputer"
        case .connecting, .handshaking, .reconnecting: "arrow.triangle.2.circlepath"
        case .disconnected, .failed: "wifi.exclamationmark"
        }
    }

    private var connectionCardSubtitle: String {
        switch connection.state {
        case .connected:
            let count = liveSummaries.count
            return count == 0 ? "Connected — no active sessions" : "Connected — \(count) session\(count == 1 ? "" : "s")"
        case .connecting, .handshaking:
            return "Connecting to your Mac..."
        case .reconnecting(let attempt):
            return attempt > 1 ? "Reconnecting (attempt \(attempt))..." : "Reconnecting..."
        case .failed:
            return "Connection failed"
        case .disconnected:
            return "Disconnected"
        }
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
                         ? "Tap + to start a new session."
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
