import SwiftUI
import HudsonUI
import ScoutCapabilities
import ScoutIOSCore

/// Home — a projects-first fleet landing with a live pulse on top.
///
/// Layout, top to bottom:
///   • **Working now** — agents actively running, surfaced with their progress
///     (current action, files touched, branch, time) so you can see motion and
///     jump straight into context. Hidden when nothing is live.
///   • **Projects** — the fleet organized by project. A single-agent project is
///     just its agent row (one tap into the conversation); a multi-agent project
///     collapses into an expandable header with a count, so you pick the project
///     then drill to its agents. The flat agent list still lives on the Agents tab.
struct HomeSurface: View {
    let model: AppModel
    /// Opens the connection detail for a tapped machine — switching / probing
    /// lives there, not on the rail itself.
    var onSelectMachine: (AppModel.PairedMachine) -> Void = { _ in }
    /// Changes when the data source becomes ready (e.g. the bridge finishes its
    /// handshake), so the load re-runs instead of staying parked on an empty
    /// result it fetched mid-connect.
    var reloadToken: Int = 0

    private var client: any ScoutBrokerClient { model.client }

    @State private var agents: [AgentSummary] = []
    @State private var isLoading = true
    @State private var searchText = ""
    @State private var route: ConversationRoute?
    @State private var expanded: Set<String> = []
    @State private var activity: [TailEvent] = []
    @State private var showAllProjects = false

    /// A Hashable navigation target — the contract models stay transport-pure.
    private struct ConversationRoute: Hashable, Identifiable {
        let id: String
        let title: String
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: HudSpacing.xxl) {
                if isLoading {
                    HudEmptyState(title: "Loading fleet", subtitle: "Reading agents from the broker.", icon: "antenna.radiowaves.left.and.right")
                } else if isFleetEmpty {
                    fleetEmptyState
                } else {
                    if !model.pairedMachines.isEmpty { machineRail }
                    searchField
                    if !liveAgents.isEmpty { currentlyWorkingSection }
                    projectsSection
                    if !recentActivity.isEmpty { activitySection }
                }
            }
            .padding(.horizontal, HudSpacing.xxl)
            .padding(.vertical, HudSpacing.xxl)
        }
        .refreshable { await load() }
        .task(id: reloadToken) { await load() }
        .navigationDestination(item: $route) { route in
            ConversationSurface(
                client: client,
                conversationId: route.id,
                title: route.title,
                onClose: { self.route = nil }
            )
        }
    }

    /// True when there's nothing to render — the paired-but-disconnected (or
    /// freshly-connected, nothing yet) case. Tracks what Home actually shows
    /// (agents drive the working/projects sections; activity drives the log), not
    /// a separately-fetched list, so we never strand an empty Projects section.
    private var isFleetEmpty: Bool { agents.isEmpty && activity.isEmpty }

    private var fleetEmptyState: some View {
        HudEmptyState(
            title: "No fleet yet",
            subtitle: "Once you're connected, your agents land here. Tap the status chip above to check the connection.",
            icon: "dot.radiowaves.left.and.right"
        )
        .frame(maxWidth: .infinity)
        .padding(.top, HudSpacing.huge)
    }

    // MARK: - Machine rail

    /// "What am I looking at." Paired base machines as inline chips — just the
    /// name and a reachable/idle dot (the connection type lives in Settings, not
    /// here). A quiet left caption instead of a header row; the chips scroll
    /// beside it. Tapping a chip opens the connection detail.
    private var machineRail: some View {
        HStack(spacing: HudSpacing.md) {
            Text("MACHINES")
                .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                .tracking(0.8)
                .foregroundStyle(HudPalette.muted)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: HudSpacing.sm) {
                    ForEach(model.pairedMachines) { machine in
                        MachineChip(machine: machine) { onSelectMachine(machine) }
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    // MARK: - Search

    private var searchField: some View {
        HudField("Search the fleet", text: $searchText, icon: "magnifyingglass")
    }

    private func matches(_ haystack: [String?], _ query: String) -> Bool {
        let q = query.lowercased()
        return haystack.compactMap { $0?.lowercased() }.contains { $0.contains(q) }
    }

    private var filteredAgents: [AgentSummary] {
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return agents }
        return agents.filter { matches([$0.title, $0.projectName, $0.branch, $0.harness, $0.model, $0.statusLabel], q) }
    }

    // MARK: - Working now (live agents, newest first)

    private var liveAgents: [AgentSummary] {
        filteredAgents
            .filter { $0.state == .live }
            .sorted { ($0.lastActiveAt ?? .distantPast) > ($1.lastActiveAt ?? .distantPast) }
    }

    /// Live agents as a horizontal strip of cards, each with a blinking cursor on
    /// its current action — the "someone's at the keyboard right now" pulse.
    private var currentlyWorkingSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            fleetHeader(title: "Currently working", count: liveAgents.count, accent: true)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: HudSpacing.md) {
                    ForEach(liveAgents) { agent in
                        WorkingCard(agent: agent, onTap: { tap(agent)?() })
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    // MARK: - Projects

    private func projectKey(_ agent: AgentSummary) -> String {
        if let project = agent.projectName, !project.isEmpty { return project }
        return agent.title
    }

    private var projectGroups: [ProjectGroup] {
        let grouped = Dictionary(grouping: filteredAgents, by: projectKey)
        return grouped
            .map { ProjectGroup(id: $0.key, name: $0.key, agents: sortAgents($0.value)) }
            .sorted { a, b in
                if a.liveCount != b.liveCount { return a.liveCount > b.liveCount }
                let la = a.lastActiveAt ?? .distantPast, lb = b.lastActiveAt ?? .distantPast
                if la != lb { return la > lb }
                return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
            }
    }

    private func sortAgents(_ list: [AgentSummary]) -> [AgentSummary] {
        list.sorted { a, b in
            if a.state != b.state { return stateRank(a.state) < stateRank(b.state) }
            let la = a.lastActiveAt ?? .distantPast, lb = b.lastActiveAt ?? .distantPast
            if la != lb { return la > lb }
            return a.title.localizedCaseInsensitiveCompare(b.title) == .orderedAscending
        }
    }

    private func stateRank(_ s: AgentSummary.State) -> Int {
        switch s {
        case .live: return 0
        case .idle: return 1
        case .unknown: return 2
        case .offline: return 3
        }
    }

    /// Home shows a capped preview of projects — the most active/recent — with a
    /// toggle to the full set. The flat, full list also lives on the Agents tab.
    private static let projectPreviewCap = 6

    private var visibleProjects: [ProjectGroup] {
        showAllProjects ? projectGroups : Array(projectGroups.prefix(Self.projectPreviewCap))
    }

    private var projectsSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            fleetHeader(title: "Projects", count: projectGroups.count, accent: false)
            listCard {
                ForEach(Array(visibleProjects.enumerated()), id: \.element.id) { index, group in
                    if index > 0 { rowSeparator() }
                    if group.agents.count == 1, let agent = group.agents.first {
                        // Single-agent project: the row *is* the agent — one tap to chat.
                        AgentFleetRow(agent: agent, onTap: tap(agent))
                    } else {
                        ProjectRow(group: group, isExpanded: expanded.contains(group.id)) {
                            toggle(group.id)
                        }
                        if expanded.contains(group.id) {
                            ForEach(group.agents) { agent in
                                rowSeparator(inset: true)
                                AgentFleetRow(agent: agent, showsProject: false, onTap: tap(agent))
                                    .padding(.leading, HudSpacing.lg)
                                    .background(HudSurface.inset)
                            }
                        }
                    }
                }
            }
            if projectGroups.count > Self.projectPreviewCap {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { showAllProjects.toggle() }
                } label: {
                    Text(showAllProjects ? "Show fewer" : "Show all \(projectGroups.count) projects")
                        .font(HudFont.mono(HudTextSize.xs, weight: .medium))
                        .foregroundStyle(HudPalette.muted)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.vertical, HudSpacing.xs)
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: - Shared chrome

    private func fleetHeader(title: String, count: Int, accent: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.md) {
            if accent {
                HudStatusDot(color: HudPalette.accent, size: 6, pulses: true)
            }
            HudSectionLabel("\(title) · \(count)")
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private func listCard<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 0) { content() }
            .background(RoundedRectangle(cornerRadius: HudRadius.card).fill(HudSurface.inset))
            .overlay(RoundedRectangle(cornerRadius: HudRadius.card).stroke(HudHairline.subtle, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: HudRadius.card))
    }

    private func rowSeparator(inset: Bool = false) -> some View {
        Rectangle()
            .fill(HudHairline.subtle)
            .frame(height: 1)
            .padding(.leading, inset ? HudSpacing.xxl : HudSpacing.xl)
    }

    private func tap(_ agent: AgentSummary) -> (() -> Void)? {
        agent.sessionId.map { sid in { route = ConversationRoute(id: sid, title: agent.title) } }
    }

    private func toggle(_ id: String) {
        if expanded.contains(id) { expanded.remove(id) } else { expanded.insert(id) }
    }

    // MARK: - Activity log (things agents have done)

    /// Newest-first, capped — Home is a glanceable preview, the full firehose
    /// lives on the Tail tab.
    private var recentActivity: [TailEvent] { Array(activity.prefix(6)) }

    private var activitySection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            fleetHeader(title: "Activity", count: activity.count, accent: false)
            listCard {
                ForEach(Array(recentActivity.enumerated()), id: \.element.id) { index, event in
                    if index > 0 { rowSeparator() }
                    ActivityRow(event: event, onTap: tapActivity(event))
                }
            }
        }
    }

    /// Tap an activity row to open the conversation it happened in. Events with
    /// no thread linkage (`conversationId == nil`) stay non-interactive.
    private func tapActivity(_ event: TailEvent) -> (() -> Void)? {
        guard let conversationId = event.conversationId, !conversationId.isEmpty else { return nil }
        return { route = ConversationRoute(id: conversationId, title: event.source) }
    }

    /// Merge the curated activity feed into `activity`, deduped by id and
    /// newest-first. Home is an orientation surface, so it reads the broker's
    /// curated message feed and refreshes on appear / pull-to-refresh — it does
    /// NOT fold in the live process firehose (that's the Tail tab's job).
    private func mergeActivity(_ incoming: [TailEvent]) {
        guard !incoming.isEmpty else { return }
        var seen = Set(activity.map(\.id))
        var merged = activity
        for event in incoming where !seen.contains(event.id) {
            merged.append(event)
            seen.insert(event.id)
        }
        merged.sort { $0.tsMs > $1.tsMs }
        if merged.count > 24 { merged.removeLast(merged.count - 24) }
        activity = merged
    }

    // MARK: - Load

    private func load() async {
        isLoading = true
        agents = (try? await client.listAgents(query: nil, limit: 20)) ?? []
        // Backfill recent activity — the live tail stream only delivers events
        // that arrive after we subscribe, so without this the section is empty
        // until something new happens.
        mergeActivity((try? await client.recentActivity(limit: 24)) ?? [])
        isLoading = false
        #if DEBUG
        if ProcessInfo.processInfo.environment["SCOUTNEXT_DEMO"] == "1" { seedDemoActivity() }
        #endif
    }

    #if DEBUG
    /// Debug-only: inject a couple of live agents + recent activity so the
    /// "Currently working" and "Activity" sections can be seen and tuned without
    /// a real agent running. Gated behind the SCOUTNEXT_DEMO env var — never ships.
    private func seedDemoActivity() {
        let now = Date()
        agents.insert(contentsOf: [
            AgentSummary(id: "demo.1", title: "broker-smith", harness: "claude", projectName: "openscout",
                         branch: "feat/in-app-session", git: GitState(ahead: 1, behind: 0, dirty: 3),
                         model: "claude-opus-4-8", statusLabel: "editing HomeSurface.swift",
                         state: .live, sessionId: "demo.s1", lastActiveAt: now),
            AgentSummary(id: "demo.2", title: "tail-tuner", harness: "codex", projectName: "hudson",
                         branch: "feat/tail-tokens", git: GitState(ahead: 2, behind: 0, dirty: 0),
                         model: "gpt-5-codex", statusLabel: "streaming tail tokens",
                         state: .live, sessionId: "demo.s2", lastActiveAt: now.addingTimeInterval(-95)),
        ], at: 0)
        func ms(_ offset: TimeInterval) -> Int64 { Int64((now.addingTimeInterval(offset).timeIntervalSince1970) * 1000) }
        activity = [
            TailEvent(id: "ev1", tsMs: ms(-20), source: "claude", harness: .scoutManaged, kind: .tool, summary: "Ran swift build — 0 errors, 0 warnings"),
            TailEvent(id: "ev2", tsMs: ms(-95), source: "codex", harness: .hudsonManaged, kind: .assistant, summary: "Wired HudCodeHighlighter into the message renderer"),
            TailEvent(id: "ev3", tsMs: ms(-300), source: "claude", harness: .scoutManaged, kind: .toolResult, summary: "Edited ConversationSurface.swift (+14 −6)"),
            TailEvent(id: "ev4", tsMs: ms(-840), source: "codex", harness: .hudsonManaged, kind: .tool, summary: "git commit — projects-first Home + machine rail"),
            TailEvent(id: "ev5", tsMs: ms(-1500), source: "claude", harness: .unattributed, kind: .user, summary: "ship the v0-2 ttf to hero/output"),
        ]
    }
    #endif
}

// MARK: - ProjectGroup

private struct ProjectGroup: Identifiable {
    let id: String
    let name: String
    let agents: [AgentSummary]

    var liveCount: Int { agents.filter { $0.state == .live }.count }
    var lastActiveAt: Date? { agents.compactMap(\.lastActiveAt).max() }
}

// MARK: - WorkingCard

/// One live agent in the "Currently working" strip: name, its current action with
/// a blinking terminal cursor (so it reads as actively typing), and a compact
/// progress line — files touched, branch, time.
private struct WorkingCard: View {
    let agent: AgentSummary
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                HStack(spacing: HudSpacing.xs) {
                    HudStatusDot(color: HudPalette.accent, size: 6, pulses: true)
                    Text(agent.title)
                        .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                        .foregroundStyle(HudPalette.ink)
                        .lineLimit(1)
                }
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    Text(actionText)
                        .font(HudFont.mono(HudTextSize.xs))
                        .foregroundStyle(HudPalette.muted)
                        .lineLimit(1)
                        .truncationMode(.head)
                    BlinkingCursor()
                }
                if let progress = progressLine {
                    Text(progress)
                        .font(HudFont.mono(HudTextSize.micro))
                        .foregroundStyle(HudPalette.dim)
                        .lineLimit(1)
                }
            }
            .frame(width: 188, alignment: .leading)
            .padding(HudSpacing.md)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                    .fill(HudSurface.inset)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                    .stroke(HudSurface.tintBorder(HudPalette.accent), lineWidth: HudStrokeWidth.standard)
            )
            .contentShape(RoundedRectangle(cornerRadius: HudRadius.card))
        }
        .buttonStyle(.plain)
    }

    private var actionText: String {
        meaningfulActionString(agent.statusLabel) ?? "working"
    }

    private var progressLine: String? {
        var parts: [String] = []
        if let git = agent.git, git.dirty > 0 { parts.append("+\(git.dirty)") }
        if let branch = agent.branch { parts.append("\u{2387} \(branch)") }
        if let age = relativeAgeString(agent.lastActiveAt) { parts.append(age) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

/// A blinking caret — the "agent is typing" tell, echoing the web view. A thin
/// full-height bar (a line, not a block) that crosses the text baseline so it
/// reads as an insertion point sitting on the action line.
private struct BlinkingCursor: View {
    @State private var visible = true

    var body: some View {
        Rectangle()
            .fill(HudPalette.accent)
            .frame(width: 2, height: 13)
            // Bar runs ascender→just-below-baseline: put the baseline ~2pt up from
            // the bottom so the caret crosses the line instead of floating above it.
            .alignmentGuide(.firstTextBaseline) { dimensions in dimensions.height - 2 }
            .opacity(visible ? 1 : 0)
            .onAppear {
                withAnimation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true)) {
                    visible = false
                }
            }
    }
}

// MARK: - ActivityRow

/// One line of the activity log — what an agent did, who, and when.
private struct ActivityRow: View {
    let event: TailEvent
    /// Set when the event links to a conversation; nil rows render inert.
    var onTap: (() -> Void)? = nil

    var body: some View {
        Button { onTap?() } label: { rowContent }
            .buttonStyle(.plain)
            .disabled(onTap == nil)
    }

    private var rowContent: some View {
        HStack(alignment: .top, spacing: HudSpacing.md) {
            HudStatusDot(color: kindColor, size: 6, pulses: false)
                .padding(.top, 5)
            VStack(alignment: .leading, spacing: 2) {
                Text(event.summary)
                    .font(HudFont.ui(HudTextSize.sm))
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(metaLine)
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(HudPalette.muted)
            }
            if onTap != nil {
                Image(systemName: "chevron.right")
                    .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(HudPalette.dim)
                    .padding(.top, 4)
            }
        }
        .padding(.horizontal, HudSpacing.xl)
        .padding(.vertical, HudSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    private var metaLine: String {
        var parts = [event.source, event.kind.rawValue]
        if let age = relativeAgeString(Date(timeIntervalSince1970: Double(event.tsMs) / 1000)) {
            parts.append(age)
        }
        return parts.joined(separator: " · ")
    }

    private var kindColor: Color {
        switch event.kind {
        case .assistant: return HudPalette.accent
        case .tool, .toolResult: return HudPalette.statusWarn
        case .user: return HudPalette.muted
        case .system, .other: return HudPalette.dim
        }
    }
}

// MARK: - MachineChip

/// One base machine in the Home rail — kept neutral and compact. The fill is
/// always a quiet inset; the only color is a small green dot when the machine is
/// connectable. Machines we can't currently reach read as dimmed/disabled.
private struct MachineChip: View {
    let machine: AppModel.PairedMachine
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: HudSpacing.xs) {
                Circle()
                    .fill(machine.isActive ? HudPalette.accent : HudPalette.dim)
                    .frame(width: 6, height: 6)
                Text(machine.name)
                    .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                    .foregroundStyle(machine.isActive ? HudPalette.ink : HudPalette.muted)
                    .lineLimit(1)
            }
            .padding(.horizontal, HudSpacing.sm)
            .padding(.vertical, HudSpacing.xs)
            .background(Capsule().fill(HudSurface.inset))
            .overlay(Capsule().stroke(HudHairline.standard, lineWidth: HudStrokeWidth.thin))
            .opacity(machine.isActive ? 1 : 0.6)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - ProjectRow

/// A collapsed multi-agent project: name, a live dot when any agent is running,
/// the agent count, and the project's most-recent activity. Tapping expands to
/// the agents beneath it.
private struct ProjectRow: View {
    let group: ProjectGroup
    let isExpanded: Bool
    let onToggle: () -> Void

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: HudSpacing.md) {
                Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                    .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(HudPalette.muted)
                    .frame(width: 12)
                Text(group.name)
                    .font(HudFont.ui(HudTextSize.md, weight: .semibold))
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(1)
                if group.liveCount > 0 {
                    HudStatusDot(color: HudPalette.accent, size: 6, pulses: true)
                }
                Spacer(minLength: HudSpacing.md)
                Text("\(group.agents.count) agents")
                    .font(HudFont.mono(HudTextSize.xs))
                    .foregroundStyle(HudPalette.muted)
                if let age = relativeAgeString(group.lastActiveAt) {
                    Text(age)
                        .font(HudFont.mono(HudTextSize.xs))
                        .foregroundStyle(HudPalette.muted)
                        .monospacedDigit()
                }
            }
            .padding(.horizontal, HudSpacing.xl)
            .padding(.vertical, HudSpacing.md)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - AgentFleetRow

/// A compact read of one agent. By default a single line — name, an inline
/// `project · model` locator, and a right-edge signal (live/offline badge or a
/// relative age). It grows a tight second line only when there's genuine detail
/// (branch, git posture, or a real in-flight action), so an idle fleet stays terse.
private struct AgentFleetRow: View {
    let agent: AgentSummary
    /// Hidden when the row is already nested under its project header.
    var showsProject: Bool = true
    let onTap: (() -> Void)?

    var body: some View {
        Button(action: { onTap?() }) {
            VStack(alignment: .leading, spacing: HudSpacing.xxs) {
                identityLine
                if hasDetailLine { detailLine }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, HudSpacing.xl)
            .padding(.vertical, HudSpacing.md)
            .contentShape(Rectangle())
            .opacity(onTap == nil ? HudOpacity.muted : 1)
        }
        .buttonStyle(.plain)
        .disabled(onTap == nil)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
    }

    // Line 1 — name, inline locator, right-edge signal.
    private var identityLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.md) {
            Text(agent.title)
                .font(HudFont.ui(HudTextSize.md, weight: .semibold))
                .foregroundStyle(HudPalette.ink)
                .lineLimit(1)
                .layoutPriority(1)
            if let locator = locator {
                Text(locator)
                    .font(HudFont.mono(HudTextSize.xs))
                    // Subordinate to the name: the mono locator was reading at full
                    // ink and fighting the sans title. Muted lets the name lead and
                    // the runtime/project sit as a quiet tag beside it.
                    .foregroundStyle(HudPalette.muted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .layoutPriority(0)
            }
            Spacer(minLength: HudSpacing.md)
            if showsStateBadge {
                HudBadge(stateLabel, tint: stateColor, dot: true)
            } else if let age = relativeAgeString(agent.lastActiveAt) {
                Text(age)
                    .font(HudFont.mono(HudTextSize.xs))
                    .foregroundStyle(HudPalette.muted)
                    .monospacedDigit()
            }
        }
    }

    /// Only `live`/`offline` earn a badge; idle/unknown read via the relative age.
    private var showsStateBadge: Bool {
        agent.state == .live || agent.state == .offline
    }

    // Line 2 — branch · git posture · current action (only the parts present).
    private var detailLine: some View {
        HStack(spacing: HudSpacing.lg) {
            if let branch = agent.branch {
                HStack(spacing: HudSpacing.xs) {
                    Text("\u{2387}")  // ⎇ branch glyph
                        .foregroundStyle(HudPalette.muted)
                    Text(branch)
                        .foregroundStyle(HudPalette.ink)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            if let git = agent.git {
                Text(gitPhrase(git))
                    .foregroundStyle(git.isClean ? HudPalette.muted : HudPalette.ink)
                    .fontWeight(git.isClean ? .regular : .medium)
            }
            if let action = meaningfulActionString(agent.statusLabel) {
                Text("\u{2192} \(action)")  // → action
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            Spacer(minLength: 0)
        }
        .font(HudFont.mono(HudTextSize.xs))
    }

    /// Inline `project · model` (model falls back to the harness family). The
    /// project is dropped when it just restates the agent name, or when the row
    /// is already nested under its project header.
    private var locator: String? {
        var parts: [String] = []
        if showsProject, let project = agent.projectName, !project.isEmpty, !projectRestatesTitle {
            parts.append(project)
        }
        if let model = (agent.model ?? agent.harness), !model.isEmpty { parts.append(model) }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// True when the project name is just the agent title in different clothes
    /// (case / spaces / dashes), e.g. "Narrative Studio" ⇄ "narrative-studio".
    private var projectRestatesTitle: Bool {
        guard let project = agent.projectName else { return false }
        func key(_ s: String) -> String { s.lowercased().filter { $0.isLetter || $0.isNumber } }
        return key(project) == key(agent.title)
    }

    private var hasDetailLine: Bool {
        agent.branch != nil || agent.git != nil || meaningfulActionString(agent.statusLabel) != nil
    }

    /// "+2 ↑1" / "↓3" / "clean". Dirty (uncommitted) first, then ahead/behind.
    private func gitPhrase(_ g: GitState) -> String {
        if g.isClean { return "clean" }
        var parts: [String] = []
        if g.dirty > 0 { parts.append("+\(g.dirty)") }
        if g.ahead > 0 { parts.append("\u{2191}\(g.ahead)") }   // ↑ ahead
        if g.behind > 0 { parts.append("\u{2193}\(g.behind)") }  // ↓ behind
        return parts.joined(separator: " ")
    }

    private var stateLabel: String {
        switch agent.state {
        case .live: return "live"
        case .idle: return "idle"
        case .offline: return "offline"
        case .unknown: return "unknown"
        }
    }

    private var stateColor: Color {
        switch agent.state {
        case .live: return HudPalette.accent
        case .idle: return HudPalette.muted
        case .offline, .unknown: return HudPalette.dim
        }
    }

    private var accessibilityLabel: String {
        var parts = [agent.title, stateLabel]
        if let branch = agent.branch { parts.append("branch \(branch)") }
        if let action = agent.statusLabel { parts.append(action) }
        return parts.joined(separator: ", ")
    }
}

// MARK: - Shared row helpers

/// A terse "last active" age — "now", "5m", "2h", "3d".
private func relativeAgeString(_ date: Date?) -> String? {
    guard let t = date else { return nil }
    let s = Date().timeIntervalSince(t)
    if s < 45 { return "now" }
    if s < 3_600 { return "\(Int(s / 60))m" }
    if s < 86_400 { return "\(Int(s / 3_600))h" }
    return "\(Int(s / 86_400))d"
}

/// The status label, but only when it carries signal beyond the state — generic
/// restatements ("idle", "working", …) are dropped so they don't echo the badge.
private func meaningfulActionString(_ label: String?) -> String? {
    guard let s = label?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
    let generic: Set<String> = ["available", "idle", "offline", "online", "ready", "working", "unknown", "live"]
    return generic.contains(s.lowercased()) ? nil : s
}
