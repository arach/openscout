import AppKit
import HudsonUI
import SwiftUI

struct ScoutTailContent: View {
    @ObservedObject var tail: ScoutTailStore

    @State private var selectedEventId: String?

    private var visibleEvents: [ScoutTailEvent] {
        tail.filteredEvents
    }

    private var latestEvent: ScoutTailEvent? {
        visibleEvents.last ?? tail.events.last
    }

    var body: some View {
        VStack(spacing: 0) {
            header
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
        .background(ScoutDesign.bg)
        .overlay(alignment: .bottom) {
            HudDivider(color: ScoutDesign.hairlineStrong)
        }
    }

    private var titleCluster: some View {
        HStack(spacing: HudSpacing.sm) {
            Text("Tail")
                .font(HudFont.ui(HudTextSize.xl, weight: .semibold))
                .foregroundStyle(HudPalette.ink)

            ScoutTailLivePill(isLive: tail.isFollowing)

            HStack(spacing: HudSpacing.xxs) {
                Text("\(tail.discovery?.totals.transcripts ?? tail.sessionCount)")
                    .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(HudPalette.ink)
                    .monospacedDigit()
                Text("logs")
                    .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                    .foregroundStyle(HudPalette.dim)
            }

            HStack(spacing: HudSpacing.xxs) {
                Text("\(tail.discovery?.totals.total ?? 0)")
                    .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(HudPalette.muted)
                    .monospacedDigit()
                Text("procs")
                    .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                    .foregroundStyle(HudPalette.dim)
            }

            Text(tail.liveRateLabel)
                .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                .foregroundStyle(HudPalette.muted)

            if tail.isLoading {
                ProgressView()
                    .controlSize(.small)
                    .scaleEffect(0.86)
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    private var filterStrip: some View {
        HStack(spacing: HudSpacing.sm) {
            ScoutTailSearchField(text: $tail.query)
                .frame(width: 264)

            sourceMenu
            kindMenu
        }
        .layoutPriority(2)
    }

    private var sourceMenu: some View {
        ScoutTailFilterMenu(
            value: tail.selectedSource ?? "All sources",
            icon: tail.selectedSource == nil ? "tray.full" : "dot.radiowaves.left.and.right",
            tint: tail.selectedSource == nil ? HudPalette.muted : HudPalette.accent,
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

    private var kindMenu: some View {
        ScoutTailFilterMenu(
            value: tail.selectedKind?.title ?? "All kinds",
            icon: "tag",
            tint: tail.selectedKind?.tint ?? HudPalette.muted,
            width: 126
        ) {
            Button {
                tail.selectedKind = nil
            } label: {
                Label("All kinds", systemImage: tail.selectedKind == nil ? "checkmark" : "tag")
            }
            Divider()
            ForEach(ScoutTailEventKind.allCases) { kind in
                Button {
                    tail.selectedKind = kind
                } label: {
                    Label(kind.title, systemImage: tail.selectedKind == kind ? "checkmark" : "circle")
                }
            }
        }
        .help("Filter by event kind")
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
        .foregroundStyle(HudPalette.statusError)
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
                .fill(tail.isFollowing ? HudPalette.statusOk : HudPalette.muted)
                .frame(width: HudDotSize.small, height: HudDotSize.small)

            Text(tail.isFollowing ? "Following tail" : "Tail paused")
                .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                .foregroundStyle(tail.isFollowing ? HudPalette.ink : HudPalette.muted)

            Text("\(tail.lastBatchCount) new")
                .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                .foregroundStyle(tail.lastBatchCount > 0 ? HudPalette.accent : HudPalette.dim)
                .monospacedDigit()

            if let latestEvent {
                Text("latest")
                    .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                    .foregroundStyle(HudPalette.dim)
                Text(latestEvent.clockLabel)
                    .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(HudPalette.muted)
                    .monospacedDigit()
                Text(latestEvent.sourceLabel)
                    .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(HudPalette.muted)
                    .lineLimit(1)
            } else {
                Text("waiting")
                    .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                    .foregroundStyle(HudPalette.dim)
            }

            Spacer(minLength: 0)

            Text("\(visibleEvents.count) / \(tail.events.count) lines buffered")
                .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                .foregroundStyle(HudPalette.dim)
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
                    .foregroundStyle(HudPalette.muted)
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
                    LazyVStack(spacing: 0) {
                        ScoutTailHeaderRow()
                        ForEach(visibleEvents) { event in
                            ScoutTailRow(
                                event: event,
                                isSelected: selectedEventId == event.id
                            ) {
                                selectedEventId = selectedEventId == event.id ? nil : event.id
                            }
                            .id(event.id)

                            if selectedEventId == event.id {
                                ScoutTailDetail(event: event)
                                    .transition(.opacity.combined(with: .move(edge: .top)))
                            }
                        }
                    }
                    .padding(.bottom, HudSpacing.xxl)
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
        }
        .scrollIndicators(.visible)
    }

    private var coverage: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            ScoutTailInspectorTitle("Coverage")
            LazyVGrid(
                columns: [
                    GridItem(.flexible(), spacing: HudSpacing.md),
                    GridItem(.flexible(), spacing: HudSpacing.md),
                ],
                alignment: .leading,
                spacing: HudSpacing.md
            ) {
                metric("Logs", tail.discovery?.totals.transcripts ?? tail.sessionCount)
                metric("Processes", tail.discovery?.totals.total ?? 0)
                metric("Sessions", tail.sessionCount)
                metric("Buffered", tail.events.count)
            }

            HStack(spacing: HudSpacing.sm) {
                HudStatusDot(color: tail.isFollowing ? HudPalette.statusOk : HudPalette.muted)
                Text(tail.isFollowing ? "following live transcript tails" : "tail follow is paused")
                    .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                    .foregroundStyle(HudPalette.muted)
                    .lineLimit(2)
            }
        }
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
                .foregroundStyle(HudPalette.muted)
            Text("Metadata includes records like model, title, permission-mode, and last-prompt.")
                .font(HudFont.ui(HudTextSize.xs))
                .foregroundStyle(HudPalette.dim)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func track(_ label: String, _ detail: String) -> some View {
        VStack(alignment: .leading, spacing: HudSpacing.xxs) {
            Text(label)
                .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                .foregroundStyle(HudPalette.muted)
            Text(detail)
                .font(HudFont.ui(HudTextSize.xs))
                .foregroundStyle(HudPalette.dim)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, HudSpacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) {
            HudDivider(color: ScoutDesign.hairline)
        }
    }


    private func metric(_ label: String, _ value: Int) -> some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            Text(label.uppercased())
                .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                .foregroundStyle(HudPalette.dim)
            Text("\(value)")
                .font(HudFont.mono(HudTextSize.lg, weight: .semibold))
                .foregroundStyle(HudPalette.ink)
                .monospacedDigit()
        }
        .padding(.horizontal, HudSpacing.md)
        .padding(.vertical, HudSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(HudSurface.inset))
        .overlay(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).stroke(ScoutDesign.hairline, lineWidth: HudStrokeWidth.standard))
    }

    private func inventorySection(_ title: String, items: [ScoutTailCount], empty: String) -> some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            ScoutTailInspectorTitle(title)
            if items.isEmpty {
                Text(empty)
                    .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                    .foregroundStyle(HudPalette.dim)
            } else {
                ForEach(items) { item in
                    HStack(spacing: HudSpacing.md) {
                        Text(item.label)
                            .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                            .foregroundStyle(HudPalette.muted)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Spacer(minLength: HudSpacing.sm)
                        Text("\(item.count)")
                            .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                            .foregroundStyle(HudPalette.dim)
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
            .foregroundStyle(HudPalette.dim)
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
            Text("PROJECT")
                .frame(width: ScoutTailColumns.context, alignment: .leading)
            Text("PID")
                .frame(width: ScoutTailColumns.pid, alignment: .leading)
            Text("")
                .frame(width: ScoutTailColumns.glyph, alignment: .center)
            Text("SUMMARY")
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
        .foregroundStyle(HudPalette.muted)
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
    let isSelected: Bool
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: ScoutTailMetrics.columnGap) {
                Text(event.clockLabel)
                    .font(HudFont.mono(HudTextSize.sm))
                    .monospacedDigit()
                    .foregroundStyle(isSelected ? HudPalette.ink : HudPalette.dim)
                    .frame(width: ScoutTailColumns.time, alignment: .leading)

                ScoutTailChip(event.sourceLabel, tint: sourceColor(event.sourceLabel))
                    .frame(width: ScoutTailColumns.source, alignment: .leading)

                ScoutTailChip(event.originLabel, tint: originColor(event.harness))
                    .frame(width: ScoutTailColumns.origin, alignment: .leading)

                HStack(spacing: HudSpacing.xs) {
                    Text(event.projectLabel)
                        .font(HudFont.mono(HudTextSize.sm, weight: .semibold))
                        .foregroundStyle(HudPalette.muted)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Text("·")
                        .font(HudFont.mono(HudTextSize.sm))
                        .foregroundStyle(HudPalette.dim)
                    Text(event.sessionShortLabel)
                        .font(HudFont.mono(HudTextSize.sm))
                        .foregroundStyle(HudPalette.dim)
                        .lineLimit(1)
                }
                .frame(width: ScoutTailColumns.context, alignment: .leading)

                Text(event.pidLabel)
                    .font(HudFont.mono(HudTextSize.sm))
                    .foregroundStyle(HudPalette.dim)
                    .lineLimit(1)
                    .frame(width: ScoutTailColumns.pid, alignment: .leading)

                Text(event.kind.glyph)
                    .font(HudFont.mono(HudTextSize.sm, weight: .bold))
                    .foregroundStyle(event.kind.tint)
                    .frame(width: ScoutTailColumns.glyph, alignment: .center)

                Text(event.summary)
                    .font(HudFont.mono(HudTextSize.sm))
                    .foregroundStyle(isSelected ? HudPalette.ink : HudPalette.ink.opacity(0.78))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, ScoutTailMetrics.pageGutter)
            .frame(minHeight: ScoutTailMetrics.rowHeight)
            .background(rowBackground)
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(isSelected ? HudPalette.accent : Color.clear)
                    .frame(width: 2)
            }
            .overlay(alignment: .bottom) {
                HudDivider(color: ScoutDesign.hairline)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .contextMenu {
            Button("Copy event ID") {
                copy(event.id)
            }
            Button("Copy summary") {
                copy(event.summary)
            }
            Button("Copy session ID") {
                copy(event.sessionId)
            }
        }
    }

    private var rowBackground: Color {
        if isSelected {
            return HudSurface.selected(HudPalette.accent)
        }
        if isHovering {
            return HudSurface.hover
        }
        return Color.clear
    }

    private func copy(_ value: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(value, forType: .string)
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
        case "scout-managed": return HudPalette.accent
        case "hudson-managed": return HudPalette.statusInfo
        default: return HudPalette.muted
        }
    }
}

private struct ScoutTailDetail: View {
    let event: ScoutTailEvent

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            Text(event.summary)
                .font(HudFont.ui(HudTextSize.base))
                .foregroundStyle(HudPalette.ink)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)

            LazyVGrid(
                columns: [
                    GridItem(.fixed(96), alignment: .leading),
                    GridItem(.flexible(), alignment: .leading),
                ],
                alignment: .leading,
                spacing: HudSpacing.sm
            ) {
                detail("Event", event.id)
                detail("Session", event.sessionId)
                detail("Project", event.projectLabel)
                detail("CWD", event.cwd)
                detail("Origin", event.originLabel)
                detail("PID", event.parentPid.map { "\(event.pid) <- \($0)" } ?? "\(event.pid)")
                detail("Age", event.ageLabel)
            }
        }
        .padding(.horizontal, ScoutTailMetrics.pageGutter)
        .padding(.vertical, HudSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(HudSurface.inset)
        .overlay(alignment: .bottom) {
            HudDivider(color: ScoutDesign.hairlineStrong)
        }
    }

    @ViewBuilder
    private func detail(_ label: String, _ value: String) -> some View {
        Text(label.uppercased())
            .font(HudFont.mono(HudTextSize.xxs, weight: .semibold))
            .foregroundStyle(HudPalette.dim)
        Text(value)
            .font(HudFont.mono(HudTextSize.xs))
            .foregroundStyle(HudPalette.muted)
            .lineLimit(2)
            .truncationMode(.middle)
            .textSelection(.enabled)
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
    static let origin: CGFloat = 66
    static let context: CGFloat = 210
    static let pid: CGFloat = 48
    static let glyph: CGFloat = 18
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

private struct ScoutTailLivePill: View {
    let isLive: Bool

    private var tint: Color {
        isLive ? HudPalette.statusOk : HudPalette.muted
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
                .foregroundStyle(isFocused ? HudPalette.statusInfo : HudPalette.dim)

            TextField("Search", text: $text)
                .textFieldStyle(.plain)
                .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                .foregroundStyle(HudPalette.ink)
                .tint(HudPalette.accent)
                .focused($isFocused)
        }
        .padding(.horizontal, HudSpacing.md)
        .frame(height: ScoutTailMetrics.controlHeight)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .fill(isFocused ? HudSurface.controlHover(isHovering: true) : (isHovering ? HudSurface.hover : HudSurface.control))
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .stroke(isFocused ? HudFocus.ring : (isHovering ? ScoutDesign.hairlineStrong : ScoutDesign.hairline), lineWidth: isFocused ? HudFocus.ringWidth : HudStrokeWidth.standard)
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
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)

                Spacer(minLength: HudSpacing.xs)

                Image(systemName: "chevron.up.chevron.down")
                    .font(HudFont.ui(HudTextSize.micro, weight: .bold))
                    .foregroundStyle(HudPalette.dim)
            }
            .padding(.horizontal, HudSpacing.sm)
            .frame(width: width, height: ScoutTailMetrics.controlHeight)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .fill(isHovering ? HudSurface.hover : HudSurface.control)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .stroke(isHovering ? ScoutDesign.hairlineStrong : ScoutDesign.hairline, lineWidth: HudStrokeWidth.standard)
            )
        }
        .menuStyle(.borderlessButton)
        .buttonStyle(.plain)
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
            .foregroundStyle(isActive ? HudPalette.ink : HudPalette.muted)
            .padding(.horizontal, HudSpacing.md)
            .frame(height: ScoutTailMetrics.controlHeight)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .fill(isHovering ? HudSurface.hover : HudSurface.control)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                    .stroke(isActive ? HudSurface.tintBorder(HudPalette.accent) : ScoutDesign.hairline, lineWidth: HudStrokeWidth.standard)
            )
        }
        .buttonStyle(.plain)
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
                .foregroundStyle(isHovering ? HudPalette.ink : HudPalette.muted)
                .frame(width: ScoutTailMetrics.controlHeight, height: ScoutTailMetrics.controlHeight)
                .background(
                    RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                        .fill(isHovering ? HudSurface.hover : Color.clear)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                        .stroke(isHovering ? ScoutDesign.hairlineStrong : ScoutDesign.hairline, lineWidth: HudStrokeWidth.standard)
                )
        }
        .buttonStyle(.plain)
        .help(title)
        .accessibilityLabel(title)
        .onHover { isHovering = $0 }
        .animation(.easeOut(duration: 0.10), value: isHovering)
    }
}
