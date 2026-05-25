import SwiftUI

// Tail view — broadsheet edition.
//
// The thesis: this is the wire feed printed as a vertical timeline. A
// 1px spine runs down the left edge with one hue-tick per event. Big
// "JUST NOW" / "RECENT" section heads in display-serif lower-case
// give the column rhythm. Inside each section: a time-gutter on the
// far left (mono ago), an agent byline (serif name + mono kind kicker),
// then the dispatch line set in body sans. Tap to expand for the full
// flight detail.
//
// No kind-glyph parade — the section header carries the temporal
// register and the spine carries identity (hue tick). The line itself
// gets to breathe.

private enum TailEventKind {
    case turn
    case message
    case attention
    case started
    case failed
    case system

    var label: String {
        switch self {
        case .turn:      return "turn"
        case .message:   return "wire"
        case .attention: return "ask"
        case .started:   return "start"
        case .failed:    return "fail"
        case .system:    return "note"
        }
    }
}

private struct TailEvent: Identifiable {
    let id: String
    let ts: String
    let tsSeconds: Int          // age in seconds, used for bucketing
    let agentName: String
    let hue: Double
    let kind: TailEventKind
    let line: String
}

private enum TailBucket: Int, CaseIterable, Hashable {
    case justNow = 0   // < 5m
    case recent  = 1   // < 1h
    case today   = 2   // < 1d
    case earlier = 3   // older

    // Lowercase, sentence-style — these are display-serif headlines.
    var headline: String {
        switch self {
        case .justNow: return "Just now"
        case .recent:  return "Last hour"
        case .today:   return "Today"
        case .earlier: return "Filed earlier"
        }
    }

    // Eyebrow — small-caps mono, prints a printable label above the
    // headline.
    var eyebrow: String {
        switch self {
        case .justNow: return "WIRE  ·  LIVE"
        case .recent:  return "WIRE  ·  60 MIN"
        case .today:   return "WIRE  ·  TODAY"
        case .earlier: return "WIRE  ·  ARCHIVE"
        }
    }

    static func bucket(for ageSeconds: Int) -> TailBucket {
        if ageSeconds < 300       { return .justNow }
        if ageSeconds < 3_600     { return .recent }
        if ageSeconds < 86_400    { return .today }
        return .earlier
    }
}

struct HUDTailView: View {
    let agents: [HudAgent]
    let activity: [HudActivityItem]?
    let isLoading: Bool

    @State private var expandedEventId: String? = nil

    private var agentById: [String: HudAgent] {
        Dictionary(uniqueKeysWithValues: agents.map { ($0.id, $0) })
    }

    private var activityById: [String: HudActivityItem] {
        Dictionary(uniqueKeysWithValues: (activity ?? []).map { ($0.id, $0) })
    }

    var body: some View {
        Group {
            if isLoading || activity == nil {
                TailLoadingView()
            } else if events.isEmpty {
                TailEmptyView()
            } else {
                ScrollView(.vertical, showsIndicators: false) {
                    LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                        ForEach(groupedEvents, id: \.bucket) { group in
                            Section {
                                ForEach(Array(group.events.enumerated()), id: \.element.id) { _, event in
                                    TailRow(
                                        event: event,
                                        isExpanded: event.id == expandedEventId,
                                        onTap: {
                                            withAnimation(.easeOut(duration: 0.12)) {
                                                expandedEventId = expandedEventId == event.id ? nil : event.id
                                            }
                                        }
                                    )
                                    if event.id == expandedEventId,
                                       let item = activityById[event.id] {
                                        TailExpandedPanel(event: event, item: item)
                                            .transition(.move(edge: .top).combined(with: .opacity))
                                    }
                                }
                            } header: {
                                TailSectionHeader(bucket: group.bucket)
                            }
                        }
                    }
                    .padding(.bottom, 12)
                }
            }
        }
    }

    private var events: [TailEvent] {
        let now = Date()
        return (activity ?? []).prefix(80).map { item in
            let agent = item.agentId.flatMap { agentById[$0] }
            let name = agent?.name ?? item.displayName
            let then = Date(timeIntervalSince1970: item.ts / 1000)
            let ageSeconds = max(0, Int(now.timeIntervalSince(then)))
            return TailEvent(
                id: item.id,
                ts: item.relativeTimestamp,
                tsSeconds: ageSeconds,
                agentName: name,
                hue: agent?.hue ?? HudHue.forAgent(name: name, handle: nil),
                kind: Self.kind(for: item.kind),
                line: Self.line(for: item)
            )
        }
    }

    private var groupedEvents: [(bucket: TailBucket, events: [TailEvent])] {
        var byBucket: [TailBucket: [TailEvent]] = [:]
        for event in events {
            let b = TailBucket.bucket(for: event.tsSeconds)
            byBucket[b, default: []].append(event)
        }
        return TailBucket.allCases.compactMap { bucket in
            guard let list = byBucket[bucket], !list.isEmpty else { return nil }
            return (bucket: bucket, events: list)
        }
    }

    private static func kind(for raw: String) -> TailEventKind {
        let value = raw.lowercased()
        if value.contains("fail") || value.contains("error") || value.contains("dead") {
            return .failed
        }
        if value.contains("wait") || value.contains("attention") || value.contains("unblock") {
            return .attention
        }
        if value.contains("message") || value.contains("reply") || value.contains("sent") {
            return .message
        }
        if value.contains("start") || value.contains("created") || value.contains("spawn") || value.contains("wake") {
            return .started
        }
        if value.contains("flight") || value.contains("turn") || value.contains("updated") {
            return .turn
        }
        return .system
    }

    private static func line(for item: HudActivityItem) -> String {
        let title = item.title?.trimmingCharacters(in: .whitespacesAndNewlines)
        let summary = item.summary?.trimmingCharacters(in: .whitespacesAndNewlines)
        switch (title?.isEmpty == false ? title : nil, summary?.isEmpty == false ? summary : nil) {
        case let (.some(t), .some(s)) where t != s:
            return "\(t) — \(s)"
        case let (.some(t), _):
            return t
        case let (_, .some(s)):
            return s
        default:
            return item.kind.replacingOccurrences(of: "_", with: " ")
        }
    }
}

// MARK: - Section header (broadsheet)
//
// A real section break. Eyebrow above, display-serif headline below,
// a hairline beneath the headline that aligns with the spine. The
// header is pinned so the operator can scroll a long Tail and still
// know what register they're in.

private struct TailSectionHeader: View {
    let bucket: TailBucket

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 0) {
                HUDEyebrow(text: bucket.eyebrow, color: HUDChrome.inkDeep)
                Spacer(minLength: 8)
            }
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

// MARK: - Tail row (broadsheet)
//
// Each event is a dispatch line.
//
//   Layout (left → right):
//   • 32px time gutter (mono ago, right-aligned, inkFaint)
//   • 1px spine offset from the gutter
//   • 5px hue tick on the spine at the row's baseline
//   • agent byline (display-serif 12pt) followed by tiny mono kind label
//   • dispatch line in body sans 11.5pt
//
// The spine + tick replace the inline kind-dot. Reads as a printed
// timeline rather than a row of equivalent rectangles.

private struct TailRow: View {
    let event: TailEvent
    var isExpanded: Bool = false
    var onTap: () -> Void = {}

    @State private var hovered = false

    private var rowFill: Color {
        if isExpanded { return HUDChrome.canvasLift.opacity(0.55) }
        if hovered    { return HUDChrome.canvasLift.opacity(0.30) }
        return Color.clear
    }

    private var emphasized: Bool {
        event.kind == .attention || event.kind == .failed
    }

    private var tickColor: Color {
        emphasized ? HUDChrome.accent : HUDChrome.inkFaint
    }

    var body: some View {
        ZStack(alignment: .leading) {
            rowFill

            // ── Spine ─────────────────────────────────────────────
            HStack(spacing: 0) {
                // Leave room for the time gutter
                Spacer().frame(width: 40)
                Rectangle()
                    .fill(HUDChrome.border)
                    .frame(width: 1)
            }

            // ── Tick on the spine ────────────────────────────────
            // Square tick lands on whole pixels — Circle anti-aliases
            // and reads soft at 6pt. Emphasized rows get a 5px square
            // in lime; normal rows get a 3px square in ink-faint.
            HStack(spacing: 0) {
                Spacer().frame(width: 35)
                Rectangle()
                    .fill(tickColor)
                    .frame(
                        width: emphasized ? 5 : 3,
                        height: emphasized ? 5 : 3
                    )
                    .padding(.top, emphasized ? 10 : 11)
                Spacer()
            }
            .frame(maxHeight: .infinity, alignment: .top)

            // ── Content ──────────────────────────────────────────
            HStack(alignment: .top, spacing: 11) {
                // Time gutter — right-aligned ago in mono
                Text(event.ts)
                    .font(HUDType.mono(10, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(HUDChrome.inkFaint)
                    .frame(width: 32, alignment: .trailing)

                // The dispatch — byline + line
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(event.agentName)
                            .font(HUDType.body(12, weight: .semibold))
                            .foregroundStyle(HUDChrome.ink)
                            .lineLimit(1)
                            .truncationMode(.tail)
                        Text(event.kind.label.uppercased())
                            .font(HUDType.mono(10, weight: .bold))
                            .tracking(HUDType.eyebrowMicro)
                            .foregroundStyle(emphasized ? HUDChrome.accent : HUDChrome.inkDeep)
                    }
                    Text(event.line)
                        .font(HUDType.body(11))
                        .foregroundStyle(emphasized ? HUDChrome.ink : HUDChrome.inkMuted)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .lineSpacing(1.5)
                }
                Spacer(minLength: 0)
            }
            .padding(.leading, 12)
            .padding(.trailing, 14)
            .padding(.vertical, 8)
        }
        .contentShape(Rectangle())
        .onHover { hovered = $0 }
        .onTapGesture(perform: onTap)
        .contextMenu {
            Button("Copy event ID") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(event.id, forType: .string)
            }
            Button("Copy line") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(event.line, forType: .string)
            }
        }
    }
}

// MARK: - Expanded panel

private struct TailExpandedPanel: View {
    let event: TailEvent
    let item: HudActivityItem

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            if let title = item.title, !title.isEmpty {
                Text(title)
                    .font(HUDType.body(12, weight: .semibold))
                    .foregroundStyle(HUDChrome.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)
                    .lineSpacing(2)
            }

            if let summary = item.summary, !summary.isEmpty, summary != item.title {
                Text(summary)
                    .font(HUDType.body(11).italic())
                    .foregroundStyle(HUDChrome.inkMuted)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)
                    .lineSpacing(2)
            }

            VStack(alignment: .leading, spacing: 2.5) {
                if let flightId = item.flightId {
                    metaRow(label: "FLIGHT", value: flightId)
                }
                if let conversationId = item.conversationId {
                    metaRow(label: "CONV", value: conversationId)
                }
                if let workspace = item.workspaceRoot {
                    metaRow(label: "ROOT", value: workspace)
                }
                metaRow(label: "KIND", value: item.kind)
            }
        }
        .padding(.leading, 52)
        .padding(.trailing, 14)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(HUDChrome.canvasAlt.opacity(0.55))
        .overlay(alignment: .leading) {
            HStack(spacing: 0) {
                Spacer().frame(width: 40)
                Rectangle()
                    .fill(HUDChrome.border)
                    .frame(width: 0.75)
            }
        }
    }

    private func metaRow(label: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label)
                .font(HUDType.mono(10, weight: .bold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(HUDChrome.inkDeep)
                .frame(width: 44, alignment: .leading)
            Text(value)
                .font(HUDType.mono(10))
                .foregroundStyle(HUDChrome.ink)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Loading skeleton

private struct TailLoadingView: View {
    var body: some View {
        VStack(spacing: 0) {
            ForEach(0..<6, id: \.self) { _ in
                LoadingTailRow()
            }
            Spacer(minLength: 0)
        }
        .padding(.top, 12)
    }
}

private struct LoadingTailRow: View {
    var body: some View {
        HStack(alignment: .top, spacing: 11) {
            skeleton(width: 28, height: 8)
                .frame(width: 32, alignment: .trailing)
            VStack(alignment: .leading, spacing: 4) {
                skeleton(width: 70, height: 10)
                skeleton(width: 200, height: 10)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
    }

    private func skeleton(width: CGFloat, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 2, style: .continuous)
            .fill(HUDChrome.canvasLift)
            .frame(width: width, height: height)
    }
}

// MARK: - Empty state (broadsheet)
//
// "Wire is silent." Display serif headline, italic body, no widget.
// Matches the Fleet empty state vocabulary so the two surfaces read
// as the same paper.

private struct TailEmptyView: View {
    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)

            EmptyTailMark()
                .frame(width: 56, height: 18)
                .opacity(0.7)

            HUDEyebrow(text: "WIRE  ·  NO TRAFFIC", color: HUDChrome.inkDeep)
                .padding(.top, 18)

            Text("The wire is silent.")
                .font(HUDType.body(15, weight: .semibold))
                .foregroundStyle(HUDChrome.ink)
                .padding(.top, 6)

            Text("Activity will print here as the broker hears it.")
                .font(HUDType.body(12).italic())
                .foregroundStyle(HUDChrome.inkMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.top, 6)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// A small "wire down" mark — three short rules, two dots. Reads as an
// idle transmission line.
private struct EmptyTailMark: View {
    var body: some View {
        Canvas { ctx, size in
            let style = StrokeStyle(lineWidth: 1, lineCap: .round)
            let c = HUDChrome.inkFaint
            var line = Path()
            let y = size.height / 2
            line.move(to: CGPoint(x: 4, y: y))
            line.addLine(to: CGPoint(x: 18, y: y))
            line.move(to: CGPoint(x: 24, y: y))
            line.addLine(to: CGPoint(x: 32, y: y))
            line.move(to: CGPoint(x: 38, y: y))
            line.addLine(to: CGPoint(x: 52, y: y))
            ctx.stroke(line, with: .color(c), style: style)
            for cx in [21.0, 35.0] {
                let dot = CGRect(x: cx - 0.75, y: y - 0.75, width: 1.5, height: 1.5)
                ctx.fill(Path(ellipseIn: dot), with: .color(c))
            }
        }
    }
}
