import SwiftUI
import HudsonUI
import ScoutCapabilities

private struct AgentsMachineSlice: Identifiable {
    let id: String
    let name: String
    let isOnline: Bool
    let lastSeen: Date?
    let connectionState: AppModel.ConnectionState
    let client: (any ScoutBrokerClient)?
    let agents: [AgentSummary]
    let work: [FleetWorkSummary]
    let hasWorkFeed: Bool
}

private struct AgentsWorkRow: Identifiable {
    let machine: AgentsMachineSlice
    let work: FleetWorkSummary
    let agent: AgentSummary?

    var id: String { "\(machine.id)::\(work.id)" }
    var projectName: String {
        if let project = displayProjectName(agent?.projectName) { return project }
        if let root = agent?.workspaceRoot?.trimmingCharacters(in: .whitespacesAndNewlines), !root.isEmpty {
            return (root as NSString).lastPathComponent
        }
        return "Other"
    }
    var agentName: String { agent?.title ?? work.agentName ?? "Unknown agent" }
    var harness: String? { work.harness ?? agent?.harness }
    var conversationId: String? {
        if let value = work.conversationId?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty {
            return value
        }
        if let value = agent?.conversationId?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty {
            return value
        }
        return nil
    }
}

private struct AgentsProjectWorkGroup: Identifiable {
    let name: String
    let rows: [AgentsWorkRow]
    var id: String { name }
    var newestAt: Date { rows.map(\.work.updatedAt).max() ?? .distantPast }
}

/// The network overview. The primary object is operator-requested work, not an
/// agent identity: RECENT is one fleet-wide ledger; PROJECT groups those exact
/// same rows without changing their meaning. The masthead host facets scope the
/// machines, search narrows the ledger, and NEW isolates unread state changes.
/// Every row retains project · agent · harness · host coordinates and routes
/// through the machine that owns its conversation.
struct AgentsSurface: View {
    let model: AppModel
    let isActive: Bool
    var onConnect: () -> Void = {}
    /// Publishes the pushed conversation's runtime/project/model context into
    /// the global protected-area status bar.
    var onConversationStatusContext: (String?) -> Void = { _ in }

    @State private var sections: [AgentsMachineSlice] = []
    @State private var isLoading = true
    @State private var searchText = ""
    @State private var isSearchExpanded = false
    @State private var sort: SortMode = Self.initialSort
    @State private var workScope: WorkScope = .all
    @AppStorage("scout.work-ledger.seen-versions") private var seenWorkVersionsJSON = "{}"
    @State private var route: ConversationRoute?
    /// The client a pushed conversation routes through — the machine the tapped
    /// agent lives on, not necessarily the bound one.
    @State private var routeClient: (any ScoutBrokerClient)?
    @State private var projectSheet: ProjectNode?
    @State private var sheetClient: (any ScoutBrokerClient)?
    @State private var didDebugOpen = false
    @StateObject private var entrance = CockpitEntrancePhase()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    enum SortMode: String, CaseIterable, Identifiable {
        case project, recent
        var id: String { rawValue }
        var label: String { self == .project ? "PROJECT" : "RECENT" }
    }

    enum WorkScope: String, Identifiable {
        case all, new
        var id: String { rawValue }
    }

    private struct ConversationRoute: Hashable, Identifiable {
        let id: String
        let title: String
    }

    /// The overview opens on the original use case: one newest-first ledger.
    /// In DEBUG `SCOUT_AGENT_SORT=project` can jump straight to the grouping.
    ///
    /// This was formerly project-first, which made the surface feel like a
    /// directory even when the operator came here to answer "what just landed?"
    /// rather than "which agents exist?"
    ///
    /// Default ordering; in DEBUG a `SCOUT_AGENT_SORT=recent` env jumps the
    /// simulator straight to a mode so it can be verified without touch input.
    private static var initialSort: SortMode {
        #if DEBUG
        if let raw = ProcessInfo.processInfo.environment["SCOUT_AGENT_SORT"],
           let m = SortMode(rawValue: raw) { return m }
        #endif
        return .recent
    }

    /// Reload trigger: the focused Mac becoming ready (`dataReadyToken`), ANY Mac's
    /// connection changing (`fleetRevision` — so an aggregated "All" picks up a Mac
    /// that connects in the background), or the filter itself moving.
    private var reloadKey: String {
        "\(model.fleetDataReadyToken).\(model.fleetRevision).\(model.machineFilterKey)"
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                Group {
                    if isSearchExpanded {
                        HStack(spacing: HudSpacing.sm) {
                            ScoutField(
                                "Search work",
                                text: $searchText,
                                icon: "magnifyingglass",
                                accessibilityLabel: "Search work",
                                autofocus: true
                            )
                            Button {
                                searchText = ""
                                isSearchExpanded = false
                            } label: {
                                Text("CANCEL")
                                    .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                                    .tracking(0.45)
                                    .foregroundStyle(ScoutInk.muted)
                                    .frame(minHeight: 44)
                            }
                            .buttonStyle(.plain)
                            .fixedSize()
                        }
                    } else {
                        HStack(spacing: HudSpacing.sm) {
                            WorkSearchButton {
                                isSearchExpanded = true
                            }
                            NewWorkFilter(scope: $workScope, count: newWorkCount)
                            Spacer(minLength: 0)
                            SortToggle(sort: $sort)
                        }
                    }
                }
                    .padding(.horizontal, HudSpacing.xxl)
                    .padding(.top, HudSpacing.lg)
                    .padding(.bottom, HudSpacing.md)
                    .cockpitEntrance(index: 0, phase: entrance)

                if isLoading {
                    ScoutEmptyState(title: "Loading network", icon: "point.3.connected.trianglepath.dotted")
                        .frame(maxWidth: .infinity).padding(.top, HudSpacing.huge)
                } else {
                    if hasReadableWorkFeed || !allAgents.isEmpty {
                        summaryBar.cockpitEntrance(index: 1, phase: entrance)
                    }
                    content
                }
            }
        }
        .refreshable { if isActive { await load() } }
        .task(id: "\(reloadKey)|\(isActive)") {
            guard isActive else { return }
            await load()
            await entrance.reveal(when: isActive, animated: !reduceMotion)
            openDebugProjectIfRequested()
            guard model.fleetDataReadyToken != 0 else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(20))
                if Task.isCancelled { break }
                await load()
            }
        }
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

    // MARK: - Summary + controls

    private var summaryBar: some View {
        let visible = visibleWorkRows
        let moving = visible.filter { [.queued, .working, .needsAttention].contains($0.work.status) }.count
        let completed = visible.filter { $0.work.status == .completed }.count
        let projectLabel = "\(projectWorkGroups.count) \(projectWorkGroups.count == 1 ? "project" : "projects")"
        let text: String
        if workScope == .new {
            text = "\(visible.count) new · \(projectLabel)"
        } else if moving > 0 {
            text = "\(visible.count) work · \(moving) moving · \(completed) completed"
        } else {
            text = "\(visible.count) work · \(completed) completed"
        }
        return HStack {
            ScoutSectionLabel(text.uppercased())
            Spacer(minLength: HudSpacing.md)
            if sections.count > 1 {
                Text("\(readableMachineCount)/\(sections.count) hosts")
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutInk.dim)
                    .monospacedDigit()
            }
        }
        .padding(.horizontal, HudSpacing.xxl)
        .padding(.bottom, HudSpacing.sm)
    }

    @ViewBuilder
    private var content: some View {
        if sections.isEmpty {
            AgentsNetworkEmptyState(onConnect: onConnect)
                .padding(.horizontal, HudSpacing.xxl)
                .padding(.top, HudSpacing.huge)
                .cockpitEntrance(index: 2, phase: entrance)
        } else if !hasReadableWorkFeed, sections.contains(where: \.isOnline) {
            ScoutEmptyState(
                title: "Work feed unavailable",
                subtitle: "Update or restart Scout on the selected host to read fleet work.",
                icon: "arrow.trianglehead.2.clockwise.rotate.90"
            )
            .frame(maxWidth: .infinity).padding(.top, HudSpacing.huge)
            .cockpitEntrance(index: 2, phase: entrance)
        } else if visibleWorkRows.isEmpty, !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            ScoutEmptyState(title: "No matches", subtitle: "Nothing matches “\(searchText)”.", icon: "magnifyingglass")
                .frame(maxWidth: .infinity).padding(.top, HudSpacing.huge)
                .cockpitEntrance(index: 2, phase: entrance)
        } else if visibleWorkRows.isEmpty, workScope == .new, !allWorkRows.isEmpty {
            ScoutEmptyState(
                title: "Nothing new",
                subtitle: "Work returns here when its state changes.",
                icon: "tray"
            )
            .frame(maxWidth: .infinity).padding(.top, HudSpacing.huge)
            .cockpitEntrance(index: 2, phase: entrance)
        } else if visibleWorkRows.isEmpty, hasReadableWorkFeed {
            ScoutEmptyState(
                title: "No network work yet",
                subtitle: "Requests you send through Scout will appear here across hosts.",
                icon: "point.3.connected.trianglepath.dotted"
            )
            .frame(maxWidth: .infinity).padding(.top, HudSpacing.huge)
            .cockpitEntrance(index: 2, phase: entrance)
        } else {
            if sort == .recent { recentWorkContent } else { projectWorkContent }
            offlineCoverage
        }
    }

    @ViewBuilder
    private var recentWorkContent: some View {
        let newIDs = Set(newWorkRows.map(\.id))
        ForEach(Array(visibleWorkRows.enumerated()), id: \.element.id) { index, row in
            FleetWorkLedgerRow(row: row, showProject: true, showHost: sections.count > 1, isNew: newIDs.contains(row.id)) {
                openWork(row)
            }
            .cockpitEntrance(index: index + 2, phase: entrance)
            if index < visibleWorkRows.count - 1 { rowDivider }
        }
    }

    @ViewBuilder
    private var projectWorkContent: some View {
        let newIDs = Set(newWorkRows.map(\.id))
        ForEach(Array(projectWorkGroups.enumerated()), id: \.element.id) { groupIndex, group in
            ProjectWorkHeader(name: group.name, count: group.rows.count, age: machineRelativeAge(group.newestAt))
                .cockpitEntrance(index: groupIndex + 2, phase: entrance)
            ForEach(Array(group.rows.enumerated()), id: \.element.id) { rowIndex, row in
                FleetWorkLedgerRow(row: row, showProject: false, showHost: sections.count > 1, isNew: newIDs.contains(row.id)) {
                    openWork(row)
                }
                if rowIndex < group.rows.count - 1 { rowDivider }
            }
            Rectangle().fill(ScoutHairline.standard).frame(height: HudStrokeWidth.thin)
                .padding(.leading, HudSpacing.xxl)
        }
    }

    @ViewBuilder
    private var offlineCoverage: some View {
        if searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, workScope == .all {
            ForEach(sections.filter { !$0.isOnline }) { section in
                OfflineMachineRow(name: section.name, state: section.connectionState, lastSeen: section.lastSeen)
            }
        }
    }

    private var rowDivider: some View {
        Rectangle().fill(ScoutHairline.subtle).frame(height: 0.5)
            .padding(.leading, HudSpacing.xxl)
    }

    // MARK: - Routing

    private func openWork(_ row: AgentsWorkRow) {
        markWorkSeen(row)
        guard let conversationId = row.conversationId else { return }
        routeClient = row.machine.client
        route = ConversationRoute(id: conversationId, title: row.agentName)
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

    // MARK: - Grouping / ordering

    private var allAgents: [AgentSummary] { sections.flatMap(\.agents) }
    private var hasReadableWorkFeed: Bool { sections.contains { $0.isOnline && $0.hasWorkFeed } }
    private var readableMachineCount: Int { sections.filter { $0.isOnline && $0.hasWorkFeed }.count }
    private var newWorkCount: Int { newWorkRows.count }

    private var allWorkRows: [AgentsWorkRow] {
        sections
            .filter(\.isOnline)
            .flatMap { machine in
                let agentsById = Dictionary(uniqueKeysWithValues: machine.agents.map { ($0.id, $0) })
                return machine.work.map { work in
                    AgentsWorkRow(machine: machine, work: work, agent: agentsById[work.agentId])
                }
            }
            .sorted { lhs, rhs in
                if lhs.work.updatedAt != rhs.work.updatedAt { return lhs.work.updatedAt > rhs.work.updatedAt }
                return lhs.id < rhs.id
            }
    }

    private var visibleWorkRows: [AgentsWorkRow] {
        let scoped = workScope == .new
            ? newWorkRows
            : allWorkRows
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return scoped }
        return scoped.filter { row in
            [
                row.work.task, row.work.summary, row.work.statusLabel,
                row.projectName, row.agentName, row.harness, row.machine.name
            ]
            .compactMap { $0?.lowercased() }
            .contains { $0.contains(q) }
        }
    }

    private var newWorkRows: [AgentsWorkRow] {
        let seen = seenWorkVersions
        return allWorkRows.filter { row in
            row.work.updatedAt.timeIntervalSince1970 > (seen[row.id] ?? 0) + 0.5
        }
    }

    private var seenWorkVersions: [String: TimeInterval] {
        guard let data = seenWorkVersionsJSON.data(using: .utf8),
              let decoded = try? JSONDecoder().decode([String: TimeInterval].self, from: data)
        else { return [:] }
        return decoded
    }

    private func markWorkSeen(_ row: AgentsWorkRow) {
        var seen = seenWorkVersions
        seen[row.id] = row.work.updatedAt.timeIntervalSince1970
        if seen.count > 500 {
            seen = Dictionary(uniqueKeysWithValues: seen
                .sorted { $0.value > $1.value }
                .prefix(500)
                .map { ($0.key, $0.value) })
        }
        guard let data = try? JSONEncoder().encode(seen),
              let json = String(data: data, encoding: .utf8)
        else { return }
        seenWorkVersionsJSON = json
    }

    private var projectWorkGroups: [AgentsProjectWorkGroup] {
        Dictionary(grouping: visibleWorkRows, by: \.projectName)
            .map { name, rows in AgentsProjectWorkGroup(name: name, rows: rows) }
            .sorted { lhs, rhs in
                if lhs.newestAt != rhs.newestAt { return lhs.newestAt > rhs.newestAt }
                return lhs.name.localizedCaseInsensitiveCompare(rhs.name) == .orderedAscending
            }
    }

    private func projects(from agents: [AgentSummary]) -> [ProjectNode] {
        Dictionary(grouping: agents) { projectKey($0) }
            .map { key, value in ProjectNode(id: key, name: key, agents: value.sorted(by: Self.agentOrder)) }
            .sorted(by: Self.projectOrder)
    }

    private func projectKey(_ a: AgentSummary) -> String {
        displayProjectName(a.projectName) ?? a.title
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

    /// Fetch the directory and fleet ledger through each selected host's keyed
    /// client. Failed same-scope reads retain the last good snapshot so a brief
    /// reconnect does not blank the overview; a never-supported work route stays
    /// explicit via `hasWorkFeed == false`.
    private func load() async {
        let expectedReloadKey = reloadKey
        var result: [AgentsMachineSlice] = []
        for machine in model.agentMachines() {
            let prior = sections.first(where: { $0.id == machine.id })
            let agents: [AgentSummary]
            let work: [FleetWorkSummary]
            let hasWorkFeed: Bool
            if let client = machine.client {
                agents = (try? await client.listAgents(query: nil, limit: 100))
                    ?? prior?.agents ?? []
                do {
                    work = try await client.listFleetWork(limit: 100)
                    hasWorkFeed = true
                } catch {
                    work = prior?.work ?? []
                    hasWorkFeed = prior?.hasWorkFeed ?? false
                }
            } else {
                agents = []
                work = []
                hasWorkFeed = false
            }
            result.append(
                AgentsMachineSlice(
                    id: machine.id,
                    name: machine.name,
                    isOnline: machine.isOnline,
                    lastSeen: machine.lastSeen,
                    connectionState: machine.connectionState,
                    client: machine.client,
                    agents: agents,
                    work: work,
                    hasWorkFeed: hasWorkFeed
                )
            )
        }
        guard !Task.isCancelled, expectedReloadKey == reloadKey else { return }
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
        let nodes = projects(from: allAgents)
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
    static func == (lhs: ProjectNode, rhs: ProjectNode) -> Bool { lhs.id == rhs.id && lhs.agents == rhs.agents }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

// MARK: - Ledger controls

private struct AgentsNetworkEmptyState: View {
    let onConnect: () -> Void

    var body: some View {
        VStack(spacing: HudSpacing.lg) {
            Image(systemName: "point.3.connected.trianglepath.dotted")
                .font(HudFont.ui(HudTextSize.xxl, weight: .light))
                .foregroundStyle(ScoutInk.muted)
                .accessibilityHidden(true)

            VStack(spacing: HudSpacing.xs) {
                Text("Bring your network online")
                    .font(HudFont.mono(HudTextSize.sm, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)
                Text("Connect a Mac to see recent work across your hosts.")
                    .font(HudFont.mono(HudTextSize.xs))
                    .foregroundStyle(ScoutInk.muted)
                    .multilineTextAlignment(.center)
            }

            HudButton("Connect a Mac", icon: "link", style: .primary(.green)) {
                onConnect()
            }
        }
        .padding(.horizontal, HudSpacing.xxl)
        .padding(.vertical, HudSpacing.huge)
        .frame(maxWidth: 440)
        .background(
            RoundedRectangle(cornerRadius: ScoutVibe.cardRadius, style: .continuous)
                .fill(ScoutVibe.card)
        )
        .overlay(
            RoundedRectangle(cornerRadius: ScoutVibe.cardRadius, style: .continuous)
                .stroke(ScoutVibe.hairline, lineWidth: HudStrokeWidth.thin)
        )
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
    }
}

private struct WorkSearchButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 12, weight: .medium))
                Text("SEARCH")
                    .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                    .tracking(0.45)
            }
            .foregroundStyle(ScoutInk.muted)
            .padding(.horizontal, HudSpacing.md)
            .frame(minHeight: 44)
            .background(Capsule().fill(ScoutSurface.inset))
            .overlay(Capsule().stroke(ScoutHairline.subtle, lineWidth: HudStrokeWidth.thin))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .fixedSize()
        .accessibilityLabel("Search work")
    }
}

private struct SortToggle: View {
    @Binding var sort: AgentsSurface.SortMode

    var body: some View {
        HStack(spacing: 2) {
            ForEach([AgentsSurface.SortMode.recent, .project]) { mode in
                Button { sort = mode } label: {
                    Text(mode.label)
                        .font(HudFont.mono(HudTextSize.micro, weight: sort == mode ? .bold : .regular))
                        .tracking(0.6)
                        .foregroundStyle(sort == mode ? ScoutPalette.accent : ScoutInk.muted)
                        .padding(.horizontal, HudSpacing.sm)
                        .frame(minHeight: 44)
                        .background(
                            Capsule().fill(sort == mode ? ScoutPalette.accent.opacity(0.12) : .clear)
                        )
                }
                .buttonStyle(.plain)
            }
        }
        .fixedSize()
    }
}

private struct NewWorkFilter: View {
    @Binding var scope: AgentsSurface.WorkScope
    let count: Int

    var body: some View {
        let selected = scope == .new
        Button { scope = selected ? .all : .new } label: {
            HStack(spacing: 4) {
                Text("NEW")
                    .font(HudFont.mono(HudTextSize.micro, weight: selected ? .bold : .regular))
                    .tracking(0.45)
                if count > 0 {
                    Text("\(count)")
                        .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                        .monospacedDigit()
                }
            }
            .foregroundStyle(selected ? ScoutPalette.accent : ScoutInk.muted)
            .padding(.horizontal, HudSpacing.sm)
            .frame(minHeight: 44)
            .background(Capsule().fill(selected ? ScoutPalette.accent.opacity(0.12) : ScoutSurface.inset))
            .overlay(Capsule().stroke(selected ? ScoutPalette.accent.opacity(0.34) : ScoutHairline.subtle, lineWidth: HudStrokeWidth.thin))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .fixedSize()
        .accessibilityLabel("New work")
        .accessibilityValue(selected ? "Showing new work only" : "Showing all work")
        .accessibilityHint(selected ? "Show all work" : "Show work with unread changes")
    }
}

private struct ProjectWorkHeader: View {
    let name: String
    let count: Int
    let age: String?

    var body: some View {
        HStack(spacing: HudSpacing.md) {
            ProjectGlyph()
                .foregroundStyle(ScoutInk.muted)
                .frame(width: 13, height: 13)
            Text(name)
                .font(HudFont.ui(HudTextSize.md, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
                .lineLimit(1)
                .truncationMode(.middle)
            Text("\(count)")
                .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                .foregroundStyle(ScoutInk.muted)
                .monospacedDigit()
                .padding(.horizontal, HudSpacing.sm)
                .padding(.vertical, 1.5)
                .overlay(Capsule().stroke(ScoutHairline.standard, lineWidth: HudStrokeWidth.thin))
            Spacer(minLength: HudSpacing.sm)
            if let age {
                Text(age)
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutInk.dim)
                    .monospacedDigit()
            }
        }
        .padding(.horizontal, HudSpacing.xxl)
        .padding(.top, HudSpacing.xl)
        .padding(.bottom, HudSpacing.xs)
    }
}

private struct FleetWorkLedgerRow: View {
    let row: AgentsWorkRow
    let showProject: Bool
    let showHost: Bool
    let isNew: Bool
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            HStack(alignment: .top, spacing: HudSpacing.md) {
                WorkStatusMark(status: row.work.status)
                    .frame(width: 9, height: 12)
                    .padding(.top, 3)

                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
                        Text(row.work.task)
                            .font(HudFont.ui(HudTextSize.base, weight: .medium))
                            .foregroundStyle(ScoutPalette.ink)
                            .lineLimit(2)
                            .multilineTextAlignment(.leading)
                        Spacer(minLength: HudSpacing.sm)
                        if let age = machineRelativeAge(row.work.completedAt ?? row.work.updatedAt) {
                            HStack(spacing: 5) {
                                if isNew {
                                    Circle()
                                        .fill(ScoutPalette.accent)
                                        .frame(width: 4, height: 4)
                                }
                                Text(age)
                                    .font(HudFont.mono(HudTextSize.micro))
                                    .foregroundStyle(ScoutInk.dim)
                                    .monospacedDigit()
                            }
                        }
                    }

                    if let summary = resultSummary {
                        Text(summary)
                            .font(HudFont.ui(HudTextSize.sm))
                            .foregroundStyle(ScoutInk.muted)
                            .lineLimit(1)
                            .multilineTextAlignment(.leading)
                    }

                    HStack(spacing: HudSpacing.xs) {
                        Text(row.work.statusLabel.uppercased())
                            .foregroundStyle(statusTint)
                        if !coordinate.isEmpty {
                            Text("·")
                            Text(coordinate)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutInk.dim)
                }

                if row.conversationId != nil {
                    Glyphic.chevron(.trailing, size: 12)
                        .foregroundStyle(ScoutInk.dim)
                        .padding(.top, 4)
                }
            }
            .padding(.horizontal, HudSpacing.xxl)
            .padding(.vertical, HudSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityValue(isNew ? "New update" : "Seen")
        .accessibilityHint(row.conversationId == nil ? "Mark update as seen" : "Open the conversation around this work")
    }

    private var resultSummary: String? {
        guard let value = row.work.summary?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty,
              value.localizedCaseInsensitiveCompare(row.work.task) != .orderedSame
        else { return nil }
        return value
    }

    private var coordinate: String {
        var parts: [String] = []
        if showProject { parts.append(row.projectName) }
        parts.append(row.agentName)
        if let harness = row.harness?.lowercased(), !harness.isEmpty { parts.append(harness) }
        if showHost { parts.append(row.machine.name) }
        return parts.joined(separator: " · ")
    }

    private var statusTint: Color {
        switch row.work.status {
        case .working: ScoutPalette.accent
        case .needsAttention: ScoutPalette.statusWarn
        case .failed: ScoutPalette.statusError
        case .queued: ScoutInk.muted
        case .completed, .unknown: ScoutInk.dim
        }
    }
}

private struct WorkStatusMark: View {
    let status: FleetWorkSummary.Status

    var body: some View {
        switch status {
        case .working:
            HudStatusDot(color: ScoutPalette.accent, size: 6, pulses: true)
        case .needsAttention:
            RoundedRectangle(cornerRadius: 1.5, style: .continuous)
                .fill(ScoutPalette.statusWarn)
                .frame(width: 6, height: 6)
                .rotationEffect(.degrees(45))
        case .failed:
            Circle().stroke(ScoutPalette.statusError, lineWidth: 1.25).frame(width: 6, height: 6)
        case .queued:
            Circle().stroke(ScoutInk.muted, lineWidth: 1).frame(width: 6, height: 6)
        case .completed:
            Capsule().fill(ScoutInk.muted).frame(width: 7, height: 2)
        case .unknown:
            Circle().fill(ScoutInk.dim).frame(width: 4, height: 4)
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
            HudStatusDot(color: ScoutPalette.accent, size: 6, pulses: liveCount > 0)
            Text(name)
                .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
                .lineLimit(1).truncationMode(.tail)
            Spacer(minLength: HudSpacing.sm)
            if liveCount > 0 {
                Text("\(liveCount) live")
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutPalette.accent)
            }
            Text("\(agentCount)")
                .font(HudFont.mono(HudTextSize.xs)).monospacedDigit()
                .foregroundStyle(ScoutPalette.muted)
        }
        .padding(.horizontal, HudSpacing.xxl)
        .padding(.vertical, HudSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ScoutPalette.bg)
        .overlay(alignment: .bottom) {
            Rectangle().fill(ScoutHairline.standard).frame(height: HudStrokeWidth.thin)
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
            HudStatusDot(color: ScoutPalette.dim, size: 6, pulses: false)
            Text(name)
                .font(HudFont.ui(HudTextSize.sm, weight: .medium))
                .foregroundStyle(ScoutPalette.muted)
                .lineLimit(1).truncationMode(.tail)
            Spacer(minLength: HudSpacing.sm)
            Text(detail)
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(ScoutPalette.dim)
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
            Rectangle().fill(ScoutHairline.subtle).frame(height: 0.5)
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
                    .foregroundStyle(ScoutPalette.ink)
                    .lineLimit(1).truncationMode(.middle)
                Spacer(minLength: HudSpacing.sm)
                if project.liveCount > 0 {
                    HudStatusDot(color: ScoutPalette.accent, size: 5, pulses: true)
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
    /// Optional fleet provenance used by the global RECENT ordering.
    var context: String? = nil
    let onTap: () -> Void

    struct Connector { let isLast: Bool }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: HudSpacing.md) {
                if let connector {
                    TreeConnector(isLast: connector.isLast)
                        .stroke(ScoutHairline.standard, style: StrokeStyle(lineWidth: 1, lineCap: .round))
                        .frame(width: HudSpacing.xl)
                        .frame(maxHeight: .infinity)
                }
                AgentStateDot(state: agent.state).frame(width: 8)
                VStack(alignment: .leading, spacing: 1) {
                    Text(agent.title)
                        .font(HudFont.ui(HudTextSize.base, weight: connector == nil ? .medium : .regular))
                        .foregroundStyle(ScoutPalette.ink)
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
        let parts = [context, showProject ? displayProjectName(agent.projectName) : nil, branch].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

// MARK: - State dot

private struct AgentStateDot: View {
    let state: AgentSummary.State

    var body: some View {
        switch state {
        case .live:
            HudStatusDot(color: ScoutPalette.accent, size: 6, pulses: true)
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
        _path = State(initialValue: "")
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
                            .foregroundStyle(ScoutPalette.statusError)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(HudSpacing.xxl)
            }
            .background(ScoutPalette.bg)
            .navigationTitle(node.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }.foregroundStyle(ScoutInk.muted)
                }
            }
        }
        .task { await loadProjectPath() }
    }

    /// Resolve the launcher path from the paired Mac's current inventory. Agent
    /// history can contain paths from an older account and is not authoritative.
    private func loadProjectPath() async {
        guard path.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let workspaces = try? await client.listWorkspaces(query: node.name, limit: 50)
        else { return }
        let wanted = node.name.lowercased()
        let match = workspaces.first { workspace in
            workspace.projectName.lowercased() == wanted
                || workspace.title.lowercased() == wanted
                || (workspace.root as NSString).lastPathComponent.lowercased() == wanted
        }
        path = match?.root ?? ""
    }

    private var agentsSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            ScoutSectionLabel("\(node.agents.count) AGENTS")
            ForEach(node.agents) { agent in
                Button { onOpenSession(agent) } label: {
                    HStack(spacing: HudSpacing.md) {
                        AgentStateDot(state: agent.state).frame(width: 8)
                        Text(agent.title)
                            .font(HudFont.ui(HudTextSize.base, weight: .medium))
                            .foregroundStyle(ScoutPalette.ink)
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
            ScoutSectionLabel("START A SESSION")

            // Harness
            HStack(spacing: HudSpacing.sm) {
                ForEach(Self.harnesses, id: \.self) { h in
                    Button { harness = h } label: {
                        Text(h)
                            .font(HudFont.mono(HudTextSize.sm, weight: harness == h ? .bold : .regular))
                            .foregroundStyle(harness == h ? ScoutPalette.bg : ScoutInk.muted)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, HudSpacing.md)
                            .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                                .fill(harness == h ? ScoutPalette.accent : ScoutSurface.inset))
                    }
                    .buttonStyle(.plain)
                }
            }

            ScoutField("Model (optional)", text: $model, icon: "cpu")
            ScoutField("Project path", text: $path, icon: "folder")

            TextEditor(text: $instructions)
                .font(HudFont.ui(HudTextSize.base))
                .foregroundStyle(ScoutPalette.ink)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 88)
                .padding(HudSpacing.md)
                .background(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).fill(ScoutSurface.inset))
                .overlay(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous).stroke(ScoutHairline.standard, lineWidth: HudStrokeWidth.standard))
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
