import AppKit
import HudsonUI
import ScoutAppCore
import SwiftUI

/// The firehose's data type. JetBrains Mono — a code-grade face with a tall
/// x-height and true tabular figures — reads cleaner than SF Mono for a dense
/// stream of timestamps, ids, and tool calls. Falls back to the system
/// monospaced face when JBM isn't installed, so it degrades gracefully.
enum ScoutTailFont {
    private static let hasJBM = NSFont(name: "JetBrains Mono", size: 12) != nil

    static func mono(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        hasJBM
            ? .custom("JetBrains Mono", size: size).weight(weight)
            : .system(size: size, weight: weight, design: .monospaced)
    }

    /// Title face — Space Grotesk, bundled in the app (Contents/Resources/Fonts,
    /// auto-registered via ATSApplicationFontsPath). A grotesk gives the screen
    /// titles a designed character the system face can't. Falls back to the
    /// system face when the bundled font isn't registered (e.g. SwiftUI preview).
    /// Resolves whichever name the variable font registers under.
    private static let groteskName: String? = {
        for name in ["Space Grotesk", "SpaceGrotesk-Regular", "Space Grotesk Light", "SpaceGrotesk-Light"] {
            if NSFont(name: name, size: 12) != nil { return name }
        }
        return nil
    }()

    static func display(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        if let groteskName {
            return .custom(groteskName, size: size).weight(weight)
        }
        return .system(size: size, weight: weight, design: .default)
    }
}

private enum ScoutTailViewMode: String, CaseIterable, Identifiable {
    case ledger
    case timeline

    var id: String { rawValue }

    var title: String {
        switch self {
        case .ledger: return "Ledger"
        case .timeline: return "Timeline"
        }
    }
}

struct ScoutTailContent: View {
    @ObservedObject var tail: ScoutTailStore
    let agents: [ScoutAgent]
    /// Open the full session for a tail event in the slide-out web viewer.
    let onOpenSession: (ScoutTailEvent) -> Void
    /// Open the native observe surface for a session-matched agent.
    let onOpenAgent: (ScoutAgent) -> Void

    @State private var selectedEventId: String?

    // Column widths persist across launches so a tuned firehose stays tuned.
    @AppStorage("scout.tail.col.time") private var colTime: Double = 60
    @AppStorage("scout.tail.col.identity") private var colIdentity: Double = 168
    @AppStorage("scout.tail.col.kind") private var colKind: Double = 28

    // The row treatment: Ledger (ruled columnar table) or Timeline (a
    // chronological spine). Persisted so a chosen rhythm sticks.
    @AppStorage("scout.tail.viewMode") private var viewModeRaw: String = ScoutTailViewMode.ledger.rawValue
    private var viewMode: ScoutTailViewMode { ScoutTailViewMode(rawValue: viewModeRaw) ?? .ledger }
    private var viewModeBinding: Binding<ScoutTailViewMode> {
        Binding(get: { viewMode }, set: { viewModeRaw = $0.rawValue })
    }

    private var columnLayout: ScoutTailColumnLayout {
        ScoutTailColumnLayout(time: CGFloat(colTime), identity: CGFloat(colIdentity), kind: CGFloat(colKind))
    }

    private var timeWidth: Binding<CGFloat> {
        Binding(get: { CGFloat(colTime) }, set: { colTime = Double($0) })
    }
    private var identityWidth: Binding<CGFloat> {
        Binding(get: { CGFloat(colIdentity) }, set: { colIdentity = Double($0) })
    }
    private var kindWidth: Binding<CGFloat> {
        Binding(get: { CGFloat(colKind) }, set: { colKind = Double($0) })
    }

    private var visibleEvents: [ScoutTailEvent] {
        tail.filteredEvents
    }

    private var latestEvent: ScoutTailEvent? {
        visibleEvents.last
    }

    private var agentsBySessionId: [String: ScoutAgent] {
        var result: [String: ScoutAgent] = [:]
        for agent in agents {
            guard let key = scoutTailCopyable(agent.harnessSessionId) else { continue }
            if result[key] == nil || agent.state == .working {
                result[key] = agent
            }
        }
        return result
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            if let summary = tail.activeFilterSummary {
                activeFilterBanner(summary)
            }
            if let error = tail.lastError {
                errorBanner(error)
            }
            stream
            tailSignalFooter
        }
        .background(ScoutDesign.bg)
    }

    /// One minimal header band, shared in spirit across Tail/Agents/Repos:
    /// a grotesk title (no glyph, no lead dot), a quiet status line, then a
    /// single row of controls. No two-tier stack — the stream gets the rest.
    private var header: some View {
        ScoutColumnHeader(horizontalPadding: ScoutTailMetrics.pageGutter) {
            titleRow
        } secondary: {
            EmptyView()
        } trailing: {
            commandStrip
        }
    }

    private var titleRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.md) {
            Text("Tail")
                .font(ScoutTailFont.display(HudTextSize.xl, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)

            statusLine

            if tail.isLoading {
                ScoutBrailleSpinner(size: HudTextSize.sm, tint: ScoutPalette.dim)
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    /// Quiet inventory read-out beside the title: tabular figures, lowercase
    /// units, hairline middots — a status line that recedes behind the title,
    /// not a banner. No throughput or "live" rate; the stream is the liveness.
    private var statusLine: some View {
        let logs = tail.discovery?.totals.transcripts ?? tail.sessionCount
        let procs = tail.discovery?.totals.total ?? 0
        let sessions = tail.sessionCount
        return Text("\(logs) logs · \(procs) procs · \(sessions) sessions")
            .font(ScoutTailFont.mono(HudTextSize.xs, weight: .medium))
            .foregroundStyle(ScoutPalette.dim)
            .monospacedDigit()
            .lineLimit(1)
    }

    private func activeFilterBanner(_ summary: String) -> some View {
        HStack(spacing: HudSpacing.sm) {
            Text("Filtered")
                .font(ScoutTailFont.mono(HudTextSize.micro, weight: .bold))
                .foregroundStyle(ScoutPalette.dim)
            Text(summary)
                .font(ScoutTailFont.mono(HudTextSize.xs, weight: .medium))
                .foregroundStyle(ScoutPalette.muted)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 0)
            Text("\(visibleEvents.count) events")
                .font(ScoutTailFont.mono(HudTextSize.xs, weight: .semibold))
                .foregroundStyle(ScoutPalette.dim)
                .monospacedDigit()
            Button("Clear") {
                tail.clearFilters()
            }
            .buttonStyle(.plain)
            .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
            .foregroundStyle(ScoutPalette.muted)
            .scoutPointerCursor()
        }
        .padding(.horizontal, ScoutTailMetrics.pageGutter)
        .frame(height: 26)
        .background(ScoutPalette.accentSoft.opacity(0.45))
        .overlay(alignment: .bottom) {
            HudDivider(color: ScoutDesign.hairline)
        }
    }

    private var sourceMenu: some View {
        ScoutTailFilterMenu(
            value: tail.selectedSource ?? "All sources",
            width: 148
        ) {
            Button {
                tail.selectedSource = nil
            } label: {
                Text(tail.selectedSource == nil ? "✓ all" : "all")
            }
            if !tail.sourceCounts.isEmpty {
                Divider()
                ForEach(tail.sourceCounts) { entry in
                    Button {
                        tail.selectedSource = tail.selectedSource == entry.label ? nil : entry.label
                    } label: {
                        Text(tail.selectedSource == entry.label ? "✓ \(entry.label)" : entry.label)
                    }
                }
            }
        }
        .help("Filter by source")
    }

    /// One row of controls, right-aligned: search, the source filter, then the
    /// view + follow toggles and the icon actions. Everything the old two-tier
    /// header spread across two rows, kept on a single line.
    private var commandStrip: some View {
        HStack(spacing: HudSpacing.sm) {
            ScoutTailSearchField(text: $tail.query)
                .frame(width: 210)

            sourceMenu

            ScoutTailHeaderDivider()

            ScoutTailModeToggle(mode: viewModeBinding)

            ScoutTailGhostButton(
                title: tail.isFollowing ? "Pause" : "Follow",
                icon: tail.isFollowing ? "pause.fill" : "play.fill"
            ) {
                tail.isFollowing.toggle()
            }

            ScoutTailHeaderDivider()

            ScoutTailIconButton(title: "Refresh", icon: "arrow.clockwise") {
                tail.refresh()
            }

            ScoutTailIconButton(title: "Open in web", icon: "safari") {
                ScoutWeb.open(path: "/ops/tail")
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    private func errorBanner(_ error: String) -> some View {
        HStack(spacing: HudSpacing.sm) {
            Text("✕")
                .font(ScoutTailFont.mono(HudTextSize.xs, weight: .bold))
            Text(error)
                .font(ScoutTailFont.mono(HudTextSize.xxs, weight: .medium))
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 0)
        }
        .foregroundStyle(ScoutPalette.muted)
        .padding(.horizontal, ScoutTailMetrics.pageGutter)
        .frame(height: 20)
        .background(ScoutDesign.bg)
        .overlay(alignment: .bottom) {
            HudDivider(color: ScoutDesign.hairline)
        }
    }

    private var tailSignalFooter: some View {
        HStack(spacing: HudSpacing.md) {
            Text(tail.isFollowing ? "●" : "○")
                .font(ScoutTailFont.mono(HudTextSize.xs, weight: .bold))
                .foregroundStyle(ScoutPalette.dim)

            Text(tail.isFollowing ? "follow" : "paused")
                .font(ScoutTailFont.mono(HudTextSize.xxs, weight: .semibold))
                .foregroundStyle(ScoutPalette.muted)

            Text("+\(tail.lastBatchCount)")
                .font(ScoutTailFont.mono(HudTextSize.xxs, weight: .semibold))
                .foregroundStyle(tail.lastBatchCount > 0 ? ScoutPalette.muted : ScoutPalette.dim)
                .monospacedDigit()

            if let latestEvent {
                Text(latestEvent.clockLabel)
                    .font(ScoutTailFont.mono(HudTextSize.xxs, weight: .medium))
                    .foregroundStyle(ScoutPalette.dim)
                    .monospacedDigit()
                Text(latestEvent.sourceLabel)
                    .font(ScoutTailFont.mono(HudTextSize.xxs, weight: .medium))
                    .foregroundStyle(ScoutPalette.dim)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            Text("\(visibleEvents.count)/\(tail.bufferedEventCount) buf")
                .font(ScoutTailFont.mono(HudTextSize.xxs, weight: .semibold))
                .foregroundStyle(ScoutPalette.dim)
                .monospacedDigit()
        }
        .padding(.horizontal, ScoutTailMetrics.pageGutter)
        .frame(height: 22)
        .background(ScoutDesign.bg)
        .overlay(alignment: .top) {
            HudDivider(color: ScoutDesign.hairline)
        }
    }

    @ViewBuilder
    private var stream: some View {
        if tail.isLoading && visibleEvents.isEmpty {
            // First paint: column structure immediately, then one clearly-moving
            // braille spinner (it cycles, so the wait reads as working, not
            // stuck) over a quiet "what's happening" line. Rows replace it the
            // moment the fetch lands.
            VStack(spacing: 0) {
                if viewMode == .ledger {
                    ScoutTailHeaderRow(
                        timeWidth: timeWidth,
                        identityWidth: identityWidth,
                        kindWidth: kindWidth
                    )
                }
                tailLoadingState
            }
        } else if visibleEvents.isEmpty {
            VStack(spacing: HudSpacing.xs) {
                Text(tail.hasBufferedEvents ? "— quiet metadata —" : "— no events —")
                    .font(ScoutTailFont.mono(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(ScoutPalette.dim)
                Text(tail.hasBufferedEvents ? "show transcript metadata to inspect it" : "harness stream is quiet")
                    .font(ScoutTailFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutPalette.dim.opacity(0.8))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(ScoutTailMetrics.pageGutter)
        } else {
            VStack(spacing: 0) {
                if viewMode == .ledger {
                    ScoutTailHeaderRow(
                        timeWidth: timeWidth,
                        identityWidth: identityWidth,
                        kindWidth: kindWidth
                    )
                }

                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(visibleEvents) { event in
                                Group {
                                    if viewMode == .ledger {
                                        ScoutTailRow(
                                            event: event,
                                            columns: columnLayout,
                                            activeAgent: activeAgent(for: event),
                                            isSelected: selectedEventId == event.id,
                                            onOpenSession: { onOpenSession(event) },
                                            onOpenAgent: { agent in onOpenAgent(agent) }
                                        ) {
                                            selectedEventId = selectedEventId == event.id ? nil : event.id
                                        }
                                    } else {
                                        ScoutTailTimelineRow(
                                            event: event,
                                            activeAgent: activeAgent(for: event),
                                            isSelected: selectedEventId == event.id,
                                            isFirst: event.id == visibleEvents.first?.id,
                                            onOpenSession: { onOpenSession(event) },
                                            onOpenAgent: { agent in onOpenAgent(agent) }
                                        ) {
                                            selectedEventId = selectedEventId == event.id ? nil : event.id
                                        }
                                    }
                                }
                                .id(event.id)

                                if selectedEventId == event.id {
                                    ScoutTailDetail(
                                        event: event,
                                        activeAgent: activeAgent(for: event),
                                        onOpenSession: { onOpenSession(event) },
                                        onOpenAgent: { agent in onOpenAgent(agent) }
                                    )
                                    .transition(.opacity.combined(with: .move(edge: .top)))
                                }
                            }
                        }
                        .padding(.bottom, HudSpacing.xxl)
                        .frame(maxWidth: .infinity)
                        .scoutOverlayScrollers()
                    }
                    .scrollIndicators(.visible)
                    .onChange(of: visibleEvents.count) { _, _ in
                        guard tail.isFollowing, let last = visibleEvents.last else { return }
                        withAnimation(.easeOut(duration: 0.16)) {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                    }
                    .onAppear {
                        guard tail.isFollowing, let last = visibleEvents.last else { return }
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }
        }
    }

    /// First-load affordance: a single, visibly-cycling braille spinner over a
    /// quiet status line. Animation = "working"; the old pulsing ghost rows read
    /// as a frozen, broken table.
    private var tailLoadingState: some View {
        VStack(spacing: HudSpacing.md) {
            ScoutBrailleSpinner(size: 20, tint: ScoutPalette.accent)
            VStack(spacing: HudSpacing.xxs) {
                Text("Reading the firehose")
                    .font(ScoutTailFont.mono(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(ScoutPalette.muted)
                Text("scanning transcripts + live processes")
                    .font(ScoutTailFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutPalette.dim)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func activeAgent(for event: ScoutTailEvent) -> ScoutAgent? {
        scoutTailCopyable(event.sessionId).flatMap { agentsBySessionId[$0] }
    }
}

struct ScoutTailInspector: View {
    @ObservedObject var tail: ScoutTailStore
    @State private var facet: ScoutTailFacet = .source

    private var visibleCount: Int {
        tail.filteredEvents.count
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: HudSpacing.xl) {
                filterSummary
                ScoutTailDistributionPanel(tail: tail, facet: $facet)
                metadataToggle
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .scoutOverlayScrollers()
        }
        .scrollIndicators(.visible)
    }

    private var filterSummary: some View {
        // The inspector shell already renders the "Distribution" eyebrow, so the
        // body leads with guidance + counts instead of repeating the title.
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            Text("Click a row to filter the table.")
                .font(HudFont.ui(HudTextSize.xs))
                .foregroundStyle(ScoutPalette.dim)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: HudSpacing.sm) {
                Text("\(visibleCount) shown")
                    .font(ScoutTailFont.mono(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(ScoutPalette.muted)
                    .monospacedDigit()
                Text("·")
                    .foregroundStyle(ScoutPalette.dim)
                Text("\(tail.bufferedEventCount) buffered")
                    .font(ScoutTailFont.mono(HudTextSize.xs))
                    .foregroundStyle(ScoutPalette.dim)
                    .monospacedDigit()
                Spacer(minLength: 0)
                if tail.hasActiveFilters {
                    Button("Clear") {
                        tail.clearFilters()
                    }
                    .buttonStyle(.plain)
                    .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(ScoutPalette.muted)
                    .scoutPointerCursor()
                }
            }
        }
    }

    private var metadataToggle: some View {
        Toggle(isOn: $tail.showMetadata) {
            Text("Show transcript metadata")
                .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                .foregroundStyle(ScoutPalette.muted)
        }
        .toggleStyle(.checkbox)
    }
}

private enum ScoutTailFacet: String, CaseIterable, Identifiable {
    case source
    case origin
    case kind
    case project

    var id: String { rawValue }

    var title: String {
        switch self {
        case .source: return "Sources"
        case .origin: return "Origins"
        case .kind: return "Kinds"
        case .project: return "Projects"
        }
    }
}

private struct ScoutTailDistributionPanel: View {
    @ObservedObject var tail: ScoutTailStore
    @Binding var facet: ScoutTailFacet

    private var items: [ScoutTailCount] {
        switch facet {
        case .source: return tail.sourceCounts
        case .origin: return tail.originCounts
        case .kind: return tail.kindCounts
        case .project: return Array(tail.projectCounts.prefix(10))
        }
    }

    private var total: Int {
        items.reduce(0) { $0 + $1.count }
    }

    var body: some View {
        // The facet switch IS the heading (Sources / Origins / Kinds / Projects),
        // and the inspector eyebrow already reads "Distribution", so the panel
        // leads straight with the tabs — no repeated title, no duplicate total
        // (the lead row already carries the buffered count).
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            ScoutTailFacetTabs(selection: $facet)

            if items.isEmpty {
                Text("No events yet")
                    .font(HudFont.ui(HudTextSize.xs))
                    .foregroundStyle(ScoutPalette.dim)
                    .padding(.top, HudSpacing.xs)
            } else {
                VStack(spacing: HudSpacing.xxs) {
                    ForEach(items) { item in
                        ScoutTailDistributionRow(
                            label: item.label,
                            count: item.count,
                            total: max(total, 1),
                            active: isActive(item.label),
                            onSelect: { toggle(item.label) }
                        )
                    }
                }
                .padding(.top, HudSpacing.xxs)
            }
        }
    }

    private func isActive(_ label: String) -> Bool {
        switch facet {
        case .source: return tail.selectedSource == label
        case .origin: return tail.selectedOrigin == label
        case .kind: return tail.selectedKind?.title == label
        case .project: return tail.selectedProject == label
        }
    }

    private func toggle(_ label: String) {
        switch facet {
        case .source:
            tail.selectedSource = tail.selectedSource == label ? nil : label
        case .origin:
            tail.selectedOrigin = tail.selectedOrigin == label ? nil : label
        case .kind:
            guard let kind = ScoutTailEventKind.allCases.first(where: { $0.title == label }) else { return }
            tail.selectedKind = tail.selectedKind == kind ? nil : kind
        case .project:
            tail.selectedProject = tail.selectedProject == label ? nil : label
        }
    }
}

private struct ScoutTailFacetTabs: View {
    @Binding var selection: ScoutTailFacet

    var body: some View {
        HStack(spacing: HudSpacing.xxs) {
            ForEach(ScoutTailFacet.allCases) { facet in
                let isOn = selection == facet
                Button {
                    selection = facet
                } label: {
                    Text(facet.title)
                        .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                        .foregroundStyle(isOn ? ScoutPalette.ink : ScoutPalette.muted)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity)
                        .frame(height: 24)
                        .background(
                            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                                .fill(isOn ? ScoutDesign.bg : Color.clear)
                                .shadow(color: isOn ? Color.black.opacity(0.12) : .clear, radius: 1, y: 1)
                        )
                }
                .buttonStyle(.plain)
                .scoutPointerCursor()
            }
        }
        .padding(HudSpacing.xxs)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .fill(ScoutSurface.inset)
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.standard)
        )
    }
}

private struct ScoutTailDistributionRow: View {
    let label: String
    let count: Int
    let total: Int
    let active: Bool
    let onSelect: () -> Void

    @State private var isHovering = false

    private var share: CGFloat {
        CGFloat(count) / CGFloat(max(total, 1))
    }

    private var percent: Int {
        Int((share * 100).rounded())
    }

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: HudSpacing.sm) {
                Text(label)
                    .font(ScoutTailFont.mono(HudTextSize.xs, weight: active ? .bold : .semibold))
                    .foregroundStyle(active ? ScoutPalette.accent : ScoutPalette.muted)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .frame(width: 72, alignment: .leading)

                GeometryReader { proxy in
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(ScoutSurface.inset)
                        Capsule()
                            .fill(active ? ScoutPalette.accent : ScoutPalette.accent.opacity(0.32))
                            .frame(width: max(4, proxy.size.width * share))
                    }
                }
                .frame(height: 5)

                HStack(spacing: HudSpacing.xxs) {
                    Text("\(count)")
                        .font(ScoutTailFont.mono(HudTextSize.xs, weight: .semibold))
                        .foregroundStyle(active ? ScoutPalette.accent : ScoutPalette.muted)
                        .monospacedDigit()
                        .frame(width: 26, alignment: .trailing)
                    Text("\(percent)%")
                        .font(ScoutTailFont.mono(HudTextSize.micro))
                        .foregroundStyle(ScoutPalette.dim)
                        .monospacedDigit()
                        .frame(width: 28, alignment: .trailing)
                }
            }
            .padding(.horizontal, HudSpacing.sm)
            .padding(.vertical, HudSpacing.xs)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                    .fill(rowBackground)
            )
        }
        .buttonStyle(.plain)
        .scoutPointerCursor()
        .onHover { isHovering = $0 }
    }

    private var rowBackground: Color {
        if active { return ScoutPalette.accentSoft.opacity(0.65) }
        if isHovering { return ScoutSurface.hover.opacity(0.5) }
        return Color.clear
    }
}

private struct ScoutTailHeaderRow: View {
    @Binding var timeWidth: CGFloat
    @Binding var identityWidth: CGFloat
    @Binding var kindWidth: CGFloat

    var body: some View {
        // spacing: 0 — each inter-column gap IS the drag handle, sized to the
        // row's columnGap so header labels stay column-aligned with the rows.
        HStack(spacing: 0) {
            label("TIME").frame(width: timeWidth, alignment: .leading)
            handle($timeWidth, ScoutTailColumns.timeRange)
            // Kind is a glyph in the rows — the header column stays unlabeled so
            // the table doesn't shout a word the rows deliberately dropped.
            label("").frame(width: kindWidth, alignment: .leading)
            handle($kindWidth, ScoutTailColumns.kindRange)
            label("SOURCE").frame(width: identityWidth, alignment: .leading)
            handle($identityWidth, ScoutTailColumns.identityRange)
            label("ACTION").frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(ScoutTailFont.mono(HudTextSize.xxs, weight: .semibold))
        .tracking(ScoutTailMetrics.headerTracking)
        .foregroundStyle(ScoutPalette.dim)
        .padding(.horizontal, ScoutTailMetrics.pageGutter)
        .frame(height: 24)
        .background(ScoutDesign.chrome)
        .overlay(alignment: .bottom) {
            HudDivider(color: ScoutDesign.hairlineStrong)
        }
    }

    private func label(_ title: String) -> some View {
        Text(title)
    }

    /// A draggable column boundary that lives inside the inter-column gap. The
    /// hit zone is the full gap width; the hairline reveals on hover and the
    /// cursor flips to resize-left-right (handled by HudResizableDivider's NSView).
    private func handle(_ width: Binding<CGFloat>, _ range: ClosedRange<CGFloat>) -> some View {
        HudResizableDivider(
            width: width,
            placement: .trailing,
            range: range,
            hitWidth: ScoutTailMetrics.columnGap,
            hairlinePlacement: .center
        )
        .frame(height: 24)
    }
}

/// One Ledger row: time · kind glyph · avatar+identity · action, in the
/// resizable columns. Color lives only in the kind glyph and the agent's sprite;
/// everything else is neutral ink graded by emphasis. A hairline rules each row
/// (the approved Ledger rhythm — no zebra, no left accent bar).
private struct ScoutTailRow: View {
    let event: ScoutTailEvent
    let columns: ScoutTailColumnLayout
    let activeAgent: ScoutAgent?
    let isSelected: Bool
    let onOpenSession: () -> Void
    let onOpenAgent: (ScoutAgent) -> Void
    let action: () -> Void

    @State private var isHovering = false
    private var emphasized: Bool { isSelected || isHovering }

    var body: some View {
        HStack(alignment: .center, spacing: ScoutTailMetrics.columnGap) {
            ScoutTailTimeCell(event: event, emphasized: emphasized)
                .frame(width: columns.time, alignment: .leading)

            ScoutTailKindGlyph(kind: event.kind)
                .frame(width: columns.kind, alignment: .leading)

            ScoutTailIdentityCell(event: event, activeAgent: activeAgent, emphasized: emphasized, onOpenAgent: onOpenAgent)
                .frame(width: columns.identity, alignment: .leading)

            ScoutTailActionText(event: event, emphasized: emphasized)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, ScoutTailMetrics.pageGutter)
        .frame(minHeight: ScoutTailMetrics.rowHeight)
        .background { rowBackground }
        .overlay(alignment: .bottom) { HudDivider(color: ScoutDesign.hairline) }
        .contentShape(Rectangle())
        .onTapGesture(perform: action)
        .scoutPointerCursor()
        .onHover { isHovering = $0 }
        .scoutTailRowMenu(event: event, activeAgent: activeAgent, onOpenSession: onOpenSession, onOpenAgent: onOpenAgent)
    }

    @ViewBuilder
    private var rowBackground: some View {
        if isSelected {
            ScoutPalette.accent.opacity(0.12)
        } else if isHovering {
            ScoutPalette.surface
        } else {
            Color.clear
        }
    }
}

/// One Timeline row: a chronological spine where each node IS the kind glyph,
/// time on the axis's left, avatar + identity + action to its right.
private struct ScoutTailTimelineRow: View {
    let event: ScoutTailEvent
    let activeAgent: ScoutAgent?
    let isSelected: Bool
    let isFirst: Bool
    let onOpenSession: () -> Void
    let onOpenAgent: (ScoutAgent) -> Void
    let action: () -> Void

    @State private var isHovering = false
    private var emphasized: Bool { isSelected || isHovering }

    var body: some View {
        HStack(alignment: .top, spacing: ScoutTailMetrics.columnGap) {
            ScoutTailTimeCell(event: event, emphasized: emphasized)
                .frame(width: 52, alignment: .leading)
                .padding(.top, 8)

            spine.frame(width: 18)

            HStack(alignment: .center, spacing: HudSpacing.sm) {
                ScoutTailIdentityCell(event: event, activeAgent: activeAgent, emphasized: emphasized, onOpenAgent: onOpenAgent)
                    .fixedSize(horizontal: true, vertical: false)
                ScoutTailActionText(event: event, emphasized: emphasized)
                Spacer(minLength: 0)
            }
            .padding(.vertical, 7)
        }
        .padding(.horizontal, ScoutTailMetrics.pageGutter)
        .background { rowBackground }
        .contentShape(Rectangle())
        .onTapGesture(perform: action)
        .scoutPointerCursor()
        .onHover { isHovering = $0 }
        .scoutTailRowMenu(event: event, activeAgent: activeAgent, onOpenSession: onOpenSession, onOpenAgent: onOpenAgent)
    }

    /// A continuous vertical axis with the kind-glyph node riding on it. The
    /// first row's line is padded down to the node so it doesn't float above
    /// the top of the stream.
    private var spine: some View {
        ZStack(alignment: .top) {
            Rectangle()
                .fill(ScoutDesign.hairlineStrong)
                .frame(width: 1)
                .frame(maxHeight: .infinity)
                .padding(.top, isFirst ? 13 : 0)
            node.padding(.top, 4)
        }
        .frame(maxHeight: .infinity)
    }

    private var node: some View {
        ZStack {
            Circle().fill(ScoutPalette.surface)
            Circle().strokeBorder(ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin)
            ScoutTailKindGlyph(kind: event.kind, size: 10)
        }
        .frame(width: 18, height: 18)
    }

    @ViewBuilder
    private var rowBackground: some View {
        if isSelected {
            ScoutPalette.accent.opacity(0.12)
        } else if isHovering {
            ScoutPalette.surface
        } else {
            Color.clear
        }
    }
}

/// The clock split into a brighter HH:mm and a recessive :ss so the timestamp
/// reads as a designed numeral. Tabular figures keep every colon aligned.
private struct ScoutTailTimeCell: View {
    let event: ScoutTailEvent
    let emphasized: Bool

    var body: some View {
        let clock = event.clockLabel
        let cut = clock.index(clock.startIndex, offsetBy: min(5, clock.count))
        let color = emphasized ? ScoutPalette.muted : ScoutPalette.dim
        return HStack(spacing: 0) {
            Text(String(clock[..<cut])).foregroundStyle(color)
            Text(String(clock[cut...])).foregroundStyle(color.opacity(0.5))
        }
        .font(ScoutTailFont.mono(HudTextSize.xs, weight: .medium))
        .monospacedDigit()
        .lineLimit(1)
    }
}

/// One identity column: a known agent's sprite + name at full ink (the thing
/// you scan for); an unresolved event drops to its project (muted); a bare
/// process drops to `source·pid` in dim mono. The sprite's *presence* — not a
/// second column — signals a resolved agent.
private struct ScoutTailIdentityCell: View {
    let event: ScoutTailEvent
    let activeAgent: ScoutAgent?
    let emphasized: Bool
    let onOpenAgent: (ScoutAgent) -> Void

    var body: some View {
        HStack(spacing: HudSpacing.sm) {
            // The model/runtime as a standalone little icon — the hand-drawn
            // harness mark leading the row, per the locked Tail design. (It was a
            // corner badge on a sprite avatar; promoted to its own glyph so the
            // runtime reads at a glance: Claude, Codex, Gemini, Cursor, …)
            ScoutHarnessMark(harness: event.source, size: 16, tint: modelTint)
                .frame(width: 16, height: 16)
                .help(event.sourceLabel)
            label
        }
    }

    /// The model icon brightens with the row so it tracks selection/hover, but
    /// stays neutral otherwise — the silhouette differentiates runtimes, not hue.
    private var modelTint: Color {
        emphasized ? ScoutPalette.ink.opacity(0.85) : ScoutPalette.muted
    }

    /// The identity rendered as the `project/session:pid` path the studio locked:
    /// the project reads, the session ref recedes. Click opens the resolved
    /// agent's observe surface, or reveals the project in Finder.
    private var label: some View {
        Button {
            if let activeAgent {
                onOpenAgent(activeAgent)
            } else if scoutTailCopyable(event.cwd) != nil {
                scoutTailRevealPath(event.cwd)
            }
        } label: {
            HStack(spacing: 0) {
                Text(projectName)
                    .foregroundStyle(projectTint)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Text(sessionRef)
                    .foregroundStyle(ScoutPalette.dim)
                    .lineLimit(1)
                    .layoutPriority(1)
            }
            .font(ScoutTailFont.mono(HudTextSize.sm, weight: .regular))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .scoutPointerCursor()
        .help(activeAgent != nil ? "Open agent observe" : "Reveal project in Finder")
    }

    /// Project leads the path; falls back to the source so a bare process names
    /// itself rather than showing a blank gutter.
    private var projectName: String {
        scoutTailCopyable(event.projectLabel) ?? event.sourceLabel
    }

    /// The recessive half: `/<session-prefix>:<pid>` — short session hash so it
    /// reads like the studio's `openscout/a60911d5:6575`, not a full UUID.
    private var sessionRef: String {
        var ref = ""
        if let sid = scoutTailCopyable(event.sessionId) {
            ref += "/" + String(sid.prefix(8))
        }
        if event.pid > 0 {
            ref += ref.isEmpty ? "·\(event.pid)" : ":\(event.pid)"
        }
        return ref
    }

    private var projectTint: Color {
        if activeAgent != nil {
            return emphasized ? ScoutPalette.ink : ScoutPalette.ink.opacity(0.92)
        }
        return emphasized ? ScoutPalette.ink.opacity(0.9) : ScoutPalette.muted
    }
}

/// The action summary. All-mono (the firehose is a log, not prose), with kind
/// carried by weight + color. Tool calls — the commands — get the "little" code
/// treatment: a touch smaller, ink, on a faint inset chip, so they read as the
/// shell lines they are. Results/system recede; user/assistant prose stays full.
private struct ScoutTailActionText: View {
    let event: ScoutTailEvent
    let emphasized: Bool

    var body: some View {
        if event.kind == .tool {
            Text(event.summary)
                .font(ScoutTailFont.mono(HudTextSize.xxs, weight: .regular))
                .foregroundStyle(emphasized ? ScoutPalette.ink : ScoutPalette.ink.opacity(0.86))
                .lineLimit(1)
                .truncationMode(.middle)
                .padding(.horizontal, HudSpacing.xs)
                .padding(.vertical, 1)
                .background(
                    RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                        .fill(ScoutSurface.inset)
                )
        } else {
            Text(event.summary)
                .font(font)
                .foregroundStyle(color)
                .lineLimit(1)
                .truncationMode(.tail)
        }
    }

    private var font: Font {
        switch event.kind {
        case .user: return ScoutTailFont.mono(HudTextSize.xs, weight: .semibold)
        case .assistant: return ScoutTailFont.mono(HudTextSize.xs, weight: .regular)
        case .tool, .toolResult, .system, .other: return ScoutTailFont.mono(HudTextSize.xs, weight: .regular)
        }
    }

    private var color: Color {
        switch event.kind {
        case .user: return ScoutPalette.ink
        case .assistant: return emphasized ? ScoutPalette.ink : ScoutPalette.ink.opacity(0.88)
        case .tool, .toolResult: return emphasized ? ScoutPalette.ink.opacity(0.9) : ScoutPalette.muted
        case .system, .other: return emphasized ? ScoutPalette.muted : ScoutPalette.dim
        }
    }
}

/// The shared row context menu (reveal / copy / open), used by both treatments.
private extension View {
    func scoutTailRowMenu(
        event: ScoutTailEvent,
        activeAgent: ScoutAgent?,
        onOpenSession: @escaping () -> Void,
        onOpenAgent: @escaping (ScoutAgent) -> Void
    ) -> some View {
        contextMenu {
            Button("Reveal project in Finder") { scoutTailRevealPath(event.cwd) }
                .disabled(scoutTailCopyable(event.cwd) == nil)
            Button("Copy project path") { scoutTailCopy(event.cwd) }
                .disabled(scoutTailCopyable(event.cwd) == nil)
            Divider()
            Button("Open session") { onOpenSession() }
                .disabled(event.sessionId.isEmpty)
            Button("Copy session ID") { scoutTailCopy(event.sessionId) }
                .disabled(scoutTailCopyable(event.sessionId) == nil)
            if let activeAgent {
                Divider()
                Button("Open agent observe") { onOpenAgent(activeAgent) }
                Button("Copy agent ID") { scoutTailCopy(activeAgent.id) }
            }
            Divider()
            Button("Copy PID") { scoutTailCopy("\(event.pid)") }
                .disabled(event.pid <= 0)
            Button("Copy event ID") { scoutTailCopy(event.id) }
            Button("Copy summary") { scoutTailCopy(event.summary) }
        }
    }
}

private struct ScoutTailKindGlyph: View {
    let kind: ScoutTailEventKind
    var size: CGFloat = 12

    var body: some View {
        Text(kind.glyph)
            .font(ScoutTailFont.mono(size, weight: .bold))
            .foregroundStyle(ScoutTailKindTone.color(for: kind))
            .frame(width: max(12, size + 4), height: max(12, size + 4), alignment: .center)
            .lineLimit(1)
            .accessibilityLabel(kind.title)
    }
}

/// Tone mapping for the glyph-only KIND marker. Signal kinds earn distinct
/// hues; machine/noise kinds stay neutral so the firehose does not become a
/// wall of equally bright marks.
enum ScoutTailKindTone {
    /// Signal kinds earn a hue; machine output stays neutral. OUT (the highest-
    /// volume kind) is deliberately *not* blue — that blue belongs to the
    /// accent identity, and a firehose full of blue OUT chips would drown it.
    static func color(for kind: ScoutTailEventKind) -> Color {
        switch kind {
        case .user: return ScoutPalette.accent
        case .assistant: return ScoutPalette.statusOk
        case .tool: return ScoutPalette.statusWarn
        case .toolResult: return ScoutPalette.muted
        case .system, .other: return ScoutPalette.dim
        }
    }

    /// The human/action kinds that carry a hue; the rest are neutral chrome.
    static func isSignal(_ kind: ScoutTailEventKind) -> Bool {
        switch kind {
        case .user, .assistant, .tool: return true
        case .toolResult, .system, .other: return false
        }
    }
}

/// The live indicator beside the title: a breathing accent dot while following,
/// a hollow neutral ring when paused. A Core-Animation `repeatForever` drives the
/// breathe so it stays smooth without a per-frame timeline.
/// The Tail identity mark — a steady ECG/heartbeat line, matching the sidebar's
/// `waveform.path.ecg`. One quiet accent glyph that gives the header a face,
/// drawn as a SwiftUI `Shape` (no SF Symbol) so it stays crisp at any size.
private struct ScoutTailGlyph: View {
    var body: some View {
        ScoutTailEcgShape()
            .stroke(ScoutPalette.accent, style: StrokeStyle(lineWidth: 1.7, lineCap: .round, lineJoin: .round))
            .frame(width: 18, height: 13)
    }
}

private struct ScoutTailEcgShape: Shape {
    func path(in rect: CGRect) -> Path {
        // Authored in a 22×14 space, scaled to the frame.
        let sx = rect.width / 22, sy = rect.height / 14
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * sx, y: rect.minY + y * sy)
        }
        var path = Path()
        path.move(to: p(1, 7))
        path.addLine(to: p(5.2, 7))
        path.addLine(to: p(7.2, 2.5))
        path.addLine(to: p(10.2, 11.5))
        path.addLine(to: p(12.6, 5.5))
        path.addLine(to: p(14.2, 8.5))
        path.addLine(to: p(21, 8.5))
        return path
    }
}

/// The identity sprite with the runtime's harness mark riding the bottom-right
/// corner as a small badge — so every line shows *who* (the deterministic
/// sprite) and *what runtime* (the harness) in a single glance.
private struct ScoutTailIdentityAvatar: View {
    let name: String
    let harness: String
    var size: CGFloat = 18

    var body: some View {
        SpriteAvatarView(name: name, size: size, tile: true)
            .overlay(alignment: .bottomTrailing) {
                ScoutHarnessMark(harness: harness, size: size * 0.5, tint: ScoutPalette.muted)
                    .padding(1.5)
                    .background(Circle().fill(ScoutDesign.bg))
                    .overlay(Circle().stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.thin))
                    .offset(x: 2.5, y: 2.5)
            }
    }
}

/// A small monochrome harness brand glyph (the runtime a session runs on),
/// hand-drawn as SwiftUI paths in the cockpit glyph language — recognisable by
/// silhouette at badge size, never an SF Symbol or a third-party icon. Each mark
/// is authored in a 24×24 space and scaled to `size`, tinted with `tint`.
private struct ScoutHarnessMark: View {
    let harness: String
    var size: CGFloat = 12
    var tint: Color = ScoutPalette.muted

    var body: some View {
        Canvas { ctx, dim in
            let s = dim.width / 24
            let shading = GraphicsContext.Shading.color(tint)
            let c = CGPoint(x: 12 * s, y: 12 * s)
            func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * s, y: y * s) }

            switch ScoutHarnessMark.normalize(harness) {
            case "gemini":
                // Four-point sparkle (concave star).
                let tips: [(CGFloat, CGFloat)] = [
                    (12, 0), (15, 9), (24, 12), (15, 15), (12, 24), (9, 15), (0, 12), (9, 9),
                ]
                var p = Path()
                p.move(to: pt(tips[0].0, tips[0].1))
                for t in tips.dropFirst() { p.addLine(to: pt(t.0, t.1)) }
                p.closeSubpath()
                ctx.fill(p, with: shading)

            case "claude":
                // Sunburst — eight rays from the centre (the Anthropic burst).
                var p = Path()
                for i in 0..<8 {
                    let a = Double(i) * .pi / 4
                    p.move(to: c)
                    p.addLine(to: CGPoint(x: c.x + cos(a) * 11 * s, y: c.y + sin(a) * 11 * s))
                }
                ctx.stroke(p, with: shading, style: StrokeStyle(lineWidth: 2.2 * s, lineCap: .round))

            case "codex":
                // Hexagon ring — the OpenAI / Codex runtime.
                var p = Path()
                for i in 0..<6 {
                    let a = Double(i) * .pi / 3 - .pi / 2
                    let q = CGPoint(x: c.x + cos(a) * 10 * s, y: c.y + sin(a) * 10 * s)
                    if i == 0 { p.move(to: q) } else { p.addLine(to: q) }
                }
                p.closeSubpath()
                ctx.stroke(p, with: shading, style: StrokeStyle(lineWidth: 2 * s, lineJoin: .round))

            case "cursor":
                // Upward prism — Cursor.
                var p = Path()
                p.move(to: pt(12, 3))
                p.addLine(to: pt(21.5, 19))
                p.addLine(to: pt(2.5, 19))
                p.closeSubpath()
                ctx.fill(p, with: shading)

            case "grok":
                // Twin diagonal slashes — the xAI cut.
                var p = Path()
                p.move(to: pt(5, 18)); p.addLine(to: pt(15, 6))
                p.move(to: pt(11, 20)); p.addLine(to: pt(21, 8))
                ctx.stroke(p, with: shading, style: StrokeStyle(lineWidth: 2.4 * s, lineCap: .round))

            case "opencode":
                // Square ring — OpenCode.
                var p = Path()
                p.addRoundedRect(
                    in: CGRect(x: 2.5 * s, y: 2.5 * s, width: 19 * s, height: 19 * s),
                    cornerSize: CGSize(width: 3 * s, height: 3 * s)
                )
                p.addRoundedRect(
                    in: CGRect(x: 8 * s, y: 8 * s, width: 8 * s, height: 8 * s),
                    cornerSize: CGSize(width: 1.5 * s, height: 1.5 * s)
                )
                ctx.fill(p, with: shading, style: FillStyle(eoFill: true))

            case "github":
                // Commit graph — a branch off the trunk (Git / GitHub).
                var line = Path()
                line.move(to: pt(8, 5.5)); line.addLine(to: pt(8, 18.5))
                line.move(to: pt(8, 11)); line.addQuadCurve(to: pt(16.5, 9), control: pt(8, 9))
                ctx.stroke(line, with: shading, style: StrokeStyle(lineWidth: 2 * s, lineCap: .round))
                var dots = Path()
                for d in [(8.0, 5.0), (8.0, 19.0), (16.5, 9.0)] {
                    dots.addEllipse(in: CGRect(x: (CGFloat(d.0) - 2.4) * s, y: (CGFloat(d.1) - 2.4) * s, width: 4.8 * s, height: 4.8 * s))
                }
                ctx.fill(dots, with: shading)

            default:
                // Unknown runtime → a lettered chip, like the web fallback.
                let key = ScoutHarnessMark.normalize(harness)
                let letter = String(key.first ?? "?").uppercased()
                let text = Text(letter)
                    .font(.system(size: 13 * s, weight: .semibold, design: .monospaced))
                    .foregroundColor(tint)
                ctx.draw(text, at: c)
            }
        }
        .frame(width: size, height: size)
    }

    /// Fold harness aliases to a canonical key (anthropic → claude, openai →
    /// codex, …) — mirrors the studio HarnessMark so the app and web agree.
    static func normalize(_ harness: String) -> String {
        let raw = harness.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !raw.isEmpty else { return "unknown" }
        var base = raw
        if let i = base.firstIndex(where: { $0 == " " || $0 == "(" }) { base = String(base[..<i]) }
        if let i = base.firstIndex(where: { $0 == "_" || $0 == "-" }) { base = String(base[..<i]) }
        let aliases: [String: String] = [
            "anthropic": "claude", "claude": "claude", "claudecode": "claude", "sonnet": "claude", "opus": "claude",
            "openai": "codex", "codex": "codex", "gpt": "codex", "chatgpt": "codex", "oai": "codex",
            "xai": "grok", "grok": "grok",
            "google": "gemini", "gemini": "gemini", "vertex": "gemini",
            "cursor": "cursor", "github": "github", "opencode": "opencode", "oc": "opencode",
        ]
        return aliases[base] ?? aliases[raw] ?? base
    }
}

private struct ScoutTailDetail: View {
    let event: ScoutTailEvent
    let activeAgent: ScoutAgent?
    let onOpenSession: () -> Void
    let onOpenAgent: (ScoutAgent) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
                Text("\(event.kind.glyph)\(event.kind.label)")
                    .font(ScoutTailFont.mono(HudTextSize.micro, weight: .bold))
                    .foregroundStyle(ScoutPalette.dim)
                Text(event.summary)
                    .font(ScoutTailFont.mono(HudTextSize.xs))
                    .foregroundStyle(ScoutPalette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            VStack(alignment: .leading, spacing: 2) {
                detailLine("id", event.id)
                if !event.sessionId.isEmpty {
                    detailAction("session", event.sessionId, action: onOpenSession)
                }
                if let activeAgent {
                    detailAction("agent", activeAgent.displayName) { onOpenAgent(activeAgent) }
                }
                detailLine("project", event.projectLabel)
                if !event.cwd.isEmpty {
                    detailLine("cwd", event.cwd)
                }
                detailLine("harness", "\(event.sourceLabel) · \(event.originLabel)")
                detailLine("proc", event.parentPid.map { "\(event.pid)<-\($0)" } ?? event.pidLabel)
                detailLine("age", event.ageLabel)
            }
        }
        .padding(.horizontal, ScoutTailMetrics.pageGutter)
        .padding(.vertical, HudSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ScoutSurface.inset.opacity(0.45))
        .overlay(alignment: .bottom) {
            HudDivider(color: ScoutDesign.hairline)
        }
    }

    private func detailLine(_ key: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
            Text(key)
                .font(ScoutTailFont.mono(HudTextSize.micro, weight: .medium))
                .foregroundStyle(ScoutPalette.dim)
                .frame(width: 48, alignment: .leading)
            Text(value)
                .font(ScoutTailFont.mono(HudTextSize.micro))
                .foregroundStyle(ScoutPalette.muted)
                .lineLimit(2)
                .truncationMode(.middle)
            Spacer(minLength: 0)
        }
    }

    private func detailAction(_ key: String, _ value: String, action: @escaping () -> Void) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
            Text(key)
                .font(ScoutTailFont.mono(HudTextSize.micro, weight: .medium))
                .foregroundStyle(ScoutPalette.dim)
                .frame(width: 48, alignment: .leading)
            Button(action: action) {
                Text(value)
                    .font(ScoutTailFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutPalette.muted)
                    .lineLimit(2)
                    .truncationMode(.middle)
            }
            .buttonStyle(.plain)
            .scoutPointerCursor()
            Spacer(minLength: 0)
        }
    }
}

private enum ScoutTailMetrics {
    static let pageGutter: CGFloat = 20
    static let rowHeight: CGFloat = 28
    static let controlHeight: CGFloat = 26
    static let columnGap: CGFloat = 14
    /// Tracking on the uppercase column headers so the caps read as a designed
    /// label band rather than shouty plain text.
    static let headerTracking: CGFloat = 0.8
}

private enum ScoutTailColumns {
    static let timeDefault: CGFloat = 60
    /// One identity column replaces the old HARNESS + AGENT pair: it always
    /// resolves to *something* (agent → project → source·pid), so the firehose
    /// never shows two empty columns of dead width.
    static let identityDefault: CGFloat = 168
    /// KIND is now a single glyph (no word-label), so the column is narrow — it
    /// holds the mark, not a chip; the eye reads kind by shape + hue.
    static let kindDefault: CGFloat = 28

    // Drag-resize clamps. ACTION is flexible and absorbs whatever the three
    // fixed columns don't take, so only these need bounds.
    static let timeRange: ClosedRange<CGFloat> = 44...120
    static let identityRange: ClosedRange<CGFloat> = 88...340
    static let kindRange: ClosedRange<CGFloat> = 22...64
}

/// Live column widths, shared by the header (which mutates them via drag
/// handles) and every row (which reads them). ACTION is implicit — it takes the
/// remaining width.
private struct ScoutTailColumnLayout {
    var time: CGFloat
    var identity: CGFloat
    var kind: CGFloat
}

private struct ScoutTailHoverAction: View {
    let title: String
    let actionHelp: String
    let tint: Color
    let activeTint: Color
    let font: Font
    let truncationMode: Text.TruncationMode
    var lineLimit: Int = 1
    let action: (() -> Void)?

    init(
        title: String,
        copyValue: String? = nil,
        copyHelp: String = "",
        actionHelp: String,
        tint: Color,
        activeTint: Color,
        font: Font = ScoutTailFont.mono(HudTextSize.xs, weight: .medium),
        truncationMode: Text.TruncationMode,
        lineLimit: Int = 1,
        action: (() -> Void)? = nil
    ) {
        self.title = title
        self.actionHelp = actionHelp
        self.tint = tint
        self.activeTint = activeTint
        self.font = font
        self.truncationMode = truncationMode
        self.lineLimit = lineLimit
        self.action = action
    }

    @State private var isHovering = false

    var body: some View {
        actionLabel
            .frame(maxWidth: .infinity, alignment: .leading)
            .onHover { isHovering = $0 }
    }

    @ViewBuilder
    private var actionLabel: some View {
        if let action {
            Button(action: action) {
                labelText
            }
            .buttonStyle(.plain)
            .help(actionHelp)
            .scoutPointerCursor()
        } else {
            labelText
        }
    }

    private var labelText: some View {
        Text(title)
            .font(font)
            .foregroundStyle(isHovering && action != nil ? activeTint : tint)
            .lineLimit(lineLimit)
            .truncationMode(truncationMode)
            .contentShape(Rectangle())
    }
}

private struct ScoutTailToken: View {
    let text: String
    var emphasis: Bool = true

    init(_ text: String, emphasis: Bool = true) {
        self.text = text
        self.emphasis = emphasis
    }

    var body: some View {
        Text(text)
            .font(ScoutTailFont.mono(HudTextSize.xs, weight: emphasis ? .semibold : .medium))
            .foregroundStyle(emphasis ? ScoutPalette.muted : ScoutPalette.dim)
            .lineLimit(1)
            .truncationMode(.tail)
    }
}

private struct ScoutTailModeToggle: View {
    @Binding var mode: ScoutTailViewMode

    var body: some View {
        HStack(spacing: HudSpacing.xxs) {
            ForEach(ScoutTailViewMode.allCases) { item in
                Button {
                    mode = item
                } label: {
                    Text(item.title)
                        .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                        .foregroundStyle(mode == item ? ScoutPalette.ink : ScoutPalette.muted)
                        .lineLimit(1)
                        .padding(.horizontal, HudSpacing.sm)
                        .frame(height: ScoutTailMetrics.controlHeight - 4)
                        .background(
                            RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                                .fill(mode == item ? ScoutDesign.bg : Color.clear)
                        )
                }
                .buttonStyle(.plain)
                .scoutPointerCursor()
                .help(item.title)
            }
        }
        .padding(2)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .fill(ScoutSurface.control)
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.standard)
        )
    }
}

private struct ScoutTailSearchField: View {
    @Binding var text: String

    @FocusState private var isFocused: Bool
    @State private var isHovering = false

    var body: some View {
        HStack(spacing: HudSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                .foregroundStyle(isFocused ? ScoutPalette.accent : ScoutPalette.dim)

            TextField("Search", text: $text)
                .textFieldStyle(.plain)
                .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                .foregroundStyle(ScoutPalette.ink)
                .tint(ScoutPalette.accent)
                .focused($isFocused)
        }
        .padding(.horizontal, HudSpacing.md)
        .frame(height: ScoutTailMetrics.controlHeight)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .fill(isFocused ? ScoutSurface.controlFocused : (isHovering ? ScoutSurface.hover : ScoutSurface.control))
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .stroke(isFocused ? ScoutPalette.accent.opacity(0.70) : ScoutDesign.hairline, lineWidth: isFocused ? HudFocus.ringWidth : HudStrokeWidth.standard)
        )
        .onHover { isHovering = $0 }
        .accessibilityLabel("Search tail events")
    }
}

private struct ScoutTailFilterMenu<MenuItems: View>: View {
    let value: String
    let width: CGFloat
    @ViewBuilder let menuItems: () -> MenuItems

    @State private var isHovering = false

    var body: some View {
        Menu {
            menuItems()
        } label: {
            HStack(spacing: HudSpacing.xs) {
                Image(systemName: "tray.full")
                    .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(ScoutPalette.muted)
                    .frame(width: 14)
                Text(value)
                    .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                    .foregroundStyle(ScoutPalette.ink)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Image(systemName: "chevron.up.chevron.down")
                    .font(HudFont.ui(HudTextSize.micro, weight: .bold))
                    .foregroundStyle(ScoutPalette.dim)
            }
            .padding(.horizontal, HudSpacing.sm)
            .frame(width: width, height: ScoutTailMetrics.controlHeight)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .fill(isHovering ? ScoutSurface.hover : ScoutSurface.control)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.standard)
            )
        }
        .menuStyle(.borderlessButton)
        .buttonStyle(.plain).scoutPointerCursor()
        .onHover { isHovering = $0 }
    }
}

private struct ScoutTailGhostButton: View {
    let title: String
    let icon: String
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: HudSpacing.sm) {
                Image(systemName: icon)
                    .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                Text(title)
                    .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
            }
            .foregroundStyle(isHovering ? ScoutPalette.ink : ScoutPalette.muted)
            .padding(.horizontal, HudSpacing.md)
            .frame(height: ScoutTailMetrics.controlHeight)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .fill(isHovering ? ScoutSurface.hover : ScoutSurface.control)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.standard)
            )
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .help(title)
        .onHover { isHovering = $0 }
    }
}

private struct ScoutTailHeaderDivider: View {
    var body: some View {
        Rectangle()
            .fill(ScoutDesign.hairline)
            .frame(width: 1, height: 18)
    }
}

private struct ScoutTailIconButton: View {
    let title: String
    let icon: String
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                .foregroundStyle(isHovering ? ScoutPalette.ink : ScoutPalette.dim)
                .frame(width: ScoutTailMetrics.controlHeight, height: ScoutTailMetrics.controlHeight)
                .background(
                    RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                        .fill(isHovering ? ScoutSurface.hover : Color.clear)
                )
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .help(title)
        .onHover { isHovering = $0 }
    }
}

private func scoutTailCopyable(_ value: String?) -> String? {
    guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
          !trimmed.isEmpty,
          trimmed != "—" else {
        return nil
    }
    return trimmed
}

private func scoutTailCopy(_ value: String?) {
    guard let clean = scoutTailCopyable(value) else { return }
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(clean, forType: .string)
}

private func scoutTailRevealPath(_ path: String) {
    guard let clean = scoutTailCopyable(path) else { return }
    let expanded = (clean as NSString).expandingTildeInPath
    NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: expanded)])
}
