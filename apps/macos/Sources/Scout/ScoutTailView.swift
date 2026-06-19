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
        visibleEvents.last ?? tail.events.last
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
            kindFilterBar
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
            filterStrip
        } trailing: {
            commandStrip
        }
    }

    private var titleCluster: some View {
        HStack(spacing: HudSpacing.xs) {
            Text("Tail")
                .font(HudFont.ui(HudTextSize.xl, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)

            ScoutTailLivePill(isLive: tail.isFollowing)

            headerMetrics

            if tail.isLoading {
                ProgressView()
                    .controlSize(.small)
                    .scaleEffect(0.86)
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    private var headerMetrics: some View {
        HStack(spacing: HudSpacing.xs) {
            ScoutTailHeaderMetric(
                value: "\(tail.discovery?.totals.transcripts ?? tail.sessionCount)",
                label: "logs",
                tint: ScoutPalette.accent
            )
            ScoutTailHeaderMetric(
                value: "\(tail.discovery?.totals.total ?? 0)",
                label: "procs",
                tint: ScoutPalette.statusInfo
            )
            ScoutTailHeaderMetric(
                value: tail.liveRateLabel,
                label: "rate",
                tint: tail.linesPerSecond > 0 ? ScoutPalette.statusOk : ScoutPalette.muted
            )
        }
    }

    private var filterStrip: some View {
        HStack(spacing: HudSpacing.sm) {
            ScoutTailSearchField(text: $tail.query)
                .frame(width: 264)

            sourceMenu
        }
        .layoutPriority(2)
    }

    private var sourceMenu: some View {
        ScoutTailFilterMenu(
            value: tail.selectedSource ?? "All sources",
            icon: tail.selectedSource == nil ? "tray.full" : "dot.radiowaves.left.and.right",
            tint: tail.selectedSource == nil ? ScoutPalette.muted : ScoutPalette.accent,
            width: 148
        ) {
            Button {
                tail.selectedSource = nil
            } label: {
                Label("All sources", systemImage: tail.selectedSource == nil ? "checkmark" : "tray.full")
            }
            if !tail.sources.isEmpty {
                Divider()
                ForEach(tail.sources, id: \.self) { source in
                    Button {
                        tail.selectedSource = source
                    } label: {
                        Label(source, systemImage: tail.selectedSource == source ? "checkmark" : "circle")
                    }
                }
            }
        }
        .help("Filter by source")
    }

    /// Inline kind filter — replaces the kind dropdown with a chip bar so the
    /// active filter (and the full kind vocabulary) is always visible. Each chip
    /// carries its kind tone; the selected one fills with it.
    private var kindFilterBar: some View {
        HStack(spacing: HudSpacing.xs) {
            ScrollView(.horizontal) {
                HStack(spacing: HudSpacing.xs) {
                    kindChip(nil)
                    ForEach(ScoutTailEventKind.allCases) { kind in
                        kindChip(kind)
                    }
                }
                .padding(.vertical, HudSpacing.xs)
            }
            .scrollIndicators(.hidden)

            Spacer(minLength: 0)

            if tail.selectedKind != nil || tail.selectedSource != nil || !tail.query.isEmpty {
                Button {
                    tail.selectedKind = nil
                    tail.selectedSource = nil
                    tail.query = ""
                } label: {
                    Text("Clear")
                        .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                        .foregroundStyle(ScoutPalette.muted)
                }
                .buttonStyle(.plain)
                .help("Clear filters")
            }
        }
        .padding(.horizontal, ScoutTailMetrics.pageGutter)
        .frame(height: 36)
        .background(ScoutDesign.chrome)
        .overlay(alignment: .bottom) {
            HudDivider(color: ScoutDesign.hairline)
        }
    }

    private func kindChip(_ kind: ScoutTailEventKind?) -> some View {
        let selected = tail.selectedKind == kind
        let tint = kind?.tint ?? ScoutPalette.accent
        let label = kind?.title ?? "All"
        return Button {
            if let kind {
                tail.selectedKind = (tail.selectedKind == kind) ? nil : kind
            } else {
                tail.selectedKind = nil
            }
        } label: {
            HStack(spacing: HudSpacing.xxs) {
                if let kind {
                    Circle()
                        .fill(kind.tint)
                        .frame(width: HudDotSize.tiny, height: HudDotSize.tiny)
                }
                Text(label)
                    .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
            }
            .foregroundStyle(selected ? tint : ScoutPalette.muted)
            .padding(.horizontal, HudSpacing.sm)
            .frame(height: 24)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .fill(selected ? HudSurface.tint(tint, opacity: 0.16) : ScoutSurface.control)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .stroke(selected ? HudSurface.tintBorder(tint) : ScoutDesign.hairline, lineWidth: HudStrokeWidth.standard)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("Filter: \(label)")
        .scoutPointerCursor()
    }

    private var commandStrip: some View {
        HStack(spacing: HudSpacing.xs) {
            ScoutTailToolbarButton(
                title: tail.isFollowing ? "Pause" : "Follow",
                icon: tail.isFollowing ? "pause.fill" : "play.fill",
                isActive: tail.isFollowing
            ) {
                tail.isFollowing.toggle()
            }

            ScoutTailIconButton(title: "Refresh", icon: "arrow.clockwise") {
                tail.refresh()
            }

            ScoutTailIconButton(title: "Open Web", icon: "safari") {
                ScoutWeb.open(path: "/ops/tail")
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    private func errorBanner(_ error: String) -> some View {
        HStack(spacing: HudSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
            Text(error)
                .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 0)
        }
        .foregroundStyle(ScoutPalette.statusError)
        .padding(.horizontal, ScoutTailMetrics.pageGutter)
        .frame(height: 26)
        .background(ScoutDesign.chrome)
        .overlay(alignment: .bottom) {
            HudDivider(color: ScoutDesign.hairline)
        }
    }

    private var tailSignalFooter: some View {
        HStack(spacing: HudSpacing.sm) {
            Circle()
                .fill(tail.isFollowing ? ScoutPalette.statusOk : ScoutPalette.muted)
                .frame(width: HudDotSize.small, height: HudDotSize.small)

            Text(tail.isFollowing ? "Following tail" : "Tail paused")
                .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                .foregroundStyle(tail.isFollowing ? ScoutPalette.ink : ScoutPalette.muted)

            Text("\(tail.lastBatchCount) new")
                .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                .foregroundStyle(tail.lastBatchCount > 0 ? ScoutPalette.accent : ScoutPalette.dim)
                .monospacedDigit()

            if let latestEvent {
                Text("latest")
                    .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                    .foregroundStyle(ScoutPalette.dim)
                Text(latestEvent.clockLabel)
                    .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(ScoutPalette.muted)
                    .monospacedDigit()
                Text(latestEvent.sourceLabel)
                    .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(ScoutPalette.muted)
                    .lineLimit(1)
            } else {
                Text("waiting")
                    .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                    .foregroundStyle(ScoutPalette.dim)
            }

            Spacer(minLength: 0)

            Text("\(visibleEvents.count) / \(tail.events.count) lines buffered")
                .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                .foregroundStyle(ScoutPalette.dim)
                .monospacedDigit()
        }
        .padding(.horizontal, ScoutTailMetrics.pageGutter)
        .frame(height: 28)
        .background(ScoutDesign.chrome)
        .overlay(alignment: .top) {
            HudDivider(color: ScoutDesign.hairline)
        }
    }

    @ViewBuilder
    private var stream: some View {
        if tail.isLoading && tail.events.isEmpty {
            VStack(spacing: HudSpacing.md) {
                ProgressView()
                Text("Loading tail")
                    .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
                    .foregroundStyle(ScoutPalette.muted)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if visibleEvents.isEmpty {
            HudEmptyState(
                title: tail.events.isEmpty ? "No tail events" : "No matches",
                subtitle: tail.events.isEmpty ? "The local harness stream is quiet." : "Nothing in the current slice.",
                icon: "waveform.path.ecg"
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(ScoutTailMetrics.pageGutter)
        } else {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
                        Section {
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
                        } header: {
                            ScoutTailHeaderRow()
                                .zIndex(1)
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

    private func activeAgent(for event: ScoutTailEvent) -> ScoutAgent? {
        scoutTailCopyable(event.sessionId).flatMap { agentsBySessionId[$0] }
    }
}

struct ScoutTailInspector: View {
    @ObservedObject var tail: ScoutTailStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: HudSpacing.xxl) {
                coverage
                inventorySection("Sources", items: tail.sourceCounts, empty: "No harnesses yet")
                inventorySection("Origins", items: tail.originCounts, empty: "No origins yet")
                inventorySection("Kinds", items: tail.kindCounts, empty: "No event kinds yet")
                inventorySection("Projects", items: Array(tail.projectCounts.prefix(8)), empty: "No projects yet")
                trackedSurface
                controls
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .scoutOverlayScrollers()
        }
        .scrollIndicators(.visible)
    }

    private var coverage: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            HStack(alignment: .center, spacing: HudSpacing.sm) {
                ScoutTailInspectorTitle("Coverage")
                Spacer(minLength: 0)
                HudBadge(
                    tail.isFollowing ? "Live" : "Paused",
                    tint: tail.isFollowing ? ScoutPalette.statusOk : ScoutPalette.muted,
                    dot: tail.isFollowing
                )
            }

            LazyVGrid(
                columns: [
                    GridItem(.flexible(), spacing: HudSpacing.md),
                    GridItem(.flexible(), spacing: HudSpacing.md),
                ],
                alignment: .leading,
                spacing: HudSpacing.md
            ) {
                metric(
                    "Logs",
                    tail.discovery?.totals.transcripts ?? tail.sessionCount,
                    detail: "transcripts",
                    tint: ScoutPalette.accent
                )
                metric(
                    "Processes",
                    tail.discovery?.totals.total ?? 0,
                    detail: "inventory",
                    tint: ScoutPalette.statusInfo
                )
                metric(
                    "Sessions",
                    tail.sessionCount,
                    detail: "unique ids",
                    tint: ScoutPalette.statusOk
                )
                metric(
                    "Buffered",
                    tail.events.count,
                    detail: "\(visibleCount) visible",
                    tint: ScoutPalette.muted
                )
            }

            coveragePulse
        }
    }

    private var visibleCount: Int {
        tail.filteredEvents.count
    }

    private var coveragePulse: some View {
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
            HudStatusDot(color: tail.isFollowing ? ScoutPalette.statusOk : ScoutPalette.muted)
            Text(tail.isFollowing ? "\(tail.lastBatchCount) new · \(tail.liveRateLabel)" : "manual refresh · \(tail.liveRateLabel)")
                .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                .foregroundStyle(tail.lastBatchCount > 0 ? ScoutPalette.accent : ScoutPalette.muted)
                .monospacedDigit()
                .lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, HudSpacing.md)
        .frame(height: 30)
        .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(ScoutSurface.control))
        .overlay(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.standard))
    }

    private var trackedSurface: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            ScoutTailInspectorTitle("Tracks")
            track("Transcript logs", "Claude and Codex JSONL files discovered on disk")
            track("Live processes", "Harness process inventory and parent attribution")
            track("Sessions", "Session IDs and short row links")
            track("Projects", "Current working directory and project labels")
            track("Origins", "Scout-managed, Hudson-managed, or native launch source")
            track("Events", "User, assistant, tool, tool result, system, and other")
        }
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            ScoutTailInspectorTitle("Defaults")
            Toggle("Show transcript metadata", isOn: $tail.showMetadata)
                .toggleStyle(.checkbox)
                .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                .foregroundStyle(ScoutPalette.muted)
            Text("Metadata includes records like model, title, permission-mode, and last-prompt.")
                .font(HudFont.ui(HudTextSize.xs))
                .foregroundStyle(ScoutPalette.dim)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func track(_ label: String, _ detail: String) -> some View {
        VStack(alignment: .leading, spacing: HudSpacing.xxs) {
            Text(label)
                .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                .foregroundStyle(ScoutPalette.muted)
            Text(detail)
                .font(HudFont.ui(HudTextSize.xs))
                .foregroundStyle(ScoutPalette.dim)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, HudSpacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) {
            HudDivider(color: ScoutDesign.hairline)
        }
    }


    private func metric(_ label: String, _ value: Int, detail: String, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            HStack(spacing: HudSpacing.xs) {
                Circle()
                    .fill(tint)
                    .frame(width: HudDotSize.tiny, height: HudDotSize.tiny)
                Text(label.uppercased())
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .foregroundStyle(ScoutPalette.dim)
                    .lineLimit(1)
            }
            Text("\(value)")
                .font(HudFont.mono(HudTextSize.lg, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
                .monospacedDigit()
            Text(detail)
                .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                .foregroundStyle(ScoutPalette.dim)
                .lineLimit(1)
        }
        .padding(.horizontal, HudSpacing.md)
        .padding(.vertical, HudSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(ScoutSurface.inset))
        .overlay(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.standard))
    }

    private func inventorySection(_ title: String, items: [ScoutTailCount], empty: String) -> some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            ScoutTailInspectorTitle(title)
            if items.isEmpty {
                Text(empty)
                    .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                    .foregroundStyle(ScoutPalette.dim)
            } else {
                ForEach(items) { item in
                    HStack(spacing: HudSpacing.md) {
                        Text(item.label)
                            .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                            .foregroundStyle(ScoutPalette.muted)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Spacer(minLength: HudSpacing.sm)
                        Text("\(item.count)")
                            .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                            .foregroundStyle(ScoutPalette.dim)
                            .monospacedDigit()
                    }
                    .frame(height: 22)
                    .overlay(alignment: .bottom) {
                        HudDivider(color: ScoutDesign.hairline)
                    }
                }
            }
        }
    }
}

private struct ScoutTailInspectorTitle: View {
    let title: String

    init(_ title: String) {
        self.title = title
    }

    var body: some View {
        Text(title.uppercased())
            .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
            .foregroundStyle(ScoutPalette.dim)
    }
}

private struct ScoutTailHeaderRow: View {
    var body: some View {
        HStack(spacing: ScoutTailMetrics.columnGap) {
            Text("TIME")
                .frame(width: ScoutTailColumns.time, alignment: .leading)
            Text("HARNESS")
                .frame(width: ScoutTailColumns.source, alignment: .leading)
            Text("ORIGIN")
                .frame(width: ScoutTailColumns.origin, alignment: .leading)
            Text("PROJECT / SESSION")
                .frame(width: ScoutTailColumns.context, alignment: .leading)
            Text("PID")
                .frame(width: ScoutTailColumns.pid, alignment: .leading)
            Text("AGENT")
                .frame(width: ScoutTailColumns.agent, alignment: .leading)
            Text("KIND")
                .frame(width: ScoutTailColumns.kind, alignment: .leading)
            Text("SUMMARY")
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
        .foregroundStyle(ScoutPalette.muted)
        .padding(.horizontal, ScoutTailMetrics.pageGutter)
        .frame(height: 28)
        .background(ScoutDesign.chrome)
        .overlay(alignment: .bottom) {
            HudDivider(color: ScoutDesign.hairline)
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
        HStack(alignment: .center, spacing: ScoutTailMetrics.columnGap) {
            Text(event.clockLabel)
                .font(HudFont.mono(HudTextSize.sm))
                .monospacedDigit()
                .foregroundStyle(isSelected ? ScoutPalette.ink : ScoutPalette.dim)
                .frame(width: ScoutTailColumns.time, alignment: .leading)

            ScoutTailChip(event.sourceLabel, tint: sourceColor(event.sourceLabel))
                .frame(width: ScoutTailColumns.source, alignment: .leading)

            ScoutTailChip(event.originLabel, tint: originColor(event.harness))
                .frame(width: ScoutTailColumns.origin, alignment: .leading)

            projectSessionCell
                .frame(width: ScoutTailColumns.context, alignment: .leading)

            pidCell
                .frame(width: ScoutTailColumns.pid, alignment: .leading)

            agentCell
                .frame(width: ScoutTailColumns.agent, alignment: .leading)

            ScoutTailChip(event.kind.label, tint: event.kind.tint)
                .frame(width: ScoutTailColumns.kind, alignment: .leading)

            Text(event.summary)
                .font(HudFont.mono(HudTextSize.sm))
                .foregroundStyle(isSelected ? ScoutPalette.ink : ScoutPalette.ink.opacity(0.78))
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, ScoutTailMetrics.pageGutter)
        .frame(minHeight: ScoutTailMetrics.rowHeight)
        .background(rowBackground)
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(isSelected ? ScoutPalette.accent : event.kind.tint.opacity(isHovering ? 0.55 : 0.26))
                .frame(width: isSelected ? 2 : 1)
        }
        .overlay(alignment: .bottom) {
            HudDivider(color: ScoutDesign.hairline)
        }
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

    private var projectSessionCell: some View {
        HStack(spacing: HudSpacing.xxs) {
            ScoutTailHoverAction(
                title: event.projectLabel,
                copyValue: event.cwd,
                copyHelp: "Copy project path",
                actionHelp: "Reveal project in Finder",
                tint: ScoutPalette.muted,
                activeTint: ScoutPalette.accent,
                truncationMode: .middle,
                action: scoutTailCopyable(event.cwd) == nil ? nil : { scoutTailRevealPath(event.cwd) }
            )
            .frame(maxWidth: .infinity, alignment: .leading)

            Text("·")
                .font(HudFont.mono(HudTextSize.sm))
                .foregroundStyle(ScoutPalette.dim)

            ScoutTailHoverAction(
                title: event.sessionShortLabel,
                copyValue: event.sessionId,
                copyHelp: "Copy session ID",
                actionHelp: "Open session",
                tint: ScoutPalette.dim,
                activeTint: ScoutPalette.accent,
                truncationMode: .tail,
                action: scoutTailCopyable(event.sessionId) == nil ? nil : onOpenSession
            )
            .frame(width: 72, alignment: .leading)
        }
    }

    private var pidCell: some View {
        ScoutTailHoverAction(
            title: event.pidLabel,
            copyValue: event.pid > 0 ? "\(event.pid)" : nil,
            copyHelp: "Copy PID",
            actionHelp: "Copy PID",
            tint: ScoutPalette.dim,
            activeTint: ScoutPalette.accent,
            truncationMode: .tail,
            action: event.pid > 0 ? { scoutTailCopy("\(event.pid)") } : nil
        )
    }

    @ViewBuilder
    private var agentCell: some View {
        if let activeAgent {
            ScoutTailHoverAction(
                title: activeAgent.displayName,
                copyValue: activeAgent.id,
                copyHelp: "Copy agent ID",
                actionHelp: "Open agent observe",
                tint: ScoutPalette.muted,
                activeTint: ScoutPalette.statusInfo,
                truncationMode: .tail,
                action: { onOpenAgent(activeAgent) }
            )
        } else {
            Text("—")
                .font(HudFont.mono(HudTextSize.sm))
                .foregroundStyle(ScoutPalette.dim)
                .lineLimit(1)
        }
    }

    private var rowBackground: Color {
        if isSelected {
            return ScoutSurface.selected(ScoutPalette.accent)
        }
        if isHovering {
            return ScoutSurface.hover
        }
        if isAlternating {
            return ScoutSurface.inset.opacity(0.44)
        }
        return Color.clear
    }

    private func sourceColor(_ value: String) -> Color {
        var hash: UInt64 = 5381
        for byte in value.lowercased().utf8 {
            hash = (hash &* 33) &+ UInt64(byte)
        }
        return Color(hue: Double(hash % 360) / 360.0, saturation: 0.45, brightness: 0.86)
    }

    private func originColor(_ value: String) -> Color {
        switch value {
        case "scout-managed": return ScoutPalette.accent
        case "hudson-managed": return ScoutPalette.statusInfo
        default: return ScoutPalette.muted
        }
    }
}

private struct ScoutTailDetail: View {
    let event: ScoutTailEvent
    let activeAgent: ScoutAgent?
    let onOpenSession: () -> Void
    let onOpenAgent: (ScoutAgent) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            HStack(alignment: .top, spacing: HudSpacing.md) {
                Text(event.summary)
                    .font(HudFont.ui(HudTextSize.base))
                    .foregroundStyle(ScoutPalette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)

                openSessionButton
            }

            LazyVGrid(
                columns: [
                    GridItem(.fixed(96), alignment: .leading),
                    GridItem(.flexible(), alignment: .leading),
                ],
                alignment: .leading,
                spacing: HudSpacing.sm
            ) {
                detail("Event", event.id, copyValue: event.id)
                detail(
                    "Session",
                    event.sessionId,
                    copyValue: event.sessionId,
                    actionHelp: "Open session",
                    action: scoutTailCopyable(event.sessionId) == nil ? nil : onOpenSession
                )
                if let activeAgent {
                    detail(
                        "Agent",
                        activeAgent.displayName,
                        copyValue: activeAgent.id,
                        actionHelp: "Open agent observe",
                        action: { onOpenAgent(activeAgent) }
                    )
                }
                detail(
                    "Project",
                    event.projectLabel,
                    copyValue: event.cwd,
                    actionHelp: "Reveal project in Finder",
                    action: scoutTailCopyable(event.cwd) == nil ? nil : { scoutTailRevealPath(event.cwd) }
                )
                detail(
                    "CWD",
                    event.cwd,
                    copyValue: event.cwd,
                    actionHelp: "Reveal in Finder",
                    action: scoutTailCopyable(event.cwd) == nil ? nil : { scoutTailRevealPath(event.cwd) }
                )
                detail("Origin", event.originLabel, copyValue: event.originLabel)
                detail("PID", event.parentPid.map { "\(event.pid) <- \($0)" } ?? "\(event.pid)", copyValue: event.pid > 0 ? "\(event.pid)" : nil)
                detail("Age", event.ageLabel)
            }
        }
        .padding(.horizontal, ScoutTailMetrics.pageGutter)
        .padding(.vertical, HudSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ScoutSurface.inset)
        .overlay(alignment: .bottom) {
            HudDivider(color: ScoutDesign.hairlineStrong)
        }
    }

    private var openSessionButton: some View {
        Button(action: onOpenSession) {
            HStack(spacing: HudSpacing.xs) {
                Image(systemName: "waveform.path.ecg")
                Text("Open session")
            }
            .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
            .foregroundStyle(ScoutPalette.accent)
            .padding(.horizontal, HudSpacing.md)
            .padding(.vertical, HudSpacing.xs)
            .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(ScoutPalette.accentSoft))
            .overlay(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).stroke(ScoutPalette.accent.opacity(0.25), lineWidth: HudStrokeWidth.thin))
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .disabled(event.sessionId.isEmpty)
        .opacity(event.sessionId.isEmpty ? 0.4 : 1)
        .help("Open the full session in a viewer")
        .fixedSize()
    }

    @ViewBuilder
    private func detail(
        _ label: String,
        _ value: String,
        copyValue: String? = nil,
        actionHelp: String? = nil,
        action: (() -> Void)? = nil
    ) -> some View {
        Text(label.uppercased())
            .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
            .foregroundStyle(ScoutPalette.dim)
        ScoutTailDetailValue(
            value: value,
            copyValue: copyValue,
            actionHelp: actionHelp,
            action: action
        )
    }
}

private enum ScoutTailMetrics {
    static let pageGutter: CGFloat = 20
    static let rowHeight: CGFloat = 30
    static let controlHeight: CGFloat = 26
    static let columnGap: CGFloat = 8
}

private enum ScoutTailColumns {
    static let time: CGFloat = 68
    static let source: CGFloat = 76
    static let origin: CGFloat = 62
    static let context: CGFloat = 220
    static let pid: CGFloat = 70
    static let agent: CGFloat = 96
    static let kind: CGFloat = 54
}

private struct ScoutTailHoverAction: View {
    let title: String
    let copyValue: String?
    let copyHelp: String
    let actionHelp: String
    let tint: Color
    let activeTint: Color
    let truncationMode: Text.TruncationMode
    var lineLimit: Int = 1
    let action: (() -> Void)?

    @State private var isHovering = false

    private var cleanCopyValue: String? {
        scoutTailCopyable(copyValue)
    }

    var body: some View {
        HStack(spacing: HudSpacing.xxs) {
            actionLabel
                .frame(maxWidth: .infinity, alignment: .leading)

            Button {
                scoutTailCopy(cleanCopyValue)
            } label: {
                Image(systemName: "doc.on.doc")
                    .font(HudFont.ui(HudTextSize.xxs, weight: .semibold))
                    .foregroundStyle(activeTint)
                    .frame(width: 16, height: 18)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(cleanCopyValue == nil)
            .opacity(isHovering && cleanCopyValue != nil ? 1 : 0)
            .help(copyHelp)
            .scoutPointerCursor()
        }
        .onHover { isHovering = $0 }
        .animation(.easeOut(duration: 0.10), value: isHovering)
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
            .font(HudFont.mono(HudTextSize.sm, weight: .semibold))
            .foregroundStyle(isHovering && action != nil ? activeTint : tint)
            .lineLimit(lineLimit)
            .truncationMode(truncationMode)
            .contentShape(Rectangle())
    }
}

private struct ScoutTailDetailValue: View {
    let value: String
    let copyValue: String?
    let actionHelp: String?
    let action: (() -> Void)?

    var body: some View {
        ScoutTailHoverAction(
            title: displayValue,
            copyValue: copyValue ?? value,
            copyHelp: "Copy value",
            actionHelp: actionHelp ?? "Open",
            tint: ScoutPalette.muted,
            activeTint: ScoutPalette.accent,
            truncationMode: .middle,
            lineLimit: 2,
            action: action
        )
    }

    private var displayValue: String {
        scoutTailCopyable(value) ?? "—"
    }
}

private struct ScoutTailChip: View {
    let text: String
    let tint: Color

    init(_ text: String, tint: Color) {
        self.text = text
        self.tint = tint
    }

    var body: some View {
        Text(text)
            .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
            .foregroundStyle(tint)
            .lineLimit(1)
            .truncationMode(.tail)
            .padding(.horizontal, HudSpacing.sm)
            .frame(height: 18)
            .background(RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous).fill(HudSurface.tint(tint, opacity: 0.08)))
            .overlay(RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous).stroke(HudSurface.tintBorder(tint), lineWidth: HudStrokeWidth.standard))
    }
}

private struct ScoutTailHeaderMetric: View {
    let value: String
    let label: String
    let tint: Color

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.xxs) {
            Text(value)
                .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
                .monospacedDigit()
                .lineLimit(1)

            Text(label)
                .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                .foregroundStyle(ScoutPalette.dim)
                .lineLimit(1)
        }
        .padding(.horizontal, HudSpacing.sm)
        .frame(height: 22)
        .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(ScoutSurface.control))
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .stroke(tint.opacity(0.26), lineWidth: HudStrokeWidth.standard)
        )
    }
}

private struct ScoutTailLivePill: View {
    let isLive: Bool

    private var tint: Color {
        isLive ? ScoutPalette.statusOk : ScoutPalette.muted
    }

    var body: some View {
        HStack(spacing: HudSpacing.xs) {
            Circle()
                .fill(tint)
                .frame(width: HudDotSize.tiny, height: HudDotSize.tiny)
            Text(isLive ? "Live" : "Paused")
                .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
        }
        .foregroundStyle(tint)
        .padding(.horizontal, HudSpacing.sm)
        .frame(height: 22)
        .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(HudSurface.tint(tint, opacity: 0.10)))
        .overlay(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).stroke(HudSurface.tintBorder(tint), lineWidth: HudStrokeWidth.standard))
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
                .stroke(isFocused ? ScoutPalette.accent.opacity(0.70) : (isHovering ? ScoutDesign.hairlineStrong : ScoutDesign.hairline), lineWidth: isFocused ? HudFocus.ringWidth : HudStrokeWidth.standard)
        )
        .contentShape(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous))
        .onHover { isHovering = $0 }
        .animation(.easeOut(duration: 0.10), value: isHovering)
        .animation(.easeOut(duration: 0.10), value: isFocused)
        .accessibilityLabel("Search tail events")
    }
}

private struct ScoutTailFilterMenu<MenuItems: View>: View {
    let value: String
    let icon: String
    let tint: Color
    let width: CGFloat
    @ViewBuilder let menuItems: () -> MenuItems

    @State private var isHovering = false

    var body: some View {
        Menu {
            menuItems()
        } label: {
            HStack(spacing: HudSpacing.xs) {
                Image(systemName: icon)
                    .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(tint)
                    .frame(width: 14)

                Text(value)
                    .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                    .foregroundStyle(ScoutPalette.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)

                Spacer(minLength: HudSpacing.xs)

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
                    .stroke(isHovering ? ScoutDesign.hairlineStrong : ScoutDesign.hairline, lineWidth: HudStrokeWidth.standard)
            )
        }
        .menuStyle(.borderlessButton)
        .buttonStyle(.plain).scoutPointerCursor()
        .onHover { isHovering = $0 }
        .animation(.easeOut(duration: 0.10), value: isHovering)
    }
}

private struct ScoutTailToolbarButton: View {
    let title: String
    let icon: String
    let isActive: Bool
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
            .foregroundStyle(isActive ? ScoutPalette.ink : ScoutPalette.muted)
            .padding(.horizontal, HudSpacing.md)
            .frame(height: ScoutTailMetrics.controlHeight)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .fill(isHovering ? ScoutSurface.hover : ScoutSurface.control)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .stroke(isActive ? ScoutSurface.tintBorder(ScoutPalette.accent) : ScoutDesign.hairline, lineWidth: HudStrokeWidth.standard)
            )
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .help(title)
        .onHover { isHovering = $0 }
        .animation(.easeOut(duration: 0.10), value: isHovering)
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
                .foregroundStyle(isHovering ? ScoutPalette.ink : ScoutPalette.muted)
                .frame(width: ScoutTailMetrics.controlHeight, height: ScoutTailMetrics.controlHeight)
                .background(
                    RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                        .fill(isHovering ? ScoutSurface.hover : Color.clear)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                        .stroke(isHovering ? ScoutDesign.hairlineStrong : ScoutDesign.hairline, lineWidth: HudStrokeWidth.standard)
                )
        }
        .buttonStyle(.plain).scoutPointerCursor()
        .help(title)
        .accessibilityLabel(title)
        .onHover { isHovering = $0 }
        .animation(.easeOut(duration: 0.10), value: isHovering)
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
