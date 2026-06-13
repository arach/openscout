import AppKit
import ScoutAppCore
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

    static func from(_ event: ScoutTailEvent) -> TailKind {
        let summaryKind = from(event.summary)
        if summaryKind == .err || summaryKind == .ask {
            return summaryKind
        }
        switch event.kind {
        case .user: return .pmt
        case .assistant: return .turn
        case .tool, .toolResult: return .tol
        case .system: return .lif
        case .other: return summaryKind
        }
    }

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
    @ObservedObject var tail: ScoutTailStore

    @ObservedObject private var state = HUDState.shared
    @StateObject private var engage = HUDEngageState()
    // `following` = j/k haven't moved off the latest; new rows auto-scroll.
    // The moment the operator moves the cursor, follow drops to false so
    // their reading position doesn't get yanked. `f` toggles it back.
    @State private var following = true

    var body: some View {
        Group {
            if tail.isLoading && tail.events.isEmpty {
                TailLoadingView()
            } else if rows.isEmpty {
                TailEmptyView()
            } else {
                switch state.size {
                case .compact: rowsBody(size: .compact)
                case .medium:  rowsBody(size: .medium)
                case .large:   rowsBody(size: .large)
                }
            }
        }
        .onAppear {
            tail.start()
            wireNavBus()
        }
        .onDisappear {
            tail.stop()
            HUDNavBus.shared.clear()
        }
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

    // MARK: - Rows

    private func rowsBody(size: HUDSize) -> some View {
        VStack(spacing: 0) {
            TailLiveMeter(count: rows.count, size: size, following: following)
            ScrollViewReader { proxy in
                ScrollView(.vertical, showsIndicators: false) {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(rows.enumerated()), id: \.element.id) { idx, row in
                            TailRow(
                                row: row,
                                size: size,
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
                                    next: idx + 1 < rows.count ? rows[idx + 1] : nil,
                                    size: size
                                )
                                .transition(.move(edge: .top).combined(with: .opacity))
                            }
                        }
                    }
                    .padding(.bottom, size == .large ? 12 : 8)
                }
                .onChange(of: engage.cursoredId) { _, id in
                    guard let id else { return }
                    withAnimation(.easeOut(duration: 0.16)) {
                        if size == .compact {
                            // No anchor → only scroll when the cursor would
                            // otherwise be off-screen. Rows already visible stay
                            // put; the list doesn't jump under the operator.
                            proxy.scrollTo(id)
                        } else {
                            proxy.scrollTo(id, anchor: .center)
                        }
                    }
                }
            }
        }
    }

    private var rows: [TailRowModel] {
        Array(tail.filteredEvents.suffix(80)).map { event in
            let source = event.sourceLabel
            let kind = TailKind.from(event)
            return TailRowModel(
                id: event.id,
                at: event.clockLabel,
                kind: kind,
                source: source.hasPrefix("@") ? String(source.dropFirst()) : source,
                line: Self.line(for: event),
                emphasized: kind == .ask || kind == .err
            )
        }
    }

    private static func line(for event: ScoutTailEvent) -> String {
        let summary = event.summary.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !summary.isEmpty else { return event.kind.title }
        return summary
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
    var size: HUDSize = .compact

    private var bodyFont: CGFloat {
        size == .compact ? 11 : 12
    }

    private var neighborFont: CGFloat {
        size == .compact ? 10 : 11
    }

    private var padX: CGFloat {
        size == .large ? 20 : 14
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HUDEyebrow(text: "RAW", color: HUDChrome.inkFaint)
            Text("[\(row.at)] [\(row.kind.rawValue)] @\(row.source) · \(row.line)")
                .font(HUDType.mono(bodyFont))
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
        .padding(.horizontal, padX)
        .padding(.vertical, size == .compact ? 9 : 11)
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
                .font(HUDType.mono(neighborFont))
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
