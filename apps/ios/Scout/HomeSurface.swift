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
///   • **Projects** — the fleet organized by project. A single-agent project keeps
///     its folder identity and compresses its only agent inline, like a one-child
///     path in an IDE tree. Multi-agent projects expand to child rows.
struct HomeSurface: View {
    let model: AppModel
    @Environment(\.scoutLayout) private var layout
    /// Focuses/filters the app through a tapped machine. Online state is
    /// independent: several chips can be lit, but only one is the filter target.
    var onSelectMachine: (AppModel.PairedMachine) -> Void = { _ in }
    /// Widens the filter back to the whole fleet (the `[All]` chip).
    var onSelectAll: () -> Void = {}
    /// Publishes conversation/session detail to the global protected-area
    /// status bar while Home has pushed a chat.
    var onConversationStatusContext: (String?) -> Void = { _ in }
    /// Jumps to the Agents tab — the full fleet roster behind Home's preview.
    var onSeeAllAgents: () -> Void = {}
    /// Changes when the data source becomes ready (e.g. the bridge finishes its
    /// handshake), so the load re-runs instead of staying parked on an empty
    /// result it fetched mid-connect.
    var reloadToken: Int = 0

    private var client: any ScoutBrokerClient { model.client }

    @State private var agents: [AgentSummary] = []
    @State private var isLoading = true
    @State private var searchText = ""
    @State private var route: HomeConversationRoute?
    @State private var expanded: Set<String> = []
    @State private var expandedActivity: Set<String> = []
    @State private var activity: [TailEvent] = []
    @State private var showAllActivity = false

    /// A Hashable navigation target for Home's activity shortcuts. Session
    /// conversation IDs open the session projection; broker comms IDs open the
    /// comms thread reader.
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

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: layout.surfaceSectionSpacing) {
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
            .padding(.horizontal, layout.surfacePadding)
            .padding(.top, layout.surfaceTopPadding)
            .padding(.bottom, layout.surfaceBottomPadding)
        }
        .refreshable { await load() }
        .task(id: reloadToken) { await load() }
        .navigationDestination(item: $route) { route in
            switch route {
            case .session(let id, let title):
                ConversationSurface(
                    client: client,
                    conversationId: id,
                    title: title,
                    onClose: { self.route = nil },
                    onStatusContextChange: onConversationStatusContext
                )
            case .comms(let conversation):
                CommsThreadView(
                    client: client,
                    conversation: conversation,
                    onClose: { self.route = nil },
                    onRead: { _ = try? await client.markConversationRead(conversationId: conversation.id) }
                )
            }
        }
        // Activity's "All" pushes the full live firehose — Home only previews it.
        .navigationDestination(isPresented: $showAllActivity) {
            TailSurface(client: client)
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
                    // The fleet-wide filter leads the rail when there's more than
                    // one Mac to span — "see everything" without toggling each one.
                    if showsAllChip {
                        AllMachinesChip(isSelected: model.machineFilter == .all) { onSelectAll() }
                    }
                    ForEach(model.pairedMachines) { machine in
                        MachineChip(machine: machine, isSelected: isFilterSelected(machine)) {
                            onSelectMachine(machine)
                        }
                    }
                    // Pairing rides along as one more chip — same decoration as a
                    // machine, just quieter — so it reads as "add another," not a
                    // standalone control competing with the settings gear.
                    addMachineChip
                }
                .padding(.vertical, 2)
            }
        }
    }

    /// The `[All]` chip only earns its place once a second Mac exists; with one
    /// machine, All and that machine are the same set, so the rail stays bare.
    private var showsAllChip: Bool { model.pairedMachines.count > 1 }

    /// Which machine chip wears the selected (accent) treatment. Driven by the
    /// filter, not the bound Mac: under `.all` the `[All]` chip owns the highlight
    /// (and a lone-Mac rail highlights its single chip); under `.machine` exactly
    /// one chip lights.
    private func isFilterSelected(_ machine: AppModel.PairedMachine) -> Bool {
        switch model.machineFilter {
        case .all: return !showsAllChip
        case .machine(let id): return id == machine.id
        }
    }

    /// A quiet "add another base machine" chip that routes into the (camera-free)
    /// pairing sheet. Same capsule decoration as `MachineChip`, a tone down.
    private var addMachineChip: some View {
        Button { model.showPairing = true } label: {
            HStack(spacing: HudSpacing.xs) {
                ZStack {
                    Capsule().frame(width: 7, height: 1.4)
                    Capsule().frame(width: 1.4, height: 7)
                }
                .foregroundStyle(HudPalette.dim)
                .frame(width: 8, height: 8)
                Text("Add")
                    .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                    .foregroundStyle(HudPalette.muted)
            }
            .padding(.horizontal, HudSpacing.sm)
            .padding(.vertical, HudSpacing.xs)
            .background(Capsule().fill(HudSurface.inset))
            .overlay(Capsule().stroke(HudHairline.standard, lineWidth: HudStrokeWidth.thin))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Add machine")
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
            fleetHeader(title: "Currently working", detail: "\(liveAgents.count) live", accent: true)
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

    /// Home keeps Projects as a bounded, scrollable preview. It renders the
    /// loaded groups in the section instead of pretending the visible rows are a
    /// meaningful total; the full fleet roster still lives behind the Agents tab.
    private static let projectViewportRows = 8
    private static let projectCollapsedRowHeight: CGFloat = 49

    private var projectListMaxHeight: CGFloat {
        CGFloat(Self.projectViewportRows) * Self.projectCollapsedRowHeight
    }

    private var projectsSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            fleetHeader(title: "Projects", accent: false, onAll: onSeeAllAgents)
            listCard {
                ScrollView(.vertical, showsIndicators: projectGroups.count > Self.projectViewportRows) {
                    VStack(spacing: 0) {
                        ForEach(Array(projectGroups.enumerated()), id: \.element.id) { index, group in
                            if index > 0 { rowSeparator() }
                            let soloAgent = group.agents.count == 1 ? group.agents.first : nil
                            ProjectRow(
                                group: group,
                                isExpanded: soloAgent == nil && expanded.contains(group.id),
                                soloAgent: soloAgent,
                                showsDisclosure: soloAgent == nil || soloAgent.flatMap(tap) != nil
                            ) {
                                if let soloAgent {
                                    tap(soloAgent)?()
                                } else {
                                    toggle(group.id)
                                }
                            }
                            if soloAgent == nil && expanded.contains(group.id) {
                                ForEach(Array(group.agents.enumerated()), id: \.offset) { agentIndex, agent in
                                    rowSeparator(inset: true)
                                    AgentFleetRow(
                                        agent: agent,
                                        projectName: group.name,
                                        leadingLeaf: true,
                                        treeBranch: .init(isLast: agentIndex == group.agents.count - 1),
                                        onTap: tap(agent)
                                    )
                                        .background(HudSurface.inset)
                                }
                            }
                        }
                    }
                }
                .frame(maxHeight: projectListMaxHeight)
            }
        }
    }

    // MARK: - Shared chrome

    private func fleetHeader(title: String, detail: String? = nil, accent: Bool, onAll: (() -> Void)? = nil) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.md) {
            if accent {
                HudStatusDot(color: HudPalette.accent, size: 6, pulses: true)
            }
            HudSectionLabel(detail.map { "\(title) · \($0)" } ?? title)
            Spacer(minLength: 0)
            if let onAll {
                // The "see everything" affordance is a compact trailing action,
                // not a row of its own — Projects → Agents tab, Activity → tail.
                // It IS a HudSectionLabel, so it matches "PROJECTS"/"ACTIVITY"
                // exactly in size + caps; only the accent tint marks it tappable
                // (no arrow — the color carries the "goes somewhere" signal).
                Button(action: onAll) {
                    HudSectionLabel("All", tint: HudPalette.accent)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("See all \(title.lowercased())")
            }
        }
    }

    @ViewBuilder
    private func listCard<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 0) { content() }
            .scoutCard()
    }

    private func rowSeparator(inset: Bool = false) -> some View {
        Rectangle()
            .fill(HudHairline.subtle)
            .frame(height: 1)
            .padding(.leading, inset ? HudSpacing.xxl : HudSpacing.xl)
    }

    /// Open an agent's conversation. We route by the agent's real broker
    /// `conversationId` — its operator DM — NOT its `sessionId` (a harness label
    /// like "relay-openscout-claude" that's shared across agents and resolves to
    /// no conversation). When the bridge predates this field, fall back to the
    /// canonical `dm.operator.<id>` the broker will create on first send. Agent
    /// taps always open the full conversation surface (composer + streaming), so
    /// this skips the comms-reader detection used for activity-feed links.
    private func tap(_ agent: AgentSummary) -> (() -> Void)? {
        let conversationId = agent.conversationId ?? "dm.operator.\(agent.id)"
        return { route = .session(id: conversationId, title: agent.title) }
    }

    private func toggle(_ id: String) {
        if expanded.contains(id) { expanded.remove(id) } else { expanded.insert(id) }
    }

    // MARK: - Activity log (things agents have done)

    /// Newest-first, bounded and scrollable. Home is a glanceable orientation
    /// surface; the full firehose lives on the Tail tab.
    private static let activityPreviewCap = 12
    private static let activityViewportRows = 8
    private static let activityCollapsedRowHeight: CGFloat = 54

    private var recentActivity: [TailEvent] { Array(activity.prefix(Self.activityPreviewCap)) }

    private var activityListMaxHeight: CGFloat {
        CGFloat(Self.activityViewportRows) * Self.activityCollapsedRowHeight
    }

    private var activitySection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.md) {
            fleetHeader(title: "Latest activity", accent: false, onAll: { showAllActivity = true })
            listCard {
                ScrollView(.vertical, showsIndicators: recentActivity.count > Self.activityViewportRows) {
                    VStack(spacing: 0) {
                        ForEach(Array(recentActivity.enumerated()), id: \.element.id) { index, event in
                            if index > 0 { rowSeparator() }
                            ActivityRow(
                                event: event,
                                isExpanded: expandedActivity.contains(event.id),
                                onToggle: { toggleActivity(event.id) },
                                onOpen: tapActivity(event)
                            )
                        }
                    }
                }
                .frame(maxHeight: activityListMaxHeight)
            }
        }
    }

    /// Tap an activity row to open the conversation it happened in. Events with
    /// no thread linkage (`conversationId == nil`) stay non-interactive.
    private func tapActivity(_ event: TailEvent) -> (() -> Void)? {
        guard let conversationId = event.conversationId, !conversationId.isEmpty else { return nil }
        return { route = activityRoute(for: event, conversationId: conversationId) }
    }

    private func activityRoute(for event: TailEvent, conversationId: String) -> HomeConversationRoute {
        if let comms = commsConversation(
            from: conversationId,
            titleFallback: event.source,
            preview: event.summary,
            timestamp: Date(timeIntervalSince1970: Double(event.tsMs) / 1000)
        ) {
            return .comms(comms)
        }
        return .session(id: conversationId, title: event.source)
    }

    private func commsConversation(
        from conversationId: String,
        titleFallback: String?,
        preview: String?,
        timestamp: Date?
    ) -> CommsConversation? {
        if conversationId.starts(with: "dm.operator.") {
            let title = commsTitle(from: conversationId, prefix: "dm.operator.", fallback: titleFallback)
            return CommsConversation(
                id: conversationId,
                kind: .direct,
                title: title,
                participants: [title],
                lastMessagePreview: preview,
                lastMessageAt: timestamp
            )
        }
        if conversationId.starts(with: "channel.") {
            let title = commsTitle(from: conversationId, prefix: "channel.")
            return CommsConversation(
                id: conversationId,
                kind: title == "system" ? .system : .channel,
                title: title,
                topic: title == "system" ? "system" : "channel",
                lastMessagePreview: preview,
                lastMessageAt: timestamp
            )
        }
        if conversationId.starts(with: "group.") {
            let title = commsTitle(from: conversationId, prefix: "group.", fallback: titleFallback)
            return CommsConversation(
                id: conversationId,
                kind: .group,
                title: title,
                participants: [title],
                lastMessagePreview: preview,
                lastMessageAt: timestamp
            )
        }
        if conversationId.starts(with: "thread.") {
            return CommsConversation(
                id: conversationId,
                kind: .thread,
                title: commsTitle(from: conversationId, prefix: "thread.", fallback: titleFallback),
                lastMessagePreview: preview,
                lastMessageAt: timestamp
            )
        }
        return nil
    }

    private func commsTitle(from conversationId: String, prefix: String, fallback: String? = nil) -> String {
        let raw = conversationId.hasPrefix(prefix) ? String(conversationId.dropFirst(prefix.count)) : conversationId
        let derived = raw
            .split(separator: ".")
            .first
            .map(String.init)?
            .replacingOccurrences(of: "-", with: " ")
            ?? raw
        guard let fallback = fallback?.trimmingCharacters(in: .whitespacesAndNewlines),
              !fallback.isEmpty,
              fallback.caseInsensitiveCompare("operator") != .orderedSame,
              fallback.caseInsensitiveCompare("you") != .orderedSame
        else {
            return derived
        }
        return fallback
    }

    private func toggleActivity(_ id: String) {
        if expandedActivity.contains(id) { expandedActivity.remove(id) } else { expandedActivity.insert(id) }
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
        // Show the full-screen loading state only on the very first load. Later
        // refreshes — pull-to-refresh, or the `.task` SwiftUI restarts when Home
        // re-appears after popping a pushed conversation — update in place so the
        // existing content never blanks back to "Loading". Returning to Home is a
        // neutral step: the data that was there stays there while we refresh.
        if agents.isEmpty && activity.isEmpty { isLoading = true }
        // Don't clobber what's on screen if a refresh fails — keep the last good
        // fleet rather than dropping to the empty state on a transient error.
        if let fresh = try? await client.listAgents(query: nil, limit: 20) { agents = fresh }
        // Backfill recent activity — the live tail stream only delivers events
        // that arrive after we subscribe, so without this the section is empty
        // until something new happens.
        mergeActivity((try? await client.recentActivity(limit: 24)) ?? [])
        isLoading = false
        #if DEBUG
        if ProcessInfo.processInfo.environment["SCOUT_DEMO"] == "1" { seedDemoActivity() }
        #endif
    }

    #if DEBUG
    /// Debug-only: inject a couple of live agents + recent activity so the
    /// "Currently working" and "Activity" sections can be seen and tuned without
    /// a real agent running. Gated behind the SCOUT_DEMO env var — never ships.
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
                    // A soft accent glow so the live card reads as lit.
                    .shadow(color: HudPalette.accent.opacity(0.16), radius: 10)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                    .stroke(HudSurface.tintBorder(HudPalette.accent), lineWidth: HudStrokeWidth.standard)
            )
            // Cockpit corner framing on the top edge.
            .overlay(alignment: .topLeading) { CornerMark(corner: .topLeading).padding(7) }
            .overlay(alignment: .topTrailing) { CornerMark(corner: .topTrailing).padding(7) }
            .contentShape(RoundedRectangle(cornerRadius: HudRadius.card))
        }
        .buttonStyle(.plain)
    }

    private var actionText: String {
        meaningfulActionString(agent.statusLabel) ?? "working"
    }

    /// Live strip → recency is implied by the pulse, so the meta line carries
    /// location + git facts (project · +dirty · branch), not the age.
    private var progressLine: String? {
        var parts: [String] = []
        if let project = agent.projectName, !project.isEmpty { parts.append(project) }
        if let git = agent.git, git.dirty > 0 { parts.append("+\(git.dirty)") }
        if let branch = agent.branch { parts.append("\u{2387} \(branch)") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

/// A small accent L-bracket for cockpit-style corner framing on a card. The two
/// strokes anchor to the given corner so they meet cleanly at the edge.
private struct CornerMark: View {
    let corner: Alignment
    var body: some View {
        let len: CGFloat = 9
        let weight: CGFloat = 1.5
        ZStack(alignment: corner) {
            Rectangle().fill(HudPalette.accent).frame(width: len, height: weight)
            Rectangle().fill(HudPalette.accent).frame(width: weight, height: len)
        }
        .frame(width: len, height: len, alignment: corner)
        .opacity(0.55)
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
    let isExpanded: Bool
    let onToggle: () -> Void
    /// Set when the event links to a conversation; nil rows still expand but do
    /// not offer a drill-in action.
    var onOpen: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 0) {
            Button(action: onToggle) { rowContent }
                .buttonStyle(.plain)

            if isExpanded {
                expandedActions
            }
        }
    }

    private var rowContent: some View {
        HStack(alignment: .top, spacing: HudSpacing.md) {
            HudStatusDot(color: kindColor, size: 6, pulses: false)
                .padding(.top, 5)
            VStack(alignment: .leading, spacing: 2) {
                Text(event.summary)
                    .font(HudFont.ui(HudTextSize.sm))
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(isExpanded ? 4 : 1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(metaLine)
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(HudPalette.muted)
                    .lineLimit(1)
            }
            Glyphic.chevron(isExpanded ? .bottom : .trailing, size: 13)
                .foregroundStyle(HudPalette.dim)
                .padding(.top, 4)
        }
        .padding(.horizontal, HudSpacing.xl)
        .padding(.vertical, HudSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var expandedActions: some View {
        HStack(alignment: .center, spacing: HudSpacing.sm) {
            Text(expandedMetaLine)
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(HudPalette.dim)
                .lineLimit(1)
            Spacer(minLength: HudSpacing.md)
            if let onOpen {
                Button(action: onOpen) {
                    HStack(spacing: HudSpacing.xs) {
                        Text("Open")
                        Glyphic.arrow(.trailing, size: 11)
                    }
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .foregroundStyle(HudPalette.accent)
                    .padding(.horizontal, HudSpacing.sm)
                    .padding(.vertical, HudSpacing.xs)
                    .background(Capsule().fill(HudSurface.inset))
                    .overlay(Capsule().stroke(HudSurface.tintBorder(HudPalette.accent), lineWidth: HudStrokeWidth.thin))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open activity conversation")
            }
        }
        .padding(.leading, HudSpacing.xxl + HudSpacing.md)
        .padding(.trailing, HudSpacing.xl)
        .padding(.bottom, HudSpacing.sm)
    }

    private var metaLine: String {
        var parts = [event.source, event.kind.rawValue]
        if let age = relativeAgeString(Date(timeIntervalSince1970: Double(event.tsMs) / 1000)) {
            parts.append(age)
        }
        return parts.joined(separator: " · ")
    }

    private var expandedMetaLine: String {
        var parts = [attributionLabel, event.kind.rawValue]
        if let age = relativeAgeString(Date(timeIntervalSince1970: Double(event.tsMs) / 1000)) {
            parts.append(age)
        }
        return parts.joined(separator: " · ")
    }

    private var attributionLabel: String {
        switch event.harness {
        case .scoutManaged: return "Scout"
        case .hudsonManaged: return "Hudson"
        case .unattributed: return "Unattributed"
        }
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

/// One base machine in the Home rail — kept neutral and compact. The status dot
/// is reachability (`isOnline`), while the capsule stroke/text strength is the
/// current focus/filter. Multiple chips may be green; only one is focused.
private struct MachineChip: View {
    let machine: AppModel.PairedMachine
    /// The current filter target (accent treatment) — distinct from `isActive`,
    /// which is the bound Mac shown in the status bar.
    let isSelected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: HudSpacing.xs) {
                HudStatusDot(color: statusColor, size: 6, pulses: statusPulses)
                Text(machine.name)
                    .font(HudFont.ui(HudTextSize.xs, weight: .medium))
                    .foregroundStyle(isSelected ? HudPalette.ink : (machine.isOnline ? HudPalette.ink.opacity(0.82) : HudPalette.muted))
                    .lineLimit(1)
            }
            .padding(.horizontal, HudSpacing.sm)
            .padding(.vertical, HudSpacing.xs)
            .background(Capsule().fill(HudSurface.inset))
            .overlay(Capsule().stroke(isSelected ? HudSurface.tintBorder(HudPalette.accent) : HudHairline.standard, lineWidth: HudStrokeWidth.thin))
            .shadow(color: machine.isOnline ? HudPalette.accent.opacity(0.12) : .clear, radius: 7)
            .opacity(machine.isOnline || isSelected ? 1 : 0.58)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(machine.name), \(accessibilityState)")
    }

    private var statusColor: Color {
        switch machine.connectionState {
        case .connected:  return HudPalette.accent
        case .connecting: return HudPalette.statusWarn
        // The rail is a picker, not an alarm: an offline or unreachable Mac
        // reads gray ("not here right now"), never red. Real connection errors
        // surface in the footer, on the machine you're actually bound to.
        case .failed, .idle: return HudPalette.dim
        }
    }

    private var statusPulses: Bool {
        if case .connecting = machine.connectionState { return true }
        return false
    }

    private var accessibilityState: String {
        var parts: [String] = []
        if machine.isOnline { parts.append("online") }
        if isSelected { parts.append("selected") }
        if parts.isEmpty { parts.append("paired") }
        return parts.joined(separator: ", ")
    }
}

/// The fleet-wide filter chip: a hand-drawn `[ All ]` (bracketed, accent when
/// active) that spans every paired Mac in one selection. Same capsule body as a
/// `MachineChip` so it sits in the rail as a peer, not a separate control.
private struct AllMachinesChip: View {
    let isSelected: Bool
    let onTap: () -> Void

    private var tint: Color { isSelected ? HudPalette.accent : HudPalette.muted }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 3) {
                MachineBracket(.leading).stroke(tint, lineWidth: 1.2).frame(width: 4, height: 11)
                Text("All")
                    .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(isSelected ? HudPalette.ink : HudPalette.ink.opacity(0.82))
                    .lineLimit(1)
                MachineBracket(.trailing).stroke(tint, lineWidth: 1.2).frame(width: 4, height: 11)
            }
            .padding(.horizontal, HudSpacing.sm)
            .padding(.vertical, HudSpacing.xs)
            .background(Capsule().fill(HudSurface.inset))
            .overlay(Capsule().stroke(isSelected ? HudSurface.tintBorder(HudPalette.accent) : HudHairline.standard, lineWidth: HudStrokeWidth.thin))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("All machines\(isSelected ? ", selected" : "")")
    }
}

/// One side of the `[ All ]` bracket — a square-cornered `[` or `]` tick.
private struct MachineBracket: Shape {
    enum Side { case leading, trailing }
    let side: Side
    init(_ side: Side) { self.side = side }

    func path(in r: CGRect) -> Path {
        var p = Path()
        switch side {
        case .leading:
            p.move(to: CGPoint(x: r.maxX, y: r.minY))
            p.addLine(to: CGPoint(x: r.minX, y: r.minY))
            p.addLine(to: CGPoint(x: r.minX, y: r.maxY))
            p.addLine(to: CGPoint(x: r.maxX, y: r.maxY))
        case .trailing:
            p.move(to: CGPoint(x: r.minX, y: r.minY))
            p.addLine(to: CGPoint(x: r.maxX, y: r.minY))
            p.addLine(to: CGPoint(x: r.maxX, y: r.maxY))
            p.addLine(to: CGPoint(x: r.minX, y: r.maxY))
        }
        return p
    }
}

// MARK: - InlineRuntimePill

private struct InlineRuntimePill: View {
    let text: String

    var body: some View {
        Text(text)
            .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
            .foregroundStyle(HudPalette.dim)
            .lineLimit(1)
            .padding(.horizontal, 5)
            .padding(.vertical, 1.5)
            .background(Capsule().fill(HudSurface.inset))
            .overlay(Capsule().stroke(HudHairline.subtle, lineWidth: HudStrokeWidth.thin))
            .layoutPriority(0)
    }
}

// MARK: - InlineRuntimeToken

private struct InlineRuntimeToken: View {
    let text: String

    var body: some View {
        Text(text)
            .font(HudFont.mono(HudTextSize.micro))
            .foregroundStyle(HudPalette.dim)
            .lineLimit(1)
            .fixedSize(horizontal: true, vertical: false)
            .layoutPriority(2)
    }
}

// MARK: - ProjectRow

/// A collapsed multi-agent project: name, a live dot when any agent is running,
/// the agent count, and the project's most-recent activity. Tapping expands to
/// the agents beneath it.
private struct ProjectRow: View {
    let group: ProjectGroup
    let isExpanded: Bool
    var soloAgent: AgentSummary?
    var showsDisclosure: Bool = true
    let onToggle: () -> Void
    @Environment(\.scoutLayout) private var layout

    var body: some View {
        Button(action: onToggle) {
            // One uniform single-line shape for every project — `[folder] name /
            // <agent-or-count>`, the most-recent age, then a disclosure. No
            // second line: multi-agent projects fold their count inline after the
            // slash rather than stacking it underneath.
            HStack(alignment: .center, spacing: HudSpacing.md) {
                Glyphic(kind: .folder, size: 15)
                    .foregroundStyle(HudPalette.muted)
                    .frame(width: 16)
                identityLine
                Spacer(minLength: HudSpacing.md)
                if let age = lastActiveAge {
                    ageText(age)
                }
                if showsDisclosure {
                    // Multi-agent rows expand in place (rotating chevron); solo
                    // rows drill straight into the agent card (a "go" arrow).
                    if soloAgent != nil {
                        Glyphic.arrow(.trailing, size: 13)
                            .foregroundStyle(HudPalette.dim)
                            .frame(width: 13)
                    } else {
                        Glyphic.chevron(isExpanded ? .bottom : .trailing, size: 13)
                            .foregroundStyle(HudPalette.dim)
                            .frame(width: 13)
                    }
                }
            }
            .padding(.horizontal, HudSpacing.xl)
            .padding(.vertical, HudSpacing.md)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var projectName: some View {
        Text(boundedProjectName(group.name))
            .font(HudFont.ui(HudTextSize.md, weight: .medium))
            .foregroundStyle(HudPalette.ink)
            .lineLimit(1)
            .truncationMode(.middle)
            .layoutPriority(1)
    }

    /// Bounds an over-long project name (e.g. a raw UUID used as the fallback
    /// folder name) to a fixed character ceiling, middle-eliding so the head
    /// stays recognizable and the last few characters survive after the
    /// ellipsis — distinct IDs stay distinguishable and the row keeps its
    /// age/disclosure on-screen on one line.
    private func boundedProjectName(_ name: String) -> String {
        let ceiling = 22
        let tail = 4
        guard name.count > ceiling else { return name }
        let head = ceiling - tail - 1 // reserve one slot for the ellipsis
        return "\(name.prefix(head))…\(name.suffix(tail))"
    }

    private var identityLine: some View {
        HStack(alignment: .center, spacing: HudSpacing.sm) {
            projectName
            Text("/")
                .font(HudFont.mono(HudTextSize.xs))
                .foregroundStyle(HudPalette.dim)
            if let agent = soloAgent {
                compressedAgentSegment(agent)
            } else {
                countSegment
            }
            if group.liveCount > 0 { liveDot }
        }
    }

    /// Multi-agent projects keep the same `name / …` shape as solo ones — the
    /// slash just leads to a count (`[agents] N agents`) instead of one agent.
    private var countSegment: some View {
        HStack(alignment: .center, spacing: HudSpacing.xxs) {
            Glyphic(kind: .agents, size: layout.isMiniPhone ? 12 : 13)
                .foregroundStyle(HudPalette.dim)
            Text("\(group.agents.count) agents")
                .font(HudFont.ui(HudTextSize.sm, weight: .regular))
                .foregroundStyle(HudPalette.muted)
                .lineLimit(1)
        }
        .layoutPriority(0)
    }

    private func compressedAgentSegment(_ agent: AgentSummary) -> some View {
        HStack(alignment: .center, spacing: HudSpacing.xxs) {
            Glyphic(kind: .agent, size: layout.isMiniPhone ? 11 : 12)
                .foregroundStyle(HudPalette.dim)
            let title = compressedAgentTitle(agent)
            Text(title)
                .font(HudFont.ui(HudTextSize.sm, weight: .regular))
                .foregroundStyle(HudPalette.muted)
                .lineLimit(1)
                .truncationMode(.middle)
            if let runtime = runtimeLabel(agent), runtime != title {
                InlineRuntimePill(text: runtime)
            }
        }
        .layoutPriority(0)
    }

    private var liveDot: some View {
        HudStatusDot(color: HudPalette.accent, size: 6, pulses: true)
    }

    private func compressedAgentTitle(_ agent: AgentSummary) -> String {
        homeAgentDisplayTitle(agent, projectName: group.name)
    }

    private func runtimeLabel(_ agent: AgentSummary) -> String? {
        homeAgentRuntimeLabel(agent)
    }

    private var lastActiveAge: String? {
        relativeAgeString(group.lastActiveAt)
    }

    private func ageText(_ age: String, size: CGFloat = HudTextSize.xs) -> some View {
        Text(age)
            .font(HudFont.mono(size))
            .foregroundStyle(HudPalette.muted)
            .monospacedDigit()
    }
}

// MARK: - AgentFleetRow

/// A compact read of one agent: name, inline harness/model token, and right-edge
/// recency/state. Home keeps this to one line so child rows never visually outrank
/// their project parent.
private struct AgentFleetRow: View {
    let agent: AgentSummary
    var projectName: String?
    /// When this row appears in the Projects list, it gets an agent marker. If
    /// `treeBranch` is present, the marker also draws the child connector.
    var leadingLeaf: Bool = false
    /// Non-nil when the row is an agent leaf nested under a project row.
    var treeBranch: AgentTreeBranch?
    let onTap: (() -> Void)?

    var body: some View {
        Button(action: { onTap?() }) {
            HStack(alignment: .center, spacing: HudSpacing.md) {
                if leadingLeaf { leafRail }
                identityLine
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, HudSpacing.xl)
            .padding(.vertical, HudSpacing.sm)
            .contentShape(Rectangle())
            .opacity(onTap == nil ? HudOpacity.muted : 1)
        }
        .buttonStyle(.plain)
        .disabled(onTap == nil)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilityLabel)
    }

    /// A leaf marker: optional tree branch (`|-`) plus the agent glyph. It makes
    /// nested rows read as children of the repo/folder row instead of peer rows.
    private var leafRail: some View {
        HStack(spacing: 2) {
            if let treeBranch {
                AgentTreeConnector(isLast: treeBranch.isLast)
                    .stroke(HudPalette.dim.opacity(0.55), style: StrokeStyle(lineWidth: 1, lineCap: .round))
                    .frame(width: 10)
                    .frame(maxHeight: .infinity)
            } else {
                Spacer().frame(width: 10)
            }
            Glyphic(kind: .agent, size: 13)
                .foregroundStyle(agent.state == .live ? HudPalette.accent : HudPalette.dim)
        }
        .frame(width: 25, alignment: .leading)
    }

    // Line 1 — name, inline locator, right-edge signal.
    private var identityLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
            Text(displayTitle)
                .font(HudFont.ui(HudTextSize.sm, weight: .regular))
                .foregroundStyle(titleColor)
                .lineLimit(1)
                .truncationMode(leadingLeaf ? .middle : .tail)
                .layoutPriority(1)
            // Live agents get the "at the keyboard" caret, echoing the working card.
            if agent.state == .live { BlinkingCursor() }
            if let runtime = runtimeLabel {
                Text("·")
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(HudPalette.dim)
                InlineRuntimeToken(text: runtime)
            }
            Spacer(minLength: HudSpacing.md)
            if let age = relativeAgeString(agent.lastActiveAt) {
                Text(age)
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(agent.state == .live ? HudPalette.accent : HudPalette.muted)
                    .monospacedDigit()
                    .frame(minWidth: 22, alignment: .trailing)
                    .layoutPriority(2)
            } else if showsStateBadge {
                HudBadge(stateLabel, tint: stateColor, dot: true)
            }
        }
    }

    /// Live agents read at full ink (active right now); nested idle agents stay a
    /// tone down so children never visually outrank their project parent.
    private var titleColor: Color {
        if agent.state == .live { return HudPalette.ink }
        return leadingLeaf ? HudPalette.muted : HudPalette.ink
    }

    /// Only `live`/`offline` earn a badge; idle/unknown read via the relative age.
    private var showsStateBadge: Bool {
        agent.state == .live || agent.state == .offline
    }

    private var displayTitle: String {
        homeAgentDisplayTitle(agent, projectName: projectName)
    }

    private var runtimeLabel: String? {
        let runtime = homeAgentRuntimeLabel(agent)
        return runtime == displayTitle ? nil : runtime
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

private struct AgentTreeBranch {
    let isLast: Bool
}

/// Short tree branch for Home's project preview. The full Agents tab owns the
/// larger directory tree; Home only needs enough structure to clarify nesting.
private struct AgentTreeConnector: Shape {
    let isLast: Bool

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let x = rect.minX + 1
        let midY = rect.midY
        path.move(to: CGPoint(x: x, y: rect.minY))
        path.addLine(to: CGPoint(x: x, y: isLast ? midY : rect.maxY))
        path.move(to: CGPoint(x: x, y: midY))
        path.addLine(to: CGPoint(x: rect.maxX, y: midY))
        return path
    }
}

// MARK: - Shared agent row text

private func homeAgentDisplayTitle(_ agent: AgentSummary, projectName: String?) -> String {
    guard homeAgentTitleRestatesProject(agent, projectName: projectName) else {
        return agent.title
    }
    if let runtime = homeAgentRuntimeLabel(agent) { return runtime }
    if let sessionId = homeShortIdentifier(agent.sessionId) { return sessionId }
    if let branch = agent.branch, !branch.isEmpty { return branch }
    return "agent"
}

private func homeAgentRuntimeLabel(_ agent: AgentSummary) -> String? {
    if let harness = agent.harness, !harness.isEmpty {
        return harness.lowercased()
    }
    if let model = agent.model, !model.isEmpty {
        return model
    }
    return nil
}

private func homeAgentTitleRestatesProject(_ agent: AgentSummary, projectName: String?) -> Bool {
    guard let projectName, !projectName.isEmpty else { return false }
    return homeIdentityKey(agent.title) == homeIdentityKey(projectName)
}

private func homeIdentityKey(_ value: String) -> String {
    value.lowercased().filter { $0.isLetter || $0.isNumber }
}

private func homeShortIdentifier(_ value: String?) -> String? {
    guard let value, !value.isEmpty else { return nil }
    let parts = value.split { char in
        char == "." || char == "/" || char == ":" || char == "#" || char == "-" || char == "_"
    }
    return parts.last.map(String.init) ?? value
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
