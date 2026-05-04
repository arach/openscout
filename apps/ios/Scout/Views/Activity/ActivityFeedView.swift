// ActivityFeedView — Chronological feed of all agent activity.
//
// Fetches activity items from the broker via `mobile/activity` RPC and
// renders them as a scrollable timeline grouped by date. Each item shows
// the agent name, project, kind icon, and a title/summary.

import SwiftUI

struct ActivityFeedView: View {
    @Environment(ConnectionManager.self) private var connection
    @Environment(ScoutRouter.self) private var router
    @Environment(SessionStore.self) private var store

    @State private var items: [ActivityItem] = []
    @State private var isLoading = false
    @State private var error: String?
    @State private var dismissedIds: Set<String> = []

    private var isConnected: Bool {
        connection.state == .connected
    }

    /// Filtered items: remove transient noise like "working" status updates,
    /// plus anything the user has locally dismissed this session.
    private var feedItems: [ActivityItem] {
        items.filter { !$0.isNoise && !dismissedIds.contains($0.id) }
    }

    private var groupedItems: [(String, [ActivityItem])] {
        let calendar = Calendar.current
        let now = Date()
        let grouped = Dictionary(grouping: feedItems) { item -> String in
            let date = item.date
            if calendar.isDateInToday(date) { return "Today" }
            if calendar.isDateInYesterday(date) { return "Yesterday" }
            let days = calendar.dateComponents([.day], from: date, to: now).day ?? 0
            if days < 7 { return "\(days)d ago" }
            let formatter = DateFormatter()
            formatter.dateFormat = "MMM d"
            return formatter.string(from: date)
        }
        return grouped.sorted { a, b in
            let aTs = a.value.first?.tsMs ?? 0
            let bTs = b.value.first?.tsMs ?? 0
            return aTs > bTs
        }
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                // Top inset for status bar blur
                Color.clear.frame(height: 44)

                if isLoading && feedItems.isEmpty {
                    loadingState
                } else if feedItems.isEmpty {
                    emptyState
                } else {
                    feedContent
                }

                // Bottom padding for the bar
                Color.clear.frame(height: 100)
            }
        }
        .refreshable {
            await loadActivity()
        }
        .background(ScoutColors.backgroundAdaptive)
        .overlay(alignment: .top) {
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
        .task {
            await loadActivity()
        }
        .task(id: isConnected) {
            guard isConnected else { return }
            await loadActivity()
        }
    }

    // MARK: - Feed Content

    private var feedContent: some View {
        ForEach(groupedItems, id: \.0) { label, sectionItems in
            VStack(alignment: .leading, spacing: 0) {
                Text(label.uppercased())
                    .font(ScoutTypography.code(10, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)
                    .padding(.horizontal, ScoutSpacing.lg)
                    .padding(.top, ScoutSpacing.xxl)
                    .padding(.bottom, ScoutSpacing.md)

                ForEach(sectionItems) { item in
                    ActivityItemRow(item: item, canNavigate: canNavigate(item))
                        .contentShape(Rectangle())
                        .onTapGesture {
                            navigateToItem(item)
                        }
                        .contextMenu {
                            if canNavigate(item) {
                                Button {
                                    navigateToItem(item)
                                } label: {
                                    Label("Open Session", systemImage: "arrow.up.right.square")
                                }
                            }

                            Button {
                                UIPasteboard.general.string = copyText(for: item)
                            } label: {
                                Label("Copy Details", systemImage: "doc.on.doc")
                            }

                            Button(role: .destructive) {
                                withAnimation(.easeOut(duration: 0.18)) {
                                    dismissedIds.insert(item.id)
                                }
                            } label: {
                                Label("Dismiss", systemImage: "xmark.circle")
                            }
                        }

                    if item.id != sectionItems.last?.id {
                        Rectangle()
                            .fill(ScoutColors.divider)
                            .frame(height: 0.5)
                            .padding(.horizontal, ScoutSpacing.xl)
                    }
                }
            }
        }
    }

    // MARK: - Navigation

    /// Only navigate if we can resolve the item to a known Scout session.
    private func canNavigate(_ item: ActivityItem) -> Bool {
        resolveSessionId(for: item) != nil
    }

    private func resolveSessionId(for item: ActivityItem) -> String? {
        // Prefer sessionId, then conversationId, but only if it maps to a known session
        for candidate in [item.sessionId, item.conversationId] {
            guard let id = candidate else { continue }
            if store.sessions[id] != nil || store.summaries.contains(where: { $0.sessionId == id }) {
                return id
            }
        }
        return nil
    }

    private func navigateToItem(_ item: ActivityItem) {
        if let sessionId = resolveSessionId(for: item) {
            router.push(.sessionDetail(sessionId: sessionId))
        }
    }

    private func copyText(for item: ActivityItem) -> String {
        var lines: [String] = ["[\(item.kindLabel)] \(RelativeTime.string(from: item.tsMs))"]
        if let project = item.projectName { lines.append("project: \(project)") }
        if let title = item.title, !title.isEmpty { lines.append(title) }
        if let summary = item.summary, !summary.isEmpty, summary != item.title {
            lines.append(summary)
        }
        if let sessionId = item.sessionId { lines.append("session: \(sessionId)") }
        return lines.joined(separator: "\n")
    }

    // MARK: - Loading

    private var loadingState: some View {
        VStack(spacing: ScoutSpacing.lg) {
            Spacer().frame(height: 80)
            ProgressView()
                .controlSize(.regular)
            Text("Loading activity...")
                .font(ScoutTypography.body(14))
                .foregroundStyle(ScoutColors.textMuted)
            Spacer()
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: ScoutSpacing.lg) {
            Spacer().frame(height: 80)

            ZStack {
                Circle()
                    .fill(ScoutColors.accent.opacity(0.08))
                    .frame(width: 80, height: 80)

                Image(systemName: "text.line.first.and.arrowtriangle.forward")
                    .font(.system(size: 32, weight: .light))
                    .foregroundStyle(ScoutColors.accent.opacity(0.6))
            }

            VStack(spacing: ScoutSpacing.sm) {
                Text("No activity yet")
                    .font(ScoutTypography.body(20, weight: .semibold))
                    .foregroundStyle(ScoutColors.textPrimary)

                Text(isConnected
                     ? "Activity from your agents will appear here."
                     : "Connect to a bridge to see agent activity.")
                    .font(ScoutTypography.body(15))
                    .foregroundStyle(ScoutColors.textSecondary)
                    .multilineTextAlignment(.center)
            }

            Spacer()
        }
        .padding(.horizontal, ScoutSpacing.xxl)
    }

    // MARK: - Data

    @MainActor
    private func loadActivity() async {
        guard isConnected else { return }
        isLoading = true
        defer { isLoading = false }

        do {
            items = try await connection.getActivity(limit: 200)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Activity Item Row

private struct ActivityItemRow: View {
    let item: ActivityItem
    let canNavigate: Bool

    var body: some View {
        HStack(alignment: .top, spacing: ScoutSpacing.lg) {
            ZStack {
                RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous)
                    .fill(item.kindColor.opacity(0.10))
                    .frame(width: 28, height: 28)

                Image(systemName: item.kindIcon)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(item.kindColor)
            }
            .padding(.top, 1)

            VStack(alignment: .leading, spacing: ScoutSpacing.xs) {
                HStack(spacing: ScoutSpacing.xs) {
                    Text(item.kindLabel.uppercased())
                        .font(ScoutTypography.code(10, weight: .semibold))
                        .foregroundStyle(item.kindColor)

                    if let project = item.projectName {
                        Text(project)
                            .font(ScoutTypography.code(10))
                            .foregroundStyle(ScoutColors.textMuted)
                    }

                    Spacer()

                    Text(RelativeTime.string(from: item.tsMs))
                        .font(ScoutTypography.code(10))
                        .foregroundStyle(ScoutColors.textMuted)
                }

                if let title = item.title, !title.isEmpty {
                    Text(title)
                        .font(ScoutTypography.body(14))
                        .foregroundStyle(ScoutColors.textPrimary)
                        .lineLimit(2)
                }

                if let summary = item.summary, !summary.isEmpty, summary != item.title {
                    Text(summary)
                        .font(ScoutTypography.body(13))
                        .foregroundStyle(ScoutColors.textSecondary)
                        .lineLimit(2)
                }
            }

            if canNavigate {
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)
                    .padding(.top, 2)
            }
        }
        .padding(.horizontal, ScoutSpacing.lg)
        .padding(.vertical, ScoutSpacing.lg)
    }
}
