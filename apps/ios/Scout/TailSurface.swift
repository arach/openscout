import SwiftUI
import Foundation
import HudsonUI
import ScoutCapabilities

/// Tail — the cross-agent file log. The default renderer groups consecutive
/// events from one origin into compact bursts: provenance appears once, then the
/// log gets the full phone width. The original flat line renderer remains
/// available in Settings. Events are oldest → newest and the viewport follows
/// the bottom until the reader scrolls away, then becomes explicitly detached.
///
/// HEADER OWNERSHIP — this surface owns its one context line, and no shell
/// repeats it. The line is not a static label: it carries the surface's own
/// live state (last refresh, attached/detached, the refresh control), all of
/// which is `@State` in here. A shell bar could only render that by lifting
/// three pieces of state out through bindings, and TailSurface has three mount
/// sites (the v1 tab, the v1 crown sheet, the v3 Logs tab) that would each have
/// to re-implement it. So the surface labels itself everywhere, and the v3
/// shell drops its `.logs` sub bar (see V3RootView) instead of printing
/// "FLEET TAIL · all agents" directly above "TAIL · updated HH:MM".
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
    /// Paired Macs the last fetch read from (online *and* offline — an offline
    /// Mac's rows are retained in the window, so it still counts as a host you
    /// can be looking at). Drives every host cue below: on a one-Mac fleet the
    /// host is a constant, and a constant printed on every line is pure noise.
    @State private var hostsInScope = 0
    @State private var isFetching = false
    @State private var isFollowing = true
    /// Latches once the bottom marker has reported a real offset — see
    /// `updateFollowState` for why the sentinel means two different things
    /// either side of it.
    @State private var hasMeasuredBottom = false
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

    /// Human-authored turns are the landmarks in an otherwise machine-dense
    /// stream. Keep them in the log, but give completed turn boundaries enough
    /// material and type hierarchy to act as reliable bookmarks.
    private enum TailTurnRole {
        case user
        case agentReply

        var label: String {
            switch self {
            case .user: "YOU"
            case .agentReply: "AGENT REPLY"
            }
        }

        var accessibilityLabel: String {
            switch self {
            case .user: "Operator message"
            case .agentReply: "Agent reply"
            }
        }
    }

    private var layout: ScoutTailLayout { ScoutTailLayout.resolve(layoutRaw) }

    /// True once the blend can actually contain more than one Mac. Everything
    /// host-related in this file is gated on it, so a single-Mac fleet renders
    /// byte-identically to before.
    private var isMultiHost: Bool { hostsInScope > 1 }

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
        "\(reloadToken).\(model.fleetRevision).\(model.machineFilterKey)"
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
            if isMultiHost {
                // The scope the blend covers — the one thing the retired v3 sub
                // bar was reaching for, said with a real number instead of a
                // hardcoded "all agents".
                Text("\(hostsInScope) hosts")
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutInk.dim)
                    .fixedSize()
                    .accessibilityLabel("Blending \(hostsInScope) Macs")
            }
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
                                // The entrance + identity modifiers go INSIDE
                                // the Section, never onto it: a modified
                                // `Section` is a ModifiedContent, which a
                                // LazyVStack no longer recognises as a pinnable
                                // section — it laid out nothing at all, which is
                                // why the default Bursts layout opened on an
                                // empty viewport while the Lines layout was fine.
                                ForEach(Array(bursts.enumerated()), id: \.element.id) { index, burst in
                                    burstSection(burst, index: index)
                                }
                            } else {
                                ForEach(Array(events.enumerated()), id: \.element.id) { index, row in
                                    VStack(alignment: .leading, spacing: 0) {
                                        // The flat renderer has no burst header
                                        // to hang provenance on, so the host is
                                        // announced by a lead-in rule at the
                                        // boundary and then stays silent for the
                                        // whole run — no column, no per-line tag,
                                        // no width taken off the summary.
                                        if isMultiHost, index == 0 || events[index - 1].machineId != row.machineId {
                                            hostLeadIn(row)
                                        }
                                        refinedLogRow(row)
                                    }
                                    .id(row.id)
                                    .cockpitEntrance(index: index + 1, phase: entrance)
                                }
                            }
                            bottomMarker
                        }
                        .padding(.horizontal, HudSpacing.xxl)
                        .padding(.bottom, HudSpacing.xxl)
                    }
                    // A tail opens at its newest end. Let the ScrollView do that
                    // itself: on the first layout the LazyVStack has measured
                    // almost nothing, and a `proxy.scrollTo(bottom)` against an
                    // unmeasured stack parked the viewport in blank space PAST
                    // the log — the whole surface read as empty until the reader
                    // hit Resume. `.initialOffset` only sets where the scroll
                    // view opens; content that arrives later never moves a
                    // reader who has scrolled away.
                    .defaultScrollAnchor(.bottom, for: .initialOffset)
                    .coordinateSpace(name: Self.scrollSpace)
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

    @ViewBuilder
    private func refinedLogRow(_ row: MachineTailEvent) -> some View {
        if let role = turnRole(for: row) {
            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
                    Text(timeLabel(row.event.tsMs))
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(ScoutInk.dim)
                    handleText(row.event)
                        .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer(minLength: HudSpacing.sm)
                    turnRoleLabel(role)
                }
                HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
                    Text(kindGlyph(row.event.kind))
                        .font(HudFont.mono(HudTextSize.xs, weight: .bold))
                        .foregroundStyle(turnRoleColor(role))
                        .frame(width: 12, alignment: .center)
                    Text(row.event.summary)
                        .font(HudFont.mono(HudTextSize.xs, weight: role == .user ? .semibold : .regular))
                        .foregroundStyle(ScoutPalette.ink)
                        .lineLimit(5)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.horizontal, HudSpacing.md)
            .padding(.vertical, HudSpacing.sm)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(turnBackground(role))
            .padding(.vertical, HudSpacing.xs)
            .overlay(alignment: .bottom) {
                HudDivider(color: ScoutHairline.subtle)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(
                "\(role.accessibilityLabel), \(timeLabel(row.event.tsMs)), \(projectRootedPath(cwd: row.event.cwd, project: row.event.project)): \(row.event.summary)"
            )
        } else {
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
    }

    private func burstSection(_ burst: TailBurst, index: Int) -> some View {
        Section {
            VStack(alignment: .leading, spacing: HudSpacing.xxs) {
                ForEach(burst.rows) { row in
                    burstEventRow(row)
                }
            }
            .padding(.leading, HudSpacing.xxs)
            .padding(.bottom, HudSpacing.xs)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .bottom) {
                HudDivider(color: ScoutHairline.subtle)
            }
            .accessibilityElement(children: .contain)
            .cockpitEntrance(index: index + 1, phase: entrance)
        } header: {
            burstHeader(burst)
                .padding(.top, HudSpacing.sm)
                .padding(.bottom, HudSpacing.xxs)
                .background(ScoutPalette.bg)
                .zIndex(1)
                .cockpitEntrance(index: index + 1, phase: entrance)
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
            // Where · what · which runtime, as one tight cluster: a burst never
            // spans Macs (`originKey` splits on machineId), so the host is
            // stated once for the whole run rather than repeated down every
            // line of it, and it sits against the handle it qualifies instead
            // of floating between the time and the log.
            HStack(alignment: .firstTextBaseline, spacing: HudSpacing.xs) {
                if isMultiHost {
                    Text(hostTag(first.machineName))
                        .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                        .foregroundStyle(ScoutInk.muted)
                        .fixedSize(horizontal: true, vertical: false)
                }
                if HarnessMark.identifies(runtimeBrand(first.event)) {
                    HarnessMark(harness: runtimeBrand(first.event), size: 11)
                        .foregroundStyle(ScoutInk.muted)
                        .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
                        .accessibilityHidden(true)
                }
                handleText(first.event)
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
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

    @ViewBuilder
    private func burstEventRow(_ row: MachineTailEvent) -> some View {
        if let role = turnRole(for: row) {
            VStack(alignment: .leading, spacing: HudSpacing.xs) {
                turnRoleLabel(role)
                HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
                    Text(kindGlyph(row.event.kind))
                        .font(HudFont.mono(HudTextSize.xs, weight: .bold))
                        .foregroundStyle(turnRoleColor(role))
                        .frame(width: 12, alignment: .center)
                    Text(row.event.summary)
                        .font(HudFont.mono(HudTextSize.xs, weight: role == .user ? .semibold : .regular))
                        .foregroundStyle(ScoutPalette.ink)
                        .lineLimit(5)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.horizontal, HudSpacing.md)
            .padding(.vertical, HudSpacing.sm)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(turnBackground(role))
            .padding(.vertical, HudSpacing.xs)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(role.accessibilityLabel): \(row.event.summary)")
        } else {
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

    /// The flat renderer's host boundary — the same rule + mono label idiom the
    /// turn landmarks below use, so it reads as a divider in the stream rather
    /// than a new kind of ornament. Emitted only when the log actually crosses
    /// to another Mac.
    private func hostLeadIn(_ row: MachineTailEvent) -> some View {
        HStack(spacing: HudSpacing.xs) {
            Text(hostTag(row.machineName))
                .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                .foregroundStyle(ScoutInk.muted)
                .fixedSize(horizontal: true, vertical: false)
            Rectangle()
                .fill(ScoutHairline.standard)
                .frame(height: HudStrokeWidth.thin)
        }
        .padding(.top, HudSpacing.sm)
        .padding(.bottom, HudSpacing.xxs)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("On \(row.machineName)")
    }

    /// `@host` — the ssh-shaped origin cue, in the Mac's own short name. A
    /// bonjour/hostname name arrives as "studio.local" or "Art's MacBook Pro";
    /// drop the domain, collapse it to one token, and cap the width so the tag
    /// can never crowd out the handle it sits next to. Lowercase on purpose:
    /// the uppercase tracked labels in this file are section chrome, and a host
    /// is data.
    private func hostTag(_ name: String) -> String {
        var base = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if let domain = base.range(of: ".local", options: [.caseInsensitive, .backwards]),
           domain.upperBound == base.endIndex {
            base = String(base[..<domain.lowerBound])
        }
        let compact = base
            .split(whereSeparator: { $0 == " " || $0 == "'" || $0 == "\u{2019}" })
            .joined()
            .lowercased()
        guard !compact.isEmpty else { return "@mac" }
        return compact.count > 12 ? "@\(compact.prefix(11))…" : "@\(compact)"
    }

    /// The runtime brand for a row's vendor mark. `runtime` is the explicit
    /// field and wins whenever the producer set it; `source` is the fallback
    /// because the tail's source IS the runner that wrote the line — the broker
    /// fills it from the tail-source registry ("claude", "codex", "kimi",
    /// "grok", …), which is why `turnRole` above can already switch on it.
    /// Neither is synthesized, so a row with no attribution renders no mark.
    /// NOTE: today the fallback is always what shows — the iOS wire type
    /// (`MobileTailEvent` in scout-ios-core) doesn't carry `runtime` yet.
    private func runtimeBrand(_ event: TailEvent) -> String? {
        for candidate in [event.runtime, event.source] {
            let trimmed = (candidate ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { return trimmed }
        }
        return nil
    }

    private func turnRoleLabel(_ role: TailTurnRole) -> some View {
        HStack(spacing: HudSpacing.xs) {
            Rectangle()
                .fill(turnRoleColor(role))
                .frame(width: role == .user ? 16 : 24, height: 1)
            Text(role.label)
                .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                .tracking(1.1)
                .foregroundStyle(turnRoleColor(role))
        }
        .accessibilityHidden(true)
    }

    private func turnBackground(_ role: TailTurnRole) -> some View {
        let shape = RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
        return shape
            .fill(role == .user ? ScoutSurface.inset : ScoutSurface.raised)
            .overlay(shape.strokeBorder(ScoutHairline.standard, lineWidth: HudStrokeWidth.thin))
    }

    private func turnRoleColor(_ role: TailTurnRole) -> Color {
        role == .user ? ScoutPalette.statusInfo : ScoutPalette.statusOk
    }

    private func turnRole(for row: MachineTailEvent) -> TailTurnRole? {
        switch row.event.kind {
        case .user:
            return .user
        case .assistant:
            // Codex emits both mid-turn commentary and its final answer as
            // assistant messages. Only the message directly closed by the
            // canonical completion event should claim the reply landmark.
            guard row.event.source.lowercased() == "codex" else { return .agentReply }
            guard let index = events.firstIndex(where: { $0.id == row.id }), index + 1 < events.count else {
                return nil
            }
            let key = originKey(for: row)
            guard let next = events[(index + 1)...].first(where: { originKey(for: $0) == key }) else {
                return nil
            }
            return isCodexTurnCompletion(next.event) ? .agentReply : nil
        case .tool, .toolResult, .system, .other:
            return nil
        }
    }

    private func isCodexTurnCompletion(_ event: TailEvent) -> Bool {
        guard event.kind == .system else { return false }
        return event.summary
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "_", with: " ") == "task complete"
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
        if animated && !reduceMotion {
            withAnimation(.easeOut(duration: 0.2)) {
                proxy.scrollTo(Self.bottomAnchorID, anchor: .bottom)
            }
        } else {
            proxy.scrollTo(Self.bottomAnchorID, anchor: .bottom)
        }
    }

    private func updateFollowState(bottomY: CGFloat, viewportHeight: CGFloat) {
        guard viewportHeight > 0 else { return }
        // The marker sits at the end of a LazyVStack, so the preference falls
        // back to its sentinel default whenever the marker isn't realized — and
        // that reads two different ways. BEFORE the first real measurement it
        // means "this stack hasn't laid out yet", which is not a reader gesture
        // and must not detach a cold mount. AFTER one it means the reader has
        // pushed the end of the log out of the stack's window, which is exactly
        // a detach — so the sentinel keeps its original meaning from then on.
        let isMeasured = bottomY.isFinite && bottomY < TailBottomOffsetPreferenceKey.defaultValue
        guard isMeasured || hasMeasuredBottom else { return }
        if isMeasured { hasMeasuredBottom = true }
        let isAtBottom = isMeasured && bottomY <= viewportHeight + Self.bottomTolerance
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

        hostsInScope = machines.count
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

        if shouldKeepFollowing {
            // Claim the auto-scroll BEFORE the rows land, the same way a
            // renderer swap does. Appending to the log pushes the bottom marker
            // under the viewport for a beat, and an unclaimed beat reads as "the
            // reader scrolled away" — which detached a following reader on its
            // own snapshot, with no gesture involved.
            isFollowing = true
            isAutoScrolling = true
        }
        if didChange {
            events = nextEvents
        }
        hasLoadedInitialSnapshot = true
        if shouldKeepFollowing {
            // The FIRST snapshot IS the ScrollView's initial layout, and
            // `.defaultScrollAnchor(.bottom, for: .initialOffset)` already opens
            // it on the newest end — using only the rows the LazyVStack has
            // measured by then. Driving the proxy into that same layout pass is
            // what parked a cold mount in blank space past the log, so the first
            // proxy pass waits for the stack to settle and then corrects for the
            // rows that measured late. Later snapshots always have a measured
            // stack, so they scroll on the next runloop turn as before.
            Task { @MainActor in
                if isInitialSnapshot {
                    try? await Task.sleep(for: .milliseconds(450))
                } else {
                    await Task.yield()
                }
                guard isFollowing, !Task.isCancelled else { return }
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
