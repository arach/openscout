// SessionsLedgerView — iOS port of macOS HUDSessionsView.
//
// Single-column cockpit ledger: status dot + identity line, meta strip,
// tap-to-expand inline detail. Replaces the prior 2-column card grid.

import SwiftUI

// MARK: - Status

private enum LedgerStatus: Sendable {
    case running, idle, ended

    var label: String {
        switch self {
        case .running: "RUNNING"
        case .idle:    "IDLE"
        case .ended:   "ENDED"
        }
    }

    var color: Color {
        switch self {
        case .running: ScoutColors.accent
        case .idle:    ScoutColors.textSecondary
        case .ended:   ScoutColors.textMuted
        }
    }

    static func from(summary: SessionSummary) -> LedgerStatus {
        if summary.isCachedOnly { return .ended }
        let status = SessionStatus(rawValue: summary.status)
        if summary.currentTurnStatus == "streaming"
            || summary.currentTurnStatus == "started"
            || status == .active
            || status == .connecting {
            return .running
        }
        if status == .closed || status == .error {
            return .ended
        }
        return .idle
    }
}

// MARK: - Ledger page

struct SessionsLedgerView: View {
    @Environment(SessionStore.self) private var store
    @Environment(ConnectionManager.self) private var connection
    @Environment(ScoutRouter.self) private var router

    @State private var searchText = ""
    @State private var engagedId: String?
    @FocusState private var isSearchFocused: Bool

    private var sortedSummaries: [SessionSummary] {
        store.summaries.sorted { $0.lastActivityAt > $1.lastActivityAt }
    }

    private var filtered: [SessionSummary] {
        let tokens = searchText.searchTokens
        guard !tokens.isEmpty else { return sortedSummaries }
        return sortedSummaries.filter { s in
            tokens.allSatisfy { token in
                s.name.localizedCaseInsensitiveContains(token)
                    || s.adapterType.localizedCaseInsensitiveContains(token)
                    || (s.project?.localizedCaseInsensitiveContains(token) ?? false)
                    || (s.model?.localizedCaseInsensitiveContains(token) ?? false)
            }
        }
    }

    private var runningCount: Int {
        filtered.reduce(0) { acc, s in
            LedgerStatus.from(summary: s) == .running ? acc + 1 : acc
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            mastHead
            searchBar

            if filtered.isEmpty {
                emptyState
            } else {
                ledgerScroll
            }
        }
        .background(ScoutColors.backgroundAdaptive)
    }

    // MARK: Masthead

    private var mastHead: some View {
        HStack(alignment: .firstTextBaseline, spacing: ScoutSpacing.md) {
            Text("Sessions")
                .font(ScoutTypography.body(22, weight: .semibold))
                .foregroundStyle(ScoutColors.textPrimary)

            Spacer()

            if connection.state == .connected {
                Button {
                    let impact = UIImpactFeedbackGenerator(style: .light)
                    impact.impactOccurred()
                    router.push(.newSession)
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(ScoutColors.accent)
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("New session")
            }
        }
        .padding(.horizontal, ScoutSpacing.lg)
        .padding(.top, ScoutSpacing.xl)
        .padding(.bottom, ScoutSpacing.xs)
        .overlay(alignment: .bottom) {
            ledgerEyebrow
                .padding(.horizontal, ScoutSpacing.lg)
                .padding(.bottom, 6)
                .frame(maxWidth: .infinity, alignment: .leading)
                .offset(y: 22)
        }
        .padding(.bottom, 28)
    }

    private var ledgerEyebrow: some View {
        let total = filtered.count
        let label = "\(total) SESSION\(total == 1 ? "" : "S")  ·  \(runningCount) RUNNING"
        return Text(label)
            .font(ScoutTypography.code(10, weight: .semibold))
            .tracking(1.2)
            .foregroundStyle(ScoutColors.textMuted)
    }

    // MARK: Search

    private var searchBar: some View {
        HStack(spacing: ScoutSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(ScoutColors.textMuted)

            TextField("Search name, adapter, project, model", text: $searchText)
                .font(ScoutTypography.code(13))
                .foregroundStyle(ScoutColors.textPrimary)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($isSearchFocused)
                .submitLabel(.search)

            if !searchText.isEmpty {
                Button {
                    searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(ScoutColors.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, ScoutSpacing.md)
        .frame(height: 36)
        .background(ScoutColors.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous)
                .stroke(ScoutColors.divider.opacity(isSearchFocused ? 1 : 0.5), lineWidth: 0.5)
        }
        .padding(.horizontal, ScoutSpacing.lg)
        .padding(.bottom, ScoutSpacing.md)
    }

    // MARK: Ledger scroll

    private var ledgerScroll: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(Array(filtered.enumerated()), id: \.element.sessionId) { idx, summary in
                        LedgerRow(
                            summary: summary,
                            isFirst: idx == 0,
                            engaged: engagedId == summary.sessionId,
                            onTap: {
                                let impact = UIImpactFeedbackGenerator(style: .soft)
                                impact.impactOccurred()
                                withAnimation(.easeOut(duration: 0.16)) {
                                    engagedId = engagedId == summary.sessionId ? nil : summary.sessionId
                                }
                            },
                            onOpen: {
                                router.push(.sessionDetail(sessionId: summary.sessionId))
                            }
                        )
                        .id(summary.sessionId)

                        if engagedId == summary.sessionId {
                            LedgerDetailInline(summary: summary) {
                                router.push(.sessionDetail(sessionId: summary.sessionId))
                            }
                            .transition(.move(edge: .top).combined(with: .opacity))
                        }
                    }
                    Color.clear.frame(height: 96)
                }
            }
            .onChange(of: engagedId) { _, id in
                guard let id else { return }
                withAnimation(.easeOut(duration: 0.16)) {
                    proxy.scrollTo(id, anchor: .top)
                }
            }
        }
    }

    // MARK: Empty

    private var emptyState: some View {
        VStack(spacing: 0) {
            Spacer().frame(height: 32)

            Text(searchText.isEmpty ? "LEDGER  ·  NO SESSIONS" : "LEDGER  ·  NO MATCH")
                .font(ScoutTypography.code(10, weight: .semibold))
                .tracking(1.2)
                .foregroundStyle(ScoutColors.textMuted)

            Text(searchText.isEmpty ? "No sessions running." : "No matching sessions.")
                .font(ScoutTypography.body(15, weight: .semibold))
                .foregroundStyle(ScoutColors.textPrimary)
                .padding(.top, 6)

            Text(emptyHint)
                .font(ScoutTypography.body(12))
                .foregroundStyle(ScoutColors.textSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, ScoutSpacing.xxl)
                .padding(.top, 6)

            if searchText.isEmpty, connection.state == .connected {
                Button {
                    let impact = UIImpactFeedbackGenerator(style: .light)
                    impact.impactOccurred()
                    router.push(.newSession)
                } label: {
                    Label("Start a session", systemImage: "sparkles")
                        .font(ScoutTypography.body(14, weight: .semibold))
                        .foregroundStyle(ScoutColors.accent)
                        .padding(.horizontal, ScoutSpacing.lg)
                        .padding(.vertical, ScoutSpacing.md)
                        .overlay(
                            RoundedRectangle(cornerRadius: ScoutRadius.sm)
                                .stroke(ScoutColors.accent.opacity(0.4), lineWidth: 0.5)
                        )
                }
                .buttonStyle(.plain)
                .padding(.top, ScoutSpacing.lg)
            }

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyHint: String {
        if !searchText.isEmpty { return "Try a different search term." }
        if connection.state != .connected {
            return "Cached sessions on this iPhone remain available while your Mac is offline."
        }
        return "Agent sessions will print here as the broker reports them."
    }
}

// MARK: - Row

private struct LedgerRow: View {
    let summary: SessionSummary
    let isFirst: Bool
    let engaged: Bool
    let onTap: () -> Void
    let onOpen: () -> Void

    private var status: LedgerStatus { .from(summary: summary) }

    private var rowFill: Color {
        if engaged { return ScoutColors.surfaceRaisedAdaptive.opacity(0.75) }
        return Color.clear
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            identityLine
            metaLine
        }
        .padding(.horizontal, ScoutSpacing.lg)
        .padding(.top, isFirst ? 13 : 12)
        .padding(.bottom, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(rowFill)
        .overlay(alignment: .leading) {
            if status == .running || engaged {
                Rectangle()
                    .fill(ScoutColors.accent)
                    .frame(width: 1.5)
            }
        }
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(ScoutColors.divider.opacity(0.6))
                .frame(height: 0.5)
                .padding(.horizontal, ScoutSpacing.lg)
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onTap)
        .contextMenu {
            Button("Open session", action: onOpen)
            Button("Copy session ID") {
                UIPasteboard.general.string = summary.sessionId
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityHint(engaged ? "Tap to collapse" : "Tap to expand")
    }

    private var identityLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            LedgerStatusDot(status: status)
                .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] + 4 }

            Text(summary.name)
                .font(ScoutTypography.body(15, weight: .semibold))
                .foregroundStyle(ScoutColors.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)

            Text(status.label)
                .font(ScoutTypography.code(9, weight: .semibold))
                .tracking(1.2)
                .foregroundStyle(status.color)
                .fixedSize()

            Spacer(minLength: 6)

            Text(RelativeTime.string(from: summary.lastActivityAt))
                .font(ScoutTypography.code(10, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(ScoutColors.textMuted)
                .fixedSize()
        }
    }

    private var metaLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            LedgerHarnessChip(harness: summary.adapterType)
            if let project = projectLabel {
                metaDot
                Text(project.uppercased())
                    .font(ScoutTypography.code(10))
                    .tracking(1.0)
                    .foregroundStyle(ScoutColors.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            if let modelLabel {
                metaDot
                Text(modelLabel)
                    .font(ScoutTypography.code(10))
                    .foregroundStyle(ScoutColors.textMuted)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            Spacer(minLength: 0)
            if summary.turnCount > 0 {
                Text("\(summary.turnCount) turn\(summary.turnCount == 1 ? "" : "s")")
                    .font(ScoutTypography.code(10))
                    .monospacedDigit()
                    .foregroundStyle(ScoutColors.textMuted)
                    .fixedSize()
            }
        }
        .padding(.leading, 14)
    }

    private var projectLabel: String? {
        summary.project?.trimmedNonEmpty
    }

    private var modelLabel: String? {
        ScoutModelLabel.describe(summary.model)?.title
    }

    private var metaDot: some View {
        Circle()
            .fill(ScoutColors.textMuted)
            .frame(width: 2, height: 2)
    }

    private var accessibilityLabel: String {
        var parts: [String] = [summary.name, AdapterIcon.displayName(for: summary.adapterType), status.label.lowercased()]
        if let p = projectLabel { parts.append(p) }
        return parts.joined(separator: ", ")
    }
}

// MARK: - Status dot

private struct LedgerStatusDot: View {
    let status: LedgerStatus
    @State private var pulseOn = false

    var body: some View {
        ZStack {
            switch status {
            case .running:
                Circle()
                    .fill(ScoutColors.accent.opacity(pulseOn ? 0.16 : 0.36))
                    .frame(width: 12, height: 12)
                    .animation(.easeInOut(duration: 1.0).repeatForever(autoreverses: true), value: pulseOn)
                Circle()
                    .fill(ScoutColors.accent)
                    .frame(width: 6, height: 6)
            case .idle:
                Circle()
                    .fill(ScoutColors.textSecondary.opacity(0.7))
                    .frame(width: 6, height: 6)
            case .ended:
                Circle()
                    .stroke(ScoutColors.textMuted, lineWidth: 1)
                    .frame(width: 6, height: 6)
            }
        }
        .frame(width: 12, height: 12)
        .onAppear { if status == .running { pulseOn = true } }
    }
}

// MARK: - Harness chip

private struct LedgerHarnessChip: View {
    let harness: String

    var body: some View {
        Text(harness.uppercased())
            .font(ScoutTypography.code(9, weight: .semibold))
            .tracking(1.2)
            .foregroundStyle(ScoutColors.textSecondary)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(ScoutColors.cardBg)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .stroke(ScoutColors.border, lineWidth: 0.5)
            )
            .fixedSize()
    }
}

// MARK: - Inline detail

private struct LedgerDetailInline: View {
    let summary: SessionSummary
    let onOpen: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            sectionLabel("LIFECYCLE")
            VStack(alignment: .leading, spacing: 4) {
                kv("REF", String(summary.sessionId.prefix(12)))
                kv("HARNESS", AdapterIcon.displayName(for: summary.adapterType))
                if let model = ScoutModelLabel.describe(summary.model) {
                    kv("MODEL", model.menuLabel)
                }
                if let project = summary.project?.trimmedNonEmpty {
                    kv("PROJECT", project)
                }
                kv("STARTED", absoluteTime(summary.startedAt))
                kv("DURATION", duration)
                kv("TURNS", "\(summary.turnCount)")
            }

            Button(action: onOpen) {
                HStack(spacing: 6) {
                    Text("OPEN SESSION")
                        .font(ScoutTypography.code(10, weight: .semibold))
                        .tracking(1.2)
                    Image(systemName: "arrow.right")
                        .font(.system(size: 10, weight: .semibold))
                }
                .foregroundStyle(ScoutColors.accent)
                .padding(.top, 4)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, ScoutSpacing.lg + 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ScoutColors.surfaceAdaptive.opacity(0.6))
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(ScoutTypography.code(10, weight: .semibold))
            .tracking(1.2)
            .foregroundStyle(ScoutColors.textMuted)
    }

    private func kv(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(label)
                .font(ScoutTypography.code(10, weight: .bold))
                .tracking(1.0)
                .foregroundStyle(ScoutColors.textMuted)
                .frame(width: 74, alignment: .leading)
            Text(value.isEmpty ? "—" : value)
                .font(ScoutTypography.code(11))
                .foregroundStyle(ScoutColors.textPrimary)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 0)
        }
    }

    private var duration: String {
        let startMs = summary.startedAt
        let endMs = summary.lastActivityAt
        let seconds = max(0, (endMs - startMs) / 1000)
        if seconds < 60 { return "\(seconds)s" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        let rem = minutes % 60
        if hours < 24 { return rem == 0 ? "\(hours)h" : "\(hours)h \(rem)m" }
        let days = hours / 24
        return "\(days)d"
    }

    private func absoluteTime(_ epochMs: Int) -> String {
        let date = Date(timeIntervalSince1970: Double(epochMs) / 1000.0)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "MMM d, HH:mm"
        return formatter.string(from: date)
    }
}
