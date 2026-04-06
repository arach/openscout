// AllSessionsGridView — Card grid for browsing all sessions.
//
// Grouped by Active / Today / Yesterday / Older. Searchable.
// Tap a card to push .sessionDetail.

import SwiftUI

struct AllSessionsGridView: View {
    @Environment(SessionStore.self) private var store
    @Environment(ConnectionManager.self) private var connection
    @Environment(ScoutRouter.self) private var router

    @State private var searchText = ""

    private let columns = [
        GridItem(.flexible(), spacing: ScoutSpacing.md),
        GridItem(.flexible(), spacing: ScoutSpacing.md),
    ]

    private var visibleSummaries: [SessionSummary] {
        let source = connection.state == .connected ? store.summaries.filter { !$0.isCachedOnly } : store.summaries
        return source.sorted { $0.lastActivityAt > $1.lastActivityAt }
    }

    private var filteredSummaries: [SessionSummary] {
        let tokens = searchText.searchTokens
        guard !tokens.isEmpty else { return visibleSummaries }
        return visibleSummaries.filter { summary in
            tokens.allSatisfy { token in
                summary.name.localizedCaseInsensitiveContains(token)
                    || summary.adapterType.localizedCaseInsensitiveContains(token)
                    || (summary.project?.localizedCaseInsensitiveContains(token) ?? false)
            }
        }
    }

    private var groupedSummaries: [(title: String, sessions: [SessionSummary])] {
        let calendar = Calendar.current
        let now = Date()
        let startOfToday = calendar.startOfDay(for: now)
        let startOfYesterday = calendar.date(byAdding: .day, value: -1, to: startOfToday)!

        var active: [SessionSummary] = []
        var today: [SessionSummary] = []
        var yesterday: [SessionSummary] = []
        var older: [SessionSummary] = []

        for summary in filteredSummaries {
            let status = SessionStatus(rawValue: summary.status)
            let isActive = !summary.isCachedOnly && (
                status == .active || status == .connecting
                    || summary.currentTurnStatus == "streaming"
                    || summary.currentTurnStatus == "started"
            )

            if isActive {
                active.append(summary)
            } else {
                let date = Date(timeIntervalSince1970: Double(summary.lastActivityAt) / 1000.0)
                if date >= startOfToday {
                    today.append(summary)
                } else if date >= startOfYesterday {
                    yesterday.append(summary)
                } else {
                    older.append(summary)
                }
            }
        }

        var groups: [(String, [SessionSummary])] = []
        if !active.isEmpty { groups.append(("Active", active)) }
        if !today.isEmpty { groups.append(("Today", today)) }
        if !yesterday.isEmpty { groups.append(("Yesterday", yesterday)) }
        if !older.isEmpty { groups.append(("Older", older)) }
        return groups
    }

    var body: some View {
        ScrollView {
            if filteredSummaries.isEmpty {
                emptyState
            } else {
                LazyVStack(alignment: .leading, spacing: ScoutSpacing.xl) {
                    if connection.state == .connected {
                        Button {
                            let impact = UIImpactFeedbackGenerator(style: .light)
                            impact.impactOccurred()
                            router.push(.newSession)
                        } label: {
                            HStack(spacing: ScoutSpacing.sm) {
                                Image(systemName: "plus.circle.fill")
                                    .font(.system(size: 15, weight: .medium))
                                    .foregroundStyle(ScoutColors.accent)
                                Text("New Session")
                                    .font(ScoutTypography.body(15, weight: .semibold))
                                    .foregroundStyle(ScoutColors.accent)
                                Spacer()
                            }
                            .padding(.horizontal, ScoutSpacing.lg)
                            .padding(.vertical, ScoutSpacing.md)
                        }
                        .buttonStyle(.plain)
                    }

                    ForEach(groupedSummaries, id: \.title) { group in
                        VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
                            Text(group.title.uppercased())
                                .font(ScoutTypography.caption(12, weight: .bold))
                                .foregroundStyle(ScoutColors.textMuted)
                                .padding(.horizontal, ScoutSpacing.lg)

                            LazyVGrid(columns: columns, spacing: ScoutSpacing.md) {
                                ForEach(group.sessions) { summary in
                                    SessionCardView(summary: summary)
                                        .onTapGesture {
                                            router.push(.sessionDetail(sessionId: summary.sessionId))
                                        }
                                }
                            }
                            .padding(.horizontal, ScoutSpacing.lg)
                        }
                    }

                    // Bottom padding for bar
                    Color.clear.frame(height: 100)
                }
                .padding(.top, ScoutSpacing.lg)
            }
        }
        .searchable(text: $searchText, prompt: "Search sessions")
        .background(ScoutColors.backgroundAdaptive)
    }

    private var emptyState: some View {
        VStack(spacing: ScoutSpacing.lg) {
            Spacer().frame(height: 80)

            Image(systemName: searchText.isEmpty ? "square.grid.2x2" : "magnifyingglass")
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(ScoutColors.textMuted)

            Text(searchText.isEmpty ? "No sessions" : "No matching sessions")
                .font(ScoutTypography.body(17, weight: .semibold))
                .foregroundStyle(ScoutColors.textPrimary)

            if !searchText.isEmpty {
                Text("Try a different search term.")
                    .font(ScoutTypography.body(14))
                    .foregroundStyle(ScoutColors.textSecondary)
            } else if connection.state != .connected {
                Text("Cached sessions on this iPhone remain available while your Mac is offline.")
                    .font(ScoutTypography.body(14))
                    .foregroundStyle(ScoutColors.textSecondary)
                    .multilineTextAlignment(.center)
            }

            Spacer()
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, ScoutSpacing.xxl)
    }
}
