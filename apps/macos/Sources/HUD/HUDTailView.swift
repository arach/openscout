import AppKit
import SwiftUI

// Tail tab — native port of design/studio/components/hud/HudTail.tsx.
//
// Firehose pattern. No section headers, no time buckets, no spine, no
// byline avatar. Just a thin live-meter strip and a dense single-line
// mono stream: HH:MM:SS · KND · @source · <line>. Each row reveals a
// raw + ±1 neighbor block on engage.
//
// This view shares the same HudActivityItem stream as HUDActivityView;
// the difference is presentation — activity buckets + structures, tail
// flattens + densifies. ssh-tail-into-a-server.

private enum TailKind: String {
    case turn = "TUR"
    case msg = "MSG"
    case tol = "TOL"
    case edt = "EDT"
    case err = "ERR"
    case lif = "LIF"
    case pmt = "PMT"
    case brk = "BRK"
    case ask = "ASK"

    static func from(_ raw: String) -> TailKind {
        let v = raw.lowercased()
        if v.contains("fail") || v.contains("error") || v.contains("dead") { return .err }
        if v.contains("ask") || v.contains("attention") || v.contains("wait") { return .ask }
        if v.contains("message") || v.contains("reply") || v.contains("sent") || v.contains("wire") { return .msg }
        if v.contains("tool") { return .tol }
        if v.contains("edit") || v.contains("file") { return .edt }
        if v.contains("prompt") { return .pmt }
        if v.contains("broker") || v.contains("ping") { return .brk }
        if v.contains("start") || v.contains("spawn") || v.contains("wake") || v.contains("lifecycle") { return .lif }
        return .turn
    }
}

private struct TailRowModel: Identifiable {
    let id: String
    let at: String        // HH:MM:SS clock
    let kind: TailKind
    let source: String    // handle/name without "@"
    let line: String
    let emphasized: Bool
}

struct HUDTailView: View {
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
                TailLoadingView()
            } else if rows.isEmpty {
                TailEmptyView()
            } else {
                VStack(spacing: 0) {
                    TailLiveMeter(count: rows.count)
                    ScrollView(.vertical, showsIndicators: false) {
                        LazyVStack(spacing: 0) {
                            ForEach(Array(rows.enumerated()), id: \.element.id) { idx, row in
                                TailRow(
                                    row: row,
                                    engaged: engage.isSelected(row.id),
                                    onTap: {
                                        withAnimation(.easeOut(duration: 0.10)) {
                                            engage.toggle(row.id)
                                        }
                                    }
                                )
                                if engage.isSelected(row.id) {
                                    TailDetailInline(
                                        row: row,
                                        prev: idx > 0 ? rows[idx - 1] : nil,
                                        next: idx + 1 < rows.count ? rows[idx + 1] : nil
                                    )
                                    .transition(.move(edge: .top).combined(with: .opacity))
                                }
                            }
                        }
                        .padding(.bottom, 8)
                    }
                }
            }
        }
    }

    private var rows: [TailRowModel] {
        let clock = DateFormatter()
        clock.dateFormat = "HH:mm:ss"
        return (activity ?? []).prefix(80).map { item in
            let agent = item.agentId.flatMap { agentById[$0] }
            let source = agent?.handle ?? agent?.name ?? item.displayName
            let kind = TailKind.from(item.kind)
            let at = clock.string(from: Date(timeIntervalSince1970: item.ts / 1000))
            return TailRowModel(
                id: item.id,
                at: at,
                kind: kind,
                source: source.hasPrefix("@") ? String(source.dropFirst()) : source,
                line: Self.line(for: item),
                emphasized: kind == .ask || kind == .err
            )
        }
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

// MARK: - Live meter strip
//
// Replaces the section header. Thin row with a pulsing lime dot, the
// word "live · firehose" in mono eyebrow, and an evt counter on the right.
// Reads as a status strip, never as a heading.

private struct TailLiveMeter: View {
    let count: Int
    @State private var phase: CGFloat = 0

    var body: some View {
        HStack(spacing: 0) {
            HStack(spacing: 6) {
                ZStack {
                    Circle()
                        .fill(HUDChrome.accent.opacity(0.35 * (1 - phase)))
                        .frame(width: 9, height: 9)
                    Circle()
                        .fill(HUDChrome.accent)
                        .frame(width: 5, height: 5)
                }
                .frame(width: 9, height: 9)

                Text("LIVE")
                    .font(HUDType.mono(10, weight: .bold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(HUDChrome.ink)

                Text("· FIREHOSE")
                    .font(HUDType.mono(10))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(HUDChrome.inkFaint)
            }
            Spacer()
            Text("\(count) evt")
                .font(HUDType.mono(10))
                .monospacedDigit()
                .foregroundStyle(HUDChrome.inkMuted)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 5)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(HUDChrome.border)
                .frame(height: 0.5)
        }
        .onAppear {
            withAnimation(.easeOut(duration: 1.4).repeatForever(autoreverses: false)) {
                phase = 1.0
            }
        }
    }
}

// MARK: - Row — dense single-line mono

private struct TailRow: View {
    let row: TailRowModel
    let engaged: Bool
    var onTap: () -> Void = {}

    @State private var hovered = false

    private var fill: Color {
        if engaged { return HUDChrome.canvasLift.opacity(0.55) }
        if hovered { return HUDChrome.canvasLift.opacity(0.30) }
        return Color.clear
    }

    private var body1: Color {
        row.emphasized ? HUDChrome.ink : HUDChrome.inkMuted
    }

    private var kindColor: Color {
        row.emphasized ? HUDChrome.accent : HUDChrome.inkFaint
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(row.at)
                .font(HUDType.mono(10))
                .monospacedDigit()
                .foregroundStyle(HUDChrome.inkFaint)

            Text(row.kind.rawValue)
                .font(HUDType.mono(10, weight: .bold))
                .tracking(0.4)
                .foregroundStyle(kindColor)

            Text("@" + row.source)
                .font(HUDType.mono(10))
                .foregroundStyle(body1.opacity(0.85))
                .lineLimit(1)
                .fixedSize()

            Text("·")
                .font(HUDType.mono(10))
                .foregroundStyle(HUDChrome.inkFaint)

            Text(row.line)
                .font(HUDType.mono(10))
                .foregroundStyle(body1)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 2)
        .background(fill)
        .overlay(alignment: .leading) {
            if engaged {
                Rectangle()
                    .fill(HUDChrome.accent)
                    .frame(width: 1.5)
            }
        }
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(HUDChrome.borderSoft)
                .frame(height: 0.5)
        }
        .contentShape(Rectangle())
        .onHover { hovered = $0 }
        .onTapGesture(perform: onTap)
        .contextMenu {
            Button("Copy event ID") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(row.id, forType: .string)
            }
            Button("Copy line") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(row.line, forType: .string)
            }
        }
    }
}

// MARK: - Engaged detail (raw + ±1 neighbors)

private struct TailDetailInline: View {
    let row: TailRowModel
    let prev: TailRowModel?
    let next: TailRowModel?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HUDEyebrow(text: "RAW", color: HUDChrome.inkDeep)
            Text("[\(row.at)] [\(row.kind.rawValue)] @\(row.source) · \(row.line)")
                .font(HUDType.mono(11))
                .foregroundStyle(HUDChrome.ink)
                .fixedSize(horizontal: false, vertical: true)
                .multilineTextAlignment(.leading)
                .lineSpacing(2)

            VStack(alignment: .leading, spacing: 2) {
                if let prev {
                    neighborLine(label: "PRV", row: prev)
                }
                if let next {
                    neighborLine(label: "NXT", row: next)
                }
            }
            .padding(.top, 2)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(HUDChrome.canvasAlt.opacity(0.55))
    }

    private func neighborLine(label: String, row r: TailRowModel) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(label)
                .font(HUDType.mono(10, weight: .bold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(HUDChrome.inkDeep)
                .frame(width: 26, alignment: .leading)
            Text("\(r.at) \(r.kind.rawValue) @\(r.source) · \(r.line)")
                .font(HUDType.mono(10))
                .foregroundStyle(HUDChrome.inkFaint)
                .lineLimit(1)
                .truncationMode(.tail)
        }
    }
}

// MARK: - Loading / empty

private struct TailLoadingView: View {
    var body: some View {
        VStack(spacing: 0) {
            ForEach(0..<10, id: \.self) { _ in
                HStack(spacing: 6) {
                    skeleton(width: 50, height: 7)
                    skeleton(width: 22, height: 7)
                    skeleton(width: 40, height: 7)
                    skeleton(width: 180, height: 7)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 3)
            }
            Spacer(minLength: 0)
        }
        .padding(.top, 8)
    }

    private func skeleton(width: CGFloat, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 1.5, style: .continuous)
            .fill(HUDChrome.canvasLift)
            .frame(width: width, height: height)
    }
}

private struct TailEmptyView: View {
    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)

            HUDEyebrow(text: "FIREHOSE  ·  NO TRAFFIC", color: HUDChrome.inkDeep)
                .padding(.top, 18)

            Text("Wire is silent.")
                .font(HUDType.body(15, weight: .semibold))
                .foregroundStyle(HUDChrome.ink)
                .padding(.top, 6)

            Text("Events will stream here as the broker hears them.")
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
