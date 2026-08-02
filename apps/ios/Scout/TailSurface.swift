import SwiftUI
import Foundation
import HudsonUI
import ScoutCapabilities

/// Tail — the cross-agent file log. The default renderer groups consecutive
/// events from one origin into compact bursts: provenance appears once, then the
/// log gets the full phone width. The original flat line renderer remains
/// available in Settings. Events are oldest → newest and the viewport follows
/// the bottom until the reader scrolls away, then becomes explicitly detached.
struct TailSurface: View {
    let model: AppModel
    let isActive: Bool
    var reloadToken: Int = 0

    /// Match `tail -n 50`: seed with a useful historical window, retain that
    /// bounded window, and then keep replacing its oldest rows as new ones land.
    private static let maxRows = 50
    private static let pollIntervalSeconds: Double = 5
    private static let bottomAnchorID = "tail-bottom"
    private static let scrollSpace = "tail-scroll-space"
    private static let bottomTolerance: CGFloat = 24

    @State private var events: [MachineTailEvent] = []
    @State private var lastUpdated: Date?
    @State private var hasLoadedInitialSnapshot = false
    @State private var failedMachineReads = 0
    @State private var isFetching = false
    @State private var isFollowing = true
    @State private var isAutoScrolling = false
    @State private var autoScrollGeneration = 0
    @State private var scrollToBottomToken = 0
    @State private var refreshToken = 0
    @AppStorage(ScoutTailLayout.storageKey) private var layoutRaw = ScoutTailLayout.default.rawValue
    @StateObject private var entrance = CockpitEntrancePhase()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private struct MachineTailEvent: Identifiable {
        let id: String
        let machineId: String
        let machineName: String
        let event: TailEvent
    }

    private struct TailBurst: Identifiable {
        let id: String
        let originKey: String
        var endMs: Int64
        var rows: [MachineTailEvent]

        var startMs: Int64 { rows.first?.event.tsMs ?? endMs }
    }

    private var layout: ScoutTailLayout { ScoutTailLayout.resolve(layoutRaw) }

    /// Derived on render from the same ordered event window used by the flat
    /// view. Adjacency is intentional: sources never jump across an intervening
    /// event. Time does not split a burst—the provenance changes only when the
    /// actual origin changes, which is the space-saving promise of this layout.
    private var bursts: [TailBurst] {
        var result: [TailBurst] = []
        for row in events {
            let key = originKey(for: row)
            if var last = result.last,
               last.originKey == key,
               row.event.tsMs >= last.endMs {
                last.rows.append(row)
                last.endMs = row.event.tsMs
                result[result.count - 1] = last
            } else {
                result.append(
                    TailBurst(
                        id: row.id,
                        originKey: key,
                        endMs: row.event.tsMs,
                        rows: [row]
                    )
                )
            }
        }
        return result
    }

    private var reloadKey: String {
        let filter: String
        switch model.machineFilter {
        case .all: filter = "all"
        case .machine(let id): filter = id
        }
        return "\(reloadToken).\(model.fleetRevision).\(filter)"
    }

    private static let hmFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    private static let clockFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "HH:mm:ss"
        return formatter
    }()

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
                .padding(.horizontal, HudSpacing.xxl)
                .padding(.bottom, HudSpacing.lg)
                .cockpitEntrance(index: 0, phase: entrance)

            content
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .task(id: "\(reloadKey)|\(isActive)") {
            guard isActive else { return }
            await poll()
        }
        .task(id: "\(refreshToken)|\(isActive)") {
            if isActive, refreshToken != 0 { await fetchOnce() }
        }
    }

    private var header: some View {
        HStack(spacing: HudSpacing.sm) {
            ScoutSectionLabel("Tail")
            Spacer(minLength: HudSpacing.sm)
            if let lastUpdated {
                Text("updated \(Self.hmFormatter.string(from: lastUpdated))")
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutInk.dim)
            }
            if failedMachineReads > 0 {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(ScoutPalette.statusWarn)
                    .accessibilityLabel("Some tail sources could not be refreshed")
            }
            followState
            Button { refreshToken += 1 } label: {
                Text("↻")
                    .font(.system(size: 14, weight: .semibold, design: .monospaced))
                    .foregroundStyle(ScoutInk.muted)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Refresh tail")
        }
    }

    @ViewBuilder
    private var followState: some View {
        if !hasLoadedInitialSnapshot {
            Text("Loading")
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(ScoutInk.dim)
                .accessibilityLabel("Loading recent tail events")
        } else if isFollowing {
            HStack(spacing: 5) {
                Circle()
                    .fill(ScoutPalette.statusOk)
                    .frame(width: 5, height: 5)
                Text("Following")
            }
            .font(HudFont.mono(HudTextSize.micro))
            .foregroundStyle(ScoutInk.muted)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Following latest tail events")
        } else {
            Button(action: resumeFollowing) {
                HStack(spacing: 5) {
                    Circle()
                        .fill(ScoutPalette.statusWarn)
                        .frame(width: 5, height: 5)
                    Text("Detached")
                }
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(ScoutInk.muted)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Detached from latest tail events")
            .accessibilityHint("Jumps to the newest event and resumes following")
            .frame(minHeight: 44)
        }
    }

    @ViewBuilder
    private var content: some View {
        if events.isEmpty {
            ScoutEmptyState(
                title: hasLoadedInitialSnapshot ? "No recent activity" : "Loading recent activity",
                subtitle: hasLoadedInitialSnapshot
                    ? "Cross-agent events will appear here."
                    : "Reading the latest 50 lines.",
                icon: "waveform"
            )
            .padding(HudSpacing.xxl)
            .cockpitEntrance(
                index: 1,
                phase: entrance,
                motionEnabled: hasLoadedInitialSnapshot
            )
            Spacer(minLength: 0)
        } else {
            GeometryReader { viewport in
                ScrollViewReader { proxy in
                    ScrollView(.vertical, showsIndicators: false) {
                        LazyVStack(
                            alignment: .leading,
                            spacing: 0,
                            pinnedViews: layout == .rethought ? [.sectionHeaders] : []
                        ) {
                            if layout == .rethought {
                                ForEach(Array(bursts.enumerated()), id: \.element.id) { index, burst in
                                    burstSection(burst)
                                        .id(burst.id)
                                        .cockpitEntrance(index: index + 1, phase: entrance)
                                }
                            } else {
                                ForEach(Array(events.enumerated()), id: \.element.id) { index, row in
                                    refinedLogRow(row)
                                        .id(row.id)
                                        .cockpitEntrance(index: index + 1, phase: entrance)
                                }
                            }
                            bottomMarker
                        }
                        .padding(.horizontal, HudSpacing.xxl)
                        .padding(.bottom, HudSpacing.xxl)
                    }
                    .coordinateSpace(name: Self.scrollSpace)
                    .onAppear {
                        guard isFollowing else { return }
                        scrollToBottom(using: proxy, animated: false)
                    }
                    .onChange(of: layoutRaw) { _, _ in
                        // A renderer swap changes the list height without any
                        // reader gesture. Keep an attached reader attached; a
                        // deliberately detached reader stays exactly where it is.
                        guard isFollowing else { return }
                        isAutoScrolling = true
                        Task { @MainActor in
                            await Task.yield()
                            requestScrollToBottom()
                        }
                    }
                    .onChange(of: scrollToBottomToken) { _, _ in
                        scrollToBottom(using: proxy, animated: false)
                    }
                    .onPreferenceChange(TailBottomOffsetPreferenceKey.self) { bottomY in
                        updateFollowState(bottomY: bottomY, viewportHeight: viewport.size.height)
                    }
                    .overlay(alignment: .bottomTrailing) {
                        if !isFollowing {
                            resumeButton
                                .padding(HudSpacing.lg)
                        }
                    }
                }
            }
        }
    }

    private func refinedLogRow(_ row: MachineTailEvent) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.xs) {
            Text(timeLabel(row.event.tsMs))
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(ScoutInk.dim)
                .frame(width: 47, alignment: .leading)
            handleText(row.event)
                .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(width: 82, alignment: .leading)
            Text(kindGlyph(row.event.kind))
                .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                .foregroundStyle(kindColor(row.event.kind))
                .fixedSize()
            Text(row.event.summary)
                .font(HudFont.mono(HudTextSize.xs))
                .foregroundStyle(ScoutPalette.ink)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, HudSpacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) {
            HudDivider(color: ScoutHairline.subtle)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(timeLabel(row.event.tsMs)), \(projectRootedPath(cwd: row.event.cwd, project: row.event.project)), \(row.event.summary)")
    }

    private func burstSection(_ burst: TailBurst) -> some View {
        Section {
            VStack(alignment: .leading, spacing: HudSpacing.xxs) {
                ForEach(burst.rows) { row in
                    HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
                        Text(kindGlyph(row.event.kind))
                            .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                            .foregroundStyle(kindColor(row.event.kind))
                            .frame(width: 12, alignment: .center)
                        Text(row.event.summary)
                            .font(HudFont.mono(HudTextSize.xs))
                            .foregroundStyle(ScoutPalette.ink)
                            .lineLimit(3)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.vertical, HudSpacing.xxs)
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(kindAccessibilityLabel(row.event.kind)): \(row.event.summary)")
                }
            }
            .padding(.leading, HudSpacing.xxs)
            .padding(.bottom, HudSpacing.xs)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .bottom) {
                HudDivider(color: ScoutHairline.subtle)
            }
            .accessibilityElement(children: .contain)
        } header: {
            burstHeader(burst)
                .padding(.top, HudSpacing.sm)
                .padding(.bottom, HudSpacing.xxs)
                .background(ScoutPalette.bg)
                .zIndex(1)
        }
    }

    private func burstHeader(_ burst: TailBurst) -> some View {
        let first = burst.rows[0]
        let count = burst.rows.count
        return HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
            Text(burstTimeLabel(burst))
                .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                .foregroundStyle(ScoutInk.dim)
                .fixedSize(horizontal: true, vertical: false)
            handleText(first.event)
                .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: HudSpacing.xs)
            if count > 1 {
                Text("\(count) events")
                    .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                    .foregroundStyle(ScoutInk.dim)
                    .fixedSize()
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "\(burstTimeLabel(burst)), \(sourceDescription(for: first)), \(count) event\(count == 1 ? "" : "s")"
        )
    }

    /// `/project-rooted-path:sessionlast4` — e.g. `/openscout:9688`.
    private func handleText(_ event: TailEvent) -> Text {
        let path = projectRootedPath(cwd: event.cwd, project: event.project)
        let base = Text(path).foregroundStyle(ScoutPalette.ink)
        let last4 = String((event.conversationId ?? "").suffix(4))
        guard !last4.isEmpty else { return base }
        let session = Text(":\(last4)").foregroundStyle(ScoutInk.muted)
        return Text("\(base)\(session)")
    }

    private func originKey(for row: MachineTailEvent) -> String {
        [
            row.machineId,
            row.event.source,
            projectRootedPath(cwd: row.event.cwd, project: row.event.project),
            row.event.conversationId ?? ""
        ].joined(separator: "\u{1f}")
    }

    private func sourceDescription(for row: MachineTailEvent) -> String {
        let handle = projectRootedPath(cwd: row.event.cwd, project: row.event.project)
        let session = String((row.event.conversationId ?? "").suffix(4))
        let renderedHandle = session.isEmpty ? handle : "\(handle):\(session)"
        return "\(renderedHandle), \(row.event.source), on \(row.machineName)"
    }

    private func projectRootedPath(cwd: String?, project: String?) -> String {
        if let project, !project.isEmpty, let cwd, let range = cwd.range(of: "/" + project) {
            return String(cwd[range.lowerBound...])
        }
        if let project, !project.isEmpty { return "/" + project }
        if let cwd, !cwd.isEmpty {
            return "/" + cwd.split(separator: "/").suffix(2).joined(separator: "/")
        }
        return "—"
    }

    private func kindGlyph(_ kind: TailEvent.Kind) -> String {
        switch kind {
        case .user: return ">"
        case .assistant: return "<"
        case .tool: return "*"
        case .toolResult: return "="
        case .system: return "~"
        case .other: return "·"
        }
    }

    private func kindColor(_ kind: TailEvent.Kind) -> Color {
        switch kind {
        case .user: return ScoutPalette.statusInfo
        case .assistant: return ScoutPalette.statusOk
        case .tool: return ScoutPalette.statusWarn
        case .toolResult: return ScoutPalette.accent
        case .system: return ScoutInk.muted
        case .other: return ScoutInk.dim
        }
    }

    private func kindAccessibilityLabel(_ kind: TailEvent.Kind) -> String {
        switch kind {
        case .user: "operator"
        case .assistant: "agent"
        case .tool: "tool call"
        case .toolResult: "tool result"
        case .system: "system"
        case .other: "event"
        }
    }

    private func timeLabel(_ tsMs: Int64) -> String {
        Self.clockFormatter.string(from: Date(timeIntervalSince1970: Double(tsMs) / 1_000))
    }

    private func burstTimeLabel(_ burst: TailBurst) -> String {
        let start = timeLabel(burst.startMs)
        let end = timeLabel(burst.endMs)
        guard start != end else { return start }
        let startPrefix = String(start.prefix(6))
        if end.hasPrefix(startPrefix) {
            return "\(start)–\(end.suffix(2))"
        }
        return "\(start)–\(end)"
    }

    private var bottomMarker: some View {
        Color.clear
            .frame(height: 1)
            .id(Self.bottomAnchorID)
            .background {
                GeometryReader { marker in
                    Color.clear.preference(
                        key: TailBottomOffsetPreferenceKey.self,
                        value: marker.frame(in: .named(Self.scrollSpace)).maxY
                    )
                }
            }
    }

    private var resumeButton: some View {
        Button(action: resumeFollowing) {
            Label("Resume", systemImage: "arrow.down.to.line")
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ScoutPalette.ink)
                .padding(.horizontal, HudSpacing.md)
                .frame(minWidth: 88, minHeight: 44)
                .background(Capsule().fill(ScoutSurface.raised))
                .overlay(Capsule().strokeBorder(ScoutPalette.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityHint("Jumps to the newest event and resumes following")
    }

    private func resumeFollowing() {
        isFollowing = true
        requestScrollToBottom()
    }

    private func requestScrollToBottom() {
        isAutoScrolling = true
        autoScrollGeneration += 1
        let generation = autoScrollGeneration
        scrollToBottomToken += 1

        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(350))
            guard autoScrollGeneration == generation else { return }
            isAutoScrolling = false
        }
    }

    private func scrollToBottom(using proxy: ScrollViewProxy, animated: Bool) {
        if animated {
            withAnimation(.easeOut(duration: 0.2)) {
                proxy.scrollTo(Self.bottomAnchorID, anchor: .bottom)
            }
        } else {
            proxy.scrollTo(Self.bottomAnchorID, anchor: .bottom)
        }
    }

    private func updateFollowState(bottomY: CGFloat, viewportHeight: CGFloat) {
        guard bottomY.isFinite, viewportHeight > 0 else { return }
        let isAtBottom = bottomY <= viewportHeight + Self.bottomTolerance
        if isAtBottom {
            isFollowing = true
            isAutoScrolling = false
        } else if !isAutoScrolling {
            isFollowing = false
        }
    }

    private func poll() async {
        await fetchOnce()
        await entrance.reveal(when: isActive, animated: !reduceMotion)
        while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(Self.pollIntervalSeconds))
            if Task.isCancelled { break }
            await fetchOnce()
        }
    }

    private func fetchOnce() async {
        guard !isFetching else { return }
        isFetching = true
        defer { isFetching = false }

        let machines = model.agentMachines()
        var snapshot: [MachineTailEvent] = []
        var successfulMachineIDs: Set<String> = []
        var failedMachineIDs: Set<String> = []

        for machine in machines {
            guard let client = machine.client else {
                failedMachineIDs.insert(machine.id)
                continue
            }
            do {
                let rows = try await client.recentTail(limit: Self.maxRows)
                guard !Task.isCancelled else { return }
                successfulMachineIDs.insert(machine.id)
                snapshot.append(contentsOf: rows.map { event in
                    MachineTailEvent(
                        id: "\(machine.id)::\(event.id)",
                        machineId: machine.id,
                        machineName: machine.name,
                        event: event
                    )
                })
            } catch {
                failedMachineIDs.insert(machine.id)
            }
        }
        guard !Task.isCancelled else { return }

        if machines.isEmpty {
            events = []
            failedMachineReads = 0
            return
        }
        guard !successfulMachineIDs.isEmpty else {
            failedMachineReads = failedMachineIDs.count
            return
        }

        if !failedMachineIDs.isEmpty {
            snapshot.append(contentsOf: events.filter { failedMachineIDs.contains($0.machineId) })
        }

        let newestFirst = snapshot.sorted {
            if $0.event.tsMs == $1.event.tsMs { return $0.id > $1.id }
            return $0.event.tsMs > $1.event.tsMs
        }
        let nextEvents = Array(newestFirst.prefix(Self.maxRows).reversed())
        let didChange = nextEvents.map(\.id) != events.map(\.id)
        let isInitialSnapshot = !hasLoadedInitialSnapshot
        let shouldKeepFollowing = isFollowing || isInitialSnapshot

        if didChange {
            events = nextEvents
        }
        hasLoadedInitialSnapshot = true
        if shouldKeepFollowing {
            isFollowing = true
            // Schedule after the event rows have entered the view hierarchy.
            Task { @MainActor in
                await Task.yield()
                requestScrollToBottom()
            }
        }
        failedMachineReads = failedMachineIDs.count
        lastUpdated = Date()
    }
}

private struct TailBottomOffsetPreferenceKey: PreferenceKey {
    static let defaultValue: CGFloat = .greatestFiniteMagnitude

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}
