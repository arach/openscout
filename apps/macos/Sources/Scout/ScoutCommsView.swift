import HudsonShell
import HudsonUI
import ScoutAppCore
import ScoutHUD
import ScoutNativeCore
import ScoutSharedUI
import SwiftUI
#if os(macOS)
import AppKit
#endif

// MARK: - Scout Comms (conversation list · thread · message rows · composer plumbing)
//
// The native Comms surface — the conversation list column, the thread message
// rows, the member strip, the conversation resize handle, and the composer
// input PreferenceKey. Extracted from ScoutRootView.swift so the Comms UI is
// discoverable by filename. Behaviour is unchanged: ScoutRootView still owns the
// composer body, all data/store wiring, and the session-initiation flow; these
// are the presentation pieces it composes. The matching store lives in
// ScoutCommsStore.swift.
//
// Visibility note: these were file-private inside ScoutRootView.swift. They are
// internal (the default) here so ScoutRootView's body keeps resolving them.

/// Comms presentation metrics — the values that keep the list column, the
/// thread, and the composer on one rhythm. Ported from the Studio scout-shell
/// mock (`design/studio/app/studies/scout-shell/page.module.css`): the `.turn`,
/// `.turnText`, and `.convRow` classes. Studio px map to Hud* tokens where one
/// exists; the reading measure has no token, so it lives here as a literal.
private enum ScoutCommsMetrics {
    /// Constrained reading measure for message bodies. Studio caps prose at
    /// `.turnText { max-width: 64ch }` so a long answer wraps at a comfortable
    /// line length instead of running the full bubble width. 64ch at the ~13pt
    /// body font is ≈ 600pt; we keep the bubble's 840pt hard cap as the outer
    /// limit and constrain the prose inside it.
    static let messageReadingMeasure: CGFloat = 600
    /// Outer bubble cap — unchanged from the original 840pt, named here so the
    /// reading measure reads as deliberately tighter than the bubble.
    static let messageBubbleMaxWidth: CGFloat = 840
    /// Collapsed height for long turns. A fixed clamp (not a measured one — no
    /// GeometryReader here) that shows enough of a wall-of-text turn to decide
    /// whether to expand it, with the bottom fade hinting at more below.
    static let collapsedTurnMaxHeight: CGFloat = 220
    /// Studio `.turnText { margin-top: 4px }` — head → body gap. Tighter than
    /// the row's inter-element `sm` (6) so the timestamp hugs its prose.
    static let turnHeadBodyGap: CGFloat = HudSpacing.xs
    /// Studio `.convRow { padding: 8px 14px }`. Native list rows used `lg` (10)
    /// vertical; Studio's `md` (8) gives the tighter list rhythm the mock has,
    /// applied to both the live and pending rows so they stay aligned.
    static let listRowVerticalPadding: CGFloat = HudSpacing.md
}

struct ScoutComposerInputFrameKey: PreferenceKey {
    static let defaultValue: CGRect = .zero

    static func reduce(value: inout CGRect, nextValue: () -> CGRect) {
        let next = nextValue()
        if next != .zero {
            value = next
        }
    }
}

enum ScoutChannelFilter: String, CaseIterable, Identifiable {
    case all
    case direct
    case shared

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "All"
        case .direct: return "Direct"
        case .shared: return "Channels"
        }
    }

    var icon: String {
        switch self {
        case .all: return "tray.full"
        case .direct: return "person.crop.circle"
        case .shared: return "number"
        }
    }

    func apply(to channels: [ScoutChannel]) -> [ScoutChannel] {
        switch self {
        case .all:
            return channels
        case .direct:
            return channels.filter { $0.scope == .direct }
        case .shared:
            return channels.filter { $0.scope == .shared }
        }
    }
}

struct ScoutPendingConversation: Identifiable, Equatable {
    enum State: Equatable {
        case starting
        case failed(String)
    }

    let id: String
    let conversationId: String?
    let flightId: String?
    let title: String
    let subtitle: String
    let draft: ScoutSessionDraft
    var state: State
}

struct ScoutPendingFlightStatus: Decodable, Sendable {
    let id: String
    let state: String
    let summary: String?

    var isFailure: Bool {
        switch state.lowercased() {
        case "failed", "cancelled":
            return true
        default:
            return false
        }
    }

    var isTerminal: Bool {
        switch state.lowercased() {
        case "completed", "failed", "cancelled":
            return true
        default:
            return false
        }
    }
}

struct ScoutConversationListBar: View {
    let isLoading: Bool
    @Binding var query: String
    @Binding var filter: ScoutChannelFilter
    let channels: [ScoutChannel]
    let pendingConversations: [ScoutPendingConversation]
    let selectedCId: String?
    let newChannelIds: Set<String>
    let hasActivity: Bool
    let width: CGFloat
    let searchFocused: FocusState<Bool>.Binding
    let onNewConversation: () -> Void
    let onRefresh: () -> Void
    let onRetryPending: (ScoutPendingConversation) -> Void
    let onSelectPending: (ScoutPendingConversation) -> Void
    let select: (ScoutChannel) -> Void

    @AppStorage(ScoutDesignPreview.glow) private var glowOn = false

    var body: some View {
        VStack(spacing: 0) {
            header
            controls
            HudDivider(color: ScoutDesign.hairline)
            listContent
        }
        .frame(width: width)
        .frame(maxHeight: .infinity)
        .background {
            ZStack {
                ScoutDesign.chrome
                if glowOn { ScoutAmbientGlow() }
            }
        }
    }

    private var header: some View {
        // `.clear` so the parent's chrome + ambient glow show through the band;
        // a chrome fill here would paint over the glow.
        ScoutColumnHeader(horizontalPadding: ScoutDesign.listGutter, background: .clear) {
            HStack(spacing: HudSpacing.md) {
                Text("Conversations")
                    .font(HudFont.ui(HudTextSize.base, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
                    .lineLimit(1)
                ScoutListLiveDot(active: hasActivity)
            }
        } secondary: {
            EmptyView()
        } trailing: {
            // The list header's controls speak the same button language as the
            // inspector's action chips (`ScoutInspectorActionButton`): rounded-rect
            // at HudRadius.standard, thin (0.5pt) borders, the same 24pt baseline.
            // Refresh = secondary ghost icon chip; New = primary filled accent CTA.
            HStack(spacing: HudSpacing.sm) {
                ScoutListRefreshButton(isLoading: isLoading, action: onRefresh)
                ScoutListNewButton(action: onNewConversation)
            }
        }
    }

    private var controls: some View {
        VStack(spacing: HudSpacing.sm) {
            ScoutConversationFilterControl(selection: $filter)
            ScoutSearchField("Search", text: $query, focus: searchFocused)
        }
        .padding(.horizontal, ScoutDesign.listGutter)
        .padding(.top, HudSpacing.md)
        .padding(.bottom, HudSpacing.xxl)
    }

    private enum RecencyBucket: String, Hashable, CaseIterable {
        case now, today, earlier

        var label: String {
            switch self {
            case .now: return "Now"
            case .today: return "Today"
            case .earlier: return "Earlier"
            }
        }
    }

    /// Channels partitioned by recency of last activity, preserving the parent's
    /// sort within each bucket. "Now" = last 15 min · "Today" = same calendar
    /// day · else "Earlier". Turns a flat scroll into a scannable hierarchy.
    private var groupedChannels: [(bucket: RecencyBucket, channels: [ScoutChannel])] {
        let now = Date()
        let calendar = Calendar.current
        var buckets: [RecencyBucket: [ScoutChannel]] = [:]
        for channel in channels {
            let bucket = recencyBucket(for: channel, now: now, calendar: calendar)
            buckets[bucket, default: []].append(channel)
        }
        return RecencyBucket.allCases.compactMap { bucket in
            guard let rows = buckets[bucket], !rows.isEmpty else { return nil }
            return (bucket, rows)
        }
    }

    private func recencyBucket(for channel: ScoutChannel, now: Date, calendar: Calendar) -> RecencyBucket {
        guard let ts = channel.lastMessageAt else { return .earlier }
        let date = Date(timeIntervalSince1970: ts > 10_000_000_000 ? ts / 1000 : ts)
        if now.timeIntervalSince(date) < 15 * 60 { return .now }
        if calendar.isDate(date, inSameDayAs: now) { return .today }
        return .earlier
    }

    private func recencyHeader(_ bucket: RecencyBucket) -> some View {
        HStack(spacing: 0) {
            Text(bucket.label.uppercased())
                .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                .foregroundStyle(ScoutPalette.dim)
                .tracking(1.0)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, HudSpacing.xxl)
        .padding(.top, HudSpacing.md)
        .padding(.bottom, HudSpacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ScoutDesign.chrome)
    }

    @ViewBuilder
    private var listContent: some View {
        if isLoading && channels.isEmpty && pendingConversations.isEmpty {
            VStack(spacing: HudSpacing.md) {
                ProgressView()
                Text("Loading channels")
                    .font(HudFont.mono(HudTextSize.xxs))
                    .foregroundStyle(ScoutPalette.dim)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if channels.isEmpty && pendingConversations.isEmpty {
            HudEmptyState(
                title: query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "No conversations" : "No matches",
                subtitle: query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "No visible DMs or channels." : "Try another search or filter.",
                icon: "bubble.left"
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(HudSpacing.xxl)
        } else {
            ScrollView {
                LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
                    ForEach(pendingConversations) { pending in
                        ScoutPendingConversationRow(
                            pending: pending,
                            isSelected: pending.conversationId == selectedCId,
                            onRetry: { onRetryPending(pending) },
                            onSelect: { onSelectPending(pending) }
                        )
                    }
                    ForEach(groupedChannels, id: \.bucket) { group in
                        Section {
                            ForEach(group.channels) { channel in
                                ScoutConversationRow(
                                    channel: channel,
                                    isSelected: selectedCId == channel.cId,
                                    isNew: newChannelIds.contains(channel.cId)
                                ) {
                                    select(channel)
                                }
                            }
                        } header: {
                            recencyHeader(group.bucket)
                        }
                    }
                }
                .padding(.bottom, HudSpacing.sm)
                .frame(maxWidth: .infinity)
                .scoutOverlayScrollers()
            }
            .scrollIndicators(.visible)
        }
    }
}

/// A quiet live pulse beside the Conversations title — breathes only while
/// agents are actively working. No label; the motion is the whole message.
struct ScoutListLiveDot: View {
    let active: Bool

    var body: some View {
        ZStack {
            if active {
                ScoutListLivePulse()
            } else {
                Circle()
                    .fill(ScoutPalette.statusOk)
                    .frame(width: 6, height: 6)
                    .opacity(0)
            }
        }
        .frame(width: 10, height: 10)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .help("Live — agents working")
    }
}

struct ScoutListLivePulse: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    var body: some View {
        Circle()
            .fill(ScoutPalette.statusOk)
            .frame(width: 6, height: 6)
            .opacity(reduceMotion ? 0.78 : (pulse ? 0.78 : 0.34))
            .scaleEffect(reduceMotion ? 1.0 : (pulse ? 1.0 : 0.78))
            .shadow(color: ScoutPalette.statusOk.opacity(reduceMotion ? 0.28 : (pulse ? 0.38 : 0.1)), radius: 3)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 1.4).repeatForever(autoreverses: true)) {
                    pulse = true
                }
            }
    }
}

/// Manual refresh for the conversation list. The data refreshes itself every
/// few seconds; this gives a deliberate "I pulled it" gesture — a one-shot
/// spin for tactile reassurance that the list is live.
///
/// A secondary ghost chip in the shared button family: a square rounded-rect at
/// HudRadius.standard with a thin (0.5pt) hairlineStrong border, matching the
/// inspector's `ScoutInspectorActionButton` secondary treatment and sitting on
/// the same 24pt baseline as the primary `ScoutListNewButton` beside it.
struct ScoutListRefreshButton: View {
    let isLoading: Bool
    let action: () -> Void
    @State private var angle: Double = 0
    @State private var hovering = false

    var body: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.7)) { angle += 360 }
            action()
        } label: {
            Image(systemName: "arrow.clockwise")
                .font(HudFont.ui(HudTextSize.micro, weight: .bold))
                .foregroundStyle(hovering ? ScoutPalette.ink : ScoutPalette.muted)
                .rotationEffect(.degrees(angle))
                .frame(width: 24, height: 24)
                .background(
                    RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                        .fill(hovering ? ScoutSurface.hover : Color.clear)
                )
                .overlay(
                    // hairlineStrong at rest (like the inspector's secondary
                    // chips) so it reads as a crisp sibling of the New CTA, not a
                    // bare glyph.
                    RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                        .stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
                )
                .contentShape(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous))
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .onHover { hovering = $0 }
        .help("Refresh conversations")
        .accessibilityLabel("Refresh conversations")
    }
}

/// New-conversation CTA — the primary in the shared button family: a solid
/// accent fill with a bg-color label and a faint accent edge, mirroring
/// `ScoutInspectorActionButton(filled: true)`. Title-case "New" (a clear action,
/// like the studio `.primaryBtn`'s "Message"/"Send"), not an uppercased eyebrow.
struct ScoutListNewButton: View {
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: HudSpacing.xs) {
                Image(systemName: "square.and.pencil")
                    .font(HudFont.ui(HudTextSize.micro, weight: .bold))
                Text("New")
                    .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                    .lineLimit(1)
            }
            .foregroundStyle(ScoutPalette.bg)
            .padding(.horizontal, HudSpacing.md)
            .frame(height: 24)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .fill(ScoutPalette.accent.opacity(hovering ? 1 : 0.92))
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .stroke(ScoutPalette.accent.opacity(0.35), lineWidth: HudStrokeWidth.thin)
            )
            .contentShape(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous))
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .onHover { hovering = $0 }
        .help("New conversation")
        .accessibilityLabel("New conversation")
    }
}

/// Labeled scope segments — a full-width row above search. The icon-only
/// version forced a tooltip to learn each scope; the label names it outright.
/// The active scope reads from the accent fill.
struct ScoutConversationFilterControl: View {
    @Binding var selection: ScoutChannelFilter

    /// A single crisp segmented toggle: one hairline-thin track, the active
    /// segment a solid accent block with a bg-color label. Replaces both the old
    /// muddy 12%-tint active state and the short-lived separate-pill experiment —
    /// the grouped toggle is the better treatment; it just needed a crisp active
    /// fill and a thin (0.5pt) border to match the studio's line weight.
    private let trackRadius: CGFloat = HudRadius.card
    private var segmentRadius: CGFloat { trackRadius - 2 }

    var body: some View {
        HStack(spacing: HudSpacing.xxs) {
            ForEach(ScoutChannelFilter.allCases) { option in
                let isActive = selection == option
                Button {
                    selection = option
                } label: {
                    Text(option.title)
                        .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                        .foregroundStyle(isActive ? ScoutPalette.bg : ScoutPalette.muted)
                        .frame(maxWidth: .infinity)
                        .frame(height: 22)
                        .background(
                            RoundedRectangle(cornerRadius: segmentRadius, style: .continuous)
                                .fill(isActive ? ScoutPalette.accent : Color.clear)
                        )
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain).scoutPointerCursor()
                .help(option.title)
            }
        }
        .padding(2)
        .frame(maxWidth: .infinity)
        .background(
            RoundedRectangle(cornerRadius: trackRadius, style: .continuous)
                .fill(ScoutSurface.inset)
        )
        .overlay(
            RoundedRectangle(cornerRadius: trackRadius, style: .continuous)
                .stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin)
        )
    }
}

struct ScoutPendingConversationRow: View {
    let pending: ScoutPendingConversation
    let isSelected: Bool
    let onRetry: () -> Void
    let onSelect: () -> Void

    @State private var isHovering = false

    var body: some View {
        HStack(alignment: .top, spacing: HudSpacing.md) {
            statusGlyph
                .frame(width: 20, height: 20)
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: HudSpacing.xs) {
                HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
                    Text(pending.title)
                        .font(HudFont.ui(HudTextSize.base, weight: isSelected ? .semibold : .medium))
                        .foregroundStyle(ScoutPalette.ink)
                        .lineLimit(1)

                    Spacer(minLength: HudSpacing.sm)

                    Text(statusLabel)
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(statusTint)
                        .lineLimit(1)
                }

                Text(detailText)
                    .font(HudFont.ui(HudTextSize.xs))
                    .foregroundStyle(ScoutPalette.muted)
                    .lineLimit(2)

                HStack(spacing: HudSpacing.sm) {
                    Text(pendingIdLabel)
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(ScoutPalette.dim)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    if case .failed = pending.state {
                        Button("Retry", action: onRetry)
                            .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                            .buttonStyle(.plain)
                            .foregroundStyle(ScoutPalette.accent)
                            .scoutPointerCursor()
                    }
                }
            }
        }
        .padding(.horizontal, HudSpacing.xxl)
        .padding(.vertical, ScoutCommsMetrics.listRowVerticalPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(rowBackground)
        .overlay(alignment: .leading) {
            if isSelected {
                Rectangle()
                    .fill(ScoutPalette.accent)
                    .frame(width: 2)
            }
        }
        .overlay(alignment: .bottom) {
            HudDivider(color: ScoutDesign.hairline)
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onSelect)
        .onHover { isHovering = $0 }
        .animation(.easeOut(duration: 0.10), value: isHovering)
    }

    @ViewBuilder
    private var statusGlyph: some View {
        switch pending.state {
        case .starting:
            ProgressView()
                .controlSize(.small)
        case .failed:
            Image(systemName: "exclamationmark.triangle.fill")
                .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                .foregroundStyle(ScoutPalette.statusError)
        }
    }

    private var statusLabel: String {
        switch pending.state {
        case .starting: return "Starting"
        case .failed: return "Failed"
        }
    }

    private var statusTint: Color {
        switch pending.state {
        case .starting: return ScoutPalette.dim
        case .failed: return ScoutPalette.statusError
        }
    }

    private var detailText: String {
        switch pending.state {
        case .starting:
            return pending.subtitle
        case .failed(let message):
            return message
        }
    }

    private var rowBackground: Color {
        if isSelected {
            return ScoutSurface.selected(ScoutPalette.accent)
        }
        if isHovering {
            return ScoutSurface.hover
        }
        return Color.clear
    }

    private var pendingIdLabel: String {
        if let cId = pending.conversationId?.nilIfEmpty {
            return shortConversationId(cId)
        }
        if let flightId = pending.flightId?.nilIfEmpty {
            return "flight \(String(flightId.prefix(8)))"
        }
        return "pending"
    }

    private func shortConversationId(_ cId: String) -> String {
        if cId.hasPrefix("c.") {
            return "cId \(String(cId.dropFirst(2).prefix(8)))"
        }
        return cId.count > 16 ? "cId \(String(cId.prefix(12)))" : "cId \(cId)"
    }
}

struct ScoutConversationRow: View {
    let channel: ScoutChannel
    let isSelected: Bool
    var isNew: Bool = false
    let action: () -> Void

    @State private var isHovering = false
    /// Fades 1 → 0 to wash a freshly-arrived row with accent, then settle.
    @State private var revealWash: CGFloat = 0
    @AppStorage(ScoutDesignPreview.accents) private var accentsOn = false

    var body: some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: HudSpacing.lg) {
                // Avatar + body stay top-aligned as a group; the count badge sits
                // in the outer `.center` HStack so it vertically centers against
                // the whole row (Studio's 3-track grid with `align-self: center`).
                HStack(alignment: .top, spacing: HudSpacing.lg) {
                    avatarTile

                    VStack(alignment: .leading, spacing: HudSpacing.xxs) {
                        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
                            // Unread marker — a small accent dot leads the title so the
                            // row reads as "has something for you" before any text.
                            if isUnread {
                                Circle()
                                    .fill(ScoutPalette.accent)
                                    .frame(width: 6, height: 6)
                                    .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 2 }
                            }

                            Text(channel.rowTitle)
                                .font(HudFont.ui(HudTextSize.base, weight: isUnread ? .bold : .medium))
                                .foregroundStyle(ScoutPalette.ink)
                                .lineLimit(1)

                            // Pending-ask chip — only while the ask is unresolved. An
                            // answered ask is noise here, so it never shows a chip.
                            if channel.ask?.state == .pending {
                                pendingChip
                            }

                            Spacer(minLength: HudSpacing.sm)

                            Text(channel.ageLabel)
                                .font(HudFont.mono(HudTextSize.xxs))
                                .foregroundStyle(ScoutPalette.dim)
                                .lineLimit(1)
                        }

                        Text(channel.preview?.nilIfEmpty ?? channel.participantDisplayNames.joined(separator: " + "))
                            .font(HudFont.ui(HudTextSize.sm))
                            .foregroundStyle(isUnread ? ScoutPalette.ink.opacity(0.8) : ScoutPalette.muted)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                if channel.messageCount > 0 {
                    countBadge
                }
            }
            .padding(.horizontal, HudSpacing.xxl)
            .padding(.vertical, ScoutCommsMetrics.listRowVerticalPadding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(rowBackground)
            .background(ScoutPalette.accent.opacity(0.18 * revealWash))
            .overlay(alignment: .leading) {
                if revealWash > 0.01 {
                    Rectangle()
                        .fill(ScoutPalette.accent)
                        .frame(width: 2)
                        .opacity(Double(revealWash))
                }
                if isSelected {
                    ZStack(alignment: .leading) {
                        if accentsOn {
                            // Soft bloom behind the rule so selection feels lit.
                            Rectangle()
                                .fill(ScoutPalette.accent)
                                .frame(width: 3)
                                .blur(radius: 4)
                                .opacity(0.85)
                        }
                        Rectangle()
                            .fill(ScoutPalette.accent)
                            .frame(width: 2)
                    }
                }
            }
            .overlay(alignment: .bottom) {
                HudDivider(color: ScoutDesign.hairline)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .onHover { isHovering = $0 }
        .animation(.easeOut(duration: 0.10), value: isHovering)
        .animation(.easeOut(duration: 0.10), value: isSelected)
        .onAppear { if isNew { playReveal() } }
        .onChange(of: isNew) { _, now in if now { playReveal() } }
    }

    /// One-shot accent wash + left rule that fades as a row first arrives.
    private func playReveal() {
        revealWash = 1
        withAnimation(.easeOut(duration: 1.5)) { revealWash = 0 }
    }

    private var isUnread: Bool { channel.unreadCount > 0 }

    private var isChannel: Bool { channel.scope != .direct }

    /// Studio `.avatar` — a 32×32 rounded tile. DMs fill solid accent with a
    /// bg-color initial; channels read as a `#` glyph on a surface tile with a
    /// hairline-strong edge. Replaces the old 20pt SF Symbol.
    @ViewBuilder
    private var avatarTile: some View {
        if isChannel {
            Text("#")
                .font(HudFont.mono(HudTextSize.base, weight: .bold))
                .foregroundStyle(ScoutPalette.muted)
                .frame(width: 32, height: 32)
                .background(
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .fill(ScoutPalette.surface)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .stroke(ScoutPalette.hairlineStrong, lineWidth: HudStrokeWidth.thin)
                )
        } else {
            // DM — a deterministic sprite from the conversation title.
            SpriteAvatarView(name: channel.rowTitle, size: 32, tile: true)
        }
    }

    /// Studio `.countBadge` — a centered trailing pill (min 20×20). Unread fills
    /// solid accent with bg-color digits; read keeps a quiet surface pill with a
    /// hairline so the column still reads as a badge, not a bare number.
    private var countBadge: some View {
        Text("\(channel.messageCount)")
            .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
            .foregroundStyle(isUnread ? ScoutPalette.bg : ScoutPalette.muted)
            .padding(.horizontal, HudSpacing.sm)
            .frame(minWidth: 20, minHeight: 20)
            .background(
                Capsule().fill(isUnread ? ScoutPalette.accent : ScoutPalette.surface)
            )
            .overlay(
                Capsule().stroke(isUnread ? ScoutPalette.accent : ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin)
            )
    }

    /// Tiny warn-tinted "pending" pill after the title — signals an open ask
    /// awaiting an answer. Mono + uppercase to read as a status token, not prose.
    /// Studio `.askChip.pending`: 8px, radius 3, warn text on a 18% warn wash.
    private var pendingChip: some View {
        Text("pending".uppercased())
            .font(HudFont.mono(8, weight: .bold))
            .tracking(0.3)
            .foregroundStyle(ScoutPalette.statusWarn)
            .padding(.horizontal, 5)
            .padding(.vertical, 1)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                    .fill(ScoutPalette.statusWarn.opacity(0.18))
            )
            .fixedSize()
    }

    private var rowBackground: Color {
        if isSelected {
            return ScoutSurface.selected(ScoutPalette.accent)
        }
        if isHovering {
            return ScoutSurface.hover
        }
        return Color.clear
    }
}

#if os(macOS)
struct ScoutConversationResizeHandle: NSViewRepresentable {
    @Binding var width: CGFloat
    @Binding var previewWidth: CGFloat?
    let range: ClosedRange<CGFloat>

    func makeNSView(context: Context) -> ResizeHandleView {
        let view = ResizeHandleView()
        view.range = range
        view.getWidth = { width }
        view.setPreviewWidth = { previewWidth = $0 }
        view.commitWidth = { width = $0 }
        view.clearPreview = { previewWidth = nil }
        return view
    }

    func updateNSView(_ view: ResizeHandleView, context: Context) {
        view.range = range
        view.getWidth = { width }
        view.setPreviewWidth = { previewWidth = $0 }
        view.commitWidth = { width = $0 }
        view.clearPreview = { previewWidth = nil }
    }

    final class ResizeHandleView: NSView {
        var range: ClosedRange<CGFloat> = 230...430
        var getWidth: () -> CGFloat = { 286 }
        var setPreviewWidth: (CGFloat) -> Void = { _ in }
        var commitWidth: (CGFloat) -> Void = { _ in }
        var clearPreview: () -> Void = {}

        private var startX: CGFloat = 0
        private var startWidth: CGFloat = 0
        private var isActive = false

        override init(frame frameRect: NSRect) {
            super.init(frame: frameRect)
            wantsLayer = true
            layer?.backgroundColor = NSColor.clear.cgColor
        }

        required init?(coder: NSCoder) {
            super.init(coder: coder)
            wantsLayer = true
            layer?.backgroundColor = NSColor.clear.cgColor
        }

        override var acceptsFirstResponder: Bool { true }
        override var mouseDownCanMoveWindow: Bool { false }
        override var intrinsicContentSize: NSSize {
            NSSize(width: ScoutDesign.conversationResizeHandleWidth, height: NSView.noIntrinsicMetric)
        }

        override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
            true
        }

        override func resetCursorRects() {
            addCursorRect(bounds, cursor: .resizeLeftRight)
        }

        override func mouseDown(with event: NSEvent) {
            window?.makeFirstResponder(self)
            startX = event.locationInWindow.x
            startWidth = getWidth()
            isActive = true
            setPreviewWidth(startWidth)
            needsDisplay = true
        }

        override func mouseDragged(with event: NSEvent) {
            let delta = event.locationInWindow.x - startX
            setPreviewWidth(clamp(startWidth + delta))
        }

        override func mouseUp(with event: NSEvent) {
            let delta = event.locationInWindow.x - startX
            commitWidth(clamp(startWidth + delta))
            clearPreview()
            isActive = false
            needsDisplay = true
        }

        override func draw(_ dirtyRect: NSRect) {
            super.draw(dirtyRect)
            let color = isActive
                ? NSColor.white.withAlphaComponent(0.04)
                : NSColor.white.withAlphaComponent(0.06)
            color.setFill()
            let rect = NSRect(x: floor((bounds.width - 1) / 2), y: 0, width: 1, height: bounds.height)
            rect.fill()
        }

        private func clamp(_ value: CGFloat) -> CGFloat {
            min(max(value, range.lowerBound), range.upperBound)
        }
    }
}
#else
struct ScoutConversationResizeHandle: View {
    @Binding var width: CGFloat
    @Binding var previewWidth: CGFloat?
    let range: ClosedRange<CGFloat>

    var body: some View {
        HudResizableDivider(width: $width, placement: .trailing, range: range, hitWidth: 10)
    }
}
#endif

struct ScoutMemberIdentity: Identifiable {
    let id: String
    let name: String
    let agent: ScoutAgent?
}

struct ScoutMemberStrip: View {
    let members: [ScoutMemberIdentity]
    let selectAgent: (ScoutAgent) -> Void

    var body: some View {
        HStack(spacing: HudSpacing.sm) {
            HStack(spacing: -4) {
                ForEach(Array(members.prefix(4).enumerated()), id: \.element.id) { index, member in
                    memberAvatar(member)
                        .zIndex(Double(8 - index))
                }
            }
            Text(members.map(\.name).joined(separator: " + "))
                .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                .foregroundStyle(ScoutPalette.muted)
                .lineLimit(1)
        }
    }

    @ViewBuilder
    private func memberAvatar(_ member: ScoutMemberIdentity) -> some View {
        if let agent = member.agent {
            Button {
                selectAgent(agent)
            } label: {
                avatarGlyph(for: member)
            }
            .buttonStyle(.plain).scoutPointerCursor()
            .help("Preview \(agent.displayName)")
        } else {
            avatarGlyph(for: member)
        }
    }

    private func avatarGlyph(for member: ScoutMemberIdentity) -> some View {
        SpriteAvatarView(name: member.name, size: 18, tile: true)
            .overlay(
                Group {
                    if member.agent == nil {
                        RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                            .stroke(ScoutPalette.accent.opacity(0.5), lineWidth: HudStrokeWidth.thin)
                    }
                }
            )
            .contentShape(Rectangle())
    }
}

struct ScoutMessageRow: View {
    let message: ScoutMessage
    let agent: ScoutAgent?
    /// Workspace root for resolving relative file paths this message quotes.
    let baseDirectory: String?
    let previewAgent: (ScoutAgent) -> Void
    let onNewFromMessage: () -> Void

    @State private var isHoveringAgent = false
    /// Collapsed by default for long turns; toggled by the Show more button.
    @State private var expanded = false

    var body: some View {
        HStack(alignment: .top, spacing: HudSpacing.xl) {
            turnAvatar

            VStack(alignment: .leading, spacing: ScoutCommsMetrics.turnHeadBodyGap) {
                HStack(alignment: .firstTextBaseline, spacing: HudSpacing.md) {
                    actorChip
                    Text(ScoutRelativeTime.format(message.createdAt))
                        .font(HudFont.mono(HudTextSize.xxs))
                        .foregroundStyle(ScoutPalette.dim)
                }
                messageBody
            }
            // The turn body caps at the reading measure (Studio `.turnBody`); the
            // trailing Spacer keeps every turn flush-left instead of stretched.
            .frame(maxWidth: ScoutCommsMetrics.messageReadingMeasure, alignment: .leading)
            .contextMenu {
                Button {
                    onNewFromMessage()
                } label: {
                    Label("New conversation from this message…", systemImage: "bubble.left.and.text.bubble.right")
                }
                Divider()
                Button {
                    copyToPasteboard(message.body)
                } label: {
                    Label("Copy message", systemImage: "doc.on.doc")
                }
                Button {
                    copyToPasteboard(message.id)
                } label: {
                    Label("Copy message ID", systemImage: "number")
                }
            }

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Studio `.turnAvatar` — a 28×28 sprite tile leading each turn. Operator gets
    /// the same deterministic sprite as any agent; a thin accent ring marks "you".
    @ViewBuilder
    private var turnAvatar: some View {
        SpriteAvatarView(name: message.actorName, size: 28, tile: true)
            .overlay(
                Group {
                    if message.isOperator {
                        RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                            .stroke(ScoutPalette.accent.opacity(0.5), lineWidth: HudStrokeWidth.thin)
                    }
                }
            )
    }

    /// The constrained reading measure (Studio `.turnText`) — long prose wraps at
    /// a comfortable line length, not the full bubble width. Long turns collapse
    /// behind a fade with a Show more toggle so the thread stays scannable.
    @ViewBuilder
    private var messageBody: some View {
        if isLongTurn {
            VStack(alignment: .leading, spacing: ScoutCommsMetrics.turnHeadBodyGap) {
                ScoutMarkdownView(text: message.body, baseDirectory: baseDirectory)
                    .frame(maxWidth: ScoutCommsMetrics.messageReadingMeasure, alignment: .leading)
                    .frame(maxHeight: expanded ? nil : ScoutCommsMetrics.collapsedTurnMaxHeight, alignment: .top)
                    .clipped()
                    .overlay(alignment: .bottom) {
                        // Subtle bottom fade from the bubble fill, so the clipped
                        // edge reads as "more below" rather than a hard cut. Only
                        // while collapsed.
                        if !expanded {
                            LinearGradient(
                                colors: [ScoutPalette.bg.opacity(0), ScoutPalette.bg],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                            .frame(height: 44)
                            .allowsHitTesting(false)
                        }
                    }

                Button {
                    expanded.toggle()
                } label: {
                    Text(expanded ? "Show less" : "Show more")
                        .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                        .foregroundStyle(ScoutPalette.accent)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain).scoutPointerCursor()
            }
        } else {
            ScoutMarkdownView(text: message.body, baseDirectory: baseDirectory)
                .frame(maxWidth: ScoutCommsMetrics.messageReadingMeasure, alignment: .leading)
        }
    }

    /// Cheap structural heuristic — no GeometryReader / height measurement (an
    /// idle-CPU hazard here). A turn is "long" once it crosses a character count
    /// or a line count, which is enough to decide whether to clamp + fade.
    private var isLongTurn: Bool {
        if message.body.count > 600 { return true }
        let newlines = message.body.reduce(into: 0) { count, char in
            if char == "\n" { count += 1 }
        }
        return newlines > 10
    }

    private func copyToPasteboard(_ value: String) {
        #if os(macOS)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(value, forType: .string)
        #endif
    }

    @ViewBuilder
    private var actorChip: some View {
        if let agent {
            Button {
                previewAgent(agent)
            } label: {
                actorLabel
            }
            .buttonStyle(.plain).scoutPointerCursor()
            .onHover { isHoveringAgent = $0 }
            .overlay(alignment: .topLeading) {
                if isHoveringAgent {
                    ScoutAgentHoverCard(agent: agent)
                        .offset(x: 0, y: -86)
                        .transition(.opacity.combined(with: .move(edge: .top)))
                        .zIndex(20)
                }
            }
            .help("Preview \(agent.displayName)")
        } else {
            actorLabel
        }
    }

    private var actorLabel: some View {
        HStack(spacing: HudSpacing.xs) {
            Text(message.actorName)
                .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
            if agent != nil {
                Image(systemName: "info.circle")
                    .font(HudFont.ui(HudTextSize.micro, weight: .semibold))
                    .foregroundStyle(ScoutPalette.dim)
            }
        }
        .contentShape(Rectangle())
        .animation(.easeOut(duration: 0.10), value: isHoveringAgent)
    }
}

struct ScoutAgentHoverCard: View {
    let agent: ScoutAgent

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            HStack(spacing: HudSpacing.sm) {
                Text(agent.displayName)
                    .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
                    .lineLimit(1)
                Spacer(minLength: HudSpacing.sm)
                HudBadge(agent.state.label, tint: agent.state.tint, dot: true)
            }

            if !agent.detail.isEmpty {
                Text(agent.detail)
                    .font(HudFont.ui(HudTextSize.xxs))
                    .foregroundStyle(ScoutPalette.muted)
                    .lineLimit(1)
            }

            HStack(spacing: HudSpacing.md) {
                Label(agent.branchLabel, systemImage: "arrow.triangle.branch")
                Label(agent.updatedLabel, systemImage: "clock")
            }
            .font(HudFont.mono(HudTextSize.micro))
            .foregroundStyle(ScoutPalette.dim)
            .lineLimit(1)
        }
        .padding(HudSpacing.lg)
        .frame(width: 260, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(ScoutDesign.chrome))
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
        )
        .shadow(color: ScoutSurface.shadow(0.32), radius: 18, x: 0, y: 10)
        .allowsHitTesting(false)
    }
}
