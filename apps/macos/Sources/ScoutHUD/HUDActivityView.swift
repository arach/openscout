import AppKit
import ScoutAppCore
import SwiftUI

// Activity tab — native port of design/studio/components/hud/HudActivity.tsx.
//
// Compact: time-bucketed ledger, single col, inline reveal on engage.
// Medium:  same ledger but wider time gutter (stacked relative + absolute).
// Large:   full-width ledger; details reveal inline on interaction.

private enum ActivityCategory: String, Sendable {
    case presence
    case work
    case delivery
    case coordination
    case system

    var label: String {
        switch self {
        case .presence: return "PRESENCE"
        case .work: return "EXECUTION"
        case .delivery: return "DELIVERY"
        case .coordination: return "COORDINATION"
        case .system: return "SYSTEM"
        }
    }
}

private enum ActivityKindLabel: String, Sendable {
    case turn
    case wire
    case ask
    case start
    case fail
    case system

    var label: String {
        switch self {
        case .turn: return "TURN"
        case .wire: return "WIRE"
        case .ask: return "REQUEST"
        case .start: return "START"
        case .fail: return "FAIL"
        case .system: return "SYSTEM"
        }
    }
}

private struct ActivityRowModel: Identifiable {
    let id: String
    let ago: String
    let at: String   // HH:MM:SS absolute clock
    let ageSeconds: Int
    let agent: String
    let handle: String?
    let category: ActivityCategory
    let kind: ActivityKindLabel
    let title: String
    let summary: String
    let flightId: String?
    let invocationId: String?
    let sessionId: String?
    let conversationId: String?
    let messageId: String?
    let agentId: String?
    let detail: String?
    let emphasized: Bool
}

private enum ActivityBucket: Int, CaseIterable {
    case justNow
    case lastHour
    case today
    case earlier

    var eyebrow: String {
        switch self {
        case .justNow: return "BUCKET  ·  LIVE"
        case .lastHour: return "BUCKET  ·  60 MIN"
        case .today: return "BUCKET  ·  TODAY"
        case .earlier: return "BUCKET  ·  ARCHIVE"
        }
    }

    var headline: String {
        switch self {
        case .justNow: return "Just now"
        case .lastHour: return "Last hour"
        case .today: return "Today"
        case .earlier: return "Filed earlier"
        }
    }

    static func bucket(for ageSeconds: Int) -> ActivityBucket {
        if ageSeconds < 300 { return .justNow }
        if ageSeconds < 3_600 { return .lastHour }
        if ageSeconds < 86_400 { return .today }
        return .earlier
    }
}

struct HUDActivityView: View {
    let agents: [HudAgent]
    let activity: [HudActivityItem]?
    let isLoading: Bool

    @ObservedObject private var state = HUDState.shared
    @StateObject private var engage = HUDEngageState()

    private var agentById: [String: HudAgent] {
        Dictionary(uniqueKeysWithValues: agents.map { ($0.id, $0) })
    }

    var body: some View {
        Group {
            if isLoading || activity == nil {
                ActivityLoadingView()
            } else if rows.isEmpty {
                ActivityEmptyView()
            } else {
                switch state.size {
                case .compact: rowsBody(size: .compact)
                case .medium:  rowsBody(size: .medium)
                case .large:   rowsBody(size: .large)
                }
            }
        }
        .onAppear { wireNavBus() }
        .onDisappear { HUDNavBus.shared.clear() }
    }

    private func wireNavBus() {
        HUDNavBus.shared.cycleNext = {
            let ids = rowIds()
            guard !ids.isEmpty else { return }
            if let cur = engage.cursoredId, let i = ids.firstIndex(of: cur), i + 1 < ids.count {
                engage.cursor(ids[i + 1])
            } else {
                engage.cursor(ids.first)
            }
        }
        HUDNavBus.shared.cyclePrev = {
            let ids = rowIds()
            guard !ids.isEmpty else { return }
            if let cur = engage.cursoredId, let i = ids.firstIndex(of: cur), i > 0 {
                engage.cursor(ids[i - 1])
            } else {
                engage.cursor(ids.last)
            }
        }
        HUDNavBus.shared.jumpTop = {
            engage.cursor(rowIds().first)
        }
        HUDNavBus.shared.jumpBottom = {
            engage.cursor(rowIds().last)
        }
        HUDNavBus.shared.engageSelected = {
            guard let cursoredId = engage.cursoredId,
                  let row = rows.first(where: { $0.id == cursoredId }) else { return }
            if engage.engagedId != cursoredId {
                engage.toggle(cursoredId)
            } else {
                HUDDockState.shared.setTarget(handle: row.handle ?? row.agent, label: row.agent)
                HUDDockState.shared.focus()
            }
        }
        HUDNavBus.shared.unengageSelected = {
            if engage.engagedId != nil {
                engage.unengage()
                return true
            }
            return false
        }
    }

    private func rowIds() -> [String] {
        rows.map { $0.id }
    }

    // MARK: - Rows

    private func rowsBody(size: HUDSize) -> some View {
        let lastId = grouped.last?.rows.last?.id
        return ScrollViewReader { proxy in
            GeometryReader { viewport in
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(spacing: 0) {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            ForEach(grouped, id: \.bucket) { group in
                                ActivitySectionHeader(bucket: group.bucket)
                                ForEach(group.rows) { row in
                                    ActivityRowView(
                                        row: row,
                                        size: size,
                                        cursored: engage.isCursored(row.id),
                                        engaged: engage.isEngaged(row.id),
                                        isLastInFeed: row.id == lastId,
                                        onTap: {
                                            withAnimation(.easeOut(duration: 0.12)) {
                                                engage.toggle(row.id)
                                            }
                                        }
                                    )
                                    .id(row.id)
                                    if engage.isEngaged(row.id) {
                                        ActivityDetailInline(row: row, size: size)
                                            .transition(.move(edge: .top).combined(with: .opacity))
                                    }
                                }
                            }
                        }

                        Spacer(minLength: 0)
                        ActivityFeedEndMarker()
                    }
                    .frame(minHeight: viewport.size.height, alignment: .top)
                }
                .onChange(of: engage.cursoredId) { _, id in
                    guard let id else { return }
                    withAnimation(.easeOut(duration: 0.16)) {
                        if size == .compact {
                            proxy.scrollTo(id)
                        } else {
                            proxy.scrollTo(id, anchor: .center)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var rows: [ActivityRowModel] {
        let now = Date()
        let clock = DateFormatter()
        clock.dateFormat = "HH:mm:ss"
        return (activity ?? []).prefix(60).map { item in
            let agent = item.agentId.flatMap { agentById[$0] }
            let name = agent?.name ?? item.displayName
            let handle = agent?.handle
            let then = ScoutRelativeTime.date(item.ts) ?? Date(timeIntervalSince1970: 0)
            let ageSec = max(0, Int(now.timeIntervalSince(then)))
            let kind = Self.kind(for: item.kind)
            let category = Self.category(for: kind)
            return ActivityRowModel(
                id: item.id,
                ago: HudAgent.formatAgo(sinceMs: item.ts),
                at: clock.string(from: then),
                ageSeconds: ageSec,
                agent: name,
                handle: handle,
                category: category,
                kind: kind,
                title: item.title?.isEmpty == false ? item.title! : item.kind,
                summary: item.summary ?? "",
                flightId: item.flightId,
                invocationId: item.invocationId,
                sessionId: item.sessionId,
                conversationId: item.conversationId,
                messageId: item.messageId,
                agentId: item.agentId,
                detail: nil,
                emphasized: kind == .ask || kind == .fail
            )
        }
    }

    private var grouped: [(bucket: ActivityBucket, rows: [ActivityRowModel])] {
        var byBucket: [ActivityBucket: [ActivityRowModel]] = [:]
        for row in rows {
            let b = ActivityBucket.bucket(for: row.ageSeconds)
            byBucket[b, default: []].append(row)
        }
        return ActivityBucket.allCases.compactMap { bucket in
            guard let rows = byBucket[bucket], !rows.isEmpty else { return nil }
            return (bucket, rows)
        }
    }

    private static func kind(for raw: String) -> ActivityKindLabel {
        let value = raw.lowercased()
        if value.contains("fail") || value.contains("error") || value.contains("dead") {
            return .fail
        }
        if value.contains("wait") || value.contains("attention") || value.contains("unblock") || value.contains("ask") {
            return .ask
        }
        if value.contains("message") || value.contains("reply") || value.contains("sent") || value.contains("wire") {
            return .wire
        }
        if value.contains("start") || value.contains("created") || value.contains("spawn") || value.contains("wake") {
            return .start
        }
        if value.contains("flight") || value.contains("turn") || value.contains("updated") {
            return .turn
        }
        return .system
    }

    private static func category(for kind: ActivityKindLabel) -> ActivityCategory {
        switch kind {
        case .turn: return .work
        case .wire: return .delivery
        case .ask: return .coordination
        case .start: return .presence
        case .fail: return .system
        case .system: return .system
        }
    }
}

// MARK: - Section header (pinned)

private struct ActivitySectionHeader: View {
    let bucket: ActivityBucket

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HUDEyebrow(text: bucket.eyebrow, color: HUDChrome.inkFaint)
            Text(bucket.headline)
                .font(HUDType.body(15, weight: .semibold))
                .foregroundStyle(HUDChrome.ink)
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(HUDChrome.canvas)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(HUDChrome.borderStrong)
                .frame(height: 0.5)
                .padding(.horizontal, 16)
        }
    }
}

// MARK: - Row

private struct ActivityRowView: View {
    let row: ActivityRowModel
    let size: HUDSize
    var cursored: Bool = false
    let engaged: Bool
    var isLastInFeed: Bool = false
    var onTap: () -> Void = {}

    @State private var hovered = false

    private var rowFill: Color {
        if engaged { return HUDChrome.canvasLift.opacity(0.72) }
        if cursored { return HUDChrome.canvasLift.opacity(0.48) }
        if hovered { return HUDChrome.canvasLift.opacity(0.30) }
        return Color.clear
    }

    private var categoryColor: Color {
        switch row.category {
        case .work, .coordination: return HUDChrome.accent
        default: return HUDChrome.inkMuted
        }
    }

    private var tickColor: Color {
        row.emphasized ? HUDChrome.accent : HUDChrome.inkFaint
    }

    // Geometry mirrors the studio React canonical `ACTIVITY_GRID`:
    //   compact:        outer 16 | gutter 36 | gap 10 | spine 1 | gap 14 | dispatch
    //   medium / large: outer 16 | gutter 54 | gap 12 | spine 1 | gap 18 | dispatch
    // Keep these three constants in sync — the spine + tick layer (drawn
    // in its own ZStack pass) reads `spineX` directly while the content
    // HStack consumes `gutterW` + `gutterToContent`. Drift between the
    // two cascades visually as the tick crashing into the timestamp.
    private var outerPadLeading: CGFloat { 16 }
    private var gutterW: CGFloat { size == .compact ? 36 : 54 }
    private var gutterToSpine: CGFloat { size == .compact ? 10 : 12 }
    private var spineToContent: CGFloat { size == .compact ? 14 : 18 }
    private var gutterToContent: CGFloat { gutterToSpine + 1 + spineToContent }
    private var spineX: CGFloat { outerPadLeading + gutterW + gutterToSpine }

    var body: some View {
        ZStack(alignment: .leading) {
            rowFill

            // Spine
            HStack(spacing: 0) {
                Spacer().frame(width: spineX)
                Rectangle()
                    .fill(HUDChrome.border)
                    .frame(width: 1)
            }

            // Tick
            HStack(spacing: 0) {
                Spacer().frame(width: row.emphasized ? spineX - 2 : spineX - 1)
                Rectangle()
                    .fill(tickColor)
                    .frame(
                        width: row.emphasized ? 5 : 3,
                        height: row.emphasized ? 5 : 3
                    )
                    .padding(.top, row.emphasized ? 10 : 11)
                Spacer()
            }
            .frame(maxHeight: .infinity, alignment: .top)

            if engaged || cursored {
                LinearGradient(
                    colors: [
                        HUDChrome.accent.opacity(engaged ? 0.20 : 0.13),
                        HUDChrome.accent.opacity(engaged ? 0.08 : 0.05),
                        Color.clear,
                    ],
                    startPoint: .leading,
                    endPoint: .trailing
                )
                Rectangle()
                    .fill(HUDChrome.accent)
                    .frame(width: engaged ? 1.5 : 1)
            }

            // Content
            HStack(alignment: .top, spacing: gutterToContent) {
                timeGutter
                    .frame(width: gutterW, alignment: .trailing)
                    .padding(.top, 2)

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 5) {
                        Text(row.category.label)
                            .font(HUDType.mono(10, weight: .bold))
                            .tracking(HUDType.eyebrowTracking)
                            .foregroundStyle(categoryColor)
                        Text("·")
                            .font(HUDType.mono(10))
                            .foregroundStyle(HUDChrome.inkFaint)
                        Text(row.kind.label)
                            .font(HUDType.mono(10, weight: .semibold))
                            .tracking(HUDType.eyebrowTracking)
                            .foregroundStyle(row.emphasized ? HUDChrome.accent : HUDChrome.inkFaint)
                    }

                    Text(row.title)
                        .font(HUDType.body(size == .compact ? 12 : 13, weight: .semibold))
                        .foregroundStyle(HUDChrome.ink)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)

                    if !row.summary.isEmpty, row.summary != row.title {
                        Text(row.summary)
                            .font(HUDType.body(size == .compact ? 11 : 12))
                            .foregroundStyle(HUDChrome.inkMuted)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                            .lineSpacing(1.5)
                    }

                    HStack(spacing: 6) {
                        InitialAvatar(name: row.agent)
                        Text(row.agent)
                            .font(HUDType.body(11))
                            .foregroundStyle(HUDChrome.inkMuted)
                        if let handle = row.handle {
                            Text(handle.hasPrefix("@") ? handle : "@" + handle)
                                .font(HUDType.mono(10))
                                .foregroundStyle(HUDChrome.inkFaint)
                        }
                        if let flight = row.flightId {
                            Text("·")
                                .font(HUDType.mono(10))
                                .foregroundStyle(HUDChrome.inkFaint)
                            Text("flight \(flight)")
                                .font(HUDType.mono(10))
                                .monospacedDigit()
                                .foregroundStyle(HUDChrome.inkFaint)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.top, 2)
                }
                Spacer(minLength: 0)
            }
            .padding(.leading, outerPadLeading)
            .padding(.trailing, size == .compact ? 14 : (size == .medium ? 16 : 20))
            .padding(.vertical, size == .compact ? 9 : 10)
        }
        .contentShape(Rectangle())
        .onHover { hovered = $0 }
        .onTapGesture(perform: onTap)
        .overlay(alignment: .bottom) {
            // Last row in the feed: the end-of-feed marker draws its own
            // hairline, so skipping here keeps the canvas from reading as
            // a torn page when the feed is short.
            if !isLastInFeed {
                Rectangle()
                    .fill(HUDChrome.borderSoft)
                    .frame(height: 0.5)
                    .padding(.horizontal, 16)
            }
        }
    }

    @ViewBuilder
    private var timeGutter: some View {
        if size == .compact {
            Text(row.ago)
                .font(HUDType.mono(10, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(HUDChrome.inkFaint)
        } else {
            VStack(alignment: .trailing, spacing: 1) {
                Text(row.ago)
                    .font(HUDType.mono(11, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(HUDChrome.inkMuted)
                Text(row.at)
                    .font(HUDType.mono(10))
                    .monospacedDigit()
                    .foregroundStyle(HUDChrome.inkFaint)
            }
        }
    }
}

// MARK: - End of feed marker
//
// Hairline-flanked eyebrow that closes the compact feed. Without it, a
// short feed reads like the panel was clipped at midpoint — the last
// row's bottom hairline becomes a torn page rather than a deliberate end.
// The marker terminates the document: any canvas below is now clearly
// "past the end," not missing content.

private struct ActivityFeedEndMarker: View {
    var body: some View {
        HStack(spacing: 10) {
            Rectangle()
                .fill(HUDChrome.borderSoft)
                .frame(height: 0.5)
            Text("END OF FEED")
                .font(HUDType.mono(9, weight: .semibold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(HUDChrome.inkFaint)
                .fixedSize()
            Rectangle()
                .fill(HUDChrome.borderSoft)
                .frame(height: 0.5)
        }
        .padding(.horizontal, 16)
        .padding(.top, 14)
        .padding(.bottom, 16)
    }
}

private struct InitialAvatar: View {
    let name: String

    var body: some View {
        Text(String(name.prefix(1)).uppercased())
            .font(HUDType.mono(10, weight: .semibold))
            .foregroundStyle(HUDChrome.inkMuted)
            .frame(width: 13, height: 13)
            .background(Circle().fill(HUDChrome.canvas))
            .overlay(Circle().stroke(HUDChrome.border, lineWidth: 0.5))
    }
}

// MARK: - Engaged detail (compact + medium inline)

private struct ActivityDetailInline: View {
    let row: ActivityRowModel
    var size: HUDSize = .compact

    private var padLeading: CGFloat {
        size == .compact ? 52 : 88
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HUDEyebrow(text: "EVENT DETAIL", color: HUDChrome.inkFaint)

            Text(row.title)
                .font(HUDType.body(size == .compact ? 12 : 13, weight: .semibold))
                .foregroundStyle(HUDChrome.ink)
                .fixedSize(horizontal: false, vertical: true)
                .multilineTextAlignment(.leading)

            if !row.summary.isEmpty, row.summary != row.title {
                Text(row.summary)
                    .font(HUDType.body(11))
                    .foregroundStyle(HUDChrome.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)
                    .lineSpacing(2)
            }

            VStack(alignment: .leading, spacing: 3) {
                metaRow(label: "CATEGORY", value: row.category.label)
                metaRow(label: "KIND", value: row.kind.label)
                metaRow(label: "AT", value: row.ago + " ago")
                if let flight = row.flightId {
                    metaRow(label: "FLIGHT", value: flight)
                }
            }
        }
        .padding(.leading, padLeading)
        .padding(.trailing, size == .large ? 20 : 14)
        .padding(.vertical, size == .compact ? 10 : 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(HUDChrome.canvasAlt.opacity(0.55))
    }

    private func metaRow(label: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label)
                .font(HUDType.mono(10, weight: .bold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(HUDChrome.inkDeep)
                .frame(width: 56, alignment: .leading)
            Text(value)
                .font(HUDType.mono(10))
                .foregroundStyle(HUDChrome.ink)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Drill link

/// Underlined "→ LABEL" row that opens a web surface URL in the default
/// browser. Used by inline HUD details to jump to a deeper web surface.
struct HUDDrillLink: View {
    let label: String
    let url: URL
    var compact: Bool = false

    @State private var hovered = false

    private var arrowSize: CGFloat { compact ? 9 : 11 }
    private var labelSize: CGFloat { compact ? 8.5 : 10 }
    private var horizontalPadding: CGFloat { compact ? 4 : 6 }
    private var verticalPadding: CGFloat { compact ? 2 : 4 }

    var body: some View {
        Button {
            NSWorkspace.shared.open(url)
        } label: {
            HStack(spacing: compact ? 5 : 8) {
                Text("→")
                    .font(HUDType.mono(arrowSize))
                    .foregroundStyle(hovered ? HUDChrome.accent : HUDChrome.inkFaint)
                Text(label)
                    .font(HUDType.mono(labelSize, weight: .semibold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(hovered ? HUDChrome.ink : HUDChrome.inkMuted)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, horizontalPadding)
            .padding(.vertical, verticalPadding)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovered = $0 }
        .help(url.absoluteString)
    }
}

// MARK: - Loading / empty

private struct ActivityLoadingView: View {
    var body: some View {
        VStack(spacing: 0) {
            ForEach(0..<4, id: \.self) { _ in
                LoadingRow()
            }
            Spacer(minLength: 0)
        }
        .padding(.top, 12)
    }
}

private struct LoadingRow: View {
    var body: some View {
        HStack(alignment: .top, spacing: 11) {
            skeleton(width: 28, height: 8)
                .frame(width: 32, alignment: .trailing)
            VStack(alignment: .leading, spacing: 4) {
                skeleton(width: 80, height: 9)
                skeleton(width: 220, height: 11)
                skeleton(width: 180, height: 10)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    private func skeleton(width: CGFloat, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 2, style: .continuous)
            .fill(HUDChrome.canvasLift)
            .frame(width: width, height: height)
    }
}

private struct ActivityEmptyView: View {
    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)

            HUDEyebrow(text: "LEDGER  ·  EMPTY", color: HUDChrome.inkFaint)
                .padding(.top, 18)

            Text("Ledger is empty.")
                .font(HUDType.body(15, weight: .semibold))
                .foregroundStyle(HUDChrome.ink)
                .padding(.top, 6)

            Text("Structured events will land here as agents file.")
                .font(HUDType.body(12))
                .foregroundStyle(HUDChrome.inkMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.top, 6)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
