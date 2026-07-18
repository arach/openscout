import SwiftUI
import Foundation
import HudsonUI
import ScoutCapabilities
import ScoutIOSCore

/// Home — the ambient fleet dashboard. A faithful native port of the
/// `Scout Mobile.html` canvas: a rounded vitals card with a live sparkline, an
/// attention band (Needs you), the Working strip, the broker Activity log, the
/// Detected roster, and a docked "Ask the fleet" composer.
///
/// Data provenance: Working / Detected / Activity / the vitals counts / the
/// sparkline are all **real** broker reads. The **Needs you** band and the
/// **Ask the fleet** dock are visual placeholders — the iOS bridge has no
/// attention feed or fleet-broadcast primitive yet — and are marked as previews
/// so they read as scaffolding, not shipped affordances.
struct HomeSurface: View {
    let model: AppModel
    @Environment(\.scoutLayout) private var layout
    var onSelectMachine: (AppModel.PairedMachine) -> Void = { _ in }
    var onSelectAll: () -> Void = {}
    var onConversationStatusContext: (String?) -> Void = { _ in }
    var onSeeAllAgents: () -> Void = {}
    var onSeeAllActivity: () -> Void = {}
    var onCompose: () -> Void = {}
    var reloadToken: Int = 0

    @State private var agents: [HomeAgent] = []
    @State private var isLoading = true
    @State private var route: HomeConversationRoute?
    @State private var routeClient: (any ScoutBrokerClient)?
    @State private var activity: [HomeActivity] = []
    @State private var agentsScopeKey: String?
    @State private var activityScopeKey: String?

    private enum HomeConversationRoute: Hashable, Identifiable {
        case session(id: String, title: String)
        case comms(CommsConversation)

        var id: String {
            switch self {
            case .session(let id, _): return "session:\(id)"
            case .comms(let conversation): return "comms:\(conversation.id)"
            }
        }
    }

    private var filterKey: String {
        switch model.machineFilter {
        case .all: return "all"
        case .machine(let id): return id
        }
    }

    private var reloadKey: String {
        "\(reloadToken).\(model.fleetRevision).\(filterKey)"
    }

    var body: some View {
        ScrollView {
            // Pin the column to a DEFINITE lane width, left-aligned, with a trailing
            // Spacer absorbing any surplus. This forces rows to truncate within the
            // lane (instead of the column inflating to its widest row and dragging
            // everything off the right edge) AND keeps it left-anchored (instead of
            // getting centered). The Spacer eats any inflation and clips harmlessly.
            HStack(alignment: .top, spacing: 0) {
            VStack(alignment: .leading, spacing: HudSpacing.xl) {
                if isLoading {
                    HudEmptyState(title: "Loading fleet", subtitle: "Reading agents from the broker.", icon: "antenna.radiowaves.left.and.right")
                        .padding(.top, HudSpacing.huge)
                } else {
                    FleetVitals(
                        live: liveAgents.count,
                        agents: agents.count,
                        online: onlineMachineCount,
                        machines: totalMachineCount,
                        samples: activityPulseSamples,
                        budgets: model.serviceBudgets
                    )
                    if model.pairedMachines.count > 1 { machineRail }
                    needsYouSection
                    workingSection
                    if !recentActivity.isEmpty { activitySection }
                    if isFleetEmpty { notConnectedHint }
                }
            }
            .frame(width: laneWidth, alignment: .leading)
            Spacer(minLength: 0)
            }
            .padding(.leading, layout.surfacePadding)
            .padding(.top, layout.surfaceTopPadding)
            .padding(.bottom, HudSpacing.md)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { bottomDock }
        .refreshable { await load() }
        .task(id: reloadKey) {
            await load()
            guard reloadToken != 0 else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                if Task.isCancelled { break }
                guard route == nil else { continue }
                await load()
            }
        }
        .navigationDestination(item: $route) { route in
            switch route {
            case .session(let id, let title):
                ConversationSurface(
                    client: routeClient ?? model.client,
                    conversationId: id,
                    title: title,
                    onClose: { self.route = nil },
                    onStatusContextChange: onConversationStatusContext
                )
            case .comms(let conversation):
                CommsThreadView(
                    client: routeClient ?? model.client,
                    conversation: conversation,
                    onClose: { self.route = nil },
                    onRead: { _ = try? await (routeClient ?? model.client).markConversationRead(conversationId: conversation.id) }
                )
            }
        }
    }

    private var isFleetEmpty: Bool { agents.isEmpty && activity.isEmpty }

    /// The definite width of a full-bleed lane inside the surface padding — the
    /// same width the content column is pinned to. Derived from the design frame's
    /// layout width (not a nested GeometryReader, which a greedy horizontal card
    /// ScrollView inflates), so every lane fits exactly and nothing drags the
    /// column past the screen edge.
    private var laneWidth: CGFloat { max(0, layout.designWidth - layout.surfacePadding * 2) }

    private var notConnectedHint: some View {
        Text("Not connected — connect a Mac from the status bar to fill the fleet. Needs-you and Ask-the-fleet above are previews.")
            .font(HudFont.mono(HudTextSize.micro))
            .foregroundStyle(ScoutInk.dim)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, HudSpacing.sm)
    }

    // MARK: - Vitals

    private var onlineMachineCount: Int { model.pairedMachines.filter(\.isOnline).count }
    private var totalMachineCount: Int { model.pairedMachines.count }

    /// Real activity sparkline: bucket loaded broker events by recency. Empty
    /// (the card hides the spark) until there are a few events to plot.
    private var activityPulseSamples: [Double] {
        let dates = activity.compactMap { ScoutTimestamp.date(fromEpoch: TimeInterval($0.event.tsMs)) }
        guard dates.count >= 3, let newest = dates.max(), let oldest = dates.min() else { return [] }
        let span = max(newest.timeIntervalSince(oldest), 1)
        let bins = 16
        var buckets = [Double](repeating: 0, count: bins)
        for date in dates {
            let t = date.timeIntervalSince(oldest) / span
            buckets[min(bins - 1, max(0, Int(t * Double(bins))))] += 1
        }
        return buckets
    }

    // MARK: - Needs you (real attention)

    /// Agents the broker has flagged as needing the operator — approvals,
    /// questions, blocks. Attention outranks everything; newest first. The band
    /// hides entirely until an agent actually needs a move (no placeholder).
    private var needsYouRows: [HomeAgent] {
        agents
            .filter { $0.agent.needsAttention }
            .sorted { ($0.agent.lastActiveAt ?? .distantPast) > ($1.agent.lastActiveAt ?? .distantPast) }
    }

    @ViewBuilder
    private var needsYouSection: some View {
        if !needsYouRows.isEmpty {
            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                laneHeader("Notifications", count: needsYouRows.count, attention: true)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: HudSpacing.sm) {
                        ForEach(needsYouRows) { row in
                            NeedCard(agent: row.agent, onTap: { tap(row)?() })
                        }
                    }
                    .padding(.vertical, 2)
                }
                .frame(width: laneWidth, alignment: .leading)
            }
        }
    }

    // MARK: - Machine rail

    private var machineRail: some View {
        HStack(spacing: HudSpacing.md) {
            Text("MACHINES")
                .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                .tracking(1.4)
                .foregroundStyle(ScoutInk.dim)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: HudSpacing.sm) {
                    AllMachinesChip(isSelected: model.machineFilter == .all) { onSelectAll() }
                    ForEach(model.pairedMachines) { machine in
                        MachineChip(machine: machine, isSelected: isFilterSelected(machine)) {
                            onSelectMachine(machine)
                        }
                    }
                }
                .padding(.vertical, 2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func isFilterSelected(_ machine: AppModel.PairedMachine) -> Bool {
        switch model.machineFilter {
        case .all: return false
        case .machine(let id): return id == machine.id
        }
    }

    // MARK: - Working (live)

    private var liveAgents: [HomeAgent] {
        agents
            .filter { $0.agent.state == .live }
            .sorted { ($0.agent.lastActiveAt ?? .distantPast) > ($1.agent.lastActiveAt ?? .distantPast) }
    }

    private var hasLiveWork: Bool { !liveAgents.isEmpty }

    /// The working set: agents running a turn right now, or — on a between-turns
    /// fleet — the handful that worked most recently, so the lane reflects who's
    /// active instead of sitting empty. Cards show real ages; only genuinely live
    /// agents get the "now" pulse.
    private var workingRows: [HomeAgent] {
        if hasLiveWork { return liveAgents }
        return Array(
            agents
                .filter { $0.agent.state != .offline && $0.agent.lastActiveAt != nil }
                .sorted { ($0.agent.lastActiveAt ?? .distantPast) > ($1.agent.lastActiveAt ?? .distantPast) }
                .prefix(6)
        )
    }

    @ViewBuilder
    private var workingSection: some View {
        if !workingRows.isEmpty {
            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                laneHeader(hasLiveWork ? "Working" : "Recently working", count: workingRows.count, signal: ScoutVibe.accent)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: HudSpacing.sm) {
                        ForEach(workingRows) { row in
                            WorkingCard(agent: row.agent, onTap: { tap(row)?() })
                        }
                    }
                    .padding(.vertical, 2)
                }
                .frame(width: laneWidth, alignment: .leading)
            }
        }
    }

    // MARK: - Bottom dock (Terminals strip + Ask-the-fleet CTA)

    /// The pinned bottom of Home: a terminal-y Terminals strip (when there are
    /// sessions) directly above the Ask-the-fleet call-to-action. One soft
    /// bottom-up fade backs both so scroll content dissolves beneath them.
    private var bottomDock: some View {
        VStack(spacing: HudSpacing.sm) {
            if !model.recentTerminals.isEmpty { terminalsStrip }
            askDock
        }
        .padding(.top, HudSpacing.sm)
        .background(
            LinearGradient(
                colors: [HudPalette.bg, HudPalette.bg, HudPalette.bg.opacity(0)],
                startPoint: .bottom, endPoint: .top
            )
            .allowsHitTesting(false)
        )
    }

    /// Recent terminal (harness) sessions as a row of small terminal-y wells: a
    /// metadata line (harness · session · live/age) over a CLI prompt line showing
    /// the resume command. Display-only — a truthful readout, not a fake attach.
    private var terminalsStrip: some View {
        HStack(alignment: .top, spacing: 0) {
            VStack(alignment: .leading, spacing: HudSpacing.xs) {
                HStack(spacing: HudSpacing.xs) {
                    Text("TERMINALS")
                        .font(HudFont.mono(9, weight: .bold))
                        .tracking(1.5)
                        .foregroundStyle(ScoutInk.dim)
                    Text("\(model.recentTerminals.count)")
                        .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                        .foregroundStyle(ScoutInk.dim)
                        .monospacedDigit()
                    Spacer(minLength: 0)
                }
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: HudSpacing.sm) {
                        ForEach(model.recentTerminals) { terminal in
                            TerminalTile(terminal: terminal)
                        }
                    }
                    .padding(.vertical, 1)
                }
            }
            .frame(width: laneWidth, alignment: .leading)
            Spacer(minLength: 0)
        }
        .padding(.leading, layout.surfacePadding)
    }

    /// Ask-the-fleet — the standing call-to-action to start something with the
    /// fleet. Taps through to the New composer (a real action, not a mock field).
    private var askDock: some View {
        HStack(spacing: 0) {
            Button(action: onCompose) {
                HStack(spacing: HudSpacing.sm) {
                    Image(systemName: "mic")
                        .font(.system(size: 13, weight: .regular))
                        .foregroundStyle(ScoutInk.dim)
                        .frame(width: 26, height: 26)
                        .overlay(Circle().stroke(ScoutVibe.hairline, lineWidth: HudStrokeWidth.thin))
                    Text("Ask the fleet…")
                        .font(HudFont.ui(HudTextSize.sm))
                        .foregroundStyle(ScoutInk.dim)
                    Spacer(minLength: 0)
                    Image(systemName: "arrow.up")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(HudPalette.bg)
                        .frame(width: 28, height: 28)
                        .background(Circle().fill(ScoutVibe.accent))
                }
                .padding(.leading, HudSpacing.md)
                .padding(.trailing, HudSpacing.xs)
                .padding(.vertical, HudSpacing.xs)
                .background(
                    Capsule().fill(ScoutVibe.card)
                        .overlay(Capsule().stroke(ScoutVibe.hairline, lineWidth: HudStrokeWidth.thin))
                )
                .frame(width: laneWidth)
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            Spacer(minLength: 0)
        }
        .padding(.leading, layout.surfacePadding)
        .padding(.bottom, HudSpacing.sm)
        .accessibilityLabel("Ask the fleet")
    }

    // MARK: - Activity

    private static let activityPreviewCap = 48
    private static let activityRetainedCap = 48

    private var recentActivity: [HomeActivity] { Array(activity.prefix(Self.activityPreviewCap)) }

    private var activitySection: some View {
        // Activity reads as a bare timeline directly on the canvas — no card box —
        // so it feels like the surface's own log rather than another panel.
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            laneHeader("Activity", detail: activitySpanLabel, onAll: onSeeAllActivity)
            // Home already owns the vertical scroll. Let the timeline participate
            // in it instead of trapping eight rows in a short nested viewport;
            // the log can now continue through the available canvas and beyond.
            LazyVStack(spacing: 0) {
                ForEach(recentActivity) { row in
                    ActivityRow(event: row.event, onOpen: tapActivity(row))
                }
            }
        }
    }

    private var activitySpanLabel: String? {
        let dates = recentActivity.compactMap { ScoutTimestamp.date(fromEpoch: TimeInterval($0.event.tsMs)) }
        guard let oldest = dates.min() else { return nil }
        return ScoutTimestamp.relativeAge(since: oldest)
    }

    // MARK: - Ask the fleet (placeholder dock)

    // MARK: - Shared chrome

    /// Lane heading in the canvas grammar: caps-mono label, a bordered count, a
    /// hairline rule filling the remaining width, and an optional trailing marker
    /// (a "preview" note, or an "All" shortcut). `attention` tints it amber.
    private func laneHeader(
        _ title: String,
        count: Int? = nil,
        detail: String? = nil,
        signal: Color? = nil,
        attention: Bool = false,
        trailing: String? = nil,
        onAll: (() -> Void)? = nil
    ) -> some View {
        let tint = attention ? ScoutVibe.amber : signal
        return HStack(spacing: HudSpacing.sm) {
            Text(title.uppercased())
                .font(HudFont.mono(10.5, weight: .medium))
                .tracking(2)
                .foregroundStyle(tint ?? ScoutInk.dim)
            if let count {
                Text("\(count)")
                    .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                    .foregroundStyle(tint ?? ScoutInk.muted)
                    .monospacedDigit()
                    .padding(.horizontal, HudSpacing.sm)
                    .padding(.vertical, 1.5)
                    .overlay(Capsule().stroke(tint.map(HudSurface.tintBorder) ?? ScoutVibe.hairline, lineWidth: HudStrokeWidth.thin))
            } else if let detail {
                Text(detail.uppercased())
                    .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                    .tracking(0.8)
                    .foregroundStyle(ScoutInk.dim)
                    .monospacedDigit()
            }
            if let trailing {
                Text(trailing.uppercased())
                    .font(HudFont.mono(HudTextSize.micro - 0.5, weight: .medium))
                    .tracking(1)
                    .foregroundStyle(ScoutInk.dim)
            }
            Rectangle()
                .fill(HudHairline.subtle)
                .frame(height: HudStrokeWidth.standard)
                .frame(maxWidth: .infinity)
            if let onAll {
                Button(action: onAll) {
                    HStack(spacing: 1) {
                        Text("All").font(HudFont.mono(HudTextSize.xs, weight: .medium))
                        Glyphic.chevron(.trailing, size: 10)
                    }
                    .foregroundStyle(ScoutVibe.accent)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("See all \(title.lowercased())")
            }
        }
    }

    @ViewBuilder
    private func cardSurface<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 0) { content() }
            .background(RoundedRectangle(cornerRadius: 6, style: .continuous).fill(ScoutVibe.card))
            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).stroke(ScoutVibe.hairline, lineWidth: HudStrokeWidth.thin))
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
    }

    private func rowSeparator() -> some View {
        Rectangle()
            .fill(HudHairline.subtle)
            .frame(height: HudStrokeWidth.thin)
            .padding(.leading, HudSpacing.xl)
    }

    private func tap(_ row: HomeAgent) -> (() -> Void)? {
        guard let conversationId = row.agent.conversationId?.trimmingCharacters(in: .whitespacesAndNewlines),
              !conversationId.isEmpty else { return nil }
        return {
            routeClient = row.client
            route = .session(id: conversationId, title: row.agent.title)
        }
    }

    private func tapActivity(_ row: HomeActivity) -> (() -> Void)? {
        guard let conversationId = row.event.conversationId, !conversationId.isEmpty else { return nil }
        return {
            routeClient = row.client
            route = activityRoute(for: row.event, conversationId: conversationId)
        }
    }

    private func activityRoute(for event: TailEvent, conversationId: String) -> HomeConversationRoute {
        .comms(
            CommsConversation(
                id: conversationId,
                kind: .unknown,
                title: event.source,
                participants: [event.source],
                lastMessagePreview: event.summary,
                lastMessageAuthor: event.source,
                lastMessageAt: ScoutTimestamp.date(fromEpoch: TimeInterval(event.tsMs)),
                messageCount: 0,
                unreadCount: 0
            )
        )
    }

    private func sortedActivity(_ incoming: [HomeActivity]) -> [HomeActivity] {
        var seenEventIDs = Set<String>()
        let newestFirst = incoming.sorted {
            if $0.event.tsMs == $1.event.tsMs { return $0.id > $1.id }
            return $0.event.tsMs > $1.event.tsMs
        }
        return Array(newestFirst.filter { seenEventIDs.insert($0.event.id).inserted }
            .prefix(Self.activityRetainedCap))
    }

    // MARK: - Load

    private func load() async {
        if agents.isEmpty && activity.isEmpty { isLoading = true }
        let loadKey = reloadKey
        let scopeKey = filterKey
        let machines = model.agentMachines()
        let noReadableMachines = machines.allSatisfy { $0.client == nil }
        var freshAgents: [HomeAgent] = []
        var freshActivity: [HomeActivity] = []
        var sawAgentRead = false
        var sawActivityRead = false

        for machine in machines {
            guard let client = machine.client else { continue }
            if let rows = try? await client.listAgents(query: nil, limit: 50) {
                sawAgentRead = true
                freshAgents.append(contentsOf: rows.map { agent in
                    HomeAgent(id: "\(machine.id)::\(agent.id)", machineId: machine.id, machineName: machine.name, client: client, agent: agent)
                })
            }
            if let rows = try? await client.recentActivity(limit: 48) {
                sawActivityRead = true
                freshActivity.append(contentsOf: rows.map { event in
                    HomeActivity(id: "\(machine.id)::\(event.id)", machineId: machine.id, machineName: machine.name, client: client, event: event)
                })
            }
        }

        guard !Task.isCancelled, loadKey == reloadKey else { return }

        if sawAgentRead {
            agents = freshAgents
            agentsScopeKey = scopeKey
        } else if noReadableMachines || agentsScopeKey != scopeKey {
            agents = []
            agentsScopeKey = scopeKey
        }
        if sawActivityRead {
            activity = sortedActivity(freshActivity)
            activityScopeKey = scopeKey
        } else if noReadableMachines || activityScopeKey != scopeKey {
            activity = []
            activityScopeKey = scopeKey
        }
        await model.refreshFleetStats()
        isLoading = false
    }
}

// MARK: - Home row provenance

private struct HomeAgent: Identifiable {
    let id: String
    let machineId: String
    let machineName: String
    let client: any ScoutBrokerClient
    let agent: AgentSummary
}

private struct HomeActivity: Identifiable {
    let id: String
    let machineId: String
    let machineName: String
    let client: any ScoutBrokerClient
    let event: TailEvent
}

// MARK: - Needs you kind display

/// The KIND-tag label for a pending-ask. Names the *move* the operator must make.
private func needKindLabel(_ kind: PendingAsk.Kind) -> String {
    switch kind {
    case .permission: return "Permission"
    case .decision: return "Decision"
    case .confirm: return "Confirm"
    case .blocked: return "Blocked"
    case .question: return "Question"
    case .other: return "Needs you"
    }
}

/// Tint for a pending-ask kind. NOT vendor color — this categorizes the *kind of
/// decision* (approve / decide / unblock), which is real operator signal.
private func needKindTint(_ kind: PendingAsk.Kind) -> Color {
    switch kind {
    case .permission, .confirm, .other: return ScoutVibe.amber
    case .decision, .question: return ScoutVibe.blue
    case .blocked: return ScoutVibe.red
    }
}

// MARK: - FleetVitals

/// The top strip: a compact activity mini-chart + each subscription's spent quota
/// windows (Claude · Codex) — the two glance-values that actually help. Falls back
/// to agent/machine counts until the quota gauges arrive. Inspired by the studio
/// `FleetLogSurface` strip.
private struct FleetVitals: View {
    let live: Int
    let agents: Int
    let online: Int
    let machines: Int
    let samples: [Double]
    let budgets: [ServiceBudget]

    /// Claude + Codex lead the strip; GitHub's hourly cap isn't a glance-value here.
    private var quotaSegments: [ServiceBudget] {
        budgets.filter { $0.provider == "claude" || $0.provider == "codex" }
    }

    var body: some View {
        HStack(alignment: .top, spacing: HudSpacing.md) {
            chartSegment
            if quotaSegments.isEmpty {
                divider
                statSegment(value: "\(agents)", label: "Agents")
                divider
                statSegment(value: machines > 0 ? "\(online)/\(machines)" : "—", label: "Machines")
            } else {
                ForEach(quotaSegments) { budget in
                    divider
                    quotaSegment(budget)
                }
            }
        }
        .padding(.horizontal, 2)
        .padding(.top, HudSpacing.xs)
        .padding(.bottom, HudSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        // A flat strip, the studio way — no card outline; a single hairline
        // rules it off from the log beneath.
        .overlay(alignment: .bottom) {
            Rectangle().fill(ScoutVibe.hairline).frame(height: HudStrokeWidth.thin)
        }
    }

    private var chartSegment: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            segHead(live > 0 ? "Live" : "Activity", detail: live > 0 ? "\(live) now" : "1d", accent: live > 0)
            if samples.count >= 3 {
                FleetSparkline(samples: samples)
                    .frame(height: 30)
                    .accessibilityHidden(true)
            } else {
                Rectangle().fill(ScoutVibe.hairline)
                    .frame(height: HudStrokeWidth.standard)
                    .frame(maxHeight: 30, alignment: .center)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func quotaSegment(_ b: ServiceBudget) -> some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            segHead(b.label, detail: b.plan)
            VStack(alignment: .leading, spacing: HudSpacing.xs) {
                ForEach(Array(b.windows.prefix(2).enumerated()), id: \.offset) { _, window in
                    windowMeter(window)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(quotaAccessibilityLabel(b))
    }

    private func windowMeter(_ w: ServiceBudget.Window) -> some View {
        // Calm by default: a neutral fill/percent, reserving colour for the one
        // state that wants the eye — amber once a window is nearly spent (≥80%).
        let hot = w.usedPercent >= 80
        let tint = hot ? ScoutVibe.amber : ScoutInk.muted
        return HStack(spacing: HudSpacing.xs) {
            Text(w.label)
                .font(HudFont.mono(8.5, weight: .semibold))
                .foregroundStyle(ScoutInk.dim)
                .frame(width: 15, alignment: .leading)
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(ScoutVibe.hairline)
                    Capsule().fill(tint).frame(width: max(0, g.size.width * min(1, w.usedPercent / 100)))
                }
            }
            .frame(height: 3)
            Text("\(Int(w.usedPercent.rounded()))%")
                .font(HudFont.mono(9, weight: .semibold))
                .foregroundStyle(tint)
                .monospacedDigit()
                .frame(minWidth: 22, alignment: .trailing)
        }
    }

    private func statSegment(value: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(value)
                .font(HudFont.ui(19, weight: .semibold))
                .foregroundStyle(ScoutVibe.ink)
                .monospacedDigit()
            caption(label)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func segHead(_ label: String, detail: String, accent: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.xs) {
            Text(label.uppercased())
                .font(HudFont.mono(9, weight: .bold))
                .tracking(1.0)
                .foregroundStyle(accent ? ScoutVibe.accent : ScoutVibe.ink)
                .lineLimit(1)
            if !detail.isEmpty {
                Text(detail.uppercased())
                    .font(HudFont.mono(7.5, weight: .semibold))
                    .tracking(0.4)
                    .foregroundStyle(ScoutInk.dim)
                    .lineLimit(1)
            }
        }
    }

    private func caption(_ text: String) -> some View {
        Text(text.uppercased())
            .font(HudFont.mono(9.5, weight: .medium))
            .tracking(1.3)
            .foregroundStyle(ScoutInk.dim)
            .fixedSize()
    }

    private func quotaAccessibilityLabel(_ b: ServiceBudget) -> String {
        let windows = b.windows.prefix(2).map { "\($0.label) \(Int($0.usedPercent.rounded())) percent used" }
        return "\(b.label) quota: " + windows.joined(separator: ", ")
    }

    private var divider: some View {
        Rectangle().fill(ScoutVibe.hairline).frame(width: HudStrokeWidth.thin).frame(maxHeight: 46)
    }
}

/// Real activity pulse — thin accent stroke over a soft vertical fade + end mark.
private struct FleetSparkline: View {
    let samples: [Double]

    var body: some View {
        GeometryReader { geo in
            let points = points(in: geo.size)
            ZStack {
                area(points, height: geo.size.height)
                    .fill(LinearGradient(colors: [ScoutVibe.accent.opacity(0.24), ScoutVibe.accent.opacity(0)], startPoint: .top, endPoint: .bottom))
                line(points)
                    .stroke(ScoutVibe.accent, style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
                if let end = points.last {
                    Circle().fill(ScoutVibe.accent).frame(width: 4, height: 4).position(end)
                }
            }
        }
    }

    private func points(in size: CGSize) -> [CGPoint] {
        guard !samples.isEmpty else { return [] }
        let maxV = max(samples.max() ?? 1, 1)
        let usableH = max(size.height - 4, 1)
        return samples.enumerated().map { index, value in
            let x = samples.count > 1 ? CGFloat(index) / CGFloat(samples.count - 1) * size.width : size.width / 2
            return CGPoint(x: x, y: size.height - 2 - CGFloat(value / maxV) * usableH)
        }
    }

    private func line(_ points: [CGPoint]) -> Path {
        Path { path in
            guard let first = points.first else { return }
            path.move(to: first)
            for point in points.dropFirst() { path.addLine(to: point) }
        }
    }

    private func area(_ points: [CGPoint], height: CGFloat) -> Path {
        Path { path in
            guard let first = points.first, let last = points.last else { return }
            path.move(to: CGPoint(x: first.x, y: height))
            path.addLine(to: first)
            for point in points.dropFirst() { path.addLine(to: point) }
            path.addLine(to: CGPoint(x: last.x, y: height))
            path.closeSubpath()
        }
    }
}

// MARK: - NeedCard

/// One Needs-you card, backed by a real agent that `needsAttention`: KIND tag,
/// age, the pending ask, and a tap that opens the conversation to respond. No
/// inline Approve/Deny yet — responding happens in the thread, so the card is a
/// truthful jump-in, not a fake control.
private struct NeedCard: View {
    let agent: AgentSummary
    let onTap: () -> Void

    private var kind: PendingAsk.Kind { agent.pendingAsk?.kind ?? .question }
    private var tint: Color { needKindTint(kind) }
    private var prompt: String {
        if let ask = agent.pendingAsk?.prompt, !ask.isEmpty { return ask }
        return meaningfulActionString(agent.statusLabel) ?? "Waiting on your input."
    }

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: HudSpacing.xs) {
                HStack(alignment: .firstTextBaseline, spacing: HudSpacing.xs) {
                    Text(agent.title)
                        .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                        .foregroundStyle(ScoutVibe.ink)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Spacer(minLength: HudSpacing.xs)
                    if let age = relativeAgeString(agent.lastActiveAt) {
                        Text(age)
                            .font(HudFont.mono(HudTextSize.micro))
                            .foregroundStyle(ScoutInk.dim)
                            .monospacedDigit()
                    }
                }
                HStack(alignment: .firstTextBaseline, spacing: HudSpacing.xs) {
                    Text(needKindLabel(kind).uppercased())
                        .font(HudFont.mono(8, weight: .bold))
                        .tracking(0.7)
                        .foregroundStyle(tint)
                        .fixedSize()
                    Text(prompt)
                        .font(HudFont.mono(10.5))
                        .foregroundStyle(ScoutInk.muted)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            }
            .padding(.vertical, HudSpacing.sm)
            .padding(.horizontal, HudSpacing.md)
            .frame(width: 212, alignment: .leading)
            // A small refined chip (studio `.iNotif`): rounded well, hairline, the
            // tinted kind tag carries the signal — no left bar on a rounded box.
            .background(RoundedRectangle(cornerRadius: 11, style: .continuous).fill(ScoutSurface.raised))
            .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(ScoutVibe.hairline, lineWidth: HudStrokeWidth.thin))
            .contentShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - WorkingCard

/// One live agent in the Working strip: squarish harness avatar, name, goal, and
/// a file/action line with a live caret. Real broker state.
private struct WorkingCard: View {
    let agent: AgentSummary
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                HStack(spacing: HudSpacing.sm) {
                    AgentAvatar(title: agent.title, harness: agent.harness, state: agent.state, size: 24, cornerRadius: 5)
                    Text(agent.title)
                        .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                        .foregroundStyle(ScoutVibe.ink)
                        .lineLimit(1)
                    Spacer(minLength: HudSpacing.xs)
                    if isLive {
                        HStack(spacing: HudSpacing.xxs) {
                            HudStatusDot(color: ScoutVibe.accent, size: 5, pulses: true)
                            Text("now").font(HudFont.mono(HudTextSize.micro, weight: .medium)).foregroundStyle(ScoutVibe.accent)
                        }
                    } else if let age = relativeAgeString(agent.lastActiveAt) {
                        Text(age)
                            .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                            .foregroundStyle(ScoutInk.muted)
                            .monospacedDigit()
                    }
                }
                if let goalText {
                    Text(goalText)
                        .font(HudFont.ui(HudTextSize.xs))
                        .foregroundStyle(ScoutInk.muted)
                        .lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .frame(minHeight: 30, alignment: .top)
                }
                HStack(spacing: HudSpacing.xxs) {
                    Text(fileText)
                        .font(HudFont.mono(10.5))
                        .foregroundStyle(isLive ? ScoutVibe.accent : ScoutInk.dim)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    if isLive { LiveCaret() }
                }
            }
            .padding(HudSpacing.md)
            .frame(width: 172, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 4, style: .continuous).fill(ScoutVibe.card))
            .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).stroke(ScoutVibe.hairline, lineWidth: HudStrokeWidth.thin))
            .contentShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var isLive: Bool { agent.state == .live }

    /// The action line — the agent's current action while live, or its last
    /// meaningful status. `nil` for a between-turns agent with nothing to say, so
    /// the card drops the line entirely rather than reading a contradictory "idle".
    private var goalText: String? {
        if let action = meaningfulActionString(agent.statusLabel) { return action }
        return isLive ? "working" : nil
    }

    /// A file-ish locator for the action line: branch when present, else project.
    private var fileText: String {
        if let branch = agent.branch, !branch.isEmpty { return "\u{2387} \(branch)" }
        if let project = agent.projectName, !project.isEmpty { return project }
        return agent.harness?.lowercased() ?? "live"
    }
}

/// A blinking accent caret — the one bit of decorative motion Working earns.
private struct LiveCaret: View {
    @State private var visible = true
    var body: some View {
        RoundedRectangle(cornerRadius: 0.75)
            .fill(ScoutVibe.accent)
            .frame(width: 1.5, height: 11)
            .opacity(visible ? 1 : 0)
            .onAppear { withAnimation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true)) { visible = false } }
    }
}

// MARK: - TerminalTile

/// One recent terminal (harness) session, as a small terminal-y well: a metadata
/// line (harness · session · live/age) over a CLI prompt line showing the resume
/// command. The details that matter on a single-machine fleet are the session and
/// the harness; the prompt line gives it the shell "juice". A live surface reads
/// with an accent edge. Display-only — a truthful readout, not a fake attach.
private struct TerminalTile: View {
    let terminal: MobileTerminal

    /// A short, stable session tag from the harness-native session id (falls back
    /// to the record id, dropping its `ts.` prefix). Enough to tell sessions apart.
    private var sessionShort: String {
        let raw = terminal.sessionId.isEmpty ? terminal.id : terminal.sessionId
        let core = raw.hasPrefix("ts.") ? String(raw.dropFirst(3)) : raw
        return String(core.prefix(8))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: HudSpacing.xs) {
                Text(terminal.harness.lowercased())
                    .font(HudFont.mono(9.5, weight: .semibold))
                    .foregroundStyle(ScoutVibe.ink)
                    .lineLimit(1)
                Text(sessionShort)
                    .font(HudFont.mono(9))
                    .foregroundStyle(ScoutInk.dim)
                    .lineLimit(1)
                Spacer(minLength: HudSpacing.xs)
                if terminal.running {
                    Text("live")
                        .font(HudFont.mono(8.5, weight: .medium))
                        .foregroundStyle(ScoutInk.muted)
                } else if let age = relativeAgeString(terminal.updatedAt) {
                    Text(age)
                        .font(HudFont.mono(8.5))
                        .foregroundStyle(ScoutInk.dim)
                        .monospacedDigit()
                }
            }
            HStack(spacing: HudSpacing.xxs) {
                Text("\u{276F}")
                    .font(HudFont.mono(10, weight: .semibold))
                    .foregroundStyle(ScoutInk.dim)
                Text(terminal.command)
                    .font(HudFont.mono(10))
                    .foregroundStyle(ScoutInk.muted)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
        }
        .padding(.horizontal, HudSpacing.md)
        .padding(.vertical, HudSpacing.sm)
        .frame(width: 190, alignment: .leading)
        // A dark, recessed terminal well — no accent; the shell reads on its own.
        .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(Color.black.opacity(0.40)))
        .overlay(
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .stroke(ScoutVibe.hairline, lineWidth: HudStrokeWidth.thin)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Terminal, \(terminal.harness) session \(sessionShort)\(terminal.running ? ", running" : ""), \(terminal.command)")
    }
}

// MARK: - ActivityRow

private struct ActivityRow: View {
    let event: TailEvent
    var onOpen: (() -> Void)?

    var body: some View {
        Button(action: { onOpen?() }) {
            HStack(alignment: .center, spacing: HudSpacing.md) {
                Text(clockLabel)
                    .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                    .foregroundStyle(ScoutInk.dim)
                    .monospacedDigit()
                    .frame(width: 34, alignment: .trailing)
                Circle().fill(kindColor).frame(width: 6, height: 6)
                Text(event.source)
                    .font(HudFont.mono(HudTextSize.xs, weight: .medium))
                    .foregroundStyle(ScoutVibe.ink)
                    .lineLimit(1)
                    .layoutPriority(1)
                Text(event.summary)
                    .font(HudFont.mono(HudTextSize.xs))
                    .foregroundStyle(ScoutInk.muted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 0)
            }
            .padding(.vertical, HudSpacing.xs + 1)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(onOpen == nil)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(event.source) \(event.summary)")
    }

    private var clockLabel: String {
        guard let date = ScoutTimestamp.date(fromEpoch: TimeInterval(event.tsMs)) else { return "" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "H:mm"
        return formatter.string(from: date)
    }

    private var kindColor: Color { homeActivitySignalColor(event.kind) }
}

// MARK: - AgentAvatar

/// A compact identity tile: mono initials on a neutral lifted square, with an
/// optional state dot. Deliberately NOT colored by harness — Scout rations color
/// to one accent and signals through contrast, so identity is carried by the
/// initials and only *state* (live) earns the accent. `harness` is retained on
/// the API for callers/accessibility, not for tint.
private struct AgentAvatar: View {
    let title: String
    let harness: String?
    var state: AgentSummary.State? = nil
    var size: CGFloat = 34
    var cornerRadius: CGFloat = 8

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(ScoutVibe.card)
            .overlay(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous).stroke(ScoutVibe.hairline, lineWidth: HudStrokeWidth.thin))
            .frame(width: size, height: size)
            .overlay(
                Text(agentInitials(title))
                    .font(HudFont.mono(size * 0.34, weight: .medium))
                    .foregroundStyle(state == .live ? ScoutVibe.ink : ScoutInk.muted)
            )
            .overlay(alignment: .bottomTrailing) {
                if let state, let dot = stateColor(state) {
                    Circle()
                        .fill(dot)
                        .frame(width: size * 0.32, height: size * 0.32)
                        .overlay(Circle().stroke(HudPalette.bg, lineWidth: 2))
                        .offset(x: size * 0.08, y: size * 0.08)
                }
            }
    }

    private func stateColor(_ state: AgentSummary.State) -> Color? {
        switch state {
        case .live: return ScoutVibe.accent
        case .unknown: return ScoutVibe.amber
        case .idle, .offline: return nil
        }
    }
}

// MARK: - MachineChip

private struct MachineChip: View {
    let machine: AppModel.PairedMachine
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: HudSpacing.xs) {
                HudStatusDot(color: statusColor, size: 6, pulses: false)
                Text(machine.name)
                    .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                    .tracking(0.3)
                    .foregroundStyle(isSelected ? ScoutVibe.ink : (machine.isOnline ? ScoutVibe.ink.opacity(0.82) : ScoutInk.dim))
                    .lineLimit(1)
            }
            .padding(.horizontal, HudSpacing.sm)
            .padding(.vertical, HudSpacing.xs)
            .background(Capsule().fill(ScoutSurface.inset))
            .overlay(Capsule().stroke(isSelected ? HudSurface.tintBorder(ScoutVibe.accent) : ScoutVibe.hairline, lineWidth: HudStrokeWidth.thin))
            .opacity(machine.isOnline || isSelected ? 1 : 0.58)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(machine.name), \(accessibilityState)")
    }

    private var statusColor: Color {
        switch machine.connectionState {
        case .connected:  return ScoutVibe.accent
        case .connecting: return ScoutVibe.amber
        case .failed, .idle: return ScoutInk.dim
        }
    }

    private var accessibilityState: String {
        var parts: [String] = []
        if machine.isOnline { parts.append("online") }
        if isSelected { parts.append("selected") }
        if parts.isEmpty { parts.append("paired") }
        return parts.joined(separator: ", ")
    }
}

private struct AllMachinesChip: View {
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            Text("All")
                .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                .tracking(0.4)
                .foregroundStyle(isSelected ? ScoutVibe.ink : ScoutVibe.ink.opacity(0.82))
                .padding(.horizontal, HudSpacing.sm)
                .padding(.vertical, HudSpacing.xs)
                .background(Capsule().fill(ScoutSurface.inset))
                .overlay(Capsule().stroke(isSelected ? HudSurface.tintBorder(ScoutVibe.accent) : ScoutVibe.hairline, lineWidth: HudStrokeWidth.thin))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("All machines\(isSelected ? ", selected" : "")")
    }
}

// MARK: - Shared helpers

private func agentInitials(_ name: String) -> String {
    let parts = name.lowercased().split { !($0.isLetter || $0.isNumber) }.map(String.init).filter { !$0.isEmpty }
    let first = parts.first?.first
    let second = parts.count > 1 ? parts[1].first : parts.first.flatMap { $0.dropFirst().first }
    let letters = [first, second].compactMap { $0 }
    return letters.isEmpty ? "·" : String(letters)
}

private func homeActivitySignalColor(_ kind: TailEvent.Kind) -> Color {
    switch kind {
    case .assistant: return ScoutVibe.accent
    case .tool, .toolResult: return ScoutVibe.amber
    case .user: return ScoutInk.muted
    case .system, .other: return ScoutInk.dim
    }
}

private func relativeAgeString(_ date: Date?) -> String? {
    ScoutTimestamp.relativeAge(since: date)
}

private func meaningfulActionString(_ label: String?) -> String? {
    guard let s = label?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
    let generic: Set<String> = ["available", "idle", "offline", "online", "ready", "working", "unknown", "live"]
    return generic.contains(s.lowercased()) ? nil : s
}
