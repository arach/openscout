// HomeView — Landing surface replacing SessionListView.
//
// Sections: bridge status bar, shortcuts, and live bridge sessions.

import SwiftUI

// MARK: - Dark Card Modifier

private struct DarkCardModifier: ViewModifier {
    var padding: CGFloat
    var cornerRadius: CGFloat
    @Environment(\.colorScheme) private var colorScheme

    private var strokeColor: Color {
        colorScheme == .dark ? Color.white.opacity(0.09) : Color.black.opacity(0.07)
    }

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(ScoutColors.cardBg)
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(strokeColor, lineWidth: 0.5)
            )
    }
}

private extension View {
    func darkCard(padding: CGFloat = ScoutSpacing.md, cornerRadius: CGFloat = ScoutRadius.lg) -> some View {
        modifier(DarkCardModifier(padding: padding, cornerRadius: cornerRadius))
    }
}

// MARK: - HomeView

struct HomeView: View {
    @Environment(SessionStore.self) private var store
    @Environment(InboxStore.self) private var inbox
    @Environment(ConnectionManager.self) private var connection
    @Environment(ScoutRouter.self) private var router

    @State private var isRefreshing = false
    @State private var showingConnectionSheet = false
    @State private var homeSearchText = ""
    @State private var searchKeyboardActive = false

    private let shortcutColumns = [
        GridItem(.flexible(), spacing: ScoutSpacing.sm),
        GridItem(.flexible(), spacing: ScoutSpacing.sm),
        GridItem(.flexible(), spacing: ScoutSpacing.sm),
    ]

    private var isConnected: Bool {
        connection.state == .connected
    }

    private var surfacedSummaries: [SessionSummary] {
        // Home mirrors the connected bridge surface. Cached-only sessions belong
        // in Saved Sessions, not in the primary list that disappears after sync.
        guard isConnected, store.hasReceivedLiveList else {
            return []
        }

        return store.summaries
            .filter { !$0.isCachedOnly }
            .sorted { $0.lastActivityAt > $1.lastActivityAt }
    }

    private var filteredSummaries: [SessionSummary] {
        guard !homeSearchText.isEmpty else { return [] }
        return surfacedSummaries.filter {
            $0.name.localizedCaseInsensitiveContains(homeSearchText)
        }
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

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                bridgeStatusBar
                    .padding(.horizontal, ScoutSpacing.lg)
                    .padding(.top, ScoutSpacing.lg)

                searchBar

                if homeSearchText.isEmpty {
                    shortcutsSection

                    if inbox.pendingCount > 0 {
                        inboxAttentionSection
                    }

                    let stillLoading = isConnected && !store.hasReceivedLiveList
                    if !stillLoading {
                        if !activeSummaries.isEmpty {
                            activeSessionsSection
                                .transition(.opacity)
                        }

                        if !recentSummaries.isEmpty {
                            recentSessionsSection
                                .transition(.opacity)
                        }

                        if surfacedSummaries.isEmpty {
                            emptyState
                                .transition(.opacity)
                        }
                    } else if surfacedSummaries.isEmpty {
                        emptyState
                            .transition(.opacity)
                    }
                } else {
                    searchResultsSection
                }

                Color.clear.frame(height: 100)
            }
        }
        .background(ScoutColors.pageBg)
        .animation(.easeInOut(duration: 0.3), value: store.hasReceivedLiveList)
        .safeAreaInset(edge: .bottom) {
            if searchKeyboardActive {
                ScoutKeyboardView(
                    text: $homeSearchText,
                    onInsert: { homeSearchText.append($0) },
                    onDelete: { if !homeSearchText.isEmpty { homeSearchText.removeLast() } },
                    onReturn: {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
                            searchKeyboardActive = false
                        }
                    },
                    onVoice: {},
                    onDismiss: {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
                            searchKeyboardActive = false
                        }
                    }
                )
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .refreshable {
            await refreshSessions()
        }
        .task(id: isConnected) {
            guard isConnected else { return }
            await refreshSessions()
        }
        .sheet(isPresented: $showingConnectionSheet) {
            ConnectionStatusSheet()
                .environment(connection)
                .environment(store)
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }

    // MARK: - Bridge Status Bar

    /// Letters between the brackets — `LAN` / `TSN` / `OSN` / `WAN` / `LOCAL` when
    /// connected, `…` while connecting, `OFF` when down.
    private var bridgeIndicatorLetters: String {
        if connection.state == .connected {
            let label = connection.transportKind.label
            return label.isEmpty ? "ON" : label
        }
        switch connection.state {
        case .connecting, .handshaking, .reconnecting: return "…"
        case .disconnected, .failed: return "OFF"
        case .connected: return "ON"
        }
    }

    /// Color applied to the inner letters only — green for LAN, amber for routed
    /// networks, red for WAN / disconnected. Brackets stay muted.
    private var bridgeIndicatorColor: Color {
        if connection.state == .connected {
            switch connection.transportKind {
            case .lan: return ScoutColors.ledGreen
            case .tailnet, .oscout: return ScoutColors.ledAmber
            case .remote: return ScoutColors.ledRed
            case .loopback, .none: return ScoutColors.ledGreen
            }
        }
        switch connection.state {
        case .connecting, .handshaking, .reconnecting: return ScoutColors.ledAmber
        case .disconnected, .failed: return ScoutColors.ledRed
        case .connected: return ScoutColors.ledGreen
        }
    }

    private var bridgeStatusBar: some View {
        HStack(spacing: 0) {
            // Bracketed mode indicator (replaces LED dot). Brackets are muted;
            // the letters carry the transport / state color.
            Button { showingConnectionSheet = true } label: {
                HStack(spacing: 0) {
                    Text("[")
                        .foregroundStyle(ScoutColors.textMuted)
                    Text(bridgeIndicatorLetters)
                        .foregroundStyle(bridgeIndicatorColor)
                    Text("]")
                        .foregroundStyle(ScoutColors.textMuted)
                }
                .font(ScoutTypography.code(10, weight: .bold))
                .padding(.horizontal, ScoutSpacing.md)
            }
            .buttonStyle(.plain)

            // Divider
            Rectangle()
                .fill(ScoutColors.divider)
                .frame(width: 0.5)
                .padding(.vertical, ScoutSpacing.sm)

            // Bridge label + status
            Button { showingConnectionSheet = true } label: {
                HStack(spacing: ScoutSpacing.sm) {
                    Text("BRIDGE")
                        .font(ScoutTypography.code(9, weight: .semibold))
                        .foregroundStyle(ScoutColors.textMuted)

                    Text(connectionCardSubtitle)
                        .font(ScoutTypography.code(11))
                        .foregroundStyle(ScoutColors.textSecondary)
                        .lineLimit(1)
                        .contentTransition(.opacity)
                        .animation(.easeInOut(duration: 0.25), value: connectionCardSubtitle)
                }
                .padding(.horizontal, ScoutSpacing.md)
            }
            .buttonStyle(.plain)

            Spacer()

            // Divider before gear
            Rectangle()
                .fill(ScoutColors.divider)
                .frame(width: 0.5)
                .padding(.vertical, ScoutSpacing.sm)

            // Settings gear
            Button { router.push(.settings) } label: {
                Image(systemName: "gearshape")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(ScoutColors.textMuted)
                    .padding(.horizontal, ScoutSpacing.md)
            }
            .buttonStyle(.plain)
        }
        .frame(height: 36)
        .background(ScoutColors.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: ScoutRadius.lg, style: .continuous)
                .stroke(Color.white.opacity(0.09), lineWidth: 0.5)
        )
    }

    private var connectionCardSubtitle: String {
        switch connection.state {
        case .connected:
            let count = liveSummaries.count
            return count == 0 ? "connected" : "\(count) session\(count == 1 ? "" : "s")"
        default:
            return connection.statusDetails.shortLabel.lowercased()
        }
    }

    // MARK: - Search Bar

    private var searchBar: some View {
        HStack(spacing: ScoutSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(ScoutColors.textMuted)

            ScoutSearchField(
                text: $homeSearchText,
                placeholder: "Search sessions, agents...",
                onFocusChange: { focused in
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
                        searchKeyboardActive = focused
                    }
                },
                onReturn: {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
                        searchKeyboardActive = false
                    }
                }
            )
            .frame(height: 28)

            if searchKeyboardActive {
                Button {
                    homeSearchText = ""
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
                        searchKeyboardActive = false
                    }
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(ScoutColors.textMuted)
                }
                .buttonStyle(.plain)
                .transition(.opacity.combined(with: .scale))
            }
        }
        .padding(.horizontal, ScoutSpacing.md)
        .padding(.vertical, ScoutSpacing.sm)
        .background(ScoutColors.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: ScoutRadius.lg, style: .continuous)
                .stroke(ScoutColors.divider.opacity(0.6), lineWidth: 0.5)
        )
        .padding(.horizontal, ScoutSpacing.lg)
        .padding(.top, ScoutSpacing.sm)
    }

    // MARK: - Search Results

    private var searchResultsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            sectionHeader("Results")
                .padding(.horizontal, ScoutSpacing.lg)
                .padding(.top, ScoutSpacing.xl)

            if filteredSummaries.isEmpty {
                Text("No sessions match \"\(homeSearchText)\"")
                    .font(ScoutTypography.body(14))
                    .foregroundStyle(ScoutColors.textSecondary)
                    .padding(.horizontal, ScoutSpacing.lg)
                    .padding(.top, ScoutSpacing.md)
            } else {
                LazyVStack(spacing: 0) {
                    ForEach(filteredSummaries) { summary in
                        Button {
                            router.push(.sessionDetail(sessionId: summary.sessionId))
                        } label: {
                            SessionRowView(summary: summary, compact: true)
                                .padding(.horizontal, ScoutSpacing.lg)
                                .padding(.vertical, ScoutSpacing.xs)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)

                        if summary.id != filteredSummaries.last?.id {
                            Rectangle()
                                .fill(Color.white.opacity(0.06))
                                .frame(height: 0.5)
                                .padding(.horizontal, ScoutSpacing.xl)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Shortcuts

    private var shortcutsSection: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
            sectionHeader("Explore")
                .padding(.horizontal, ScoutSpacing.lg)

            LazyVGrid(columns: shortcutColumns, spacing: ScoutSpacing.md) {
                shortcutCard(
                    title: "Inbox",
                    icon: inbox.unreadCount > 0 ? "bell.badge.fill" : "tray.full.fill",
                    badge: inbox.pendingCount > 0 ? "\(inbox.pendingCount) pending" : nil,
                    enabled: isConnected || inbox.pendingCount > 0
                ) {
                    router.push(.inbox)
                }

                shortcutCard(
                    title: "Agents",
                    icon: "person.3.fill",
                    badge: nil,
                    enabled: isConnected
                ) {
                    router.push(.agents)
                }

                shortcutCard(
                    title: "Session",
                    icon: "plus.circle.fill",
                    badge: nil,
                    enabled: isConnected
                ) {
                    router.push(.newSession)
                }
            }
            .padding(.horizontal, ScoutSpacing.lg)
        }
        .padding(.top, ScoutSpacing.lg)
    }

    private func shortcutCard(
        title: String,
        icon: String,
        badge: String?,
        enabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button {
            let impact = UIImpactFeedbackGenerator(style: .light)
            impact.impactOccurred()
            action()
        } label: {
            VStack(alignment: .center, spacing: 3) {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(enabled ? ScoutColors.textSecondary : ScoutColors.textMuted)

                Text(title)
                    .font(ScoutTypography.code(11, weight: .medium))
                    .foregroundStyle(enabled ? ScoutColors.textPrimary : ScoutColors.textMuted)
                    .multilineTextAlignment(.center)

                if let badge {
                    Text(badge)
                        .font(ScoutTypography.code(8))
                        .foregroundStyle(ScoutColors.textMuted)
                        .multilineTextAlignment(.center)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, ScoutSpacing.md)
            .opacity(enabled ? 1 : 0.4)
            .darkCard(padding: 0, cornerRadius: ScoutRadius.md)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    // MARK: - Inbox Attention

    private var inboxAttentionSection: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
            sectionHeader("Inbox")
                .padding(.horizontal, ScoutSpacing.lg)

            Button {
                let impact = UIImpactFeedbackGenerator(style: .light)
                impact.impactOccurred()
                router.push(.inbox)
            } label: {
                HStack(alignment: .top, spacing: ScoutSpacing.md) {
                    Image(systemName: inbox.unreadCount > 0 ? "bell.badge.fill" : "tray.full.fill")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(ScoutColors.accent)
                        .frame(width: 24, height: 24)

                    VStack(alignment: .leading, spacing: 4) {
                        Text(inboxAttentionTitle)
                            .font(ScoutTypography.body(15, weight: .semibold))
                            .foregroundStyle(ScoutColors.textPrimary)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        Text(inboxAttentionSubtitle)
                            .font(ScoutTypography.body(13))
                            .foregroundStyle(ScoutColors.textSecondary)
                            .multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(ScoutColors.textMuted)
                        .padding(.top, 2)
                }
                .padding(ScoutSpacing.lg)
                .darkCard(padding: 0, cornerRadius: ScoutRadius.lg)
            }
            .buttonStyle(.plain)
            .padding(.horizontal, ScoutSpacing.lg)
        }
        .padding(.top, ScoutSpacing.lg)
    }

    private var inboxAttentionTitle: String {
        if inbox.pendingCount == 1 {
            return "1 approval is waiting on you"
        }
        return "\(inbox.pendingCount) approvals are waiting on you"
    }

    private var inboxAttentionSubtitle: String {
        guard let item = inbox.items.first else {
            return inbox.unreadCount > 0
                ? "\(inbox.unreadCount) new inbox item\(inbox.unreadCount == 1 ? "" : "s")."
                : "Open Inbox to review pending approvals."
        }

        let prefix = inbox.unreadCount > 0
            ? "\(inbox.unreadCount) new · \(item.sessionName)"
            : item.sessionName
        return "\(prefix) — \(item.description)"
    }

    // MARK: - Active Sessions (grid)

    private let activeGridColumns = [
        GridItem(.flexible(), spacing: ScoutSpacing.md),
        GridItem(.flexible(), spacing: ScoutSpacing.md),
    ]

    private var activeSessionsSection: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
            sectionHeader("Sessions")
                .padding(.horizontal, ScoutSpacing.lg)

            LazyVGrid(columns: activeGridColumns, spacing: ScoutSpacing.md) {
                ForEach(activeSummaries) { summary in
                    activeSessionCell(summary)
                        .onTapGesture {
                            router.push(.sessionDetail(sessionId: summary.sessionId))
                        }
                }
            }
            .padding(.horizontal, ScoutSpacing.lg)
        }
        .padding(.top, ScoutSpacing.xl)
    }

    private func activeSessionCell(_ summary: SessionSummary) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: ScoutSpacing.xs) {
                StatusDot(SessionStatus(rawValue: summary.status) ?? .idle, size: 5)

                Text(summary.name)
                    .font(ScoutTypography.code(11, weight: .medium))
                    .foregroundStyle(ScoutColors.textPrimary)
                    .lineLimit(1)
            }

            HStack(spacing: ScoutSpacing.xs) {
                if summary.currentTurnStatus == "streaming" || summary.currentTurnStatus == "started" {
                    PulseIndicator()
                    Text("working")
                        .font(ScoutTypography.code(9))
                        .foregroundStyle(ScoutColors.textSecondary)
                } else {
                    Text(RelativeTime.string(from: summary.lastActivityAt))
                        .font(ScoutTypography.code(9))
                        .foregroundStyle(ScoutColors.textMuted)
                }

                Spacer(minLength: 0)

                Text(summary.adapterType)
                    .font(ScoutTypography.code(9))
                    .foregroundStyle(ScoutColors.textMuted)
                    .lineLimit(1)
            }
        }
        .darkCard(padding: ScoutSpacing.md, cornerRadius: ScoutRadius.md)
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
                            .fill(Color.white.opacity(0.06))
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
        VStack(spacing: ScoutSpacing.md) {
            Spacer().frame(height: 80)

            if isConnected && !store.hasReceivedLiveList {
                ProgressView()
                    .controlSize(.small)
                Text("Syncing…")
                    .font(ScoutTypography.code(11))
                    .foregroundStyle(ScoutColors.textMuted)
            } else {
                Text("NO SESSIONS")
                    .font(ScoutTypography.code(11, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)

                Text(isConnected
                     ? "Start a new session or jump into an available agent."
                     : "Connect to a bridge to see your sessions.")
                    .font(ScoutTypography.body(14))
                    .foregroundStyle(ScoutColors.textSecondary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(.horizontal, ScoutSpacing.xxl)
    }

    // MARK: - Helpers

    private func sectionHeader(_ title: String) -> some View {
        Text(title.uppercased())
            .font(ScoutTypography.code(9, weight: .semibold))
            .foregroundStyle(ScoutColors.textMuted)
            .padding(.top, ScoutSpacing.xs)
    }

    private func sectionHeaderWithCount(_ title: String, count: Int) -> some View {
        HStack {
            Text(title.uppercased())
                .font(ScoutTypography.code(9, weight: .semibold))
                .foregroundStyle(ScoutColors.textMuted)

            Spacer()

            Text("\(count) total")
                .font(ScoutTypography.code(9))
                .foregroundStyle(ScoutColors.textMuted)
        }
        .padding(.top, ScoutSpacing.xs)
    }

    private func refreshSessions() async {
        isRefreshing = true
        await connection.refreshRelaySessions()
        isRefreshing = false
    }
}
