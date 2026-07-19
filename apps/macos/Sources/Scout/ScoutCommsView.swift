import HudsonShell
import HudsonUI
import ScoutAppCore
import ScoutCapabilities
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
enum ScoutCommsMetrics {
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
    /// Message-bubble corner radius. The Proposal's softer 11pt bubble — rounder
    /// than the 8pt `card` chrome so the turn reads as a speech surface, not a
    /// panel.
    static let bubbleRadius: CGFloat = 11
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
    let sessionId: String?
    let flightId: String?
    let messageId: String?
    var agentId: String?
    var agentName: String?
    let createdAt: Date
    let title: String
    let subtitle: String
    let draft: ScoutSessionDraft
    var state: State
    var flightState: String?
    var flightSummary: String?

    var selectionReferences: [String] {
        [conversationId, sessionId, flightId, id].compactMap { $0?.nilIfEmpty }
    }

    func matchesSelection(_ selectedCId: String?) -> Bool {
        guard let selectedCId = selectedCId?.nilIfEmpty else { return false }
        return selectionReferences.contains(selectedCId)
    }
}

struct ScoutPendingFlightStatus: Decodable, Sendable {
    let id: String
    let invocationId: String?
    let agentId: String?
    let agentName: String?
    let conversationId: String?
    let state: String
    let summary: String?
    let startedAt: TimeInterval?
    let completedAt: TimeInterval?
    let removePendingRow: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case invocationId
        case agentId
        case agentName
        case conversationId
        case state
        case summary
        case startedAt
        case completedAt
    }

    init(
        id: String,
        invocationId: String? = nil,
        agentId: String? = nil,
        agentName: String? = nil,
        conversationId: String? = nil,
        state: String,
        summary: String?,
        startedAt: TimeInterval? = nil,
        completedAt: TimeInterval? = nil,
        removePendingRow: Bool = false
    ) {
        self.id = id
        self.invocationId = invocationId
        self.agentId = agentId
        self.agentName = agentName
        self.conversationId = conversationId
        self.state = state
        self.summary = summary
        self.startedAt = ScoutTimestamp.epochMilliseconds(startedAt)
        self.completedAt = ScoutTimestamp.epochMilliseconds(completedAt)
        self.removePendingRow = removePendingRow
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            id: try c.decode(String.self, forKey: .id),
            invocationId: try c.decodeIfPresent(String.self, forKey: .invocationId),
            agentId: try c.decodeIfPresent(String.self, forKey: .agentId),
            agentName: try c.decodeIfPresent(String.self, forKey: .agentName),
            conversationId: try c.decodeIfPresent(String.self, forKey: .conversationId),
            state: try c.decode(String.self, forKey: .state),
            summary: try c.decodeIfPresent(String.self, forKey: .summary),
            startedAt: try c.decodeIfPresent(TimeInterval.self, forKey: .startedAt),
            completedAt: try c.decodeIfPresent(TimeInterval.self, forKey: .completedAt)
        )
    }

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
        case "completed", "failed", "cancelled", "expired":
            return true
        default:
            return false
        }
    }
}

/// The selected conversation's current in-flight turn, surfaced inline in the
/// thread so a new or slow session shows progress without opening Observe.
/// `summary` is the flight's coarse status ("claude acknowledged"); `detail` is
/// the agent's latest observe event ("Running grep") when one is live. Organic
/// harness work without a Scout flight uses the observe activity directly.
struct ScoutActiveTurn: Equatable, Sendable {
    let agentName: String
    let state: String          // queued | waking | running | waiting
    let summary: String?
    let detail: String?
    let activity: [ScoutTurnActivityItem]
}

struct ScoutTurnActivityItem: Identifiable, Equatable, Sendable {
    let id: String
    let kind: String
    let title: String
    let detail: String?
    let timestamp: TimeInterval
}

/// In-thread preview of a turn that's still running — the agent's sprite, a live
/// braille spinner, a plain-language headline keyed off the flight state, and a
/// rolling detail line from the latest observe event. Mirrors ScoutMessageRow's
/// layout so it reads as the agent mid-thought rather than a separate banner;
/// it's swapped for the real turn the moment the completed message lands.
struct ScoutInFlightTurnRow: View {
    let turn: ScoutActiveTurn

    var body: some View {
        HStack(alignment: .top, spacing: HudSpacing.xl) {
            SpriteAvatarView(name: turn.agentName, size: 28, tile: true)

            VStack(alignment: .leading, spacing: ScoutCommsMetrics.turnHeadBodyGap) {
                HStack(alignment: .center, spacing: HudSpacing.md) {
                    Text(turn.agentName)
                        .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                        .foregroundStyle(ScoutPalette.ink)
                    ScoutBrailleSpinner(size: 11, tint: spinnerTint)
                    Text(headline)
                        .font(HudFont.mono(HudTextSize.xxs))
                        .foregroundStyle(headlineTint)
                }
                if let line = detailLine {
                    Text(line)
                        .font(HudFont.ui(HudTextSize.sm))
                        .foregroundStyle(ScoutPalette.muted)
                        .lineLimit(2)
                        .truncationMode(.tail)
                        .animation(.easeOut(duration: 0.15), value: line)
                }
                if !turn.activity.isEmpty {
                    ScoutTurnActivityTimeline(items: turn.activity)
                        .padding(.top, HudSpacing.xs)
                }
            }
            .frame(maxWidth: ScoutCommsMetrics.messageReadingMeasure, alignment: .leading)

            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var detailLine: String? {
        if let detail = turn.detail?.nilIfEmpty {
            return detail
        }
        guard let summary = turn.summary?.nilIfEmpty else { return nil }
        if summary.contains("Scout stopped waiting for a synchronous result")
            || summary.contains("the requester stopped waiting after") {
            return "Still working."
        }
        return summary
    }

    /// Plain language over flight jargon. `waking` → "Starting up…" is the beat
    /// that answers "did it even pick up" for a cold new session. A live
    /// `waiting` flight is still represented here as active work; explicit
    /// attention states are surfaced elsewhere.
    private var headline: String {
        switch turn.state.lowercased() {
        case "queued": return "Queued…"
        case "waking": return "Starting up…"
        case "running": return "Working…"
        case "waiting": return "Currently working"
        default: return "Working…"
        }
    }

    private var spinnerTint: Color { ScoutPalette.accent }

    private var headlineTint: Color { ScoutPalette.dim }
}

private struct ScoutTurnActivityTimeline: View {
    let items: [ScoutTurnActivityItem]

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            ForEach(items) { item in
                HStack(alignment: .top, spacing: HudSpacing.sm) {
                    Image(systemName: icon(for: item.kind))
                        .font(HudFont.ui(HudTextSize.micro, weight: .semibold))
                        .foregroundStyle(ScoutPalette.muted)
                        .frame(width: 12, height: 14)
                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: HudSpacing.xs) {
                            Text(item.title)
                                .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
                                .foregroundStyle(ScoutPalette.ink)
                                .lineLimit(1)
                            if let age = activityAge(item.timestamp) {
                                Text(age)
                                    .font(HudFont.mono(HudTextSize.micro))
                                    .foregroundStyle(ScoutPalette.dim)
                                    .lineLimit(1)
                            }
                        }
                        if let detail = item.detail?.nilIfEmpty {
                            Text(detail)
                                .font(HudFont.ui(HudTextSize.xs))
                                .foregroundStyle(ScoutPalette.muted)
                                .lineLimit(2)
                                .truncationMode(.tail)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, HudSpacing.lg)
        .padding(.vertical, HudSpacing.sm)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .fill(ScoutSurface.inset)
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin)
        )
    }

    private func icon(for kind: String) -> String {
        switch kind {
        case "tool": return "wrench.and.screwdriver"
        case "think": return "brain.head.profile"
        case "ask": return "questionmark.circle"
        case "message": return "text.bubble"
        default: return "waveform.path.ecg"
        }
    }

    private func activityAge(_ timestamp: TimeInterval) -> String? {
        guard timestamp >= 1_000_000_000 else { return nil }
        return ScoutRelativeTime.format(timestamp)
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
    let serviceHealth: ScoutServiceHealth
    let isStartingBroker: Bool
    let width: CGFloat
    let searchFocused: FocusState<Bool>.Binding
    let onNewConversation: () -> Void
    let onRefresh: () -> Void
    let onStartBroker: () -> Void
    let onOpenMenuBar: () -> Void
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
                Text("Chats")
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

    // One compact toolbar row instead of two stacked full-width controls: the
    // scope filter (icon-only segmented, instant one-tap switching) hugs the
    // leading edge, the search field grows to fill the rest. Reads as a refined
    // macOS toolbar and holds up at the 224pt min column width.
    private var controls: some View {
        HStack(spacing: HudSpacing.sm) {
            ScoutConversationFilterControl(selection: $filter)
            ScoutSearchField("Search", text: $query, focus: searchFocused)
                .frame(maxWidth: .infinity)
        }
        .padding(.horizontal, ScoutDesign.listGutter)
        .padding(.top, HudSpacing.md)
        .padding(.bottom, HudSpacing.lg)
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
        guard let date = ScoutRelativeTime.date(ts) else { return .earlier }
        if now.timeIntervalSince(date) < 15 * 60 { return .now }
        if calendar.isDate(date, inSameDayAs: now) { return .today }
        return .earlier
    }

    private func recencyHeader(_ bucket: RecencyBucket) -> some View {
        HStack(spacing: 0) {
            Text(bucket.label.uppercased())
                .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                .foregroundStyle(ScoutPalette.muted)
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
            switch serviceHealth {
            case .brokerDown:
                brokerOfflineState
            case .webDown:
                webOfflineState
            case .ok:
                HudEmptyState(
                    title: query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "No chats" : "No matches",
                    subtitle: query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "No visible DMs or channels." : "Try another search or filter.",
                    icon: "bubble.left"
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(HudSpacing.xxl)
            }
        } else {
            ScrollView {
                LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
                    ForEach(pendingConversations) { pending in
                        ScoutPendingConversationRow(
                            pending: pending,
                            isSelected: pending.matchesSelection(selectedCId),
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

    // The broker is down but the web service is up — the app can honestly
    // restart it. Show a spinner while the restart is in flight, then let the
    // re-probe clear this state on its own.
    private var brokerOfflineState: some View {
        VStack(spacing: HudSpacing.xl) {
            HudEmptyState(
                title: "Broker offline",
                subtitle: "Scout can't reach the broker, so conversations aren't loading.",
                icon: "bolt.horizontal.circle"
            )
            .frame(maxWidth: 420)
            if isStartingBroker {
                HStack(spacing: HudSpacing.sm) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Starting broker…")
                        .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
                        .foregroundStyle(ScoutPalette.muted)
                }
            } else {
                HudButton("Start broker", icon: "bolt.fill", style: .secondary, action: onStartBroker)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(HudSpacing.xxl)
    }

    // The local web service itself isn't answering. The app can't start it —
    // that's the menu-bar helper's job — so offer Retry plus a pointer to it.
    private var webOfflineState: some View {
        VStack(spacing: HudSpacing.xl) {
            HudEmptyState(
                title: "Scout services are offline",
                subtitle: "The local Scout web service isn't responding. Start it from the menu bar, then retry.",
                icon: "bolt.slash"
            )
            .frame(maxWidth: 420)
            HStack(spacing: HudSpacing.sm) {
                HudButton("Retry", icon: "arrow.clockwise", style: .secondary, action: onRefresh)
                HudButton("Open menu bar controls", icon: "menubar.arrow.up.rectangle", style: .secondary, action: onOpenMenuBar)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(HudSpacing.xxl)
    }
}

/// A quiet live pulse beside the Chats title — breathes only while
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
        .help("New chat")
        .accessibilityLabel("New chat")
    }
}

/// Labeled scope segments — a full-width row above search. The icon-only
/// version forced a tooltip to learn each scope; the label names it outright.
/// The active scope reads from a neutral selected wash — the accent is not
/// spent on scope state.
struct ScoutConversationFilterControl: View {
    @Binding var selection: ScoutChannelFilter

    /// A compact icon-only segmented toggle: one hairline-thin track, the active
    /// segment a quiet selected wash with an ink glyph (tray / person / #).
    /// Hugs its content so it can ride beside the search field on a single row;
    /// labels move into hover tooltips. Height matches the search field so the
    /// two read as one toolbar.
    private let trackRadius: CGFloat = HudRadius.standard
    private var segmentRadius: CGFloat { trackRadius - 2 }
    private let segmentWidth: CGFloat = 28

    var body: some View {
        HStack(spacing: HudSpacing.xxs) {
            ForEach(ScoutChannelFilter.allCases) { option in
                let isActive = selection == option
                let vivid = ScoutAccentVolume.current == .vivid
                Button {
                    selection = option
                } label: {
                    Image(systemName: option.icon)
                        .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                        .foregroundStyle(isActive ? (vivid ? ScoutPalette.bg : ScoutPalette.ink) : ScoutPalette.muted)
                        .frame(width: segmentWidth)
                        .frame(maxHeight: .infinity)
                        .background(
                            RoundedRectangle(cornerRadius: segmentRadius, style: .continuous)
                                .fill(isActive ? (vivid ? ScoutPalette.accent : ScoutSurface.selected(ScoutPalette.accent)) : Color.clear)
                        )
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain).scoutPointerCursor()
                .help(option.title)
            }
        }
        .padding(2)
        .frame(height: HudLayout.fieldHeight)
        .fixedSize(horizontal: true, vertical: false)
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
        HStack(alignment: .center, spacing: HudSpacing.lg) {
            avatarTile

            VStack(alignment: .leading, spacing: HudSpacing.xxs) {
                HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
                    Text(rowTitle)
                        .font(HudFont.ui(HudTextSize.base, weight: isSelected ? .semibold : .medium))
                        .foregroundStyle(ScoutPalette.ink)
                        .lineLimit(1)

                    Spacer(minLength: HudSpacing.sm)

                    Text(statusLabel)
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(statusTint)
                        .lineLimit(1)
                }

                HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
                    Text(detailText)
                        .font(HudFont.ui(HudTextSize.sm))
                        .foregroundStyle(detailTint)
                        .lineLimit(1)
                        .truncationMode(.tail)

                    Spacer(minLength: HudSpacing.sm)

                    Text(pendingIdLabel)
                        .font(HudFont.mono(9, weight: .semibold))
                        .foregroundStyle(ScoutPalette.dim)
                        .lineLimit(1)
                        .fixedSize(horizontal: true, vertical: false)

                    if case .failed = pending.state {
                        Button("Retry", action: onRetry)
                            .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                            .buttonStyle(.plain)
                            .foregroundStyle(ScoutPalette.accent)
                            .scoutPointerCursor()
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
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
    private var avatarTile: some View {
        ZStack(alignment: .bottomTrailing) {
            SpriteAvatarView(name: avatarName, size: 32, tile: true)
                .overlay(
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .stroke(isSelected ? ScoutPalette.accent : Color.clear, lineWidth: HudStrokeWidth.thin)
                )

            statusGlyph
                .frame(width: 14, height: 14)
                .background(Circle().fill(ScoutDesign.chrome))
                .offset(x: 3, y: 3)
        }
        .frame(width: 32, height: 32)
    }

    @ViewBuilder
    private var statusGlyph: some View {
        switch pending.state {
        case .starting:
            ScoutBrailleSpinner(size: 10, tint: ScoutPalette.accent)
        case .failed:
            Image(systemName: "exclamationmark.triangle.fill")
                .font(HudFont.ui(HudTextSize.micro, weight: .semibold))
                .foregroundStyle(ScoutPalette.statusError)
        }
    }

    private var statusLabel: String {
        switch pending.state {
        case .starting:
            return pending.flightState.flatMap(Self.progressLabel) ?? "Starting"
        case .failed: return "Failed"
        }
    }

    private var statusTint: Color {
        switch pending.state {
        case .starting: return ScoutPalette.dim
        case .failed: return ScoutPalette.statusError
        }
    }

    private var detailTint: Color {
        switch pending.state {
        case .starting: return ScoutPalette.muted
        case .failed: return ScoutPalette.statusError
        }
    }

    private var detailText: String {
        switch pending.state {
        case .starting:
            return pending.flightSummary?.nilIfEmpty ?? targetContext ?? pending.subtitle
        case .failed(let message):
            return message
        }
    }

    private static func progressLabel(_ state: String) -> String {
        switch state.lowercased() {
        case "queued": return "Queued"
        case "waking": return "Starting"
        case "running": return "Working"
        case "waiting": return "Waiting"
        default:
            let first = state.prefix(1).uppercased()
            let rest = state.dropFirst()
            return "\(first)\(rest)"
        }
    }

    private var rowTitle: String {
        bestAgentLabel ?? pending.title
    }

    private var avatarName: String {
        bestAgentLabel ?? pending.title
    }

    private var bestAgentLabel: String? {
        pending.agentName?.nilIfEmpty
            ?? pending.draft.displayName.nilIfEmpty
            ?? pending.draft.agentName.nilIfEmpty
            ?? pending.draft.agent?.displayName.nilIfEmpty
    }

    private var targetContext: String? {
        let parts = [
            projectLabel,
            executionLabel,
        ].compactMap { $0?.nilIfEmpty }
        guard !parts.isEmpty else { return nil }
        return parts.joined(separator: " · ")
    }

    private var projectLabel: String? {
        guard let path = pending.draft.projectPath.nilIfEmpty else { return nil }
        let name = URL(fileURLWithPath: path).lastPathComponent
        return name.nilIfEmpty ?? (path as NSString).lastPathComponent.nilIfEmpty
    }

    private var executionLabel: String? {
        let parts = [
            pending.draft.harness?.nilIfEmpty ?? pending.draft.agent?.harness?.nilIfEmpty,
            pending.draft.model?.nilIfEmpty ?? pending.draft.agent?.model?.nilIfEmpty,
        ].compactMap { $0 }
        guard !parts.isEmpty else { return nil }
        return parts.joined(separator: " · ")
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
        if let sessionId = pending.sessionId?.nilIfEmpty {
            return shortSessionId(sessionId)
        }
        if let flightId = pending.flightId?.nilIfEmpty {
            return "flight \(String(flightId.prefix(8)))"
        }
        return "pending"
    }

    private func shortConversationId(_ cId: String) -> String {
        if cId.hasPrefix("c.") {
            return "chat \(String(cId.dropFirst(2).prefix(8)))"
        }
        return cId.count > 16 ? "chat \(String(cId.prefix(12)))" : "chat \(cId)"
    }

    private func shortSessionId(_ sessionId: String) -> String {
        sessionId.count > 18 ? "session \(String(sessionId.prefix(14)))" : "session \(sessionId)"
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

                            if let sessionIdShort = channel.sessionIdShort {
                                Text(sessionIdShort)
                                    .font(HudFont.mono(9, weight: .semibold))
                                    .foregroundStyle(ScoutPalette.dim)
                                    .lineLimit(1)
                                    .fixedSize(horizontal: true, vertical: false)
                                    .help("Session id: \(channel.sessionId ?? "")")
                            } else {
                                Text(channel.chatIdShort)
                                    .font(HudFont.mono(9, weight: .semibold))
                                    .foregroundStyle(ScoutPalette.dim)
                                    .lineLimit(1)
                                    .fixedSize(horizontal: true, vertical: false)
                                    .help("Chat ID: \(channel.chatId)")
                            }

                            Spacer(minLength: HudSpacing.sm)

                            Text(channel.ageLabel)
                                .font(HudFont.mono(HudTextSize.xxs))
                                .foregroundStyle(ScoutPalette.dim)
                                .lineLimit(1)

                            // Unread count as a quiet accent number (Proposal) —
                            // the only loud accent in the row, no filled capsule.
                            if isUnread {
                                Text("\(channel.unreadCount)")
                                    .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
                                    .foregroundStyle(ScoutPalette.accent)
                                    .lineLimit(1)
                            }
                        }

                        Text(channel.preview?.nilIfEmpty ?? channel.participantDisplayNames.joined(separator: " + "))
                            .font(HudFont.ui(HudTextSize.sm))
                            .foregroundStyle(isUnread ? ScoutPalette.ink.opacity(0.8) : ScoutPalette.muted)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.horizontal, HudSpacing.xxl)
            .padding(.vertical, ScoutCommsMetrics.listRowVerticalPadding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(rowBackground)
            .background(ScoutPalette.accent.opacity(0.18 * revealWash))
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
                .foregroundStyle(isSelected ? ScoutPalette.accent : ScoutPalette.muted)
                .frame(width: 32, height: 32)
                .background(
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .fill(ScoutPalette.surface)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .stroke(isSelected ? ScoutPalette.accent : ScoutPalette.hairlineStrong, lineWidth: HudStrokeWidth.thin)
                )
        } else {
            // DM — a deterministic sprite from the conversation title. Selection
            // is carried by a thin accent ring on the node, not a left bar — the
            // accent stays a whisper.
            SpriteAvatarView(name: channel.rowTitle, size: 32, tile: true)
                .overlay(
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .stroke(ScoutPalette.accent, lineWidth: HudStrokeWidth.thin)
                        .opacity(isSelected ? 1 : 0)
                )
        }
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
            // Neutral selection pill — the accent ring on the avatar carries the
            // "selected" signal, so the wash itself stays grayscale.
            return ScoutSurface.press
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
    var readReceipts: [ScoutReadReceipt] = []
    /// Workspace root for resolving relative file paths this message quotes.
    let baseDirectory: String?
    /// The latest saved message is always shown in full so the operator can read
    /// a fresh reply without an extra click.
    let isLatestMessage: Bool
    var showCustodyCaption: Bool = true
    var showThreadActions: Bool = true
    let previewAgent: (ScoutAgent) -> Void
    let onReply: () -> Void
    let onStartThread: () -> Void
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
                if showCustodyCaption, let custodyLabel {
                    Text(custodyLabel)
                        .font(HudFont.mono(HudTextSize.xxs))
                        .foregroundStyle(ScoutPalette.dim)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                messageBody
            }
            // The turn body caps at the reading measure (Studio `.turnBody`); the
            // trailing Spacer keeps every turn flush-left instead of stretched.
            .frame(maxWidth: ScoutCommsMetrics.messageReadingMeasure, alignment: .leading)
            .contextMenu {
                Button {
                    onReply()
                } label: {
                    Label("Reply", systemImage: "arrowshape.turn.up.left")
                }
                if showThreadActions {
                    Button {
                        onStartThread()
                    } label: {
                        Label("Start thread", systemImage: "text.bubble")
                    }
                }
                Button {
                    onNewFromMessage()
                } label: {
                    Label("New chat from this message…", systemImage: "bubble.left.and.text.bubble.right")
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

    /// The turn body, wrapped in a bubble. Long prose wraps at the reading
    /// measure (the enclosing turn frame caps width); long turns collapse behind
    /// a fade with a Show more toggle so the thread stays scannable. The fade
    /// dissolves into the bubble fill, not the canvas, so the clip reads clean.
    @ViewBuilder
    private var messageBody: some View {
        if isLongTurn && !isLatestMessage {
            VStack(alignment: .leading, spacing: ScoutCommsMetrics.turnHeadBodyGap) {
                bubble {
                    messageContent
                        .frame(maxHeight: expanded ? nil : ScoutCommsMetrics.collapsedTurnMaxHeight, alignment: .top)
                        .clipped()
                        .overlay(alignment: .bottom) {
                            if !expanded {
                                // Canvas underlay + fill on top: the fill alone can be a
                                // translucent wash (operator turns), which wouldn't occlude
                                // the clipped text — the bg layer keeps the fade opaque.
                                ZStack {
                                    LinearGradient(
                                        colors: [ScoutPalette.bg.opacity(0), ScoutPalette.bg],
                                        startPoint: .top,
                                        endPoint: .bottom
                                    )
                                    LinearGradient(
                                        colors: [bubbleFill.opacity(0), bubbleFill],
                                        startPoint: .top,
                                        endPoint: .bottom
                                    )
                                }
                                .frame(height: 44)
                                .allowsHitTesting(false)
                            }
                        }
                }

                Button {
                    expanded.toggle()
                } label: {
                    Text(expanded ? "Show less" : "Show more")
                        .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                        .foregroundStyle(ScoutPalette.muted)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain).scoutPointerCursor()
                readReceiptLine
            }
        } else {
            VStack(alignment: .leading, spacing: HudSpacing.xs) {
                bubble { messageContent }
                readReceiptLine
            }
        }
    }

    /// The themed turn content — markdown plus link-backed attachments. `hug:
    /// true` lets short turns produce short bubbles instead of full slabs.
    private var messageContent: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            if !message.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                markdown
            }
            if !message.attachments.isEmpty {
                ScoutMessageAttachmentStack(attachments: message.attachments, isMine: isMine)
            }
        }
    }

    /// The themed markdown for this turn — standard ink in both registers; the
    /// wash and edge carry "yours", not the prose color.
    private var markdown: some View {
        ScoutMarkdownView(
            text: message.body,
            baseDirectory: baseDirectory,
            inkColor: bubbleInk,
            mutedColor: bubbleMuted,
            accentColor: bubbleAccent,
            hug: true
        )
    }

    @ViewBuilder
    private var readReceiptLine: some View {
        if !readReceipts.isEmpty {
            ScoutReadReceiptLine(receipts: readReceipts)
                .padding(.leading, HudSpacing.xs)
        }
    }

    private var isMine: Bool { message.isOperator }
    private var vivid: Bool { ScoutAccentVolume.current == .vivid }
    private var bubbleFill: Color {
        guard isMine else { return ScoutPalette.surface }
        return vivid ? ScoutPalette.accent : ScoutPalette.accentSoft
    }
    private var bubbleInk: Color { isMine && vivid ? Color.white : ScoutPalette.ink }
    private var bubbleMuted: Color { isMine && vivid ? Color.white.opacity(0.82) : ScoutPalette.muted }
    private var bubbleAccent: Color { isMine && vivid ? Color.white : ScoutPalette.accent }

    /// Differential elevation: an incoming turn FLOATS (surface fill · hairline ·
    /// soft drop shadow); the operator's own turn is FLAT and anchored. At the
    /// default Quiet accent volume that's an accent-soft wash with a faint
    /// accent edge — a long brief must not flood the pane; the wash + avatar
    /// ring whisper "yours". Vivid restores the classic solid accent fill.
    @ViewBuilder
    private func bubble<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        content()
            .padding(.horizontal, HudSpacing.lg)
            .padding(.vertical, HudSpacing.md)
            .background(
                RoundedRectangle(cornerRadius: ScoutCommsMetrics.bubbleRadius, style: .continuous)
                    .fill(bubbleFill)
            )
            .overlay(
                RoundedRectangle(cornerRadius: ScoutCommsMetrics.bubbleRadius, style: .continuous)
                    .stroke(
                        isMine
                            ? (vivid ? Color.clear : ScoutPalette.accent.opacity(0.28))
                            : ScoutDesign.hairline,
                        lineWidth: HudStrokeWidth.thin
                    )
            )
            .shadow(
                color: isMine ? Color.clear : ScoutSurface.shadow(0.16),
                radius: isMine ? 0 : 5,
                x: 0,
                y: isMine ? 0 : 2
            )
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

    private var custodyLabel: String? {
        if let metadata = message.metadata, metadata.isRepoWatchHandoff {
            let target = metadata.targetAgentId ?? metadata.relayTarget
            return ["Forwarded from Repo Watch", target.map { "to \(shortId($0))" }]
                .compactMap { $0 }
                .joined(separator: " ")
        }

        if let metadata = message.metadata, metadata.isScoutbotGenerated {
            if let target = metadata.relayTarget, target != "scoutbot" {
                return "Scout handoff to \(shortId(target))"
            }
            let parent = metadata.sourceMessageId ?? metadata.parentScoutbotTurnId ?? message.replyToMessageId
            if let parent {
                return "Scout reply to \(shortId(parent))"
            }
        }

        if let replyTo = message.replyToMessageId {
            return "Reply to \(shortId(replyTo))"
        }

        return nil
    }

    private func shortId(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count > 14 else { return trimmed }
        return "\(trimmed.prefix(10))..."
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

struct ScoutReadReceipt: Identifiable, Equatable {
    let actorId: String
    let label: String
    let readAt: TimeInterval

    var id: String { actorId }
}

private struct ScoutReadReceiptLine: View {
    let receipts: [ScoutReadReceipt]

    var body: some View {
        HStack(spacing: HudSpacing.xs) {
            Image(systemName: "checkmark.circle")
                .font(HudFont.ui(HudTextSize.micro, weight: .semibold))
            Text(label)
                .font(HudFont.mono(HudTextSize.micro))
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .foregroundStyle(ScoutPalette.dim)
    }

    private var label: String {
        let names = receipts.map(\.label)
        let latest = receipts.map(\.readAt).max()
        let age = latest.flatMap { ScoutRelativeTime.format($0) }
        let prefix: String
        switch names.count {
        case 0:
            prefix = "Read"
        case 1:
            prefix = "Read by \(names[0])"
        case 2:
            prefix = "Read by \(names[0]) and \(names[1])"
        default:
            prefix = "Read by \(names[0]) and \(names.count - 1) others"
        }
        if let age, age != "now" {
            return "\(prefix) \(age)"
        }
        return prefix
    }
}

private struct ScoutMessageAttachmentStack: View {
    let attachments: [MessageAttachment]
    let isMine: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            ForEach(attachments) { attachment in
                if isImage(attachment) {
                    ScoutImageAttachmentView(attachment: attachment, isMine: isMine)
                } else {
                    ScoutFileAttachmentChip(attachment: attachment, isMine: isMine)
                }
            }
        }
    }

    private func isImage(_ attachment: MessageAttachment) -> Bool {
        attachment.mediaType.lowercased().hasPrefix("image/")
    }
}

private struct ScoutImageAttachmentView: View {
    let attachment: MessageAttachment
    let isMine: Bool

    @State private var hovering = false

    var body: some View {
        Group {
            if let url = resolvedURL {
                Button {
                    open(url)
                } label: {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .scaledToFit()
                                .frame(maxWidth: 360, maxHeight: 260, alignment: .leading)
                                .clipShape(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous))
                        case .failure:
                            attachmentFallback(icon: "photo", title: title, detail: "Could not load image")
                        case .empty:
                            attachmentFallback(icon: "photo", title: title, detail: "Loading image")
                                .overlay(alignment: .trailing) {
                                    ProgressView()
                                        .controlSize(.small)
                                        .padding(.trailing, HudSpacing.md)
                                }
                        @unknown default:
                            attachmentFallback(icon: "photo", title: title, detail: attachment.mediaType)
                        }
                    }
                    .overlay(
                        RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                            .stroke(borderColor, lineWidth: HudStrokeWidth.thin)
                    )
                    .shadow(color: isMine ? Color.clear : ScoutSurface.shadow(0.16), radius: isMine ? 0 : 4, x: 0, y: 2)
                }
                .buttonStyle(.plain).scoutPointerCursor()
                .onHover { hovering = $0 }
                .help("Open \(title)")
            } else {
                attachmentFallback(icon: "photo", title: title, detail: attachment.mediaType)
            }
        }
    }

    private var title: String {
        attachment.fileName?.nilIfEmpty ?? "Image"
    }

    private var borderColor: Color {
        isMine ? Color.white.opacity(hovering ? 0.42 : 0.24) : ScoutDesign.hairlineStrong
    }

    private var resolvedURL: URL? {
        resolveAttachmentURL(attachment.url)
    }

    private func attachmentFallback(icon: String, title: String, detail: String) -> some View {
        ScoutFileAttachmentChipContent(
            icon: icon,
            title: title,
            detail: detail,
            isMine: isMine
        )
    }
}

private struct ScoutFileAttachmentChip: View {
    let attachment: MessageAttachment
    let isMine: Bool

    var body: some View {
        Group {
            if let url = resolveAttachmentURL(attachment.url) {
                Button {
                    open(url)
                } label: {
                    content
                }
                .buttonStyle(.plain).scoutPointerCursor()
                .help("Open \(title)")
            } else {
                content
            }
        }
    }

    private var content: some View {
        ScoutFileAttachmentChipContent(
            icon: icon,
            title: title,
            detail: attachment.mediaType,
            isMine: isMine
        )
    }

    private var title: String {
        attachment.fileName?.nilIfEmpty ?? attachment.blobKey?.nilIfEmpty ?? "Attachment"
    }

    private var icon: String {
        let mediaType = attachment.mediaType.lowercased()
        if mediaType.hasPrefix("video/") { return "film" }
        if mediaType.contains("markdown") { return "doc.text" }
        if mediaType.hasPrefix("text/") { return "curlybraces" }
        return "paperclip"
    }
}

private struct ScoutFileAttachmentChipContent: View {
    let icon: String
    let title: String
    let detail: String
    let isMine: Bool

    var body: some View {
        HStack(spacing: HudSpacing.sm) {
            Image(systemName: icon)
                .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(detail)
                    .font(HudFont.mono(HudTextSize.micro))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .opacity(0.78)
            }
        }
        .foregroundStyle(isMine ? Color.white : ScoutPalette.ink)
        .padding(.horizontal, HudSpacing.md)
        .padding(.vertical, HudSpacing.sm)
        .frame(maxWidth: 360, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .fill(isMine ? Color.white.opacity(0.12) : ScoutSurface.inset)
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .stroke(isMine ? Color.white.opacity(0.24) : ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin)
        )
    }
}

private func resolveAttachmentURL(_ raw: String?) -> URL? {
    ScoutWeb.attachmentURL(raw)
}

private func open(_ url: URL) {
    #if os(macOS)
    NSWorkspace.shared.open(url)
    #endif
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
