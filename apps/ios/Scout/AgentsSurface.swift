import SwiftUI
import HudsonUI
import ScoutCapabilities

/// Agents — the bridge's full directory as a **project navigator**. Each row is
/// the agent's coordinate (project / name / session). Two orderings: a **project
/// tree** (agents nest under their project; a solo project collapses to one
/// inline row) or **most-recent** (a flat list by last activity). State is a
/// quiet per-row dot — only *live* lights up; no repeated badges, no harness
/// color-coding (harness is a muted token). Tapping an agent with a live session
/// opens it; tapping a project — or a dormant agent — opens project info with a
/// launcher to start a fresh session on the harness/model of your choice.
///
/// Multi-Mac: under the fleet-wide `[All]` filter the roster **stacks by
/// machine** — each online Mac is a pinned section over its own tree, offline
/// Macs trail as quiet gray rows. Filtered to one Mac (or with a single paired
/// Mac), it renders the bare list with no machine chrome. Taps route back
/// through the machine they came from, so opening an agent on one Mac never
/// crosses wires with another.
struct AgentsSurface: View {
    let model: AppModel
    /// Publishes the pushed conversation's runtime/project/model context into
    /// the global protected-area status bar.
    var onConversationStatusContext: (String?) -> Void = { _ in }

    @State private var sections: [MachineAgents] = []
    @State private var isLoading = true
    @State private var searchText = ""
    @State private var sort: SortMode = Self.initialSort
    @State private var route: ConversationRoute?
    /// The client a pushed conversation routes through — the machine the tapped
    /// agent lives on, not necessarily the bound one.
    @State private var routeClient: (any ScoutBrokerClient)?
    @State private var projectSheet: ProjectNode?
    @State private var sheetClient: (any ScoutBrokerClient)?
    @State private var didDebugOpen = false

    enum SortMode: String, CaseIterable, Identifiable {
        case project, recent
        var id: String { rawValue }
        var label: String { self == .project ? "PROJECT" : "RECENT" }
    }

    /// One machine's slice of the directory: its agents plus the live client to
    /// read/route through. Offline Macs arrive with `client == nil` so the stack
    /// can show them collapsed instead of dropping them.
    private struct MachineAgents: Identifiable {
        let id: String
        let name: String
        let isOnline: Bool
        let lastSeen: Date?
        let connectionState: AppModel.ConnectionState
        let client: (any ScoutBrokerClient)?
        let agents: [AgentSummary]
    }

    private struct ConversationRoute: Hashable, Identifiable {
        let id: String
        let title: String
    }

    /// Default ordering; in DEBUG a `SCOUT_AGENT_SORT=recent` env jumps the
    /// simulator straight to a mode so it can be verified without touch input.
    private static var initialSort: SortMode {
        #if DEBUG
        if let raw = ProcessInfo.processInfo.environment["SCOUT_AGENT_SORT"],
           let m = SortMode(rawValue: raw) { return m }
        #endif
        return .project
    }

    /// Reload trigger: the focused Mac becoming ready (`dataReadyToken`), ANY Mac's
    /// connection changing (`fleetRevision` — so an aggregated "All" picks up a Mac
    /// that connects in the background), or the filter itself moving.
    private var reloadKey: String {
        let filter: String
        switch model.machineFilter {
        case .all: filter = "all"
        case .machine(let id): filter = id
        }
        return "\(model.dataReadyToken).\(model.fleetRevision).\(filter)"
    }

    var body: some View {
        ScrollView {
            // Pinned section headers carry the per-machine stack; in single-Mac
            // mode there are no sections, so nothing pins and the list reads exactly
            // as it always has.
            LazyVStack(alignment: .leading, spacing: 0, pinnedViews: [.sectionHeaders]) {
                HudField("Search agents", text: $searchText, icon: "magnifyingglass")
                    .padding(.horizontal, HudSpacing.xxl)
                    .padding(.top, HudSpacing.lg)
                    .padding(.bottom, HudSpacing.md)

                if isLoading {
                    HudEmptyState(title: "Loading agents", icon: "person.2")
                        .frame(maxWidth: .infinity).padding(.top, HudSpacing.huge)
                } else {
                    if !allAgents.isEmpty { summaryBar }
                    content
                }
            }
        }
        .refreshable { await load() }
        .task(id: reloadKey) { await load(); openDebugProjectIfRequested() }
        .navigationDestination(item: $route) { route in
            ConversationSurface(
                client: routeClient ?? model.client,
                conversationId: route.id,
                title: route.title,
                onClose: { self.route = nil },
                onStatusContextChange: onConversationStatusContext
            )
        }
        .sheet(item: $projectSheet) { node in
            ProjectDetailSheet(
                node: node,
                client: sheetClient ?? model.client,
                onOpenSession: { agent in projectSheet = nil; openSession(agent, client: sheetClient) },
                onStarted: { conversationId, title in
                    projectSheet = nil
                    routeClient = sheetClient
                    route = ConversationRoute(id: conversationId, title: title)
                }
            )
        }
    }

    // MARK: - Summary + sort

    /// One chrome row: the count on the left, the sort toggle on the right —
    /// integrated, not stacked into its own strip. Counts span every visible Mac.
    private var summaryBar: some View {
        let visible = allVisibleAgents
        let live = visible.filter { $0.state == .live }.count
        let text = live > 0
            ? "\(visible.count) agents · \(live) live"
            : "\(visible.count) agents · \(projects(from: visible).count) projects"
        return HStack(alignment: .firstTextBaseline) {
            HudSectionLabel(text.uppercased())
            Spacer(minLength: HudSpacing.md)
            SortToggle(sort: $sort)
        }
        .padding(.horizontal, HudSpacing.xxl)
        .padding(.bottom, HudSpacing.sm)
    }

    @ViewBuilder
    private var content: some View {
        if allVisibleAgents.isEmpty && !allAgents.isEmpty {
            HudEmptyState(title: "No matches", subtitle: "Nothing matches “\(searchText)”.", icon: "magnifyingglass")
                .frame(maxWidth: .infinity).padding(.top, HudSpacing.huge)
        } else if sections.count > 1 {
            stackedContent
        } else if let only = sections.first, only.isOnline, !only.agents.isEmpty {
            machineBody(only)
        } else {
            HudEmptyState(title: "No agents", subtitle: "Connect to your Mac to see the directory.", icon: "person.2.slash")
                .frame(maxWidth: .infinity).padding(.top, HudSpacing.huge)
        }
    }

    /// Multi-Mac: each online machine is a pinned section over its project tree;
    /// offline Macs trail as quiet gray rows (we still surface every Mac we know
    /// about, just out of the way). A search collapses to matching Macs only.
    @ViewBuilder
    private var stackedContent: some View {
        ForEach(onlineSections) { section in
            Section {
                machineBody(section)
            } header: {
                MachineSectionHeader(
                    name: section.name,
                    agentCount: filtered(section.agents).count,
                    liveCount: filtered(section.agents).filter { $0.state == .live }.count
                )
            }
        }
        ForEach(offlineSections) { section in
            OfflineMachineRow(name: section.name, state: section.connectionState, lastSeen: section.lastSeen)
        }
    }

    /// One machine's agents, rendered as the project tree or the recent list —
    /// the same body Agents has always shown, now reusable per-Mac.
    @ViewBuilder
    private func machineBody(_ section: MachineAgents) -> some View {
        let agents = filtered(section.agents)
        if sort == .project {
            ForEach(projects(from: agents)) { project in
                ProjectSection(
                    project: project,
                    onOpenProject: { node in sheetClient = section.client; projectSheet = node },
                    onTapAgent: { agent in tapAgent(agent, in: section) }
                )
            }
        } else {
            // Most-recent: a flat list, newest first. The name + harness + age is
            // the identity here; we don't repeat the project (that's PROJECT mode's
            // job) — the second line only appears when the agent is on a branch.
            let ordered = recents(from: agents)
            ForEach(Array(ordered.enumerated()), id: \.element.id) { idx, agent in
                AgentRow(agent: agent, connector: nil, showProject: false) {
                    tapAgent(agent, in: section)
                }
                if idx < ordered.count - 1 { rowDivider }
            }
        }
    }

    private var rowDivider: some View {
        Rectangle().fill(HudHairline.subtle).frame(height: 0.5)
            .padding(.leading, HudSpacing.xxl)
    }

    // MARK: - Section partitioning

    private var isSearching: Bool {
        !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Online Macs lead the stack. Under a search, only Macs with a match show.
    private var onlineSections: [MachineAgents] {
        sections.filter(\.isOnline).filter { !isSearching || !filtered($0.agents).isEmpty }
    }

    /// Offline Macs trail as gray rows — hidden while searching (they hold nothing
    /// to match against).
    private var offlineSections: [MachineAgents] {
        isSearching ? [] : sections.filter { !$0.isOnline }
    }

    // MARK: - Routing

    /// Live session → open it on the machine it lives on. No session → there's
    /// nothing to resume, so land on the project (info + a launcher).
    private func tapAgent(_ agent: AgentSummary, in section: MachineAgents) {
        if agent.sessionId != nil, agent.conversationId?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
            openSession(agent, client: section.client)
        } else {
            sheetClient = section.client
            projectSheet = projectNode(for: agent, in: section.agents)
        }
    }

    private func openSession(_ agent: AgentSummary, client: (any ScoutBrokerClient)?) {
        // Route by the agent's real broker chat, not `sessionId` (a harness
        // label shared across agents). If no chat exists yet, the caller keeps
        // the user on the project/agent sheet.
        guard let conversationId = agent.conversationId?.trimmingCharacters(in: .whitespacesAndNewlines),
              !conversationId.isEmpty else { return }
        routeClient = client
        route = ConversationRoute(id: conversationId, title: agent.title)
    }

    // MARK: - Grouping / ordering (pure over an agent list, reused per machine)

    private var allAgents: [AgentSummary] { sections.flatMap(\.agents) }
    private var allVisibleAgents: [AgentSummary] { sections.flatMap { filtered($0.agents) } }

    private func filtered(_ agents: [AgentSummary]) -> [AgentSummary] {
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return agents }
        return agents.filter { a in
            [a.title, a.projectName, a.harness, a.statusLabel, a.branch]
                .compactMap { $0?.lowercased() }.contains { $0.contains(q) }
        }
    }

    private func projects(from agents: [AgentSummary]) -> [ProjectNode] {
        Dictionary(grouping: agents) { projectKey($0) }
            .map { key, value in ProjectNode(id: key, name: key, agents: value.sorted(by: Self.agentOrder)) }
            .sorted(by: Self.projectOrder)
    }

    private func recents(from agents: [AgentSummary]) -> [AgentSummary] {
        agents.sorted { lhs, rhs in
            if (lhs.state == .live) != (rhs.state == .live) { return lhs.state == .live }
            let l = lhs.lastActiveAt ?? .distantPast
            let r = rhs.lastActiveAt ?? .distantPast
            if l != r { return l > r }
            return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
        }
    }

    private func projectKey(_ a: AgentSummary) -> String {
        displayProjectName(a.projectName) ?? a.title
    }

    private func projectNode(for agent: AgentSummary, in agents: [AgentSummary]) -> ProjectNode {
        let key = projectKey(agent)
        let members = agents.filter { projectKey($0) == key }.sorted(by: Self.agentOrder)
        return ProjectNode(id: key, name: key, agents: members)
    }

    private static func agentOrder(_ a: AgentSummary, _ b: AgentSummary) -> Bool {
        if (a.state == .live) != (b.state == .live) { return a.state == .live }
        let l = a.lastActiveAt ?? .distantPast
        let r = b.lastActiveAt ?? .distantPast
        if l != r { return l > r }
        return a.title.localizedCaseInsensitiveCompare(b.title) == .orderedAscending
    }

    private static func projectOrder(_ a: ProjectNode, _ b: ProjectNode) -> Bool {
        if a.hasLive != b.hasLive { return a.hasLive }
        return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
    }

    // MARK: - Load

    /// Fetch each visible machine's directory. Online Macs are queried through
    /// their own keyed client (so taps route back to the right Mac); offline Macs
    /// come through agent-less for a collapsed row. Queried in series — the fleet
    /// is small, and series keeps the `any ScoutBrokerClient` reads on-actor.
    private func load() async {
        isLoading = true
        var result: [MachineAgents] = []
        for machine in model.agentMachines() {
            let agents: [AgentSummary]
            if let client = machine.client {
                agents = (try? await client.listAgents(query: nil, limit: 100)) ?? []
            } else {
                agents = []
            }
            result.append(
                MachineAgents(
                    id: machine.id,
                    name: machine.name,
                    isOnline: machine.isOnline,
                    lastSeen: machine.lastSeen,
                    connectionState: machine.connectionState,
                    client: machine.client,
                    agents: agents
                )
            )
        }
        sections = result
        isLoading = false
    }

    /// DEBUG-only: `SCOUT_OPEN_PROJECT=<name>` auto-presents that project's
    /// detail sheet on the simulator so the launcher can be seen without touch.
    private func openDebugProjectIfRequested() {
        #if DEBUG
        guard !didDebugOpen,
              let want = ProcessInfo.processInfo.environment["SCOUT_OPEN_PROJECT"]?.lowercased(),
              !want.isEmpty else { return }
        // Only latch once we've actually matched — the first (pre-connect) load
        // has no agents yet, so keep trying until data arrives.
        let nodes = projects(from: allVisibleAgents)
        if let node = nodes.first(where: { $0.name.lowercased() == want })
            ?? nodes.first(where: { $0.name.lowercased().contains(want) }) {
            didDebugOpen = true
            sheetClient = sections.first(where: { $0.isOnline })?.client
            projectSheet = node
        }
        #endif
    }
}

// MARK: - Model

struct ProjectNode: Identifiable, Hashable {
    let id: String
    let name: String
    let agents: [AgentSummary]
    var hasLive: Bool { agents.contains { $0.state == .live } }
    var liveCount: Int { agents.filter { $0.state == .live }.count }
    /// Best-effort local checkout path for the project (the workspace lives under
    /// ~/dev). Editable in the launcher before starting a session.
    var guessedPath: String { "/Users/arach/dev/\(name)" }

    static func == (lhs: ProjectNode, rhs: ProjectNode) -> Bool { lhs.id == rhs.id && lhs.agents == rhs.agents }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

// MARK: - Sort toggle

private struct SortToggle: View {
    @Binding var sort: AgentsSurface.SortMode

    var body: some View {
        HStack(spacing: 2) {
            ForEach(AgentsSurface.SortMode.allCases) { mode in
                Button { sort = mode } label: {
                    Text(mode.label)
                        .font(HudFont.mono(HudTextSize.micro, weight: sort == mode ? .bold : .regular))
                        .tracking(0.6)
                        .foregroundStyle(sort == mode ? HudPalette.accent : ScoutInk.muted)
                        .padding(.horizontal, HudSpacing.sm)
                        .padding(.vertical, 3)
                        .background(
                            Capsule().fill(sort == mode ? HudPalette.accent.opacity(0.12) : .clear)
                        )
                }
                .buttonStyle(.plain)
            }
        }
    }
}

// MARK: - Machine section chrome (multi-Mac stack)

/// A pinned per-machine header in the `[All]` stack. Tells you which Mac the rows
/// beneath belong to as it sticks past — the iPhone-friendly "which machine am I
/// looking at" playback. Opaque so scrolling rows don't bleed through when pinned.
private struct MachineSectionHeader: View {
    let name: String
    let agentCount: Int
    let liveCount: Int

    var body: some View {
        HStack(spacing: HudSpacing.sm) {
            HudStatusDot(color: HudPalette.accent, size: 6, pulses: liveCount > 0)
            Text(name)
                .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                .foregroundStyle(HudPalette.ink)
                .lineLimit(1).truncationMode(.tail)
            Spacer(minLength: HudSpacing.sm)
            if liveCount > 0 {
                Text("\(liveCount) live")
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(HudPalette.accent)
            }
            Text("\(agentCount)")
                .font(HudFont.mono(HudTextSize.xs)).monospacedDigit()
                .foregroundStyle(HudPalette.muted)
        }
        .padding(.horizontal, HudSpacing.xxl)
        .padding(.vertical, HudSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(HudPalette.bg)
        .overlay(alignment: .bottom) {
            Rectangle().fill(HudHairline.standard).frame(height: HudStrokeWidth.thin)
        }
    }
}

/// An offline (or still-connecting) Mac in the stack: a quiet gray row that
/// acknowledges the machine without pretending it has a live directory.
private struct OfflineMachineRow: View {
    let name: String
    let state: AppModel.ConnectionState
    let lastSeen: Date?

    var body: some View {
        HStack(spacing: HudSpacing.sm) {
            HudStatusDot(color: HudPalette.dim, size: 6, pulses: false)
            Text(name)
                .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                .foregroundStyle(HudPalette.muted)
                .lineLimit(1).truncationMode(.tail)
            Spacer(minLength: HudSpacing.sm)
            Text(detail)
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(HudPalette.dim)
        }
        .padding(.horizontal, HudSpacing.xxl)
        .padding(.vertical, HudSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var detail: String {
        if case .connecting = state { return "connecting…" }
        if let lastSeen, let age = machineRelativeAge(lastSeen) { return "offline · \(age)" }
        return "offline"
    }
}

// MARK: - Project section (tree)

private struct ProjectSection: View {
    let project: ProjectNode
    let onOpenProject: (ProjectNode) -> Void
    let onTapAgent: (AgentSummary) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if project.agents.count == 1 {
                AgentRow(agent: project.agents[0], connector: nil, showProject: false) {
                    onTapAgent(project.agents[0])
                }
            } else {
                ProjectHeaderRow(project: project) { onOpenProject(project) }
                ForEach(Array(project.agents.enumerated()), id: \.element.id) { idx, agent in
                    AgentRow(
                        agent: agent,
                        connector: AgentRow.Connector(isLast: idx == project.agents.count - 1),
                        showProject: false
                    ) { onTapAgent(agent) }
                }
            }
            Rectangle().fill(HudHairline.subtle).frame(height: 0.5)
                .padding(.leading, HudSpacing.xxl)
        }
    }
}

// MARK: - Rows

private struct ProjectHeaderRow: View {
    let project: ProjectNode
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: HudSpacing.md) {
                ProjectGlyph()
                    .foregroundStyle(ScoutInk.muted)
                    .frame(width: 13, height: 13)
                Text(project.name)
                    .font(HudFont.ui(HudTextSize.md, weight: .semibold))
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(1).truncationMode(.middle)
                Spacer(minLength: HudSpacing.sm)
                if project.liveCount > 0 {
                    HudStatusDot(color: HudPalette.accent, size: 5, pulses: true)
                }
                Text("\(project.agents.count)")
                    .font(HudFont.mono(HudTextSize.xs)).monospacedDigit()
                    .foregroundStyle(ScoutInk.muted)
                Glyphic.chevron(.trailing, size: 13)
                    .foregroundStyle(ScoutInk.dim)
            }
            .padding(.horizontal, HudSpacing.xxl)
            .padding(.top, HudSpacing.lg)
            .padding(.bottom, HudSpacing.xs)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct AgentRow: View {
    let agent: AgentSummary
    /// Non-nil ⇒ a leaf under a multi-agent project (tree rail + indent).
    let connector: Connector?
    /// When set, prepends the project to the session line — only useful where no
    /// header carries it. Recent mode leaves this off (name + age is enough).
    var showProject: Bool = false
    let onTap: () -> Void

    struct Connector { let isLast: Bool }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: HudSpacing.md) {
                if let connector {
                    TreeConnector(isLast: connector.isLast)
                        .stroke(HudHairline.standard, style: StrokeStyle(lineWidth: 1, lineCap: .round))
                        .frame(width: HudSpacing.xl)
                        .frame(maxHeight: .infinity)
                }
                AgentStateDot(state: agent.state).frame(width: 8)
                VStack(alignment: .leading, spacing: 1) {
                    Text(agent.title)
                        .font(HudFont.ui(HudTextSize.base, weight: connector == nil ? .medium : .regular))
                        .foregroundStyle(HudPalette.ink)
                        .lineLimit(1).truncationMode(.tail)
                    if let session = sessionLine {
                        Text(session)
                            .font(HudFont.mono(HudTextSize.micro))
                            .foregroundStyle(ScoutInk.muted)
                            .lineLimit(1).truncationMode(.middle)
                    }
                }
                Spacer(minLength: HudSpacing.sm)
                if let age = machineRelativeAge(agent.lastActiveAt) {
                    Text(age)
                        .font(HudFont.mono(HudTextSize.micro)).monospacedDigit()
                        .foregroundStyle(ScoutInk.dim)
                }
                if let harness = agent.harness, !harness.isEmpty {
                    Text(harness.lowercased())
                        .font(HudFont.mono(HudTextSize.xs))
                        .foregroundStyle(ScoutInk.muted)
                }
            }
            .padding(.leading, connector == nil ? HudSpacing.xxl : HudSpacing.lg)
            .padding(.trailing, HudSpacing.xxl)
            .padding(.vertical, HudSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// The session coordinate beneath the name: the working branch when the agent
    /// is on one (recency is already shown as the age on the right — no point
    /// repeating the idle "Available" status). With `showProject`, the project is
    /// prefixed for rows that have no header to carry it.
    private var sessionLine: String? {
        let branch = agent.branch.flatMap { $0.isEmpty ? nil : $0 }
        let parts = [showProject ? displayProjectName(agent.projectName) : nil, branch].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

// MARK: - State dot

private struct AgentStateDot: View {
    let state: AgentSummary.State

    var body: some View {
        switch state {
        case .live:
            HudStatusDot(color: HudPalette.accent, size: 6, pulses: true)
        case .idle:
            Circle().fill(ScoutInk.muted).frame(width: 5, height: 5)
        case .offline, .unknown:
            Circle().stroke(ScoutInk.dim, lineWidth: 1).frame(width: 5, height: 5)
        }
    }
}

// MARK: - Project detail + session launcher

/// Tapping a project (or a dormant agent) lands here: what's in the project, and
/// a launcher to start a fresh session on the harness/model of your choice.
private struct ProjectDetailSheet: View {
    let node: ProjectNode
    let client: any ScoutBrokerClient
    let onOpenSession: (AgentSummary) -> Void
    let onStarted: (_ conversationId: String, _ title: String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var harness: String = "claude"
    @State private var model: String = ""
    @State private var path: String
    @State private var instructions: String = ""
    @State private var isStarting = false
    @State private var errorText: String?

    private static let harnesses = ["claude", "codex"]

    init(node: ProjectNode, client: any ScoutBrokerClient,
         onOpenSession: @escaping (AgentSummary) -> Void,
         onStarted: @escaping (String, String) -> Void) {
        self.node = node
        self.client = client
        self.onOpenSession = onOpenSession
        self.onStarted = onStarted
        _path = State(initialValue: node.guessedPath)
        // Default the harness to whatever the project already runs most.
        let common = Dictionary(grouping: node.agents.compactMap { $0.harness?.lowercased() }, by: { $0 })
            .max { $0.value.count < $1.value.count }?.key
        _harness = State(initialValue: common ?? "claude")
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: HudSpacing.xxl) {
                    agentsSection
                    launcherSection
                    if let errorText {
                        Text(errorText)
                            .font(HudFont.mono(HudTextSize.xs))
                            .foregroundStyle(HudPalette.statusError)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(HudSpacing.xxl)
            }
            .background(HudPalette.bg)
            .navigationTitle(node.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.foregroundStyle(ScoutInk.muted)
                }
            }
        }
    }

    private var agentsSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            HudSectionLabel("\(node.agents.count) AGENTS")
            ForEach(node.agents) { agent in
                Button { onOpenSession(agent) } label: {
                    HStack(spacing: HudSpacing.md) {
                        AgentStateDot(state: agent.state).frame(width: 8)
                        Text(agent.title)
                            .font(HudFont.ui(HudTextSize.base, weight: .medium))
                            .foregroundStyle(HudPalette.ink)
                        Spacer(minLength: HudSpacing.sm)
                        if let h = agent.harness { Text(h.lowercased()).font(HudFont.mono(HudTextSize.xs)).foregroundStyle(ScoutInk.muted) }
                        if agent.sessionId != nil {
                            Glyphic.chevron(.trailing, size: 13).foregroundStyle(ScoutInk.dim)
                        }
                    }
                    .padding(.vertical, HudSpacing.sm)
                    .contentShape(Rectangle())
                    .opacity(agent.sessionId != nil ? 1 : HudOpacity.muted)
                }
                .buttonStyle(.plain)
                .disabled(agent.sessionId == nil)
            }
        }
    }

    private var launcherSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.lg) {
            HudSectionLabel("START A SESSION")

            // Harness
            HStack(spacing: HudSpacing.sm) {
                ForEach(Self.harnesses, id: \.self) { h in
                    Button { harness = h } label: {
                        Text(h)
                            .font(HudFont.mono(HudTextSize.sm, weight: harness == h ? .bold : .regular))
                            .foregroundStyle(harness == h ? HudPalette.bg : ScoutInk.muted)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, HudSpacing.md)
                            .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                                .fill(harness == h ? HudPalette.accent : ScoutSurface.inset))
                    }
                    .buttonStyle(.plain)
                }
            }

            HudField("Model (optional)", text: $model, icon: "cpu")
            HudField("Project path", text: $path, icon: "folder")

            TextEditor(text: $instructions)
                .font(HudFont.ui(HudTextSize.base))
                .foregroundStyle(HudPalette.ink)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 88)
                .padding(HudSpacing.md)
                .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(ScoutSurface.inset))
                .overlay(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).stroke(HudHairline.standard, lineWidth: HudStrokeWidth.standard))
                .overlay(alignment: .topLeading) {
                    if instructions.isEmpty {
                        Text("First instruction (optional)…")
                            .font(HudFont.ui(HudTextSize.base))
                            .foregroundStyle(ScoutInk.dim)
                            .padding(.horizontal, HudSpacing.md + 4)
                            .padding(.vertical, HudSpacing.md + 8)
                            .allowsHitTesting(false)
                    }
                }

            HStack {
                if isStarting { ProgressView().controlSize(.small) }
                Spacer()
                HudButton("Start \(harness)", icon: "paperplane.fill", style: .primary(.green)) { start() }
                    .disabled(isStarting || path.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
    }

    private func start() {
        let trimmedPath = path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedPath.isEmpty, !isStarting else { return }
        isStarting = true
        errorText = nil
        let trimmedModel = model.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedInstr = instructions.trimmingCharacters(in: .whitespacesAndNewlines)
        let spec = SessionInitiationSpec(
            target: .init(projectPath: trimmedPath),
            execution: .init(
                harness: harness,
                model: trimmedModel.isEmpty ? nil : trimmedModel,
                session: .new
            ),
            agent: .init(persistence: "sticky"),
            seed: .init(instructions: trimmedInstr.isEmpty ? nil : trimmedInstr)
        )
        Task {
            do {
                let outcome = try await client.startSession(spec)
                isStarting = false
                if let conversationId = outcome.conversationId {
                    onStarted(conversationId, node.name)
                } else {
                    errorText = "Session started, but no conversation was returned."
                }
            } catch {
                isStarting = false
                errorText = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}

// MARK: - Hand-drawn glyphs (not SF Symbols)

/// A compact 2×2-dot "workspace" mark anchoring a project header.
private struct ProjectGlyph: View {
    var body: some View {
        VStack(spacing: 3) {
            HStack(spacing: 3) { dot; dot }
            HStack(spacing: 3) { dot; dot }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    private var dot: some View { Circle().frame(width: 3, height: 3) }
}

/// Tree rail connecting a project's agent leaves: a vertical line with a tick
/// into each row; the last leaf elbows (`└`) so the rail doesn't dangle.
private struct TreeConnector: Shape {
    let isLast: Bool
    func path(in r: CGRect) -> Path {
        var p = Path()
        let x = r.minX + 1
        let midY = r.midY
        p.move(to: CGPoint(x: x, y: r.minY))
        p.addLine(to: CGPoint(x: x, y: isLast ? midY : r.maxY))
        p.move(to: CGPoint(x: x, y: midY))
        p.addLine(to: CGPoint(x: r.maxX, y: midY))
        return p
    }
}

// MARK: - Shared

/// A human project label, or nil when the field is empty or an opaque id — a
/// UUID where a name should be (a broker-side data gap we don't surface as a
/// "project"; such agents fall back to grouping under their own name).
func displayProjectName(_ raw: String?) -> String? {
    guard let p = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !p.isEmpty else { return nil }
    let uuid = #"^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$"#
    if p.range(of: uuid, options: .regularExpression) != nil { return nil }
    return p
}

/// Compact relative age ("now" / "3m" / "2h" / "1d") for a row's right edge or a
/// machine's last-seen stamp.
private func machineRelativeAge(_ date: Date?) -> String? {
    ScoutTimestamp.relativeAge(since: date)
}
