import SwiftUI
import HudsonUI
import ScoutCapabilities

/// Agents — the bridge's full directory, organized as a **project tree**. Agents
/// group under their project; a project with a single agent collapses to one
/// inline row (no header, no indent). State is not a grouping (that was noise) —
/// it's a quiet per-row dot, and only *live* lights up. No repeated badges, no
/// harness color-coding — harness is just a muted trailing token. Tap an agent to
/// open its conversation. Shares the broker client; reloads when the bridge connects.
struct AgentsSurface: View {
    let client: any ScoutBrokerClient
    var reloadToken: Int = 0

    @State private var agents: [AgentSummary] = []
    @State private var isLoading = true
    @State private var searchText = ""
    @State private var route: ConversationRoute?

    private struct ConversationRoute: Hashable, Identifiable {
        let id: String
        let title: String
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                HudField("Search agents", text: $searchText, icon: "magnifyingglass")
                    .padding(.horizontal, HudSpacing.xxl)
                    .padding(.top, HudSpacing.lg)
                    .padding(.bottom, HudSpacing.md)

                if isLoading {
                    HudEmptyState(title: "Loading agents", icon: "person.2")
                        .frame(maxWidth: .infinity).padding(.top, HudSpacing.huge)
                } else if agents.isEmpty {
                    HudEmptyState(title: "No agents", subtitle: "Connect to your Mac to see the directory.", icon: "person.2.slash")
                        .frame(maxWidth: .infinity).padding(.top, HudSpacing.huge)
                } else if projects.isEmpty {
                    HudEmptyState(title: "No matches", subtitle: "Nothing matches “\(searchText)”.", icon: "magnifyingglass")
                        .frame(maxWidth: .infinity).padding(.top, HudSpacing.huge)
                } else {
                    summary
                    ForEach(projects) { project in
                        ProjectSection(project: project, onOpen: open)
                    }
                }
            }
        }
        .refreshable { await load() }
        .task(id: reloadToken) { await load() }
        .navigationDestination(item: $route) { route in
            ConversationSurface(client: client, conversationId: route.id, title: route.title, onClose: { self.route = nil })
        }
    }

    /// One quiet anchor line in place of the old per-state section headers: the
    /// total, and the live count when anything's actually running.
    private var summary: some View {
        let live = agents.filter { $0.state == .live }.count
        let text = live > 0
            ? "\(agents.count) agents · \(live) live"
            : "\(agents.count) agents · \(projects.count) projects"
        return HudSectionLabel(text.uppercased())
            .padding(.horizontal, HudSpacing.xxl)
            .padding(.bottom, HudSpacing.sm)
    }

    private func open(_ agent: AgentSummary) {
        guard let sid = agent.sessionId else { return }
        route = ConversationRoute(id: sid, title: agent.title)
    }

    // MARK: - Project grouping

    /// Agents grouped by project, each project's agents sorted live-first. Projects
    /// with live activity rise to the top; the rest fall alphabetical.
    private var projects: [ProjectNode] {
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let matches = q.isEmpty ? agents : agents.filter { a in
            [a.title, a.projectName, a.harness, a.statusLabel, a.branch]
                .compactMap { $0?.lowercased() }.contains { $0.contains(q) }
        }
        let grouped = Dictionary(grouping: matches) { agent -> String in
            let p = agent.projectName?.trimmingCharacters(in: .whitespacesAndNewlines)
            return (p?.isEmpty == false ? p! : agent.title)
        }
        return grouped
            .map { key, value in ProjectNode(id: key, name: key, agents: value.sorted(by: Self.agentOrder)) }
            .sorted(by: Self.projectOrder)
    }

    private static func agentOrder(_ a: AgentSummary, _ b: AgentSummary) -> Bool {
        if (a.state == .live) != (b.state == .live) { return a.state == .live }
        return a.title.localizedCaseInsensitiveCompare(b.title) == .orderedAscending
    }

    private static func projectOrder(_ a: ProjectNode, _ b: ProjectNode) -> Bool {
        if a.hasLive != b.hasLive { return a.hasLive }           // live projects rise
        return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
    }

    private func load() async {
        isLoading = true
        agents = (try? await client.listAgents(query: nil, limit: 100)) ?? []
        isLoading = false
    }
}

// MARK: - Model

private struct ProjectNode: Identifiable {
    let id: String
    let name: String
    let agents: [AgentSummary]
    var hasLive: Bool { agents.contains { $0.state == .live } }
    var liveCount: Int { agents.filter { $0.state == .live }.count }
}

// MARK: - Project section (header + leaves, or one inline row)

private struct ProjectSection: View {
    let project: ProjectNode
    let onOpen: (AgentSummary) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if project.agents.count == 1 {
                // Single-agent project: collapse to one top-level inline row.
                AgentRow(agent: project.agents[0], connector: nil, onOpen: onOpen)
            } else {
                ProjectHeaderRow(project: project)
                ForEach(Array(project.agents.enumerated()), id: \.element.id) { idx, agent in
                    AgentRow(
                        agent: agent,
                        connector: AgentRow.Connector(isLast: idx == project.agents.count - 1),
                        onOpen: onOpen
                    )
                }
            }
            Rectangle()
                .fill(HudPalette.ink.opacity(0.06))
                .frame(height: 0.5)
                .padding(.leading, HudSpacing.xxl)
        }
    }
}

// MARK: - Rows

private struct ProjectHeaderRow: View {
    let project: ProjectNode

    var body: some View {
        HStack(spacing: HudSpacing.md) {
            ProjectGlyph()
                .foregroundStyle(HudPalette.muted)
                .frame(width: 13, height: 13)
            Text(project.name)
                .font(HudFont.ui(HudTextSize.md, weight: .semibold))
                .foregroundStyle(HudPalette.ink)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: HudSpacing.sm)
            if project.liveCount > 0 {
                HudStatusDot(color: HudPalette.accent, size: 5, pulses: true)
            }
            Text("\(project.agents.count)")
                .font(HudFont.mono(HudTextSize.xs))
                .monospacedDigit()
                .foregroundStyle(HudPalette.muted)
        }
        .padding(.horizontal, HudSpacing.xxl)
        .padding(.top, HudSpacing.lg)
        .padding(.bottom, HudSpacing.xs)
    }
}

private struct AgentRow: View {
    let agent: AgentSummary
    /// Non-nil ⇒ a leaf under a multi-agent project (draws the tree rail + indent).
    /// nil ⇒ a single-agent project shown inline at the top level.
    let connector: Connector?
    let onOpen: (AgentSummary) -> Void

    struct Connector { let isLast: Bool }

    private var tappable: Bool { agent.sessionId != nil }

    var body: some View {
        Button { onOpen(agent) } label: {
            HStack(spacing: HudSpacing.md) {
                if let connector {
                    TreeConnector(isLast: connector.isLast)
                        .stroke(HudHairline.standard, style: StrokeStyle(lineWidth: 1, lineCap: .round))
                        .frame(width: HudSpacing.xl)
                        .frame(maxHeight: .infinity)
                }
                AgentStateDot(state: agent.state)
                    .frame(width: 8)
                Text(agent.title)
                    .font(HudFont.ui(HudTextSize.base, weight: connector == nil ? .medium : .regular))
                    .foregroundStyle(HudPalette.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: HudSpacing.sm)
                if let harness = agent.harness, !harness.isEmpty {
                    Text(harness.lowercased())
                        .font(HudFont.mono(HudTextSize.xs))
                        .foregroundStyle(HudPalette.muted)
                }
            }
            .padding(.leading, connector == nil ? HudSpacing.xxl : HudSpacing.lg)
            .padding(.trailing, HudSpacing.xxl)
            .padding(.vertical, HudSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .opacity(tappable ? 1 : HudOpacity.muted)
        }
        .buttonStyle(.plain)
        .disabled(!tappable)
    }
}

// MARK: - State dot

/// The agent's state as a single small mark. Only *live* carries the accent
/// (and a pulse); idle is a calm filled dot, offline a hollow ring. No green
/// wall, no repeated "IDLE".
private struct AgentStateDot: View {
    let state: AgentSummary.State

    var body: some View {
        switch state {
        case .live:
            HudStatusDot(color: HudPalette.accent, size: 6, pulses: true)
        case .idle:
            Circle().fill(HudPalette.muted).frame(width: 5, height: 5)
        case .offline, .unknown:
            Circle().stroke(HudPalette.dim, lineWidth: 1).frame(width: 5, height: 5)
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

/// Tree rail connecting a project's agent leaves: a vertical line down the
/// gutter with a short tick into each row. The last leaf stops the vertical at
/// the tick (an `└` elbow) so the rail doesn't dangle past the group.
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
