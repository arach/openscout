import AppKit
import ScoutAppCore
import SwiftUI

// Tail tab — native port of design/studio/components/hud/HudTail.tsx.
//
// Compact: dense vertical firehose rows, inline raw + PRV/NXT on engage.
// Medium:  the same portrait stream with a slightly roomier row rhythm.
// Large:   tall side-overlay stream for always-on desktop scanning.

private typealias TailRowModel = ScoutTailRowContext

private extension ScoutTailDisplayKind {
    // HUD overlay palette: mostly monochrome so the stream can sit over the
    // desktop without feeling like dashboard chrome. Attention/error keep a
    // restrained tint; normal tool/result rows differ by glyph + weight.
    var hudColor: Color {
        switch self {
        case .tool, .user, .prompt, .edit: return HUDChrome.inkMuted
        case .output, .assistant, .message, .system, .lifecycle, .broker, .event: return HUDChrome.inkFaint
        case .error: return Color(red: 0.910, green: 0.450, blue: 0.395).opacity(0.72)
        case .ask: return HUDChrome.accent.opacity(0.68)
        }
    }
}

// Tail HUD stays intentionally low-color; identity is carried by text rather
// than per-agent hue so the overlay can recede into the desktop.
private func sourceColor(for _: String) -> Color {
    HUDChrome.inkMuted
}

// Light syntax highlighting for the line. The HUD tail keeps this subdued:
// mentions, paths, and code spans lift a little without turning the overlay
// into a colorized dashboard.
private func styledLine(_ text: String, base: Color, mono: Font) -> AttributedString {
    var attr = AttributedString(text)
    attr.font = mono
    attr.foregroundColor = base

    let ns = text as NSString
    let full = NSRange(location: 0, length: ns.length)
    let pathColor = HUDChrome.inkFaint
    let codeColor = HUDChrome.inkMuted

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
    apply(pattern: #"@[A-Za-z][\w\-]+"#, color: HUDChrome.inkMuted)
    // *.ext file paths and slash paths
    apply(pattern: #"[\w./\-_]+\.[a-z]{1,6}\b"#, color: pathColor)
    apply(pattern: #"\B/[\w./\-_]+"#, color: pathColor)
    // `backtick code spans` — read crisper than surrounding prose
    apply(pattern: #"`[^`]+`"#, color: codeColor, weight: .medium)

    return attr
}

private func copyToPasteboard(_ value: String) {
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(value, forType: .string)
}

struct HUDTailView: View {
    @ObservedObject var tail: ScoutTailStore
    let agents: [HudAgent]

    @ObservedObject private var state = HUDState.shared
    @ObservedObject private var motion = HUDMotionState.shared
    @StateObject private var engage = HUDEngageState()
    // `following` = j/k haven't moved off the latest; new rows auto-scroll.
    // The moment the operator moves the cursor, follow drops to false so
    // their reading position doesn't get yanked. `f` toggles it back.
    @State private var following = true
    @State private var seenRowIds: Set<String> = []
    @State private var freshRowIds: Set<String> = []
    @State private var hasPrimedRows = false
    @State private var tailInteractionsLive = false
    @AppStorage(HUDTailAppearance.pathColumnWidthKey) private var pathColumnWidth = HUDTailAppearance.defaultPathColumnWidth
    @AppStorage(HUDTailAppearance.kindColumnWidthKey) private var kindColumnWidth = HUDTailAppearance.defaultKindColumnWidth

    var body: some View {
        Group {
            if let error = tail.lastError, !tail.hasBufferedEvents {
                TailProblemView(message: error)
            } else if tail.isLoading && !tail.hasBufferedEvents {
                TailLoadingView()
            } else if rows.isEmpty {
                TailEmptyView(hasBufferedEvents: tail.hasBufferedEvents)
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
                HUDDockState.shared.setTarget(handle: row.routingHandle, label: row.routingLabel)
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
        let currentRows = rows
        let motionKey = rowMotionKey(for: currentRows)
        let motionActive = motion.isActive

        return VStack(spacing: 0) {
            TailLiveMeter(count: currentRows.count, size: size, following: following)
            ScrollViewReader { proxy in
                ScrollView(.vertical, showsIndicators: false) {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(currentRows.enumerated()), id: \.element.id) { idx, row in
                            TailRow(
                                row: row,
                                size: size,
                                fresh: motionActive ? false : freshRowIds.contains(row.id),
                                interactionsLive: !motionActive && tailInteractionsLive,
                                pathWidth: resolvedPathColumnWidth(for: size),
                                kindWidth: resolvedKindColumnWidth,
                                cursored: engage.isCursored(row.id),
                                engaged: engage.isEngaged(row.id),
                                onTap: {
                                    withAnimation(.easeOut(duration: 0.10)) {
                                        engage.toggle(row.id)
                                    }
                                }
                            )
                            .allowsHitTesting(tailInteractionsLive)
                            .id(row.id)
                            if engage.isEngaged(row.id) {
                                TailDetailInline(
                                    row: row,
                                    prev: idx > 0 ? currentRows[idx - 1] : nil,
                                    next: idx + 1 < currentRows.count ? currentRows[idx + 1] : nil,
                                    size: size
                                )
                                .transition(.move(edge: .top).combined(with: .opacity))
                            }
                        }
                    }
                    .padding(.bottom, size == .large ? 14 : 8)
                    .animation(
                        motionActive ? nil : .spring(response: 0.26, dampingFraction: 0.86, blendDuration: 0.06),
                        value: motionKey
                    )
                }
                .onChange(of: engage.cursoredId) { _, id in
                    guard !motionActive else { return }
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
                .onChange(of: motionKey) { _, _ in
                    if motionActive {
                        absorbRowsWithoutFresh(currentRows)
                        return
                    }
                    markFreshRows(currentRows)
                    guard following, let last = currentRows.last?.id else { return }
                    withAnimation(.easeOut(duration: 0.18)) {
                        proxy.scrollTo(last, anchor: .bottom)
                    }
                }
                .onChange(of: motion.phase) { _, phase in
                    if phase == .idle {
                        absorbRowsWithoutFresh(currentRows)
                    }
                }
            }
        }
        .contentShape(Rectangle())
        .onHover { tailInteractionsLive = $0 }
        .onAppear {
            primeMotionState(currentRows)
        }
    }

    private var rows: [TailRowModel] {
        ScoutTailContextBuilder.rows(events: tail.displayEvents(limit: 180), agents: agents)
    }

    private func resolvedPathColumnWidth(for size: HUDSize) -> CGFloat {
        let defaultWidth: Double = size == .compact ? 92 : (size == .large ? HUDTailAppearance.defaultPathColumnWidth : 104)
        let stored = pathColumnWidth == HUDTailAppearance.defaultPathColumnWidth ? defaultWidth : pathColumnWidth
        return CGFloat(HUDTailAppearance.clamp(stored, 64...260))
    }

    private var resolvedKindColumnWidth: CGFloat {
        CGFloat(HUDTailAppearance.clamp(kindColumnWidth, 28...64))
    }

    private func rowMotionKey(for rows: [TailRowModel]) -> String {
        rows.map(\.id).joined(separator: "|")
    }

    private func primeMotionState(_ rows: [TailRowModel]) {
        guard !hasPrimedRows, !rows.isEmpty else { return }
        seenRowIds = Set(rows.map(\.id))
        hasPrimedRows = true
    }

    private func absorbRowsWithoutFresh(_ rows: [TailRowModel]) {
        guard !rows.isEmpty else { return }
        seenRowIds.formUnion(rows.map(\.id))
        hasPrimedRows = true
        freshRowIds.removeAll()
    }

    private func markFreshRows(_ rows: [TailRowModel]) {
        let ids = Set(rows.map(\.id))
        guard hasPrimedRows else {
            seenRowIds = ids
            hasPrimedRows = true
            return
        }

        let fresh = ids.subtracting(seenRowIds)
        seenRowIds.formUnion(ids)
        guard !fresh.isEmpty else { return }

        freshRowIds.formUnion(fresh)
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 720_000_000)
            freshRowIds.subtract(fresh)
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
                            .fill(HUDChrome.inkMuted.opacity(0.18 * (1 - phase)))
                            .frame(width: 9, height: 9)
                    }
                    Circle()
                        .fill(following ? HUDChrome.inkMuted : HUDChrome.inkFaint)
                        .frame(width: 5, height: 5)
                }
                .frame(width: 9, height: 9)

                Text(following ? "LIVE" : "PAUSED")
                    .font(HUDType.mono(8.5, weight: .bold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(following ? HUDChrome.inkMuted : HUDChrome.inkFaint)

                Text("· FIREHOSE")
                    .font(HUDType.mono(8.5))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(HUDChrome.inkFaint)
            }
            Spacer()
            // f to follow chip — only when the operator has navigated off
            // live. Reads as the "resume" affordance.
            if !following {
                HStack(spacing: 4) {
                    Text("f")
                        .font(HUDType.mono(8, weight: .bold))
                        .foregroundStyle(HUDChrome.inkMuted)
                        .padding(.horizontal, 4)
                        .padding(.vertical, 0.5)
                        .overlay(
                            RoundedRectangle(cornerRadius: 2)
                                .stroke(HUDChrome.inkFaint.opacity(0.45), lineWidth: 0.5)
                        )
                    Text("FOLLOW")
                        .font(HUDType.mono(8, weight: .semibold))
                        .tracking(HUDType.eyebrowMicro)
                        .foregroundStyle(HUDChrome.inkMuted)
                }
                .padding(.trailing, 8)
            }
            Text("\(count) evt")
                .font(HUDType.mono(8.5))
                .monospacedDigit()
                .foregroundStyle(HUDChrome.inkMuted)
        }
        .padding(.horizontal, horizontalPad)
        .padding(.vertical, 4)
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
    let fresh: Bool
    let interactionsLive: Bool
    let pathWidth: CGFloat
    let kindWidth: CGFloat
    var cursored: Bool = false
    let engaged: Bool
    var onTap: () -> Void = {}

    @State private var hovered = false
    @State private var scopeHovered = false
    @State private var hasPoppedIn = false

    private var body1: Color {
        if engaged || cursored { return HUDChrome.ink }
        return row.emphasized ? HUDChrome.ink : HUDChrome.inkMuted
    }

    private var timeColor: Color {
        if engaged || cursored { return HUDChrome.inkMuted }
        return HUDChrome.inkDeep
    }

    private var fontSize: CGFloat {
        size == .compact ? 8.5 : 9
    }

    private var padX: CGFloat {
        size == .large ? 14 : 11
    }

    private var padY: CGFloat {
        size == .compact ? 1 : 1.5
    }

    private var timeWidth: CGFloat {
        size == .compact ? 45 : 49
    }

    private var providerWidth: CGFloat {
        size == .compact ? 14 : 16
    }

    private var scopeExpanded: Bool {
        scopeHovered || engaged || cursored
    }

    private var active: Bool {
        engaged || cursored
    }

    private var lineTruncation: Text.TruncationMode {
        row.kind == .tool ? .middle : .tail
    }

    var body: some View {
        rowContent
            .padding(.horizontal, padX)
            .padding(.vertical, padY)
            .background {
                TailRowHighlight(cursored: cursored, engaged: engaged, hovered: hovered)
            }
            .overlay(alignment: .bottom) {
                selectedDivider
            }
            .opacity(fresh && !hasPoppedIn ? 0 : 1)
            .offset(y: fresh && !hasPoppedIn ? 5 : 0)
            .scaleEffect(fresh && !hasPoppedIn ? 0.992 : 1, anchor: .bottom)
            .overlay(alignment: .leading) {
                freshMarker
            }
            .transition(
                .asymmetric(
                    insertion: .move(edge: .bottom)
                        .combined(with: .opacity)
                        .combined(with: .scale(scale: 0.992, anchor: .bottom)),
                    removal: .opacity
                )
            )
            .contentShape(Rectangle())
            .onHover { next in
                guard interactionsLive else {
                    hovered = false
                    scopeHovered = false
                    return
                }
                hovered = next
                if !next {
                    scopeHovered = false
                }
            }
            .onChange(of: interactionsLive) { _, live in
                if !live {
                    hovered = false
                    scopeHovered = false
                }
            }
            .onTapGesture(perform: onTap)
            .onAppear {
                guard fresh else { return }
                hasPoppedIn = false
                withAnimation(.spring(response: 0.24, dampingFraction: 0.78, blendDuration: 0.04)) {
                    hasPoppedIn = true
                }
            }
            .onChange(of: fresh) { _, next in
                guard next else {
                    hasPoppedIn = false
                    return
                }
                hasPoppedIn = false
                withAnimation(.spring(response: 0.24, dampingFraction: 0.78, blendDuration: 0.04)) {
                    hasPoppedIn = true
                }
            }
            .contextMenu {
                rowContextMenu
            }
    }

    private var rowContent: some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(row.at)
                .font(HUDType.mono(fontSize))
                .monospacedDigit()
                .foregroundStyle(timeColor)
                .frame(width: timeWidth, alignment: .leading)

            TailProviderMark(provider: row.provider, size: size, active: active)
                .frame(width: providerWidth, alignment: .leading)

            TailPathLabel(
                row: row,
                size: size,
                active: active,
                expanded: scopeExpanded,
                sessionHoverEnabled: interactionsLive && (hovered || active),
                onSessionHover: { scopeHovered = $0 }
            )
            .frame(width: scopeExpanded ? pathWidth + 46 : pathWidth, alignment: .leading)

            TailKindCode(kind: row.kind, fontSize: fontSize)
                .frame(width: kindWidth, alignment: .leading)

            lineText
        }
    }

    private var lineText: some View {
        Text(styledLine(row.line, base: body1, mono: HUDType.mono(fontSize)))
            .lineLimit(1)
            .truncationMode(lineTruncation)
            .frame(maxWidth: .infinity, alignment: .leading)
            .layoutPriority(1)
    }

    @ViewBuilder
    private var selectedDivider: some View {
        if active {
            Rectangle()
                .fill(HUDChrome.inkFaint.opacity(0.24))
                .frame(height: 0.5)
        }
    }

    @ViewBuilder
    private var freshMarker: some View {
        if fresh && hasPoppedIn {
            Rectangle()
                .fill(HUDChrome.inkMuted.opacity(0.22))
                .frame(width: 1)
                .transition(.opacity)
        }
    }

    @ViewBuilder
    private var rowContextMenu: some View {
        Button("Open session") {
            NSWorkspace.shared.open(row.sessionURL)
        }
        .disabled(!row.hasSession)
        Button("Follow live tail") {
            NSWorkspace.shared.open(row.followURL)
        }
        .disabled(!row.hasSession)
        if let agentURL = row.agentURL {
            Button("Agent profile") {
                NSWorkspace.shared.open(agentURL)
            }
        }
        if let messagesURL = row.messagesURL {
            Button("Message thread") {
                NSWorkspace.shared.open(messagesURL)
            }
        }
        Divider()
        Button("Copy session ID") {
            copyToPasteboard(row.sessionId)
        }
        .disabled(!row.hasSession)
        Button("Copy event ID") {
            copyToPasteboard(row.id)
        }
        Button("Copy line") {
            copyToPasteboard(row.line)
        }
    }
}

private struct TailProviderMark: View {
    let provider: String
    let size: HUDSize
    let active: Bool

    private var markSize: CGFloat {
        size == .compact ? 10.5 : 11.5
    }

    var body: some View {
        HUDHarnessMark(
            harness: provider,
            size: markSize,
            tint: active ? HUDChrome.ink : HUDChrome.inkMuted
        )
        .frame(width: markSize, height: markSize)
        .help(provider)
    }
}

private struct TailKindCode: View {
    let kind: ScoutTailDisplayKind
    let fontSize: CGFloat

    var body: some View {
        HStack(spacing: 2) {
            Text(kind.glyph)
            Text(kind.rawValue)
        }
        .font(HUDType.mono(fontSize, weight: .bold))
        .foregroundStyle(kind.hudColor)
        .lineLimit(1)
        .fixedSize(horizontal: true, vertical: false)
        .help(kind.rawValue)
    }
}

private struct TailPathLabel: View {
    let row: TailRowModel
    let size: HUDSize
    let active: Bool
    let expanded: Bool
    let sessionHoverEnabled: Bool
    var onSessionHover: (Bool) -> Void = { _ in }

    private var fontSize: CGFloat {
        size == .compact ? 8.5 : 9
    }

    var body: some View {
        HStack(spacing: 0) {
            Text(row.pathPrimary)
                .font(HUDType.mono(fontSize, weight: .semibold))
                .foregroundStyle(active ? HUDChrome.ink : HUDChrome.inkMuted)
                .lineLimit(1)
                .truncationMode(.tail)
            Text(expanded ? row.expandedPathDetail : row.compactPathDetail)
                .font(HUDType.mono(fontSize, weight: .semibold))
                .foregroundStyle(active ? HUDChrome.inkMuted : HUDChrome.inkFaint)
                .lineLimit(1)
                .truncationMode(.tail)
                .contentShape(Rectangle())
                .allowsHitTesting(sessionHoverEnabled)
                .onHover { hovering in
                    onSessionHover(sessionHoverEnabled && hovering)
                }
        }
        .help(row.hoverLabel)
        .onChange(of: sessionHoverEnabled) { _, enabled in
            if !enabled {
                onSessionHover(false)
            }
        }
    }
}

private struct TailRowHighlight: View {
    let cursored: Bool
    let engaged: Bool
    let hovered: Bool

    private var liftOpacity: Double {
        if engaged { return 0.32 }
        if cursored { return 0.22 }
        if hovered { return 0.10 }
        return 0
    }

    var body: some View {
        ZStack {
            if liftOpacity > 0 {
                HUDChrome.canvasLift.opacity(liftOpacity)
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
        size == .compact ? 8.5 : 9
    }

    private var neighborFont: CGFloat {
        size == .compact ? 8.5 : 9
    }

    private var padX: CGFloat {
        size == .large ? 14 : 11
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HUDEyebrow(text: "EVENT DETAIL", color: HUDChrome.inkFaint)
            Text(row.detailSummary)
                .font(HUDType.mono(bodyFont))
                .foregroundStyle(HUDChrome.ink)
                .fixedSize(horizontal: false, vertical: true)
                .multilineTextAlignment(.leading)
                .lineSpacing(1.5)

            VStack(alignment: .leading, spacing: 2) {
                metaRow(label: "SESSION", value: row.hasSession ? row.sessionId : "—")
                metaRow(label: "PROVIDER", value: row.provider)
                metaRow(label: "PROJECT", value: row.project)
                if !row.cwd.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    metaRow(label: "CWD", value: row.cwd)
                }
                if let agentName = row.agentName {
                    metaRow(label: "AGENT", value: agentName)
                }
            }
            .padding(.top, 1)

            VStack(alignment: .leading, spacing: 3) {
                if row.hasSession {
                    HUDDrillLink(label: "OPEN SESSION", url: row.sessionURL, compact: true)
                    HUDDrillLink(label: "FOLLOW LIVE", url: row.followURL, compact: true)
                }
                if let agentURL = row.agentURL {
                    HUDDrillLink(label: "AGENT PROFILE", url: agentURL, compact: true)
                }
                if let messagesURL = row.messagesURL {
                    HUDDrillLink(label: "MESSAGE THREAD", url: messagesURL, compact: true)
                }
            }
            .padding(.top, 2)

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
        .padding(.vertical, size == .compact ? 6 : 7)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(HUDChrome.canvasAlt.opacity(0.55))
    }

    private func metaRow(label: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label)
                .font(HUDType.mono(8.5, weight: .bold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(HUDChrome.inkDeep)
                .frame(width: 56, alignment: .leading)
            Text(value.isEmpty ? "—" : value)
                .font(HUDType.mono(8.5))
                .foregroundStyle(HUDChrome.ink)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 0)
        }
    }

    private func neighborLine(label: String, row r: TailRowModel) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(label)
                .font(HUDType.mono(10, weight: .bold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(HUDChrome.inkDeep)
                .frame(width: 26, alignment: .leading)
            Text(r.neighborSummary)
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

private struct TailProblemView: View {
    let message: String

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)

            HUDEyebrow(text: "FIREHOSE  ·  OFFLINE", color: HUDChrome.inkFaint)
                .padding(.top, 18)

            Text("Broker unreachable.")
                .font(HUDType.body(15, weight: .semibold))
                .foregroundStyle(HUDChrome.ink)
                .padding(.top, 6)

            Text(message)
                .font(HUDType.body(12))
                .foregroundStyle(HUDChrome.inkMuted)
                .multilineTextAlignment(.center)
                .lineLimit(3)
                .padding(.horizontal, 32)
                .padding(.top, 6)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct TailEmptyView: View {
    let hasBufferedEvents: Bool

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)

            HUDEyebrow(text: hasBufferedEvents ? "FIREHOSE  ·  QUIET SLICE" : "FIREHOSE  ·  NO TRAFFIC", color: HUDChrome.inkFaint)
                .padding(.top, 18)

            Text(hasBufferedEvents ? "Only quiet metadata is buffered." : "Wire is silent.")
                .font(HUDType.body(15, weight: .semibold))
                .foregroundStyle(HUDChrome.ink)
                .padding(.top, 6)

            Text(hasBufferedEvents ? "Fresh work events will appear here as soon as they arrive." : "Events will stream here as the broker hears them.")
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
