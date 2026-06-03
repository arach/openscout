import SwiftUI
import HudsonUI
import ScoutCapabilities

/// Home — the fleet landing. A glanceable read of live agents and recent
/// sessions loaded from the broker client, with a search filter and
/// pull-to-refresh. Tapping a row pushes the conversation. Renders two sections
/// of `HudListRow`s with harness/status expressed via `HudBadge` / `HudStatusDot`.
struct HomeSurface: View {
    let client: any ScoutBrokerClient

    @State private var sessions: [SessionSummary] = []
    @State private var agents: [AgentSummary] = []
    @State private var isLoading = true
    @State private var searchText = ""
    @State private var route: ConversationRoute?

    /// A Hashable navigation target — the contract models stay transport-pure.
    private struct ConversationRoute: Hashable, Identifiable {
        let id: String
        let title: String
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: HudSpacing.xxl) {
                if isLoading {
                    HudEmptyState(title: "Loading fleet", subtitle: "Reading sessions and agents from the broker.", icon: "antenna.radiowaves.left.and.right")
                } else if isFleetEmpty {
                    fleetEmptyState
                } else {
                    searchField
                    agentsSection
                    sessionsSection
                }
            }
            .padding(HudSpacing.xxl)
        }
        .refreshable { await load() }
        .task { await load() }
        .navigationDestination(item: $route) { route in
            ConversationSurface(
                client: client,
                conversationId: route.id,
                title: route.title,
                onClose: { self.route = nil }
            )
        }
    }

    /// True when nothing loaded at all — the paired-but-disconnected (or
    /// freshly-connected, nothing yet) case. Distinct from "no search matches".
    private var isFleetEmpty: Bool { agents.isEmpty && sessions.isEmpty }

    private var fleetEmptyState: some View {
        HudEmptyState(
            title: "No fleet yet",
            subtitle: "Once you're connected, your agents and sessions land here. Tap the status chip above to check the connection.",
            icon: "dot.radiowaves.left.and.right"
        )
        .frame(maxWidth: .infinity)
        .padding(.top, HudSpacing.huge)
    }

    // MARK: - Search

    private var searchField: some View {
        HudField("Search the fleet", text: $searchText, icon: "magnifyingglass")
    }

    private func matches(_ haystack: [String?], _ query: String) -> Bool {
        let q = query.lowercased()
        return haystack.compactMap { $0?.lowercased() }.contains { $0.contains(q) }
    }

    // MARK: - Agents

    private var filteredAgents: [AgentSummary] {
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return agents }
        return agents.filter { matches([$0.title, $0.projectName, $0.harness, $0.statusLabel], q) }
    }

    private var agentsSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.lg) {
            HudSectionLabel("Agents · \(filteredAgents.count)")
            if filteredAgents.isEmpty {
                HudEmptyState(title: searchText.isEmpty ? "No agents" : "No matching agents", icon: "person.crop.circle")
            } else {
                ForEach(filteredAgents) { agent in
                    HudListRow(
                        title: agent.title,
                        subtitle: subtitle(for: agent),
                        onTap: agent.sessionId.map { sid in { route = ConversationRoute(id: sid, title: agent.title) } }
                    ) {
                        HudBadge(stateLabel(agent.state), tint: stateColor(agent.state), dot: true)
                    }
                }
            }
        }
    }

    private func subtitle(for agent: AgentSummary) -> String {
        var parts: [String] = []
        if let project = agent.projectName { parts.append(project) }
        if let harness = agent.harness { parts.append(harness) }
        if let label = agent.statusLabel { parts.append(label) }
        return parts.joined(separator: " · ")
    }

    private func stateLabel(_ state: AgentSummary.State) -> String {
        switch state {
        case .live: return "live"
        case .idle: return "idle"
        case .offline: return "offline"
        case .unknown: return "unknown"
        }
    }

    private func stateColor(_ state: AgentSummary.State) -> Color {
        switch state {
        case .live: return HudPalette.accent   // the one accent: green == active
        case .idle: return HudPalette.muted
        case .offline, .unknown: return HudPalette.dim
        }
    }

    // MARK: - Sessions

    private var filteredSessions: [SessionSummary] {
        let q = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return sessions }
        return sessions.filter { matches([$0.title, $0.preview, $0.agentName, $0.projectName], q) }
    }

    private var sessionsSection: some View {
        VStack(alignment: .leading, spacing: HudSpacing.lg) {
            HudSectionLabel("Sessions · \(filteredSessions.count)")
            if filteredSessions.isEmpty {
                HudEmptyState(title: searchText.isEmpty ? "No sessions" : "No matching sessions", icon: "bubble.left.and.bubble.right")
            } else {
                ForEach(filteredSessions) { session in
                    HudListRow(
                        title: session.title,
                        subtitle: subtitle(for: session),
                        onTap: { route = ConversationRoute(id: session.id, title: session.title) }
                    ) {
                        HudBadge(session.status.rawValue, tint: statusColor(session.status), dot: true)
                    }
                }
            }
        }
    }

    private func subtitle(for session: SessionSummary) -> String {
        var parts: [String] = []
        if let project = session.projectName { parts.append(project) }
        if let count = session.messageCount { parts.append("\(count) msgs") }
        if let preview = session.preview { parts.append(preview) }
        return parts.joined(separator: " · ")
    }

    private func statusColor(_ status: SessionSummary.Status) -> Color {
        switch status {
        case .active: return HudPalette.accent   // green == active
        case .idle, .connecting: return HudPalette.muted
        case .closed, .unknown: return HudPalette.dim
        }
    }

    private func load() async {
        isLoading = true
        async let s = try? await client.listSessions(query: nil, limit: 20)
        async let a = try? await client.listAgents(query: nil, limit: 20)
        let (loadedSessions, loadedAgents) = await (s, a)
        sessions = loadedSessions ?? []
        agents = loadedAgents ?? []
        isLoading = false
    }
}
