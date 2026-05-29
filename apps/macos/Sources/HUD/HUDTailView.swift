import AppKit
import SwiftUI

// Tail tab — native port of design/studio/components/hud/HudTail.tsx.
//
// Compact: dense firehose mono rows, inline raw + PRV/NXT on engage.
// Medium:  same firehose, row font bumps slightly + padded breathing room.
// Large:   two panes — stream left (~540), focused raw + PRV/CUR/NXT right.

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

    // Aged-phosphor palette — distinct hue per kind so a scrolling
    // firehose reads like a colorized terminal log. Saturation kept
    // moderate so colors sit on the warm-dark canvas without buzzing.
    // ASK + ERR are loudest (attention); TUR is neutral ink so a wall
    // of turns reads as the baseline.
    var color: Color {
        switch self {
        case .turn: return HUDChrome.inkMuted
        case .msg:  return Color(red: 0.485, green: 0.780, blue: 0.420) // lime-green echo
        case .tol:  return Color(red: 0.420, green: 0.720, blue: 0.700) // cool teal
        case .edt:  return Color(red: 0.870, green: 0.715, blue: 0.400) // warm amber
        case .err:  return Color(red: 0.910, green: 0.450, blue: 0.395) // muted red
        case .lif:  return Color(red: 0.680, green: 0.575, blue: 0.840) // soft violet
        case .pmt:  return Color(red: 0.880, green: 0.620, blue: 0.395) // soft orange
        case .brk:  return Color(red: 0.555, green: 0.640, blue: 0.730) // cool slate
        case .ask:  return HUDChrome.accent                              // scout lime
        }
    }
}

// Hash-to-hue helper so each agent's `@source` stamps in its own
// color, mirroring studio's agentHue convention. Deterministic across
// renders — same handle always lands on the same hue.
private func sourceColor(for handle: String) -> Color {
    var hash: UInt64 = 5381
    for byte in handle.lowercased().utf8 {
        hash = (hash &* 33) &+ UInt64(byte)
    }
    let hue = Double(hash % 360)
    return HUDChrome.agentHue(hue, lightness: 0.74, saturation: 0.42)
}

// Light syntax highlighting for the line — @mentions get the agent
// hue, file paths and *.ext tokens read in cool teal, and `backticked`
// fragments lift slightly so code-like spans pop out of prose. Kept
// deliberately small: this is a tail row, not a syntax-aware editor.
private func styledLine(_ text: String, base: Color, mono: Font) -> AttributedString {
    var attr = AttributedString(text)
    attr.font = mono
    attr.foregroundColor = base

    let ns = text as NSString
    let full = NSRange(location: 0, length: ns.length)
    let pathColor = Color(red: 0.420, green: 0.720, blue: 0.700)
    let codeColor = HUDChrome.ink

    func apply(pattern: String, color: Color, weight: Font.Weight? = nil) {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return }
        for m in regex.matches(in: text, range: full) {
            let sub = ns.substring(with: m.range)
            guard let lo = attr.range(of: sub) else { continue }
            attr[lo].foregroundColor = color
            if let weight {
                attr[lo].font = mono.weight(weight)
            }
        }
    }

    // @mention — token after @ is the agent handle
    apply(pattern: #"@[A-Za-z][\w\-]+"#, color: HUDChrome.accent)
    // *.ext file paths and slash paths
    apply(pattern: #"[\w./\-_]+\.[a-z]{1,6}\b"#, color: pathColor)
    apply(pattern: #"\B/[\w./\-_]+"#, color: pathColor)
    // `backtick code spans` — read crisper than surrounding prose
    apply(pattern: #"`[^`]+`"#, color: codeColor, weight: .medium)

    return attr
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

    @ObservedObject private var state = HUDState.shared
    @StateObject private var engage = HUDEngageState()
    // `following` = j/k haven't moved off the latest; new rows auto-scroll.
    // The moment the operator moves the cursor, follow drops to false so
    // their reading position doesn't get yanked. `f` toggles it back.
    @State private var following = true

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
                switch state.size {
                case .compact:           compactBody
                case .medium, .large:    largeBody
                }
            }
        }
        .onAppear { wireNavBus() }
        .onDisappear { HUDNavBus.shared.clear() }
    }

    // Register cycle/engage closures with the global key bus. HUDController
    // dispatches j/k/Return/f into these — each view tab does its own wiring
    // so the bus stays a thin dispatcher.
    private func wireNavBus() {
        // j/k / g / G never flip `following` — the firehose keeps firing
        // even while the operator explores. Only `f` pauses live mode
        // (deliberately, so it can't be triggered as a side effect).
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
            // Three-level progressive disclosure on Enter:
            //   1. cursored row not yet engaged → engage it (inline detail expands)
            //   2. cursored row already engaged → stage @target on the dock + focus
            //   3. (next iteration) → drill into a dedicated detail view
            guard let cursoredId = engage.cursoredId,
                  let row = rows.first(where: { $0.id == cursoredId }) else { return }
            if engage.engagedId != cursoredId {
                engage.toggle(cursoredId)
            } else {
                HUDDockState.shared.setTarget(handle: row.source, label: row.source)
                HUDDockState.shared.focus()
            }
        }
        HUDNavBus.shared.toggleFollow = {
            following.toggle()
            if following, let last = rowIds().last {
                engage.cursor(last)
            }
        }
        HUDNavBus.shared.unengageSelected = {
            // Esc cascade: collapse the engaged row back to cursored-only.
            // Cursor stays where it is so j/k continues seamlessly.
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

    // MARK: - Compact

    private var compactBody: some View {
        VStack(spacing: 0) {
            TailLiveMeter(count: rows.count, size: .compact, following: following)
            ScrollViewReader { proxy in
                ScrollView(.vertical, showsIndicators: false) {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(rows.enumerated()), id: \.element.id) { idx, row in
                            TailRow(
                                row: row,
                                size: .compact,
                                cursored: engage.isCursored(row.id),
                                engaged: engage.isEngaged(row.id),
                                onTap: {
                                    withAnimation(.easeOut(duration: 0.10)) {
                                        engage.toggle(row.id)
                                    }
                                }
                            )
                            .id(row.id)
                            if engage.isEngaged(row.id) {
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
                .onChange(of: engage.cursoredId) { _, id in
                    // No anchor → only scroll when the cursor would
                    // otherwise be off-screen. Rows already visible stay
                    // put; the list doesn't jump under the operator.
                    if let id { withAnimation(.easeOut(duration: 0.14)) { proxy.scrollTo(id) } }
                }
            }
        }
    }

    // MARK: - Large (also serves Medium — same two-pane layout, smaller
    // panel frame; see HUDState.contentSize)

    // At large the right pane reads as a preview of whatever the cursor
    // is on (j/k driven), not the engaged row. Engagement opens the
    // dock; cursor drives the side preview.
    private var cursoredIdx: Int {
        if let id = engage.cursoredId, let i = rows.firstIndex(where: { $0.id == id }) {
            return i
        }
        return 0
    }

    private var largeBody: some View {
        VStack(spacing: 0) {
            TailLiveMeter(count: rows.count, size: .large, following: following)
            HStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView(.vertical, showsIndicators: false) {
                        LazyVStack(spacing: 0) {
                            ForEach(Array(rows.enumerated()), id: \.element.id) { _, row in
                                TailRow(
                                    row: row,
                                    size: .large,
                                    cursored: engage.isCursored(row.id),
                                    engaged: engage.isEngaged(row.id),
                                    onTap: {
                                        withAnimation(.easeOut(duration: 0.10)) {
                                            engage.select(row.id)
                                        }
                                    }
                                )
                                .id(row.id)
                            }
                        }
                        .padding(.bottom, 10)
                    }
                    .onChange(of: engage.cursoredId) { _, id in
                        if let id { withAnimation(.easeOut(duration: 0.18)) { proxy.scrollTo(id, anchor: .center) } }
                    }
                }
                .frame(width: 540)

                Rectangle().fill(HUDChrome.border).frame(width: 0.5)

                TailDetailLarge(
                    row: rows[cursoredIdx],
                    prev: cursoredIdx > 0 ? rows[cursoredIdx - 1] : nil,
                    next: cursoredIdx + 1 < rows.count ? rows[cursoredIdx + 1] : nil
                )
                .frame(maxWidth: .infinity)
            }
            .frame(maxHeight: .infinity)
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

private struct TailLiveMeter: View {
    let count: Int
    let size: HUDSize
    let following: Bool
    @State private var phase: CGFloat = 0

    // Matches studio PANEL_PAD_X: px-4 at compact/medium, px-5 at large.
    private var horizontalPad: CGFloat { size == .large ? 20 : 16 }

    var body: some View {
        HStack(spacing: 0) {
            HStack(spacing: 6) {
                ZStack {
                    if following {
                        Circle()
                            .fill(HUDChrome.accent.opacity(0.35 * (1 - phase)))
                            .frame(width: 9, height: 9)
                    }
                    Circle()
                        .fill(following ? HUDChrome.accent : HUDChrome.inkFaint)
                        .frame(width: 5, height: 5)
                }
                .frame(width: 9, height: 9)

                Text(following ? "LIVE" : "PAUSED")
                    .font(HUDType.mono(10, weight: .bold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(following ? HUDChrome.ink : HUDChrome.inkMuted)

                Text("· FIREHOSE")
                    .font(HUDType.mono(10))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(HUDChrome.inkFaint)
            }
            Spacer()
            // f to follow chip — only when the operator has navigated off
            // live. Reads as the "resume" affordance.
            if !following {
                HStack(spacing: 4) {
                    Text("f")
                        .font(HUDType.mono(9, weight: .bold))
                        .foregroundStyle(HUDChrome.accent)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 0.5)
                        .overlay(
                            RoundedRectangle(cornerRadius: 2)
                                .stroke(HUDChrome.accent.opacity(0.5), lineWidth: 0.5)
                        )
                    Text("FOLLOW")
                        .font(HUDType.mono(9, weight: .semibold))
                        .tracking(HUDType.eyebrowMicro)
                        .foregroundStyle(HUDChrome.inkMuted)
                }
                .padding(.trailing, 8)
            }
            Text("\(count) evt")
                .font(HUDType.mono(10))
                .monospacedDigit()
                .foregroundStyle(HUDChrome.inkMuted)
        }
        .padding(.horizontal, horizontalPad)
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

// MARK: - Row

private struct TailRow: View {
    let row: TailRowModel
    let size: HUDSize
    var cursored: Bool = false
    let engaged: Bool
    var onTap: () -> Void = {}

    @State private var hovered = false

    private var body1: Color {
        if engaged || cursored { return HUDChrome.ink }
        return row.emphasized ? HUDChrome.ink : HUDChrome.inkMuted
    }

    private var timeColor: Color {
        if engaged || cursored { return HUDChrome.inkMuted }
        return HUDChrome.inkDeep
    }

    // Bigger font baseline so the firehose reads as content, not chrome.
    // Compact: 11pt. Medium/Large: 12pt. JBM at this size is dense but
    // breathable; previously sat at 10/11 which felt scrunched.
    private var fontSize: CGFloat {
        size == .compact ? 11 : 12
    }

    private var padX: CGFloat {
        size == .compact ? 12 : 14
    }

    private var padY: CGFloat {
        size == .compact ? 3 : 4
    }

    // Fixed-width columns so the line column always starts at the same
    // X — previously each row's `@source` width was different and the
    // message text jittered horizontally as you scrolled. JBM at our
    // size renders ~6.6pt per char, so widths are picked to fit the
    // worst-case token + a hair of margin.
    private var timeWidth: CGFloat {
        size == .compact ? 56 : 62
    }

    private var kindWidth: CGFloat {
        size == .compact ? 26 : 30
    }

    private var sourceWidth: CGFloat {
        size == .compact ? 96 : 108
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(row.at)
                .font(HUDType.mono(fontSize))
                .monospacedDigit()
                .foregroundStyle(timeColor)
                .frame(width: timeWidth, alignment: .leading)

            Text(row.kind.rawValue)
                .font(HUDType.mono(fontSize, weight: .bold))
                .tracking(0.5)
                .foregroundStyle(row.kind.color)
                .frame(width: kindWidth, alignment: .leading)

            Text("@" + row.source)
                .font(HUDType.mono(fontSize, weight: .semibold))
                .foregroundStyle(sourceColor(for: row.source))
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(width: sourceWidth, alignment: .leading)

            Text(styledLine(
                row.line,
                base: body1,
                mono: HUDType.mono(fontSize)
            ))
            .lineLimit(1)
            .truncationMode(.tail)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, padX)
        .padding(.vertical, padY)
        .background {
            TailRowHighlight(cursored: cursored, engaged: engaged, hovered: hovered)
        }
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill((engaged || cursored) ? HUDChrome.accent.opacity(0.36) : HUDChrome.borderSoft)
                .frame(height: (engaged || cursored) ? 0.75 : 0.5)
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

private struct TailRowHighlight: View {
    let cursored: Bool
    let engaged: Bool
    let hovered: Bool

    private var active: Bool { cursored || engaged }

    private var liftOpacity: Double {
        if engaged { return 0.82 }
        if cursored { return 0.58 }
        if hovered { return 0.18 }
        return 0
    }

    private var accentOpacity: Double {
        if engaged { return 0.19 }
        if cursored { return 0.13 }
        return 0
    }

    var body: some View {
        ZStack {
            if liftOpacity > 0 {
                HUDChrome.canvasLift.opacity(liftOpacity)
            }
            if active {
                LinearGradient(
                    colors: [
                        HUDChrome.accent.opacity(accentOpacity),
                        HUDChrome.accent.opacity(accentOpacity * 0.46),
                        Color.clear,
                    ],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            }
        }
    }
}

// MARK: - Engaged inline detail

private struct TailDetailInline: View {
    let row: TailRowModel
    let prev: TailRowModel?
    let next: TailRowModel?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HUDEyebrow(text: "RAW", color: HUDChrome.inkFaint)
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

// MARK: - Large right-pane detail

private struct TailDetailLarge: View {
    let row: TailRowModel
    let prev: TailRowModel?
    let next: TailRowModel?

    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 14) {
                HUDEyebrow(text: "RAW LINE", color: HUDChrome.inkFaint)

                Text("[\(row.at)] [\(row.kind.rawValue)] @\(row.source) · \(row.line)")
                    .font(HUDType.mono(12))
                    .foregroundStyle(HUDChrome.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)
                    .lineSpacing(3)

                Rectangle().fill(HUDChrome.border).frame(height: 0.5)

                HUDEyebrow(text: "WINDOW", color: HUDChrome.inkFaint)

                VStack(alignment: .leading, spacing: 3) {
                    if let prev {
                        windowLine(label: "PRV", row: prev, current: false)
                    }
                    windowLine(label: "CUR", row: row, current: true)
                    if let next {
                        windowLine(label: "NXT", row: next, current: false)
                    }
                }

                Rectangle().fill(HUDChrome.border).frame(height: 0.5)
                    .padding(.top, 4)

                VStack(alignment: .leading, spacing: 4) {
                    metaRow(label: "KIND", value: row.kind.rawValue)
                    metaRow(label: "SOURCE", value: "@" + row.source)
                    metaRow(label: "AT", value: row.at)
                }

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func windowLine(label: String, row r: TailRowModel, current: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label)
                .font(HUDType.mono(10, weight: .bold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(current ? HUDChrome.accent : HUDChrome.inkDeep)
                .frame(width: 32, alignment: .leading)
            Text("\(r.at) \(r.kind.rawValue) @\(r.source) · \(r.line)")
                .font(HUDType.mono(11))
                .foregroundStyle(current ? HUDChrome.ink : HUDChrome.inkFaint)
                .lineLimit(1)
                .truncationMode(.tail)
        }
    }

    private func metaRow(label: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label)
                .font(HUDType.mono(10, weight: .bold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(HUDChrome.inkDeep)
                .frame(width: 64, alignment: .leading)
            Text(value)
                .font(HUDType.mono(11))
                .foregroundStyle(HUDChrome.ink)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 0)
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

            HUDEyebrow(text: "FIREHOSE  ·  NO TRAFFIC", color: HUDChrome.inkFaint)
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
