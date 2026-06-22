import AppKit
import HudsonUI
import ScoutAppCore
import SwiftUI

struct ScoutTailContent: View {
    @ObservedObject var tail: ScoutTailStore
    let agents: [ScoutAgent]
    /// Open the full session for a tail event in the slide-out web viewer.
    let onOpenSession: (ScoutTailEvent) -> Void
    /// Open the native observe surface for a session-matched agent.
    let onOpenAgent: (ScoutAgent) -> Void

    @State private var selectedEventId: String?

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
        HStack(spacing: HudSpacing.md) {
            // Title + counts share one baseline so they read as a single lockup
            // rather than tiny stats floating at the title's mid-height.
            HStack(alignment: .firstTextBaseline, spacing: HudSpacing.md) {
                Text("Tail")
                    .font(HudFont.ui(HudTextSize.xl, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)

                headerMetrics
            }

            if tail.isLoading {
                ProgressView()
                    .controlSize(.small)
                    .scaleEffect(0.86)
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    /// Two counts read as one strip: tabular figures at body size carry real
    /// weight beside the title (no fine-print float), lowercase units recede,
    /// and a hairline middot ties the pair together.
    private var headerMetrics: some View {
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
            tailCountCluster(
                tail.discovery?.totals.transcripts ?? tail.sessionCount,
                "logs"
            )
            Text("·")
                .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                .foregroundStyle(ScoutPalette.dim.opacity(0.55))
            tailCountCluster(tail.discovery?.totals.total ?? 0, "procs")
        }
    }

    private func tailCountCluster(_ value: Int, _ label: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.xxs) {
            Text("\(value)")
                .font(HudFont.mono(HudTextSize.base, weight: .semibold))
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
                .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                .foregroundStyle(ScoutPalette.dim)
            Text(summary)
                .font(HudFont.mono(HudTextSize.xs, weight: .medium))
                .foregroundStyle(ScoutPalette.muted)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 0)
            Text("\(visibleEvents.count) events")
                .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
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
                .font(HudFont.mono(HudTextSize.xs, weight: .bold))
            Text(error)
                .font(HudFont.mono(HudTextSize.xxs, weight: .medium))
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
                .font(HudFont.mono(HudTextSize.xs, weight: .bold))
                .foregroundStyle(ScoutPalette.dim)

            Text(tail.isFollowing ? "follow" : "paused")
                .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
                .foregroundStyle(ScoutPalette.muted)

            Text("+\(tail.lastBatchCount)")
                .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
                .foregroundStyle(tail.lastBatchCount > 0 ? ScoutPalette.muted : ScoutPalette.dim)
                .monospacedDigit()

            if let latestEvent {
                Text(latestEvent.clockLabel)
                    .font(HudFont.mono(HudTextSize.xxs, weight: .medium))
                    .foregroundStyle(ScoutPalette.dim)
                    .monospacedDigit()
                Text(latestEvent.sourceLabel)
                    .font(HudFont.mono(HudTextSize.xxs, weight: .medium))
                    .foregroundStyle(ScoutPalette.dim)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            Text("\(visibleEvents.count)/\(tail.bufferedEventCount) buf")
                .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
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
        if tail.isLoading && !tail.hasBufferedEvents {
            VStack(spacing: HudSpacing.md) {
                ProgressView()
                Text("Loading tail")
                    .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
                    .foregroundStyle(ScoutPalette.muted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if visibleEvents.isEmpty {
            VStack(spacing: HudSpacing.xs) {
                Text(tail.hasBufferedEvents ? "— quiet metadata —" : "— no events —")
                    .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(ScoutPalette.dim)
                Text(tail.hasBufferedEvents ? "show transcript metadata to inspect it" : "harness stream is quiet")
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutPalette.dim.opacity(0.8))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(ScoutTailMetrics.pageGutter)
        } else {
            VStack(spacing: 0) {
                ScoutTailHeaderRow()

                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            ForEach(visibleEvents.indices, id: \.self) { index in
                                let event = visibleEvents[index]
                                ScoutTailRow(
                                    event: event,
                                    activeAgent: activeAgent(for: event),
                                    isAlternating: !index.isMultiple(of: 2),
                                    isSelected: selectedEventId == event.id,
                                    onOpenSession: { onOpenSession(event) },
                                    onOpenAgent: { agent in onOpenAgent(agent) }
                                ) {
                                    selectedEventId = selectedEventId == event.id ? nil : event.id
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
                    .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(ScoutPalette.muted)
                    .monospacedDigit()
                Text("·")
                    .foregroundStyle(ScoutPalette.dim)
                Text("\(tail.bufferedEventCount) buffered")
                    .font(HudFont.mono(HudTextSize.xs))
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
                    .font(HudFont.mono(HudTextSize.xs, weight: active ? .bold : .semibold))
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
                        .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                        .foregroundStyle(active ? ScoutPalette.accent : ScoutPalette.muted)
                        .monospacedDigit()
                        .frame(width: 26, alignment: .trailing)
                    Text("\(percent)%")
                        .font(HudFont.mono(HudTextSize.micro))
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
    var body: some View {
        HStack(spacing: ScoutTailMetrics.columnGap) {
            header("TIME", width: ScoutTailColumns.time)
            header("HARNESS", width: ScoutTailColumns.harness)
            header("AGENT", width: ScoutTailColumns.agent)
            header("ACTION", width: nil)
        }
        .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
        .tracking(ScoutTailMetrics.headerTracking)
        .foregroundStyle(ScoutPalette.dim)
        .padding(.horizontal, ScoutTailMetrics.pageGutter)
        .frame(height: 24)
        .background(ScoutDesign.chrome)
        .overlay(alignment: .bottom) {
            HudDivider(color: ScoutDesign.hairlineStrong)
        }
    }

    @ViewBuilder
    private func header(_ title: String, width: CGFloat?) -> some View {
        if let width {
            Text(title).frame(width: width, alignment: .leading)
        } else {
            Text(title).frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct ScoutTailRow: View {
    let event: ScoutTailEvent
    let activeAgent: ScoutAgent?
    let isAlternating: Bool
    let isSelected: Bool
    let onOpenSession: () -> Void
    let onOpenAgent: (ScoutAgent) -> Void
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: ScoutTailMetrics.columnGap) {
            timeCell
                .frame(width: ScoutTailColumns.time, alignment: .leading)

            Text(event.sourceLabel)
                .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                .foregroundStyle(harnessColor)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(width: ScoutTailColumns.harness, alignment: .leading)

            agentCell
                .frame(width: ScoutTailColumns.agent, alignment: .leading)

            Text(event.summary)
                .font(actionFont)
                .foregroundStyle(actionColor)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, ScoutTailMetrics.pageGutter)
        .frame(minHeight: ScoutTailMetrics.rowHeight)
        .background { rowBackground }
        .contentShape(Rectangle())
        .onTapGesture(perform: action)
        .scoutPointerCursor()
        .onHover { isHovering = $0 }
        .contextMenu {
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
            Button("Copy event ID") {
                scoutTailCopy(event.id)
            }
            Button("Copy summary") {
                scoutTailCopy(event.summary)
            }
        }
    }

    /// The clock split into a brighter HH:mm and a recessive :ss so the timestamp
    /// column reads as a designed numeral rather than a flat mono dump. Tabular
    /// figures keep every row's colons in the same place.
    private var timeCell: some View {
        let clock = event.clockLabel
        let cut = clock.index(clock.startIndex, offsetBy: min(5, clock.count))
        return HStack(spacing: 0) {
            Text(String(clock[..<cut]))
                .foregroundStyle(timeColor)
            Text(String(clock[cut...]))
                .foregroundStyle(timeColor.opacity(0.5))
        }
        .font(HudFont.mono(HudTextSize.xs, weight: .medium))
        .monospacedDigit()
        .lineLimit(1)
    }

    @ViewBuilder
    private var agentCell: some View {
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
            // No resolved agent: fall back to the project, but render it
            // recessive so real agents are what the eye lands on.
            ScoutTailHoverAction(
                title: event.projectLabel,
                actionHelp: "Reveal project in Finder",
                tint: ScoutPalette.dim,
                activeTint: ScoutPalette.muted,
                font: HudFont.ui(HudTextSize.sm, weight: .regular),
                truncationMode: .middle,
                action: scoutTailCopyable(event.cwd) == nil ? nil : { scoutTailRevealPath(event.cwd) }
            )
        } else {
            Text("—")
                .font(HudFont.ui(HudTextSize.sm, weight: .regular))
                .foregroundStyle(ScoutPalette.dim.opacity(0.6))
                .lineLimit(1)
        }
    }

    private var emphasized: Bool { isSelected || isHovering }

    private var timeColor: Color {
        emphasized ? ScoutPalette.muted : ScoutPalette.dim
    }

    private var harnessColor: Color {
        emphasized ? ScoutPalette.ink : ScoutPalette.muted
    }

    private var agentInk: Color {
        emphasized ? ScoutPalette.ink : ScoutPalette.ink.opacity(0.92)
    }

    /// Selection is a soft accent wash — the emphasis Arach approves — kept in
    /// the Agent Lanes family by color, but deliberately *without* a leading
    /// accent rail (the "left accent bar" treatment is permanently banned, even
    /// on rows). Hover lifts to the plain surface; the resting stripe is an
    /// ultra-subtle zebra that delineates rows in the firehose without a grid.
    @ViewBuilder
    private var rowBackground: some View {
        if isSelected {
            ScoutPalette.accent.opacity(0.12)
        } else if isHovering {
            ScoutPalette.surface
        } else if isAlternating {
            ScoutSurface.inset.opacity(0.22)
        } else {
            Color.clear
        }
    }

    /// Type carries the event kind so no loud kind column is needed: human turns
    /// are sans (user a touch heavier, since prompts are the highest-scan rows),
    /// machine I/O is mono. Color stays monochrome — brightness, never hue.
    private var actionFont: Font {
        switch event.kind {
        case .user:
            return HudFont.ui(HudTextSize.sm, weight: .semibold)
        case .assistant:
            return HudFont.ui(HudTextSize.sm, weight: .regular)
        case .tool, .toolResult, .system, .other:
            return HudFont.mono(HudTextSize.xs, weight: .regular)
        }
    }

    private var actionColor: Color {
        switch event.kind {
        case .user:
            return ScoutPalette.ink
        case .assistant:
            return emphasized ? ScoutPalette.ink : ScoutPalette.ink.opacity(0.88)
        case .tool, .toolResult:
            return emphasized ? ScoutPalette.ink.opacity(0.9) : ScoutPalette.muted
        case .system, .other:
            return emphasized ? ScoutPalette.muted : ScoutPalette.dim
        }
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
                    .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                    .foregroundStyle(ScoutPalette.dim)
                Text(event.summary)
                    .font(HudFont.mono(HudTextSize.xs))
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
                .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                .foregroundStyle(ScoutPalette.dim)
                .frame(width: 48, alignment: .leading)
            Text(value)
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(ScoutPalette.muted)
                .lineLimit(2)
                .truncationMode(.middle)
            Spacer(minLength: 0)
        }
    }

    private func detailAction(_ key: String, _ value: String, action: @escaping () -> Void) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
            Text(key)
                .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                .foregroundStyle(ScoutPalette.dim)
                .frame(width: 48, alignment: .leading)
            Button(action: action) {
                Text(value)
                    .font(HudFont.mono(HudTextSize.micro))
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
    static let time: CGFloat = 62
    static let harness: CGFloat = 76
    static let agent: CGFloat = 168
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
        font: Font = HudFont.mono(HudTextSize.xs, weight: .medium),
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
            .font(HudFont.mono(HudTextSize.xs, weight: emphasis ? .semibold : .medium))
            .foregroundStyle(emphasis ? ScoutPalette.muted : ScoutPalette.dim)
            .lineLimit(1)
            .truncationMode(.tail)
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
