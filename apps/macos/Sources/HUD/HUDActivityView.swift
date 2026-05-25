import AppKit
import SwiftUI

// Activity tab — native port of design/studio/components/hud/HudActivity.tsx.
//
// Structured, time-bucketed event ledger. Distinct from the tail by
// having section headers, a 1px spine with square tick, category/kind
// eyebrows, a sans 13 title, sans 12 muted summary, and a byline strip
// with an initial-avatar.
//
// At compact (the shipped size) buckets stack vertically; engaging a
// row reveals an inline detail panel below it. Activity rows share the
// HudActivityItem stream consumed by the tail; this view groups it.

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
    let ageSeconds: Int
    let agent: String
    let handle: String?
    let category: ActivityCategory
    let kind: ActivityKindLabel
    let title: String
    let summary: String
    let flightId: String?
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
                ScrollView(.vertical, showsIndicators: false) {
                    LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                        ForEach(grouped, id: \.bucket) { group in
                            Section {
                                ForEach(group.rows) { row in
                                    ActivityRowView(
                                        row: row,
                                        engaged: engage.isSelected(row.id),
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
                    }
                    .padding(.bottom, 12)
                }
            }
        }
    }

    private var rows: [ActivityRowModel] {
        let now = Date()
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
                ageSeconds: ageSec,
                agent: name,
                handle: handle,
                category: category,
                kind: kind,
                title: item.title?.isEmpty == false ? item.title! : item.kind,
                summary: item.summary ?? "",
                flightId: item.flightId,
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
            HUDEyebrow(text: bucket.eyebrow, color: HUDChrome.inkDeep)
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
    let engaged: Bool
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

    var body: some View {
        ZStack(alignment: .leading) {
            rowFill

            // Spine — sits at x=40, between the time gutter and dispatch
            HStack(spacing: 0) {
                Spacer().frame(width: 40)
                Rectangle()
                    .fill(HUDChrome.border)
                    .frame(width: 1)
            }

            // Square tick on the spine
            HStack(spacing: 0) {
                Spacer().frame(width: row.emphasized ? 38 : 39)
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

            // Engaged rule
            if engaged {
                Rectangle()
                    .fill(HUDChrome.accent)
                    .frame(width: 1.5)
            }

            // Content
            HStack(alignment: .top, spacing: 11) {
                Text(row.ago)
                    .font(HUDType.mono(10, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(HUDChrome.inkFaint)
                    .frame(width: 32, alignment: .trailing)
                    .padding(.top, 2)

                VStack(alignment: .leading, spacing: 3) {
                    // Category · kind eyebrow row
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

                    // Title (sans 12 compact — studio uses 12 at compact)
                    Text(row.title)
                        .font(HUDType.body(12, weight: .semibold))
                        .foregroundStyle(HUDChrome.ink)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)

                    // Summary
                    if !row.summary.isEmpty, row.summary != row.title {
                        Text(row.summary)
                            .font(HUDType.body(11))
                            .foregroundStyle(HUDChrome.inkMuted)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                            .lineSpacing(1.5)
                    }

                    // Byline strip
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
            .padding(.trailing, 14)
            .padding(.vertical, 9)
        }
        .contentShape(Rectangle())
        .onHover { hovered = $0 }
        .onTapGesture(perform: onTap)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(HUDChrome.borderSoft)
                .frame(height: 0.5)
                .padding(.horizontal, 16)
        }
    }
}

private struct InitialAvatar: View {
    let name: String

    var body: some View {
        Text(String(name.prefix(1)).uppercased())
            .font(HUDType.mono(10, weight: .semibold))
            .foregroundStyle(HUDChrome.inkMuted)
            .frame(width: 13, height: 13)
            .background(
                Circle()
                    .fill(HUDChrome.canvas)
            )
            .overlay(
                Circle()
                    .stroke(HUDChrome.border, lineWidth: 0.5)
            )
    }
}

// MARK: - Engaged detail

private struct ActivityDetailInline: View {
    let row: ActivityRowModel

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HUDEyebrow(text: "EVENT DETAIL", color: HUDChrome.inkDeep)

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

            HUDEyebrow(text: "LEDGER  ·  EMPTY", color: HUDChrome.inkDeep)
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
