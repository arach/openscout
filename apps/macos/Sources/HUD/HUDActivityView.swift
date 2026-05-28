import AppKit
import SwiftUI

// Activity tab — native port of design/studio/components/hud/HudActivity.tsx.
//
// Compact: time-bucketed ledger, single col, inline reveal on engage.
// Medium:  same ledger but wider time gutter (stacked relative + absolute).
// Large:   two panes — ledger left (~480), full event detail right.

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
        case .ask: return "ASK"
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
                case .compact:           compactBody
                case .medium, .large:    largeBody
                }
            }
        }
    }

    // MARK: - Compact

    private var compactBody: some View {
        let lastId = grouped.last?.rows.last?.id
        return ScrollView(.vertical, showsIndicators: false) {
            LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                ForEach(grouped, id: \.bucket) { group in
                    Section {
                        ForEach(group.rows) { row in
                            ActivityRowView(
                                row: row,
                                size: .compact,
                                engaged: engage.isSelected(row.id),
                                isLastInFeed: row.id == lastId,
                                onTap: {
                                    withAnimation(.easeOut(duration: 0.12)) {
                                        engage.toggle(row.id)
                                    }
                                }
                            )
                            if engage.isSelected(row.id) {
                                ActivityDetailInline(row: row)
                                    .transition(.move(edge: .top).combined(with: .opacity))
                            }
                        }
                    } header: {
                        ActivitySectionHeader(bucket: group.bucket)
                    }
                }

                ActivityFeedEndMarker()
            }
        }
    }

    // MARK: - Large (also serves Medium — the same two-pane layout, just
    // in a smaller panel frame; see HUDState.contentSize)

    private var selectedRow: ActivityRowModel {
        if let id = engage.selectedId, let match = rows.first(where: { $0.id == id }) {
            return match
        }
        return rows[0]
    }

    private var largeBody: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                // Left ledger
                ScrollView(.vertical, showsIndicators: false) {
                    LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                        ForEach(grouped, id: \.bucket) { group in
                            Section {
                                ForEach(group.rows) { row in
                                    ActivityRowView(
                                        row: row,
                                        size: .large,
                                        engaged: row.id == selectedRow.id,
                                        onTap: {
                                            withAnimation(.easeOut(duration: 0.12)) {
                                                engage.select(row.id)
                                            }
                                        }
                                    )
                                }
                            } header: {
                                ActivitySectionHeader(bucket: group.bucket)
                            }
                        }
                    }
                    .padding(.bottom, 12)
                }
                .frame(width: 480)

                Rectangle().fill(HUDChrome.border).frame(width: 0.5)

                ActivityDetailLarge(row: selectedRow)
                    .frame(maxWidth: .infinity)
            }
            .frame(maxHeight: .infinity)
        }
    }

    private var rows: [ActivityRowModel] {
        let now = Date()
        let clock = DateFormatter()
        clock.dateFormat = "HH:mm:ss"
        return (activity ?? []).prefix(60).map { item in
            let agent = item.agentId.flatMap { agentById[$0] }
            let name = agent?.name ?? item.displayName
            let handle = agent?.handle
            let then = Date(timeIntervalSince1970: item.ts / 1000)
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
    let engaged: Bool
    var isLastInFeed: Bool = false
    var onTap: () -> Void = {}

    @State private var hovered = false

    private var rowFill: Color {
        if engaged { return HUDChrome.canvasLift.opacity(0.55) }
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

    // WHY: medium/large widen the gutter to fit a stacked relative + absolute timestamp.
    private var gutterW: CGFloat {
        size == .compact ? 32 : 48
    }

    private var spineX: CGFloat {
        size == .compact ? 40 : 56
    }

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

            if engaged {
                Rectangle().fill(HUDChrome.accent).frame(width: 1.5)
            }

            // Content
            HStack(alignment: .top, spacing: 11) {
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
            .padding(.leading, 12)
            .padding(.trailing, size == .compact ? 14 : 16)
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

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HUDEyebrow(text: "EVENT DETAIL", color: HUDChrome.inkFaint)

            Text(row.title)
                .font(HUDType.body(12, weight: .semibold))
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
        .padding(.leading, 52)
        .padding(.trailing, 14)
        .padding(.vertical, 10)
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

// MARK: - Large right-pane detail

private struct ActivityDetailLarge: View {
    let row: ActivityRowModel

    private var categoryColor: Color {
        switch row.category {
        case .work, .coordination: return HUDChrome.accent
        default: return HUDChrome.inkMuted
        }
    }

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 6) {
                    Text("· " + row.category.label)
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
                    Spacer()
                    Text("\(row.at)  ·  \(row.ago) ago")
                        .font(HUDType.mono(10))
                        .monospacedDigit()
                        .foregroundStyle(HUDChrome.inkFaint)
                }

                Text(row.title)
                    .font(HUDType.body(15, weight: .semibold))
                    .foregroundStyle(HUDChrome.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)

                if !row.summary.isEmpty, row.summary != row.title {
                    Text(row.summary)
                        .font(HUDType.body(13))
                        .foregroundStyle(HUDChrome.inkMuted)
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)
                        .lineSpacing(2)
                }

                if let detail = row.detail, !detail.isEmpty {
                    Text(detail)
                        .font(HUDType.body(12))
                        .foregroundStyle(HUDChrome.ink)
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)
                        .lineSpacing(3)
                }

                VStack(spacing: 0) {
                    Rectangle().fill(HUDChrome.border).frame(height: 0.5)
                    HStack(spacing: 8) {
                        InitialAvatar(name: row.agent)
                        Text(row.agent)
                            .font(HUDType.body(12))
                            .foregroundStyle(HUDChrome.ink)
                        if let handle = row.handle {
                            Text(handle.hasPrefix("@") ? handle : "@" + handle)
                                .font(HUDType.mono(11))
                                .foregroundStyle(HUDChrome.inkFaint)
                        }
                        Spacer()
                        if let flight = row.flightId {
                            Text("flight \(flight)")
                                .font(HUDType.mono(10))
                                .monospacedDigit()
                                .foregroundStyle(HUDChrome.inkMuted)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 2.5)
                                        .stroke(HUDChrome.border, lineWidth: 0.5)
                                )
                        }
                    }
                    .padding(.top, 10)
                }

                Spacer(minLength: 0)

                VStack(alignment: .leading, spacing: 3) {
                    HUDDrillLink(label: "OPEN THREAD", url: threadURL)
                    HUDDrillLink(label: "FOLLOW EXECUTION", url: followURL)
                    HUDDrillLink(label: "AGENT PROFILE", url: agentURL)
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // WHY: every event always gets all three drills with the most-specific
    // available scope. Each link walks down a deliberate priority chain;
    // we never fall back to a static index when a scoped surface exists.
    //
    // Web routes consulted (see packages/web/client/lib/router.ts):
    //   /c/<conversationId>                  conversation thread
    //   /follow/{flight|invocation|session|conversation|agent}/<id>
    //   /ops/tail?q=<query>                  scoped tail (last resort for follow)
    //   /agents/<agentId>                    agent profile

    private var threadURL: URL {
        let base = HudFleetService.webBaseURL()
        // When a specific message produced the event, deep-link to it via
        // the #msg-<id> anchor ConversationScreen exposes (see
        // ConversationScreen.tsx — share-link helper around msg- anchors).
        let fragment: String = {
            guard let mid = row.messageId, !mid.isEmpty else { return "" }
            return "#msg-\(percent(mid))"
        }()
        if let cid = row.conversationId, !cid.isEmpty {
            return relativeURL("/c/\(percent(cid))\(fragment)", base: base)
        }
        if let aid = row.agentId, !aid.isEmpty {
            // No conversation on the event, but the operator's DM with this
            // agent is the natural "open thread" landing. Mirrors the web
            // router's conversationForAgent(agentId) helper.
            return relativeURL("/c/\(percent("dm.operator.\(aid)"))\(fragment)", base: base)
        }
        return relativeURL("/conversations", base: base)
    }

    private var followURL: URL {
        let base = HudFleetService.webBaseURL()
        // Pick the narrowest follow target the event carries — flights run
        // inside invocations inside sessions inside conversations. Each
        // narrower scope hides less of the surrounding stream.
        if let f = row.flightId, !f.isEmpty {
            return relativeURL("/follow/flight/\(percent(f))", base: base)
        }
        if let i = row.invocationId, !i.isEmpty {
            return relativeURL("/follow/invocation/\(percent(i))", base: base)
        }
        if let s = row.sessionId, !s.isEmpty {
            return relativeURL("/follow/session/\(percent(s))", base: base)
        }
        if let c = row.conversationId, !c.isEmpty {
            return relativeURL("/follow/conversation/\(percent(c))", base: base)
        }
        if let a = row.agentId, !a.isEmpty {
            return relativeURL("/follow/agent/\(percent(a))", base: base)
        }
        // Last resort is a SCOPED tail, never an empty index. Handle reads
        // best in /ops/tail's query box (operators type @handle by reflex).
        if let q = tailQuery() {
            return relativeURL("/ops/tail?q=\(percentQuery(q))", base: base)
        }
        return relativeURL("/ops/tail", base: base)
    }

    private var agentURL: URL {
        let base = HudFleetService.webBaseURL()
        if let aid = row.agentId, !aid.isEmpty {
            return relativeURL("/agents/\(percent(aid))", base: base)
        }
        return relativeURL("/agents", base: base)
    }

    private func tailQuery() -> String? {
        if let h = row.handle, !h.isEmpty {
            return h.hasPrefix("@") ? h : "@" + h
        }
        if !row.agent.isEmpty { return row.agent }
        return nil
    }

    private func percent(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? s
    }

    private func percentQuery(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s
    }

    private func relativeURL(_ path: String, base: URL) -> URL {
        URL(string: path, relativeTo: base)?.absoluteURL ?? base
    }
}

// MARK: - Drill link (shared by activity + sessions large detail)

/// Underlined "→ LABEL" row that opens a web surface URL in the default
/// browser. Used in the right-pane detail of Activity and Sessions; each
/// caller passes a target URL or omits the link entirely when the
/// underlying ID isn't available.
struct HUDDrillLink: View {
    let label: String
    let url: URL

    @State private var hovered = false

    var body: some View {
        Button {
            NSWorkspace.shared.open(url)
        } label: {
            HStack(spacing: 8) {
                Text("→")
                    .font(HUDType.mono(11))
                    .foregroundStyle(hovered ? HUDChrome.accent : HUDChrome.inkFaint)
                Text(label)
                    .font(HUDType.mono(10, weight: .semibold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(hovered ? HUDChrome.ink : HUDChrome.inkMuted)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 4)
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
