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

    private var header: some View {
        ScoutColumnHeader(horizontalPadding: ScoutTailMetrics.pageGutter) {
            titleCluster
        } secondary: {
            filterToolbar
        } trailing: {
            commandStrip
        }
    }

    private var titleCluster: some View {
        HStack(spacing: HudSpacing.sm) {
            // The Tail identity mark — a steady ECG line (matches the sidebar
            // icon). One quiet accent glyph, not a blinking "live" gimmick.
            ScoutTailGlyph()

            Text("Tail")
                .font(HudFont.ui(HudTextSize.xl, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)

            ScoutTailHeaderDivider()

            headerMetrics

            if tail.isLoading {
                ScoutBrailleSpinner(size: HudTextSize.sm, tint: ScoutPalette.dim)
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    /// Quiet inventory read-out beside the title: tabular figures carry the count,
    /// lowercase units recede, hairline middots tie them together. No throughput
    /// or "live" rate — the stream itself is the liveness.
    private var headerMetrics: some View {
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
            tailCountCluster(tail.discovery?.totals.transcripts ?? tail.sessionCount, "logs")
            metricDot
            tailCountCluster(tail.discovery?.totals.total ?? 0, "procs")
            metricDot
            tailCountCluster(tail.sessionCount, "sessions")
        }
    }

    private var metricDot: some View {
        Text("·")
            .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
            .foregroundStyle(ScoutPalette.dim.opacity(0.55))
    }

    private func tailCountCluster(_ value: Int, _ label: String) -> some View {
        tailMetricCluster("\(value)", label)
    }

    private func tailMetricCluster(_ value: String, _ label: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.xxs) {
            Text(value)
                .font(ScoutTailFont.mono(HudTextSize.base, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
                .monospacedDigit()
            Text(label)
                .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                .foregroundStyle(ScoutPalette.dim)
        }
    }

    private var filterToolbar: some View {
        HStack(spacing: HudSpacing.sm) {
            ScoutTailSearchField(text: $tail.query)
                .frame(width: 220)

            sourceMenu

            Spacer(minLength: HudSpacing.sm)
        }
        .layoutPriority(2)
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

    private var commandStrip: some View {
        HStack(spacing: HudSpacing.sm) {
            ScoutTailModeToggle(mode: viewModeBinding)

            ScoutTailHeaderDivider()

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
                            ForEach(visibleEvents.indices, id: \.self) { index in
                                let event = visibleEvents[index]
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
                                            isFirst: index == visibleEvents.startIndex,
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
        HStack(spacing: HudSpacing.xs) {
            if let activeAgent {
                SpriteAvatarView(agent: activeAgent, size: 18, tile: true)
            } else {
                Color.clear.frame(width: 18, height: 18)
            }
            label
        }
    }

    @ViewBuilder
    private var label: some View {
        if let activeAgent {
            ScoutTailHoverAction(
                title: activeAgent.displayName,
                actionHelp: "Open agent observe",
                tint: agentInk,
                activeTint: ScoutPalette.accent,
                font: HudFont.ui(HudTextSize.sm, weight: .medium),
                truncationMode: .tail,
                action: { onOpenAgent(activeAgent) }
            )
        } else if scoutTailCopyable(event.projectLabel) != nil {
            ScoutTailHoverAction(
                title: event.projectLabel,
                actionHelp: "Reveal project in Finder",
                tint: ScoutPalette.muted,
                activeTint: ScoutPalette.ink,
                font: HudFont.ui(HudTextSize.sm, weight: .regular),
                truncationMode: .middle,
                action: scoutTailCopyable(event.cwd) == nil ? nil : { scoutTailRevealPath(event.cwd) }
            )
        } else {
            Text(procFallbackLabel)
                .font(ScoutTailFont.mono(HudTextSize.xs, weight: .regular))
                .foregroundStyle(ScoutPalette.dim)
                .lineLimit(1)
                .truncationMode(.tail)
        }
    }

    private var agentInk: Color {
        emphasized ? ScoutPalette.ink : ScoutPalette.ink.opacity(0.92)
    }

    /// Last-resort identity (`codex·4894`) so even a bare process is named.
    private var procFallbackLabel: String {
        let src = event.sourceLabel
        return event.pid > 0 ? "\(src)·\(event.pid)" : src
    }
}

/// The action summary. Type carries kind — human turns are sans (user heavier),
/// machine I/O is mono — and color stays monochrome, graded by emphasis.
private struct ScoutTailActionText: View {
    let event: ScoutTailEvent
    let emphasized: Bool

    var body: some View {
        Text(event.summary)
            .font(font)
            .foregroundStyle(color)
            .lineLimit(1)
            .truncationMode(.tail)
    }

    private var font: Font {
        switch event.kind {
        case .user: return HudFont.ui(HudTextSize.sm, weight: .semibold)
        case .assistant: return HudFont.ui(HudTextSize.sm, weight: .regular)
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
