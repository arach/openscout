import SwiftUI
import Foundation
import HudsonUI
import HudsonLive
import ScoutCapabilities

/// Tail — recent cross-agent activity. Mobile polls a recent-tail snapshot while
/// this surface is open, then renders it as a searchable log instead of a raw
/// terminal firehose.
struct TailSurface: View {
    let client: any ScoutBrokerClient
    var reloadToken: Int = 0

    private static let maxRows = 200
    private static let pollIntervalSeconds: Double = 15

    @State private var events: [TailEvent] = []
    @State private var expanded: Set<String> = []
    @State private var searchText = ""
    @State private var lastUpdated: Date?
    @State private var refreshToken = 0

    private static let hmFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "HH:mm"
        return f
    }()

    private var normalizedQuery: String {
        searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private var filteredEvents: [TailEvent] {
        let tokens = normalizedQuery
            .split(whereSeparator: { $0.isWhitespace })
            .map(String.init)
        guard !tokens.isEmpty else { return events }
        return events.filter { event in
            let haystack = searchableText(for: event)
            return tokens.allSatisfy { haystack.contains($0) }
        }
    }

    private var resultDetail: String? {
        if !normalizedQuery.isEmpty {
            return "\(filteredEvents.count) of \(events.count)"
        }
        guard !events.isEmpty else { return nil }
        return "\(events.count) logs"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            header
            HudField("Search incoming messages", text: $searchText, icon: "magnifyingglass")
            content
        }
        .padding(.horizontal, HudSpacing.xxl)
        .padding(.top, HudSpacing.lg)
        .padding(.bottom, HudSpacing.xxl)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .task(id: reloadToken) { await poll() }
        .task(id: refreshToken) { if refreshToken != 0 { await fetchOnce() } }
    }

    private var header: some View {
        HStack(spacing: HudSpacing.sm) {
            HudSectionLabel("Tail")
            if let resultDetail {
                Text(resultDetail)
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutInk.dim)
            }
            Spacer()
            if let lastUpdated {
                Text("updated \(Self.hmFormatter.string(from: lastUpdated))")
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutInk.dim)
            }
            Button { refreshToken += 1 } label: {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(ScoutInk.muted)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Refresh tail")
        }
    }

    @ViewBuilder
    private var content: some View {
        if events.isEmpty {
            listCard {
                HudEmptyState(
                    title: "No recent logs",
                    subtitle: "Incoming agent messages will appear here.",
                    icon: "waveform"
                )
                .frame(maxWidth: .infinity)
                .padding(HudSpacing.xxl)
            }
            Spacer(minLength: 0)
        } else if filteredEvents.isEmpty {
            listCard {
                HudEmptyState(
                    title: "No matches",
                    subtitle: "Try a source, project, kind, path, or message text.",
                    icon: "magnifyingglass"
                )
                .frame(maxWidth: .infinity)
                .padding(HudSpacing.xxl)
            }
            Spacer(minLength: 0)
        } else {
            listCard {
                ScrollView(.vertical, showsIndicators: filteredEvents.count > 14) {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(filteredEvents.enumerated()), id: \.element.id) { index, event in
                            if index > 0 { rowSeparator() }
                            TailLogRow(
                                event: event,
                                isExpanded: expanded.contains(event.id),
                                onToggle: { toggle(event.id) }
                            )
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func listCard<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 0) { content() }
            .scoutCard()
    }

    private func rowSeparator() -> some View {
        Rectangle()
            .fill(HudHairline.subtle)
            .frame(height: 1)
            .padding(.leading, HudSpacing.xxl)
    }

    private func toggle(_ id: String) {
        if expanded.contains(id) {
            expanded.remove(id)
        } else {
            expanded.insert(id)
        }
    }

    private func searchableText(for event: TailEvent) -> String {
        [
            event.summary,
            event.source,
            tailKindLabel(event.kind),
            event.kind.rawValue,
            tailHarnessLabel(event.harness),
            event.project,
            event.cwd,
            tailPathLabel(event),
            event.conversationId,
        ]
        .compactMap { $0?.lowercased() }
        .joined(separator: " ")
    }

    private func poll() async {
        while !Task.isCancelled {
            await fetchOnce()
            if Task.isCancelled { break }
            try? await Task.sleep(for: .seconds(Self.pollIntervalSeconds))
        }
    }

    private func fetchOnce() async {
        guard let snapshot = try? await client.recentTail(limit: Self.maxRows),
              !Task.isCancelled else { return }
        events = snapshot.sorted { $0.tsMs > $1.tsMs }
        lastUpdated = Date()
    }
}

private struct TailLogRow: View {
    let event: TailEvent
    let isExpanded: Bool
    let onToggle: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Button(action: onToggle) { rowContent }
                .buttonStyle(.plain)

            if isExpanded {
                expandedDetail
            }
        }
    }

    private var rowContent: some View {
        HStack(alignment: .top, spacing: HudSpacing.md) {
            HudStatusDot(color: tailKindColor(event.kind), size: 6, pulses: false)
                .padding(.top, 6)
            VStack(alignment: .leading, spacing: 3) {
                Text(event.summary)
                    .font(HudFont.ui(HudTextSize.sm))
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(isExpanded ? 5 : 2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(metaLine)
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutInk.muted)
                    .lineLimit(1)
            }
            Glyphic.chevron(isExpanded ? .bottom : .trailing, size: 13)
                .foregroundStyle(ScoutInk.dim)
                .padding(.top, 5)
        }
        .padding(.horizontal, HudSpacing.xl)
        .padding(.vertical, HudSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    private var expandedDetail: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            Text(detailLine)
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(ScoutInk.dim)
                .lineLimit(2)
            if let conversationId = event.conversationId, !conversationId.isEmpty {
                Text("thread \(conversationId)")
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutInk.dim)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .padding(.leading, HudSpacing.xxl + HudSpacing.md)
        .padding(.trailing, HudSpacing.xl)
        .padding(.bottom, HudSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var metaLine: String {
        var parts = [event.source, tailKindLabel(event.kind)]
        if let project = event.project, !project.isEmpty {
            parts.append(project)
        }
        if let age = ScoutTimestamp.relativeAge(fromEpoch: TimeInterval(event.tsMs)) {
            parts.append(age)
        }
        return parts.joined(separator: " · ")
    }

    private var detailLine: String {
        var parts = [tailHarnessLabel(event.harness)]
        if let path = tailPathLabel(event), !path.isEmpty {
            parts.append(path)
        }
        if let clock = ScoutTimestamp.clockTime(fromEpoch: TimeInterval(event.tsMs)) {
            parts.append(clock)
        }
        return parts.joined(separator: " · ")
    }
}

private func tailKindLabel(_ kind: TailEvent.Kind) -> String {
    switch kind {
    case .user: return "user"
    case .assistant: return "assistant"
    case .tool: return "tool"
    case .toolResult: return "tool result"
    case .system: return "system"
    case .other: return "other"
    }
}

private func tailHarnessLabel(_ harness: TailEvent.Harness) -> String {
    switch harness {
    case .scoutManaged: return "Scout"
    case .hudsonManaged: return "Hudson"
    case .unattributed: return "Unattributed"
    }
}

private func tailKindColor(_ kind: TailEvent.Kind) -> Color {
    switch kind {
    case .assistant: return HudPalette.accent
    case .tool, .toolResult: return HudPalette.statusWarn
    case .user: return ScoutInk.muted
    case .system, .other: return ScoutInk.dim
    }
}

private func tailPathLabel(_ event: TailEvent) -> String? {
    if let project = event.project, !project.isEmpty, let cwd = event.cwd, let range = cwd.range(of: "/" + project) {
        return String(cwd[range.lowerBound...])
    }
    if let project = event.project, !project.isEmpty {
        return "/" + project
    }
    if let cwd = event.cwd, !cwd.isEmpty {
        return "/" + cwd.split(separator: "/").suffix(2).joined(separator: "/")
    }
    return nil
}
