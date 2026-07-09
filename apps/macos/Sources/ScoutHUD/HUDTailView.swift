import AppKit
import ScoutAppCore
import SwiftUI
import WebKit

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

@MainActor
private func stageMessageTarget(for row: TailRowModel) {
    guard let handle = row.sessionRoutingHandle else { return }
    HUDDockState.shared.setTarget(handle: handle, label: row.sessionRoutingLabel)
    HUDDockState.shared.focus()
}

/// How a tail render is framed. The render itself — `HUDTailView`'s LOGS layout
/// (filter · log · detail) — is identical across surfaces; only theme,
/// placement, and chrome differ. One render, the surface as the single knob, so
/// the framing can never half-agree with the content (no overlay-render-with-
/// panel-dock states).
enum TailSurface {
    /// Desktop glass, edge-docked, no message dock — the always-on scan overlay.
    case overlay
    /// Solid HUD-panel canvas, in place within the summoned panel, dock present.
    case panel

    var isGlass: Bool { self == .overlay }
    var showsDock: Bool { self == .panel }

    /// Fill for the filter / detail side columns, tuned to read against the
    /// surface's own background.
    var sidePaneFill: Color {
        switch self {
        case .overlay: return HUDChrome.canvas.opacity(0.62)
        case .panel: return HUDChrome.canvasAlt.opacity(0.55)
        }
    }
}

enum HUDTailTreatment: String, CaseIterable, Identifiable {
    static let storageKey = "scout.hud.tail.treatment.v1"

    case firehose
    case agentLatest

    var id: String { rawValue }

    var title: String {
        switch self {
        case .firehose: return "Logs"
        case .agentLatest: return "Agents"
        }
    }

    var shortLabel: String {
        switch self {
        case .firehose: return "LOGS"
        case .agentLatest: return "AGENTS"
        }
    }

    var systemName: String {
        switch self {
        case .firehose: return "list.bullet"
        case .agentLatest: return "person.2"
        }
    }

    var next: HUDTailTreatment {
        switch self {
        case .firehose: return .agentLatest
        case .agentLatest: return .firehose
        }
    }
}

struct HUDTailView: View {
    @ObservedObject var tail: ScoutTailStore
    let agents: [HudAgent]
    @Binding var treatment: HUDTailTreatment
    let size: HUDSize
    // The framing this render is hosted in. Only theme/chrome reads it — the
    // layout below is surface-agnostic.
    var surface: TailSurface = .overlay
    var managesTailLifecycle = true

    @Environment(\.colorScheme) private var colorScheme
    @ObservedObject private var motion = HUDMotionState.shared
    @StateObject private var engage = HUDEngageState()
    // `following` = j/k haven't moved off the latest; new rows auto-scroll.
    // The moment the operator moves the cursor, follow drops to false so
    // their reading position doesn't get yanked. `f` toggles it back.
    @State private var following = true
    @State private var seenRowIds: Set<String> = []
    @State private var freshRowIds: Set<String> = []
    @State private var pendingFreshRowIds: Set<String> = []
    @State private var revealQueue: [String] = []
    @State private var revealTask: Task<Void, Never>?
    @State private var hasPrimedRows = false
    @State private var tailInteractionsLive = false
    // Left-rail filter: when set, the centre log is scoped to one actor.
    @State private var filterKey: String? = nil
    // The turn row currently folded out under the pointer, if any. While set,
    // the live stream stops auto-scrolling so reading a folded-out line isn't
    // yanked out from under the cursor in follow mode.
    @State private var foldedOutTurnId: String? = nil
    @AppStorage(HUDTailAppearance.pathColumnWidthKey) private var pathColumnWidth = HUDTailAppearance.defaultPathColumnWidth
    @AppStorage(HUDTailAppearance.kindColumnWidthKey) private var kindColumnWidth = HUDTailAppearance.defaultKindColumnWidth

    var body: some View {
        Group {
            switch treatment {
            case .firehose:
                nativeTailContent
            case .agentLatest:
                HUDTailEmbedContent(url: hudTailEmbedURL(colorScheme: colorScheme, hudSize: size))
            }
        }
        .onAppear {
            if managesTailLifecycle {
                tail.start()
            }
            wireNavBus()
        }
        .onChange(of: treatment) { _, _ in
            wireNavBus()
        }
        .onDisappear {
            if managesTailLifecycle {
                tail.stop()
            }
            revealTask?.cancel()
            revealTask = nil
            HUDNavBus.shared.clear()
        }
    }

    @ViewBuilder
    private var nativeTailContent: some View {
        // LOGS view — deterministic layout, a pure function of two inputs only
        // (measured width + whether a line is engaged); no size-tier / dock /
        // collapse combos:
        //   • LEFT  — active participants, as a filter   (width ≥ filterMinWidth)
        //   • CENTRE — the log firehose                  (always)
        //   • RIGHT — the engaged line's detail          (width ≥ detailMinWidth ∧ engaged)
        // Below the thresholds the firehose simply has the row to itself, so a
        // narrow tail never gets squished by panes it can't afford.
        GeometryReader { geo in
            let width = geo.size.width
            let engaged = engagedRow
            // Detail pane rides along once there's room for it beside a readable
            // log — sized off the real .large width (≥860), so engaging a line
            // actually reveals its detail instead of just highlighting. When
            // detail and filter can't both fit, the filter yields to the detail.
            let showDetail = engaged != nil && width >= HUDTailRail.detailMinWidth
            let canFilter = width >= HUDTailRail.filterMinWidth
            let showFilter = showDetail
                ? width >= HUDTailRail.filterMinWidth + HUDTailDetail.width
                : canFilter
            HStack(spacing: 0) {
                if showFilter {
                    TailActiveFilter(rows: allRows, selectedKey: $filterKey, paneFill: surface.sidePaneFill)
                        .frame(width: HUDTailRail.width)
                    railDivider
                }
                firehosePane
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                if showDetail, let engaged {
                    railDivider
                    let (prev, next) = neighbors(of: engaged)
                    TailEngagedDetail(
                        row: engaged,
                        prev: prev,
                        next: next,
                        paneFill: surface.sidePaneFill,
                        onMessageSession: {
                            stageMessageTarget(for: engaged)
                        },
                        onClose: {
                        engage.unengage()
                        }
                    )
                    .frame(width: HUDTailDetail.width)
                }
            }
            .frame(width: width, height: geo.size.height, alignment: .topLeading)
            // If the tail is resized too narrow to host the filter at all, drop
            // any active scope with it — otherwise the log stays silently
            // filtered with no visible affordance to clear it. (Detail merely
            // displacing the filter does not clear it; unengage brings it back.)
            .onChange(of: canFilter) { _, eligible in
                if !eligible && filterKey != nil { filterKey = nil }
            }
        }
    }

    private var railDivider: some View {
        Rectangle().fill(HUDChrome.border).frame(width: 0.5)
    }

    @ViewBuilder
    private var firehosePane: some View {
        if let error = tail.lastError, !tail.hasBufferedEvents {
            TailProblemView(message: error)
        } else if tail.isLoading && !tail.hasBufferedEvents {
            TailLoadingView()
        } else if rows.isEmpty {
            TailEmptyView(hasBufferedEvents: tail.hasBufferedEvents)
        } else {
            switch size {
            case .compact: rowsBody(size: .compact)
            case .medium: rowsBody(size: .medium)
            case .large: rowsBody(size: .large)
            }
        }
    }

    // Register cycle/engage closures with the global key bus. HUDController
    // dispatches j/k/Return/f into these — each view tab does its own wiring
    // so the bus stays a thin dispatcher.
    private func wireNavBus() {
        HUDNavBus.shared.clear()
        HUDNavBus.shared.cycleTreatment = {
            treatment = treatment.next
        }
        guard treatment == .firehose else { return }

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
        visibleRows(from: rows).map { $0.id }
    }

    // MARK: - Rows

    private func rowsBody(size: HUDSize) -> some View {
        let allRowsSnapshot = allRows
        let currentRows = rows
        let displayedRows = visibleRows(from: currentRows)
        let sourceMotionKey = rowMotionKey(for: allRowsSnapshot)
        let displayMotionKey = rowMotionKey(for: displayedRows)
        let motionActive = motion.isActive

        return VStack(spacing: 0) {
            TailLiveMeter(
                count: currentRows.count,
                pendingCount: pendingFreshRowIds.count,
                size: size,
                following: following
            )
            ScrollViewReader { proxy in
                ScrollView(.vertical, showsIndicators: false) {
                    LazyVStack(spacing: 0) {
                        // Engaging a row no longer expands it inline — its detail
                        // opens in the right-hand pane (see nativeTailContent).
                        ForEach(displayedRows) { row in
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
                                },
                                onFoldOut: { expanded in
                                    if expanded {
                                        foldedOutTurnId = row.id
                                    } else if foldedOutTurnId == row.id {
                                        foldedOutTurnId = nil
                                    }
                                }
                            )
                            .allowsHitTesting(tailInteractionsLive)
                            .id(row.id)
                        }
                    }
                    .padding(.bottom, size == .large ? 14 : 8)
                    .animation(
                        motionActive ? nil : .spring(response: 0.26, dampingFraction: 0.86, blendDuration: 0.06),
                        value: displayMotionKey
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
                .onChange(of: sourceMotionKey) { _, _ in
                    // Don't let a folded-out id latch if its row rolled off /
                    // was filtered away — that would freeze follow-mode scroll.
                    pruneStreamState(to: allRowsSnapshot)
                    if let folded = foldedOutTurnId,
                       !currentRows.contains(where: { $0.id == folded }) {
                        foldedOutTurnId = nil
                    }
                    if motionActive {
                        absorbRowsWithoutFresh(allRowsSnapshot)
                        return
                    }
                    stageFreshRows(allRowsSnapshot)
                }
                .onChange(of: displayMotionKey) { _, _ in
                    guard !motionActive else { return }
                    // Hold position while a turn row is folded out for reading —
                    // don't yank the stream to the bottom under the pointer.
                    guard following, foldedOutTurnId == nil, let last = displayedRows.last?.id else { return }
                    withAnimation(.easeOut(duration: 0.16)) {
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
            primeMotionState(allRowsSnapshot)
        }
    }

    private func visibleRows(from rows: [TailRowModel]) -> [TailRowModel] {
        guard hasPrimedRows else { return rows }
        return rows.filter { row in
            seenRowIds.contains(row.id) || freshRowIds.contains(row.id)
        }
    }

    // Every recent row, unfiltered — the left rail builds its actor list from this.
    private var allRows: [TailRowModel] {
        ScoutTailContextBuilder.rows(events: tail.displayEvents(limit: 180), agents: agents)
    }

    // The centre log: all rows, or scoped to the left rail's selected actor.
    private var rows: [TailRowModel] {
        guard let key = filterKey else { return allRows }
        return allRows.filter { tailActorKey($0) == key }
    }

    // Resolve the engaged row from the *displayed* (filtered) rows only — so a
    // detail pane can never show actor A while the log is scoped to actor B.
    // Filtering away the engaged line simply closes its detail.
    private var engagedRow: TailRowModel? {
        guard let id = engage.engagedId else { return nil }
        return rows.first { $0.id == id }
    }

    private func neighbors(of row: TailRowModel) -> (TailRowModel?, TailRowModel?) {
        let arr = rows
        guard let i = arr.firstIndex(where: { $0.id == row.id }) else { return (nil, nil) }
        return (i > 0 ? arr[i - 1] : nil, i + 1 < arr.count ? arr[i + 1] : nil)
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
        freshRowIds.removeAll()
        pendingFreshRowIds.removeAll()
        revealQueue.removeAll()
        hasPrimedRows = true
    }

    private func absorbRowsWithoutFresh(_ rows: [TailRowModel]) {
        guard !rows.isEmpty else { return }
        revealTask?.cancel()
        revealTask = nil
        revealQueue.removeAll()
        pendingFreshRowIds.removeAll()
        seenRowIds.formUnion(rows.map(\.id))
        hasPrimedRows = true
        freshRowIds.removeAll()
    }

    private func stageFreshRows(_ rows: [TailRowModel]) {
        let ids = Set(rows.map(\.id))
        guard hasPrimedRows else {
            seenRowIds = ids
            hasPrimedRows = true
            return
        }

        let alreadyTracked = seenRowIds.union(freshRowIds).union(pendingFreshRowIds)
        let fresh = ids.subtracting(alreadyTracked)
        guard !fresh.isEmpty else { return }

        let orderedFresh = rows.map(\.id).filter { fresh.contains($0) }
        let overflow = max(0, orderedFresh.count - TailStreamCadence.maxPacedRows)
        let immediate = Array(orderedFresh.prefix(overflow))
        let paced = Array(orderedFresh.dropFirst(overflow))

        if !immediate.isEmpty {
            seenRowIds.formUnion(immediate)
        }

        if !paced.isEmpty {
            pendingFreshRowIds.formUnion(paced)
            revealQueue.append(contentsOf: paced)
            startRevealTask()
        }
    }

    private func startRevealTask() {
        guard revealTask == nil else { return }
        revealTask = Task { @MainActor in
            var revealedCount = 0
            while !Task.isCancelled {
                guard !revealQueue.isEmpty else {
                    revealTask = nil
                    return
                }
                let id = revealQueue.removeFirst()
                guard pendingFreshRowIds.contains(id) else { continue }
                let delay = TailStreamCadence.delayNanoseconds(after: revealedCount)
                if delay > 0 {
                    try? await Task.sleep(nanoseconds: delay)
                }
                guard !Task.isCancelled else { return }
                pendingFreshRowIds.remove(id)
                _ = withAnimation(TailStreamCadence.revealAnimation) {
                    freshRowIds.insert(id)
                }
                scheduleFreshExpiry(Set([id]))
                revealedCount += 1
            }
        }
    }

    private func scheduleFreshExpiry(_ ids: Set<String>) {
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: TailStreamCadence.freshLifetimeNanoseconds)
            seenRowIds.formUnion(ids)
            freshRowIds.subtract(ids)
        }
    }

    private func pruneStreamState(to rows: [TailRowModel]) {
        let ids = Set(rows.map(\.id))
        freshRowIds.formIntersection(ids)
        pendingFreshRowIds.formIntersection(ids)
        revealQueue.removeAll { !ids.contains($0) || !pendingFreshRowIds.contains($0) }
        if revealQueue.isEmpty {
            revealTask?.cancel()
            revealTask = nil
        }
    }
}

private enum TailStreamCadence {
    static let maxPacedRows = 18
    static let freshLifetimeNanoseconds: UInt64 = 860_000_000

    static var revealAnimation: Animation {
        .spring(response: 0.24, dampingFraction: 0.80, blendDuration: 0.04)
    }

    static func delayNanoseconds(after revealedCount: Int) -> UInt64 {
        if revealedCount == 0 { return 22_000_000 }
        if revealedCount < 6 { return 42_000_000 }
        return 24_000_000
    }
}

// MARK: - Web embed

private func hudTailEmbedURL(colorScheme: ColorScheme, hudSize: HUDSize) -> URL {
    let lanes: String = {
        switch hudSize {
        case .compact: return "sm"
        case .medium: return "md"
        case .large: return "lg"
        }
    }()
    let override = ProcessInfo.processInfo.environment["OPENSCOUT_HUD_TAIL_EMBED_URL"]?
        .trimmingCharacters(in: .whitespacesAndNewlines)
    let base = override.flatMap(URL.init(string:))
        ?? ScoutWeb.url(path: "/ops/lanes/embed")
        ?? ScoutWeb.baseURL().appending(path: "ops/lanes/embed")

    guard var components = URLComponents(url: base, resolvingAgainstBaseURL: false) else {
        return base
    }
    var items = components.queryItems ?? []
    if !items.contains(where: { $0.name == "theme" }) {
        items.append(URLQueryItem(name: "theme", value: colorScheme == .dark ? "dark" : "light"))
    }
    if !items.contains(where: { $0.name == "embed" }) {
        items.append(URLQueryItem(name: "embed", value: "hud"))
    }
    if !items.contains(where: { $0.name == "profile" }) {
        items.append(URLQueryItem(name: "profile", value: "hud.tail"))
    }
    if !items.contains(where: { $0.name == "lanes" }) {
        items.append(URLQueryItem(name: "lanes", value: lanes))
    }
    components.queryItems = items
    return components.url ?? base
}

private enum HUDTailEmbedLoadPhase: Equatable {
    case loading
    case ready
    case failed(String)
}

private struct HUDTailEmbedContent: View {
    let url: URL

    @State private var phase: HUDTailEmbedLoadPhase = .loading
    @State private var reloadToken = UUID()

    var body: some View {
        ZStack {
            HUDTailEmbedWebView(url: url, reloadToken: reloadToken, phase: $phase)
                .opacity(isFailed ? 0 : 1)

            if phase == .loading {
                TailLoadingView()
                    .transition(.opacity)
            }

            if case .failed(let message) = phase {
                TailEmbedProblemView(message: message, url: url) {
                    phase = .loading
                    reloadToken = UUID()
                }
                .transition(.opacity)
            }
        }
        .background(HUDChrome.canvas)
        .onChange(of: url) { _, _ in
            phase = .loading
        }
    }

    private var isFailed: Bool {
        if case .failed = phase { return true }
        return false
    }
}

private struct HUDTailEmbedWebView: NSViewRepresentable {
    let url: URL
    let reloadToken: UUID
    @Binding var phase: HUDTailEmbedLoadPhase

    func makeCoordinator() -> Coordinator {
        Coordinator(phase: $phase)
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = false
        webView.setValue(false, forKey: "drawsBackground")
        if #available(macOS 13.3, *) {
            webView.isInspectable = true
        }
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.currentURL != url
            || context.coordinator.reloadToken != reloadToken else { return }
        context.coordinator.currentURL = url
        context.coordinator.reloadToken = reloadToken
        phase = .loading
        webView.load(URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 30))
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        @Binding var phase: HUDTailEmbedLoadPhase
        var currentURL: URL?
        var reloadToken: UUID?

        init(phase: Binding<HUDTailEmbedLoadPhase>) {
            _phase = phase
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            setPhase(.ready)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            guard !ScoutAppError.isCancellation(error) else { return }
            setPhase(.failed(Self.message(for: error)))
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            guard !ScoutAppError.isCancellation(error) else { return }
            setPhase(.failed(Self.message(for: error)))
        }

        private func setPhase(_ next: HUDTailEmbedLoadPhase) {
            DispatchQueue.main.async { [weak self] in self?.phase = next }
        }

        private static func message(for error: Error) -> String {
            ScoutAppError.userFacing(error, connectionMessage: ScoutServicesHelper.servicesOfflineMessage)
        }
    }
}

private struct TailEmbedProblemView: View {
    let message: String
    let url: URL
    let retry: () -> Void

    var body: some View {
        VStack(spacing: 8) {
            Spacer(minLength: 24)
            HUDEyebrow(text: "LANES EMBED  ·  OFFLINE", color: HUDChrome.inkFaint)
            Text("Lanes unavailable.")
                .font(HUDType.body(15, weight: .semibold))
                .foregroundStyle(HUDChrome.ink)
            Text(message)
                .font(HUDType.body(12))
                .foregroundStyle(HUDChrome.inkMuted)
                .multilineTextAlignment(.center)
                .lineLimit(3)
                .padding(.horizontal, 32)
            Text(url.absoluteString)
                .font(HUDType.mono(9))
                .foregroundStyle(HUDChrome.inkDeep)
                .lineLimit(1)
                .truncationMode(.middle)
                .padding(.horizontal, 32)
            Button("Retry", action: retry)
                .buttonStyle(.plain)
                .font(HUDType.mono(10, weight: .bold))
                .tracking(HUDType.eyebrowMicro)
                .foregroundStyle(HUDChrome.accent)
                .padding(.top, 4)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(HUDChrome.canvas)
    }
}

// MARK: - Live meter strip

private struct TailLiveMeter: View {
    let count: Int
    let pendingCount: Int
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
                if pendingCount > 0 {
                    Text("+\(pendingCount)")
                        .font(HUDType.mono(8.5, weight: .bold))
                        .monospacedDigit()
                        .tracking(HUDType.eyebrowMicro)
                        .foregroundStyle(HUDChrome.accent.opacity(0.86))
                        .transition(.opacity.combined(with: .move(edge: .trailing)))
                }
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
    // Reports whether this row is folded out (turn message + hovered) so the
    // parent can hold the stream steady while it's being read.
    var onFoldOut: (Bool) -> Void = { _ in }

    @State private var hovered = false
    @State private var scopeHovered = false
    @State private var arrivalPhase: CGFloat = 1

    // The conversational turn boundaries — the human's message and the agent's
    // reply — as opposed to tool/output/event/system chatter. These are the
    // rows worth making legible at a glance. `.message` is excluded on purpose:
    // it's summary-derived (message/reply/sent/wire) and would band delivery
    // noise; only the true user/prompt/assistant boundaries qualify.
    private var isTurnMessage: Bool {
        switch row.kind {
        case .user, .prompt, .assistant: return true
        default: return false
        }
    }

    private var body1: Color {
        if engaged || cursored { return HUDChrome.ink }
        return (row.emphasized || isTurnMessage) ? HUDChrome.ink : HUDChrome.inkMuted
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
        let base: CGFloat = size == .compact ? 1 : 1.5
        // Turn messages get extra breathing room so they read as the spine of
        // the stream rather than another dense log line.
        return isTurnMessage ? base + 3 : base
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
                ZStack {
                    // Distinct band behind turn messages so the conversation
                    // stands out from the tool/event chatter around it.
                    if isTurnMessage {
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .fill(HUDChrome.canvasLift.opacity(0.16))
                            .padding(.horizontal, 5)
                            .padding(.vertical, 0.5)
                    }
                    if fresh {
                        TailRowArrivalWash(phase: arrivalPhase, isTurnMessage: isTurnMessage)
                    }
                    TailRowHighlight(cursored: cursored, engaged: engaged, hovered: hovered)
                }
            }
            .overlay(alignment: .bottom) {
                selectedDivider
            }
            .opacity(fresh ? 0.74 + (0.26 * Double(arrivalPhase)) : 1)
            .offset(y: fresh ? 7 * (1 - arrivalPhase) : 0)
            .scaleEffect(fresh ? 0.992 + (0.008 * arrivalPhase) : 1, anchor: .bottom)
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
            .onChange(of: hovered) { _, isHovered in
                onFoldOut(isTurnMessage && isHovered)
            }
            .onDisappear {
                // Row left the viewport / was removed — release any fold-out
                // hold it owned so follow-mode scroll can resume.
                if isTurnMessage { onFoldOut(false) }
            }
            .onTapGesture(perform: onTap)
            .onAppear {
                startArrivalIfNeeded()
            }
            .onChange(of: fresh) { _, next in
                guard next else {
                    arrivalPhase = 1
                    return
                }
                startArrivalIfNeeded()
            }
            .contextMenu {
                rowContextMenu
            }
    }

    private func startArrivalIfNeeded() {
        guard fresh else {
            arrivalPhase = 1
            return
        }
        arrivalPhase = 0
        withAnimation(.easeOut(duration: 0.58)) {
            arrivalPhase = 1
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
        // Turn messages fold out to their full text on hover — a quick read of
        // the whole prompt/reply without engaging the detail pane. Everything
        // else stays a single dense line.
        Text(styledLine(row.line, base: body1, mono: HUDType.mono(fontSize)))
            .lineLimit(isTurnMessage && hovered ? 10 : 1)
            .truncationMode(lineTruncation)
            .frame(maxWidth: .infinity, alignment: .leading)
            .layoutPriority(1)
            .animation(.easeOut(duration: 0.12), value: hovered)
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
        if fresh {
            Rectangle()
                .fill(HUDChrome.accent.opacity(0.34 - (0.12 * Double(arrivalPhase))))
                .frame(width: 1.5)
                .transition(.opacity)
        }
    }

    @ViewBuilder
    private var rowContextMenu: some View {
        Button("Message session") {
            stageMessageTarget(for: row)
        }
        .disabled(!row.hasSession)
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

private struct TailRowArrivalWash: View {
    let phase: CGFloat
    let isTurnMessage: Bool

    var body: some View {
        GeometryReader { proxy in
            let width = max(proxy.size.width, 1)
            let lift = max(0, 1 - phase)
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: isTurnMessage ? 4 : 2, style: .continuous)
                    .fill(HUDChrome.accentWhisper.opacity(0.35 + (0.45 * Double(lift))))
                LinearGradient(
                    colors: [
                        Color.clear,
                        HUDChrome.accent.opacity(0.16 * Double(lift)),
                        HUDChrome.ink.opacity(0.055 * Double(lift)),
                        Color.clear,
                    ],
                    startPoint: .leading,
                    endPoint: .trailing
                )
                .frame(width: min(220, max(96, width * 0.34)))
                .offset(x: ((width + 220) * phase) - 220)
            }
        }
        .allowsHitTesting(false)
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
    var onMessageSession: (() -> Void)?

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
                    TailDetailActionLink(label: "MESSAGE SESSION", compact: true) {
                        onMessageSession?()
                    }
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

// MARK: - Active-agents rail (wide deck companion)
//
// The right-hand companion to the firehose at .large. The roster is built FROM
// the firehose, not a static /api/agents snapshot: by definition, whoever is
// emitting events right now is a live agent — the broker's `state` field reads
// "available" even for sessions that are mid-turn, so it lies. Actors are
// deduped by identity, sorted most-recent-first, and tiered by how fresh their
// last event is: live (pulsing) → recent → idle. Click a row to open the agent
// or its session.

enum HUDTailRail {
    static let width: CGFloat = 308
    static let filterMinWidth: CGFloat = 620    // show the left filter past this width
    static let detailMinWidth: CGFloat = 700    // engaged-line detail fits beside a readable log (real .large width is ≥860)
    static let liveWindow: TimeInterval = 90    // pulsing "moving right now"
    static let recentWindow: TimeInterval = 600 // still counts as present (10m)
    static let activeWindow: TimeInterval = 120 // counted in the header tally
}

enum HUDTailDetail {
    static let width: CGFloat = 360
}

// Stable identity key for an actor across the firehose. Single source of truth
// shared by the left-rail list and the centre-log filter, so a selection always
// matches the rows it scopes to.
func tailActorKey(_ row: ScoutTailRowContext) -> String {
    row.agentId ?? row.agentHandle ?? (row.sessionId.isEmpty ? row.source : row.sessionId)
}

private struct TailRailActor: Identifiable {
    let id: String
    let displayName: String
    let harness: String?
    let lastTs: TimeInterval
    let lastSummary: String
    let agentId: String?
    let sessionId: String
    let conversationId: String?

    var age: TimeInterval {
        let then = ScoutRelativeTime.date(lastTs) ?? Date(timeIntervalSince1970: 0)
        return max(0, Date().timeIntervalSince(then))
    }
}

// The one-line "what they're doing" summary for a firehose row — prefer the
// rendered line, fall back to the raw event summary.
private func railSummary(for row: ScoutTailRowContext) -> String {
    let line = row.line.trimmingCharacters(in: .whitespacesAndNewlines)
    if !line.isEmpty { return line }
    return row.event.summary.trimmingCharacters(in: .whitespacesAndNewlines)
}

// Collapse the recent firehose into one entry per distinct actor. Key priority:
// agent id → handle → session → raw source, so a session's tool/output spam
// folds into a single live row.
private func buildTailRailActors(from rows: [ScoutTailRowContext]) -> [TailRailActor] {
    var byKey: [String: TailRailActor] = [:]
    var order: [String] = []
    for row in rows {
        let key = tailActorKey(row)
        let harness = row.provider.trimmingCharacters(in: .whitespaces).isEmpty ? nil : row.provider
        if let existing = byKey[key] {
            // Keep the freshest event's summary as the actor's headline.
            let newer = row.event.ts >= existing.lastTs
            byKey[key] = TailRailActor(
                id: key,
                displayName: existing.displayName,
                harness: existing.harness ?? harness,
                lastTs: max(existing.lastTs, row.event.ts),
                lastSummary: newer ? railSummary(for: row) : existing.lastSummary,
                agentId: existing.agentId ?? row.agentId,
                sessionId: existing.sessionId.isEmpty ? row.sessionId : existing.sessionId,
                conversationId: existing.conversationId ?? row.conversationId
            )
        } else {
            order.append(key)
            let name = row.agentName
                ?? row.agentHandle
                ?? (row.sessionId.isEmpty ? row.source : row.event.sessionShortLabel)
            byKey[key] = TailRailActor(
                id: key,
                displayName: name,
                harness: harness,
                lastTs: row.event.ts,
                lastSummary: railSummary(for: row),
                agentId: row.agentId,
                sessionId: row.sessionId,
                conversationId: row.conversationId
            )
        }
    }
    return order.compactMap { byKey[$0] }.sorted { $0.lastTs > $1.lastTs }
}

private func railActorURL(_ actor: TailRailActor) -> URL {
    let base = ScoutWeb.baseURL()
    func rel(_ path: String) -> URL { URL(string: path, relativeTo: base)?.absoluteURL ?? base }
    func enc(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? s }
    if let aid = actor.agentId, !aid.isEmpty { return rel("/agents/\(enc(aid))") }
    if let cid = actor.conversationId, !cid.isEmpty { return rel("/c/\(enc(cid))") }
    if !actor.sessionId.isEmpty { return rel("/sessions/\(enc(actor.sessionId))") }
    return rel("/agents")
}

// LEFT zone of the LOGS view: the active participants, as a filter. Built from
// the firehose (whoever's emitting events is live), freshest first. Tapping a
// row scopes the centre log to that actor; tapping it again clears.
private struct TailActiveFilter: View {
    let rows: [ScoutTailRowContext]
    @Binding var selectedKey: String?
    var paneFill: Color = HUDChrome.canvas.opacity(0.62)

    private var actors: [TailRailActor] { buildTailRailActors(from: rows) }

    var body: some View {
        // Re-render on a slow cadence so live/recent/age stay honest even when
        // the firehose is quiet — the status tiers are derived from Date(),
        // which has no change publisher of its own.
        TimelineView(.periodic(from: Date(), by: 15)) { _ in
            rail
        }
    }

    private var rail: some View {
        let live = actors.filter { $0.age < HUDTailRail.activeWindow }.count
        return VStack(spacing: 0) {
            HStack(spacing: 6) {
                HUDEyebrow(text: "ACTIVE  ·  \(live)", color: HUDChrome.inkFaint)
                Spacer(minLength: 0)
                if selectedKey != nil {
                    Button { selectedKey = nil } label: {
                        Text("CLEAR")
                            .font(HUDType.mono(8.5, weight: .bold))
                            .tracking(HUDType.eyebrowTracking)
                            .foregroundStyle(HUDChrome.accent)
                    }
                    .buttonStyle(.plain)
                    .help("Clear filter")
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 8)
            .padding(.bottom, 7)
            .overlay(alignment: .bottom) {
                Rectangle().fill(HUDChrome.border).frame(height: 0.5)
            }

            if actors.isEmpty {
                VStack(spacing: 6) {
                    Spacer(minLength: 24)
                    HUDEyebrow(text: "WIRE  ·  QUIET", color: HUDChrome.inkFaint)
                    Text("No agents on the wire yet.")
                        .font(HUDType.body(12))
                        .foregroundStyle(HUDChrome.inkMuted)
                    Spacer()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView(.vertical, showsIndicators: false) {
                    LazyVStack(spacing: 0) {
                        ForEach(actors) { actor in
                            TailFilterRow(actor: actor, selected: selectedKey == actor.id) {
                                selectedKey = selectedKey == actor.id ? nil : actor.id
                            }
                        }
                    }
                    .padding(.bottom, 8)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        // A distinctly darker inset column so the rail reads as its own pane
        // against the firehose's lighter glass — visible even when quiet.
        .background(paneFill)
        .overlay(alignment: .trailing) {
            Rectangle().fill(HUDChrome.border).frame(width: 0.5)
        }
    }
}

private struct TailFilterRow: View {
    let actor: TailRailActor
    let selected: Bool
    var onSelect: () -> Void = {}

    @State private var hovered = false

    private var age: TimeInterval { actor.age }
    private var isLive: Bool { age < HUDTailRail.liveWindow }
    private var isRecent: Bool { age < HUDTailRail.recentWindow }

    private var nameColor: Color {
        if selected { return HUDChrome.ink }
        return isLive ? HUDChrome.ink : (isRecent ? HUDChrome.inkMuted : HUDChrome.inkFaint)
    }
    private var dotColor: Color {
        isLive ? HUDChrome.ink : (isRecent ? HUDChrome.inkMuted : HUDChrome.inkDeep)
    }
    private var rowFill: Color {
        if selected { return HUDChrome.accent.opacity(0.14) }
        if hovered { return HUDChrome.canvasLift.opacity(0.30) }
        return .clear
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 8) {
                TailRailDot(color: dotColor, filled: isRecent, pulse: isLive)

                Group {
                    if let harness = actor.harness {
                        HUDHarnessMark(
                            harness: harness,
                            size: 11,
                            tint: isLive ? HUDChrome.inkMuted : HUDChrome.inkFaint
                        )
                    }
                }
                .frame(width: 11, height: 11)

                Text(actor.displayName)
                    .font(HUDType.mono(10.5, weight: .semibold))
                    .foregroundStyle(nameColor)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .layoutPriority(1)

                Spacer(minLength: 6)

                Text(ScoutRelativeTime.format(actor.lastTs))
                    .font(HUDType.mono(8.5, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(isLive ? HUDChrome.inkMuted : HUDChrome.inkFaint)
                    .fixedSize()
            }

            // What they're doing right now — the freshest firehose line for
            // this actor, dimmed and clamped to two lines.
            if !actor.lastSummary.isEmpty {
                Text(actor.lastSummary)
                    .font(HUDType.mono(8.5))
                    .foregroundStyle(isRecent ? HUDChrome.inkMuted : HUDChrome.inkFaint)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.leading, 19)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(rowFill)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(HUDChrome.borderSoft)
                .frame(height: 0.5)
                .padding(.leading, 14)
        }
        .contentShape(Rectangle())
        .onHover { hovered = $0 }
        .onTapGesture(perform: onSelect)
        .help(selected ? "Showing only \(actor.displayName) — tap to clear" : "Filter log to \(actor.displayName)")
        .contextMenu {
            Button("Open agent / session") { NSWorkspace.shared.open(railActorURL(actor)) }
            if let aid = actor.agentId, !aid.isEmpty {
                Button("Copy agent ID") { copyToPasteboard(aid) }
            }
            if !actor.sessionId.isEmpty {
                Button("Copy session ID") { copyToPasteboard(actor.sessionId) }
            }
        }
    }
}

// The state dot: a filled ink mark for live agents (with a slow breathing halo
// while working), a hollow ring for everything that's resting.
private struct TailRailDot: View {
    let color: Color
    let filled: Bool
    let pulse: Bool

    @State private var phase: CGFloat = 0

    var body: some View {
        ZStack {
            if pulse {
                Circle()
                    .fill(color.opacity(0.22 * (1 - phase)))
                    .frame(width: 11, height: 11)
                    .scaleEffect(0.6 + 0.4 * phase)
            }
            if filled {
                Circle().fill(color).frame(width: 6, height: 6)
            } else {
                Circle().strokeBorder(color, lineWidth: 1).frame(width: 6, height: 6)
            }
        }
        .frame(width: 11, height: 11)
        .onAppear {
            guard pulse else { return }
            withAnimation(.easeOut(duration: 1.6).repeatForever(autoreverses: false)) {
                phase = 1
            }
        }
    }
}

private struct TailDetailActionLink: View {
    let label: String
    var compact = false
    let action: () -> Void

    @State private var hovered = false

    private var arrowSize: CGFloat { compact ? 9 : 11 }
    private var labelSize: CGFloat { compact ? 8.5 : 10 }
    private var horizontalPadding: CGFloat { compact ? 4 : 6 }
    private var verticalPadding: CGFloat { compact ? 2 : 4 }

    var body: some View {
        Button(action: action) {
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
        .help(label)
    }
}

// RIGHT zone of the LOGS view: the engaged line's detail. Replaces the old
// inline expansion — clicking a log line opens its detail here, with its
// neighbours for context.
private struct TailEngagedDetail: View {
    let row: ScoutTailRowContext
    let prev: ScoutTailRowContext?
    let next: ScoutTailRowContext?
    var paneFill: Color = HUDChrome.canvas.opacity(0.62)
    var onMessageSession: () -> Void = {}
    var onClose: () -> Void = {}

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                HUDEyebrow(text: "LINE  ·  DETAIL", color: HUDChrome.inkFaint)
                Spacer(minLength: 0)
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 9, weight: .bold))
                }
                .buttonStyle(.plain)
                .foregroundStyle(HUDChrome.inkFaint)
                .help("Close detail (Esc)")
            }
            .padding(.horizontal, 14)
            .padding(.top, 8)
            .padding(.bottom, 7)
            .overlay(alignment: .bottom) {
                Rectangle().fill(HUDChrome.border).frame(height: 0.5)
            }

            ScrollView(.vertical, showsIndicators: false) {
                TailDetailInline(
                    row: row,
                    prev: prev,
                    next: next,
                    size: .medium,
                    onMessageSession: onMessageSession
                )
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(paneFill)
        .overlay(alignment: .leading) {
            Rectangle().fill(HUDChrome.border).frame(width: 0.5)
        }
    }
}
